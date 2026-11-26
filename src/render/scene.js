// src/render/scene.js
// RENDER (1/2): the Three.js renderer, lights, the District map (floor slabs with rim trims, boxes, pillars, ramp wedges),
// the dark city backdrop, and the placeholder capsule puppet (squashes while sliding).
// Meshes are built from the same map data and helpers (game/maps.js) as the physics colliders, so they always match.
// Loads after: config.js, game/maps.js

import * as THREE from 'three';
import { m, PUPPET, CAM, MAP } from '../config.js';
import DISTRICT_MAP, { floorSlabs, rampSpan } from '../game/maps.js';

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

// Dark skyline + the building shaft under the roof, so looking over the edge (or down a skylight) feels high up.
function addCityBackdrop(scene, map) {
  const rhw = m(map.rect.hw), rhd = m(map.rect.hd);

  // facade: four thin dark walls hanging 200 m below the roof edge (the roof is the top of a tall building; skylights look into the shaft)
  const FACADE_H = 200, T = 1;
  const facadeMat = new THREE.MeshLambertMaterial({ color: 0x141c30 });
  const wall = (cx, cz, sx, sz) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(sx, FACADE_H, sz), facadeMat);
    w.position.set(cx, -FACADE_H / 2, cz); scene.add(w);
  };
  wall(0, -rhd - T / 2, 2 * rhw + 2 * T, T);  wall(0, rhd + T / 2, 2 * rhw + 2 * T, T);
  wall(-rhw - T / 2, 0, T, 2 * rhd);          wall(rhw + T / 2, 0, T, 2 * rhd);
  const shaftFloor = new THREE.Mesh(new THREE.PlaneGeometry(2 * rhw, 2 * rhd), new THREE.MeshBasicMaterial({ color: 0x05080f }));
  shaftFloor.rotation.x = -Math.PI / 2; shaftFloor.position.y = -FACADE_H; scene.add(shaftFloor);

  // street level far below
  const street = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: 0x090e1a }));
  street.rotation.x = -Math.PI / 2; street.position.y = -260; scene.add(street);

  // distant skyscrapers: deterministic pseudo-random boxes outside the roof, tops anywhere from far below to well above the roof
  let seed = 20241126;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const bMat = [0x151d33, 0x182139, 0x121a2e].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const clearX = rhw + 28, clearZ = rhd + 28;                    // keep a gap between the roof and the nearest tower
  let placed = 0;
  for (let tries = 0; tries < 600 && placed < 90; tries++) {
    const ang = rnd() * Math.PI * 2, rad = 90 + rnd() * 520;
    const x = Math.cos(ang) * rad * 1.5, z = Math.sin(ang) * rad;
    const w = 14 + rnd() * 30, d = 14 + rnd() * 30;
    if (Math.abs(x) < clearX + w / 2 && Math.abs(z) < clearZ + d / 2) continue;
    const top = -140 + rnd() * rnd() * 330;                      // biased low, a few towers rise above the roof
    const h = top + 260;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bMat[placed % 3]);
    b.position.set(x, -260 + h / 2, z); scene.add(b); placed++;
  }
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

  const camera = new THREE.PerspectiveCamera(CAM.fov, window.innerWidth / window.innerHeight, 0.1, 1600);

  // lights: the sun follows the player (see setFocus) so one shadow map covers the area around you
  scene.add(new THREE.HemisphereLight(0xcfdcff, 0x4a5468, 1.5));    // strong ambient: wall faces must stay readable at speed
  const sun = new THREE.DirectionalLight(0xdfe8ff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
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
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---- rim trims: a light coping strip (map.rect.lip wide) along the roof edge and around every skylight hole. Visual only.
  const lip = m(map.rect.lip), TH = 0.05, trimMat = new THREE.MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.6 });
  const trim = (x0, x1, z0, z1) => {                                   // metres, axis-aligned rectangle on the floor
    const t = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, TH, z1 - z0), trimMat);
    t.position.set((x0 + x1) / 2, TH / 2, (z0 + z1) / 2); t.receiveShadow = true; scene.add(t);
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

  addCityBackdrop(scene, map);

  // placeholder puppet: capsule plus a small "nose" box so facing is visible. Origin = feet.
  const radius = m(PUPPET.radius), total = m(PUPPET.height);
  const puppet = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, total - 2 * radius, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x3498db, roughness: 0.6 })
  );
  body.position.y = total / 2;
  body.castShadow = true;
  puppet.add(body);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 0.8, radius * 0.5, radius * 0.9),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  nose.position.set(0, total * 0.8, radius);       // faces local +z
  puppet.add(nose);
  scene.add(puppet);

  // squash / stretch the capsule to the current collider height (metres). Feet stay at the origin.
  function setPuppetHeight(h) {
    body.scale.y = h / total;
    body.position.y = h / 2;
    nose.position.y = h * 0.8;
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

  return { renderer, scene, camera, puppet, setPuppetHeight, setFocus };
}
