import * as Cesium from 'cesium'
import { aircraftIcon, militaryIcon } from './icons.js'

/**
 * Aircraft tracking — airplanes.live ADS-B API.
 *
 * airplanes.live is a community ADS-B network with a free, CORS-enabled API.
 * Endpoint: /v2/point/{lat}/{lon}/{radius_nm}
 *
 * We fire 3 parallel requests covering Americas, Europe/Africa, Asia-Pacific
 * and deduplicate by hex code, giving near-global coverage without auth.
 *
 * Field mapping (differs from OpenSky):
 *   hex        → icao24 (ICAO 24-bit address)
 *   flight     → callsign (has trailing spaces — trim it)
 *   lat / lon  → position
 *   alt_geom   → geometric altitude in FEET (convert × 0.3048 → meters)
 *   gs         → ground speed in knots
 *   track      → true heading in degrees
 *   geom_rate  → vertical rate in ft/min
 *   squawk     → transponder squawk code
 *   (no on_ground field — use alt_baro < 50 ft as ground proxy)
 */

const BASE = 'https://api.airplanes.live/v2/point'
const REGIONS = [
  { lat: 35,  lon: -90,  r: 3000 },   // Americas
  { lat: 48,  lon: 15,   r: 3000 },   // Europe + Africa
  { lat: 20,  lon: 115,  r: 3000 },   // Asia-Pacific
]
const UPDATE_INTERVAL_MS = 15_000
const MAX_RENDER      = 500
const MAX_TRAIL_PTS   = 4
const FT_TO_M         = 0.3048

const aircraftMap     = new Map()   // hex → { entity }
const positionHistory = new Map()   // hex → Cartesian3[]

let updateTimer   = null
let godModeActive = false
let lastStates    = []
let isVisible     = true

// ── Parsing ───────────────────────────────────────────────────────────────────

function parseAC(ac) {
  return {
    icao24:   ac.hex,
    callsign: (ac.flight || ac.hex || '').trim(),
    category: ac.category || '',
    lon:      ac.lon,
    lat:      ac.lat,
    altFt:    ac.alt_geom ?? ac.alt_baro ?? 0,
    altM:     (ac.alt_geom ?? ac.alt_baro ?? 0) * FT_TO_M,
    onGround: (ac.alt_baro != null && ac.alt_baro < 50),
    speedKts: ac.gs || 0,
    heading:  ac.track || 0,
    vertRate: ((ac.geom_rate || 0) * FT_TO_M / 60), // ft/min → m/s
    squawk:   ac.squawk || '',
    type:     ac.t || '',
    desc:     ac.desc || '',
  }
}

function isMilitary(ac) {
  return ac.category === 'C7' ||  // airplanes.live military category
    ['7500','7600','7700'].includes(ac.squawk) ||
    /^(RCH|JAKE|DARK|STING|GHOST|VIPER|HOOK|IRON|SWORD|VALOR|REACH|SPAR|EXEC)/
      .test(ac.callsign.toUpperCase())
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchRegion({ lat, lon, r }) {
  const res = await fetch(`${BASE}/${lat}/${lon}/${r}`, {
    headers: { Accept: 'application/json' },
    cache:   'no-store',
  })
  if (!res.ok) throw new Error(`airplanes.live ${res.status}`)
  const data = await res.json()
  return data.ac || []
}

async function fetchAllAircraft() {
  // Parallel fetch all regions, then deduplicate by hex
  const results = await Promise.allSettled(REGIONS.map(fetchRegion))
  const seen = new Set()
  const all  = []
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const ac of r.value) {
      if (!seen.has(ac.hex)) { seen.add(ac.hex); all.push(ac) }
    }
  }
  return all
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function headingToRotation(deg) {
  return Cesium.Math.toRadians(-deg) // Cesium CCW; icon points up = North
}

function updateAircraft(viewer, rawList) {
  const activeIds = new Set()

  // Filter out ground traffic and entries without position, cap to MAX_RENDER
  const visible = rawList
    .filter(ac => ac.lat != null && ac.lon != null && !(ac.alt_baro != null && ac.alt_baro < 50))
    .slice(0, MAX_RENDER)

  visible.forEach(raw => {
    const s = parseAC(raw)
    if (!s.lon || !s.lat) return

    const altM  = Math.max(s.altM, 150)   // ensure above terrain
    const mil   = isMilitary(s)
    const icon  = mil ? militaryIcon(godModeActive) : aircraftIcon(godModeActive)
    const color = mil
      ? (godModeActive ? Cesium.Color.RED  : Cesium.Color.fromCssColorString('#ff7777'))
      : (godModeActive ? Cesium.Color.ORANGE : Cesium.Color.YELLOW)
    const cart  = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, altM)

    activeIds.add(s.icao24)

    // Append to position history for trail rendering
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
        viewFrom: new Cesium.Cartesian3(0, -80_000, 20_000),
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

  // Remove aircraft that left the feed
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
      console.log(`[Aircraft] ${lastStates.length} states fetched`)
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
