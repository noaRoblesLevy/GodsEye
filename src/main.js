import './style.css'
import { initViewer } from './viewer.js'
import { initSatellites } from './satellites.js'
import { initAircraft } from './aircraft.js'
import { initShaders } from './shaders.js'
import { initHUD } from './hud.js'
import { initCCTV } from './cctv.js'

// Google Maps Photorealistic 3D Tiles API key
// Set via environment variable VITE_GOOGLE_MAPS_KEY or inline for demo
const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''

async function main() {
  // 1. Initialize Cesium viewer with Google Photorealistic 3D Tiles
  const viewer = await initViewer('cesiumContainer', GOOGLE_MAPS_KEY)

  // 2. Initialize shader overlay (NVG, FLIR, CRT, Anime post-processing)
  const shaders = initShaders(viewer)

  // 3. Initialize data layers
  const satellites = await initSatellites(viewer)
  const aircraft = await initAircraft(viewer)
  const cctv = initCCTV(viewer)

  // 4. Wire up HUD controls
  initHUD({ viewer, shaders, satellites, aircraft, cctv })
}

main().catch(console.error)
