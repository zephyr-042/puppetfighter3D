// src/main.js
// MAIN: boots the world + scene, runs the 6-player tag match (1 human + 5 bots), the fixed 60 Hz step decoupled from rendering,
// the on-demand cosmetic ragdolls, the grapple aim / snag glue and the match HUD (plus a JS-built crosshair). Loads LAST.
// [G] (or ?sandbox=1) toggles TAG MATCH <-> SANDBOX: solo free-roam, bots parked, no tag rules / timer / rounds, R = instant respawn.
// Movement rules live in physics/player.js, tag rules in game/rules.js, keyboard in input.js; this file is the wiring.
//
// One tick (STEP = 1/60):
//   1. every player: input (human keyboard / botInput / locked) -> stepPlayer -> queued kinematic move
//   2. stepWorld: all capsules move (and ragdolls tumble)
//   3. capsules -> game state (positions in metres, velocities, flags, fell)
//   4. stepGameRules: tags, shoves, trips, soft separation, IT time, rounds
//   5. game state -> capsules: knock velocities, separation nudges, ragdoll spawn / despawn, round reset
// Audio: createAudio() below is a zero-asset Web Audio synth (oscillator sweeps + filtered noise), unlocked by the first click / keypress, [M] mutes.
// Loads after: everything

import * as THREE from 'three';
import { STEP, MAX_STEPS_PER_FRAME, SCALE, RUN, CAM, PUPPET, MAP, GRAPPLE, m } from './config.js';
import DISTRICT_MAP from './game/maps.js';
import { createGameState, addPlayer, resetRoundPlayers, startMatch, drainEvents } from './game/state.js';
import { stepGameRules } from './game/rules.js';
import { createWorld, addPlayerCapsule, stepWorld, feetPos, placePlayer, nudgePlayer, hasFallen } from './physics/world.js';
import { createPlayerState, stepPlayer, IDLE_INPUT, endGrapple, torsoPos } from './physics/player.js';
import { spawnRagdoll, syncRagdollMeshes, despawnRagdoll } from './physics/ragdoll.js';
import { readInput } from './input.js';
import { createScene } from './render/scene.js';
import { createCameraRig, forwardOf, updateCamera, triggerLandDip } from './render/camera.js';

const NUM_BOTS = 5;                 // 1 human + 5 bots = MAX_PLAYERS (6)
const FALL_DOWN = 1.2;              // s a player who fell stays "down" (ragdoll tumbling into the void) before reappearing on a spawn
const LIMBO_Y = -1000;              // rules see a downed player this far below the map, so nobody can tag / bump the empty spawn
const $ = (id) => document.getElementById(id);

// Centre-screen aim dot + a small grapple status line under it (built here so index.html needs no change).
function makeCrosshair() {
  const dot = document.createElement('div');
  dot.id = 'crosshair';
  dot.style.cssText = 'position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff;' +
    'box-shadow:0 0 0 1px rgba(0,0,0,.75),0 0 6px rgba(255,255,255,.6);pointer-events:none;z-index:5';
  const tag = document.createElement('div');
  tag.id = 'grappleStatus';
  tag.style.cssText = 'position:fixed;left:50%;top:50%;margin-top:14px;transform:translateX(-50%);font:600 11px monospace;letter-spacing:1px;' +
    'color:#9fe8ff;text-shadow:0 0 3px #000;pointer-events:none;z-index:5;white-space:nowrap';
  document.body.appendChild(dot); document.body.appendChild(tag);
  return { dot, tag };
}


