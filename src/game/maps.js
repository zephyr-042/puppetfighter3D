/* ============================================================================
   src/game/maps.js
   puppetfighter3D: map data (DISTRICT_MAP) plus the shared boxSpan / floorSlabs / rampSpan helpers and validateMap() at the bottom.
   ALL numbers are original 2.5D units (SCALE = 0.025 is applied later by world.js / scene.js). x: west -> east, z: north (-) -> south (+),
   y: height above the floor (0 = floor).

   Conventions
   - boxes:   { x, z, hw, hd, h, c, y0? }  centre, half width / depth, TOP height h and optional BOTTOM height y0 (default 0).
              y0 > 0 = a true floating box (skybridge, catwalk, billboard): players slide under it, grapple over it, wall-run along it.
              Vertical centre = (y0 + h) / 2, full height = h - y0. Use boxSpan(b) so world.js and scene.js agree.
   - pillars: { x, z, r, h, c }       round, grab-able (orbit, release to fling)
   - holes:   { x, z, hw, hd }        floor holes, stand over one and you fall
   - ramps:   { x, z, hw, hd, y0, y1, dir, base?, c? }
              centre, half extents, surface height at the LOW edge (y0) and HIGH edge (y1). NOTE: ramp y0 is a SURFACE height,
              it is not the box y0. `base` (default 0) is the height of the solid wedge's underside.
              dir = direction of ASCENT: '+x' | '-x' | '+z' | '-z'. Height is linear along that axis.
              `c` (optional, [r, g, b]) is the ramp's palette colour; physics ignores it, scene.js uses it for the material and, for C.SPEED ramps, the gold chevrons.
   - c: [r, g, b] 0..255 (the hex() helper converts 0xRRGGBB, so the palette below reads like web colours). The palette is also exported as PALETTE so scene.js can
     recognise a piece by reference (b.c === PALETTE.WALL) and attach its painted accent bands without any extra fields in the map data.

   DISTRICT_MAP (this file) is a bright, sunlit COMBAT-PARKOUR ARENA built for sword duels, 4600 x 3200 (hw 2300, hd 1600), point-symmetric (x, z) -> (-x, -z).
   Everything of substance lives inside |x| <= 1850, |z| <= 1190; the ring outside that is an open runout avenue (spawns, a clear view over the edge).
     centre  : DUEL SANCTUARY, a wide raised platform (hw 460, hd 340, h70) reached by 4 gentle ramps (0 -> 70, 14 degrees): two on the E / W ends, two offset on the N / S sides.
               Two skylight RING-OUT PITS (hw 320, hd 160) flank it, offset diagonally (480, -560) and (-480, 560): an uppercut or a heavy slash knocks a duellist straight
               into one. Above the platform: two floating titanium skybridges (y0 155 .. 175) and two floating coral wall-run billboards (y0 195 .. 375), open air above and
               below, so a grapple to the roof line ends in a Dive Slam onto the duel.
     N / S   : 6 long cobalt wall-run panels (850 long, 22 thick, 240 high), two lanes 380 apart face to face. North chain (flows east -> west): W1 (inner lane) -> W2 (outer lane)
               -> W3 (inner lane) -> saffron launch pad (h118) -> 15 degree downhill speed ramp aimed back at the centre arena, so you arrive at the duel carrying lethal speed.
               The south chain is the point-symmetric twin (it flows west -> east).
     E / W   : open avenues with four low limestone cover blocks and the access ramps of the sanctuary.
     corners : 4 h420 slate grapple spires with saffron caps and teal bands, 4 r40 h300 swing pillars. Grapple lines run spire -> centre roof line.
     No clutter within 400-600 units of any zone, so nothing gets clipped at 760 units / s.
   ============================================================================ */

