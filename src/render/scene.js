// src/render/scene.js
// RENDER (1/2): the Three.js renderer, lights, the District map (floor slabs with rim trims, boxes, pillars, ramp wedges),
// and one puppet per player: a faceless satin-dark armour capsule with emissive energy-core rings (squashes while sliding) plus a hidden
// 6-part ragdoll mesh set that matches RAGDOLL_RIG, the red "IT" cone marker and the glowing grapple tether (setGrapple).
// LOOK: sleek cinematic cyber-dusk (Mirror's Edge Catalyst / Ghostrunner / Titanfall 2). A low amber sun, a midnight-to-sunset sky gradient, dark
// architectural materials and "runner vision" emissive accents (cyan wall-run strips, amber billboard faces, gold pad / speed-ramp edges, beacon rings
// on towers and pillars). No background geometry at all (no skyline, facade or street): just the dusk sky gradient and a slate horizon fog.
// Meshes are built from the same map data and helpers (game/maps.js) as the physics colliders, so they always match.
// Accent strips are collected into a handful of InstancedMesh batches (one draw call per colour / shape, no shadows) to keep District at 60+ FPS.
// Loads after: config.js, game/maps.js, physics/ragdoll.js (RAGDOLL_RIG dimensions only)

import * as THREE from 'three';
import { m, PUPPET, CAM, MAP } from '../config.js';
import DISTRICT_MAP, { PALETTE, floorSlabs, rampSpan, boxSpan } from '../game/maps.js';
import { RAGDOLL_RIG } from '../physics/ragdoll.js';

// ---- look tuning (everything the dusk mood depends on lives here) -------------------------------------------------------------
const TRIM_COLOR = 0x8d99ae, TILE_M = 5;                                   // silver-grey coping trim; floor grid tile (metres): gives a sense of speed
const SKY_STOPS = [[0, '#090d16'], [0.34, '#1a2436'], [0.66, '#e06d53'], [1, '#ffb07c']];   // zenith midnight slate -> steel blue -> coral -> amber horizon (screen space, top -> bottom)
const FOG = { color: 0x262b3d, near: 180, far: 950 };                       // atmospheric horizon fog (metres)
const SUN = { color: 0xffcfa8, intensity: 2.1, offset: [62, 34, 22] };      // warm golden-amber, ~27 degrees above the horizon: long cinematic shadows
const HEMI = { sky: 0x6c88b5, ground: 0x1b202b, intensity: 1.1 };           // cool slate-blue bounce
const GLOW = { cyan: 0x00e5ff, amber: 0xff7b29, gold: 0xffaa00 };           // runner-vision accents
const GLOW_INTENSITY = 1.8;
const STRIP_PROUD = 0.06;                                                   // strip thickness along the face normal (half of it stands proud of the surface)

// map colours are [r, g, b] in 0-255 (sRGB)
const rgb = (c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

// Finish per palette entry: [roughness, metalness]. Metalness stays modest because there is no environment map (metals only light up under the sun).
const SURFACE = new Map([
  [PALETTE.DECK, [0.55, 0.30]],      // gunmetal steel
  [PALETTE.COVER, [0.90, 0.05]],     // weathered slate concrete
  [PALETTE.BRIDGE, [0.35, 0.35]],    // light titanium
  [PALETTE.BILL, [0.70, 0.10]],      // charcoal frame
  [PALETTE.WALL, [0.60, 0.20]],      // carbon-blue panels
  [PALETTE.PAD, [0.55, 0.35]],       // industrial iron
  [PALETTE.SPEED, [0.55, 0.35]],     // industrial iron
  [PALETTE.TOWER, [0.80, 0.20]],     // matte obsidian steel
  [PALETTE.PILLAR, [0.80, 0.20]]
]);
const surface = (c) => SURFACE.get(c) || [0.85, 0.10];

// One shared material per colour, so 70-odd meshes do not mean 70 materials.
const matCache = new Map();
function matFor(c) {
  const [roughness, metalness] = surface(c);
  const key = c.join(',') + '|' + roughness + '|' + metalness;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color: rgb(c), roughness, metalness }));
  return matCache.get(key);
}

