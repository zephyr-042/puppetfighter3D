// src/render/scene.js
// RENDER (1/2): the Three.js renderer, lights, the District map (floor slabs with rim trims, boxes, pillars, ramp wedges),
// and one puppet per player: a faceless coloured capsule (squashes while sliding) plus a hidden 6-part ragdoll mesh set that
// matches RAGDOLL_RIG, the red "IT" cone marker and the glowing grapple tether (setGrapple). No background geometry at all (no skyline, facade or street): just the sky gradient.
// Meshes are built from the same map data and helpers (game/maps.js) as the physics colliders, so they always match.
// Loads after: config.js, game/maps.js, physics/ragdoll.js (RAGDOLL_RIG dimensions only)

import * as THREE from 'three';
import { m, PUPPET, CAM, MAP } from '../config.js';
import DISTRICT_MAP, { floorSlabs, rampSpan } from '../game/maps.js';
import { RAGDOLL_RIG } from '../physics/ragdoll.js';

const FLOOR_COLOR = 0x4a5662, TRIM_COLOR = 0x9aa4b4, TILE_M = 5;   // floor grid tile (metres): gives a sense of speed

// map colours are [r, g, b] in 0-255 (sRGB)
const rgb = (c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

// One shared material per colour, so 70-odd meshes do not mean 70 materials.
const matCache = new Map();
function matFor(c, roughness = 0.85) {
  const key = c.join(',') + '|' + roughness;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color: rgb(c), roughness }));
  return matCache.get(key);
}

// Floor texture: a faint grid line on every tile border, drawn once and reused (cloned per slab for its own repeat / offset).
function makeFloorTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#4a5662'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, 128, 128);       // slightly lighter tile face
  g.fillStyle = '#39434e'; g.fillRect(0, 0, 128, 2); g.fillRect(0, 0, 2, 128);   // tile border lines
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Solid ramp wedge: the side profile (low edge y0, high edge y1, flat bottom) extruded across the ramp width,
// then turned so local +x points up the slope. Exported so a test can compare it with the physics hull.
export function buildRampGeometry(r) {
  const s = rampSpan(r), L = m(s.len), W = m(s.wid);
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, 0); shape.lineTo(L / 2, 0); shape.lineTo(L / 2, m(s.y1)); shape.lineTo(-L / 2, m(s.y0)); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  geo.translate(0, 0, -W / 2);
  geo.rotateY(s.rotY);
  geo.translate(m(s.cx), 0, m(s.cz));
  return geo;
}

// ---- puppets ---------------------------------------------------------------------------------------------------------------
// Geometry is shared by every puppet; each puppet owns one coloured material. Everything is faceless by design.
let capsuleGeo = null, ragGeo = null;
function getGeos() {
  if (!capsuleGeo) {
    const radius = m(PUPPET.radius), total = m(PUPPET.height), R = RAGDOLL_RIG;
    capsuleGeo = new THREE.CapsuleGeometry(radius, total - 2 * radius, 6, 14);
    ragGeo = {
      torso: new THREE.BoxGeometry(R.torso.hx * 2, R.torso.hy * 2, R.torso.hz * 2),
      head: new THREE.SphereGeometry(R.head.r, 14, 10),
      arm: new THREE.CapsuleGeometry(R.arm.r, R.arm.hh * 2, 4, 8),
      leg: new THREE.CapsuleGeometry(R.leg.r, R.leg.hh * 2, 4, 8)
    };
  }
  return { capsuleGeo, ragGeo };
}

// One puppet: `capsule` (origin = feet) for normal play and `parts` (6 meshes with origin at the body centre, positioned in WORLD
// space by ragdoll.js syncRagdollMeshes) for the on-demand ragdoll. Only one of the two is visible at a time.
function createPuppet(scene, color) {
  const { capsuleGeo, ragGeo } = getGeos();
  const total = m(PUPPET.height);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });

  const capsule = new THREE.Group();
  const body = new THREE.Mesh(capsuleGeo, mat);
  body.position.y = total / 2;
  body.castShadow = true;
  capsule.add(body);
  scene.add(capsule);

  const ragGroup = new THREE.Group();
  const part = (geo) => { const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; ragGroup.add(mesh); return mesh; };
  const parts = {
    torso: part(ragGeo.torso), head: part(ragGeo.head),
    armL: part(ragGeo.arm), armR: part(ragGeo.arm),
    legL: part(ragGeo.leg), legR: part(ragGeo.leg)
  };
  ragGroup.visible = false;
  scene.add(ragGroup);

  return {
    capsule, parts,
    // squash / stretch the capsule to the current collider height (metres). Feet stay at the origin.
    setHeight(h) { body.scale.y = h / total; body.position.y = h / 2; },
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
  // night sky: a screen-space gradient, lighter toward the bottom so looking down reads as a glowing city
  const sky = document.createElement('canvas'); sky.width = 2; sky.height = 256;
  const sg = sky.getContext('2d'), grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#04070f'); grad.addColorStop(0.55, '#0b1226'); grad.addColorStop(1, '#1b2742');
  sg.fillStyle = grad; sg.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(sky); skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0x0f1830, 160, 900);

  // far = 400 m: the roof is ~105 m across and there is no background geometry, so nothing lives beyond that
  const camera = new THREE.PerspectiveCamera(CAM.fov, window.innerWidth / window.innerHeight, 0.1, 400);

  // lights: the sun follows the player (see setFocus) so one shadow map covers the area around you
  scene.add(new THREE.HemisphereLight(0xcfdcff, 0x4a5468, 1.5));    // strong ambient: wall faces must stay readable at speed
  const sun = new THREE.DirectionalLight(0xdfe8ff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);                  // 1024 keeps District at 60+ FPS (was 4096)
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 200;
  sun.shadow.bias = -0.0004;
  scene.add(sun); scene.add(sun.target);

  const map = DISTRICT_MAP;

  // ---- floor slabs (top face at y = 0), world-aligned grid lines so neighbouring slabs line up
  const floorTex = makeFloorTexture(), ft = m(MAP.floorThickness);
  for (const s of floorSlabs(map)) {
    const W = m(s.hw) * 2, D = m(s.hd) * 2;
    const tex = floorTex.clone(); tex.needsUpdate = true;
    tex.repeat.set(W / TILE_M, D / TILE_M);
    tex.offset.set(((m(s.x - s.hw)) / TILE_M) % 1, (-(D + m(s.z - s.hd)) / TILE_M) % 1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, ft, D), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    mesh.position.set(m(s.x), -ft / 2, m(s.z));
    mesh.castShadow = false;                                           // the floor never needs to cast: nothing is under it
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---- rim trims: a light coping strip (map.rect.lip wide) along the roof edge and around every skylight hole. Visual only.
  const lip = m(map.rect.lip), TH = 0.05, trimMat = new THREE.MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.6 });
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

  // ---- boxes (base on the floor)
  for (const b of map.boxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(m(b.hw) * 2, m(b.h), m(b.hd) * 2), matFor(b.c));
    mesh.position.set(m(b.x), m(b.h) / 2, m(b.z));
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---- pillars (grab-able): round, base on the floor
  for (const p of map.pillars) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(m(p.r), m(p.r), m(p.h), 28), matFor(p.c, 0.7));
    mesh.position.set(m(p.x), m(p.h) / 2, m(p.z));
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---- ramps: solid wedges
  const rampMat = matFor([182, 168, 120], 0.8);
  for (const r of map.ramps) {
    const mesh = new THREE.Mesh(buildRampGeometry(r), rampMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
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
    sun.position.set(feet.x + 20, feet.y + 60, feet.z + 10);
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
