// src/main.js
// MAIN: boots the world + scene, reads the keyboard, runs the fixed 60 Hz step decoupled from rendering. Loads LAST.
// Step 1 only: basic camera-relative WASD on the kinematic capsule. The real movement verbs move to
// src/physics/player.js in Step 3; this file keeps just the loop and the wiring.
// Loads after: everything

import { STEP, MAX_STEPS_PER_FRAME, m, MOVE } from './config.js';
import { createWorld, movePlayer, stepWorld, feetPos } from './physics/world.js';
import { createScene } from './render/scene.js';
import { createCameraRig, forwardOf, updateCamera } from './render/camera.js';

const keys = {};
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

async function boot() {
  const ctx = await createWorld();
  const view = createScene();
  const rig = createCameraRig(view.renderer.domElement);

  const speed = m(MOVE.speed), gravity = m(MOVE.gravity);
  const state = { vx: 0, vz: 0, vy: 0, facing: 0 };

  // one fixed simulation tick
  function tick() {
    // wanted horizontal direction from WASD, relative to the camera
    const f = forwardOf(rig), rx = -f.z, rz = f.x;          // right = forward rotated 90 degrees
    let ax = 0, az = 0;
    if (keys.KeyW) { ax += f.x; az += f.z; }
    if (keys.KeyS) { ax -= f.x; az -= f.z; }
    if (keys.KeyD) { ax += rx;  az += rz; }
    if (keys.KeyA) { ax -= rx;  az -= rz; }
    const l = Math.hypot(ax, az);
    if (l > 0) { ax /= l; az /= l; }

    // velocity chases the wanted velocity (same feel as the old game: k = dt * 9)
    const k = Math.min(1, STEP * MOVE.accel);
    state.vx += (ax * speed - state.vx) * k;
    state.vz += (az * speed - state.vz) * k;

    // gravity; the controller reports whether we stand on something
    state.vy = ctx.player.grounded ? -0.5 : state.vy - gravity * STEP;

    movePlayer(ctx, state.vx * STEP, state.vy * STEP, state.vz * STEP);
    stepWorld(ctx);

    // face the way we are moving (smoothly)
    if (l > 0) {
      const target = Math.atan2(state.vx, state.vz);
      let d = target - state.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      state.facing += d * Math.min(1, STEP * 12);
    }
  }

  // render loop: accumulate real time, run whole ticks, then draw
  let acc = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < MAX_STEPS_PER_FRAME) { tick(); acc -= STEP; n++; }
    if (n >= MAX_STEPS_PER_FRAME) acc = 0;

    const feet = feetPos(ctx);
    view.puppet.position.set(feet.x, feet.y, feet.z);
    view.puppet.rotation.y = state.facing;
    updateCamera(rig, view.camera, ctx, feet, dt);
    view.renderer.render(view.scene, view.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
