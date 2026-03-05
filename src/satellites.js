import * as Cesium from 'cesium'
import * as satellite from 'satellite.js'

// CelesTrak provides free TLE data for 180+ active satellites.
// CORS proxy needed in browser context — we use a public CORS proxy or allorigins.
const CELESTRAK_URL =
  'https://corsproxy.io/?url=https://celestrak.org/SOCRATES/query.php' // fallback
const CELESTRAK_ACTIVE =
  'https://corsproxy.io/?url=https://celestrak.org/SOCRATES/query.php'

// Use the JSON API endpoint which avoids CORS issues
const TLE_SOURCES = [
  {
    name: 'Active Satellites',
    url: 'https://corsproxy.io/?url=https://celestrak.org/SOCRATES/query.php',
    // Primary JSON source:
    jsonUrl: 'https://corsproxy.io/?url=https://celestrak.org/SOCRATES/query.php',
  },
]

// CelesTrak GP data API (returns JSON)
const CELESTRAK_GP_URL =
  'https://corsproxy.io/?url=https://celestrak.org/SOCRATES/query.php'

// We'll fetch from the CelesTrak GP endpoint which supports JSON + CORS
const ACTIVE_SATS_URL = 'https://celestrak.org/SOCRATES/query.php'

// CelesTrak endpoint with cors-anywhere or allorigins fallback
const TLE_URL = 'https://api.allorigins.win/get?url=' +
  encodeURIComponent('https://celestrak.org/pub/TLE/catalog.tle')

// The main CelesTrak GP data API supports CORS natively
const GP_API_URL = 'https://celestrak.org/SOCRATES/query.php'

// CelesTrak JSON API — returns objects with OBJECT_NAME, TLE_LINE1, TLE_LINE2
// The /pub/TLE/ files are plain TLE text. The /SOCRATES endpoint is for conjunction
// The correct endpoint for active satellites as JSON:
const CELESTRAK_JSON =
  'https://celestrak.org/SOCRATES/query.php'

// Final correct URL: CelesTrak provides CORS-friendly GP data
// https://celestrak.org/SOCRATES/query.php -> wrong
// Correct: https://celestrak.org/GP/GP_v2.php?GROUP=active&FORMAT=json
// But that requires specific params. Let's use the simple TLE text + allorigins:
const TLE_ACTIVE_TXT = 'https://api.allorigins.win/raw?url=' +
  encodeURIComponent('https://celestrak.org/SOCRATES/query.php')

// Actually the simplest reliable CORS approach for CelesTrak:
// https://celestrak.org/SOCRATES/query.php  <- nope, that's conjunction data
// Correct URL for active satellites TLE text:
const ACTIVE_TLE_URL = 'https://api.allorigins.win/raw?url=' +
  encodeURIComponent('https://celestrak.org/pub/TLE/active.tle')

// Update interval — satellites move slowly enough that 10s is fine
const UPDATE_INTERVAL_MS = 10_000

// Max satellites to render for performance (browser GPU limit)
const MAX_SATS = 180

let satEntities = []
let tleRecords = []
let updateTimer = null
let satDataSource = null
let godModeActive = false

/**
 * Parse plain TLE text (3-line format: name, line1, line2) into records.
 * @param {string} text
 * @returns {Array<{name, satrec}>}
 */
function parseTLEText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const records = []
  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue
    try {
      const satrec = satellite.twoline2satrec(line1, line2)
      records.push({ name, satrec, line1, line2 })
    } catch (e) {
      // skip invalid TLE
    }
  }
  return records
}

/**
 * Compute Cartesian3 position for a satellite satrec at a given Date.
 * Uses SGP4 propagation (same algorithm NORAD uses).
 */
function getSatPosition(satrec, date) {
  const posVel = satellite.propagate(satrec, date)
  if (!posVel || !posVel.position) return null

  // satellite.js returns ECI (Earth-Centered Inertial) km coords
  // Convert to geodetic (lat/lon/alt) via GMST rotation
  const gmst = satellite.gstime(date)
  const geo = satellite.eciToGeodetic(posVel.position, gmst)

  const lon = Cesium.Math.toDegrees(geo.longitude)
  const lat = Cesium.Math.toDegrees(geo.latitude)
  const alt = geo.height * 1000 // km → meters

  return { lon, lat, alt, posVel }
}

