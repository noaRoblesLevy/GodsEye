import * as Cesium from 'cesium'
import { vehicleIcon } from './icons.js'
import { showOrbitalTrack, clearOrbitalTrack } from './satellites.js'

let godModeActive = false
let lastFrameTime = performance.now()
let frameCount    = 0
let currentViewer = null
let currentShaders = null

export function initHUD({ viewer, shaders, satellites, aircraft, cctv }) {
  currentViewer  = viewer
  currentShaders = shaders

  // ── Vision mode buttons ──────────────────────────────────────────────────
  document.querySelectorAll('.vision-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.vision-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      shaders.setMode(btn.dataset.mode)
    })
  })

  // ── Layer toggles ────────────────────────────────────────────────────────
  document.getElementById('toggle-satellites').addEventListener('change', e => satellites.setVisible(e.target.checked))
  document.getElementById('toggle-aircraft').addEventListener('change',  e => aircraft.setVisible(e.target.checked))
  document.getElementById('toggle-cctv').addEventListener('change',      e => cctv.setVisible(e.target.checked))
  document.getElementById('toggle-traffic').addEventListener('change',   e => {
    e.target.checked ? initVehicleParticles(viewer) : destroyVehicleParticles(viewer)
  })

  // ── God Mode ─────────────────────────────────────────────────────────────
  document.getElementById('god-mode-btn').addEventListener('click', () => {
    godModeActive = !godModeActive
    document.getElementById('god-mode-btn').classList.toggle('active', godModeActive)
    shaders.setGodMode(godModeActive)
    satellites.setGodMode(godModeActive)
    aircraft.setGodMode(godModeActive)
    document.body.classList.toggle('god-mode', godModeActive)
  })

  // ── Entity selection → auto-track + info panel ──────────────────────────
  viewer.selectedEntityChanged.addEventListener(entity => {
    if (!entity || !entity.properties?.type?.getValue()) {
      // Clicked empty space — deselect everything
      deselect(viewer, shaders)
      return
    }
    selectEntity(entity, viewer, shaders)
  })

  // Escape key to deselect
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      viewer.selectedEntity = undefined
      deselect(viewer, shaders)
    }
  })

  // ── Stats bar ─────────────────────────────────────────────────────────────
  viewer.scene.postRender.addEventListener(() => {
    const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(viewer.camera.position)
    if (carto) {
      document.getElementById('stat-lat').textContent = 'LAT: ' + Cesium.Math.toDegrees(carto.latitude).toFixed(4)
      document.getElementById('stat-lon').textContent = 'LON: ' + Cesium.Math.toDegrees(carto.longitude).toFixed(4)
      document.getElementById('stat-alt').textContent = 'ALT: ' + (carto.height / 1000).toFixed(1) + ' km'
    }
    frameCount++
    const now = performance.now()
    if (now - lastFrameTime > 1000) {
      document.getElementById('stat-fps').textContent = 'FPS: ' + Math.round(frameCount * 1000 / (now - lastFrameTime))
      frameCount = 0
      lastFrameTime = now
    }
  })

  // ── HUD clock ─────────────────────────────────────────────────────────────
  setInterval(() => {
    document.getElementById('hud-time').textContent = new Date().toUTCString().slice(0, 25) + ' UTC'
  }, 1000)

  // ── Layer counts ──────────────────────────────────────────────────────────
  setInterval(() => {
    document.getElementById('sat-count').textContent  = satellites.getCount()
    document.getElementById('air-count').textContent  = aircraft.getCount()
    document.getElementById('cctv-count').textContent = cctv.getCount()
  }, 5000)
  document.getElementById('sat-count').textContent  = satellites.getCount()
  document.getElementById('cctv-count').textContent = cctv.getCount()
}

// ── Selection / tracking ─────────────────────────────────────────────────────

