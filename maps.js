/* ============================================================================
   src/game/maps.js
   puppetfighter3D: map data (plus the shared floorSlabs / rampSpan helpers at the bottom).
   ALL numbers are original 2.5D units (SCALE = 0.025 is applied later by world.js / scene.js). x: west -> east, z: north (-) -> south (+),
   y: height above the floor (0 = floor).

   Conventions
   - boxes:   { x, z, hw, hd, h, c }  centre, half width / depth, height (base at y = 0)
   - pillars: { x, z, r, h, c }       round, tall, wall-runnable
   - holes:   { x, z, hw, hd }        floor holes, stand over one and you fall
   - ramps:   { x, z, hw, hd, y0, y1, dir }
              centre, half extents, surface height at the LOW edge (y0) and HIGH edge (y1).
              dir = direction of ASCENT: '+x' | '-x' | '+z' | '-z'. Height is linear along
              that axis, so a player can b-hop / slide up and down it.

   DISTRICT: "Grapple Cathedral", a 4400 x 3000 high-flow parkour chase arena. The whole map is 180-degree rotation symmetric
   (every piece has a twin at (-x, -z)), so no spawn or lane is better than another. Zones:
   1. Wall-run gauntlets (north + south lanes): staggered 24-thick, 220-tall panels in two rows 320 apart (faces 296 apart), each panel
      overlapping the next one's start, so  wall-run -> wall-kick across -> opposite wall-run -> ...  chains all along the edge.
   2. Grapple Cathedral (centre): a 760 x 500 skylight pit crossed by two 140-high skybridges (110 wide) and ringed by four grapple towers
      (340-380 high): huge slingshot swings across the middle.
   3. East / West: the bridge lands on a 140 deck whose 17-degree ramps drop to the ground (downhill slide -> b-hop), plus 70 decks
      with 15-degree ramps on both sides, and 40-high kickers to launch off.
   4. Corner pillars (r 30, h 260) for curved swings; every spawn is on open floor, 200+ units clear of everything.
   Zero dead ends: every ledge has a ramp or an open side, nothing is enclosed.
   ============================================================================ */

var T2 = [94, 102, 116], T3 = [116, 124, 138], BG = [170, 134, 48],
    GRN = [60, 122, 86], ORG = [204, 132, 52], WHT = [205, 205, 210], RUST = [200, 120, 60];

function box(x, z, hw, hd, h, c) { return { x: x, z: z, hw: hw, hd: hd, h: h, c: c }; }
function pillar(x, z, h, c) { return { x: x, z: z, r: 30, h: h, c: c }; }
function deg(a) { return a * Math.PI / 180; }

// A ramp that climbs to `y1` and meets a vertical face at `face` (world coordinate along the ascent axis) at slope `angle` degrees.
// dir = ascent direction; across = centre on the other axis; half = half width across the ramp.
function rampTo(dir, face, across, half, y1, angle) {
  var len = Math.round(y1 / Math.tan(deg(angle))), sign = dir.charAt(0) === '+' ? 1 : -1, c = face - sign * len / 2;
  return dir.charAt(1) === 'x'
    ? { x: c, z: across, hw: len / 2, hd: half, y0: 0, y1: y1, dir: dir }
    : { x: across, z: c, hw: half, hd: len / 2, y0: 0, y1: y1, dir: dir };
}
var FLIP = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };
function twin(o) {                                   // the 180-degree rotated copy of any box / pillar / hole / ramp
  var t = {}; for (var k in o) t[k] = o[k];
  t.x = -o.x; t.z = -o.z; if (o.dir) t.dir = FLIP[o.dir];
  return t;
}
function withTwins(list) { return list.concat(list.map(twin)); }