// Floor texture: dark brushed architectural concrete with a subtle metallic expansion-joint line on every tile border, drawn once and
// reused (cloned per slab for its own repeat / offset). The brushed grain wraps around the tile edges so the tile stays seamless.
function makeFloorTexture() {
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#1e232b'; g.fillRect(0, 0, S, S);
  let seed = 1337; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;     // tiny deterministic PRNG: same floor every load
  for (let i = 0; i < 520; i++) {
    const x = rnd() * S, y = rnd() * S, len = 30 + rnd() * 120, a = 0.015 + rnd() * 0.03;
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,' + a.toFixed(3) + ')' : 'rgba(0,0,0,' + (a * 1.6).toFixed(3) + ')';
    g.fillRect(x, y, len, 1);
    if (x + len > S) g.fillRect(x - S, y, len, 1);                                           // wrap horizontally
  }
  g.fillStyle = 'rgba(44,51,63,0.35)'; g.fillRect(0, S / 2, S, 1); g.fillRect(S / 2, 0, 1, S);   // faint half-tile guide
  g.fillStyle = '#12161c'; g.fillRect(0, 2, S, 1); g.fillRect(2, 0, 1, S);                   // joint groove (inner shadow)
  g.fillStyle = '#2c333f'; g.fillRect(0, 0, S, 2); g.fillRect(0, 0, 2, S);                   // expansion-joint line on the tile border
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
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
// Geometry is shared by every puppet; each puppet owns two materials: satin-dark armour tinted with the player colour, and an emissive
// "energy core" in the pure player colour (chest + shoulder rings on the capsule, a chest band + shoulder caps on the ragdoll).
// Everything is faceless by design, and the rings are rotation-symmetric, so the capsule needs no facing.
const ARMOR_DARKEN = 0.5, CORE_EMISSIVE = 0.65;
const DARK_STEEL = new THREE.Color(0x10141b);
let capsuleGeo = null, ragGeo = null, ringGeo = null;
function getGeos() {
  if (!capsuleGeo) {
    const radius = m(PUPPET.radius), total = m(PUPPET.height), R = RAGDOLL_RIG;
    capsuleGeo = new THREE.CapsuleGeometry(radius, total - 2 * radius, 6, 14);
    ringGeo = {
      chest: new THREE.TorusGeometry(radius + 0.005, 0.032, 8, 28).rotateX(Math.PI / 2),
      shoulder: new THREE.TorusGeometry(radius + 0.005, 0.02, 8, 28).rotateX(Math.PI / 2)
    };
    ragGeo = {
      torso: new THREE.BoxGeometry(R.torso.hx * 2, R.torso.hy * 2, R.torso.hz * 2),
      head: new THREE.SphereGeometry(R.head.r, 14, 10),
      arm: new THREE.CapsuleGeometry(R.arm.r, R.arm.hh * 2, 4, 8),
      leg: new THREE.CapsuleGeometry(R.leg.r, R.leg.hh * 2, 4, 8),
      coreBand: new THREE.BoxGeometry(R.torso.hx * 2 + 0.03, R.torso.hy * 0.45, R.torso.hz * 2 + 0.03),
      shoulderCap: new THREE.SphereGeometry(R.arm.r * 1.15, 10, 8)
    };
  }
  return { capsuleGeo, ragGeo, ringGeo };
}

