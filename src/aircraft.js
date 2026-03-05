import * as Cesium from 'cesium'
import { aircraftIcon, militaryIcon } from './icons.js'

/**
 * Live aircraft tracking via OpenSky Network.
 *
 * Entities are updated IN-PLACE so viewer.trackedEntity survives refreshes.
 * The billboard rotation is set to the aircraft's true_track heading so the
 * icon always points in the direction of travel.
 *
 * Military squawk codes (7500, 7600, 7700) get a red fighter-jet icon.
 */

const OPENSKY_API = 'https://opensky-network.org/api/states/all'
const UPDATE_INTERVAL_MS = 15_000

// icao24 → { entity, parsed state }
const aircraftMap = new Map()
let updateTimer = null
let godModeActive = false
let lastStates = []
let visible = true

function parseState(s) {
  return {
    icao24:   s[0],
    callsign: (s[1] || '').trim() || s[0],
    country:  s[2] || '',
    lon:      s[5],
    lat:      s[6],
    baroAlt:  s[7] || 0,
    geoAlt:   s[13] || s[7] || 100,
    onGround: s[8],
    velocity: s[9] || 0,       // m/s
    heading:  s[10] || 0,      // true_track degrees
    vertRate: s[11] || 0,
    squawk:   s[14] || '',
  }
}

function isMilitary(s) {
  // Emergency squawk codes commonly associated with military / special ops
  return ['7500', '7600', '7700'].includes(s.squawk) ||
    /^(RCH|JAKE|DARK|STING|GHOST|VIPER|HOOK|IRON|SWORD|VALOR)/.test(s.callsign)
}

/**
 * Cesium billboard rotation for a heading in degrees (0=N, 90=E).
 * Cesium rotates counter-clockwise in screen space, so we negate.
 * The SVG icons point "up" (North) by default.
 */
function headingToRotation(deg) {
  return Cesium.Math.toRadians(-deg)
}

function updateAircraft(viewer, states) {
  const activeIds = new Set()

  states.forEach(raw => {
    const s = parseState(raw)
    if (!s.lon || !s.lat || s.onGround) return

    const alt = Math.max(s.geoAlt, 500)
    const mil  = isMilitary(s)
    const icon = mil ? militaryIcon(godModeActive) : aircraftIcon(godModeActive)
    const color = mil
      ? (godModeActive ? Cesium.Color.RED : Cesium.Color.fromCssColorString('#ff6666'))
      : (godModeActive ? Cesium.Color.ORANGE : Cesium.Color.YELLOW)
    const rotation = headingToRotation(s.heading)
    const cart = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, alt)

    activeIds.add(s.icao24)

    if (aircraftMap.has(s.icao24)) {
      const entry = aircraftMap.get(s.icao24)
      entry.entity.position = new Cesium.ConstantPositionProperty(cart)
      entry.entity.billboard.image    = new Cesium.ConstantProperty(icon)
      entry.entity.billboard.color    = new Cesium.ConstantProperty(color.withAlpha(0.95))
      entry.entity.billboard.rotation = new Cesium.ConstantProperty(rotation)
      entry.entity.label.show = new Cesium.ConstantProperty(godModeActive)
    } else {
      const label = s.callsign + (mil ? ' ✈ MIL' : '')
      const entity = viewer.entities.add({
        name: s.callsign,
        position: cart,
        // Camera offset when tracked: 80km behind at cruise altitude
        viewFrom: new Cesium.Cartesian3(0, -80_000, 20_000),
        billboard: {
          image: icon,
          width:  mil ? 26 : 24,
          height: mil ? 26 : 24,
          rotation,
          // Screen-space rotation (icon always faces camera, just spins)
          alignedAxis: Cesium.Cartesian3.ZERO,
          color: color.withAlpha(0.95),
          scaleByDistance: new Cesium.NearFarScalar(5e5, 2, 2e7, 0.3),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: label,
          font: '9px Courier New',
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(14, -12),
          scaleByDistance: new Cesium.NearFarScalar(5e5, 1, 5e6, 0),
          show: godModeActive,
        },
        properties: {
          type:     mil ? 'military_aircraft' : 'aircraft',
          callsign: s.callsign,
          country:  s.country,
          altitude: Math.round(alt) + ' m (' + Math.round(alt / 304.8) + ' ft)',
          speed:    Math.round(s.velocity * 1.944) + ' kts',
          heading:  Math.round(s.heading) + '°',
          vertRate: s.vertRate.toFixed(1) + ' m/s',
          squawk:   s.squawk || '--',
          icao24:   s.icao24,
        },
      })
      aircraftMap.set(s.icao24, { entity })
    }
  })

  // Remove aircraft no longer in the feed
  for (const [id, { entity }] of aircraftMap) {
    if (!activeIds.has(id)) {
      viewer.entities.remove(entity)
      aircraftMap.delete(id)
    }
  }
}

async function fetchStates() {
  const res = await fetch(OPENSKY_API, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!res.ok) throw new Error(`OpenSky ${res.status}`)
  const data = await res.json()
  return data.states || []
}

export async function initAircraft(viewer) {
  async function update() {
    if (!visible) return
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
    setVisible: (v) => {
      visible = v
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
    },
  }
}
