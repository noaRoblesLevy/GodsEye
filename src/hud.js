import * as Cesium from 'cesium'

/**
 * HUD (Heads-Up Display) controller.
 * Wires DOM controls to the Cesium viewer and data layer modules.
 */

let godModeActive = false
let lastFrameTime = performance.now()
let frameCount = 0
let fps = 0

/**
 * Initialize all HUD interactions.
 */
export function initHUD({ viewer, shaders, satellites, aircraft, cctv }) {
  // ── Vision mode buttons ──────────────────────────────────────────
  document.querySelectorAll('.vision-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.vision-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      shaders.setMode(btn.dataset.mode)
    })
  })

  // ── Layer toggles ────────────────────────────────────────────────
  document.getElementById('toggle-satellites').addEventListener('change', e => {
    satellites.setVisible(e.target.checked)
  })

  document.getElementById('toggle-aircraft').addEventListener('change', e => {
    aircraft.setVisible(e.target.checked)
  })

  document.getElementById('toggle-cctv').addEventListener('change', e => {
    cctv.setVisible(e.target.checked)
  })

  // Traffic / vehicle particle layer (OSM-based)
  document.getElementById('toggle-traffic').addEventListener('change', e => {
    // Vehicle particles are expensive — warn if enabled
    if (e.target.checked) {
      initVehicleParticles(viewer)
    } else {
      destroyVehicleParticles(viewer)
    }
  })

  // ── God Mode ────────────────────────────────────────────────────
  document.getElementById('god-mode-btn').addEventListener('click', () => {
    godModeActive = !godModeActive
    const btn = document.getElementById('god-mode-btn')
    btn.classList.toggle('active', godModeActive)

    shaders.setGodMode(godModeActive)
    satellites.setGodMode(godModeActive)
    aircraft.setGodMode(godModeActive)
    document.body.classList.toggle('god-mode', godModeActive)
  })

  // ── Entity selection → Info panel ───────────────────────────────
  viewer.selectedEntityChanged.addEventListener(entity => {
    if (!entity) {
      hideInfoPanel()
      return
    }

    const props = entity.properties
    if (!props) return

    const type = props.type?.getValue()
    if (!type) return

    showInfoPanel(entity, props)
  })

  document.getElementById('info-close').addEventListener('click', () => {
    viewer.selectedEntity = undefined
    hideInfoPanel()
  })

  // ── Stats bar: lat/lon/alt from camera ──────────────────────────
  viewer.scene.postRender.addEventListener(() => {
    const camera = viewer.camera
    const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(camera.position)
    if (carto) {
      document.getElementById('stat-lat').textContent =
        'LAT: ' + Cesium.Math.toDegrees(carto.latitude).toFixed(4)
      document.getElementById('stat-lon').textContent =
        'LON: ' + Cesium.Math.toDegrees(carto.longitude).toFixed(4)
      document.getElementById('stat-alt').textContent =
        'ALT: ' + (carto.height / 1000).toFixed(1) + ' km'
    }

    // FPS counter
    frameCount++
    const now = performance.now()
    if (now - lastFrameTime > 1000) {
      fps = Math.round(frameCount * 1000 / (now - lastFrameTime))
      document.getElementById('stat-fps').textContent = 'FPS: ' + fps
      frameCount = 0
      lastFrameTime = now
    }
  })

  // ── HUD clock ───────────────────────────────────────────────────
  setInterval(() => {
    document.getElementById('hud-time').textContent =
      new Date().toUTCString().slice(0, 25) + ' UTC'
  }, 1000)

  // ── Layer counts ────────────────────────────────────────────────
  setInterval(() => {
    document.getElementById('sat-count').textContent = satellites.getCount()
    document.getElementById('air-count').textContent = aircraft.getCount()
    document.getElementById('cctv-count').textContent = cctv.getCount()
  }, 5000)
  // Run once immediately
  document.getElementById('sat-count').textContent = satellites.getCount()
  document.getElementById('cctv-count').textContent = cctv.getCount()
}

/** Render entity properties in the info panel */
function showInfoPanel(entity, props) {
  const panel = document.getElementById('info-panel')
  const title = document.getElementById('info-title')
  const body = document.getElementById('info-body')

  const type = props.type?.getValue()
  const name = entity.name || 'UNKNOWN'

  title.textContent = `[${type?.toUpperCase()}] ${name}`

  // Build rows from all properties
  const rows = []
  const propNames = props.propertyNames
  if (propNames) {
    propNames.forEach(key => {
      if (key === 'type') return
      const val = props[key]?.getValue()
      if (val !== undefined && val !== null) {
        rows.push(`<div class="info-row"><span>${key.toUpperCase()}</span><span class="val">${val}</span></div>`)
      }
    })
  }

  // CCTV camera: embed live feed link
  if (type === 'cctv') {
    const feedUrl = props.feedUrl?.getValue()
    if (feedUrl) {
      rows.push(`<div class="info-row" style="margin-top:8px"><a href="${feedUrl}" target="_blank" style="color:#00ff41;font-size:10px">▶ OPEN LIVE FEED</a></div>`)
      rows.push(`<img src="${feedUrl}" style="width:100%;margin-top:6px;border:1px solid rgba(0,255,65,0.3)" onerror="this.style.display='none'" />`)
    }
  }

  body.innerHTML = rows.join('')
  panel.classList.remove('hidden')
}

function hideInfoPanel() {
  document.getElementById('info-panel').classList.add('hidden')
}

// ── Vehicle particle system (OSM street traffic) ────────────────────────────
// Simple moving dots along OSM road geometry to simulate vehicle flow.
// In a full implementation this would consume the OSM Overpass API for road
// geometry and simulate traffic density using AADT data.

let vehicleParticles = []
let vehicleTimer = null

function initVehicleParticles(viewer) {
  // Simplified: create animated particles in Austin street grid
  // Real implementation: fetch OSM road geometry, place particles on paths
  const austinCenter = { lon: -97.7431, lat: 30.2672 }
  const spread = 0.05

  vehicleParticles = []

  for (let i = 0; i < 200; i++) {
    const lon = austinCenter.lon + (Math.random() - 0.5) * spread * 2
    const lat = austinCenter.lat + (Math.random() - 0.5) * spread * 2
    const speed = 0.00001 + Math.random() * 0.00003
    const dir = Math.random() < 0.5 ? 1 : -1

    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 5),
      point: {
        pixelSize: 3,
        color: Cesium.Color.fromCssColorString('#ff6600').withAlpha(0.7),
        scaleByDistance: new Cesium.NearFarScalar(1e3, 2, 1e5, 0),
      },
    })

    vehicleParticles.push({ entity, lon, lat, speed, dir, axis: Math.random() < 0.5 ? 'lon' : 'lat' })
  }

  // Animate
  vehicleTimer = setInterval(() => {
    vehicleParticles.forEach(v => {
      if (v.axis === 'lon') {
        v.lon += v.speed * v.dir
        if (Math.abs(v.lon - (-97.7431)) > 0.05) v.dir *= -1
      } else {
        v.lat += v.speed * v.dir
        if (Math.abs(v.lat - 30.2672) > 0.05) v.dir *= -1
      }
      v.entity.position = Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 5)
    })
  }, 100)
}

function destroyVehicleParticles(viewer) {
  clearInterval(vehicleTimer)
  vehicleParticles.forEach(v => viewer.entities.remove(v.entity))
  vehicleParticles = []
}
