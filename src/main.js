// src/main.js
// MAIN: boots the world + scene, reads the keyboard, runs the fixed 60 Hz step decoupled from rendering. Loads LAST.
// Movement rules live in physics/player.js, keyboard in input.js; this file keeps just the loop and the wiring.
// Loads after: everything

import { STEP, MAX_STEPS_PER_FRAME, SCALE, RUN, CAM, PUPPET, MAP, m } from './config.js';
import DISTRICT_MAP from './game/maps.js';
import { createWorld, stepWorld, feetPos, teleportPlayer, hasFallen } from './physics/world.js';
import { createPlayerState, stepPlayer } from './physics/player.js';
import { readInput } from './input.js';
import { createScene } from './render/scene.js';
import { createCameraRig, forwardOf, updateCamera } from './render/camera.js';

async function boot() {
  const ctx = await createWorld();
  const view = createScene();
  const rig = createCameraRig(view.renderer.domElement);

  const state = createPlayerState();
  const hud = document.getElementById('hud');

  // ---- spawn: DISTRICT_MAP.spawns[MAP.spawn], or ?spawn=N in the URL (handy for testing a part of the map)
  const spawns = DISTRICT_MAP.spawns;
  const asked = parseInt(new URLSearchParams(location.search).get('spawn'), 10);
  const spawn = spawns[Number.isInteger(asked) && asked >= 0 && asked < spawns.length ? asked : MAP.spawn];
  function respawn() {
    teleportPlayer(ctx, spawn.x, spawn.y, spawn.z);
    Object.assign(state, createPlayerState());                // all momentum, timers and chains reset
    const dx = -spawn.x, dz = -spawn.z, l = Math.hypot(dx, dz) || 1;   // face the middle of the roof
    state.facing = Math.atan2(dx, dz);
    rig.yaw = Math.atan2(-dx / l, -dz / l);
    rig.pitch = 0.25;
  }
  respawn();
  let wantRespawn = false;
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyR' && !e.repeat) wantRespawn = true; });

  // one fixed simulation tick
  function tick() {
    if (wantRespawn) { wantRespawn = false; respawn(); }
    stepPlayer(state, readInput(forwardOf(rig)), ctx);
    stepWorld(ctx);
    if (hasFallen(ctx)) respawn();                            // off the roof or down a skylight
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
    const hSpeed = Math.hypot(state.vx, state.vz);
    if (hud) hud.textContent = 'spd ' + Math.round(hSpeed / SCALE) + '  runT ' + state.runT.toFixed(2) + ' / ' + RUN.rampT +
      '  BHOP ' + (state.bhopChain > 0 ? 'x' + state.bhopChain : '-') + (state.bhopTimer > 0 ? ' (window)' : '') +
      '  DASH ' + (state.dashT > 0 ? 'GO' : state.dashCd > 0 ? state.dashCd.toFixed(1) + 's' : 'ready') +
      '  AIRJ ' + state.airJumpsLeft +
      (state.wallRunning ? '  WALLRUN' : state.regrabTimer > 0 ? '  regrab ' + state.regrabTimer.toFixed(2) + 's' : '') +
      (state.sliding ? '  SLIDE' : '');
    view.setPuppetHeight(state.height);
    view.setFocus(feet);
    updateCamera(rig, view.camera, ctx, feet, dt, m(CAM.pivot) * state.height / m(PUPPET.height), hSpeed, state.wallRunning ? state.wallSide : 0);
    view.renderer.render(view.scene, view.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
