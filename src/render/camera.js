// src/render/camera.js
// RENDER (2/2): mouse-orbit third-person chase camera (PointerLock) with a Rapier raycast boom.
// View only: yaw / pitch are local and never part of the simulation.
// Loads after: config.js, physics/world.js (raycastStatic)

import { m, CAM, SCALE, WALLRUN, LAND } from '../config.js';
import { raycastStatic } from '../physics/world.js';

export function createCameraRig(domElement) {
  const rig = { yaw: 0, pitch: 0.25, dist: m(CAM.dist), roll: 0, wallK: 0, wallDir: 0, wallHold: 0, landDip: 0, landT: 1, landDepth: 0, locked: false };

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

// Landing dip: call when the human touches down from a fall. impactVy = the (negative) vertical speed in metres / s at touchdown; anything faster
// than -LAND.minVy (4 m/s) counts. The camera pivot then dips LAND.dip (0.15 m at a hard landing, less for a soft one) and rebounds over LAND.time (0.2 s).
export function triggerLandDip(rig, impactVy) {
  if (!(impactVy < -LAND.minVy)) return;
  const k = Math.min(1, 0.4 + (-impactVy - LAND.minVy) / 10);
  const depth = LAND.dip * k;
  if (depth >= rig.landDip) { rig.landDepth = depth; rig.landT = 0; }      // a softer landing never cuts a harder one short
}

// Direction the player is looking along the ground (unit vector, y = 0). W moves along this.
export function forwardOf(rig) {
  return { x: -Math.sin(rig.yaw), z: -Math.cos(rig.yaw) };
}

// Place the Three camera: orbit around the pivot (chest height above the feet), pulled in by the boom ray.
// `pivot` (metres above the feet) drops while sliding so the view sits low to the ground.
// `speed` (metres / s, horizontal) widens the FOV by up to CAM.fovWarp degrees between fovWarpFrom and fovWarpTo (old units / s).
// `wallSide` (-1 wall on the left, 1 wall on the right, 0 none) rolls the view by WALLRUN.camTilt, leaning away from the wall,
// and while it is set the pivot drops WALLRUN.camDrop and the FOV gains WALLRUN.camFov degrees, so a wall-run reads as its own state.
// Roll and wallK are exponentially damped (frame-rate independent) and the lean is held WALLRUN.camHold s after the wall is lost, so a
// wall edge that flickers for a few ticks never shakes the view; the attach is quick, the release slower.
export function updateCamera(rig, camera, ctx, feet, dt, pivot = m(CAM.pivot), speed = 0, wallSide = 0) {
  // wall-run kinesthetics: rig.wallK eases 0 -> 1 while a wall is held (same ease as the roll), driving a lower pivot and an extra FOV kick
  const dtc = Math.min(Math.max(dt, 0), 0.05);
  if (wallSide !== 0) { rig.wallDir = wallSide; rig.wallHold = WALLRUN.camHold; }
  else rig.wallHold = Math.max(0, rig.wallHold - dtc);
  const lean = rig.wallHold > 0 ? rig.wallDir : 0;                      // the side we lean to (held through short drops)
  const kLean = 1 - Math.exp(-dtc * WALLRUN.tiltEase * (lean !== 0 ? 1 : 0.6));
  rig.wallK += ((lean !== 0 ? 1 : 0) - rig.wallK) * kLean;
  // landing dip: a quick ease down (first quarter of LAND.time), then a smooth rebound to 0 (cos ease), so it settles exactly at the end
  if (rig.landT < 1) {
    rig.landT = Math.min(1, rig.landT + dtc / LAND.time);
    const p = rig.landT, f = p < 0.25 ? Math.sin(p / 0.25 * Math.PI / 2) : Math.cos((p - 0.25) / 0.75 * Math.PI / 2);
    rig.landDip = rig.landDepth * f;
  } else rig.landDip = 0;
  const px = feet.x, py = feet.y + pivot - m(WALLRUN.camDrop) * rig.wallK - rig.landDip, pz = feet.z;
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

  // wall-run roll: eased, applied after lookAt as a roll about the view axis (camera.rotation.z in the camera's own frame)
  rig.roll += (lean * WALLRUN.camTilt - rig.roll) * kLean;
  if (Math.abs(rig.roll) > 1e-4) camera.rotateZ(rig.roll);

  // speed FOV warp: eased so a dash or a landing does not snap the view
  const t = Math.max(0, Math.min(1, (speed / SCALE - CAM.fovWarpFrom) / (CAM.fovWarpTo - CAM.fovWarpFrom)));
  const wantFov = CAM.fov + CAM.fovWarp * t + WALLRUN.camFov * rig.wallK;   // +4 degrees while wall-running
  if (Math.abs(wantFov - camera.fov) > 0.01) {
    camera.fov += (wantFov - camera.fov) * Math.min(1, dt * CAM.fovWarpEase);
    camera.updateProjectionMatrix();
  }
}
