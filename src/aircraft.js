import * as Cesium from 'cesium'
import { aircraftIcon, militaryIcon } from './icons.js'

/**
 * Aircraft tracking — OpenSky Network (primary) + airplanes.live (fallback).
 *
 * OpenSky provides global ADS-B data including military aircraft, no auth required.
 * Anonymous rate limit: 1 request / 10 s — we poll every 15 s so we're safe.
 * Falls back to airplanes.live (3 regional parallel fetches) on HTTP 429 / error.
 *
 * OpenSky state array indices:
 *   [0] icao24   [1] callsign  [5] lon       [6] lat
 *   [7] baro_alt(m) [8] on_ground [9] velocity(m/s)
 *   [10] true_track(°) [11] vertical_rate(m/s)
 *   [13] geo_altitude(m)  [14] squawk
 */

const OPENSKY_URL = 'https://opensky-network.org/api/states/all'
const ALT_BASE    = 'https://api.airplanes.live/v2/point'
const ALT_REGIONS = [
  { lat: 35,  lon: -90,  r: 3000 },   // Americas
  { lat: 48,  lon: 15,   r: 3000 },   // Europe + Africa
  { lat: 20,  lon: 115,  r: 3000 },   // Asia-Pacific
]

const UPDATE_INTERVAL_MS = 15_000
const MAX_RENDER         = 500
const MAX_TRAIL_PTS      = 4
const FT_TO_M            = 0.3048

const aircraftMap     = new Map()   // icao24 → { entity }
const positionHistory = new Map()   // icao24 → Cartesian3[]

let updateTimer   = null
let godModeActive = false
let lastStates    = []
let isVisible     = true

// ── Parsing ───────────────────────────────────────────────────────────────────

function parseOpenSky(st) {
  const icao24   = st[0] || ''
  const callsign = (st[1] || icao24).trim()
  const lon      = st[5]
  const lat      = st[6]
  const altM     = st[13] ?? st[7] ?? 0    // geo_altitude preferred, baro fallback
  const onGround = st[8] === true
  const speedMs  = st[9] || 0
  const heading  = st[10] || 0
  const vertRate = st[11] || 0
  const squawk   = (st[14] || '').toString()

  return {
    icao24, callsign, lon, lat,
    altM, altFt: altM * 3.28084,
    onGround,
    speedKts: speedMs * 1.944,
    heading, vertRate, squawk,
    type: '', desc: '', category: '',
  }
}

function parseAL(ac) {
  const altFt = ac.alt_geom ?? ac.alt_baro ?? 0
  return {
    icao24:   ac.hex,
    callsign: (ac.flight || ac.hex || '').trim(),
    category: ac.category || '',
    lon:      ac.lon,
    lat:      ac.lat,
    altFt,
    altM:     altFt * FT_TO_M,
    onGround: (ac.alt_baro != null && ac.alt_baro < 50),
    speedKts: ac.gs || 0,
    heading:  ac.track || 0,
    vertRate: (ac.geom_rate || 0) * FT_TO_M / 60,
    squawk:   ac.squawk || '',
    type:     ac.t || '',
    desc:     ac.desc || '',
    category: ac.category || '',
  }
}

function isMilitary(ac) {
  return ac.category === 'C7' ||
    ['7500', '7600', '7700'].includes(ac.squawk) ||
    /^(RCH|JAKE|DARK|STING|GHOST|VIPER|HOOK|IRON|SWORD|VALOR|REACH|SPAR|EXEC|MAGIC|TITAN|FURY|HAWK|EAGLE|FALCON|RAVEN|WOLF)/
      .test(ac.callsign.toUpperCase())
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchOpenSky() {
  const res = await fetch(OPENSKY_URL, {
    headers: { Accept: 'application/json' },
    cache:   'no-store',
  })
  if (res.status === 429) throw Object.assign(new Error('Rate limited'), { code: 429 })
  if (!res.ok)            throw new Error(`OpenSky HTTP ${res.status}`)
  const data = await res.json()
  return (data.states || [])
    .map(parseOpenSky)
    .filter(ac => ac.lon != null && ac.lat != null && !ac.onGround && ac.altM > 30)
}

async function fetchAirplanesLive() {
  const results = await Promise.allSettled(
    ALT_REGIONS.map(({ lat, lon, r }) =>
      fetch(`${ALT_BASE}/${lat}/${lon}/${r}`, {
        headers: { Accept: 'application/json' },
        cache:   'no-store',
      })
        .then(res => res.ok ? res.json() : Promise.reject(new Error(`AL ${res.status}`)))
        .then(d => (d.ac || []).map(parseAL))
    )
  )
  const seen = new Set()
  const all  = []
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const ac of r.value) {
      if (!seen.has(ac.icao24)) { seen.add(ac.icao24); all.push(ac) }
    }
  }
  return all.filter(ac => ac.lon != null && ac.lat != null && !ac.onGround)
}