// One puppet: `capsule` (origin = feet) for normal play and `parts` (6 meshes with origin at the body centre, positioned in WORLD
// space by ragdoll.js syncRagdollMeshes) for the on-demand ragdoll. Only one of the two is visible at a time.
function createPuppet(scene, color) {
  const { capsuleGeo, ragGeo, ringGeo } = getGeos();
  const total = m(PUPPET.height), radius = m(PUPPET.radius), cyl = Math.max(total - 2 * radius, 0), R = RAGDOLL_RIG;
  const base = new THREE.Color(color);
  const armor = new THREE.MeshStandardMaterial({ color: base.clone().lerp(DARK_STEEL, ARMOR_DARKEN), roughness: 0.35, metalness: 0.25 });
  const core = new THREE.MeshStandardMaterial({ color: base, emissive: base, emissiveIntensity: CORE_EMISSIVE, roughness: 0.3, metalness: 0.1 });

  const capsule = new THREE.Group();
  const body = new THREE.Mesh(capsuleGeo, armor);
  body.position.y = total / 2;
  body.castShadow = true;
  capsule.add(body);
  const chest = new THREE.Mesh(ringGeo.chest, core), shoulder = new THREE.Mesh(ringGeo.shoulder, core);   // energy core: lit in the dark, readable in shadow
  capsule.add(chest); capsule.add(shoulder);
  scene.add(capsule);

  const ragGroup = new THREE.Group();
  const part = (geo) => { const mesh = new THREE.Mesh(geo, armor); mesh.castShadow = true; ragGroup.add(mesh); return mesh; };
  const parts = {
    torso: part(ragGeo.torso), head: part(ragGeo.head),
    armL: part(ragGeo.arm), armR: part(ragGeo.arm),
    legL: part(ragGeo.leg), legR: part(ragGeo.leg)
  };
  // ragdoll energy core: children follow their part, so syncRagdollMeshes needs no change
  const band = new THREE.Mesh(ragGeo.coreBand, core); band.position.y = R.torso.hy * 0.35; parts.torso.add(band);
  for (const arm of [parts.armL, parts.armR]) { const cap = new THREE.Mesh(ragGeo.shoulderCap, core); cap.position.y = R.arm.hh * 0.9; arm.add(cap); }
  ragGroup.visible = false;
  scene.add(ragGroup);

  // rings sit on the straight part of the capsule (chest low, shoulders high) and follow the squash, so a slide pulls them down with the body
  function setHeight(h) {
    const s = h / total;
    body.scale.y = s; body.position.y = h / 2;
    chest.position.y = s * (radius + 0.42 * cyl);
    shoulder.position.y = s * (radius + 0.86 * cyl);
  }
  setHeight(total);

  return {
    capsule, parts,
    // squash / stretch the capsule to the current collider height (metres). Feet stay at the origin.
    setHeight,
    setFeet(x, y, z) { capsule.position.set(x, y, z); },
    showCapsule(v) { capsule.visible = v; },
    showRagdoll(v) { ragGroup.visible = v; }
  };
}

