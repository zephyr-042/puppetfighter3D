/* ============================================================================
   src/game/maps.js
   puppetfighter3D: map data (DISTRICT_MAP, "APEX ROOFTOP", now a 3-STORY vertical arena) plus the shared boxSpan / floorSlabs / rampSpan helpers and validateMap() at the bottom.
   ALL numbers are original 2.5D units (SCALE = 0.025 is applied later by world.js / scene.js). x: west -> east, z: north (-) -> south (+),
   y: height above the floor (0 = floor).

   Conventions
   - boxes:   { x, z, hw, hd, h, c, y0? }  centre, half width / depth, TOP height h and optional BOTTOM height y0 (default 0).
              y0 > 0 = a true floating box (walkway, sky platform, grapple anchor): players slide under it, grapple over it, wall-run along it.
              Vertical centre = (y0 + h) / 2, full height = h - y0. Use boxSpan(b) so world.js and scene.js agree.
   - pillars: { x, z, r, h, c }       round, grab-able (orbit, release to fling)
   - holes:   { x, z, hw, hd }        floor holes, stand over one and you fall
   - ramps:   { x, z, hw, hd, y0, y1, dir, base?, c? }
              centre, half extents, surface height at the LOW edge (y0) and HIGH edge (y1). NOTE: ramp y0 is a SURFACE height,
              it is not the box y0. `base` (default 0) is the height of the solid wedge's underside (the Story 3 sky-ramps use base 130 = the walkway top).
              dir = direction of ASCENT: '+x' | '-x' | '+z' | '-z'. Height is linear along that axis.
              `c` (optional, [r, g, b]) is the ramp's palette colour; physics ignores it, scene.js uses it for the material and, for C.SPEED ramps, the gold chevrons.
   - c: [r, g, b] 0..255 (the hex() helper converts 0xRRGGBB, so the palette below reads like web colours). The palette is also exported as PALETTE so scene.js can
     recognise a piece by reference (b.c === PALETTE.WALL) and attach its painted accent bands without any extra fields in the map data.

   APEX ROOFTOP, 3 STORIES: 4400 x 3000 (hw 2200, hd 1500), point-symmetric (x, z) -> (-x, -z).
     STORY 1  ground (y 0)   : two ring-out skylight pits (hw 420, hd 140) at z = -540 / +540. North + South wall-run canyons (lanes z = +-920 and +-1280, h270, 4 slate panels per
                               side, alternating lanes, each overlapping the next by 200 so you can hop across). The north chain flows west -> east into a saffron-gold launch
                               pad (h140) and a 140 -> 0 downhill speed ramp aimed at the east citadel (the south chain is the twin, flowing east -> west into the west citadel).
     STORY 2  y 110 .. 140   : CENTRAL DUEL DECK (hw 520, hd 300, h110), reached by 4 ground ramps (0 -> 110, two per side, flanking the walkway). EAST + WEST CITADEL DECKS
                               (hw 340, hd 460, h140), reached by wide outer ramps (0 -> 140) and linked to the duel deck by two elevated SKY-WALKWAYS (y 110 .. 130, 220 wide):
                               one continuous second-story highway (deck 110 -> walkway 130 -> citadel 140: every join is a step <= 20, inside MOVE.stepHeight 24).
                               Each citadel carries two tall wall-run panels standing ON the deck (y 140 .. 380).
     STORY 3  y 270 .. 495   : UPPER SKY-CITADEL platform (hw 220, hd 220, y 270 .. 295) on 4 corner columns standing on the duel deck, reached by two AERIAL SKY-RAMPS that
                               rise out of one half of each walkway, crowned by a crimson aerial wall-run fin (y 325 .. 495). Six floating gold SKY-GRAPPLE ANCHORS (y 410 .. 445) hang over
                               N, S, NW, NE, SW, SE; 4 corner grapple towers (h460, gold caps) + 4 swing pillars (r40, h360). GRAPPLE.maxRange is 1680 (42 m) so the ground reaches Story 3.
   Layout deviations from the written blueprint (all forced by validateMap or by the controller's step height):
     - sky-walkway hw 360 -> 260: the slab must fit between the duel deck (x 520) and the citadel (x 1040); at 360 it overlapped the h140 citadel in 3D.
     - platform columns y0 110 (stand on the duel deck, top 270): a column from y 0 would overlap the deck box in 3D.
     - sky-ramps rise 130 -> 295, not 270: 295 is the platform TOP; a 270 ramp leaves a 25 unit lip (> MOVE.stepHeight 24) that walking players could not climb.
     - the sky-ramps are 120 wide and sit on one half of the 220 wide walkway (the other half stays open), so the second-story highway stays continuous.
     - the 4 duel-deck ground ramps sit beside the walkway (z 110 .. 300), not under it, so the walkway never bonks your head halfway up.
     - citadel outer ramps stop at x 2120 so the low edge still meets open ground inside the rect (validateMap runout rule).
   ============================================================================ */

