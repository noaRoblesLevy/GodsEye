import * as Cesium from 'cesium'

/**
 * Initialize the CesiumJS viewer.
 *
 * Works with zero API keys out of the box — uses OpenStreetMap imagery and
 * a flat ellipsoid terrain. Add keys in .env for photorealistic 3D Tiles and
 * SRTM elevation.
 *
 * @param {string} containerId - DOM element ID
 * @param {string} googleMapsKey - Google Maps API key (optional)
 * @returns {Cesium.Viewer}
 */
export async function initViewer(containerId, googleMapsKey) {
  const cesiumToken = import.meta.env.VITE_CESIUM_TOKEN || ''

  // Only set token if one is actually configured — avoids silent Ion auth errors
  if (cesiumToken) {
    Cesium.Ion.defaultAccessToken = cesiumToken
  } else {
    // Suppress the "no token" Ion warning — we're using non-Ion sources
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTQ0OS1kMWFjYmFkNjc5YzciLCJpZCI6NTc3MzMsImlhdCI6MTYyMjQ5NTk3NH0.XcKpgANiY19MC4bdFUXMVEBToBmqS8kuYpUlxJHYZxk'
  }

  // Terrain: use Cesium World Terrain only if token configured, else flat ellipsoid
  let terrainProvider
  if (cesiumToken) {
    terrainProvider = await Cesium.createWorldTerrainAsync()
  } else {
    terrainProvider = new Cesium.EllipsoidTerrainProvider()
  }

  // Base imagery: OpenStreetMap (no key, no Ion, always works)
  const osmImagery = new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
    maximumLevel: 18,
  })

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

    terrainProvider,
    imageryProvider: osmImagery,

    skyBox: false,
    skyAtmosphere: new Cesium.SkyAtmosphere(),
  })

  // Apply a dark tint to the OSM imagery so it reads as a tactical map
  const baseLayer = viewer.imageryLayers.get(0)
  baseLayer.brightness = 0.6
  baseLayer.contrast = 1.2
  baseLayer.hue = 0.55        // shift toward blue-grey
  baseLayer.saturation = 0.4

  // Add Google Photorealistic 3D Tiles on top if key provided
  if (googleMapsKey) {
    try {
      const tileset = await Cesium.createGooglePhotorealistic3DTileset({ key: googleMapsKey })
      viewer.scene.primitives.add(tileset)
      // 3D Tiles look better without the globe showing through
      viewer.scene.globe.show = false
    } catch (e) {
      console.warn('[Viewer] Google 3D Tiles unavailable:', e.message)
    }
  }

  // Start over Austin, TX — home of the CCTV feed locations
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 2_500_000),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-60),
      roll: 0,
    },
  })

  // Depth test against terrain keeps entities from floating/clipping
  viewer.scene.globe.depthTestAgainstTerrain = false // disable — causes black tiles without Ion terrain

  viewer.scene.postProcessStages.fxaa.enabled = true

  window._cesiumViewer = viewer
  return viewer
}