// ---- procedural audio (no files): everything is synthesised with Web Audio the moment it is needed ------------------------------------
// The AudioContext can only start after a user gesture, so the first pointerdown / keydown creates + resumes it; until then every call is a no-op.
// One-shots: thump / chirp (oscillator pitch sweeps), filtered-noise whooshes. Loops: one white-noise buffer through a bandpass (slide hiss)
// and one through a lowpass (wind). The loops run all the time and only their gain / cutoff follow the player (setMotion), so there is no
// start / stop click. All of it goes through a master gain and a compressor, so overlapping sounds can never clip.
function createAudio(toast) {                                   // toast(msg): optional HUD message callback (the [M] mute notice)
  let ac = null, master = null, noiseBuf = null, hissG = null, hissF = null, windG = null, windF = null, muted = false;
  const AC = window.AudioContext || window.webkitAudioContext;

  function build() {
    if (ac || !AC) return;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.55;
    master.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);          // 2 s of white noise, shared by every noise sound
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loop = (type, freq, q) => {
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(master); src.start();
      return { f, g };
    };
    const hiss = loop('bandpass', 3000, 0.7), wind = loop('lowpass', 500, 0.5);
    hissF = hiss.f; hissG = hiss.g; windF = wind.f; windG = wind.g;
  }
  function unlock() {
    build();
    if (ac && ac.state === 'suspended') ac.resume();
    if (ac && ac.state === 'running') for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, unlock, true);
  }
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, true);
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.repeat) return;
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.55, ac.currentTime, 0.03);
    if (toast) toast(muted ? 'SOUND OFF  [M]' : 'SOUND ON  [M]');
  });

  const live = () => ac && ac.state === 'running' && !muted;
  // oscillator with an exponential pitch sweep f0 -> f1 and a fast attack / exponential decay
  function tone(type, f0, f1, dur, gain, when = 0) {
    const t0 = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  // burst of the shared noise through a filter whose cutoff sweeps f0 -> f1 (a whoosh), or a short click when dur is tiny
  function noise(type, f0, f1, q, dur, gain, when = 0) {
    const t0 = ac.currentTime + when, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t0, Math.random()); s.stop(t0 + dur + 0.02);
  }

  const SFX = {
    jump()    { tone('sine', 210, 80, 0.12, 0.30); noise('lowpass', 900, 300, 0.7, 0.06, 0.05); },                      // clean pitch-swept thump
    airjump() { tone('triangle', 330, 700, 0.13, 0.17); tone('sine', 190, 95, 0.09, 0.16); },                           // thump + rising chirp
    kick()    { tone('sine', 150, 55, 0.14, 0.30); tone('triangle', 280, 620, 0.12, 0.16, 0.01); noise('bandpass', 1500, 3200, 1.2, 0.08, 0.07); },
    attach()  { tone('sine', 95, 52, 0.09, 0.30); noise('bandpass', 1800, 900, 2, 0.02, 0.07); },                       // soft low-end magnetic click
    dash()    { noise('bandpass', 500, 3600, 0.9, 0.24, 0.30); tone('sine', 140, 70, 0.10, 0.20); },                    // fast whoosh
    grapple() { noise('bandpass', 900, 4200, 1.1, 0.14, 0.20); tone('sawtooth', 2300, 900, 0.11, 0.09);               // whoosh + metallic thwip
                tone('square', 3450, 1350, 0.09, 0.04); }
  };
  function play(name) { if (live() && SFX[name]) SFX[name](); }

  // per-frame loops. speed in old units / s, `sliding` = grounded slide. Wind starts at 450 and is full at 850 units / s; hiss follows the slide speed.
  function setMotion(speed, sliding) {
    if (!ac || !windG) return;
    const now = ac.currentTime, on = live();
    const w = on ? Math.pow(Math.max(0, Math.min(1, (speed - 450) / 400)), 1.3) : 0;
    windG.gain.setTargetAtTime(w * 0.16, now, 0.08); windF.frequency.setTargetAtTime(350 + 1700 * w, now, 0.1);
    const h = on && sliding ? Math.max(0.15, Math.min(1, speed / 700)) : 0;
    hissG.gain.setTargetAtTime(h * 0.12, now, 0.05); hissF.frequency.setTargetAtTime(2200 + 1800 * h, now, 0.08);
  }
  return { play, setMotion };
}