function selectEntity(entity, viewer, shaders) {
  // Release any existing tracking lock before flying to new target
  viewer.trackedEntity = undefined

  shaders.setSelectedEntity(entity)

  const type = entity.properties?.type?.getValue()
  if (type === 'satellite') {
    showOrbitalTrack(viewer, entity.name)
  } else {
    clearOrbitalTrack(viewer)
  }

  const title = document.getElementById('hud-title')
  title.textContent     = `TRACKING: ${entity.name || 'TARGET'}`
  title.style.color     = '#ff8800'
  title.style.animation = 'pulse-text 1.2s infinite'

  showInfoPanel(entity)

  // Fly smoothly to entity, then engage tracking — avoids the instant
  // viewFrom snap that occurs when trackedEntity is set from far away.
  // Aircraft need a close zoom (~100 km) so the orange brackets are visible;
  // satellites are already in orbit so ~700 km gives the right perspective.
  const pos = entity.position?.getValue(viewer.clock.currentTime)
  if (pos) {
    const isSat   = type === 'satellite'
    const radius  = isSat ? 700_000 : 100_000
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(pos, radius),
      {
        duration: 1.5,
        complete: () => { viewer.trackedEntity = entity },
      }
    )
  } else {
    viewer.trackedEntity = entity
  }
}

function deselect(viewer, shaders) {
  viewer.trackedEntity = undefined
  shaders.setSelectedEntity(null)
  clearOrbitalTrack(viewer)
  hideInfoPanel()

  const title = document.getElementById('hud-title')
  title.textContent     = "GOD'S EYE // WORLDVIEW"
  title.style.color     = ''
  title.style.animation = ''
}

// ── Info panel ───────────────────────────────────────────────────────────────

function showInfoPanel(entity) {
  const props = entity.properties
  const type  = props?.type?.getValue() || 'unknown'
  const name  = entity.name || 'UNKNOWN'

  document.getElementById('info-title').textContent =
    `[${type.toUpperCase().replace('_', ' ')}] ${name}`

  const rows = []
  ;(props?.propertyNames || []).forEach(key => {
    if (key === 'type') return
    const val = props[key]?.getValue()
    if (val != null) rows.push(
      `<div class="info-row"><span>${key.toUpperCase()}</span><span class="val">${val}</span></div>`
    )
  })

  if (type === 'cctv') {
    const url = props.feedUrl?.getValue()
    if (url) {
      rows.push(`<div class="info-row" style="margin-top:8px">
        <a href="${url}" target="_blank" style="color:#00ff41;font-size:10px">▶ OPEN LIVE FEED</a>
      </div>`)
      rows.push(`<img src="${url}" style="width:100%;margin-top:6px;border:1px solid rgba(0,255,65,0.3)"
        onerror="this.style.display='none'" />`)
    }
  }

  // Hint for escape
  rows.push(`<div style="margin-top:10px;font-size:9px;color:rgba(0,255,65,0.35);letter-spacing:1px">
    ESC or click away to deselect
  </div>`)

  document.getElementById('info-body').innerHTML = rows.join('')
  document.getElementById('info-panel').classList.remove('hidden')
}

function hideInfoPanel() {
  document.getElementById('info-panel').classList.add('hidden')
}

// ── Vehicle particles ─────────────────────────────────────────────────────────

let vehicleParticles = []
let vehicleTimer     = null
const VEHICLE_ICON = vehicleIcon()

function initVehicleParticles(viewer) {
  const center = { lon: -97.7431, lat: 30.2672 }
  const spread = 0.05

  for (let i = 0; i < 200; i++) {
    const lon  = center.lon + (Math.random() - 0.5) * spread * 2
    const lat  = center.lat + (Math.random() - 0.5) * spread * 2
    const spd  = 0.000008 + Math.random() * 0.00002
    const dir  = Math.random() < 0.5 ? 1 : -1
    const axis = Math.random() < 0.5 ? 'lon' : 'lat'

    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 2),
      billboard: {
        image: VEHICLE_ICON,
        width: 10, height: 10,
        disableDepthTestDistance: 5e4, // only visible when camera is within 50km
        scaleByDistance: new Cesium.NearFarScalar(500, 2, 50_000, 0),
      },
      properties: { type: 'vehicle' },
    })

    vehicleParticles.push({ entity, lon, lat, spd, dir, axis })
  }

  vehicleTimer = setInterval(() => {
    vehicleParticles.forEach(v => {
      if (v.axis === 'lon') {
        v.lon += v.spd * v.dir
        if (Math.abs(v.lon - center.lon) > spread) v.dir *= -1
      } else {
        v.lat += v.spd * v.dir
        if (Math.abs(v.lat - center.lat) > spread) v.dir *= -1
      }
      v.entity.position = Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 2)
    })
  }, 100)
}

function destroyVehicleParticles(viewer) {
  clearInterval(vehicleTimer)
  vehicleParticles.forEach(v => viewer.entities.remove(v.entity))
  vehicleParticles = []
}