function hex(n) { return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

var C = {
  DECK:   hex(0xe4e0d8),   // duel deck, citadels, access ramps: warm limestone
  STEEL:  hex(0x525d6b),   // columns, launch pads, tower shafts: architectural slate steel (softened from near-black)
  COVER:  hex(0x9aa3ad),   // weathered concrete
  BRIDGE: hex(0xeef1f5),   // walkways, sky platform, sky-ramps: titanium white
  WALL:   hex(0x465466),   // wall-run panels + fins: crisp architectural slate (scene.js adds the crimson-terracotta 0xe04f3e runner-vision strips)
  SPEED:  hex(0xf59e0b),   // downhill speed ramps, launch pads' ramps, sky anchors, tower caps: rich saffron gold
  PILLAR: hex(0x475569)    // round swing pillars: slate steel
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
function addRamp(x, z, hw, hd, y0, y1, dir, c, base) {
  var r = { x: x, z: z, hw: hw, hd: hd, y0: y0, y1: y1, dir: dir };
  if (c) r.c = c;                                    // optional palette colour (visual only; world.js does not read it)
  if (base) r.base = base;                           // underside of the wedge (default 0); > 0 = an aerial ramp
  ramps.push(r);
}
function addRampSym(x, z, hw, hd, y0, y1, dir, c, base) { addRamp(x, z, hw, hd, y0, y1, dir, c, base); addRamp(-x, -z, hw, hd, y0, y1, OPP[dir], c, base); }

/* ======================= STORY 2: duel deck, citadels, sky-walkways ======================= */
addBox(0, 0, 520, 300, 110, C.DECK);                                  // CENTRAL DUEL DECK x -520 .. 520, z -300 .. 300, top 110
// 4 ground ramps (0 -> 110), 440 long (14 degrees), 190 wide each, flanking the walkway band (|z| < 110): W side ascends east, E side ascends west
addRampSym(-740, 205, 220, 95, 0, 110, '+x', C.DECK);                 // x -960 .. -520, z 110 .. 300  (+ twin on the east side, z -300 .. -110)
addRampSym(-740, -205, 220, 95, 0, 110, '+x', C.DECK);                // x -960 .. -520, z -300 .. -110 (+ twin on the east side, z 110 .. 300)

addBox(-1380, 0, 340, 460, 140, C.DECK);                              // WEST CITADEL x -1720 .. -1040, z -460 .. 460, top 140
addBox(1380, 0, 340, 460, 140, C.DECK);                               // EAST CITADEL x 1040 .. 1720
addRampSym(1920, 0, 200, 260, 0, 140, '-x', C.DECK);                  // wide outer ramps: x 1720 .. 2120, z -260 .. 260, 0 -> 140 (the west one is the twin)

addBox(-780, 0, 260, 110, 130, C.BRIDGE, 110);                        // SKY-WALKWAYS y 110 .. 130, x -1040 .. -520, z -110 .. 110: deck (110) -> walkway (130) -> citadel (140)
addBox(780, 0, 260, 110, 130, C.BRIDGE, 110);

// second-story wall-run panels standing ON the citadel decks: y 140 .. 380 (240 tall), 560 long, along the highway at z = +-330
addBoxSym(1380, -330, 280, 14, 380, C.WALL, 140);                     // east citadel north panel + west citadel south twin
addBoxSym(1380, 330, 280, 14, 380, C.WALL, 140);                      // east citadel south panel + west citadel north twin

/* ======================= STORY 3: sky platform, sky-ramps, fin ======================= */
addBox(0, 0, 220, 220, 295, C.BRIDGE, 270);                           // UPPER SKY-CITADEL platform x +-220, z +-220, y 270 .. 295
[[-195, -195], [195, -195], [-195, 195], [195, 195]].forEach(function (p) {
  addBox(p[0], p[1], 20, 20, 270, C.STEEL, 110);                      // 4 tall corner columns: stand on the duel deck (110) and hold the platform underside (270)
});
// AERIAL SKY-RAMPS: wedge underside 130 = the walkway top; they start on the walkway at |x| 760, pass over the deck edge and meet the platform top (295)
// Each ramp covers only HALF of its walkway (z -10 .. 110 on the west, the twin z -110 .. 10 on the east), so the other half stays an open lane: the highway never gets cut.
addRampSym(-490, 50, 270, 60, 130, 295, '+x', C.BRIDGE, 130);         // x -760 .. -220, z -10 .. 110 (the east one is the twin)
addBox(0, 0, 12, 420, 495, C.WALL, 325);                              // crowning crimson aerial wall-run fin, floats 30 above the platform: y 325 .. 495, z +-420

// 6 HIGH GOLD SKY-GRAPPLE ANCHORS, y 410 .. 445: N, S, NW, SE, NE, SW (point twins)
addBoxSym(0, -1100, 48, 48, 445, C.SPEED, 410);                       // N + S
addBoxSym(-1500, -700, 48, 48, 445, C.SPEED, 410);                    // NW + SE
addBoxSym(1500, -700, 48, 48, 445, C.SPEED, 410);                     // NE + SW

/* ======================= STORY 1: wall-run canyons + launch pads + speed ramps ======================= */
// Lanes z = -920 (inner) and -1280 (outer), 360 apart; panels 840 long, 270 high, each overlapping the next by 200. North flows west -> east, the south twin east -> west.
addBoxSym(-1100, -920, 420, 14, 270, C.WALL);                         // N1  x -1520 .. -680 (inner lane)
addBoxSym(-460, -1280, 420, 14, 270, C.WALL);                         // N2  x -880 .. -40   (outer lane)
addBoxSym(180, -920, 420, 14, 270, C.WALL);                           // N3  x -240 .. 600   (inner lane)
addBoxSym(820, -1280, 420, 14, 270, C.WALL);                          // N4  x 400 .. 1240   (outer lane)
addBoxSym(1440, -1280, 160, 160, 140, C.STEEL);                       // launch pad x 1280 .. 1600, z -1440 .. -1120, top 140
addRampSym(1440, -900, 160, 220, 0, 140, '-z', C.SPEED);              // downhill speed ramp z -1120 .. -680: 140 at the pad edge, 0 at the south edge, aimed at the east citadel

/* ======================= corners: grapple towers + swing pillars ======================= */
[[1950, -1250], [1950, 1250]].forEach(function (p) {
  addBoxSym(p[0], p[1], 42, 42, 460, C.STEEL);                        // 4 tall corner grapple towers
  addBoxSym(p[0], p[1], 48, 48, 485, C.SPEED, 460);                   // gold cap sits on the tower top
});
addPillarSym(1700, -1000, 360, C.PILLAR, 40);                         // 4 tall swing pillars
addPillarSym(1700, 1000, 360, C.PILLAR, 40);

export var DISTRICT_MAP = {
  name: 'District',
  rect: { hw: 2200, hd: 1500, lip: 20 },                         // low perimeter coping (visual only); nothing but spawns in the outer ring

  // 6 spawns, y = 0, each >= 260 clear of every hole / box / ramp / pillar footprint, floating ones included (validateMap checks it); all on open ground.
  spawns: [
    { x: 2100,  y: 0, z: -700 },    // E avenue
    { x: -2100, y: 0, z: 700 },     // W avenue (twin)
    { x: 2100,  y: 0, z: 700 },     // E avenue
    { x: -2100, y: 0, z: -700 },    // W avenue (twin)
    { x: 900,   y: 0, z: -800 },    // north-east of the pit, between the canyon and the east citadel
    { x: -900,  y: 0, z: 800 }      // south-west (twin)
  ],

  pillars: pillars,
  boxes: boxes,

  holes: [
    { x: 0, z: -540, hw: 420, hd: 140 },       // ring-out skylight pit north of the duel deck (z -680 .. -400)
    { x: 0, z: 540, hw: 420, hd: 140 }         // ring-out skylight pit south of the duel deck (z 400 .. 680)
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
