import './style.css'
import { initViewer } from './viewer.js'
import { initSatellites } from './satellites.js'
import { initAircraft } from './aircraft.js'
import { initShaders } from './shaders.js'
import { initHUD } from './hud.js'
import { initCCTV } from './cctv.js'

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''

async function main() {
  const viewer     = await initViewer('cesiumContainer', GOOGLE_MAPS_KEY)
  const aircraft   = await initAircraft(viewer)
  // Pass aircraft.getTrails so shaders can draw flight path overlays each frame
  const shaders    = initShaders(viewer, aircraft.getTrails)
  const satellites = await initSatellites(viewer)
  const cctv       = initCCTV(viewer)

  initHUD({ viewer, shaders, satellites, aircraft, cctv })
}

main().catch(console.error)
