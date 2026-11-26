/* ============================================================================
   src/game/maps.js
   puppetfighter3D: map data (plus the shared floorSlabs / rampSpan helpers at the bottom).
   ALL numbers are original 2.5D units (SCALE = 0.025 is applied later by world.js / scene.js). x: west -> east, z: north (-) -> south (+),
   y: height above the floor (0 = floor).

   Conventions
   - boxes:   { x, z, hw, hd, h, c }  centre, half width / depth, height (base at y = 0)
   - pillars: { x, z, r, h, c }       round, grab-able (orbit, release to fling)
   - holes:   { x, z, hw, hd }        floor holes, stand over one and you fall
   - ramps:   { x, z, hw, hd, y0, y1, dir }
              centre, half extents, surface height at the LOW edge (y0) and HIGH edge (y1).
              dir = direction of ASCENT: '+x' | '-x' | '+z' | '-z'. Height is linear along
              that axis, so a player can b-hop / slide up and down it.
   ============================================================================ */

var BR = [128, 88, 74], T1 = [76, 86, 100], T2 = [94, 102, 116], T3 = [116, 124, 138],
    BG = [170, 134, 48], DK = [96, 102, 112], P = [98, 106, 118], W = [148, 112, 72],
    RED = [168, 62, 50], BLU = [52, 96, 150], GRN = [60, 122, 86], ORG = [204, 132, 52],
    CORE = [112, 118, 128], STEP = [138, 144, 152], RAMP = [182, 168, 120],
    WHT = [205, 205, 210], RUST = [200, 120, 60];

function box(x, z, hw, hd, h, c) { return { x: x, z: z, hw: hw, hd: hd, h: h, c: c }; }
function pillar(x, z, h, c) { return { x: x, z: z, r: 26, h: h, c: c }; }

export var DISTRICT_MAP = {
  name: 'District',
  rect: { hw: 2100, hd: 1350, lip: 14 },

  // P1 west lane, P2 east lane, then maze court, swing yard, north-east ground, docks. All y = 0.
  spawns: [
    { x: -1480, y: 0, z: 130 },
    { x: 1480, y: 0, z: -120 },
    { x: -950, y: 0, z: -650 },
    { x: -1500, y: 0, z: 1050 },
    { x: 400, y: 0, z: -1120 },
    { x: 1450, y: 0, z: 1080 }
  ],

  pillars: [
    // NW maze plaza
    pillar(-1500, -480, 190, WHT),
    // NE: fling-jump onto the scaffolds / across the pit
    pillar(700, -1100, 195, RUST),
    pillar(1200, -1060, 185, RUST),
    // SW swing yard: spider-web cluster of 7, nearest neighbours ~290-310 apart
    pillar(-1600, 540, 185, WHT),
    pillar(-1330, 690, 195, WHT),
    pillar(-1060, 540, 185, WHT),
    pillar(-1100, 880, 195, RUST),
    pillar(-1640, 830, 190, RUST),
    pillar(-1180, 270, 190, RUST),
    pillar(-820, 380, 185, WHT),
    // SE docks crane mast
    pillar(1650, 900, 200, RUST),
    // central hub, flanking the core
    pillar(-400, -60, 180, WHT),
    pillar(390, 30, 180, WHT)
  ],

  boxes: [
    // ---- NORTH-WEST, Maze Alley: h175 brick, 100-wide alleys, L-corners, T-junctions
    box(-1700, -1150, 200, 50, 175, BR),   // L arm
    box(-1550, -975, 50, 125, 175, BR),    // L stem
    box(-1250, -1100, 150, 100, 175, BR),  // block
    box(-850, -1130, 150, 70, 175, BR),    // block
    box(-560, -1050, 60, 150, 175, BR),    // tall block on the avenue
    box(-1800, -850, 100, 150, 175, BR),   // west block
    box(-1250, -850, 150, 50, 175, BR),    // T bar
    box(-1250, -700, 50, 100, 175, BR),    // T stem
    box(-560, -660, 60, 120, 175, BR),     // east block
    box(-1775, -400, 125, 100, 175, BR),   // plaza-side block
    box(-1100, -375, 150, 75, 175, BR),    // south block
    box(-710, -400, 90, 50, 175, BR),      // stub (L with the east block)

    // ---- NORTH-EAST, Multi-Tier Scaffolding: 36 -> 76 -> 116, skybridges (116, 44 wide) over the pit
    box(570, -700, 140, 200, 36, T1),      // W1 tier 1
    box(780, -700, 70, 160, 76, T2),       // W2 tier 2
    box(925, -700, 75, 120, 116, T3),      // W3 tier 3, beside the pit
    box(1240, -700, 240, 22, 116, BG),     // skybridge A across the pit
    box(1560, -700, 80, 120, 116, T3),     // E3 tier 3
    box(1710, -680, 70, 140, 76, T2),      // E2 tier 2
    box(1880, -700, 100, 200, 36, T1),     // E1 tier 1
    box(1560, -910, 22, 90, 116, BG),      // skybridge B north to the tower deck
    box(1560, -1070, 120, 70, 116, T3),    // N3 tier 3
    box(1750, -1070, 70, 70, 76, T2),      // N2 tier 2
    box(1900, -1070, 80, 70, 36, T1),      // N1 tier 1

    // ---- SOUTH-WEST, Swing Yard: open court, one flank tower, low cover
    box(-760, 760, 90, 90, 175, DK),       // flank tower
    box(-1810, 314, 90, 14, 26, P),        // low cover wall

    // ---- SOUTH-EAST, Crate Docks: containers 95, step crates 48, walls 95
    box(560, 380, 140, 50, 95, RED),       // container (red), ramp-fed from the west
    box(740, 370, 40, 40, 48, W),          // crate step
    box(700, 610, 140, 50, 95, BLU),       // container (blue)
    box(880, 620, 40, 40, 48, W),          // crate step
    box(1130, 448, 130, 48, 48, GRN),      // mid container (green)
    box(1300, 460, 40, 40, 48, W),         // crate step
    box(1380, 460, 40, 40, 95, W),         // crate stack top
    box(1130, 748, 130, 48, 95, ORG),      // container (orange)
    box(1300, 750, 40, 40, 48, W),         // crate step
    box(520, 860, 100, 14, 95, P),         // tall wall
    box(1474, 660, 14, 100, 95, P),        // tall wall

    // ---- CENTRAL HUB: stepped core 50 -> 100
    box(0, 0, 120, 80, 100, CORE),         // core
    box(-170, 0, 50, 60, 50, STEP),        // step W
    box(10, -115, 70, 35, 50, STEP),       // step N
    box(175, 20, 55, 50, 50, STEP),        // step E
    box(230, 200, 40, 40, 50, W),          // crate
    box(-260, 144, 80, 14, 95, P)          // tall wall
  ],

  holes: [
    { x: 1200, z: -700, hw: 200, hd: 130 },  // NE pit under skybridge A
    { x: 60, z: -330, hw: 110, hd: 60 },     // hub skylight, north of the core
    { x: -70, z: 300, hw: 90, hd: 60 }       // hub skylight, south of the core
  ],

  ramps: [
    // NE: ground -> tier 1 (36), climbs east into the west face of W1 (x = 430). Slope ~14 deg.
    { x: 360, z: -700, hw: 70, hd: 100, y0: 0, y1: 36, dir: '+x' },
    // NE: tier 1 (36) -> tier 2 (76), sits on top of W1 and climbs east into W2 (x = 710). Slope ~20 deg.
    { x: 655, z: -700, hw: 55, hd: 100, y0: 36, y1: 76, dir: '+x' },
    // SE docks: ground -> red container deck (95), climbs east into its west face (x = 420). Slope ~21 deg.
    { x: 295, z: 380, hw: 125, hd: 50, y0: 0, y1: 95, dir: '+x' }
  ]
};

