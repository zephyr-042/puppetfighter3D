// src/render/scene.js
// RENDER (1/2): the Three.js renderer, lights, the District map (floor slabs with rim trims, boxes, pillars, ramp wedges),
// and one puppet per player: a SINGLE armoured pod (satin-dark capsule, emissive chest + visor rings, squashes while sliding) with a floating
// energy blade hovering off its right side that sweeps a 140 degree slash with a glowing crescent trail while `attackP` runs (setAttack). The pod is
// speed-charged (blade glow 0.6 -> 2.4 and a longer glow streak as horizontal speed climbs 300 -> 760 units / s, i.e. toward the full 75 damage slash) and leans up to 0.22 rad into its
// movement / dodge direction. The pod is also the ragdoll: when the pod tumbles, physics/ragdoll.js drives this very same `pod` group (one rigid capsule, no limbs), so nothing ever shape-shifts.
// Also the red "IT" cone marker and the glowing grapple tether (setGrapple).
// LOOK: bright, crisp, sunlit architecture (Mirror's Edge / War Games daylight). ~85 % calm neutral limestone / slate / concrete, ~15 % runner-vision accents. A clear morning sky
// gradient, bright horizon mist, balanced daylight (cool hemisphere fill + a warm-white sun high in the sky) and PROCEDURAL surface textures generated once at startup (warm
// poured-concrete floor with expansion seams, brushed panel texture on every box / ramp). Runner-vision accents are PAINTED bands: crimson-terracotta strips on every wall-run panel,
// saffron bands on the swing pillars, deep-amber chevrons on the saffron speed ramps. Ordinary matte standard materials, nothing emissive.
// The only background geometry is a distant CITY SKYLINE: ONE InstancedMesh of ~48 towers in a 135-360 m ring (no shadows) that fades into the horizon mist, so the roof reads as
// suspended over a real sunlit city.
// Meshes are built from the same map data and helpers (game/maps.js) as the physics colliders, so they always match.
// Accent bands are collected into a handful of InstancedMesh batches (one draw call per colour / shape, no shadows) to keep District at 60+ FPS.
// The slash trail and the dive-slam shockwave use NORMAL blending (additive washes out on the bright floor); the speed streak and guard barrier stay additive.
// Loads after: config.js, game/maps.js

import * as THREE from 'three';
import { m, PUPPET, CAM, MAP, JUICE } from '../config.js';
import DISTRICT_MAP, { PALETTE, floorSlabs, rampSpan, boxSpan } from '../game/maps.js';

// ---- look tuning (everything the daylight mood depends on lives here) --------------------------------------------------------
const TRIM_COLOR = 0xb4aea4, TILE_M = 5, PANEL_M = 2.5;                    // light steel coping trim; floor grid tile (metres); panel texture tile on boxes / ramps (metres)
const SKY_STOPS = [[0, '#4b92db'], [0.5, '#9ecfff'], [1, '#e8f3fc']];      // zenith blue -> mid-sky -> pale horizon mist (screen space, top -> bottom)
const FOG = { color: 0xdbeaf7, near: 130, far: 420 };                       // bright morning horizon mist (metres): the roof (<= ~135 m end to end) stays crisp, the skyline fades into it
const SUN = { color: 0xfffdf7, intensity: 1.65, offset: [34, 70, 24] };     // warm-white sun, ~60 degrees up: short, crisp shadows
const HEMI = { sky: 0xf4f9ff, ground: 0x8d99a6, intensity: 1.85 };          // cool daylight fill: shadowed faces stay clean and readable
const EXPOSURE = 0.9;                                                       // used only with the neutral tone mapper (hue-preserving highlight roll-off); see createScene
const PAINT = { white: 0xf8fafc, crimson: 0xe04f3e, gold: 0xf59e0b, chev: 0xb45309 };   // painted accents: crimson-terracotta runner-vision strips, saffron bands, deep-amber chevrons (read on the saffron ramps)
const SKYLINE = { count: 48, rMin: 135, rMax: 360, baseY: -140, topNear: -25, topFar: 150, wMin: 14, wMax: 40 };   // metres: ring of towers; the base sits far below the roof, tops climb with distance
const STRIP_PROUD = 0.06;                                                   // band thickness along the face normal (half of it stands proud of the surface)

// map colours are [r, g, b] in 0-255 (sRGB)
const rgb = (c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

// Finish per palette entry: [roughness, metalness]. Everything is matte-ish architecture; metalness stays low because there is no environment map.
const SURFACE = new Map([
  [PALETTE.DECK, [0.85, 0.02]],      // warm limestone
  [PALETTE.STEEL, [0.45, 0.30]],     // anodized gunmetal
  [PALETTE.COVER, [0.92, 0.00]],     // weathered concrete
  [PALETTE.BRIDGE, [0.50, 0.15]],    // titanium white
  [PALETTE.WALL, [0.65, 0.10]],      // deep slate panels
  [PALETTE.SPEED, [0.55, 0.12]],     // saffron
  [PALETTE.PILLAR, [0.60, 0.25]]     // slate steel
]);
const surface = (c) => SURFACE.get(c) || [0.85, 0.10];

// ---- procedural textures: drawn once, zero external image assets -----------------------------------------------------------
const makeRnd = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;     // tiny deterministic PRNG: same look every load

// Poured architectural concrete: warm light grey (#d6d2ca), fine surface grain, crisp expansion seams on the tile border (and a faint half-tile guide).
function makeFloorTexture() {
  const S = 256, rnd = makeRnd(1337);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#d6d2ca'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {                                                           // grain: tiny light / dark speckles
    const x = rnd() * S, y = rnd() * S, a = 0.03 + rnd() * 0.05;
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,' + a.toFixed(3) + ')' : 'rgba(128,120,108,' + a.toFixed(3) + ')';
    g.fillRect(x, y, 1 + (rnd() < 0.2 ? 1 : 0), 1);
  }
  for (let i = 0; i < 40; i++) {                                                             // a few soft trowel marks
    const x = rnd() * S, y = rnd() * S, r = 14 + rnd() * 34;
    g.fillStyle = 'rgba(255,255,255,0.025)'; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
  }
  g.fillStyle = 'rgba(160,153,141,0.35)'; g.fillRect(0, S / 2, S, 1); g.fillRect(S / 2, 0, 1, S);   // faint half-tile guide
  g.fillStyle = '#a39c90'; g.fillRect(0, 0, S, 2); g.fillRect(0, 0, 2, S);                   // expansion seam on the tile border
  g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(0, 2, S, 1); g.fillRect(2, 0, 1, S);    // lit edge just inside the seam
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Brushed architectural panel: near-white (so the palette colour of each material shows true when it multiplies in), fine horizontal brushed grain, a crisp horizontal
// seam at the top of the tile + a lighter mid seam, and a vertical panel joint. Tiled in world space by scaleBoxUV (one tile = PANEL_M metres).
let panelTexCache = null;
function getPanelTexture() {
  if (panelTexCache) return panelTexCache;
  const S = 256, rnd = makeRnd(4242);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#f2f4f6'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {                                                            // brushed grain: long, thin, near-horizontal streaks
    const x = rnd() * S, y = rnd() * S, len = 24 + rnd() * 110, a = 0.02 + rnd() * 0.035;
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,' + a.toFixed(3) + ')' : 'rgba(90,100,112,' + a.toFixed(3) + ')';
    g.fillRect(x, y, len, 1);
    if (x + len > S) g.fillRect(x - S, y, len, 1);                                           // wrap so the tile stays seamless
  }
  g.fillStyle = 'rgba(70,80,92,0.22)'; g.fillRect(0, S / 2, S, 1);                           // mid seam: subtle
  g.fillStyle = 'rgba(70,80,92,0.55)'; g.fillRect(0, 0, S, 2); g.fillRect(0, 0, 2, S);       // panel seams: horizontal + vertical joint
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0, 2, S, 1); g.fillRect(2, 0, 1, S);    // lit edge under the seam
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (panelTexCache = t);
}