function hex(n) { return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

var C = {
  DECK:   hex(0x5c6b7a),   // central duel platform: cool architectural slate
  COVER:  hex(0xd8dee6),   // low cover + sanctuary access ramps: clean light limestone / concrete
  BRIDGE: hex(0xeef2f6),   // central skybridges: crisp titanium white
  BILL:   hex(0xe85d3f),   // aerial wall-run billboards: warm coral-terracotta (scene.js adds a clean white face panel)
  WALL:   hex(0x2563eb),   // wall-run panels: vibrant architectural cobalt (scene.js adds white / deep-cobalt painted stripes)
  PAD:    hex(0xf59e0b),   // launch pads at the end of each wall chain: rich true saffron gold
  SPEED:  hex(0xf59e0b),   // downhill speed ramps + spire caps: the same saffron (scene.js paints gold chevrons on the ramps)
  TOWER:  hex(0x334155),   // grapple spire shafts: deep slate-charcoal (scene.js adds teal 0x14b8a6 bands)
  PILLAR: hex(0x334155)    // round swing pillars: deep slate-charcoal (teal bands)
};
export var PALETTE = C;    // scene.js matches pieces to accents by reference (b.c === PALETTE.WALL), so keep one array per colour

// box(x, z, hw, hd, h, c [, y0]): y0 is stored only when it is above the floor, so legacy boxes stay { x, z, hw, hd, h, c }.
function box(x, z, hw, hd, h, c, y0) {
  var b = { x: x, z: z, hw: hw, hd: hd, h: h, c: c };
  if (y0) b.y0 = y0;
  return b;
}
function pillar(x, z, h, c, r) { return { x: x, z: z, r: r || 26, h: h, c: c }; }

var boxes = [], pillars = [], ramps = [];
function addBox(x, z, hw, hd, h, c, y0) { boxes.push(box(x, z, hw, hd, h, c, y0)); }
// Point symmetry: every piece also gets its twin at (-x, -z). Footprints are symmetric under a 180 degree turn.
function addBoxSym(x, z, hw, hd, h, c, y0) { addBox(x, z, hw, hd, h, c, y0); addBox(-x, -z, hw, hd, h, c, y0); }
function addPillarSym(x, z, h, c, r) { pillars.push(pillar(x, z, h, c, r)); pillars.push(pillar(-x, -z, h, c, r)); }
var OPP = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };
function addRampSym(x, z, hw, hd, y0, y1, dir, c) {
  var a = { x: x, z: z, hw: hw, hd: hd, y0: y0, y1: y1, dir: dir };
  var b = { x: -x, z: -z, hw: hw, hd: hd, y0: y0, y1: y1, dir: OPP[dir] };
  if (c) { a.c = c; b.c = c; }                     // optional palette colour (visual only; world.js does not read it)
  ramps.push(a); ramps.push(b);
}

/* ---- CENTRE: the duel sanctuary (raised platform + 4 gentle access ramps), two ring-out pits, floating skybridges + billboards ---- */
boxes.push(box(0, 0, 460, 340, 70, C.DECK));                          // the duel platform, x -460 .. 460, z -340 .. 340, top at 70 (point-symmetric on its own)
addRampSym(600, 0, 140, 300, 0, 70, '-x', C.COVER);                   // E ramp (W is the twin): 280 long, 0 -> 70 (14 degrees), 600 wide, ascends toward the platform
addRampSym(-220, -480, 220, 140, 0, 70, '+z', C.COVER);               // N ramp (S is the twin): 440 wide, offset west of the pit, ascends south onto the platform

// Skybridges: 140 deep, underside 155 (85 clear over the platform: slide / walk under), top 175. Billboards: 24 thick, float 195 .. 375 over the bridges.
addBoxSym(0, -190, 700, 70, 175, C.BRIDGE, 155);                      // skybridge N (S is the twin)
addBoxSym(0, -190, 560, 12, 375, C.BILL, 195);                        // billboard N (S is the twin)

/* ---- NORTH + SOUTH wall-run chains (north built, south is the point-symmetric twin that runs the other way round) ----
   Two lanes, z = -775 and z = -1177: 402 centre to centre = 380 face to face. 850 long, 22 thick, 240 high. Flow (north): W1 -> kick across -> W2 ->
   kick back -> W3, each wall overlapping the next by 300 so you can hop across the lane the whole way (or wall-run straight on). */
addBoxSym( 300,  -775, 425, 11, 240, C.WALL);        // W1  x -125 ..  725 (inner lane)
addBoxSym(-295, -1177, 425, 11, 240, C.WALL);        // W2  x -720 ..  130 (outer lane)
addBoxSym(-895,  -775, 425, 11, 240, C.WALL);        // W3  x -1320 .. -470 (inner lane)