async function fetchAllAircraft() {
  try {
    const list = await fetchOpenSky()
    console.log(`[Aircraft] OpenSky: ${list.length} aircraft (global)`)
    return list
  } catch (e) {
    console.warn('[Aircraft] OpenSky unavailable, falling back to airplanes.live:', e.message)
    const list = await fetchAirplanesLive()
    console.log(`[Aircraft] airplanes.live: ${list.length} aircraft`)
    return list
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function headingToRotation(deg) {
  return Cesium.Math.toRadians(-deg) // Cesium CCW; icon points up = North
}

function updateAircraft(viewer, rawList) {
  const activeIds = new Set()
  const visible   = rawList.slice(0, MAX_RENDER)

  visible.forEach(s => {
    if (!s.lon || !s.lat) return

    const altM  = Math.max(s.altM, 150)
    const mil   = isMilitary(s)
    const icon  = mil ? militaryIcon(godModeActive) : aircraftIcon(godModeActive)
    const color = mil
      ? (godModeActive ? Cesium.Color.RED    : Cesium.Color.fromCssColorString('#ff7777'))
      : (godModeActive ? Cesium.Color.ORANGE : Cesium.Color.YELLOW)
    const cart  = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, altM)

    activeIds.add(s.icao24)

    const hist = positionHistory.get(s.icao24) || []
    hist.push(cart)
    if (hist.length > MAX_TRAIL_PTS) hist.shift()
    positionHistory.set(s.icao24, hist)

    if (aircraftMap.has(s.icao24)) {
      const { entity } = aircraftMap.get(s.icao24)
      entity.position           = new Cesium.ConstantPositionProperty(cart)
      entity.billboard.image    = new Cesium.ConstantProperty(icon)
      entity.billboard.color    = new Cesium.ConstantProperty(color.withAlpha(0.95))
      entity.billboard.rotation = new Cesium.ConstantProperty(headingToRotation(s.heading))
      entity.label.show         = new Cesium.ConstantProperty(godModeActive)
    } else {
      const labelText = s.callsign + (mil ? ' ✈MIL' : '')
      const entity = viewer.entities.add({
        name: s.callsign || s.icao24,
        position: cart,
        billboard: {
          image:    icon,
          width:    mil ? 26 : 22,
          height:   mil ? 26 : 22,
          rotation: headingToRotation(s.heading),
          alignedAxis: Cesium.Cartesian3.ZERO,
          color:    color.withAlpha(0.95),
          scaleByDistance: new Cesium.NearFarScalar(2e5, 2.5, 1.5e7, 0.2),
          disableDepthTestDistance: 1.5e6,
        },
        label: {
          text:         labelText,
          font:         '9px Courier New',
          fillColor:    color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style:        Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:  new Cesium.Cartesian2(14, -12),
          scaleByDistance: new Cesium.NearFarScalar(2e5, 1, 3e6, 0),
          show: godModeActive,
        },
        properties: {
          type:     mil ? 'military_aircraft' : 'aircraft',
          callsign: s.callsign,
          aircraft: s.desc || s.type || '--',
          altitude: `${Math.round(s.altFt).toLocaleString()} ft (${Math.round(altM)} m)`,
          speed:    `${Math.round(s.speedKts)} kts`,
          heading:  `${Math.round(s.heading)}°`,
          vertRate: `${s.vertRate.toFixed(1)} m/s`,
          squawk:   s.squawk || '--',
          icao24:   s.icao24,
        },
      })
      aircraftMap.set(s.icao24, { entity })
    }
  })

  for (const [id, { entity }] of aircraftMap) {
    if (!activeIds.has(id)) {
      viewer.entities.remove(entity)
      aircraftMap.delete(id)
      positionHistory.delete(id)
    }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initAircraft(viewer) {
  async function update() {
    if (!isVisible) return
    try {
      lastStates = await fetchAllAircraft()
      updateAircraft(viewer, lastStates)
    } catch (e) {
      console.warn('[Aircraft] Fetch failed:', e.message)
    }
  }

  await update()
  updateTimer = setInterval(update, UPDATE_INTERVAL_MS)

  return {
    getCount:   () => aircraftMap.size,
    getTrails:  () => positionHistory,
    setVisible: (v) => {
      isVisible = v
      aircraftMap.forEach(({ entity }) => (entity.show = v))
    },
    setGodMode: (active) => {
      godModeActive = active
      if (lastStates.length) updateAircraft(viewer, lastStates)
    },
    destroy: () => {
      clearInterval(updateTimer)
      aircraftMap.forEach(({ entity }) => viewer.entities.remove(entity))
      aircraftMap.clear()
      positionHistory.clear()
    },
  }
}
