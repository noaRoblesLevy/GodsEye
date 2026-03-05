import * as Cesium from 'cesium'
import { vehicleIcon } from './icons.js'

let godModeActive   = false
let trackedEntity   = null   // entity currently being tracked
let lastFrameTime   = performance.now()
let frameCount      = 0

export function initHUD({ viewer, shaders, satellites, aircraft, cctv }) {

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

  // ── Entity selection → Info panel + tracking ─────────────────────────────
  viewer.selectedEntityChanged.addEventListener(entity => {
    if (!entity || !entity.properties?.type) {
      hideInfoPanel()
      return
    }
    showInfoPanel(entity, viewer)
  })

  document.getElementById('info-close').addEventListener('click', () => {
    stopTracking(viewer)
    viewer.selectedEntity = undefined
    hideInfoPanel()
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

// ── Info panel ───────────────────────────────────────────────────────────────

function showInfoPanel(entity, viewer) {
  const props = entity.properties
  const type  = props.type?.getValue() || 'unknown'
  const name  = entity.name || 'UNKNOWN'

  document.getElementById('info-title').textContent = `[${type.toUpperCase().replace('_', ' ')}] ${name}`

  // Property rows
  const rows = []
  ;(props.propertyNames || []).forEach(key => {
    if (key === 'type') return
    const val = props[key]?.getValue()
    if (val != null) rows.push(
      `<div class="info-row"><span>${key.toUpperCase()}</span><span class="val">${val}</span></div>`
    )
  })

  // CCTV live feed thumbnail
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

  // Track / untrack button (not for CCTV — it doesn't move)
  if (type !== 'cctv') {
    const isTracking = trackedEntity === entity
    rows.push(`
      <div style="margin-top:10px;display:flex;gap:6px;">
        <button id="track-btn" class="hud-action-btn${isTracking ? ' tracking' : ''}"
          style="flex:1">${isTracking ? '⊠ STOP TRACK' : '⊕ TRACK'}</button>
        <button id="zoom-btn" class="hud-action-btn" style="flex:1">⊙ ZOOM TO</button>
      </div>`)
  }

  document.getElementById('info-body').innerHTML = rows.join('')
  document.getElementById('info-panel').classList.remove('hidden')

  // Wire buttons after inserting into DOM
  document.getElementById('track-btn')?.addEventListener('click', () => {
    if (trackedEntity === entity) {
      stopTracking(viewer)
    } else {
      startTracking(entity, viewer)
    }
    // Refresh info panel to reflect new state
    showInfoPanel(entity, viewer)
  })

  document.getElementById('zoom-btn')?.addEventListener('click', () => {
    viewer.zoomTo(entity, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 500_000))
  })
}

function startTracking(entity, viewer) {
  trackedEntity = entity
  viewer.trackedEntity = entity

  // Show tracking indicator in HUD title
  const titleEl = document.getElementById('hud-title')
  titleEl.textContent = `TRACKING: ${entity.name || 'TARGET'}`
  titleEl.style.color = '#ff4444'
  titleEl.style.animation = 'pulse-text 1s infinite'
}

function stopTracking(viewer) {
  trackedEntity = null
  viewer.trackedEntity = undefined

  const titleEl = document.getElementById('hud-title')
  titleEl.textContent = "GOD'S EYE // WORLDVIEW"
  titleEl.style.color = ''
  titleEl.style.animation = ''
}

function hideInfoPanel() {
  document.getElementById('info-panel').classList.add('hidden')
}

// ── Vehicle particle system ───────────────────────────────────────────────────

let vehicleParticles = []
let vehicleTimer     = null
const ICON = vehicleIcon()

function initVehicleParticles(viewer) {
  const center = { lon: -97.7431, lat: 30.2672 }
  const spread = 0.05

  for (let i = 0; i < 200; i++) {
    const lon   = center.lon + (Math.random() - 0.5) * spread * 2
    const lat   = center.lat + (Math.random() - 0.5) * spread * 2
    const speed = 0.000008 + Math.random() * 0.00002
    const dir   = Math.random() < 0.5 ? 1 : -1
    const axis  = Math.random() < 0.5 ? 'lon' : 'lat'

    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 2),
      billboard: {
        image: ICON,
        width: 10, height: 10,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(500, 2, 50_000, 0),
      },
      properties: { type: 'vehicle', speed: Math.round(speed * 3_600_000) + ' km/h' },
    })

    vehicleParticles.push({ entity, lon, lat, speed, dir, axis })
  }

  vehicleTimer = setInterval(() => {
    vehicleParticles.forEach(v => {
      if (v.axis === 'lon') {
        v.lon += v.speed * v.dir
        if (Math.abs(v.lon - center.lon) > spread) v.dir *= -1
      } else {
        v.lat += v.speed * v.dir
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