// Saffron pad (h118) at the end of W3, then the 15 degree downhill speed ramp (118 / 440 = tan 15.0 deg), 360 wide, 440 long, aimed back at the centre arena.
addBoxSym(-1500, -775, 180, 70, 118, C.PAD);                          // x -1680 .. -1320, z -845 .. -705
addRampSym(-1500, -485, 180, 220, 0, 118, '-z', C.SPEED);             // z -705 .. -265: 118 at the pad edge, 0 at the south (centre-facing) edge

/* ---- E + W avenues: low limestone cover blocks (dive-slam targets) ---- */
addBoxSym(1100, -520, 60, 80, 60, C.COVER);
addBoxSym(1100,  520, 60, 80, 60, C.COVER);

/* ---- CORNERS: 4 grapple spires with saffron caps, 4 thick swing pillars ---- */
[[1800, -1100], [-1800, -1100]].forEach(function (p) {
  addBoxSym(p[0], p[1], 40, 40, 420, C.TOWER);
  addBoxSym(p[0], p[1], 46, 46, 444, C.SPEED, 420);              // cap sits on the spire top
});
addPillarSym(1300, -650, 300, C.PILLAR, 40);
addPillarSym(1650, -1000, 300, C.PILLAR, 40);

export var DISTRICT_MAP = {
  name: 'District',
  rect: { hw: 2300, hd: 1600, lip: 24 },                         // low perimeter coping (visual only); nothing but spawns in the outer ring

  // 6 spawns, y = 0, each >= 260 clear of every hole / box / pillar / ramp footprint (validateMap checks it); all on the open runout avenues.
  spawns: [
    { x: 2150,  y: 0, z: -600 },    // E avenue
    { x: -2150, y: 0, z: 600 },     // W avenue (twin)
    { x: 2150,  y: 0, z: 600 },     // E avenue
    { x: -2150, y: 0, z: -600 },    // W avenue (twin)
    { x: 1000,  y: 0, z: -1480 },   // N avenue
    { x: -1000, y: 0, z: 1480 }     // S avenue (twin)
  ],

  pillars: pillars,
  boxes: boxes,

  holes: [
    { x: 480, z: -560, hw: 320, hd: 160 },     // ring-out pit NE of the platform
    { x: -480, z: 560, hw: 320, hd: 160 }      // ring-out pit SW (twin)
  ],

  ramps: ramps
};

/* ----------------------------------------------------------------------------
   Shared geometry helpers. world.js (colliders) and scene.js (meshes) BOTH build from these, so what you see
   is always what you collide with. Everything here is still in old 2.5D units.
   ---------------------------------------------------------------------------- */

// Vertical extent of a box. y0 = bottom (default 0), top = h. world.js / scene.js use  m(cy)  as the centre and  m(height)  as the full height.
export function boxSpan(b) {
  var y0 = b.y0 || 0;
  return { y0: y0, top: b.h, cy: (y0 + b.h) / 2, height: b.h - y0 };
}

// The rooftop floor = the rect minus the skylight holes, as non-overlapping slabs (top face at y = 0). Each slab is
// { x, z, hw, hd } plus its exact edges { x0, x1, z0, z1 }: neighbours share the SAME edge numbers, so there is no seam gap or overlap.
// Holes are clamped to the rect first. Sweep: cut the rect into vertical strips at every hole's west / east edge; inside a strip each hole
// either spans the whole strip or misses it, so the strip is just cut at the spans of the holes that cover it.
export function floorSlabs(map) {
  var hw = map.rect.hw, hd = map.rect.hd, EPS = 1e-6;
  var holes = (map.holes || []).map(function (h) {
    return { x0: Math.max(h.x - h.hw, -hw), x1: Math.min(h.x + h.hw, hw), z0: Math.max(h.z - h.hd, -hd), z1: Math.min(h.z + h.hd, hd) };
  }).filter(function (h) { return h.x1 - h.x0 > EPS && h.z1 - h.z0 > EPS; });
  var xs = [-hw, hw];
  holes.forEach(function (h) { xs.push(h.x0, h.x1); });
  xs.sort(function (a, b) { return a - b; });
  function slab(xa, xb, za, zb) {
    return { x: (xa + xb) / 2, z: (za + zb) / 2, hw: (xb - xa) / 2, hd: (zb - za) / 2, x0: xa, x1: xb, z0: za, z1: zb };
  }
  var out = [];
  for (var i = 0; i < xs.length - 1; i++) {
    var xa = xs[i], xb = xs[i + 1];
    if (xb - xa < EPS) continue;
    var cover = holes.filter(function (h) { return h.x0 <= xa + EPS && h.x1 >= xb - EPS; })
                     .sort(function (a, b) { return a.z0 - b.z0; });
    var z = -hd;
    cover.forEach(function (h) {
      if (h.z0 - z > EPS) out.push(slab(xa, xb, z, h.z0));
      z = Math.max(z, h.z1);
    });
    if (hd - z > EPS) out.push(slab(xa, xb, z, hd));
  }
  return out;
}

