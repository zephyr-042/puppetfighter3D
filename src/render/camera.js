// src/render/camera.js
// RENDER (2/2): mouse-orbit third-person chase camera (PointerLock) with a Rapier raycast boom.
// View only: yaw / pitch are local and never part of the simulation.
// Loads after: config.js, physics/world.js (raycastStatic)

import { m, CAM } from '../config.js';
import { raycastStatic } from '../physics/world.js';

export function createCameraRig(domElement) {
  const rig = { yaw: 0, pitch: 0.25, dist: m(CAM.dist), locked: false };

  domElement.addEventListener('click', () => {
    if (!rig.locked) domElement.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    rig.locked = document.pointerLockElement === domElement;
  });
  document.addEventListener('mousemove', (e) => {
    if (!rig.locked) return;
    rig.yaw -= e.movementX * CAM.mouseSens;
    rig.pitch += e.movementY * CAM.mouseSens;
    rig.pitch = Math.max(CAM.pitchMin, Math.min(CAM.pitchMax, rig.pitch));
  });

  return rig;
}

// Direction the player is looking along the ground (unit vector, y = 0). W moves along this.
export function forwardOf(rig) {
  return { x: -Math.sin(rig.yaw), z: -Math.cos(rig.yaw) };
}

// Place the Three camera: orbit around the pivot (chest height above the feet), pulled in by the boom ray.
// `pivot` (metres above the feet) drops while sliding so the view sits low to the ground.
export function updateCamera(rig, camera, ctx, feet, dt, pivot = m(CAM.pivot)) {
  const px = feet.x, py = feet.y + pivot, pz = feet.z;
  // unit vector from the pivot to the wanted camera position
  const cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
  const bx = Math.sin(rig.yaw) * cp, by = sp, bz = Math.cos(rig.yaw) * cp;

  // boom: cast from the pivot toward the camera, stop CAM.pad short of whatever it hits
  const wanted = m(CAM.dist);
  const hit = raycastStatic(ctx, px, py, pz, bx, by, bz, wanted + m(CAM.pad));
  const clear = hit === null ? wanted : Math.max(m(CAM.minDist), Math.min(wanted, hit - m(CAM.pad)));

  // move in at once, ease back out so sliding along a wall does not pump (same idea as the old chaseCam)
  rig.dist = clear < rig.dist ? clear : rig.dist + (clear - rig.dist) * Math.min(1, dt * 6);

  camera.position.set(px + bx * rig.dist, py + by * rig.dist, pz + bz * rig.dist);
  camera.lookAt(px, py, pz);
}
