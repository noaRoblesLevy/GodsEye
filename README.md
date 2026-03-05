# God's Eye — Spatial Intelligence Simulator

A browser-based spy satellite simulator inspired by [WorldView by Bilawal Sidhu](https://www.spatialintelligence.ai/p/i-built-a-spy-satellite-simulator). Built with CesiumJS, real-time public data APIs, and custom post-processing shaders.

> "It stops feeling like a demo. It starts feeling magical." — Bilawal Sidhu

## What It Does

God's Eye fuses multiple live public data streams onto a photorealistic 3D globe:

| Layer | Source | Description |
|-------|--------|-------------|
| **3D World** | Google Photorealistic 3D Tiles | Volumetric city models from aerial photogrammetry |
| **Satellites** | CelesTrak TLE + SGP4 | 180+ real satellites tracked in true orbital paths |
| **Aircraft** | OpenSky Network | 7,000+ live ADS-B transponder positions |
| **Vehicles** | OpenStreetMap (simulated) | Traffic flow particle system on street grid |
| **CCTV** | Austin TX public cameras | Real traffic camera feeds geo-located in 3D |

## Vision Modes

Switch between intelligence analyst display modes:

- **NORMAL** — standard CesiumJS rendering
- **NVG** — Night Vision Goggles: green phosphor + film grain + tube vignette
- **FLIR** — Forward-Looking Infrared thermal palette + heat scale legend
- **CRT** — CRT monitor: scanlines + flicker + barrel vignette + timestamp burn-in
- **ANIME** — Studio Ghibli cel-shading: high saturation + warm vignette

## God Mode

Activates **PANOPTIC MODE** — all entities become highlighted with targeting overlays, labels appear on every satellite and aircraft, and a red detection border frames the scene.

## Architecture

```
src/
├── main.js       — entry point, wires all modules
├── viewer.js     — CesiumJS viewer + Google 3D Tiles initialization
├── satellites.js — CelesTrak TLE fetch → SGP4 propagation → Cesium entities
├── aircraft.js   — OpenSky Network REST API → live aircraft positions
├── cctv.js       — Austin traffic camera feeds → billboards + plane projections
├── shaders.js    — Canvas2D post-processing: NVG, FLIR, CRT, Anime
├── hud.js        — DOM controls: vision modes, layer toggles, info panel, stats
└── style.css     — Military HUD aesthetic (green-on-black, monospace, glow)
```

## Setup

```bash
git clone https://github.com/noaRoblesLevy/GodsEye.git
cd GodsEye
npm install
cp .env.example .env
# Edit .env with your API keys (see below)
npm run dev
```

Open `http://localhost:3000`

## API Keys

### Google Maps (Photorealistic 3D Tiles) — optional but recommended
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Map Tiles API**
3. Create an API key → paste into `VITE_GOOGLE_MAPS_KEY`

Without this key the app falls back to NASA Blue Marble imagery — still fully functional.

### Cesium Ion (World Terrain) — free tier
1. Sign up at [ion.cesium.com](https://ion.cesium.com/)
2. Copy your default access token → paste into `VITE_CESIUM_TOKEN`

### OpenSky Network — no key needed
Anonymous access provides ~10 second refresh rate. [Register](https://opensky-network.org/) for higher rate limits.

## Data Sources

- **CelesTrak** — `celestrak.org/pub/TLE/active.tle` — public domain orbital data
- **OpenSky Network** — `opensky-network.org/api/states/all` — community ADS-B network
- **Austin Traffic Cameras** — `cctv.austinmobility.io` — City of Austin open data
- **Google Photorealistic 3D Tiles** — [Tile Map Service API](https://developers.google.com/maps/documentation/tile)

## Tech Stack

- **[CesiumJS](https://cesium.com/platform/cesiumjs/)** — WebGL globe rendering engine
- **[satellite.js](https://github.com/shashwatak/satellite-js)** — SGP4 orbital mechanics
- **[Vite](https://vite.dev)** — build tool + dev server
- **[vite-plugin-cesium](https://github.com/nshen/vite-plugin-cesium)** — handles Cesium's static asset bundling

## Inspiration

Built as a faithful recreation of [WorldView](https://www.spatialintelligence.ai/p/i-built-a-spy-satellite-simulator) by Bilawal Sidhu (ex-Google Maps PM), demonstrating that military-grade surveillance aesthetics can be assembled entirely from public data streams.

The key insight: **the data was never the moat. The accessibility is.**