export function createScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // cinematic dusk sky: a screen-space gradient (zenith at the top of the screen, horizon glow at the bottom), see SKY_STOPS
  const sky = document.createElement('canvas'); sky.width = 2; sky.height = 512;
  const sg = sky.getContext('2d'), grad = sg.createLinearGradient(0, 0, 0, 512);
  for (const [stop, col] of SKY_STOPS) grad.addColorStop(stop, col);
  sg.fillStyle = grad; sg.fillRect(0, 0, 2, 512);
  const skyTex = new THREE.CanvasTexture(sky); skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far);          // slate atmospheric horizon haze (metres)

  // far = 400 m: the roof is ~120 m x 85 m and there is no background geometry, so nothing lives beyond that
  const camera = new THREE.PerspectiveCamera(CAM.fov, window.innerWidth / window.innerHeight, 0.1, 400);

  // lights: the sun follows the player (see setFocus) so one shadow map covers the area around you
  scene.add(new THREE.HemisphereLight(HEMI.sky, HEMI.ground, HEMI.intensity));   // cool slate bounce: shadowed faces keep their shape
  const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);               // low golden-amber sun: long shadows off towers, walls and runners
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);                  // 1024 keeps District at 60+ FPS (was 4096)
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;                        // a low sun grazes every surface: this keeps the acne away
  scene.add(sun); scene.add(sun.target);

  const map = DISTRICT_MAP;

  // ---- floor slabs (top face at y = 0), world-aligned grid lines so neighbouring slabs line up
  const floorTex = makeFloorTexture(), ft = m(MAP.floorThickness);
  for (const s of floorSlabs(map)) {
    const W = m(s.hw) * 2, D = m(s.hd) * 2;
    const tex = floorTex.clone(); tex.needsUpdate = true;
    tex.repeat.set(W / TILE_M, D / TILE_M);
    tex.offset.set(((m(s.x - s.hw)) / TILE_M) % 1, (-(D + m(s.z - s.hd)) / TILE_M) % 1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, ft, D), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.05 }));
    mesh.position.set(m(s.x), -ft / 2, m(s.z));
    mesh.castShadow = false;                                           // the floor never needs to cast: nothing is under it
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---- rim trims: a crisp silver-grey coping strip (map.rect.lip wide) along the roof edge and around every skylight hole. Visual only.
  const lip = m(map.rect.lip), TH = 0.05, trimMat = new THREE.MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.4, metalness: 0.2 });
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

  // ---- runner-vision accent strips: collected here, drawn as a few InstancedMesh batches at the end (no shadows, no extra materials per strip)
  const glow = { box: { cyan: [], amber: [], gold: [] }, cyl: { cyan: [], amber: [] } };
  const gM = new THREE.Matrix4(), gP = new THREE.Vector3(), gS = new THREE.Vector3(), gQ = new THREE.Quaternion(), gE = new THREE.Euler();
  // kind 'box' = unit cube scaled to (sx, sy, sz); kind 'cyl' = unit cylinder scaled to (radius, height, radius). Centre (x, y, z) in metres.
  const strip = (kind, key, x, y, z, sx, sy, sz, q) => {
    gM.compose(gP.set(x, y, z), q || gQ.identity(), gS.set(sx, sy, sz));
    glow[kind][key].push(gM.clone());
  };
  // a flat strip on a long face: u = offset along the box's long axis, n = offset along the face normal (both from the box centre)
  const onFace = (longX, cx, cz, u, y, n, su, sy, sn, key) => {
    if (longX) strip('box', key, cx + u, y, cz + n, su, sy, sn); else strip('box', key, cx + n, y, cz + u, sn, sy, su);
  };

  function accentBox(b) {
    const sp = boxSpan(b), cx = m(b.x), cz = m(b.z), cy = m(sp.cy), hx = m(b.hw), hz = m(b.hd), H = m(sp.height), top = m(sp.top);
    if (b.c === PALETTE.WALL) {
      // wall-run panels: a cyan crown line, a cyan run-height line and cyan end posts on BOTH faces, so a wall reads from either lane
      const longX = hx >= hz, L = longX ? hx : hz, T = longX ? hz : hx;
      for (const side of [-1, 1]) {
        const n = side * T;
        onFace(longX, cx, cz, 0, top - 0.14, n, 2 * L - 0.5, 0.14, STRIP_PROUD, 'cyan');
        onFace(longX, cx, cz, 0, top * 0.36, n, 2 * L - 0.5, 0.08, STRIP_PROUD, 'cyan');
        for (const end of [-1, 1]) onFace(longX, cx, cz, end * (L - 0.14), top / 2, n, 0.12, top - 0.5, STRIP_PROUD, 'cyan');
      }
    } else if (b.c === PALETTE.BILL) {
      // billboards: a glowing sunset-amber face panel inside the charcoal frame, both sides
      const longX = hx >= hz, L = longX ? hx : hz, T = longX ? hz : hx;
      for (const side of [-1, 1]) onFace(longX, cx, cz, 0, cy, side * T, 2 * L * 0.94, H * 0.72, STRIP_PROUD, 'amber');
    } else if (b.c === PALETTE.TOWER) {
      // spire beacon rings near the top: cyan above, amber below (a band a hair wider than the shaft)
      strip('box', 'cyan', cx, top - 0.55, cz, 2 * hx + 0.07, 0.16, 2 * hz + 0.07);
      strip('box', 'amber', cx, top - 1.05, cz, 2 * hx + 0.07, 0.10, 2 * hz + 0.07);
    } else if (b.c === PALETTE.SPEED && (b.y0 || 0) > 0) {
      // spire cap: one molten-gold band round the cap
      strip('box', 'gold', cx, cy, cz, 2 * hx + 0.07, H * 0.4, 2 * hz + 0.07);
    } else if (b.c === PALETTE.PAD) {
      // launch pad: molten-gold strips along the four top edges
      const y = top + 0.02, w = 0.14, ix = 0.18;
      strip('box', 'gold', cx, y, cz - hz + ix, 2 * hx - 2 * ix, 0.05, w);
      strip('box', 'gold', cx, y, cz + hz - ix, 2 * hx - 2 * ix, 0.05, w);
      strip('box', 'gold', cx - hx + ix, y, cz, w, 0.05, 2 * hz - 2 * ix);
      strip('box', 'gold', cx + hx - ix, y, cz, w, 0.05, 2 * hz - 2 * ix);
    }
  }

  // ---- boxes (bottom at y0, default 0 = on the floor; y0 > 0 floats)
  for (const b of map.boxes) {
    const { cy, height } = boxSpan(b);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(m(b.hw) * 2, m(height), m(b.hd) * 2), matFor(b.c));
    mesh.position.set(m(b.x), m(cy), m(b.z));
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    accentBox(b);
  }

  // ---- pillars (grab-able): round, base on the floor, cyan + amber beacon rings near the top
  for (const p of map.pillars) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(m(p.r), m(p.r), m(p.h), 28), matFor(p.c));
    mesh.position.set(m(p.x), m(p.h) / 2, m(p.z));
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    const r = m(p.r) + 0.035, top = m(p.h);
    strip('cyl', 'cyan', m(p.x), top - 0.5, m(p.z), r, 0.16, r);
    strip('cyl', 'amber', m(p.x), top - 1.0, m(p.z), r, 0.10, r);
  }

  // ---- ramps: solid wedges. A ramp may carry its own palette colour (r.c); C.SPEED ramps get molten-gold strips along both slope edges.
  const rampFallback = matFor(PALETTE.DECK);
  for (const r of map.ramps) {
    const mesh = new THREE.Mesh(buildRampGeometry(r), r.c ? matFor(r.c) : rampFallback);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    if (r.c === PALETTE.SPEED) {
      const s = rampSpan(r), run = m(s.len), rise = m(s.y1 - s.y0), slope = Math.hypot(run, rise), ang = Math.atan2(rise, run);
      const ax = Math.sin(s.rotY), az = Math.cos(s.rotY);                  // local +z (across the ramp) in world space
      const q = new THREE.Quaternion().setFromEuler(gE.set(0, s.rotY, ang, 'YXZ'));   // tilt along the slope, then turn to the ascent direction
      const y = m((s.y0 + s.y1) / 2) + 0.012, off = m(s.wid) / 2 - 0.2;
      for (const side of [-1, 1]) strip('box', 'gold', m(s.cx) + ax * off * side, y, m(s.cz) + az * off * side, slope - 0.2, 0.05, 0.16, q);
    }
  }

  // ---- flush the accent strips: one InstancedMesh (= one draw call) per shape and colour
  const unitBox = new THREE.BoxGeometry(1, 1, 1), unitCyl = new THREE.CylinderGeometry(1, 1, 1, 28);
  for (const kind of ['box', 'cyl']) {
    for (const key of Object.keys(glow[kind])) {
      const list = glow[kind][key];
      if (!list.length) continue;
      const hexColor = GLOW[key];
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hexColor).multiplyScalar(0.25), emissive: hexColor, emissiveIntensity: GLOW_INTENSITY, roughness: 0.5, metalness: 0
      });
      const inst = new THREE.InstancedMesh(kind === 'box' ? unitBox : unitCyl, mat, list.length);
      list.forEach((mx, i) => inst.setMatrixAt(i, mx));
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;                                       // a few dozen tiny instances: cheaper than computing bounds
      inst.castShadow = false; inst.receiveShadow = false;
      scene.add(inst);
    }
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

  // keep the sun (and its shadow box) around the player, so the whole 105 m roof gets shadows where you actually are
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
  const ropeMat = new THREE.MeshBasicMaterial({ color: 0x7fe9ff, toneMapped: false });
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

  return { renderer, scene, camera, addPuppet: (color) => createPuppet(scene, color), setItMarker, setFocus, setGrapple };
}
