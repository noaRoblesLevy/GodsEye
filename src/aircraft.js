import * as Cesium from 'cesium'

/**
 * Aircraft tracking via OpenSky Network REST API.
 *
 * OpenSky provides real-time ADS-B data from a global network of receivers.
 * Each state vector contains: ICAO24 transponder ID, callsign, origin country,
 * longitude, latitude, altitude (barometric + geometric), velocity, heading.
 *
 * Rate limit: ~10s for anonymous users (we respect this with our interval).
 */

const OPENSKY_API = 'https://opensky-network.org/api/states/all'
const UPDATE_INTERVAL_MS = 15_000 // 15s respects OpenSky rate limits

// ADS-B Exchange military flight data (crowdsourced)
// Requires API key — we include it as optional enhancement
const ADSB_EXCHANGE_MILITARY =
  'https://adsbexchange.com/api/aircraft/json/mil/'

let aircraftEntities = []
let updateTimer = null
let godModeActive = false
let lastStates = []

/**
 * Fetch aircraft states from OpenSky.
 * Returns array of state vectors.
 */
async function fetchAircraftStates(bounds = null) {
  // Bounding box: {lamin, lomin, lamax, lomax}
  // null = global (slower but more data)
  let url = OPENSKY_API
  if (bounds) {
    url += `?lamin=${bounds.lamin}&lomin=${bounds.lomin}&lamax=${bounds.lamax}&lomax=${bounds.lomax}`
  }

  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  })

  if (!resp.ok) throw new Error(`OpenSky error: ${resp.status}`)
  const data = await resp.json()
  return data.states || []
}

/**
 * Parse a raw OpenSky state vector array into a structured object.
 * OpenSky state format (index → field):
 * [0] icao24, [1] callsign, [2] origin_country, [3] time_position,
 * [4] last_contact, [5] longitude, [6] latitude, [7] baro_altitude,
 * [8] on_ground, [9] velocity, [10] true_track, [11] vertical_rate,
 * [12] sensors, [13] geo_altitude, [14] squawk, [15] spi, [16] position_source
 */
function parseState(s) {
  return {
    icao24: s[0],
    callsign: (s[1] || '').trim() || s[0],
    country: s[2] || '',
    lon: s[5],
    lat: s[6],
    baroAlt: s[7] || 0,        // meters
    geoAlt: s[13] || s[7] || 100, // meters
    onGround: s[8],
    velocity: s[9] || 0,       // m/s
    heading: s[10] || 0,       // degrees (0=N, 90=E)
    vertRate: s[11] || 0,      // m/s
    squawk: s[14] || '',
  }
}

/**
 * Convert heading (0-360°) to a Cesium HPR orientation.
 */
function headingToOrientation(headingDeg) {
  return new Cesium.HeadingPitchRoll(
    Cesium.Math.toRadians(headingDeg),
    0,
    0
  )
}

/**
 * Render aircraft as Cesium entities.
 */
function renderAircraft(viewer, states) {
  // Remove old entities
  aircraftEntities.forEach(e => viewer.entities.remove(e))
  aircraftEntities = []

  states.forEach(raw => {
    const s = parseState(raw)
    if (!s.lon || !s.lat) return
    if (s.onGround) return // skip ground traffic for cleanliness

    const alt = Math.max(s.geoAlt, 1000) // ensure above terrain
    const color = godModeActive ? Cesium.Color.ORANGE : Cesium.Color.YELLOW

    const entity = viewer.entities.add({
      name: s.callsign,
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, alt),
      point: {
        pixelSize: godModeActive ? 10 : 6,
        color: color.withAlpha(0.9),
        outlineColor: godModeActive ? Cesium.Color.RED : Cesium.Color.BLACK,
        outlineWidth: godModeActive ? 2 : 1,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 2.5, 2e7, 0.3),
      },
      label: {
        text: s.callsign + (s.squawk ? `\nSQK:${s.squawk}` : ''),
        font: '9px Courier New',
        fillColor: color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(10, -10),
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1, 5e6, 0),
        show: godModeActive,
      },
      properties: {
        type: 'aircraft',
        callsign: s.callsign,
        country: s.country,
        altitude: Math.round(alt) + ' m (' + Math.round(alt / 304.8) + ' ft)',
        speed: Math.round(s.velocity * 1.944) + ' kts',
        heading: Math.round(s.heading) + '°',
        vertRate: s.vertRate.toFixed(1) + ' m/s',
        squawk: s.squawk || '--',
        icao24: s.icao24,
      },
    })

    aircraftEntities.push(entity)
  })
}

/**
 * Main aircraft initializer.
 */
export async function initAircraft(viewer) {
  let visible = true

  async function update() {
    if (!visible) return
    try {
      // Start with a broad bounding box (N America + Europe for good coverage)
      const states = await fetchAircraftStates()
      lastStates = states
      renderAircraft(viewer, states)
    } catch (e) {
      console.warn('[Aircraft] OpenSky fetch failed:', e.message)
      // Keep existing entities on error
    }
  }

  // Initial load
  await update()

  // Schedule updates
  updateTimer = setInterval(update, UPDATE_INTERVAL_MS)

  return {
    getCount: () => aircraftEntities.length,
    setVisible: (v) => {
      visible = v
      aircraftEntities.forEach(e => (e.show = v))
    },
    setGodMode: (active) => {
      godModeActive = active
      if (lastStates.length) renderAircraft(viewer, lastStates)
    },
    destroy: () => {
      clearInterval(updateTimer)
      aircraftEntities.forEach(e => viewer.entities.remove(e))
    },
  }
}
