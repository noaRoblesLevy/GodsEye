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

  // ── Camera constraints ────────────────────────────────────────────────────
  const ctrl = viewer.scene.screenSpaceCameraController
  ctrl.minimumZoomDistance = 200_000    // 200 km floor
  ctrl.maximumZoomDistance = 20_000_000 // 20,000 km ceiling

  viewer.scene.globe.depthTestAgainstTerrain = false

  // ── Static opening POV ────────────────────────────────────────────────────
  // No flyTo animation — animations during tile loading cause jitter and
  // conflict with user input. Just set a clean static spy-satellite view.
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-30.0, 30.0, 14_000_000),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
  })

  window._cesiumViewer = viewer
  return viewer
}
