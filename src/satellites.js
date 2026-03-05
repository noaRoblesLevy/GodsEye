import * as Cesium from 'cesium'
import * as satellite from 'satellite.js'
import { satelliteIcon } from './icons.js'

const ACTIVE_TLE_URL =
  'https://api.allorigins.win/raw?url=' +
  encodeURIComponent('https://celestrak.org/pub/TLE/active.tle')

const UPDATE_INTERVAL_MS = 10_000
const MAX_SATS = 100  // performance cap

// name → { entity, satrec, line1, line2 }
const satMap = new Map()
let tleRecords    = []
let updateTimer   = null
let godModeActive = false
// Polyline entity for the currently-tracked satellite's orbital ground track
let orbitalTrackEntity = null

function parseTLEText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const records = []
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name  = lines[i]
    const line1 = lines[i + 1]
    const line2 = lines[i + 2]
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue
    try { records.push({ name, satrec: satellite.twoline2satrec(line1, line2), line1, line2 }) }
    catch { /* skip */ }
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
 * Compute the next `durationMin` minutes of orbital ground track.
 * Returns an array of Cartesian3 positions.
 */
export function computeOrbitalTrack(satrec, startDate, durationMin = 100, stepMin = 1) {
  const positions = []
  for (let t = 0; t <= durationMin; t += stepMin) {
    const d = new Date(startDate.getTime() + t * 60_000)
    const p = getSatPosition(satrec, d)
    if (p) positions.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt))
  }
  return positions
}

function updateSatellites(viewer, records, now) {
  const icon        = satelliteIcon(godModeActive)
  const color       = godModeActive ? Cesium.Color.RED : Cesium.Color.CYAN
  const activeNames = new Set()

  records.slice(0, MAX_SATS).forEach(({ name, satrec, line1, line2 }) => {
    const pos = getSatPosition(satrec, now)
    if (!pos) return
    activeNames.add(name)
    const cart = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt)

    if (satMap.has(name)) {
      const { entity } = satMap.get(name)
      entity.position              = new Cesium.ConstantPositionProperty(cart)
      entity.billboard.image       = new Cesium.ConstantProperty(icon)
      entity.billboard.color       = new Cesium.ConstantProperty(color.withAlpha(0.9))
      entity.label.show            = new Cesium.ConstantProperty(godModeActive)
      entity.properties.altitude   = new Cesium.ConstantProperty(Math.round(pos.alt / 1000) + ' km')
      entity.properties.lat        = new Cesium.ConstantProperty(pos.lat.toFixed(4))
      entity.properties.lon        = new Cesium.ConstantProperty(pos.lon.toFixed(4))
    } else {
      const entity = viewer.entities.add({
        name,
        position: cart,
        // Camera sits ~80 km "above" (away from Earth) when tracking —
        // looks down through the satellite at Earth below
        viewFrom: new Cesium.Cartesian3(0, 0, 80_000),
        billboard: {
          image: icon,
          width: 28, height: 28,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          color: color.withAlpha(0.9),
          scaleByDistance: new Cesium.NearFarScalar(5e5, 1.8, 1e8, 0.3),
          // 1.5e6 m threshold: depth-tested when camera is far away (occludes globe back-side)
          disableDepthTestDistance: 1.5e6,
        },
        label: {
          text: name.trim(),
          font: '10px Courier New',
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(18, -14),
          scaleByDistance: new Cesium.NearFarScalar(5e5, 1, 5e7, 0),
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

  for (const [name, { entity }] of satMap) {
    if (!activeNames.has(name)) {
      viewer.entities.remove(entity)
      satMap.delete(name)
    }
  }
}

/**
 * Show the orbital ground track for a satellite by name.
 * Draws a polyline for the next 100 minutes of orbit.
 */
export function showOrbitalTrack(viewer, name) {
  clearOrbitalTrack(viewer)
  const entry = satMap.get(name)
  if (!entry) return
  const positions = computeOrbitalTrack(entry.satrec, new Date())
  if (positions.length < 2) return

  orbitalTrackEntity = viewer.entities.add({
    polyline: {
      positions,
      width: 1.5,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.CYAN.withAlpha(0.5),
        dashLength: 16,
      }),
      arcType: Cesium.ArcType.NONE, // straight lines in 3D space
    },
  })
}

export function clearOrbitalTrack(viewer) {
  if (orbitalTrackEntity) {
    viewer.entities.remove(orbitalTrackEntity)
    orbitalTrackEntity = null
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
      clearOrbitalTrack(viewer)
      satMap.forEach(({ entity }) => viewer.entities.remove(entity))
      satMap.clear()
    },
  }
}
