import * as Cesium from 'cesium'

/**
 * Initialize the CesiumJS viewer with Google Photorealistic 3D Tiles.
 *
 * Google's Photorealistic 3D Tiles provide volumetric city models built from
 * aerial photogrammetry — millions of images stitched into navigable 3D geometry.
 * CesiumJS acts as the WebGL rendering engine on top of this data.
 *
 * @param {string} containerId - DOM element ID
 * @param {string} googleMapsKey - Google Maps API key (optional, uses demo if empty)
 * @returns {Cesium.Viewer}
 */
export async function initViewer(containerId, googleMapsKey) {
  // Cesium ion token — using anonymous access for globe base layer
  Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_TOKEN || ''

  const viewer = new Cesium.Viewer(containerId, {
    // Disable built-in UI widgets — we use our custom HUD
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

    // Use WebGL 2 for better shader support
    contextOptions: {
      webgl: { alpha: false, antialias: true }
    },

    // Terrain: Cesium World Terrain (SRTM elevation)
    terrain: Cesium.Terrain.fromWorldTerrain(),

    // Sky / atmosphere
    skyBox: false, // we'll use our own dark skybox
    skyAtmosphere: new Cesium.SkyAtmosphere(),
  })

  // Add Google Photorealistic 3D Tiles if key provided
  if (googleMapsKey) {
    try {
      const tileset = await Cesium.createGooglePhotorealistic3DTileset({
        key: googleMapsKey,
      })
      viewer.scene.primitives.add(tileset)
    } catch (e) {
      console.warn('Google 3D Tiles unavailable, using standard imagery:', e.message)
    }
  }

  // Use a dark base imagery when no 3D Tiles key
  if (!googleMapsKey) {
    viewer.imageryLayers.removeAll()
    viewer.imageryLayers.addImageryProvider(
      new Cesium.TileMapServiceImageryProvider({
        url: Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
        fileExtension: 'jpg',
      })
    )
  }

  // Start over Austin, TX (matches CCTV feed locations)
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 2_000_000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
    duration: 0,
  })

  // Enable depth-test against terrain so objects sit on the globe correctly
  viewer.scene.globe.depthTestAgainstTerrain = true

  // Post-processing support needed for shaders
  viewer.scene.postProcessStages.fxaa.enabled = true

  // Expose on window for debugging
  window._cesiumViewer = viewer

  return viewer
}
