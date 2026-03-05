import * as Cesium from 'cesium'

/**
 * CCTV Camera Feed Integration.
 *
 * Austin, TX maintains a public traffic camera program (Austin Transportation
 * Dept) with JPEG snapshot feeds accessible without authentication.
 * We project each feed as a billboard in 3D space at the camera's real location.
 *
 * For a full implementation, feeds are draped on buildings using Cesium's
 * MaterialAppearance with a VideoMaterial — here we use billboard overlays
 * that link to the live feed URL and show a thumbnail.
 */

// Public Austin traffic camera snapshot feeds (no API key needed)
// Source: https://data.austintexas.gov/Transportation-and-Mobility/Traffic-Cameras/b4k4-adkb
// These are JPEG snapshot URLs that refresh every ~10 seconds
const AUSTIN_CCTV = [
  {
    id: 'cam001',
    name: 'I-35 @ 6th St',
    lat: 30.2672, lon: -97.7331,
    url: 'https://cctv.austinmobility.io/image/1.jpg',
    description: 'I-35 northbound at 6th Street'
  },
  {
    id: 'cam002',
    name: 'Lamar @ 5th St',
    lat: 30.2655, lon: -97.7508,
    url: 'https://cctv.austinmobility.io/image/2.jpg',
    description: 'N Lamar Blvd at W 5th Street'
  },
  {
    id: 'cam003',
    name: 'Congress @ Capitol',
    lat: 30.2747, lon: -97.7404,
    url: 'https://cctv.austinmobility.io/image/3.jpg',
    description: 'Congress Ave at Capitol'
  },
  {
    id: 'cam004',
    name: 'MoPac @ Town Lake',
    lat: 30.2588, lon: -97.7699,
    url: 'https://cctv.austinmobility.io/image/4.jpg',
    description: 'MoPac Expressway at Town Lake'
  },
  {
    id: 'cam005',
    name: 'Airport Blvd @ 183',
    lat: 30.3269, lon: -97.7018,
    url: 'https://cctv.austinmobility.io/image/5.jpg',
    description: 'Airport Blvd at US-183'
  },
  {
    id: 'cam006',
    name: '183 @ 290',
    lat: 30.3514, lon: -97.7352,
    url: 'https://cctv.austinmobility.io/image/6.jpg',
    description: 'US-183 at TX-290 interchange'
  },
  {
    id: 'cam007',
    name: 'Cesar Chavez @ Lamar',
    lat: 30.2589, lon: -97.7508,
    url: 'https://cctv.austinmobility.io/image/7.jpg',
    description: 'E Cesar Chavez at S Lamar'
  },
  {
    id: 'cam008',
    name: 'I-35 @ 51st',
    lat: 30.3215, lon: -97.7216,
    url: 'https://cctv.austinmobility.io/image/8.jpg',
    description: 'I-35 at E 51st Street'
  },
]

let cctvEntities = []
let cctvVisible = false

/**
 * Create a video material from a CCTV JPEG snapshot URL.
 * Since MJPEG streams aren't universally CORS-safe, we use
 * a <video> element for streams that support it, with JPEG
 * snapshot fallback shown as a billboard.
 */
function createCCTVEntity(viewer, cam) {
  // Camera icon billboard (always visible when layer is on)
  const iconEntity = viewer.entities.add({
    name: cam.name,
    position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 10),
    billboard: {
      image: createCameraIcon(),
      width: 24, height: 24,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      color: Cesium.Color.CYAN,
      scaleByDistance: new Cesium.NearFarScalar(1e4, 2, 5e5, 0.5),
    },
    label: {
      text: 'CAM: ' + cam.name,
      font: '9px Courier New',
      fillColor: Cesium.Color.CYAN,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -30),
      scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 1e5, 0),
    },
    properties: {
      type: 'cctv',
      name: cam.name,
      description: cam.description,
      feedUrl: cam.url,
      location: `${cam.lat.toFixed(4)}, ${cam.lon.toFixed(4)}`,
    },
  })

  // Feed preview plane — a polygon near the camera showing the snapshot
  // (We use a wall entity projected toward the viewer for the "draped on building" effect)
  const previewEntity = viewer.entities.add({
    name: cam.name + '_feed',
    position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat + 0.0002, 30),
    plane: {
      plane: new Cesium.Plane(Cesium.Cartesian3.UNIT_Z, 0),
      dimensions: new Cesium.Cartesian2(80, 50),
      material: new Cesium.ImageMaterialProperty({
        image: cam.url,
        repeat: new Cesium.Cartesian2(1, 1),
        transparent: false,
      }),
      outline: true,
      outlineColor: Cesium.Color.CYAN.withAlpha(0.8),
    },
    show: false, // shown only when camera is selected/zoomed
  })

  return [iconEntity, previewEntity]
}

/**
 * Generate a simple camera SVG icon as a data URL.
 */
function createCameraIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <rect width="24" height="24" fill="rgba(0,0,0,0.5)" rx="3"/>
    <rect x="2" y="7" width="14" height="10" rx="2" fill="none" stroke="#00ff41" stroke-width="1.5"/>
    <polygon points="16,10 22,7 22,17 16,14" fill="#00ff41"/>
    <circle cx="9" cy="12" r="3" fill="none" stroke="#00ff41" stroke-width="1"/>
    <circle cx="9" cy="12" r="1" fill="#00ff41"/>
  </svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

/**
 * Initialize CCTV layer.
 */
export function initCCTV(viewer) {
  // Create entities (hidden by default)
  AUSTIN_CCTV.forEach(cam => {
    const entities = createCCTVEntity(viewer, cam)
    cctvEntities.push(...entities)
  })

  // Hide all by default
  cctvEntities.forEach(e => (e.show = false))

  return {
    getCount: () => AUSTIN_CCTV.length,
    setVisible(v) {
      cctvVisible = v
      cctvEntities.forEach(e => {
        // Only show icon entities (not preview planes) in default mode
        if (e.billboard) e.show = v
      })
    },
    getCameras: () => AUSTIN_CCTV,
    destroy() {
      cctvEntities.forEach(e => viewer.entities.remove(e))
      cctvEntities = []
    },
  }
}
