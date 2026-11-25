// src/render/scene.js
// RENDER (1/2): the Three.js renderer, lights, test floor + blocks and the placeholder capsule mesh (squashes while sliding).
// Meshes are built from the same config numbers as the physics colliders, so they always match.
// Loads after: config.js

import * as THREE from 'three';
import { m, PUPPET, TEST_FLOOR, TEST_BLOCKS, CAM } from '../config.js';

export function createScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1020);
  scene.fog = new THREE.Fog(0x0a1020, 40, 160);

  const camera = new THREE.PerspectiveCamera(CAM.fov, window.innerWidth / window.innerHeight, 0.1, 400);

  // lights
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a3040, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(20, 40, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 120;
  scene.add(sun);

  // test floor (top face at y = 0)
  const fw = m(TEST_FLOOR.hw) * 2, fd = m(TEST_FLOOR.hd) * 2, ft = m(TEST_FLOOR.thickness);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(fw, ft, fd),
    new THREE.MeshStandardMaterial({ color: 0x4a5662, roughness: 0.9 })
  );
  floor.position.y = -ft / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(Math.max(fw, fd), Math.round(Math.max(fw, fd) / 1), 0x6b7886, 0x39434e);
  grid.position.y = 0.01;
  scene.add(grid);

  // test blocks
  for (const b of TEST_BLOCKS) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(m(b.hw) * 2, m(b.h), m(b.hd) * 2),
      new THREE.MeshStandardMaterial({ color: b.c, roughness: 0.8 })
    );
    mesh.position.set(m(b.x), m(b.h) / 2, m(b.z));
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }

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

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  return { renderer, scene, camera, puppet, setPuppetHeight };
}
