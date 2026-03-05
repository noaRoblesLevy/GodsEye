import * as Cesium from 'cesium'
import * as satellite from 'satellite.js'

/**
 * Satellite tracker using CelesTrak TLE data + SGP4 propagation.
 *
 * CelesTrak publishes free Two-Line Element (TLE) sets for all tracked objects.
 * The SGP4 algorithm (Simplified General Perturbations #4) propagates orbital
 * mechanics forward in time from a TLE snapshot — same math NORAD uses.
 *
 * Data flow:
 *   CelesTrak active.tle (via allorigins CORS proxy)
 *   → parseTLEText() → array of {name, satrec}
 *   → getSatPosition(satrec, Date) → {lon, lat, alt}
 *   → Cesium entities updated every UPDATE_INTERVAL_MS
 */

// CelesTrak active satellite TLE catalog (plain text, 3 lines per sat)
// Fetched via allorigins.win to bypass browser CORS restrictions
const ACTIVE_TLE_URL =
  'https://api.allorigins.win/raw?url=' +
  encodeURIComponent('https://celestrak.org/pub/TLE/active.tle')

const UPDATE_INTERVAL_MS = 10_000  // 10s — sats move slowly enough
const MAX_SATS = 180               // GPU performance ceiling

let satEntities = []
let tleRecords = []
let updateTimer = null
let godModeActive = false

/**
 * Parse plain TLE text (name / line1 / line2 triplets) into satrec objects.
 * satellite.twoline2satrec() converts TLE strings into the internal satrec
 * struct that SGP4 needs.
 */
function parseTLEText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const records = []
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue
    try {
      const satrec = satellite.twoline2satrec(line1, line2)
      records.push({ name, satrec, line1, line2 })
    } catch {
      // skip malformed TLEs
    }
  }
  return records
}

/**
 * Propagate a satellite's satrec to the given Date and return geodetic coords.
 * Returns null if SGP4 fails (decayed orbit, bad epoch, etc.)
 */
function getSatPosition(satrec, date) {
  const posVel = satellite.propagate(satrec, date)
  if (!posVel?.position) return null

  // Rotate ECI (Earth-Centered Inertial) → geodetic using Greenwich Mean Sidereal Time
  const gmst = satellite.gstime(date)
  const geo = satellite.eciToGeodetic(posVel.position, gmst)

  return {
    lon: Cesium.Math.toDegrees(geo.longitude),
    lat: Cesium.Math.toDegrees(geo.latitude),
    alt: geo.height * 1000,   // km → meters
  }
}

/** Rebuild all satellite Cesium entities for the current time. */
function renderSatellites(viewer, records, now) {
  satEntities.forEach(e => viewer.entities.remove(e))
  satEntities = []

  records.slice(0, MAX_SATS).forEach(({ name, satrec, line1, line2 }) => {
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

/** Fetch TLE catalog from CelesTrak. */
async function fetchTLEData() {
  const res = await fetch(ACTIVE_TLE_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`TLE fetch failed: ${res.status}`)
  return parseTLEText(await res.text())
}

/** Fallback TLE data for offline / API failure scenarios. */
function getDemoTLEs() {
  return parseTLEText(`ISS (ZARYA)
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
2 25994  98.2000  70.0000 0002000  80.0000 280.0000 14.57000000 00005`)
}

/** Main satellite layer initializer. */
export async function initSatellites(viewer) {
  try {
    tleRecords = await fetchTLEData()
    console.log(`[Satellites] Loaded ${tleRecords.length} TLE records from CelesTrak`)
  } catch (e) {
    console.warn('[Satellites] CelesTrak unavailable, using demo TLEs:', e.message)
    tleRecords = getDemoTLEs()
  }

  renderSatellites(viewer, tleRecords, new Date())

  updateTimer = setInterval(
    () => renderSatellites(viewer, tleRecords, new Date()),
    UPDATE_INTERVAL_MS
  )

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
