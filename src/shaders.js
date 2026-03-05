/**
 * Post-processing overlay — canvas2D drawn on top of the CesiumJS scene.
 *
 * Responsibilities:
 *  1. Vision mode effects (NVG, FLIR, CRT scanlines, Anime) via CSS filters + canvas
 *  2. Orange targeting brackets on the selected entity (screen-space projection)
 *  3. Aircraft flight trail lines (project positionHistory → screen → draw)
 */

import * as Cesium from 'cesium'

const canvas = document.getElementById('shader-overlay')
const ctx    = canvas.getContext('2d')

let currentMode     = 'normal'
let animFrameId     = null
let godMode         = false
let selectedEntity  = null    // current Cesium entity being tracked
let cesiumViewer    = null    // set by initShaders
let getTrailsFn     = null    // () => Map<id, Cartesian3[]>

function resizeCanvas() {
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight
}

// ── Vision effects ────────────────────────────────────────────────────────────

function drawNightVision() {
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)

  // Film grain
  const id = ctx.createImageData(width, height)
  const d  = id.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 35
    d[i] = 0; d[i+1] = Math.max(0, n); d[i+2] = 0; d[i+3] = 10
  }
  ctx.putImageData(id, 0, 0)

  // NVG tube vignette (circular, hard edge)
  const r = Math.min(width, height) * 0.46
  const vign = ctx.createRadialGradient(width/2, height/2, r * 0.82, width/2, height/2, r)
  vign.addColorStop(0, 'rgba(0,0,0,0)')
  vign.addColorStop(1, 'rgba(0,0,0,0.98)')
  ctx.fillStyle = vign
  ctx.fillRect(0, 0, width, height)

  drawReticle(width/2, height/2, 'rgba(0,255,65,0.45)')
  drawHUDText(`NVG MODE | GAIN: AUTO`, 14, 20, 'rgba(0,255,65,0.7)')
  drawHUDText(utcNow(), 14, height - 14, 'rgba(0,255,65,0.5)')
}

function drawThermal() {
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)

  // Palette legend
  const lx = width - 28, lh = 130, ly = height/2 - lh/2
  const g = ctx.createLinearGradient(0, ly, 0, ly + lh)
  g.addColorStop(0,   'white')
  g.addColorStop(0.25,'yellow')
  g.addColorStop(0.5, 'red')
  g.addColorStop(0.75,'purple')
  g.addColorStop(1,   'black')
  ctx.fillStyle = g
  ctx.fillRect(lx, ly, 12, lh)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 0.8
  ctx.strokeRect(lx, ly, 12, lh)
  ctx.font = '9px Courier New'
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillText('HOT',  lx - 4, ly - 4)
  ctx.fillText('COLD', lx - 6, ly + lh + 12)

  drawReticle(width/2, height/2, 'rgba(255,165,0,0.5)')
  drawHUDText('FLIR THERMAL | SENSITIVITY: HIGH', 14, 20, 'rgba(255,165,0,0.8)')
}

function drawCRT() {
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)

  // Scanlines every 3px
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  for (let y = 0; y < height; y += 3) ctx.fillRect(0, y, width, 1)

  // Vignette
  const vign = ctx.createRadialGradient(width/2, height/2, height*0.28, width/2, height/2, height*0.82)
  vign.addColorStop(0, 'rgba(0,0,0,0)')
  vign.addColorStop(1, 'rgba(0,0,0,0.65)')
  ctx.fillStyle = vign
  ctx.fillRect(0, 0, width, height)

  // Slow horizontal flicker line
  const fy = (Date.now() / 18) % height
  ctx.fillStyle = 'rgba(255,255,255,0.025)'
  ctx.fillRect(0, fy, width, 2)

  drawHUDText(`REC ● ${utcNow()}`, 14, height - 14, 'rgba(0,255,65,0.55)')
}

function drawAnime() {
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  const vign = ctx.createRadialGradient(width/2, height/2, height*0.22, width/2, height/2, height*0.78)
  vign.addColorStop(0, 'rgba(255,240,200,0)')
  vign.addColorStop(1, 'rgba(100,60,20,0.28)')
  ctx.fillStyle = vign
  ctx.fillRect(0, 0, width, height)
}

function drawReticle(cx, cy, color) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  const r = 42, gap = 10
  ctx.beginPath()
  ctx.moveTo(cx, cy - gap); ctx.lineTo(cx, cy - r)
  ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + r)
  ctx.moveTo(cx - gap, cy); ctx.lineTo(cx - r, cy)
  ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + r, cy)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.18, 0, Math.PI * 2)
  ctx.stroke()
}

