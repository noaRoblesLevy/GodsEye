import * as Cesium from 'cesium'

/**
 * Initialize the CesiumJS viewer.
 *
 * Imagery: ArcGIS World Imagery (free, no auth, CORS-friendly satellite photos).
 * Terrain: flat EllipsoidTerrainProvider — no Cesium Ion token needed.
 * Google 3D Tiles: layered on top when VITE_GOOGLE_MAPS_KEY is set.
 */
export async function initViewer(containerId, googleMapsKey) {
  // Set Ion token only if configured; otherwise skip to avoid auth errors
  const cesiumToken = import.meta.env.VITE_CESIUM_TOKEN
  if (cesiumToken) Cesium.Ion.defaultAccessToken = cesiumToken

  // Build viewer with no imagery — we add it manually below
  const viewer = new Cesium.Viewer(containerId, {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,

    // Flat terrain — works with zero credentials
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),

    // Disable the default Ion/ArcGIS imagery layer
    imageryProvider: false,
  })

  // ── Imagery ────────────────────────────────────────────────────
  // ArcGIS World Imagery: free satellite photos, CORS-enabled, no key needed.
  // fromUrl() is the non-deprecated async constructor for Cesium 1.104+.
  try {
    const arcgis = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
      { enablePickFeatures: false }
    )
    const layer = viewer.imageryLayers.addImageryProvider(arcgis)
    // Dark tactical look without extra assets
    layer.brightness = 0.7
    layer.contrast = 1.1
    layer.saturation = 0.5
  } catch (e) {
    console.warn('[Viewer] ArcGIS imagery failed, globe will be blank:', e.message)
  }

  // ── Google Photorealistic 3D Tiles (optional) ─────────────────
  if (googleMapsKey) {
    try {
      const tileset = await Cesium.createGooglePhotorealistic3DTileset({ key: googleMapsKey })
      viewer.scene.primitives.add(tileset)
      viewer.scene.globe.show = false // 3D Tiles replace the globe
    } catch (e) {
      console.warn('[Viewer] Google 3D Tiles unavailable:', e.message)
    }
  }

  // ── Cesium World Terrain (optional, requires Ion token) ───────
  if (cesiumToken) {
    try {
      viewer.terrainProvider = await Cesium.createWorldTerrainAsync()
    } catch (e) {
      console.warn('[Viewer] World terrain unavailable:', e.message)
    }
  }

  // ── Opening camera: descend from high orbit down to spy-satellite altitude ──
  // Start position: 12,000 km above the US — Earth fills most of the view
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-95.0, 38.0, 12_000_000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
  })

  // After imagery loads, fly down to ~800 km spy-satellite altitude over Austin
  // giving the feeling of a surveillance satellite descending to its target
  setTimeout(() => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800_000),
      orientation: {
        heading: Cesium.Math.toRadians(10),
        pitch:   Cesium.Math.toRadians(-72),
        roll:    0,
      },
      duration: 4.5,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    })
  }, 800)

  viewer.scene.postProcessStages.fxaa.enabled = true
  window._cesiumViewer = viewer
  return viewer
}