// BoxGeometry UVs run 0..1 per face. Rescale them so one texture tile is `tile` metres on EVERY face (world-space texel density, any box size).
// Face order of BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices each). w / h / d = full size in metres.
function scaleBoxUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  uv.needsUpdate = true;
}
function scaleUV(geo, k) {                                                   // extruded ramp UVs are in metres already: just 1 / tile
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  uv.needsUpdate = true;
}

// One shared material per colour, so 70-odd meshes do not mean 70 materials. `textured` = the brushed panel texture (boxes, ramps); pillars stay plain.
const matCache = new Map();
function matFor(c, textured = true) {
  const [roughness, metalness] = surface(c);
  const key = c.join(',') + '|' + roughness + '|' + metalness + '|' + (textured ? 't' : 'p');
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color: rgb(c), roughness, metalness, map: textured ? getPanelTexture() : null }));
  return matCache.get(key);
}

// Solid ramp wedge: the side profile (low edge y0, high edge y1, flat bottom at span.base) extruded across the ramp width,
// then turned so local +x points up the slope. Exported so a test can compare it with the physics hull.
export function buildRampGeometry(r) {
  const s = rampSpan(r), L = m(s.len), W = m(s.wid);
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, m(s.base)); shape.lineTo(L / 2, m(s.base)); shape.lineTo(L / 2, m(s.y1)); shape.lineTo(-L / 2, m(s.y0)); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  geo.translate(0, 0, -W / 2);
  geo.rotateY(s.rotY);
  geo.translate(m(s.cx), 0, m(s.cz));
  return geo;
}

// ---- puppets ---------------------------------------------------------------------------------------------------------------
// ONE armoured pod per player. Geometry is shared by every puppet; each puppet owns five materials: satin-dark armour tinted with the player colour,
// an emissive "energy core" in the pure player colour (chest + visor rings), the glowing blade, its white-hot edge, and the additive slash trail.
// Hierarchy:  pod (origin = pod CENTRE; position / quaternion driven by setFeet + setYaw, or by ragdoll.js while tumbling)
//               └ mount (origin = FEET: y = -height / 2)  ├ body capsule, chest ring, visor ring   ├ bladeRig (hilt + blade + edge)   └ trail crescent
// Pod-local axes: +Z = the way the pod faces, -X = its right side. The faceless capsule and its rings are rotation-symmetric; only the blade shows the facing.
const ARMOR_DARKEN = 0.5, CORE_EMISSIVE = 0.65, BLADE_EMISSIVE = 2.2, FLASH_TIME = 0.18;
const DARK_STEEL = new THREE.Color(0x10141b), WHITE = new THREE.Color(0xffffff), Y_AXIS = new THREE.Vector3(0, 1, 0);

// Floating energy blade (metres, mount / feet space). The hilt hovers at `pivot` = off the RIGHT side (x -0.55), shoulder height (y 1.05), slightly forward (z 0.2).
// Idle: tilted up and a little outward, with a slow bob. Slash: the hilt orbits the pod's vertical axis (radius = hypot(pivot.x, pivot.z)) through a 140 degree
// arc, right -> left across the front, blade pointing radially outward; the arc STARTS exactly at the idle pivot, so the wind-up never jumps.
const BLADE = { len: 1.5, back: 0.22, half: 0.065, thick: 0.035, pivot: [-0.55, 1.05, 0.2], idlePitch: -1.0, idleYaw: -0.25 };
const ORBIT_R = Math.hypot(BLADE.pivot[0], BLADE.pivot[2]);
const ARC_HALF = THREE.MathUtils.degToRad(70);                           // 2 x 70 = the 140 degree slash arc
// slash timeline over attackP in 0..1 (attackP = 1 - attackT / MELEE.attackTime): wind-up, sweep, recovery
const SLASH = { p0: 0.12, p1: 0.62, trailSegs: 28, trailOut: ORBIT_R + BLADE.len, trailMax: 1.1, trailMin: 0.1, trailTail: 0.7, trailFade: 0.25 };

// guard stance (Slice M2): the blade hovers across the FRONT of the pod, pointing along pod-local +X; the energy barrier is a curved shield panel in front
const GUARD = { x: -0.7, y: 1.05, z: 0.62, yaw: Math.PI / 2, arc: Math.PI * 0.85, r: 0.95, h: 1.55, blue: new THREE.Color(0x4d8dff), cyan: new THREE.Color(0x00f5d4), ease: 18, colEase: 28 };

