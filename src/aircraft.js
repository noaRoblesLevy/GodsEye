import * as Cesium from 'cesium'
import { aircraftIcon, militaryIcon } from './icons.js'

/**
 * Aircraft tracking — OpenSky Network.
 *
 * Performance:
 *  - Bounding box limited to N America + Europe (keeps count ~300 vs 7000+ global)
 *  - Entities updated IN-PLACE (no destroy/recreate) to preserve trackedEntity
 *  - disableDepthTestDistance: 1.5e6 — entities on far side of globe are occluded
 *
 * Flight trails:
 *  - Last 4 positions per aircraft stored in positionHistory
 *  - Exposed via getTrails() for the shader canvas to draw each frame
 */

const OPENSKY_API = 'https://opensky-network.org/api/states/all'
const UPDATE_INTERVAL_MS = 15_000

// Bounding box: covers continental US + most of Europe
const BBOX = { lamin: 20, lomin: -130, lamax: 65, lomax: 45 }
const BBOX_QUERY = `?lamin=${BBOX.lamin}&lomin=${BBOX.lomin}&lamax=${BBOX.lamax}&lomax=${BBOX.lomax}`

const MAX_TRAIL_POINTS = 4

// icao24 → { entity }
const aircraftMap = new Map()
// icao24 → Cartesian3[]  (position history for trail rendering)
const positionHistory = new Map()

let updateTimer   = null
let godModeActive = false
let lastStates    = []
let isVisible     = true

function parseState(s) {
  return {
    icao24:   s[0],
    callsign: (s[1] || '').trim() || s[0],
    country:  s[2] || '',
    lon:      s[5],
    lat:      s[6],
    geoAlt:   s[13] || s[7] || 100,
    onGround: s[8],
    velocity: s[9] || 0,
    heading:  s[10] || 0,
    vertRate: s[11] || 0,
    squawk:   s[14] || '',
  }
}

function isMilitary(s) {
  return ['7500', '7600', '7700'].includes(s.squawk) ||
    /^(RCH|JAKE|DARK|STING|GHOST|VIPER|HOOK|IRON|SWORD|VALOR|REACH|SPAR|EXEC)/.test(s.callsign)
}

function headingToRotation(deg) {
  // Cesium rotates counter-clockwise; SVG icons point up (North = 0°)
  return Cesium.Math.toRadians(-deg)
}

function updateAircraft(viewer, states) {
  const activeIds = new Set()

  states.forEach(raw => {
    const s = parseState(raw)
    if (!s.lon || !s.lat || s.onGround) return

    const alt   = Math.max(s.geoAlt, 500)
    const mil   = isMilitary(s)
    const icon  = mil ? militaryIcon(godModeActive) : aircraftIcon(godModeActive)
    const color = mil
      ? (godModeActive ? Cesium.Color.RED         : Cesium.Color.fromCssColorString('#ff7777'))
      : (godModeActive ? Cesium.Color.ORANGE       : Cesium.Color.YELLOW)
    const cart = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, alt)

    activeIds.add(s.icao24)

    // Maintain position history for trail rendering
    const hist = positionHistory.get(s.icao24) || []
    hist.push(cart)
    if (hist.length > MAX_TRAIL_POINTS) hist.shift()
    positionHistory.set(s.icao24, hist)

    if (aircraftMap.has(s.icao24)) {
      const { entity } = aircraftMap.get(s.icao24)
      entity.position              = new Cesium.ConstantPositionProperty(cart)
      entity.billboard.image       = new Cesium.ConstantProperty(icon)
      entity.billboard.color       = new Cesium.ConstantProperty(color.withAlpha(0.95))
      entity.billboard.rotation    = new Cesium.ConstantProperty(headingToRotation(s.heading))
      entity.label.show            = new Cesium.ConstantProperty(godModeActive)
    } else {
      const entity = viewer.entities.add({
        name: s.callsign,
        position: cart,
        // Camera 80km behind, 20km above — classic "chase" view
        viewFrom: new Cesium.Cartesian3(0, -80_000, 20_000),
        billboard: {
          image: icon,
          width: mil ? 26 : 22,
          height: mil ? 26 : 22,
          rotation: headingToRotation(s.heading),
          alignedAxis: Cesium.Cartesian3.ZERO, // rotate in screen space
          color: color.withAlpha(0.95),
          scaleByDistance: new Cesium.NearFarScalar(2e5, 2.5, 1.5e7, 0.2),
          disableDepthTestDistance: 1.5e6,
        },
        label: {
          text: s.callsign + (mil ? ' ✈ MIL' : ''),
          font: '9px Courier New',
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(14, -12),
          scaleByDistance: new Cesium.NearFarScalar(2e5, 1, 3e6, 0),
          show: godModeActive,
        },
        properties: {
          type:     mil ? 'military_aircraft' : 'aircraft',
          callsign: s.callsign,
          country:  s.country,
          altitude: `${Math.round(alt)} m (${Math.round(alt / 304.8)} ft)`,
          speed:    `${Math.round(s.velocity * 1.944)} kts`,
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

async function fetchStates() {
  const res = await fetch(OPENSKY_API + BBOX_QUERY, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`OpenSky ${res.status}`)
  return (await res.json()).states || []
}

export async function initAircraft(viewer) {
  async function update() {
    if (!isVisible) return
    try {
      lastStates = await fetchStates()
      updateAircraft(viewer, lastStates)
    } catch (e) {
      console.warn('[Aircraft] OpenSky failed:', e.message)
    }
  }

  await update()
  updateTimer = setInterval(update, UPDATE_INTERVAL_MS)

  return {
    getCount:   () => aircraftMap.size,
    // Returns current positionHistory map for the shader to draw trails
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
