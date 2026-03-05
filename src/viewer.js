import * as Cesium from 'cesium'

export async function initViewer(containerId, googleMapsKey) {
  const cesiumToken = import.meta.env.VITE_CESIUM_TOKEN
  if (cesiumToken) Cesium.Ion.defaultAccessToken = cesiumToken

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
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    imageryProvider: false,
    // Render at native resolution — no MSAA overhead
    requestRenderMode: false,
  })

  // ArcGIS World Imagery — free, CORS-friendly satellite photos
  try {
    const arcgis = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
      { enablePickFeatures: false }
    )
    const layer = viewer.imageryLayers.addImageryProvider(arcgis)
    layer.brightness = 0.72
    layer.contrast   = 1.15
    layer.saturation = 0.45
  } catch (e) {
    console.warn('[Viewer] ArcGIS imagery failed:', e.message)
  }

  if (googleMapsKey) {
    try {
      const tileset = await Cesium.createGooglePhotorealistic3DTileset({ key: googleMapsKey })
      viewer.scene.primitives.add(tileset)
      viewer.scene.globe.show = false
    } catch (e) {
      console.warn('[Viewer] Google 3D Tiles unavailable:', e.message)
    }
  }

  if (cesiumToken) {
    try { viewer.terrainProvider = await Cesium.createWorldTerrainAsync() }
    catch (e) { console.warn('[Viewer] World terrain unavailable:', e.message) }
  }

  // ── Camera constraints ───────────────────────────────────────────────────
  const ctrl = viewer.scene.screenSpaceCameraController
  ctrl.minimumZoomDistance = 300_000    // never closer than 300 km
  ctrl.maximumZoomDistance = 25_000_000 // never further than 25,000 km
  // Keep camera from rolling sideways — feel like a satellite always facing down
  ctrl.enableRotate = true
  ctrl.enableTilt   = true
  ctrl.enableZoom   = true

  // Prevent entities from being occluded by terrain (we have none anyway)
  viewer.scene.globe.depthTestAgainstTerrain = false

  // ── Opening POV ──────────────────────────────────────────────────────────
  // Start directly above the US looking straight down (pure top-down satellite view)
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-97.0, 38.0, 14_000_000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
  })

  // Fly down to spy-satellite altitude: ~1200km, 10° tilt so horizon is visible
  setTimeout(() => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-97.7431, 32.0, 1_200_000),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-82),
        roll:  0,
      },
      duration: 4,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    })
  }, 600)

  window._cesiumViewer = viewer
  return viewer
}