async function boot() {
  const ctx = await createWorld();
  const audio = createAudio((msg) => { if (el.toast) { el.toast.textContent = msg; toastT = 1.2; } });   // (el / toastT exist by the time a key is pressed)
  const view = createScene();
  const rig = createCameraRig(view.renderer.domElement);
  const xhair = makeCrosshair();
  let xhairText = '';

  // ---- spawns: DISTRICT_MAP.spawns are old units, game state is metres. ?spawn=N gives the HUMAN spawn N (rotates the list).
  const raw = DISTRICT_MAP.spawns;
  const asked = parseInt(new URLSearchParams(location.search).get('spawn'), 10);
  const first = Number.isInteger(asked) && asked >= 0 && asked < raw.length ? asked : MAP.spawn;
  const spawnsM = raw.map((_, k) => { const s = raw[(first + k) % raw.length]; return { x: m(s.x), y: m(s.y), z: m(s.z) }; });

  // ---- game state: player 0 = human, 1..5 = bots
  const gs = createGameState({ spawns: spawnsM });
  addPlayer(gs, { name: 'YOU' });
  for (let b = 1; b <= NUM_BOTS; b++) addPlayer(gs, { name: 'BOT ' + b });
  resetRoundPlayers(gs, spawnsM);
  gs.round = 1; gs.mode = 'countdown'; gs.countdownLeft = gs.countdownTime;   // same as startMatch()
  let lastRound = gs.round;
  let sandbox = false;                         // SANDBOX (solo free-roam practice) vs TAG MATCH
  const PARK = 1e9;                            // limbo value for parked bots: they never come back until the mode switches
  const PARK_POS = { x: 5000, y: 200, z: 5000 };   // far off the map (never moved, never rendered, never a grapple target)

  const N = gs.players.length;
  const views = [], states = [], puppets = [], brains = [];
  const rags = new Array(N).fill(null);        // live ragdoll (or null) per player
  const limbo = new Array(N).fill(0);          // seconds left "down" after a fall
  const forceFall = new Array(N).fill(false);  // R key (human)
  const torso = Array.from({ length: N }, () => ({ x: 0, y: 0, z: 0 }));   // ragdoll torso position (chase camera / IT marker)
  const sent = Array.from({ length: N }, () => ({ x: 0, z: 0, vx: 0, vz: 0 }));   // what we wrote into the game state this tick
  for (let i = 0; i < N; i++) {
    views.push(addPlayerCapsule(ctx));
    states.push(createPlayerState());
    puppets.push(view.addPuppet(gs.players[i].color));
    brains.push({ t: 0, px: 0, pz: 0, stuck: 0, side: 1, hop: false, jumpT: 1 + gs.rng() * 2, dashDelay: 0, phase: gs.rng() * 6.28 });
  }

  // ---- ragdolls -------------------------------------------------------------------------------------------------------------
  function startRagdoll(i, pos, vel, imp, yaw) {
    if (rags[i]) despawnRagdoll(ctx.world, rags[i]);
    rags[i] = spawnRagdoll(ctx.RAPIER, ctx.world, pos, vel, imp, { yaw, rng: gs.rng });
  }
  function killRagdoll(i) {
    if (rags[i]) { despawnRagdoll(ctx.world, rags[i]); rags[i] = null; }
    puppets[i].showRagdoll(false); puppets[i].showCapsule(true);
  }

  // ---- placing players on their game-state positions (match start, new round, restart) --------------------------------------
  function faceCenter(i) {
    const p = gs.players[i];
    states[i].facing = p.yaw = Math.atan2(-p.x, -p.z);   // face the middle of the roof
    if (i === 0) { rig.yaw = Math.atan2(p.x, p.z); rig.pitch = 0.25; }
  }
  function placeAll() {
    gs.players.forEach((p, i) => {
      placePlayer(views[i], p.x, p.y, p.z, false);
      states[i] = createPlayerState();                    // all momentum, timers and chains reset
      states[i].isIt = p.isIt;
      limbo[i] = 0; forceFall[i] = false;
      killRagdoll(i);
      faceCenter(i);
    });
    stepWorld(ctx);                                       // one step so the query structures see every new position
  }
  placeAll();

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyG') setSandbox(!sandbox);                        // TAG MATCH <-> SANDBOX
    if (e.code === 'KeyR') forceFall[0] = true;                         // "I am stuck": handled exactly like a fall
    if (e.code === 'Enter' && gs.mode === 'matchend') wantRestart = true;
  });
  let wantRestart = false;

  // ---- sandbox / free-roam ---------------------------------------------------------------------------------------------------
  // SANDBOX: the 5 bots are parked off the map (limbo = PARK, never stepped), stepGameRules is not run at all (no tags, timer,
  // countdown or round-end), gs.mode stays 'play' and nobody is IT. R / falling = instant teleport to your spawn, no ragdoll, no penalty.
  function sandboxRespawn() {
    const sp = spawnsM[0];
    killRagdoll(0);
    placePlayer(views[0], sp.x, sp.y || 0, sp.z, false);
    states[0] = createPlayerState();                      // momentum, cooldowns, chains, grapple: all fresh for the next line
    limbo[0] = 0; forceFall[0] = false;
    faceCenter(0);
  }
  function setSandbox(on) {
    if (on === sandbox) return;
    sandbox = on;
    if (on) {
      for (let i = 1; i < N; i++) {
        killRagdoll(i); states[i] = createPlayerState();
        placePlayer(views[i], PARK_POS.x, PARK_POS.y, PARK_POS.z, false);
        limbo[i] = PARK; forceFall[i] = false;
      }
      gs.mode = 'play'; gs.players.forEach((p) => { p.isIt = false; p.stun = 0; });
      sandboxRespawn();
      stepWorld(ctx);
    } else {
      limbo.fill(0);
      startMatch(gs, spawnsM); lastRound = gs.round; placeAll();   // fresh match: bots back, scores 0, countdown
    }
    try {                                                  // keep ?sandbox=1 in the URL in sync (reload keeps the mode)
      const u = new URL(location.href);
      if (on) u.searchParams.set('sandbox', '1'); else u.searchParams.delete('sandbox');
      history.replaceState(null, '', u);
    } catch (e) { /* ignore */ }
    if (el.toast) { el.toast.textContent = on ? 'SANDBOX: solo free-roam, R = instant respawn' : 'TAG MATCH: 6 players'; toastT = 1.8; }
  }

  // ---- bots ----------------------------------------------------------------------------------------------------------------
  // Lightweight steering, no pathfinding. IT bot: run at the nearest runner (leading its movement a little), hop now and then,
  // dash / jump when close. Runner bot: run directly away from IT with a weave, dash when IT is close (a dash shoves IT away).
  // Both stay off the roof edge and out of the skylights (looking 0.5 s ahead along their velocity) and un-stick themselves.
  const RX = m(DISTRICT_MAP.rect.hw), RZ = m(DISTRICT_MAP.rect.hd), EDGE = 7, HOLE_MARGIN = 3;
  const HOLES = DISTRICT_MAP.holes.map((h) => ({ x: m(h.x), z: m(h.z), hw: m(h.hw), hd: m(h.hd) }));

  function botInput(gs, idx) {
    const me = gs.players[idx], s = states[idx], b = brains[idx];
    const inp = { ax: 0, az: 0, moving: false, fwd: false, jump: false, dash: false, slide: false };
    let wx = 0, wz = 0, near = Infinity, dashRange = 0;

    if (me.isIt) {
      let tgt = null;
      for (const q of gs.players) {
        if (q === me || q.y < -50) continue;              // skip downed players
        const d = Math.hypot(q.x - me.x, q.z - me.z);
        if (d < near) { near = d; tgt = q; }
      }
      if (tgt) {
        const lead = Math.min(0.4, near / 20);
        const tx = tgt.x + tgt.vx * lead - me.x, tz = tgt.z + tgt.vz * lead - me.z, l = Math.hypot(tx, tz) || 1;
        wx = tx / l; wz = tz / l; dashRange = 5.5;
      }
    } else {
      const it = gs.players.find((q) => q.isIt && q.y > -50);
      if (it) {
        const fx = me.x - it.x, fz = me.z - it.z;
        near = Math.hypot(fx, fz) || 1;
        const weave = Math.sin(performance.now() * 0.0009 + b.phase) * 0.5;
        wx = fx / near - (fz / near) * weave;
        wz = fz / near + (fx / near) * weave;
        dashRange = 4.2;
      } else { wx = -me.x * 0.02; wz = -me.z * 0.02; }    // nobody to flee from: drift toward the middle
    }

    // stay on the roof and out of the skylights (predicted position)
    const px = me.x + s.vx * 0.5, pz = me.z + s.vz * 0.5;
    if (px > RX - EDGE) wx -= (px - (RX - EDGE)) / EDGE * 3;
    if (px < -RX + EDGE) wx += ((-RX + EDGE) - px) / EDGE * 3;
    if (pz > RZ - EDGE) wz -= (pz - (RZ - EDGE)) / EDGE * 3;
    if (pz < -RZ + EDGE) wz += ((-RZ + EDGE) - pz) / EDGE * 3;
    for (const h of HOLES) {
      const ox = Math.abs(px - h.x) - h.hw, oz = Math.abs(pz - h.z) - h.hd;     // distance outside the hole rectangle
      const out = Math.max(ox, oz);
      if (out < HOLE_MARGIN) {
        const d = Math.hypot(px - h.x, pz - h.z) || 1, k = 3 * (1 - out / HOLE_MARGIN);
        wx += (px - h.x) / d * k; wz += (pz - h.z) / d * k;
      }
    }

    // stuck? (barely moved in 0.5 s while it should be running): strafe sideways and hop
    b.t += STEP;
    if (b.t >= 0.5) {
      if (Math.hypot(me.x - b.px, me.z - b.pz) < 0.8) { b.stuck = 0.7; b.hop = true; b.side = gs.rng() < 0.5 ? -1 : 1; }
      b.t = 0; b.px = me.x; b.pz = me.z;
    }
    if (b.stuck > 0) {
      b.stuck -= STEP;
      const tx = wx, tz = wz;
      wx = -tz * b.side + tx * 0.2; wz = tx * b.side + tz * 0.2;
    }

    // jump: an occasional hop (keeps the b-hop / air-strafe feel) and one when stuck or the other player is right there
    b.jumpT -= STEP;
    if (b.hop) { inp.jump = true; b.hop = false; }
    else if (b.jumpT <= 0) { inp.jump = near < 12 || gs.rng() < 0.5; b.jumpT = 1.2 + gs.rng() * 1.8; }

    const l = Math.hypot(wx, wz);
    if (l > 1e-4) { inp.ax = wx / l; inp.az = wz / l; inp.moving = true; inp.fwd = true; }

    // dash when close (needs a direction; the dash locks it)
    b.dashDelay -= STEP;
    if (inp.moving && near < dashRange && s.dashCd <= 0 && s.dashT <= 0 && b.dashDelay <= 0) {
      inp.dash = true; b.dashDelay = 0.2 + gs.rng() * 0.5;
    }
    return inp;
  }

  // ---- grapple aim: from the camera eye along the camera look direction (the crosshair). Downed players cannot be hooked.
  const _eye = new THREE.Vector3(), _look = new THREE.Vector3();
  function aimFromCamera() {
    view.camera.getWorldPosition(_eye); view.camera.getWorldDirection(_look);
    return { origin: { x: _eye.x, y: _eye.y, z: _eye.z }, dir: { x: _look.x, y: _look.y, z: _look.z },
             owner: 0, skip: (k) => limbo[k] > 0 || gs.players[k].y < -50 };
  }

  // ---- one fixed simulation tick --------------------------------------------------------------------------------------------
  function tick() {
    if (wantRestart) {                                    // Enter after the match: new match, scores to 0
      wantRestart = false;
      startMatch(gs, spawnsM); lastRound = gs.round; placeAll();
    }

    if (sandbox) {                                        // free-roam: always 'play', nobody IT or stunned
      gs.mode = 'play';
      for (const q of gs.players) { q.isIt = false; q.stun = 0; }
    }

    // 1. input + movement for every capsule
    for (let i = 0; i < N; i++) {
      if (sandbox && i > 0) continue;                     // parked bots are not simulated
      const p = gs.players[i], s = states[i];
      if (limbo[i] > 0) { limbo[i] -= STEP; if (limbo[i] <= 0) { limbo[i] = 0; killRagdoll(i); } }
      s.isIt = p.isIt;
      s.locked = gs.mode !== 'play' || p.stun > 0 || limbo[i] > 0;      // stunned: skip input so the knockback plays out
      if (s.grappleActive && s.grappleTarget >= 0) {       // hooked onto a player: the anchor follows their torso
        const q = gs.players[s.grappleTarget];
        if (gs.mode !== 'play' || limbo[s.grappleTarget] > 0) endGrapple(s);
        else { s.grappleAnchor.x = q.x; s.grappleAnchor.y = q.y + 0.9; s.grappleAnchor.z = q.z; }
      }
      let snap;
      if (i === 0) { snap = readInput(forwardOf(rig)); if (snap.grapple) snap.aim = aimFromCamera(); }
      else snap = s.locked ? IDLE_INPUT : botInput(gs, i);   // (the human's latches must drain every tick)
      const wasOnGround = views[i].player.grounded;
      stepPlayer(s, snap, views[i]);
      if (i === 0) {                                      // feedback for the human: sounds of this tick, landing dip
        for (const e of s.sfx) audio.play(e);
        if (!wasOnGround && views[i].player.grounded && s.vy < 0) triggerLandDip(rig, s.vy);   // s.vy is still the touchdown speed here
      }
    }

    // 2. all capsules move
    stepWorld(ctx);

    // 3. capsules -> game state
    for (let i = 0; i < N; i++) {
      const p = gs.players[i], s = states[i], v = views[i];
      let fell = false;
      if (sandbox && i === 0 && (hasFallen(v) || forceFall[0])) sandboxRespawn();   // R / void: instant, no ragdoll, no fall penalty
      if (!sandbox && limbo[i] <= 0 && (hasFallen(v) || forceFall[i])) {
        fell = true; forceFall[i] = false;
        // ragdoll tumbles where the player fell; the capsule is parked on its spawn point and stays hidden while "down"
        const f = feetPos(v);
        startRagdoll(i, f, { x: s.vx, y: Math.min(s.vy, 0), z: s.vz }, { x: s.vx * 0.5, y: 0, z: s.vz * 0.5 }, s.facing);
        limbo[i] = FALL_DOWN;
        const sp = gs.spawns[i % gs.spawns.length];
        placePlayer(v, sp.x, sp.y || 0, sp.z, false);
        states[i] = createPlayerState(); states[i].isIt = p.isIt; states[i].locked = true;
        states[i].facing = Math.atan2(-sp.x, -sp.z);
      }
      const t = states[i], f = feetPos(v);
      if (limbo[i] > 0) {                                  // down: invisible to the rules (far below the map, no velocity)
        p.x = f.x; p.y = LIMBO_Y; p.z = f.z; p.vx = p.vy = p.vz = 0;
        p.sliding = p.dashing = false; p.fell = fell;
      } else {
        p.x = f.x; p.y = f.y; p.z = f.z;
        p.vx = t.vx; p.vy = t.vy; p.vz = t.vz; p.yaw = t.facing;
        p.sliding = t.sliding; p.dashing = t.dashT > 0; p.grabbing = false;
        p.runT = t.runT; p.bhopChain = t.bhopChain; p.fell = false;
      }
      const sn = sent[i]; sn.x = p.x; sn.z = p.z; sn.vx = p.vx; sn.vz = p.vz;
    }

    // 4. tag rules (tags, shoves, trips, soft separation, IT time, rounds)
    if (!sandbox) stepGameRules(gs, STEP);                // (sandbox: no tags, shoves, trips, separation, timer, rounds)

    // 5. game state -> capsules
    if (gs.round !== lastRound) {                          // rules started a new round: everybody back on a spawn
      lastRound = gs.round;
      placeAll();
      return;
    }
    for (let i = 0; i < N; i++) {                          // a grapple reached another player: shove + brief stun
      const gh = states[i].grappleHit;
      if (gh < 0) continue;
      states[i].grappleHit = -1;
      const q = gs.players[gh], me = gs.players[i];
      if (gs.mode !== 'play' || limbo[gh] > 0 || q.stun > 0) continue;
      const dx = q.x - me.x, dz = q.z - me.z, l = Math.hypot(dx, dz) || 1;
      const sp = Math.max(m(GRAPPLE.hitShove), Math.hypot(states[i].vx, states[i].vz) * 0.6);
      q.stun = GRAPPLE.hitStun; q.vx = dx / l * sp; q.vz = dz / l * sp;    // vx / vz change is adopted into the capsule below
      endGrapple(states[gh]); states[gh].vy = Math.max(states[gh].vy, 2);
      el.toast.textContent = pname(i) + ' snagged ' + pname(gh); toastT = 1.6;
    }
    for (let i = 0; i < N; i++) {
      if (limbo[i] > 0) continue;
      const p = gs.players[i], s = states[i], sn = sent[i];
      if (p.vx !== sn.vx || p.vz !== sn.vz) {              // the rules knocked this player (tag / shove / trip)
        s.vx = p.vx; s.vz = p.vz; s.runT = p.runT; s.bhopChain = p.bhopChain;
        s.dashT = 0; s.sliding = false;
      }
      const dx = p.x - sn.x, dz = p.z - sn.z;              // soft separation from collidePlayers: read back into the capsule
      if (dx * dx + dz * dz > 1e-10) nudgePlayer(views[i], dx, dz);

      if (p.stun > 0) {                                    // stunned: cosmetic ragdoll (the capsule stays the truth, hidden)
        if (!rags[i]) startRagdoll(i, { x: p.x, y: p.y, z: p.z }, { x: s.vx, y: Math.max(s.vy, 0) + 2, z: s.vz },
                                   { x: s.vx * 1.5, y: 4, z: s.vz * 1.5 }, s.facing);
      } else if (rags[i]) killRagdoll(i);                  // stun over: capsule is back
    }
  }

  // ---- HUD ----------------------------------------------------------------------------------------------------------------------
  const el = { hud: $('hud'), round: $('round'), timer: $('timer'), status: $('status'), board: $('board'),
               banner: $('banner'), bMain: $('bannerMain'), bSub: $('bannerSub'), toast: $('toast'),
               mTag: $('modeTag'), mSand: $('modeSandbox') };
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  const fmt = (t) => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const pname = (id) => (gs.players[id] ? gs.players[id].name : '?');
  let flashGo = 0, toastT = 0, boardT = 0, lastBoard = '';

  function handleEvents() {
    for (const e of drainEvents(gs)) {
      if (e.type === 'go') flashGo = 0.9;
      else if (e.type === 'tag') { el.toast.textContent = pname(e.from) + ' tagged ' + pname(e.to); toastT = 1.6; }
      else if (e.type === 'shove') { el.toast.textContent = pname(e.from) + ' shoved ' + pname(e.to) + ' away'; toastT = 1.6; }
      else if (e.type === 'trip') { el.toast.textContent = pname(e.from) + ' tripped ' + pname(e.to); toastT = 1.6; }
      else if (e.type === 'fell') { el.toast.textContent = pname(e.id) + ' fell off and is IT!'; toastT = 1.8; }
    }
  }

  function updateHud(dt) {
    const me = gs.players[0];
    handleEvents();
    if (el.mTag) { el.mTag.className = sandbox ? '' : 'on'; el.mSand.className = sandbox ? 'on' : ''; }
    if (sandbox) {                                        // free-roam: no round / timer / IT status / leaderboard / banners
      el.round.textContent = 'SANDBOX'; el.timer.textContent = ''; el.timer.className = '';
      el.status.textContent = 'FREE ROAM'; el.status.className = 'run';
      el.board.style.display = 'none'; el.banner.style.display = 'none';
      toastT = Math.max(0, toastT - dt);
      if (toastT <= 0 && el.toast.textContent) el.toast.textContent = '';
      return;
    }
    el.board.style.display = '';
    el.round.textContent = 'ROUND ' + gs.round;
    const tl = gs.mode === 'play' ? gs.timeLeft : gs.mode === 'countdown' ? gs.roundTime : 0;
    el.timer.textContent = fmt(tl);
    el.timer.className = gs.mode === 'play' && gs.timeLeft <= 10 ? 'low' : '';
    el.status.textContent = me.isIt ? 'TAG THEM!' : 'RUN!';
    el.status.className = me.isIt ? 'it' : 'run';

    // live leaderboard: least IT time first (lowest IT time wins the round); refreshed ~7x / s
    boardT -= dt;
    if (boardT <= 0) {
      boardT = 0.14;
      const rows = gs.players.slice().sort((a, b) => a.itTime - b.itTime || a.id - b.id);
      const html = '<div class="head">IT TIME (LOW WINS)</div>' + rows.map((p) =>
        '<div class="row' + (p.id === 0 ? ' me' : '') + '"><span class="sw" style="background:' + hex(p.color) + '"></span>' +
        '<span class="nm">' + p.name + '</span><span class="itb">' + (p.isIt ? '&#9660;' : '') + '</span>' +
        '<span class="tm">' + p.itTime.toFixed(1) + 's</span><span class="st">' + (p.score ? '&#9733;' + p.score : '') + '</span></div>').join('');
      if (html !== lastBoard) { el.board.innerHTML = html; lastBoard = html; }
    }

    // banner: countdown number, GO!, round winner, match winner
    let main = '', sub = '', win = false;
    if (gs.mode === 'countdown') { main = String(Math.max(1, Math.ceil(gs.countdownLeft))); sub = me.isIt ? 'YOU ARE IT' : 'RUN!'; }
    else if (gs.mode === 'play' && flashGo > 0) main = 'GO!';
    else if (gs.mode === 'roundend') { main = pname(gs.winner) + ' WINS ROUND ' + gs.round; sub = 'next round in ' + Math.max(1, Math.ceil(gs.roundEndLeft)); win = true; }
    else if (gs.mode === 'matchend') { main = pname(gs.winner) + ' WINS THE MATCH'; sub = 'press Enter to play again'; win = true; }
    flashGo = Math.max(0, flashGo - dt);
    el.banner.style.display = main ? 'block' : 'none';
    el.banner.className = 'hud' + (win ? ' win' : '');
    el.bMain.textContent = main; el.bSub.textContent = sub;

    toastT = Math.max(0, toastT - dt);
    if (toastT <= 0 && el.toast.textContent) el.toast.textContent = '';
  }

  // ---- render loop: accumulate real time, run whole ticks, then draw ---------------------------------------------------------------
  let acc = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < MAX_STEPS_PER_FRAME) { tick(); acc -= STEP; n++; }
    if (n >= MAX_STEPS_PER_FRAME) acc = 0;

    // puppets: ragdoll parts while ragdolling, otherwise the capsule (squashed to the collider height)
    for (let i = 0; i < N; i++) {
      const pu = puppets[i];
      if (rags[i]) {
        syncRagdollMeshes(rags[i], pu.parts, torso[i]);
        pu.showRagdoll(true); pu.showCapsule(false);
      } else {
        const f = feetPos(views[i]);
        pu.setFeet(f.x, f.y, f.z);
        pu.setHeight(states[i].height);
        pu.showRagdoll(false); pu.showCapsule(limbo[i] <= 0);
      }
    }

    // grapple tethers: torso -> anchor while hooked
    for (let i = 0; i < N; i++) {
      const gs_ = states[i];
      if (gs_.grappleActive) view.setGrapple(i, torsoPos(views[i], gs_), gs_.grappleAnchor);
      else view.setGrapple(i, null);
    }

    // the red cone over whoever is IT
    const itIdx = gs.players.findIndex((p) => p.isIt);
    if (itIdx < 0) view.setItMarker(null);
    else if (rags[itIdx]) view.setItMarker({ x: torso[itIdx].x, y: torso[itIdx].y + 0.95, z: torso[itIdx].z }, now / 1000);
    else {
      const f = feetPos(views[itIdx]);
      view.setItMarker({ x: f.x, y: f.y + states[itIdx].height + 0.55, z: f.z }, now / 1000);
    }

    // chase camera: your capsule, or your tumbling torso while you are the one ragdolling
    const hs = states[0], hv = views[0];
    const hSpeed = Math.hypot(hs.vx, hs.vz);
    let focus;
    if (rags[0]) {
      focus = torso[0];
      updateCamera(rig, view.camera, hv, focus, dt, 0.15, 0, 0);
    } else {
      focus = feetPos(hv);
      updateCamera(rig, view.camera, hv, focus, dt, m(CAM.pivot) * hs.height / m(PUPPET.height), hSpeed, hs.wallRunning ? hs.wallSide : 0);
    }
    view.setFocus(focus);
    audio.setMotion(hSpeed / SCALE, hs.sliding && hv.player.grounded && !rags[0]);   // slide hiss + high-speed wind (loops follow the speed)

    if (el.hud) el.hud.textContent = 'spd ' + Math.round(hSpeed / SCALE) + '  runT ' + hs.runT.toFixed(2) + ' / ' + RUN.rampT +
      '  BHOP ' + (hs.bhopChain > 0 ? 'x' + hs.bhopChain : '-') + (hs.bhopTimer > 0 ? ' (window)' : '') +
      '  DASH ' + (hs.dashT > 0 ? 'GO' : hs.dashCd > 0 ? hs.dashCd.toFixed(1) + 's' : 'ready') +
      '  AIRJ ' + hs.airJumpsLeft +
      '  GRAPPLE ' + (hs.grappleActive ? 'GO' : hs.grappleCd > 0 ? hs.grappleCd.toFixed(1) + 's' : 'ready') +
      (hs.wallRunning ? '  WALLRUN' : hs.regrabTimer > 0 ? '  regrab ' + hs.regrabTimer.toFixed(2) + 's' : '') +
      (hs.sliding ? '  SLIDE' : '') + (hs.slideBoostCd > 0 ? '  slideboost ' + hs.slideBoostCd.toFixed(2) + 's' : '  slideboost ready') + (gs.players[0].stun > 0 ? '  STUN' : '');
    updateHud(dt);

    const gtxt = hs.grappleActive ? 'HOOKED' : hs.grappleCd > 0 ? 'GRAPPLE ' + hs.grappleCd.toFixed(1) + 's' : 'GRAPPLE READY';
    if (gtxt !== xhairText) {
      xhairText = gtxt; xhair.tag.textContent = gtxt;
      xhair.dot.style.background = hs.grappleActive ? '#7fe9ff' : hs.grappleCd > 0 ? '#ff6b6b' : '#fff';
    }

    view.renderer.render(view.scene, view.camera);
    requestAnimationFrame(frame);
  }
  if (new URLSearchParams(location.search).get('sandbox') === '1') setSandbox(true);   // ?sandbox=1: start in free-roam
  requestAnimationFrame(frame);
}

boot();