/**
 * Fetch TLE data from CelesTrak and parse it.
 */
async function fetchTLEData() {
  const response = await fetch(ACTIVE_TLE_URL, { cache: 'no-store' })
  if (!response.ok) throw new Error(`TLE fetch failed: ${response.status}`)
  const text = await response.text()
  return parseTLEText(text)
}

/**
 * Create or update Cesium entities for each satellite.
 */
function renderSatellites(viewer, records, now) {
  // Remove old entities
  satEntities.forEach(e => viewer.entities.remove(e))
  satEntities = []

  const subset = records.slice(0, MAX_SATS)

  subset.forEach(({ name, satrec, line1, line2 }) => {
    const pos = getSatPosition(satrec, now)
    if (!pos) return

    const entity = viewer.entities.add({
      name,
      position: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt),
      point: {
        pixelSize: godModeActive ? 8 : 4,
        color: godModeActive
          ? Cesium.Color.RED.withAlpha(0.9)
          : Cesium.Color.CYAN.withAlpha(0.7),
        outlineColor: godModeActive ? Cesium.Color.RED : Cesium.Color.WHITE,
        outlineWidth: godModeActive ? 2 : 0,
        scaleByDistance: new Cesium.NearFarScalar(1e6, 2, 1e8, 0.5),
      },
      label: {
        text: name.trim(),
        font: '10px Courier New',
        fillColor: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(8, -8),
        scaleByDistance: new Cesium.NearFarScalar(1e6, 1, 5e7, 0),
        show: godModeActive,
      },
      // Store TLE for info panel
      properties: {
        type: 'satellite',
        name,
        altitude: Math.round(pos.alt / 1000) + ' km',
        lat: pos.lat.toFixed(4),
        lon: pos.lon.toFixed(4),
        line1,
        line2,
      },
    })
    satEntities.push(entity)
  })
}

/**
 * Main satellite initializer.
 */
export async function initSatellites(viewer) {
  satDataSource = new Cesium.CustomDataSource('satellites')
  viewer.dataSources.add(satDataSource)

  try {
    tleRecords = await fetchTLEData()
    console.log(`[Satellites] Loaded ${tleRecords.length} TLE records`)
    renderSatellites(viewer, tleRecords, new Date())
  } catch (e) {
    console.warn('[Satellites] TLE fetch failed, using demo data:', e.message)
    tleRecords = getDemoTLEs()
    renderSatellites(viewer, tleRecords, new Date())
  }

  // Update positions on interval
  updateTimer = setInterval(() => {
    renderSatellites(viewer, tleRecords, new Date())
  }, UPDATE_INTERVAL_MS)

  return {
    getCount: () => Math.min(tleRecords.length, MAX_SATS),
    setVisible: (v) => satEntities.forEach(e => (e.show = v)),
    setGodMode: (active) => {
      godModeActive = active
      renderSatellites(viewer, tleRecords, new Date())
    },
    destroy: () => {
      clearInterval(updateTimer)
      satEntities.forEach(e => viewer.entities.remove(e))
    },
  }
}

/**
 * Minimal demo TLEs for offline/fallback — ISS + a few LEO sats.
 */
function getDemoTLEs() {
  const raw = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00020000  00000-0  35000-3 0  9998
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50000000 00001
HUBBLE
1 20580U 90037B   24001.50000000  .00002000  00000-0  10000-3 0  9997
2 20580  28.4700 100.0000 0002700 200.0000 160.0000 15.09000000 00002
SENTINEL-2A
1 40697U 15028A   24001.50000000  .00000100  00000-0  50000-4 0  9996
2 40697  98.5700  50.0000 0001000 100.0000 260.0000 14.30000000 00003
NOAA-20
1 43013U 17073A   24001.50000000  .00000050  00000-0  25000-4 0  9995
2 43013  98.7400  60.0000 0001000  90.0000 270.0000 14.20000000 00004
TERRA
1 25994U 99068A   24001.50000000  .00000020  00000-0  15000-4 0  9994
2 25994  98.2000  70.0000 0002000  80.0000 280.0000 14.57000000 00005`

  return parseTLEText(raw)
}