// ---- 1. gauntlet panels, north lane (the south lane is the rotated twin). Rows z = -1330 (A) and -1010 (B), 320 apart.
function panel(x0, x1, z, c) { return box((x0 + x1) / 2, z, (x1 - x0) / 2, 12, 220, c); }
var GAUNTLET = [
  panel(-1950, -1150, -1330, GRN),   // A1  800
  panel(-1500,  -700, -1010, ORG),   // B1  800
  panel(-1000,  -100, -1330, GRN),   // A2  900
  panel( -450,   300, -1010, ORG),   // B2  750
  panel(  150,   800, -1330, GRN),   // A3  650
  panel(  550,  1350, -1010, ORG),   // B3  800
  panel( 1100,  1950, -1330, GRN)    // A4  850
];

// ---- 3. east / west half (the west half is the twin). Deck 140 at the bridge end, 70 decks NE + SE.
var D140 = box(740, 0, 180, 220, 140, T3);
var D70N = box(1500, -520, 180, 150, 70, T2), D70S = box(1500, 520, 180, 150, 70, T2);
var SIDE = [D140, D70N, D70S];
var SIDE_RAMPS = [
  rampTo('-x', 920, 0, 200, 140, 17),                 // deck 140 -> east ground, wide downhill slide run
  rampTo('+z', -220, 740, 180, 140, 17),              // north ground -> deck 140
  rampTo('-z', 220, 740, 180, 140, 17),               // south ground -> deck 140
  rampTo('+x', 1320, -520, 150, 70, 15),              // NE deck 70, west side
  rampTo('-x', 1680, -520, 150, 70, 15),              // NE deck 70, east side
  rampTo('+x', 1320, 520, 150, 70, 15),               // SE deck 70, west side
  rampTo('-x', 1680, 520, 150, 70, 15),               // SE deck 70, east side
  rampTo('+x', 1620, 0, 150, 40, 16)                  // kicker: the downhill run flows straight into it and launches off its high edge
];

// ---- 2. cathedral (self-symmetric pieces + twins of the towers / N-S ramps)
var CATH_BOXES = [
  box(0, 0, 560, 55, 140, BG),                        // skybridge east-west, lands on the two 140 decks
  box(0, 0, 55, 400, 140, BG)                         // skybridge north-south, fed by a ramp at each end
];
var TOWERS = [box(-470, -400, 45, 45, 340, WHT), box(470, -400, 45, 45, 380, WHT)];   // + twins: (470, 400) h 340, (-470, 400) h 380

// 3 spawns + their rotated twins, all on open floor (y = 0), 200+ clear of every box / ramp / pillar / hole / edge (checked in Node, see ARCHITECTURE.md).
var spawnList = [
  { x: -1900, y: 0, z: -100 },    // west plain
  { x: 1900, y: 0, z: 100 },      // east plain
  { x: -300, y: 0, z: -700 },     // north of the cathedral, between the gauntlet and the N-S ramp
  { x: 300, y: 0, z: 700 },       // south of the cathedral
  { x: 1700, y: 0, z: -1000 },    // north-east, inside the gauntlet's end
  { x: -1700, y: 0, z: 1000 }     // south-west, inside the gauntlet's end
];
export var DISTRICT_MAP = {
  name: 'District',
  rect: { hw: 2200, hd: 1500, lip: 14 },
  spawns: spawnList,
  pillars: [], boxes: [], holes: [], ramps: []
};
DISTRICT_MAP.boxes = withTwins(GAUNTLET.concat(SIDE, TOWERS)).concat(CATH_BOXES);
DISTRICT_MAP.ramps = withTwins(SIDE_RAMPS.concat([rampTo('+z', -400, 0, 55, 140, 17)]));   // last one: north end of the N-S bridge (twin = south end)
DISTRICT_MAP.holes = [{ x: 0, z: 0, hw: 380, hd: 250 }];
DISTRICT_MAP.pillars = withTwins([
  pillar(2020, -1150, 260, WHT),                      // NE corner turn (twin SW)
  pillar(-2020, -1150, 260, RUST),                    // NW corner turn (twin SE)
  pillar(1850, -170, 260, RUST)                       // east plain, between the downhill run and the edge (twin west)
]);

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