// A ramp as a SOLID wedge. Height is linear along the ascent axis: y0 at the low edge, y1 at the high edge. The wedge underside is `base`
// (default 0, so it never leaves a gap to the floor; give a ramp that sits on a deck base = the deck top so no volume is buried inside the box).
// Returns { alongX, sign, lo, hi, across, w, y0, y1, base, cx, cz, len, wid, rotY }:
//   lo / hi = world coordinate of the low / high edge along the ascent axis, across = centre coordinate on the other axis,
//   w = half width across, len / wid = full length / width, rotY = Three.js Y rotation that turns local +x into the ascent direction.
// Wedge profile (local x along ascent, y up): (0, base) (len, base) (len, y1) (0, y0), a convex quad whose top edge is the slope.
export function rampSpan(r) {
  var alongX = r.dir === '+x' || r.dir === '-x';
  var sign = r.dir.charAt(0) === '+' ? 1 : -1;
  var half = alongX ? r.hw : r.hd, centre = alongX ? r.x : r.z;
  var base = r.base || 0;
  return {
    alongX: alongX, sign: sign,
    lo: centre - sign * half, hi: centre + sign * half,
    across: alongX ? r.z : r.x, w: alongX ? r.hd : r.hw,
    y0: r.y0, y1: r.y1, base: base, cx: r.x, cz: r.z,
    len: half * 2, wid: (alongX ? r.hd : r.hw) * 2,
    rotY: { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 }[r.dir]
  };
}

/* ----------------------------------------------------------------------------
   validateMap(map, opts): data checks (no engine needed; run it under Node). Returns { ok, errors, stats }.
   Checks: exports / shape, everything inside the rect, 3D box overlaps (y0..h aware), box / ramp / pillar overlaps, nothing resting on a hole
   (floating boxes may span one), floor slabs + holes tile the rect exactly (no seam gaps), spawns on open floor (y = 0) and >= clearance
   from every hole / obstacle footprint, and ground flood-fill connectivity (spawns share one region, no sealed floor pockets).
   ---------------------------------------------------------------------------- */
