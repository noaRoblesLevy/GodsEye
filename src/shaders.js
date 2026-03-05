/**
 * Post-processing shader effects for God's Eye.
 *
 * Architecture: CSS filters handle the broad color transformation (NVG green,
 * FLIR heat palette, anime saturation). A Canvas2D overlay renders frame-by-frame
 * effects that CSS can't express: CRT scanlines, phosphor glow, targeting reticle.
 *
 * Modes:
 *  - normal     : no effect
 *  - nightvision: NVG green amplification + noise + phosphor glow
 *  - thermal    : FLIR heat palette (CSS hue-rotate + canvas gradient lut)
 *  - crt        : CRT scanlines + barrel distortion simulation
 *  - anime      : Cel-shading edge detection outline
 */

const canvas = document.getElementById('shader-overlay')
const ctx = canvas.getContext('2d')

let currentMode = 'normal'
let animFrameId = null
let godMode = false

/** Resize canvas to match viewport */
function resizeCanvas() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}

/** Draw CRT scanlines across the entire canvas */
function drawCRTScanlines() {
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)

  // Horizontal scanlines every 3px
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
  for (let y = 0; y < height; y += 3) {
    ctx.fillRect(0, y, width, 1)
  }

  // Vignette (dark corners)
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, height * 0.3,
    width / 2, height / 2, height * 0.85
  )
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.6)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)

  // Subtle horizontal flicker line (moves slowly)
  const flickerY = (Date.now() / 20) % height
  ctx.fillStyle = 'rgba(255,255,255,0.03)'
  ctx.fillRect(0, flickerY, width, 2)

  // Corner timestamp
  ctx.font = '11px Courier New'
  ctx.fillStyle = 'rgba(0,255,65,0.6)'
  ctx.fillText('REC ● ' + new Date().toISOString().replace('T', ' ').slice(0, 19), 14, height - 14)
}

/** Draw Night Vision phosphor glow + noise */
function drawNightVision() {
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)

  // Film grain / sensor noise
  const imageData = ctx.createImageData(width, height)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 40
    data[i] = 0
    data[i + 1] = Math.max(0, noise)
    data[i + 2] = 0
    data[i + 3] = 12 // very subtle
  }
  ctx.putImageData(imageData, 0, 0)

  // Circular vignette (NVG tube shape)
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.38,
    width / 2, height / 2, Math.min(width, height) * 0.55
  )
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.92)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)

  // HUD reticle center cross
  drawReticle(width / 2, height / 2, 'rgba(0,255,65,0.5)')

  // Timestamp + GAIN label
  ctx.font = '11px Courier New'
  ctx.fillStyle = 'rgba(0,255,65,0.7)'
  ctx.fillText('NVG MODE | GAIN: AUTO', 14, 20)
  ctx.fillText(new Date().toUTCString().slice(0, 25) + ' UTC', 14, height - 14)
}

/** Draw FLIR thermal overlay effects */
function drawThermal() {
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)

  // Color scale legend (bottom right) — shows FLIR palette
  const legendX = width - 30
  const legendH = 120
  const legendY = height / 2 - legendH / 2
  const grad = ctx.createLinearGradient(0, legendY, 0, legendY + legendH)
  grad.addColorStop(0, 'white')
  grad.addColorStop(0.2, 'yellow')
  grad.addColorStop(0.5, 'red')
  grad.addColorStop(0.8, 'purple')
  grad.addColorStop(1, 'black')
  ctx.fillStyle = grad
  ctx.fillRect(legendX, legendY, 14, legendH)
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ctx.lineWidth = 1
  ctx.strokeRect(legendX, legendY, 14, legendH)

  ctx.font = '9px Courier New'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText('HOT', legendX - 4, legendY - 4)
  ctx.fillText('COLD', legendX - 6, legendY + legendH + 12)

  // Targeting reticle center
  drawReticle(width / 2, height / 2, 'rgba(255,165,0,0.5)')

  // Labels
  ctx.font = '11px Courier New'
  ctx.fillStyle = 'rgba(255,165,0,0.8)'
  ctx.fillText('FLIR THERMAL | SENSITIVITY: HIGH', 14, 20)
  ctx.fillText('TEMP RANGE: -20°C to +60°C', 14, 34)
}

/** Draw anime cel-shading edge hint overlay */
function drawAnime() {
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)

  // Soft colored vignette — warm tones for Studio Ghibli feel
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, height * 0.2,
    width / 2, height / 2, height * 0.8
  )
  vignette.addColorStop(0, 'rgba(255,240,200,0)')
  vignette.addColorStop(1, 'rgba(100,60,20,0.3)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}

/** Draw a military targeting reticle */
function drawReticle(cx, cy, color) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1

  const r = 40
  const gap = 10

  ctx.beginPath()
  // Top
  ctx.moveTo(cx, cy - gap)
  ctx.lineTo(cx, cy - r)
  // Bottom
  ctx.moveTo(cx, cy + gap)
  ctx.lineTo(cx, cy + r)
  // Left
  ctx.moveTo(cx - gap, cy)
  ctx.lineTo(cx - r, cy)
  // Right
  ctx.moveTo(cx + gap, cy)
  ctx.lineTo(cx + r, cy)
  ctx.stroke()

  // Outer circle
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2)
  ctx.stroke()

  // Inner dot
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, 2, 0, Math.PI * 2)
  ctx.fill()
}

/** God Mode detection grid (red bounding boxes over the scene) */
function drawGodModeOverlay() {
  if (!godMode) return
  const { width, height } = canvas

  // Red frame border
  ctx.strokeStyle = 'rgba(255,0,0,0.5)'
  ctx.lineWidth = 3
  ctx.setLineDash([8, 4])
  ctx.strokeRect(4, 4, width - 8, height - 8)
  ctx.setLineDash([])

  // "PANOPTIC MODE" label
  ctx.font = 'bold 12px Courier New'
  ctx.fillStyle = 'rgba(255,0,0,0.85)'
  ctx.fillText('⬡ PANOPTIC MODE ACTIVE', 14, height - 30)
  ctx.font = '10px Courier New'
  ctx.fillStyle = 'rgba(255,80,80,0.7)'
  ctx.fillText('ALL TARGETS TRACKED', 14, height - 14)
}

/** Animation loop — redraws overlay at 30fps */
function loop() {
  switch (currentMode) {
    case 'nightvision': drawNightVision(); break
    case 'thermal':     drawThermal();     break
    case 'crt':         drawCRTScanlines(); break
    case 'anime':       drawAnime();        break
    default:
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      break
  }

  drawGodModeOverlay()
  animFrameId = requestAnimationFrame(loop)
}

/**
 * Initialize shader system.
 */
export function initShaders(viewer) {
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  loop()

  return {
    setMode(mode) {
      currentMode = mode
      // Update body class for CSS filter changes
      document.body.className = document.body.className
        .replace(/mode-\S+/g, '')
        .trim()
      if (mode !== 'normal') {
        document.body.classList.add(`mode-${mode}`)
      }
    },
    setGodMode(active) {
      godMode = active
    },
    destroy() {
      cancelAnimationFrame(animFrameId)
      window.removeEventListener('resize', resizeCanvas)
    },
  }
}
