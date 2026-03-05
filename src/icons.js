/**
 * SVG icon generators for each entity type.
 * All icons are returned as data: URLs so they work as Cesium billboard images
 * without any external asset loading.
 *
 * Coordinate convention: top of the SVG = North (heading 0°).
 * Aircraft icons are rotated in Cesium by the entity's true_track heading.
 */

function svgUrl(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

/** Classic satellite: rectangular body + blue solar panels + dish */
export function satelliteIcon(god = false) {
  const body  = god ? '#ff4444' : '#aaddff'
  const panel = god ? '#882222' : '#2255bb'
  const glow  = god ? '#ff0000' : '#00ffff'
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <!-- Left solar panel -->
    <rect x="1" y="13" width="11" height="10" rx="1" fill="${panel}" stroke="${glow}" stroke-width="0.8"/>
    <line x1="4"  y1="13" x2="4"  y2="23" stroke="${glow}" stroke-width="0.4" opacity="0.6"/>
    <line x1="7"  y1="13" x2="7"  y2="23" stroke="${glow}" stroke-width="0.4" opacity="0.6"/>
    <line x1="10" y1="13" x2="10" y2="23" stroke="${glow}" stroke-width="0.4" opacity="0.6"/>
    <!-- Right solar panel -->
    <rect x="24" y="13" width="11" height="10" rx="1" fill="${panel}" stroke="${glow}" stroke-width="0.8"/>
    <line x1="27" y1="13" x2="27" y2="23" stroke="${glow}" stroke-width="0.4" opacity="0.6"/>
    <line x1="30" y1="13" x2="30" y2="23" stroke="${glow}" stroke-width="0.4" opacity="0.6"/>
    <line x1="33" y1="13" x2="33" y2="23" stroke="${glow}" stroke-width="0.4" opacity="0.6"/>
    <!-- Body -->
    <rect x="13" y="10" width="10" height="16" rx="1.5" fill="${body}" stroke="${glow}" stroke-width="1"/>
    <!-- Body detail lines -->
    <line x1="13" y1="15" x2="23" y2="15" stroke="${glow}" stroke-width="0.4" opacity="0.4"/>
    <line x1="13" y1="18" x2="23" y2="18" stroke="${glow}" stroke-width="0.4" opacity="0.4"/>
    <line x1="13" y1="21" x2="23" y2="21" stroke="${glow}" stroke-width="0.4" opacity="0.4"/>
    <!-- Dish arm -->
    <line x1="18" y1="10" x2="18" y2="6" stroke="${glow}" stroke-width="1"/>
    <!-- Parabolic dish -->
    <path d="M14,6 Q18,2 22,6" fill="none" stroke="${glow}" stroke-width="1.2"/>
    <circle cx="18" cy="6" r="1" fill="${glow}"/>
  </svg>`)
}

/** Commercial airliner: top-down fuselage + swept wings + tail */
export function aircraftIcon(god = false) {
  const fill  = god ? '#ffaa00' : '#ffff88'
  const stroke = god ? '#ff4400' : '#ffcc00'
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <!-- Fuselage -->
    <ellipse cx="16" cy="16" rx="2.2" ry="12" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>
    <!-- Wings (swept back) -->
    <polygon points="16,12 3,22 5,23 16,16 27,23 29,22" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>
    <!-- Wing engine pods -->
    <ellipse cx="8"  cy="20" rx="1.5" ry="3" fill="${stroke}" opacity="0.8"/>
    <ellipse cx="24" cy="20" rx="1.5" ry="3" fill="${stroke}" opacity="0.8"/>
    <!-- Tail horizontal stabilisers -->
    <polygon points="16,26 10,30 11,30 16,27.5 21,30 22,30" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>
  </svg>`)
}

/** Military / fighter: delta-wing stealth silhouette */
export function militaryIcon(god = false) {
  const fill   = god ? '#ff2222' : '#ff6666'
  const stroke = god ? '#ff0000' : '#ff3333'
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <!-- Delta wing body -->
    <polygon points="16,3 19,22 16,26 13,22" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>
    <!-- Delta wings -->
    <polygon points="16,11 3,26 7,26 16,17 25,26 29,26" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>
    <!-- Forward canards -->
    <polygon points="16,11 11,15 13,15 16,12 19,15 21,15" fill="${stroke}"/>
    <!-- Nose -->
    <polygon points="15.5,3 16.5,3 17,6 15,6" fill="${stroke}"/>
  </svg>`)
}

/** CCTV camera: lens + housing + mount arm */
export function cctvIcon(god = false) {
  const fill   = god ? '#ff4444' : '#00ff41'
  const stroke = god ? '#ff0000' : '#00aa2a'
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
    <!-- Housing -->
    <rect x="3" y="9" width="14" height="10" rx="2" fill="rgba(0,0,0,0.7)" stroke="${fill}" stroke-width="1.2"/>
    <!-- Lens barrel -->
    <circle cx="14" cy="14" r="3.5" fill="rgba(0,0,0,0.8)" stroke="${fill}" stroke-width="1"/>
    <circle cx="14" cy="14" r="2"   fill="${fill}" opacity="0.4"/>
    <circle cx="14" cy="14" r="1"   fill="${fill}"/>
    <!-- Lens highlight -->
    <circle cx="13" cy="13" r="0.5" fill="white" opacity="0.6"/>
    <!-- Camera lens cone -->
    <polygon points="17,11 25,8 25,20 17,17" fill="${fill}" opacity="0.7" stroke="${stroke}" stroke-width="0.5"/>
    <!-- Mount -->
    <rect x="8" y="19" width="4" height="5" rx="1" fill="${stroke}"/>
    <!-- Record dot -->
    <circle cx="6" cy="12" r="1.5" fill="#ff0000" opacity="0.9"/>
  </svg>`)
}

/** Vehicle (top-down car silhouette) */
export function vehicleIcon() {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">
    <!-- Body -->
    <rect x="2" y="1" width="10" height="12" rx="2.5" fill="#ff6600" stroke="#ff8800" stroke-width="0.5"/>
    <!-- Windshield -->
    <rect x="3" y="2" width="8" height="4" rx="1" fill="#ff8800" opacity="0.5"/>
    <!-- Rear window -->
    <rect x="3" y="8" width="8" height="3" rx="1" fill="#ff8800" opacity="0.3"/>
    <!-- Wheels -->
    <rect x="1" y="2"  width="2" height="3" rx="0.8" fill="#333"/>
    <rect x="11" y="2"  width="2" height="3" rx="0.8" fill="#333"/>
    <rect x="1" y="9"  width="2" height="3" rx="0.8" fill="#333"/>
    <rect x="11" y="9"  width="2" height="3" rx="0.8" fill="#333"/>
  </svg>`)
}