/* ----------------------------------------------------------------------------
   Shared geometry helpers. world.js (colliders) and scene.js (meshes) BOTH build from these, so what you see
   is always what you collide with. Everything here is still in old 2.5D units.
   ---------------------------------------------------------------------------- */

// The rooftop floor = the rect minus the skylight holes, as non-overlapping { x, z, hw, hd } slabs (top face at y = 0).
// Sweep: cut the rect into vertical strips at every hole's west / east edge; inside a strip each hole either spans the whole
// strip or misses it, so the strip is just cut at the spans of the holes that cover it.
export function floorSlabs(map) {
  var hw = map.rect.hw, hd = map.rect.hd, holes = map.holes || [], EPS = 1e-6;
  var xs = [-hw, hw];
  holes.forEach(function (h) { xs.push(h.x - h.hw, h.x + h.hw); });
  xs.sort(function (a, b) { return a - b; });
  function slab(xa, xb, za, zb) { return { x: (xa + xb) / 2, z: (za + zb) / 2, hw: (xb - xa) / 2, hd: (zb - za) / 2 }; }
  var out = [];
  for (var i = 0; i < xs.length - 1; i++) {
    var xa = xs[i], xb = xs[i + 1];
    if (xb - xa < EPS) continue;
    var cover = holes.filter(function (h) { return h.x - h.hw <= xa + EPS && h.x + h.hw >= xb - EPS; })
                     .sort(function (a, b) { return a.z - b.z; });
    var z = -hd;
    cover.forEach(function (h) {
      var za = h.z - h.hd, zb = h.z + h.hd;
      if (za - z > EPS) out.push(slab(xa, xb, z, za));
      z = Math.max(z, zb);
    });
    if (hd - z > EPS) out.push(slab(xa, xb, z, hd));
  }
  return out;
}

// A ramp as a SOLID wedge. Height is linear along the ascent axis: y0 at the low edge, y1 at the high edge.
// Returns { alongX, sign, lo, hi, across, w, y0, y1, cx, cz, len, wid, rotY }:
//   lo / hi = world coordinate of the low / high edge along the ascent axis, across = centre coordinate on the other axis,
//   w = half width across, len / wid = full length / width, rotY = Three.js Y rotation that turns local +x into the ascent direction.
export function rampSpan(r) {
  var alongX = r.dir === '+x' || r.dir === '-x';
  var sign = r.dir.charAt(0) === '+' ? 1 : -1;
  var half = alongX ? r.hw : r.hd, centre = alongX ? r.x : r.z;
  return {
    alongX: alongX, sign: sign,
    lo: centre - sign * half, hi: centre + sign * half,
    across: alongX ? r.z : r.x, w: alongX ? r.hd : r.hw,
    y0: r.y0, y1: r.y1, cx: r.x, cz: r.z,
    len: half * 2, wid: (alongX ? r.hd : r.hw) * 2,
    rotY: { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 }[r.dir]
  };
}

export default DISTRICT_MAP;