export function validateMap(map, opts) {
  opts = opts || {};
  var CLEAR = opts.clearance || 200, HEAD = opts.headroom || 72, R = opts.radius || 20, CELL = opts.cell || 20, EPS = 1e-6;
  var errors = [], stats = {};
  function err(s) { errors.push(s); }
  var hw = map.rect.hw, hd = map.rect.hd;
  var boxes = map.boxes || [], pillars = map.pillars || [], holes = map.holes || [], ramps = map.ramps || [], spawns = map.spawns || [];

  function bx(b) { return { x0: b.x - b.hw, x1: b.x + b.hw, z0: b.z - b.hd, z1: b.z + b.hd, y0: b.y0 || 0, y1: b.h }; }
  function ov(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0); }       // overlap length (<= 0: touching or apart)
  function rampRect(r) { var s = rampSpan(r); return { x0: r.x - r.hw, x1: r.x + r.hw, z0: r.z - r.hd, z1: r.z + r.hd, s: s }; }
  function rampH(s, t) { return s.y0 + (s.y1 - s.y0) * ((t - s.lo) / (s.hi - s.lo)); }   // surface height at ascent coordinate t
  function circleRect(p, q) {
    var dx = Math.max(q.x0 - p.x, 0, p.x - q.x1), dz = Math.max(q.z0 - p.z, 0, p.z - q.z1);
    return Math.hypot(dx, dz) < p.r - EPS;
  }
  function distRect(px, pz, q) { return Math.hypot(Math.max(q.x0 - px, 0, px - q.x1), Math.max(q.z0 - pz, 0, pz - q.z1)); }

  // shape
  if (!(hw > 0 && hd > 0)) err('rect missing');
  boxes.forEach(function (b, i) {
    if (!(b.hw > 0 && b.hd > 0)) err('box ' + i + ' has no footprint');
    if (!(b.h > (b.y0 || 0))) err('box ' + i + ' needs h > y0');
    if (!Array.isArray(b.c)) err('box ' + i + ' has no colour');
    var q = bx(b);
    if (q.x0 < -hw - EPS || q.x1 > hw + EPS || q.z0 < -hd - EPS || q.z1 > hd + EPS) err('box ' + i + ' leaves the rect');
  });
  ramps.forEach(function (r, i) {
    var q = rampRect(r);
    if (q.x0 < -hw - EPS || q.x1 > hw + EPS || q.z0 < -hd - EPS || q.z1 > hd + EPS) err('ramp ' + i + ' leaves the rect');
    if (!(r.y1 > r.y0)) err('ramp ' + i + ' must rise (y1 > y0)');
  });
  pillars.forEach(function (p, i) {
    if (p.x - p.r < -hw || p.x + p.r > hw || p.z - p.r < -hd || p.z + p.r > hd) err('pillar ' + i + ' leaves the rect');
  });
  holes.forEach(function (h, i) {
    if (h.x - h.hw < -hw || h.x + h.hw > hw || h.z - h.hd < -hd || h.z + h.hd > hd) err('hole ' + i + ' leaves the rect');
  });
  for (var a = 0; a < holes.length; a++) for (var b2 = a + 1; b2 < holes.length; b2++) {
    var A = holes[a], B = holes[b2];
    if (ov(A.x - A.hw, A.x + A.hw, B.x - B.hw, B.x + B.hw) > EPS && ov(A.z - A.hd, A.z + A.hd, B.z - B.hd, B.z + B.hd) > EPS) err('holes ' + a + ' and ' + b2 + ' overlap');
  }

  // box / box (3D)
  var nbb = 0;
  for (var i = 0; i < boxes.length; i++) for (var j = i + 1; j < boxes.length; j++) {
    var p = bx(boxes[i]), q = bx(boxes[j]);
    if (ov(p.x0, p.x1, q.x0, q.x1) > EPS && ov(p.z0, p.z1, q.z0, q.z1) > EPS && ov(p.y0, p.y1, q.y0, q.y1) > EPS) { err('boxes ' + i + ' and ' + j + ' overlap'); nbb++; }
  }
  // ramp / ramp, ramp / box, ramp / pillar
  for (i = 0; i < ramps.length; i++) {
    var ri = rampRect(ramps[i]);
    for (j = i + 1; j < ramps.length; j++) {
      var rj = rampRect(ramps[j]);
      if (ov(ri.x0, ri.x1, rj.x0, rj.x1) > EPS && ov(ri.z0, ri.z1, rj.z0, rj.z1) > EPS) err('ramps ' + i + ' and ' + j + ' overlap');
    }
    boxes.forEach(function (b, k) {
      var q2 = bx(b), ox = ov(ri.x0, ri.x1, q2.x0, q2.x1), oz = ov(ri.z0, ri.z1, q2.z0, q2.z1);
      if (ox <= EPS || oz <= EPS) return;
      var s = ri.s, t0, t1;                                                    // overlap interval along the ascent axis
      if (s.alongX) { t0 = Math.max(ri.x0, q2.x0); t1 = Math.min(ri.x1, q2.x1); } else { t0 = Math.max(ri.z0, q2.z0); t1 = Math.min(ri.z1, q2.z1); }
      var top = Math.max(rampH(s, t0), rampH(s, t1)), bot = s.base;
      if (ov(bot, top, q2.y0, q2.y1) > EPS) err('ramp ' + i + ' overlaps box ' + k);
    });
    pillars.forEach(function (pl, k) { if (circleRect(pl, ri)) err('ramp ' + i + ' overlaps pillar ' + k); });
  }
  // pillar / box, pillar / pillar
  pillars.forEach(function (pl, k) {
    boxes.forEach(function (b, n) { var q3 = bx(b); if (circleRect(pl, q3) && ov(0, pl.h, q3.y0, q3.y1) > EPS) err('pillar ' + k + ' overlaps box ' + n); });
    for (var k2 = k + 1; k2 < pillars.length; k2++) if (Math.hypot(pl.x - pillars[k2].x, pl.z - pillars[k2].z) < pl.r + pillars[k2].r) err('pillars ' + k + ' and ' + k2 + ' overlap');
  });
  // nothing standing on a hole (a floating box with y0 >= HEAD may span it, e.g. the skybridges)
  holes.forEach(function (h, k) {
    var q4 = { x0: h.x - h.hw, x1: h.x + h.hw, z0: h.z - h.hd, z1: h.z + h.hd };
    boxes.forEach(function (b, n) {
      var q5 = bx(b);
      if (q5.y0 < HEAD && ov(q4.x0, q4.x1, q5.x0, q5.x1) > EPS && ov(q4.z0, q4.z1, q5.z0, q5.z1) > EPS) err('box ' + n + ' stands in hole ' + k);
    });
    ramps.forEach(function (r, n) { var rr = rampRect(r); if (ov(q4.x0, q4.x1, rr.x0, rr.x1) > EPS && ov(q4.z0, q4.z1, rr.z0, rr.z1) > EPS) err('ramp ' + n + ' is over hole ' + k); });
    pillars.forEach(function (pl, n) { if (circleRect(pl, q4)) err('pillar ' + n + ' is over hole ' + k); });
  });

  // floor slabs + holes tile the rect exactly
  var slabs = floorSlabs(map), area = 0, sArea = 0;
  slabs.forEach(function (s) { sArea += (s.x1 - s.x0) * (s.z1 - s.z0); });
  holes.forEach(function (h) { area += (Math.min(h.x + h.hw, hw) - Math.max(h.x - h.hw, -hw)) * (Math.min(h.z + h.hd, hd) - Math.max(h.z - h.hd, -hd)); });
  if (Math.abs(sArea + area - 4 * hw * hd) > 1e-3) err('floor slabs + holes do not tile the rect (seam gap)');
  for (i = 0; i < slabs.length; i++) {
    for (j = i + 1; j < slabs.length; j++) if (ov(slabs[i].x0, slabs[i].x1, slabs[j].x0, slabs[j].x1) > EPS && ov(slabs[i].z0, slabs[i].z1, slabs[j].z0, slabs[j].z1) > EPS) err('slabs ' + i + ' and ' + j + ' overlap');
    holes.forEach(function (h, k) {
      if (ov(slabs[i].x0, slabs[i].x1, h.x - h.hw, h.x + h.hw) > EPS && ov(slabs[i].z0, slabs[i].z1, h.z - h.hd, h.z + h.hd) > EPS) err('slab ' + i + ' covers hole ' + k);
    });
  }
  stats.slabs = slabs.length;

  // spawns
  var footprints = [];                                                         // every footprint, floating or not, for clearance
  boxes.forEach(function (b) { footprints.push(bx(b)); });
  ramps.forEach(function (r) { footprints.push(rampRect(r)); });
  holes.forEach(function (h) { footprints.push({ x0: h.x - h.hw, x1: h.x + h.hw, z0: h.z - h.hd, z1: h.z + h.hd }); });
  stats.spawns = spawns.length;
  stats.minSpawnClear = Infinity;
  if (spawns.length !== 6) err('expected 6 spawns, got ' + spawns.length);
  spawns.forEach(function (s, k) {
    if (s.y !== 0) err('spawn ' + k + ' is not on the floor (y = ' + s.y + ')');
    if (Math.abs(s.x) > hw - R || Math.abs(s.z) > hd - R) err('spawn ' + k + ' is outside the floor');
    var d = Infinity;
    footprints.forEach(function (q) { d = Math.min(d, distRect(s.x, s.z, q)); });
    pillars.forEach(function (pl) { d = Math.min(d, Math.hypot(s.x - pl.x, s.z - pl.z) - pl.r); });
    stats.minSpawnClear = Math.min(stats.minSpawnClear, d);
    if (d < CLEAR) err('spawn ' + k + ' is only ' + d.toFixed(1) + ' from the nearest hole / obstacle (need ' + CLEAR + ')');
  });

  // ground flood fill: cells blocked by holes, ground obstacles (anything reaching below head height, inflated by the body radius), ramps, pillars
  var nx = Math.round(2 * hw / CELL), nz = Math.round(2 * hd / CELL), grid = new Uint8Array(nx * nz);   // 0 open, 1 blocked
  var blockers = [];
  boxes.forEach(function (b) { if ((b.y0 || 0) < HEAD) blockers.push(bx(b)); });
  ramps.forEach(function (r) { blockers.push(rampRect(r)); });
  holes.forEach(function (h) { blockers.push({ x0: h.x - h.hw, x1: h.x + h.hw, z0: h.z - h.hd, z1: h.z + h.hd }); });
  var open = 0;
  for (var gz = 0; gz < nz; gz++) for (var gx = 0; gx < nx; gx++) {
    var px = -hw + (gx + 0.5) * CELL, pz = -hd + (gz + 0.5) * CELL, blocked = 0;
    for (var n = 0; n < blockers.length && !blocked; n++) {
      var bl = blockers[n], inHole = false;
      if (distRect(px, pz, bl) < R) blocked = 1;
    }
    for (n = 0; n < pillars.length && !blocked; n++) if (Math.hypot(px - pillars[n].x, pz - pillars[n].z) < pillars[n].r + R) blocked = 1;
    // holes are not inflated: standing at the lip is fine, but the cell itself must not be inside one
    grid[gz * nx + gx] = blocked;
    if (!blocked) open++;
  }
  // holes: undo the inflation so the lip stays walkable (a cell is only blocked if its centre is inside the hole)
  holes.forEach(function (h) {
    for (var z2 = 0; z2 < nz; z2++) for (var x2 = 0; x2 < nx; x2++) {
      var cx = -hw + (x2 + 0.5) * CELL, cz = -hd + (z2 + 0.5) * CELL;
      if (Math.abs(cx - h.x) < h.hw && Math.abs(cz - h.z) < h.hd) continue;
      var idx = z2 * nx + x2;
      if (grid[idx]) {                                                         // was it blocked only by this hole's inflation?
        var other = false, k;
        for (k = 0; k < blockers.length; k++) { var q6 = blockers[k]; if (q6.x0 === h.x - h.hw && q6.x1 === h.x + h.hw && q6.z0 === h.z - h.hd && q6.z1 === h.z + h.hd) continue; if (distRect(cx, cz, q6) < R) { other = true; break; } }
        for (k = 0; k < pillars.length && !other; k++) if (Math.hypot(cx - pillars[k].x, cz - pillars[k].z) < pillars[k].r + R) other = true;
        if (!other) { grid[idx] = 0; open++; }
      }
    }
  });
  function cellOf(x, z) { return Math.floor((z + hd) / CELL) * nx + Math.floor((x + hw) / CELL); }
  var seen = new Uint8Array(nx * nz), reached = 0;
  if (spawns.length) {
    var start = cellOf(spawns[0].x, spawns[0].z), stack = [];
    if (grid[start]) err('spawn 0 sits on a blocked cell');
    else { stack.push(start); seen[start] = 1; }
    while (stack.length) {
      var cur = stack.pop(); reached++;
      var cxn = cur % nx, czn = (cur - cxn) / nx;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var ax = cxn + d[0], az = czn + d[1];
        if (ax < 0 || az < 0 || ax >= nx || az >= nz) return;
        var id = az * nx + ax;
        if (!grid[id] && !seen[id]) { seen[id] = 1; stack.push(id); }
      });
    }
    spawns.forEach(function (s, k) { if (!seen[cellOf(s.x, s.z)]) err('spawn ' + k + ' is not ground-connected to spawn 0'); });
  }
  stats.openCells = open; stats.reachedCells = reached; stats.pockets = open - reached;
  if (open - reached > 0) err('ground flood fill: ' + (open - reached) + ' open floor cells are sealed off from the spawns');
  // every ramp's low edge must meet open ground
  ramps.forEach(function (r, k) {
    var s = rampSpan(r), tx = s.alongX ? s.lo - s.sign * (R + CELL) : s.across, tz = s.alongX ? s.across : s.lo - s.sign * (R + CELL);
    if (Math.abs(tx) > hw || Math.abs(tz) > hd || !seen[cellOf(tx, tz)]) err('ramp ' + k + ' low edge does not reach connected open ground');
  });

  stats.boxes = boxes.length; stats.floating = boxes.filter(function (b) { return (b.y0 || 0) > 0; }).length;
  stats.pillars = pillars.length; stats.ramps = ramps.length; stats.holes = holes.length;
  return { ok: errors.length === 0, errors: errors, stats: stats };
}

export default DISTRICT_MAP;
