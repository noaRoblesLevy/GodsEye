import * as Cesium from 'cesium'
import * as satellite from 'satellite.js'
import { satelliteIcon } from './icons.js'

/**
 * Satellite tracker — CelesTrak TLE + SGP4 propagation.
 *
 * Key design: entities are updated IN-PLACE (position property mutated),
 * not destroyed/recreated on each tick. This lets viewer.trackedEntity
 * survive across position refreshes without resetting.
 */

const ACTIVE_TLE_URL =
  'https://api.allorigins.win/raw?url=' +
  encodeURIComponent('https://celestrak.org/pub/TLE/active.tle')

const UPDATE_INTERVAL_MS = 10_000
const MAX_SATS = 180

// name → { entity, satrec, line1, line2 }
const satMap = new Map()
let tleRecords = []
let updateTimer = null
let godModeActive = false

function parseTLEText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const records = []
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue
    try {
      records.push({ name, satrec: satellite.twoline2satrec(line1, line2), line1, line2 })
    } catch { /* skip */ }
  }
  return records
}

function getSatPosition(satrec, date) {
  const posVel = satellite.propagate(satrec, date)
  if (!posVel?.position) return null
  const gmst = satellite.gstime(date)
  const geo  = satellite.eciToGeodetic(posVel.position, gmst)
  return {
    lon: Cesium.Math.toDegrees(geo.longitude),
    lat: Cesium.Math.toDegrees(geo.latitude),
    alt: geo.height * 1000,
  }
}

/**
 * Update satellite positions in-place. Creates new entities for newcomers,
 * removes entities that are no longer in the list, but never re-creates
 * entities that already exist — preserving any active trackedEntity reference.
 */
function updateSatellites(viewer, records, now) {
  const icon = satelliteIcon(godModeActive)
  const color = godModeActive ? Cesium.Color.RED : Cesium.Color.CYAN

  const activeNames = new Set()

  records.slice(0, MAX_SATS).forEach(({ name, satrec, line1, line2 }) => {
    const pos = getSatPosition(satrec, now)
    if (!pos) return

    activeNames.add(name)
    const cart = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt)

    if (satMap.has(name)) {
      // Update existing entity in-place
      const entry = satMap.get(name)
      entry.entity.position = new Cesium.ConstantPositionProperty(cart)
      entry.entity.billboard.image = new Cesium.ConstantProperty(icon)
      entry.entity.billboard.color = new Cesium.ConstantProperty(color.withAlpha(0.9))
      entry.entity.label.show = new Cesium.ConstantProperty(godModeActive)
      // Update properties
      entry.entity.properties.altitude = new Cesium.ConstantProperty(Math.round(pos.alt / 1000) + ' km')
      entry.entity.properties.lat      = new Cesium.ConstantProperty(pos.lat.toFixed(4))
      entry.entity.properties.lon      = new Cesium.ConstantProperty(pos.lon.toFixed(4))
    } else {
      // Create new entity
      const entity = viewer.entities.add({
        name,
        position: cart,
        // Camera offset when tracked: 30km behind, 10km above the satellite
        // viewFrom is in local ENU (East-North-Up) at the entity's surface point
        viewFrom: new Cesium.Cartesian3(0, -30_000, 10_000),
        billboard: {
          image: icon,
          width: 28, height: 28,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          color: color.withAlpha(0.9),
          scaleByDistance: new Cesium.NearFarScalar(1e6, 1.5, 1e8, 0.4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: name.trim(),
          font: '10px Courier New',
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(18, -14),
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
      satMap.set(name, { entity, satrec, line1, line2 })
    }
  })

  // Remove satellites that fell out of the active set (decayed, etc.)
  for (const [name, entry] of satMap) {
    if (!activeNames.has(name)) {
      viewer.entities.remove(entry.entity)
      satMap.delete(name)
    }
  }
}

async function fetchTLEData() {
  const res = await fetch(ACTIVE_TLE_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`TLE fetch failed: ${res.status}`)
  return parseTLEText(await res.text())
}

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

export async function initSatellites(viewer) {
  try {
    tleRecords = await fetchTLEData()
    console.log(`[Satellites] Loaded ${tleRecords.length} TLE records`)
  } catch (e) {
    console.warn('[Satellites] Using demo TLEs:', e.message)
    tleRecords = getDemoTLEs()
  }

  updateSatellites(viewer, tleRecords, new Date())
  updateTimer = setInterval(() => updateSatellites(viewer, tleRecords, new Date()), UPDATE_INTERVAL_MS)

  return {
    getCount:   () => satMap.size,
    setVisible: (v) => satMap.forEach(({ entity }) => (entity.show = v)),
    setGodMode: (active) => {
      godModeActive = active
      updateSatellites(viewer, tleRecords, new Date())
    },
    destroy: () => {
      clearInterval(updateTimer)
      satMap.forEach(({ entity }) => viewer.entities.remove(entity))
      satMap.clear()
    },
  }
}