const UPPER = { x: -0.3 };                                                  // uppercut: lateral offset (pod-local, right shoulder) of the vertical sweep plane

const _yawQ = new THREE.Quaternion(), _tiltQ = new THREE.Quaternion(), _axis = new THREE.Vector3(), _up = new THREE.Vector3();
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

let capsuleGeo = null, ringGeo = null, bladeGeo = null;
function bladeShape(lenK, halfK) {                                       // blade silhouette in the (length, width) plane: a long lens with a pointed tip
  const L = BLADE.len * lenK, w = BLADE.half * halfK, sh = new THREE.Shape();
  sh.moveTo(-BLADE.back, -w * 0.55); sh.lineTo(L * 0.78, -w); sh.lineTo(L, 0); sh.lineTo(L * 0.78, w); sh.lineTo(-BLADE.back, w * 0.55); sh.closePath();
  return sh;
}
function extrudeBlade(shape, thick) {                                    // thickness across X, length along +Z, width along Y
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  g.rotateY(-Math.PI / 2);                                               // (x, y, z) -> (-z, y, x): length x becomes +Z, thickness z becomes X
  return g;
}
function getGeos() {
  if (!capsuleGeo) {
    const radius = m(PUPPET.radius), total = m(PUPPET.height);
    capsuleGeo = new THREE.CapsuleGeometry(radius, total - 2 * radius, 6, 14);
    ringGeo = {
      chest: new THREE.TorusGeometry(radius + 0.005, 0.032, 8, 28).rotateX(Math.PI / 2),
      visor: new THREE.TorusGeometry(radius + 0.005, 0.02, 8, 28).rotateX(Math.PI / 2)
    };
    bladeGeo = {
      blade: extrudeBlade(bladeShape(1, 1), BLADE.thick),
      edge: extrudeBlade(bladeShape(0.96, 0.3), BLADE.thick * 1.7),      // white-hot core line, a touch thicker so it shows through both faces
      hilt: new THREE.CylinderGeometry(0.05, 0.065, 0.26, 12).rotateX(Math.PI / 2).translate(0, 0, -BLADE.back + 0.02),
      guard: new THREE.TorusGeometry(0.1, 0.018, 8, 22).translate(0, 0, 0.03),
      streak: new THREE.ConeGeometry(0.05, 1, 10, 1, true).rotateX(-Math.PI / 2)   // unit-long comet tail: base at +Z (the hilt), tip trailing toward -Z
    };
  }
  return { capsuleGeo, ringGeo, bladeGeo };
}