function drawHUDText(text, x, y, color) {
  ctx.font = '11px Courier New'
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function utcNow() {
  return new Date().toUTCString().slice(0, 25) + ' UTC'
}

// ── God mode border ───────────────────────────────────────────────────────────

function drawGodModeBorder() {
  if (!godMode) return
  const { width, height } = canvas
  ctx.strokeStyle = 'rgba(255,0,0,0.45)'
  ctx.lineWidth = 3
  ctx.setLineDash([8, 4])
  ctx.strokeRect(4, 4, width - 8, height - 8)
  ctx.setLineDash([])
  drawHUDText('⬡ PANOPTIC MODE ACTIVE', 14, height - 30, 'rgba(255,0,0,0.85)')
  drawHUDText('ALL TARGETS TRACKED', 14, height - 14, 'rgba(255,80,80,0.7)')
}

// ── Aircraft trail lines ──────────────────────────────────────────────────────

function drawTrails() {
  if (!cesiumViewer || !getTrailsFn) return
  const scene  = cesiumViewer.scene
  const trails = getTrailsFn()

  trails.forEach((history) => {
    if (history.length < 2) return

    // Project each world position to screen coordinates
    const pts = []
    for (const cart of history) {
      const sc = Cesium.SceneTransforms.worldToWindowCoordinates(scene, cart)
      if (sc) pts.push(sc)
    }
    if (pts.length < 2) return

    ctx.lineWidth = 1
    for (let i = 1; i < pts.length; i++) {
      // Fade opacity: most recent segment is brightest
      const alpha = 0.15 + (i / pts.length) * 0.35
      ctx.strokeStyle = `rgba(255,230,80,${alpha})`
      ctx.beginPath()
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y)
      ctx.lineTo(pts[i].x, pts[i].y)
      ctx.stroke()
    }
  })
}

// ── Selection / targeting brackets ───────────────────────────────────────────

function drawSelectionBrackets() {
  if (!selectedEntity || !cesiumViewer) return

  const pos  = selectedEntity.position?.getValue(cesiumViewer.clock.currentTime)
  if (!pos) return

  const sc = Cesium.SceneTransforms.worldToWindowCoordinates(cesiumViewer.scene, pos)
  if (!sc) return

  const { x, y } = sc
  const t = Date.now() / 600
  const r = 30 + Math.sin(t) * 3   // pulsing radius
  const b = 10                       // bracket arm length

  // Glowing shadow
  ctx.shadowColor = '#ff8800'
  ctx.shadowBlur  = 18 + Math.sin(t) * 8

  // Outer circle
  ctx.strokeStyle = `rgba(255,136,0,${0.55 + Math.sin(t) * 0.2})`
  ctx.lineWidth   = 1.5
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()

  // Corner brackets
  ctx.strokeStyle = '#ffaa00'
  ctx.lineWidth   = 2

  const corners = [
    [x - r, y - r, b, 0,  0,  b],   // TL
    [x + r, y - r, -b, 0, 0,  b],   // TR
    [x - r, y + r, b, 0,  0, -b],   // BL
    [x + r, y + r, -b, 0, 0, -b],   // BR
  ]

  corners.forEach(([ox, oy, dx1, dy1, dx2, dy2]) => {
    ctx.beginPath()
    ctx.moveTo(ox + dx1, oy)
    ctx.lineTo(ox, oy)
    ctx.lineTo(ox, oy + dy2)
    ctx.stroke()
  })

  // Center dot
  ctx.fillStyle   = 'rgba(255,136,0,0.8)'
  ctx.shadowBlur  = 0
  ctx.beginPath()
  ctx.arc(x, y, 2.5, 0, Math.PI * 2)
  ctx.fill()

  ctx.shadowBlur = 0
}

// ── Main render loop ──────────────────────────────────────────────────────────

function loop() {
  // Always clear on each frame so effects don't stack
  if (currentMode === 'normal' && !godMode && !selectedEntity && (!getTrailsFn || getTrailsFn().size === 0)) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  } else {
    switch (currentMode) {
      case 'nightvision': drawNightVision(); break
      case 'thermal':     drawThermal();     break
      case 'crt':         drawCRT();         break
      case 'anime':       drawAnime();       break
      default:
        ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
    drawTrails()
    drawGodModeBorder()
    drawSelectionBrackets()
  }

  animFrameId = requestAnimationFrame(loop)
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initShaders(viewer, getTrails) {
  cesiumViewer = viewer
  getTrailsFn  = getTrails
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  loop()

  return {
    setMode(mode) {
      currentMode = mode
      document.body.className = document.body.className.replace(/mode-\S+/g, '').trim()
      if (mode !== 'normal') document.body.classList.add(`mode-${mode}`)
    },
    setGodMode(active) { godMode = active },
    setSelectedEntity(entity) { selectedEntity = entity },
    destroy() {
      cancelAnimationFrame(animFrameId)
      window.removeEventListener('resize', resizeCanvas)
    },
  }
}