// Crescent slash trail: one flat ribbon in the horizontal plane, tapering to points at both ends. The vertex colours carry the player's colour and a per-vertex
// ALPHA that update() rewrites while a swing runs, so the crescent is "drawn" behind the blade and fades out. Outer edge bright, inner edge soft.
function makeTrail(color) {
  const n = SLASH.trailSegs, pos = new Float32Array((n + 1) * 2 * 3), col = new Float32Array((n + 1) * 2 * 4), idx = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, th = ARC_HALF - 2 * ARC_HALF * u;                    // u = 0 right end of the arc, u = 1 left end (the blade sweeps right -> left)
    const w = SLASH.trailMin + (SLASH.trailMax - SLASH.trailMin) * Math.pow(Math.sin(Math.PI * u), 0.8);
    const sx = -Math.sin(th), sz = Math.cos(th), ro = SLASH.trailOut, ri = ro - w;
    pos.set([sx * ro, 0, sz * ro, sx * ri, 0, sz * ri], i * 6);
    for (let k = 0; k < 2; k++) col.set([color.r, color.g, color.b, 0], (i * 2 + k) * 4);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

// One puppet = one pod. API (all metres / radians):
//   setFeet(x, y, z), setHeight(h) (slide squash), setYaw(a)         - normal play (pod stands on its feet, `pod` follows)
//   setSpeed(units / s)  horizontal speed -> blade charge glow + streak;   setLean(x, z)  target lean (world-space, |l| <= JUICE.tiltMax rad, the pod leans toward +l, pivoting about its FEET, eased)
//   setMode('pod' | 'ragdoll' | 'hidden')                              - 'ragdoll': ragdoll.js drives `pod` (syncRagdollMeshes(rag, puppet.pod, out)); setFeet / setYaw are then not called
//   setGuard(0 | 1 | 2)  parry guard: 0 = down, 1 = regular block (soft blue barrier), 2 = PERFECT parry window (bright cyan); the blade snaps horizontally in front of the pod
//   setAttack(p, type)  p in 0..1 = swing progress (1 - attackT / MELEE.attackTime), -1 = no swing; type 'uppercut' = the vertical, rolled low -> high sweep (Slice M3), anything else the horizontal slash;   flash(power)  hit flash;   update(dt)  called by view.update(dt)
function createPuppet(scene, color) {
  const { capsuleGeo, ringGeo, bladeGeo } = getGeos();
  const total = m(PUPPET.height), radius = m(PUPPET.radius), cyl = Math.max(total - 2 * radius, 0);
  const base = new THREE.Color(color);
  const armor = new THREE.MeshStandardMaterial({ color: base.clone().lerp(DARK_STEEL, ARMOR_DARKEN), roughness: 0.35, metalness: 0.25 });
  const core = new THREE.MeshStandardMaterial({ color: base, emissive: base, emissiveIntensity: CORE_EMISSIVE, roughness: 0.3, metalness: 0.1 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.3), emissive: base, emissiveIntensity: BLADE_EMISSIVE, roughness: 0.3, metalness: 0.1 });
  const edgeCol = base.clone().lerp(WHITE, 0.8), edgeMat = new THREE.MeshBasicMaterial({ color: edgeCol.clone(), toneMapped: false });
  const streakMat = new THREE.MeshBasicMaterial({ color: base.clone().lerp(WHITE, 0.35), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
  const trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });   // normal blending: reads in daylight

  const pod = new THREE.Group(), mount = new THREE.Group();
  pod.add(mount);
  const body = new THREE.Mesh(capsuleGeo, armor);
  body.position.y = total / 2;
  body.castShadow = true;
  mount.add(body);
  const chest = new THREE.Mesh(ringGeo.chest, core), visor = new THREE.Mesh(ringGeo.visor, core);   // energy core + visor ring: lit in the dark, readable in shadow
  mount.add(chest); mount.add(visor);

  // floating energy blade: hilt + guard ring (dark steel / core), blade body (emissive) and a white-hot edge. Nothing holds it: it hovers.
  const bladeRig = new THREE.Group();
  bladeRig.add(new THREE.Mesh(bladeGeo.hilt, armor));
  bladeRig.add(new THREE.Mesh(bladeGeo.guard, core));
  bladeRig.add(new THREE.Mesh(bladeGeo.blade, bladeMat));
  bladeRig.add(new THREE.Mesh(bladeGeo.edge, edgeMat));
  const streak = new THREE.Mesh(bladeGeo.streak, streakMat);              // speed glow trail: streams back from the hilt when the blade is charged (JUICE.streakFrom)
  streak.visible = false; streak.frustumCulled = false;
  bladeRig.add(streak);
  mount.add(bladeRig);

  // guard barrier: a translucent curved panel in front of the pod (open cylinder segment, centred on +Z), additive glow, only visible while the guard is up
  const guardMat = new THREE.MeshBasicMaterial({ color: GUARD.blue.clone(), transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
  const guardGeo = new THREE.CylinderGeometry(GUARD.r, GUARD.r, GUARD.h, 24, 1, true, -GUARD.arc / 2, GUARD.arc);
  const guardMesh = new THREE.Mesh(guardGeo, guardMat);
  guardMesh.visible = false; guardMesh.frustumCulled = false; guardMesh.renderOrder = 3;
  mount.add(guardMesh);

  const tc = base.clone().lerp(WHITE, 0.12);
  const trailGeo = makeTrail(tc), trailCol = trailGeo.getAttribute('color'), trail = new THREE.Mesh(trailGeo, trailMat);
  trail.visible = false; trail.frustumCulled = false; trail.renderOrder = 2;
  mount.add(trail);
  scene.add(pod);

  let fx = 0, fy = 0, fz = 0, curH = total, yaw = 0, mode = 'pod', attackP = -1, flashT = 0, flashPow = 1, t = Math.random() * 10;
  let leanX = 0, leanZ = 0, leanTX = 0, leanTZ = 0, spdT = 0, spdS = 0;     // lean (current / target) and horizontal speed in units / s (target / smoothed)
  let attackType = 'slash';                                                   // 'slash' | 'uppercut' | 'slam' (only 'uppercut' animates differently)
  let guardState = 0, guardA = 0, guardC = 0;                                // guard: requested state (0 / 1 / 2), eased 0..1 amount, eased 0..1 'perfect' colour mix
  const phase = Math.random() * 6.28;
  // pod pose = lean * yaw, pivoting about the FEET: the centre sits curH / 2 up the leaned axis, so the soles stay planted while the top leans into the run
  function applyPose() {
    _yawQ.setFromAxisAngle(Y_AXIS, yaw);
    const a = Math.hypot(leanX, leanZ);
    if (a > 1e-4) {
      _axis.set(leanZ / a, 0, -leanX / a);                                 // up x lean-direction: a positive angle about it tips the top toward +lean
      _tiltQ.setFromAxisAngle(_axis, a);
      pod.quaternion.multiplyQuaternions(_tiltQ, _yawQ);
      _up.set(0, curH / 2, 0).applyQuaternion(_tiltQ);
    } else { pod.quaternion.copy(_yawQ); _up.set(0, curH / 2, 0); }
    pod.position.set(fx + _up.x, fy + _up.y, fz + _up.z);
  }
  const place = applyPose;

  // rings sit on the straight part of the capsule (chest low, visor high) and follow the squash, so a slide pulls them down with the body
  function setHeight(h) {
    curH = h;
    const k = h / total;
    body.scale.y = k; body.position.y = h / 2;
    chest.position.y = k * (radius + 0.42 * cyl);
    visor.position.y = k * (radius + 0.86 * cyl);
    mount.position.y = -h / 2;                                           // mount origin = feet
    if (mode === 'pod') place();
  }
  setHeight(total);

  function setMode(v) {
    if (v === mode) return;                                              // idempotent: main.js calls it every frame
    mode = v;
    pod.visible = v !== 'hidden';
    if (v === 'ragdoll') setHeight(total);                               // the physics body is the full standing capsule
    else if (v === 'pod') applyPose();
  }

  function update(dt) {
    t += dt;
    if (!pod.visible) return;
    // hit flash: the whole pod and its blade flare white for a moment
    if (flashT > 0) {
      flashT = Math.max(0, flashT - dt);
      const f = (flashT / FLASH_TIME) * flashPow;
      armor.emissive.setScalar(f * 0.8); core.emissiveIntensity = CORE_EMISSIVE + f * 2.5;
    }
    // speed charge: blade glow 0.6 -> 2.4 over chargeFrom -> chargeTo (the full-lethal-slash speed), plus a streak above streakFrom. Speed is smoothed so the glow breathes, never pops.
    spdS += (spdT - spdS) * (1 - Math.exp(-10 * dt));
    const charge = clamp01((spdS - JUICE.chargeFrom) / (JUICE.chargeTo - JUICE.chargeFrom));
    const fast = clamp01((spdS - JUICE.streakFrom) / (JUICE.chargeTo - JUICE.streakFrom));
    const fl = flashT > 0 ? (flashT / FLASH_TIME) * flashPow : 0;
    bladeMat.emissiveIntensity = JUICE.bladeGlowMin + (JUICE.bladeGlowMax - JUICE.bladeGlowMin) * charge + fl * 2;
    const eb = 0.55 + 0.45 * charge;
    edgeMat.color.setRGB(edgeCol.r * eb, edgeCol.g * eb, edgeCol.b * eb);       // the white-hot edge dims with the glow
    if (fast > 0.02) {
      streak.visible = true;
      const w = 0.6 + 0.8 * fast, len = 0.25 + (JUICE.streakLen - 0.25) * fast;
      streak.scale.set(w, w, len); streak.position.z = -BLADE.back - len / 2; streakMat.opacity = 0.7 * fast;
    } else streak.visible = false;
    // lean eases toward its target (never snaps)
    const lk = 1 - Math.exp(-JUICE.tiltEase * dt);
    leanX += (leanTX - leanX) * lk; leanZ += (leanTZ - leanZ) * lk;
    if (mode === 'pod') applyPose();

    // blade pose (idle hover, or the slash timeline)
    const k = curH / total, bob = Math.sin(t * 2.3 + phase);
    const p = attackP;
    let upOn = 0, upPhi = 0, rollB = 0;                                       // Uppercut pose blend (0..1) / elevation angle / blade roll
    let th = ARC_HALF, yawB = BLADE.idleYaw + 0.04 * bob, pitchB = BLADE.idlePitch + 0.05 * bob, py = BLADE.pivot[1] + 0.035 * bob, stretch = 1, u = -1, fade = 0;
    if (p >= 0 && p < 1) {
      const wind = sstep(0, SLASH.p0, p), rec = sstep(SLASH.p1, 1, p), on = wind * (1 - rec);
      const x = Math.max(0, Math.min(1, (p - SLASH.p0) / (SLASH.p1 - SLASH.p0)));
      u = p < SLASH.p0 ? 0 : p > SLASH.p1 ? 1 : 1 - Math.pow(1 - x, 3);   // sweep: fast start, settles at the end
      th = p <= SLASH.p1 ? ARC_HALF - 2 * ARC_HALF * u : -ARC_HALF + 2 * ARC_HALF * rec;    // sweep right -> left, then glide back round the FRONT (never through the pod)
      yawB = yawB + (-th - yawB) * on;                                    // blade points radially outward while slashing
      pitchB = pitchB * (1 - on);
      py = BLADE.pivot[1] + (py - BLADE.pivot[1]) * (1 - on);
      stretch = 1 + (0.18 + 0.12 * fast) * on;                            // a charged blade stretches a little more
      fade = 1 - sstep(SLASH.p1, SLASH.p1 + SLASH.trailFade, p);
      if (attackType === 'uppercut') {                                    // vertical slash: stay on the idle pose here, the rolled low -> high sweep is blended in below
        upOn = on; upPhi = p <= SLASH.p1 ? -ARC_HALF + 2 * ARC_HALF * u : ARC_HALF;
        th = ARC_HALF; yawB = BLADE.idleYaw + 0.04 * bob; pitchB = BLADE.idlePitch + 0.05 * bob; py = BLADE.pivot[1] + 0.035 * bob; stretch = 1 + (0.18 + 0.12 * fast) * on;
      }
    }
    let bx = -Math.sin(th) * ORBIT_R, bz = Math.cos(th) * ORBIT_R;
    // guard stance: the blade glides to a horizontal position across the front (not while a swing is running: the slash drops the guard anyway)
    if (upOn > 0) {                                                           // Uppercut: the hilt orbits a vertical circle in front of the right shoulder, blade radial and rolled 90 degrees
      const ux = UPPER.x, uy = BLADE.pivot[1] + Math.sin(upPhi) * ORBIT_R, uz = Math.cos(upPhi) * ORBIT_R;
      bx += (ux - bx) * upOn; bz += (uz - bz) * upOn; py += (uy - py) * upOn;
      pitchB += (-upPhi - pitchB) * upOn; yawB += (0 - yawB) * upOn; rollB = (Math.PI / 2) * upOn;
    }
    const gk = 1 - Math.exp(-GUARD.ease * dt), gc = 1 - Math.exp(-GUARD.colEase * dt);
    guardA += ((guardState > 0 ? 1 : 0) - guardA) * gk;
    guardC += ((guardState === 2 ? 1 : 0) - guardC) * gc;
    const gw = guardA * (p >= 0 && p < 1 ? 0 : 1);
    if (gw > 0.001) {
      bx += (GUARD.x - bx) * gw; bz += (GUARD.z - bz) * gw;
      py += (GUARD.y - py) * gw; yawB += (GUARD.yaw - yawB) * gw; pitchB *= (1 - gw);
    }
    bladeRig.position.set(bx, py * k, bz);
    bladeRig.rotation.set(pitchB, yawB, rollB, 'YXZ');
    bladeRig.scale.set(1, k, stretch);

    // guard barrier: fades in with the guard, bright cyan during the perfect window, a soft pulsing blue after it
    if (guardA > 0.02) {
      guardMesh.visible = true;
      guardMat.color.copy(GUARD.blue).lerp(GUARD.cyan, guardC);
      const pulse = 0.5 + 0.5 * Math.sin(t * 22);
      guardMat.opacity = guardA * (0.2 + 0.1 * pulse + guardC * (0.3 + 0.1 * pulse));
      guardMesh.position.y = GUARD.y * k - 0.1 * k; guardMesh.scale.set(1, k, 1);
    } else guardMesh.visible = false;

    // crescent trail: drawn behind the blade (u = how far the blade has swept), fading with distance and after the sweep ends
    if (u >= 0 && fade > 0.001) {
      trail.visible = true; trail.position.y = BLADE.pivot[1] * k;
      const upper = attackType === 'uppercut';                            // the crescent stands up in the YZ plane for an uppercut (sweeps low -> high)
      trail.rotation.z = upper ? Math.PI / 2 : 0; trail.position.x = upper ? UPPER.x : 0;
      const a = trailCol.array, n = SLASH.trailSegs;
      for (let i = 0; i <= n; i++) {
        const ui = i / n, age = u - ui;
        let al = 0;
        if (age >= 0) al = Math.pow(Math.max(0, 1 - age / (SLASH.trailTail + 0.3 * fast)), 1.4) * fade;   // a fast slash drags a longer crescent
        a[(i * 2) * 4 + 3] = al;                                          // outer edge: bright
        a[(i * 2 + 1) * 4 + 3] = al * 0.12;                               // inner edge: soft
      }
      trailCol.needsUpdate = true;
    } else trail.visible = false;
  }

  const api = {
    pod,
    // squash / stretch the pod to the current collider height (metres). Feet stay at the origin.
    setHeight,
    setFeet(x, y, z) { fx = x; fy = y; fz = z; if (mode === 'pod') applyPose(); },
    setYaw(a) { yaw = a; if (mode === 'pod') applyPose(); },
    setSpeed(unitsPerS) { spdT = unitsPerS; },
    setLean(x, z) {                                                      // clamp to tiltMax, keep the direction
      const a = Math.hypot(x, z), s = a > JUICE.tiltMax ? JUICE.tiltMax / a : 1;
      leanTX = x * s; leanTZ = z * s;
    },
    setMode,
    setAttack(v, type) { attackP = v; if (type) attackType = type; },
    setGuard(v) { guardState = v | 0; },
    flash(power = 1) { flashT = FLASH_TIME; flashPow = power; },
    update
  };
  return api;
}

export function createScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  // Bright 1.85 hemisphere + 1.65 sun can push light surfaces past white. The neutral tone mapper (three r162+) rolls highlights off WITHOUT shifting hues, so the palette stays
  // true. Older three builds simply skip it (the guard), and EXPOSURE is the single knob to turn the whole image down.
  if (THREE.NeutralToneMapping !== undefined) { renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = EXPOSURE; }
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // clear morning sky: a screen-space gradient (zenith at the top of the screen, pale horizon mist at the bottom), see SKY_STOPS
  const sky = document.createElement('canvas'); sky.width = 2; sky.height = 512;
  const sg = sky.getContext('2d'), grad = sg.createLinearGradient(0, 0, 0, 512);
  for (const [stop, col] of SKY_STOPS) grad.addColorStop(stop, col);
  sg.fillStyle = grad; sg.fillRect(0, 0, 2, 512);
  const skyTex = new THREE.CanvasTexture(sky); skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far);          // light atmospheric horizon mist (metres)

  // far = 640 m: the roof is 110 m x 75 m, but the skyline ring reaches 360 m from the centre (+ tower size, + the player standing near the roof edge)
  const camera = new THREE.PerspectiveCamera(CAM.fov, window.innerWidth / window.innerHeight, 0.1, 640);

  // lights: the sun follows the player (see setFocus) so one shadow map covers the area around you
  scene.add(new THREE.HemisphereLight(HEMI.sky, HEMI.ground, HEMI.intensity));   // cool daylight fill: shadowed faces keep their colour and shape
  const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);               // warm-white sun high in the sky: crisp, short shadows
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);                  // 1024 keeps District at 60+ FPS (was 4096)
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;                        // keeps the acne away on grazing faces
  scene.add(sun); scene.add(sun.target);

  const map = DISTRICT_MAP;

  // ---- floor slabs (top face at y = 0), world-aligned grid lines so neighbouring slabs line up
  const floorTex = makeFloorTexture(), ft = m(MAP.floorThickness);
  for (const s of floorSlabs(map)) {
    const W = m(s.hw) * 2, D = m(s.hd) * 2;
    const tex = floorTex.clone(); tex.needsUpdate = true;
    tex.repeat.set(W / TILE_M, D / TILE_M);
    tex.offset.set(((m(s.x - s.hw)) / TILE_M) % 1, (-(D + m(s.z - s.hd)) / TILE_M) % 1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, ft, D), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0.0 }));
    mesh.position.set(m(s.x), -ft / 2, m(s.z));
    mesh.castShadow = false;                                           // the floor never needs to cast: nothing is under it
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---- rim trims: a crisp light-steel coping strip (map.rect.lip wide) along the roof edge and around every skylight hole. Visual only.
  const lip = m(map.rect.lip), TH = 0.05, trimMat = new THREE.MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.5, metalness: 0.1 });
  const trim = (x0, x1, z0, z1) => {                                   // metres, axis-aligned rectangle on the floor
    const t = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, TH, z1 - z0), trimMat);
    t.position.set((x0 + x1) / 2, TH / 2, (z0 + z1) / 2); t.castShadow = false; t.receiveShadow = true; scene.add(t);
  };
  const rx = m(map.rect.hw), rz = m(map.rect.hd);
  trim(-rx, rx, -rz, -rz + lip); trim(-rx, rx, rz - lip, rz);                 // north / south edge
  trim(-rx, -rx + lip, -rz + lip, rz - lip); trim(rx - lip, rx, -rz + lip, rz - lip);   // west / east edge
  for (const h of map.holes) {
    const x0 = m(h.x - h.hw), x1 = m(h.x + h.hw), z0 = m(h.z - h.hd), z1 = m(h.z + h.hd);
    trim(x0 - lip, x1 + lip, z0 - lip, z0); trim(x0 - lip, x1 + lip, z1, z1 + lip);   // north / south of the hole
    trim(x0 - lip, x0, z0, z1); trim(x1, x1 + lip, z0, z1);                             // west / east of the hole
  }

  // ---- painted accent bands: collected here, drawn as a few InstancedMesh batches at the end (no shadows, no extra materials per band)
  const glow = { box: { white: [], crimson: [], chev: [] }, cyl: { gold: [] } };
  const gM = new THREE.Matrix4(), gP = new THREE.Vector3(), gS = new THREE.Vector3(), gQ = new THREE.Quaternion(), gE = new THREE.Euler();
  // kind 'box' = unit cube scaled to (sx, sy, sz); kind 'cyl' = unit cylinder scaled to (radius, height, radius). Centre (x, y, z) in metres.
  const strip = (kind, key, x, y, z, sx, sy, sz, q) => {
    gM.compose(gP.set(x, y, z), q || gQ.identity(), gS.set(sx, sy, sz));
    glow[kind][key].push(gM.clone());
  };
  // a flat band on a long face: u = offset along the box's long axis, n = offset along the face normal (both from the box centre)
  const onFace = (longX, cx, cz, u, y, n, su, sy, sn, key) => {
    if (longX) strip('box', key, cx + u, y, cz + n, su, sy, sn); else strip('box', key, cx + n, y, cz + u, sn, sy, su);
  };

  function accentBox(b) {
    const sp = boxSpan(b), cx = m(b.x), cz = m(b.z), hx = m(b.hw), hz = m(b.hd), top = m(sp.top);
    if (b.c === PALETTE.WALL) {
      // wall-run panels + the aerial fin: crimson-terracotta runner-vision strips on BOTH faces, so a wall reads from either lane: a crown line, a broad band under it,
      // a run-height line and slim end posts (everything else stays calm slate)
      const longX = hx >= hz, L = longX ? hx : hz, T = longX ? hz : hx, base = m(sp.y0);
      for (const side of [-1, 1]) {
        const n = side * T;
        onFace(longX, cx, cz, 0, top - 0.14, n, 2 * L - 0.5, 0.14, STRIP_PROUD, 'crimson');
        onFace(longX, cx, cz, 0, top - 0.52, n, 2 * L - 0.5, 0.40, STRIP_PROUD * 0.8, 'crimson');
        onFace(longX, cx, cz, 0, base + (top - base) * 0.36, n, 2 * L - 0.5, 0.08, STRIP_PROUD, 'crimson');
        for (const end of [-1, 1]) onFace(longX, cx, cz, end * (L - 0.14), (top + base) / 2, n, 0.12, top - base - 0.5, STRIP_PROUD, 'crimson');
      }
    }
    // (steel, limestone, concrete, the titanium bridge and the saffron beacon cap stay clean: colour and brushed texture only)
  }

  // ---- boxes (bottom at y0, default 0 = on the floor; y0 > 0 floats). UVs are rescaled so the brushed panel texture is PANEL_M metres per tile on every face.
  for (const b of map.boxes) {
    const { cy, height } = boxSpan(b);
    const W = m(b.hw) * 2, D = m(b.hd) * 2, Hh = m(height);
    const geo = new THREE.BoxGeometry(W, Hh, D);
    scaleBoxUV(geo, W, Hh, D, PANEL_M);
    const mesh = new THREE.Mesh(geo, matFor(b.c));
    mesh.position.set(m(b.x), m(cy), m(b.z));
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    accentBox(b);
  }

  // ---- pillars (grab-able): round, base on the floor, slate steel with one saffron band near the top (grab-me marker)
  for (const p of map.pillars) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(m(p.r), m(p.r), m(p.h), 28), matFor(p.c, false));
    mesh.position.set(m(p.x), m(p.h) / 2, m(p.z));
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    const r = m(p.r) + 0.035, top = m(p.h);
    strip('cyl', 'gold', m(p.x), top - 0.5, m(p.z), r, 0.22, r);
  }

  // ---- ramps: solid wedges. A ramp may carry its own palette colour (r.c). C.SPEED ramps get white edge lines along both slope edges and deep-amber chevrons that point downhill.
  const rampFallback = matFor(PALETTE.DECK);
  for (const r of map.ramps) {
    const geo = buildRampGeometry(r);
    scaleUV(geo, 1 / PANEL_M);
    const mesh = new THREE.Mesh(geo, r.c ? matFor(r.c) : rampFallback);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    if (r.c === PALETTE.SPEED) {
      const s = rampSpan(r), run = m(s.len), rise = m(s.y1 - s.y0), slope = Math.hypot(run, rise), ang = Math.atan2(rise, run);
      const ax = Math.sin(s.rotY), az = Math.cos(s.rotY);                  // local +z (across the ramp) in world space
      const dx = Math.cos(s.rotY), dz = -Math.sin(s.rotY);                 // local +x (up the slope), horizontal part, in world space
      const qBase = new THREE.Quaternion().setFromEuler(gE.set(0, s.rotY, ang, 'YXZ'));   // tilt along the slope, then turn to the ascent direction
      const y = m((s.y0 + s.y1) / 2) + 0.012, off = m(s.wid) / 2 - 0.2;
      for (const side of [-1, 1]) strip('box', 'white', m(s.cx) + ax * off * side, y, m(s.cz) + az * off * side, slope - 0.2, 0.05, 0.16, qBase);
      // chevrons: each is a V whose apex points DOWNHILL (toward the low edge): two bars angled `beta` off the slope axis, spaced 2.4 m apart along the slope
      const beta = 0.7, L = Math.min(2.2, m(s.wid) * 0.26), n = Math.max(2, Math.floor((slope - 3) / 2.4) + 1), qArm = new THREE.Quaternion();
      for (let i = 0; i < n; i++) {
        const tt = (i - (n - 1) / 2) * 2.4;                                // apex position along the slope, from the ramp centre
        for (const sg of [-1, 1]) {
          const lx = tt + 0.5 * L * Math.cos(beta), lz = sg * 0.5 * L * Math.sin(beta);
          const px = m(s.cx) + dx * lx * Math.cos(ang) + ax * lz, pz = m(s.cz) + dz * lx * Math.cos(ang) + az * lz, py = y + lx * Math.sin(ang) + 0.012;
          qArm.setFromAxisAngle(Y_AXIS, -sg * beta);
          strip('box', 'chev', px, py, pz, L, 0.05, 0.3, qBase.clone().multiply(qArm));
        }
      }
    }
  }

  // ---- flush the accent bands: one InstancedMesh (= one draw call) per shape and colour. Plain matte paint: no emissive, no glow.
  const unitBox = new THREE.BoxGeometry(1, 1, 1), unitCyl = new THREE.CylinderGeometry(1, 1, 1, 28);
  for (const kind of ['box', 'cyl']) {
    for (const key of Object.keys(glow[kind])) {
      const list = glow[kind][key];
      if (!list.length) continue;
      const mat = new THREE.MeshStandardMaterial({ color: PAINT[key], roughness: 0.5, metalness: 0.1 });
      const inst = new THREE.InstancedMesh(kind === 'box' ? unitBox : unitCyl, mat, list.length);
      list.forEach((mx, i) => inst.setMatrixAt(i, mx));
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;                                       // a few dozen tiny instances: cheaper than computing bounds
      inst.castShadow = false; inst.receiveShadow = false;
      scene.add(inst);
    }
  }

  // ---- distant city skyline: ONE InstancedMesh (one draw call) of SKYLINE.count towers in a ring SKYLINE.rMin..rMax metres round the arena centre. No shadows (neither cast nor
  // received), flat pale colours via instanceColor, and the scene fog melts the far ones into the horizon mist. The base sits SKYLINE.baseY below the roof (a city street far below)
  // and the tops climb with distance (topNear .. topFar relative to the roof), so near towers stay below eye level and the far skyline stands against the sky.
  {
    const rnd = makeRnd(20260), n = SKYLINE.count, tint = new THREE.Color(), mx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);                // unit tower standing on y = 0
    const skyline = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    const TONES = [0xc3cfdb, 0xd2dae3, 0xb4c2d1, 0xdfe4ea, 0xcdc8be, 0xa9b8c9];     // cool glass greys + a few warm limestone towers
    for (let i = 0; i < n; i++) {
      const ang = ((i + 0.15 + rnd() * 0.7) / n) * Math.PI * 2;                      // one tower per angular slot: an even ring with natural jitter
      const k = rnd(), r = SKYLINE.rMin + (SKYLINE.rMax - SKYLINE.rMin) * k;
      const w = SKYLINE.wMin + (SKYLINE.wMax - SKYLINE.wMin) * rnd(), d = SKYLINE.wMin + (SKYLINE.wMax - SKYLINE.wMin) * rnd();
      const top = SKYLINE.topNear + (SKYLINE.topFar - SKYLINE.topNear) * Math.min(1, k * 0.75 + rnd() * 0.25);
      q.setFromAxisAngle(Y_AXIS, rnd() * Math.PI);
      mx.compose(pos.set(Math.cos(ang) * r, SKYLINE.baseY, Math.sin(ang) * r), q, scl.set(w, top - SKYLINE.baseY, d));
      skyline.setMatrixAt(i, mx);
      skyline.setColorAt(i, tint.setHex(TONES[Math.floor(rnd() * TONES.length)]));
    }
    skyline.instanceMatrix.needsUpdate = true; skyline.instanceColor.needsUpdate = true;
    skyline.frustumCulled = false; skyline.castShadow = false; skyline.receiveShadow = false;
    scene.add(skyline);
  }

  // ---- IT marker: ONE emissive red cone, tip down, hovering above whoever is IT (bobs a little)
  const itMarker = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.45, 12),
    new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1010, emissiveIntensity: 1.6, roughness: 0.4 })
  );
  itMarker.rotation.x = Math.PI;                                       // ConeGeometry points up; flip it so the tip points down
  itMarker.visible = false;
  scene.add(itMarker);

  // (x, y, z) = point just above the IT puppet's head, in metres; t = time in seconds for the bob. Pass null to hide.
  function setItMarker(pos, t = 0) {
    if (!pos) { itMarker.visible = false; return; }
    itMarker.visible = true;
    itMarker.position.set(pos.x, pos.y + 0.12 * Math.sin(t * 5), pos.z);
    itMarker.rotation.y = t * 2;
  }

  // keep the sun (and its shadow box) around the player, so the whole roof gets shadows where you actually are
  function setFocus(feet) {
    sun.position.set(feet.x + SUN.offset[0], feet.y + SUN.offset[1], feet.z + SUN.offset[2]);
    sun.target.position.set(feet.x, feet.y, feet.z);
    sun.target.updateMatrixWorld();
  }

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // ---- grapple tether: one thin glowing cylinder + a hook ball per player, created on first use
  const ropeGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 8), hookGeo = new THREE.SphereGeometry(0.13, 10, 8);
  const ropeMat = new THREE.MeshBasicMaterial({ color: 0x0e7490, toneMapped: false });   // deep teal: readable against the bright sky and the light floor
  const ropes = [], UP = new THREE.Vector3(0, 1, 0), rdir = new THREE.Vector3();
  // from / to = {x, y, z} in metres (torso, anchor); pass null to hide this player's rope.
  function setGrapple(idx, from, to) {
    let r = ropes[idx];
    if (!r) {
      r = ropes[idx] = { line: new THREE.Mesh(ropeGeo, ropeMat), hook: new THREE.Mesh(hookGeo, ropeMat) };
      r.line.visible = r.hook.visible = false;
      r.line.frustumCulled = false;
      scene.add(r.line); scene.add(r.hook);
    }
    if (!from || !to) { r.line.visible = r.hook.visible = false; return; }
    rdir.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const len = rdir.length();
    if (len < 1e-4) { r.line.visible = r.hook.visible = false; return; }
    rdir.divideScalar(len);
    r.line.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    r.line.quaternion.setFromUnitVectors(UP, rdir);
    r.line.scale.set(1, len, 1);
    r.hook.position.set(to.x, to.y, to.z);
    r.line.visible = r.hook.visible = true;
  }

  // ---- puppets: every pod is registered here so view.update(dt) can animate the floating blades, slash trails and hit flashes
  const puppets = [];
  function addPuppet(color) { const pu = createPuppet(scene, color); puppets.push(pu); return pu; }
  // ---- shockwave rings (Air Dive Slam, NORMAL blending so they pop in daylight): a teal ring + a saffron inner ring + a faint disc expand over `dur` s to `radius` m on the floor, then remove themselves
  const shockRingGeo = new THREE.RingGeometry(0.8, 1, 64).rotateX(-Math.PI / 2), shockDiscGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  const shocks = [];
  function spawnShockwave(x, y, z, radius, dur = 0.3) {
    const mk = (geo, hex) => { const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.NormalBlending, depthWrite: false, toneMapped: false, fog: false })); mesh.position.set(x, y + 0.06, z); mesh.scale.setScalar(0.05); mesh.frustumCulled = false; mesh.renderOrder = 4; scene.add(mesh); return mesh; };
    shocks.push({ t: 0, dur, radius, ring: mk(shockRingGeo, 0x00c8b0), inner: mk(shockRingGeo, 0xf59e0b), disc: mk(shockDiscGeo, 0x00c8b0) });
  }
  function updateShocks(dt) {
    for (let i = shocks.length - 1; i >= 0; i--) {
      const sw = shocks[i]; sw.t += dt;
      const kk = Math.min(1, sw.t / sw.dur), e = 1 - Math.pow(1 - kk, 3), fade = Math.pow(1 - kk, 1.4);
      sw.ring.scale.setScalar(Math.max(0.05, sw.radius * e)); sw.ring.material.opacity = 0.95 * fade;
      sw.inner.scale.setScalar(Math.max(0.05, sw.radius * e * 0.72)); sw.inner.material.opacity = 0.8 * fade;
      sw.disc.scale.setScalar(Math.max(0.05, sw.radius * e)); sw.disc.material.opacity = 0.22 * fade;
      if (kk >= 1) { for (const o of [sw.ring, sw.inner, sw.disc]) { scene.remove(o); o.material.dispose(); } shocks.splice(i, 1); }
    }
  }
  function update(dt) { for (const pu of puppets) pu.update(dt); updateShocks(dt); }

  return { renderer, scene, camera, addPuppet, update, spawnShockwave, setItMarker, setFocus, setGrapple };
}
