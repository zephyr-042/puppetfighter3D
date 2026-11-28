// src/main.js
// MAIN: boots the world + scene, joins the Socket.IO room, runs YOUR player at 60 Hz (client-authoritative, 0 ms movement lag), sends a
// volatile 'state' packet at 30 Hz, and renders every remote player from the server's 30 Hz 'snapshot' with exponential smoothing.
// No bots and no tag rules here any more: movement lives in physics/player.js, the room in server.js, keyboard in input.js.
//
// One local tick (STEP = 1/60):
//   1. read input -> stepPlayer (queues the kinematic move)      2. stepWorld (capsule moves, ragdolls tumble)
//   3. fell below the map / R pressed -> local ragdoll + 'respawnReq'     4. every 2nd tick: send 'state'
// Remote players are cosmetic: one pod each (squashed to `height`, floating blade, grapple tether, the same pod tumbling as a ragdoll while their `ragdoll` flag is set).
// Melee (Kinetic Slash): Left-Click -> stepPlayer starts the swing + magnetic lunge -> 'slash' { dir, speed } goes to the server, which judges it and answers every client
// with 'hit' / 'killFeed' ('slashFx' shows other players' swings). A hit on YOU applies the knockback; a heavy hit (or a KO) sends your pod tumbling as the ragdoll.
// HUD: HP bar (bottom centre), hit-marker round the crosshair, kill feed (top right), red vignette when hit.
// Slice M1 (feel): Phase-Dodge i-frames (since M2 the SERVER judges them from the 'dodging' flag and answers 'dodged': "DODGED!" + crosshair flash + phase whoosh),
// speed-charged blade + pod lean (fed to the puppets every frame), and impact juice (0.045 s hit-stop freeze of camera + blade animation and a camera shake when you land a heavy hit / KO).
// Slice M2 (parry / dodge): Right-Click raises the guard (stance + barrier in scene.js); the SERVER judges every slash against the target's guard / dodge flags and answers with 'dodged' /
// 'parried' (+ the usual 'hit' for a regular block). A perfect parry: clang, hit-stop + shake, the defender's dash / grapple cooldowns reset, the attacker is shoved back + staggered.
// Audio: createAudio() below is a zero-asset Web Audio synth (oscillator sweeps + filtered noise), unlocked by the first click / keypress, [M] mutes.
// Loads after: everything

import * as THREE from 'three';
import { io } from 'socket.io-client';
import { STEP, MAX_STEPS_PER_FRAME, SCALE, RUN, CAM, PUPPET, GRAPPLE, MELEE, MAP, JUICE, PARRY, DASH, m } from './config.js';
import DISTRICT_MAP from './game/maps.js';
import { createWorld, addPlayerCapsule, stepWorld, feetPos, placePlayer, hasFallen } from './physics/world.js';
import { createPlayerState, stepPlayer, endGrapple, torsoPos, applyKnockback } from './physics/player.js';
import { spawnRagdoll, syncRagdollMeshes, despawnRagdoll, ragdollCenter, ragdollVelocity } from './physics/ragdoll.js';
import { readInput, clearInput } from './input.js';
import { createScene } from './render/scene.js';
import { createCameraRig, forwardOf, updateCamera, triggerLandDip } from './render/camera.js';

const SEND_EVERY = 2;               // sim ticks per 'state' packet: 60 Hz / 2 = 30 Hz
const SMOOTH = 18;                  // remote smoothing rate: k = 1 - exp(-SMOOTH * dt)
const SNAP_DIST = 20;               // m: a remote farther than this from its target snaps instead of gliding (respawn, long lag spike)
const RESPAWN_FALLBACK = 4;         // s: respawn locally if the server never answers
const TETHER_SLOTS = 6;             // view.setGrapple slots (0 = you, 1.. = remote players); the server caps the room at 6
const $ = (id) => document.getElementById(id);
const r3 = (v) => Math.round(v * 1000) / 1000;
const angDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
const typingTarget = (e) => { const t = e.target; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); };


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
                tone('square', 3450, 1350, 0.09, 0.04); },
    // ---- melee. `v` = loudness 0..1 (distance for other players' swings, power for impacts)
    slash(v)  { noise('bandpass', 700, 5200, 1.0, 0.17, 0.34 * v); noise('highpass', 2600, 7000, 0.7, 0.10, 0.09 * v, 0.02);   // blade whoosh
                tone('sawtooth', 1900, 420, 0.16, 0.08 * v); tone('sine', 230, 90, 0.12, 0.16 * v); },                          // energy hum + body
    impact(v) { tone('sine', 190, 42, 0.20, 0.28 + 0.20 * v); noise('lowpass', 2200, 260, 0.8, 0.14, 0.20 + 0.14 * v);           // thud + crack
                tone('square', 1250, 320, 0.07, 0.06 + 0.05 * v); tone('triangle', 880, 2400, 0.05, 0.05 * v, 0.012); },        // metallic ring
    phase(v)  { noise('bandpass', 4200, 600, 1.4, 0.24, 0.30 * v); tone('sine', 1900, 420, 0.16, 0.14 * v);                           // Phase-Dodge: crisp falling whoosh
                tone('triangle', 520, 1500, 0.12, 0.08 * v, 0.03); noise('highpass', 6000, 9000, 0.7, 0.07, 0.07 * v); },              // + a rising shimmer
    parry(v)  { noise('bandpass', 1200, 3800, 1.4, 0.10, 0.16 * v); tone('triangle', 420, 880, 0.10, 0.10 * v); },                       // guard raised: short rising swish
    clang(v)  { tone('square', 1720, 1690, 0.38, 0.13 * v); tone('triangle', 2650, 2600, 0.30, 0.10 * v); tone('sine', 3910, 3880, 0.24, 0.07 * v);   // inharmonic metal partials
                tone('sawtooth', 980, 940, 0.20, 0.07 * v); noise('highpass', 3500, 9000, 0.8, 0.07, 0.30 * v); tone('sine', 160, 70, 0.12, 0.22 * v); },   // + strike click + body
    block(v)  { tone('triangle', 900, 760, 0.16, 0.12 * v); tone('sine', 1500, 1400, 0.14, 0.06 * v); noise('bandpass', 2400, 1200, 1.2, 0.08, 0.16 * v); tone('sine', 140, 60, 0.12, 0.2 * v); },   // duller block thud
    hurt(v)   { tone('sine', 120, 38, 0.26, 0.30 * v); noise('lowpass', 1400, 200, 0.7, 0.20, 0.18 * v); tone('sawtooth', 300, 90, 0.18, 0.06 * v); },   // you got hit
    ko(v)     { tone('sine', 110, 28, 0.60, 0.40 * v); noise('bandpass', 3400, 160, 0.8, 0.50, 0.24 * v);                         // sub boom + falling noise
                tone('triangle', 660, 140, 0.45, 0.13 * v); tone('sawtooth', 1500, 300, 0.30, 0.06 * v, 0.03); }
  };
  function play(name, vol = 1) { if (live() && SFX[name]) SFX[name](Math.max(0.05, Math.min(1, vol))); }

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
  // ---- DOM ----------------------------------------------------------------------------------------------------------------------
  const el = { hud: $('hud'), net: $('net'), netWarn: $('netWarn'), toast: $('toast'), resume: $('resume'), xhair: $('crosshair'), gstat: $('grappleStatus'),
               sb: $('scoreboard'), sbRows: $('sbRows'), overlay: $('overlay'), name: $('nameInput'), color: $('colorInput'),
               play: $('playBtn'), msg: $('overlayMsg'),
               hpBox: $('hpBox'), hpNum: $('hpNum'), koNum: $('koNum'), hpFill: $('hpFill'), hpGhost: $('hpGhost'), slashFill: $('slashFill'),
               hit: $('hitmarker'), hurt: $('hurt'), feed: $('killFeed') };
  let toastT = 0;
  let hitStopT = 0, shakeAmp = 0, dodgeFlashT = 0, xhairFlashing = false, flashDur = JUICE.dodgeFlash, flashCol = '#bff6ff', flashGlow = '#00e5ff', flashGlow2 = '#7fe9ff';   // Slice M1: hit-stop freeze (s), camera shake impulse (m), crosshair dodge flash (s)
  const toast = (msg, t = 1.6) => { el.toast.textContent = msg; toastT = t; };
  const hint = document.createElement('div');               // controls hint (bottom left); index.html is not touched
  hint.textContent = 'LMB Slash | RMB Parry | E Grapple | Q/F Dodge';
  hint.style.cssText = 'position:fixed;left:14px;bottom:12px;font:600 12px/1.2 system-ui,sans-serif;letter-spacing:.06em;color:rgba(255,255,255,.72);text-shadow:0 1px 3px #000;pointer-events:none;z-index:5;white-space:nowrap';
  document.body.appendChild(hint);

  // ---- world / scene ------------------------------------------------------------------------------------------------------------
  const ctx = await createWorld();
  const audio = createAudio((msg) => toast(msg, 1.2));
  const view = createScene();
  const canvas = view.renderer.domElement;
  const rig = createCameraRig(canvas);
  view.setItMarker(null);                                   // nobody is IT in this game

  const SPAWNS_M = DISTRICT_MAP.spawns.map((s) => ({ x: m(s.x), y: m(s.y || 0), z: m(s.z) }));
  let lastSpawn = SPAWNS_M[0];

  // YOUR capsule. (Remote players have no capsule: they are puppets only, so only level geometry can be grapple-hooked.)
  const pv = addPlayerCapsule(ctx);
  let me = createPlayerState();
  let localYaw = 0;                                         // the yaw your pod is DRAWN with (eased toward facing, or the slash direction during a swing)
  function faceCenter(x, z) { me.facing = Math.atan2(-x, -z); localYaw = me.facing; rig.yaw = Math.atan2(x, z); rig.pitch = 0.25; }
  placePlayer(pv, lastSpawn.x, lastSpawn.y, lastSpawn.z, false);
  faceCenter(lastSpawn.x, lastSpawn.z);
  stepWorld(ctx);

  // ---- net state ----------------------------------------------------------------------------------------------------------------
  const serverUrl = new URLSearchParams(location.search).get('server') || undefined;   // dev: ?server=http://localhost:3000 (needs CORS_ORIGIN there)
  const socket = io(serverUrl, { transports: ['websocket', 'polling'] });
  let myId = null, myName = '', myColor = 0x5ee6ff, myKo = 0, myHp = MELEE.maxHp, myMaxHp = MELEE.maxHp;
  let wantJoin = false, joined = false;
  let ping = 0, clockOffset = 0, bestRtt = Infinity, lastSnapT = 0;     // clockOffset: serverNow - clientNow (ms), see serverNow()
  const serverNow = () => Date.now() + clockOffset;
  const remotes = new Map();                                // id -> remote record
  const slotUsed = new Array(TETHER_SLOTS).fill(false); slotUsed[0] = true;
  const puppetPool = new Map();                             // colour -> idle puppets (a puppet's colour is fixed, so leavers are reused by colour)
  let localPuppet = null;

  // ---- local ragdoll + fall / respawn -------------------------------------------------------------------------------------------
  let localRag = null;
  const localTorso = { x: 0, y: 0, z: 0 };
  let awaiting = false, respawnWait = 0, forceFall = false;           // awaiting = ragdolling, waiting for the server's 'respawn' (void fall or KO)
  let tumbling = false, tumbleT = 0;                                  // tumbling = a heavy (non-lethal) hit sent your pod rolling: a short ragdoll, then you stand up where it stopped
  let fallPos = { x: 0, y: 0, z: 0 }, fallVel = { x: 0, y: 0, z: 0 }, fallYaw = 0;
  let tickN = 0;

  function spawnRag(pos, vel, yaw) {                        // the tumbling pod: ONE capsule body (ragdoll.js), launched with `vel`
    return spawnRagdoll(ctx.RAPIER, ctx.world, pos, vel, null, { yaw, rng: Math.random });
  }
  function killLocalRagdoll() {
    if (localRag) { despawnRagdoll(ctx.world, localRag); localRag = null; }
    if (localPuppet) localPuppet.setMode('pod');
  }
  function applyRespawn(sp, hp) {
    killLocalRagdoll();
    lastSpawn = sp;
    placePlayer(pv, sp.x, sp.y || 0, sp.z, false);
    me = createPlayerState();                               // momentum, cooldowns, chains, grapple: all fresh
    faceCenter(sp.x, sp.z);
    awaiting = false; respawnWait = 0; forceFall = false; tumbling = false; tumbleT = 0;
    setHp(hp === undefined ? myMaxHp : hp);
    clearInput();
    stepWorld(ctx);                                         // one step so the query structures see the new position
    sendState();
  }
  function startFall() {                                    // fell below MAP.fallY (hasFallen) or pressed R
    const f = feetPos(pv);
    fallPos = { x: f.x, y: f.y, z: f.z };
    fallVel = { x: me.vx, y: Math.min(me.vy, 0), z: me.vz };
    fallYaw = me.facing;
    if (me.grappleActive) endGrapple(me);
    if (localRag) despawnRagdoll(ctx.world, localRag);
    localRag = spawnRag(fallPos, fallVel, fallYaw);         // brief tumble, cosmetic only
    awaiting = true; respawnWait = 0; forceFall = false; tumbling = false; tumbleT = 0;
    placePlayer(pv, lastSpawn.x, lastSpawn.y || 0, lastSpawn.z, false);   // park the capsule safely; it stays hidden while down
    me = createPlayerState(); me.locked = true; me.facing = fallYaw;
    sendState();                                            // 'ragdoll: true' goes out at once
    if (socket.connected) socket.emit('respawnReq');
  }

  // A hit that is heavy enough (or lethal) turns YOUR pod into the tumbling ragdoll, launched by the knockback (kv, m / s) on top of half your own speed.
  //  - lethal (KO): like a fall, you wait for the server's 'respawn' (it grants it after MELEE.koRespawnDelay), no 'respawnReq' needed;
  //  - heavy but alive: `tumbling` for MELEE.tumbleTime, then endTumble() stands the pod up where it came to rest and hands you control again.
  function startTumble(kv, lethal) {
    if (awaiting) return;
    const f = feetPos(pv);
    fallPos = { x: f.x, y: f.y, z: f.z };
    fallVel = { x: me.vx * 0.5 + kv.x, y: Math.max(me.vy, 0) * 0.5 + kv.y, z: me.vz * 0.5 + kv.z };
    fallYaw = me.facing;
    if (me.grappleActive) endGrapple(me);
    if (localRag) despawnRagdoll(ctx.world, localRag);
    localRag = spawnRag(fallPos, fallVel, fallYaw);
    placePlayer(pv, lastSpawn.x, lastSpawn.y || 0, lastSpawn.z, false);     // park the capsule while the pod tumbles
    me = createPlayerState(); me.locked = true; me.facing = fallYaw;
    forceFall = false;
    if (lethal) { awaiting = true; respawnWait = 0; tumbling = false; tumbleT = 0; }
    else { tumbling = true; tumbleT = 0; }
    sendState();                                            // 'ragdoll: true' + the launch velocity: remotes tumble the same pod from here
  }
  function endTumble() {
    const c = ragdollCenter(localRag), v = ragdollVelocity(localRag);
    killLocalRagdoll();
    tumbling = false; tumbleT = 0;
    placePlayer(pv, c.x, c.y - 0.35, c.z, false);           // a pod on its side has its centre 0.35 m up: the feet touch the floor at worst, a standing pod drops the last bit
    me = createPlayerState();
    const hs = Math.hypot(v.x, v.z), k = 0.6 * Math.min(1, 14 / Math.max(hs, 1e-6));   // keep a little momentum (60 %, never above 14 m/s)
    me.vx = v.x * k; me.vz = v.z * k; me.vy = Math.max(-12, Math.min(v.y * 0.6, 8));
    me.facing = fallYaw; localYaw = fallYaw;
    clearInput();
    stepWorld(ctx);                                         // one step so the query structures see the new position
    sendState();
  }

  // ---- state packet (30 Hz) ----------------------------------------------------------------------------------------------------
  function sendState() {
    if (!joined || !socket.connected) return;
    const down = awaiting || tumbling;                      // ragdolling: the frozen launch position / velocity goes out (remotes tumble their own copy of the pod from it)
    let x, y, z, vx, vy, vz, yaw, h;
    if (down) { x = fallPos.x; y = fallPos.y; z = fallPos.z; vx = fallVel.x; vy = fallVel.y; vz = fallVel.z; yaw = fallYaw; h = m(PUPPET.height); }
    else { const f = feetPos(pv); x = f.x; y = f.y; z = f.z; vx = me.vx; vy = me.vy; vz = me.vz; yaw = me.facing; h = me.height; }
    const ga = !down && me.grappleActive;
    socket.volatile.emit('state', {
      x: r3(x), y: r3(y), z: r3(z), vx: r3(vx), vy: r3(vy), vz: r3(vz), yaw: r3(yaw), height: r3(h),
      sliding: !down && !!me.sliding, dashing: !down && me.dashT > 0, wallRunning: !down && !!me.wallRunning,
      grappleActive: ga, grappleAnchor: ga ? { x: r3(me.grappleAnchor.x), y: r3(me.grappleAnchor.y), z: r3(me.grappleAnchor.z) } : null,
      ragdoll: down,
      parrying: !down && me.parryT > 0, perfectParry: !down && me.parryT > 0 && me.parryElapsed <= PARRY.perfectWindow,
      dodging: !down && me.dashT > 0 && me.dashElapsed <= DASH.dodgeIframes,                         // the server re-checks both windows against its own clock
    });
  }

  // ---- remote players ----------------------------------------------------------------------------------------------------------
  function getPuppet(color) {
    const pool = puppetPool.get(color);
    return pool && pool.length ? pool.pop() : view.addPuppet(color);
  }
  function freeSlot() { for (let i = 1; i < TETHER_SLOTS; i++) if (!slotUsed[i]) { slotUsed[i] = true; return i; } return -1; }

  function addRemote(p) {
    if (remotes.has(p.id)) return;
    const r = {
      id: p.id, name: p.name, color: p.color, ko: p.ko | 0, ping: p.ping | 0,
      puppet: getPuppet(p.color), slot: freeSlot(),
      cur: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, height: p.height || m(PUPPET.height) },
      tgt: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, height: p.height || m(PUPPET.height) },
      vel: { x: 0, y: 0, z: 0 }, grappleActive: false, anchor: null, ragdoll: false, rag: null,
      torso: { x: 0, y: 0, z: 0 }, tp: { x: 0, y: 0, z: 0 },
      hp: p.hp === undefined ? MELEE.maxHp : p.hp, dead: !!p.dead, attackT: 0, attackYaw: 0, guard: 0,        // attackT / attackYaw: their slash swing ('slashFx')
    };
    r.puppet.setMode('pod'); r.puppet.setAttack(-1); r.puppet.setGuard(0);
    remotes.set(p.id, r);
    applyRemote(r, p);
  }
  function killRemoteRag(r) {
    if (r.rag) { despawnRagdoll(ctx.world, r.rag); r.rag = null; }
  }
  function removeRemote(id) {
    const r = remotes.get(id);
    if (!r) return;
    killRemoteRag(r);
    r.puppet.setAttack(-1); r.puppet.setGuard(0); r.puppet.setMode('hidden');
    if (!puppetPool.has(r.color)) puppetPool.set(r.color, []);
    puppetPool.get(r.color).push(r.puppet);
    if (r.slot > 0) { view.setGrapple(r.slot, null); slotUsed[r.slot] = false; }
    remotes.delete(id);
  }
  function clearRemotes() { for (const id of [...remotes.keys()]) removeRemote(id); }

  function applyRemote(r, d) {                              // d: a player record (join / snapshot entry)
    const t = r.tgt;
    t.x = d.x; t.y = d.y; t.z = d.z; t.yaw = d.yaw; t.height = d.height || t.height;
    r.vel.x = d.vx; r.vel.y = d.vy; r.vel.z = d.vz;
    r.dashing = !!d.dashing || !!d.dodging;                 // their dash / phase-dodge: the pod leans fully into it
    r.guard = d.parrying ? (d.perfectParry ? 2 : 1) : 0;    // their guard stance + barrier
    r.grappleActive = !!d.grappleActive; r.anchor = d.grappleAnchor || null;
    if (d.ko !== undefined) r.ko = d.ko | 0;
    if (d.ping !== undefined) r.ping = d.ping | 0;
    if (d.hp !== undefined) r.hp = d.hp;
    if (d.dead !== undefined) r.dead = !!d.dead;
    const flag = !!d.ragdoll;
    if (flag && !r.ragdoll) {                               // just fell: tumble where they fell
      r.ragdoll = true; r.attackT = 0;
      Object.assign(r.cur, t);
      killRemoteRag(r);
      r.rag = spawnRag({ x: t.x, y: t.y, z: t.z }, { x: r.vel.x, y: Math.min(r.vel.y, 0), z: r.vel.z }, t.yaw);
    } else if (!flag && r.ragdoll) {                        // respawned: drop the ragdoll, snap to the new spawn
      r.ragdoll = false;
      killRemoteRag(r);
      Object.assign(r.cur, t);
    }
  }

  // Pod lean target (world-space, |l| <= JUICE.tiltMax rad, the pod tips toward +l): into the horizontal travel direction, scaling up to full tilt at JUICE.tiltSpeed units / s;
  // `full` (a dash / dodge) leans all the way regardless of speed.
  const _lean = { x: 0, z: 0 };
  function leanTarget(vx, vz, full) {
    const h = Math.hypot(vx, vz);
    if (h < 1e-3) { _lean.x = _lean.z = 0; return _lean; }
    const a = JUICE.tiltMax * (full ? 1 : Math.min(1, h / SCALE / JUICE.tiltSpeed));
    _lean.x = vx / h * a; _lean.z = vz / h * a;
    return _lean;
  }

  function updateRemote(r, k, dt) {
    const c = r.cur, t = r.tgt, dx = t.x - c.x, dy = t.y - c.y, dz = t.z - c.z;
    if (dx * dx + dy * dy + dz * dz > SNAP_DIST * SNAP_DIST) { c.x = t.x; c.y = t.y; c.z = t.z; c.yaw = t.yaw; c.height = t.height; }
    else {
      c.x += dx * k; c.y += dy * k; c.z += dz * k;
      c.yaw += angDiff(c.yaw, t.yaw) * k;
      c.height += (t.height - c.height) * k;
    }
    const pu = r.puppet;
    if (r.attackT > 0) r.attackT = Math.max(0, r.attackT - dt);
    if (r.rag) { syncRagdollMeshes(r.rag, pu.pod, r.torso); pu.setMode('ragdoll'); pu.setAttack(-1); pu.setSpeed(0); pu.setLean(0, 0); pu.setGuard(0); }      // the SAME pod, now driven by the physics body
    else {
      pu.setMode('pod');
      pu.setFeet(c.x, c.y, c.z); pu.setHeight(c.height);
      if (r.attackT > 0) c.yaw += angDiff(c.yaw, r.attackYaw) * (1 - Math.exp(-40 * dt));       // face the slash direction while the blade sweeps
      pu.setYaw(c.yaw);
      pu.setAttack(r.attackT > 0 ? Math.min(0.999, 1 - r.attackT / MELEE.attackTime) : -1);
      pu.setGuard(r.guard);
      pu.setSpeed(Math.hypot(r.vel.x, r.vel.z) / SCALE);                // their blade glows with THEIR speed: you can read a fully charged (75 damage) opponent
      const L = leanTarget(r.vel.x, r.vel.z, r.dashing); pu.setLean(L.x, L.z);
    }
    if (r.slot > 0) {                                       // floating grapple tether
      if (r.grappleActive && r.anchor && !r.rag) {
        r.tp.x = c.x; r.tp.y = c.y + c.height * GRAPPLE.torso; r.tp.z = c.z;
        view.setGrapple(r.slot, r.tp, r.anchor);
      } else view.setGrapple(r.slot, null);
    }
  }

  // ---- socket events -------------------------------------------------------------------------------------------------------------
  function syncClock() {                                    // one round trip: gives RTT and the server clock offset
    if (!socket.connected) return;
    const t0 = performance.now();
    socket.timeout(3000).emit('timeSync', (err, serverTime) => {
      if (err) return;
      const rtt = performance.now() - t0;
      ping = ping ? ping * 0.7 + rtt * 0.3 : rtt;
      if (rtt <= bestRtt * 1.5 + 5) { bestRtt = Math.min(bestRtt, rtt); clockOffset = serverTime + rtt / 2 - Date.now(); }   // trust the quickest trips
      socket.volatile.emit('ping', Math.round(ping));
    });
  }
  setInterval(syncClock, 2000);

  function sendJoin() { socket.emit('join', { name: myName, color: myColor }); }
  function setMsg(t) { el.msg.textContent = t || ''; }
  let joinTimer = 0;

  socket.on('connect', () => {
    bestRtt = Infinity;
    for (let k = 0; k < 5; k++) setTimeout(syncClock, k * 250);        // quick burst so the offset is good before the first snapshot
    el.netWarn.style.display = 'none';
    if (wantJoin) sendJoin();                                          // first Play click, or an automatic re-join after a reconnect
  });
  socket.on('disconnect', () => { el.netWarn.style.display = joined ? 'block' : 'none'; });
  socket.on('connect_error', () => { if (!joined && wantJoin) setMsg('Cannot reach the server, retrying...'); });
  socket.on('full', ({ max }) => {
    wantJoin = false; clearTimeout(joinTimer);
    el.play.disabled = false; el.play.textContent = 'PLAY'; setMsg('Room is full (' + max + ' players).');
  });
  socket.on('init', ({ id, spawn, players, serverTime, hp, maxHp }) => {
    clearTimeout(joinTimer);
    myId = id; myMaxHp = maxHp || MELEE.maxHp;
    clockOffset = serverTime - Date.now();                             // rough until the timeSync samples refine it
    clearRemotes();
    for (const p of players) if (p.id !== id) addRemote(p);
    if (!localPuppet) localPuppet = view.addPuppet(myColor);
    joined = true; lastSnapT = 0; myKo = 0;
    applyRespawn(spawn, hp === undefined ? myMaxHp : hp);
    el.overlay.style.display = 'none'; setMsg('');
    clearInput(true);
    toast('Welcome, ' + myName + '!', 2);
  });
  socket.on('playerJoined', (p) => { if (joined && p.id !== myId) { addRemote(p); toast(p.name + ' joined', 1.6); } });
  socket.on('playerLeft', (id) => {
    const r = remotes.get(id);
    if (r) { toast(r.name + ' left', 1.6); removeRemote(id); }
  });
  socket.on('snapshot', (s) => {
    if (!joined || !s || !Array.isArray(s.players)) return;
    if (s.t && s.t < lastSnapT) return;                                // drop out-of-order snapshots
    if (s.t) lastSnapT = s.t;
    for (const d of s.players) {
      if (d.id === myId) { myKo = d.ko | 0; if (typeof d.hp === 'number') myHp = d.hp; if (d.maxHp) myMaxHp = d.maxHp; continue; }
      const r = remotes.get(d.id);
      if (r) applyRemote(r, d);
    }
  });
  socket.on('respawn', ({ spawn, hp }) => { if (joined && (awaiting || tumbling)) applyRespawn(spawn, hp); });

  // ---- melee events from the server ----------------------------------------------------------------------------------------------
  const soundVol = (pos) => { const f = feetPos(pv); return Math.max(0.08, 1 - Math.hypot(pos.x - f.x, pos.z - f.z) / 40); };   // other players' sounds fade with distance (40 m)
  function popHitmarker(kill) {                             // restart the CSS pop on the crosshair ticks (gold + bigger on a KO)
    const h = el.hit; h.classList.remove('show'); h.classList.toggle('kill', !!kill); void h.offsetWidth; h.classList.add('show');
  }
  function flashHurt() {
    el.hurt.classList.remove('show'); void el.hurt.offsetWidth; el.hurt.classList.add('show');
    el.hpBox.classList.remove('hit'); void el.hpBox.offsetWidth; el.hpBox.classList.add('hit');
  }
  function addFeed(k) {
    const row = document.createElement('div');
    row.className = 'kf' + (k.killerId === myId || k.victimId === myId ? ' me' : '') + (k.cause === 'void' ? ' void' : '');
    const who = (name, color) => {
      const nm = document.createElement('span'); nm.className = 'nm';
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = '#' + (color >>> 0).toString(16).padStart(6, '0');
      const t = document.createElement('span'); t.textContent = name;
      nm.append(sw, t); return nm;
    };
    const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = k.cause === 'void' ? 'VOID' : 'SLASH';
    row.append(who(k.killerName, k.killerColor), ic, who(k.victimName, k.victimColor));
    el.feed.prepend(row);
    while (el.feed.children.length > 5) el.feed.lastChild.remove();
    setTimeout(() => row.remove(), 5600);
  }
  socket.on('slashFx', ({ id, yaw }) => {                   // somebody else swung (hit or miss): blade sweep + whoosh
    const r = remotes.get(id);
    if (!joined || !r || r.rag) return;
    r.attackT = MELEE.attackTime; r.attackYaw = yaw;
    audio.play('slash', soundVol(r.cur) * 0.8);
  });
  socket.on('hit', ({ attackerId, targetId, damage, knockVec, kill, hp }) => {
    if (!joined) return;
    const power = Math.min(1, damage / MELEE.maxDmg);
    if (targetId === myId) {                                         // (Phase-Dodge and perfect parries never reach here: the server answers those with 'dodged' / 'parried')
      setHp(hp); flashHurt(); audio.play('hurt', 0.55 + 0.45 * power);
      if (!awaiting && !tumbling) {
        const heavy = Math.hypot(knockVec.x, knockVec.z) >= m(MELEE.tumbleKnock);
        if (kill || heavy) { startTumble(knockVec, kill); shakeAmp = Math.max(shakeAmp, JUICE.shakeHurt); }   // heavy hit / KO: the pod tumbles
        else applyKnockback(me, knockVec.x, knockVec.y, knockVec.z);     // light hit: a stagger + knockback under normal gravity
      }
    } else {
      const r = remotes.get(targetId);
      if (r) { r.hp = hp; r.puppet.flash(0.6 + 0.4 * power); }
    }
    if (attackerId === myId) {
      popHitmarker(kill); audio.play('impact', power);
      if (kill || damage >= JUICE.heavyDmg) { hitStopT = JUICE.hitStop; shakeAmp = Math.max(shakeAmp, kill ? JUICE.shakeKO : JUICE.shakeHeavy); }   // impact juice: freeze, then shake
    }
    else if (targetId !== myId) { const r = remotes.get(targetId); audio.play('impact', (r ? soundVol(r.cur) : 0.3) * power); }
  });
  // ---- Slice M2: the server's verdicts on a slash that met a Phase-Dodge / a guard -------------------------------------------------
  socket.on('dodged', ({ attackerId, targetId }) => {      // the slash passed through the target's i-frames: no damage, no knockback
    if (!joined) return;
    if (targetId === myId) onDodged();
    else {
      const r = remotes.get(targetId);
      audio.play('phase', r ? soundVol(r.cur) : 0.3);
      if (r) r.puppet.flash(0.5);
      if (attackerId === myId) toast('EVADED!', 0.9);
    }
  });
  socket.on('parried', ({ defenderId, attackerId, perfect, point, attackerKnock, attackerStun }) => {
    if (!joined) return;
    const meDef = defenderId === myId, meAtk = attackerId === myId, mine = meDef || meAtk;
    const vol = mine ? 1 : (point ? soundVol(point) : 0.4);
    const def = meDef ? localPuppet : (remotes.get(defenderId) || {}).puppet;
    if (def) def.flash(perfect ? 1 : 0.5);
    audio.play(perfect ? 'clang' : 'block', vol);
    if (!perfect) { if (meDef) toast('BLOCKED', 0.7); return; }
    if (mine) { hitStopT = Math.max(hitStopT, PARRY.hitStop); shakeAmp = Math.max(shakeAmp, PARRY.shakePerfect); }
    if (meDef) {                                            // counter window: dash and grapple are ready again at once
      me.dashCd = 0; me.grappleCd = 0;
      toast('PARRIED!', 1.0); startFlare('#fff3a0', '#00f5d4', '#7fffe9');
    }
    if (meAtk) {                                            // your slash was parried: shoved back + staggered (stunT locks the input, same as `locked`, but survives the per-tick reset)
      toast('PARRIED!  staggered', 1.0);
      if (!awaiting && !tumbling && attackerKnock) applyKnockback(me, attackerKnock.x, attackerKnock.y, attackerKnock.z, attackerStun || PARRY.attackerStun);
    }
  });
  socket.on('killFeed', (k) => {
    if (!joined) return;
    addFeed(k);
    audio.play('ko', k.killerId === myId || k.victimId === myId ? 1 : 0.4);
    if (k.killerId === myId) { if (k.cause === 'void') popHitmarker(true); toast('KO  +1   ' + k.victimName, 1.4); }
  });
  function onDodged() {                                     // a server hit landed on you inside the dodge i-frames
    toast('DODGED!', 0.9); startFlare('#bff6ff', '#00e5ff', '#7fe9ff', JUICE.dodgeFlash);
    audio.play('phase');
    if (localPuppet) localPuppet.flash(0.7);
  }
  function startFlare(col, glow, glow2, dur = PARRY.flareTime) { dodgeFlashT = flashDur = dur; flashCol = col; flashGlow = glow; flashGlow2 = glow2; }   // crosshair flare (dodge / parry)
  function setHp(h) { myHp = Math.max(0, Math.min(myMaxHp, Number(h) || 0)); }

  // ---- join overlay ----------------------------------------------------------------------------------------------------------------
  try { el.name.value = localStorage.getItem('pf3d.name') || ''; } catch (e) { /* storage blocked */ }
  try { el.color.value = localStorage.getItem('pf3d.color') || '#' + Math.floor(0x404040 + Math.random() * 0xa0a0a0).toString(16).padStart(6, '0'); } catch (e) { /* ignore */ }

  function play() {
    if (el.play.disabled) return;
    myName = el.name.value.trim().slice(0, 16) || 'Player';
    myColor = parseInt(el.color.value.slice(1), 16);
    if (!Number.isInteger(myColor)) myColor = 0x5ee6ff;
    try { localStorage.setItem('pf3d.name', el.name.value.trim()); localStorage.setItem('pf3d.color', el.color.value); } catch (e) { /* ignore */ }
    el.play.disabled = true; el.play.textContent = 'JOINING...'; setMsg('');
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }   // must run inside the click / key gesture
    wantJoin = true;
    if (socket.connected) sendJoin();
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => {
      if (joined) return;
      el.play.disabled = false; el.play.textContent = 'PLAY'; setMsg('No answer from the server. Try again.');
    }, 10000);
  }
  el.play.addEventListener('click', play);
  el.name.addEventListener('keydown', (e) => { if (e.code === 'Enter') play(); });

  // ---- keys: R respawn, Tab scoreboard -------------------------------------------------------------------------------------------
  let showBoard = false;
  window.addEventListener('keydown', (e) => {
    if (typingTarget(e)) return;
    if (e.code === 'Tab') { e.preventDefault(); if (joined) showBoard = true; }
    if (e.code === 'KeyR' && !e.repeat && joined && !awaiting && !tumbling) forceFall = true;       // "I am stuck": handled exactly like a fall
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Tab') showBoard = false; });
  window.addEventListener('blur', () => { showBoard = false; });

  // ---- grapple aim: from the camera eye along the camera look direction (the crosshair) ----------------------------------------------
  const _eye = new THREE.Vector3(), _look = new THREE.Vector3();
  function aimFromCamera() {
    view.camera.getWorldPosition(_eye); view.camera.getWorldDirection(_look);
    return { origin: { x: _eye.x, y: _eye.y, z: _eye.z }, dir: { x: _look.x, y: _look.y, z: _look.z }, owner: 0, skip: () => false };
  }

  // ---- melee aim: the camera look direction flattened to the ground (what the crosshair points at), plus the opponents the magnetic lunge may lock onto (their visible
  // feet positions; KO'd / tumbling pods are skipped). player.js picks the nearest one inside the cleave cone.
  function meleeAim() {
    view.camera.getWorldDirection(_look);
    let dx = _look.x, dz = _look.z;
    if (Math.hypot(dx, dz) < 0.12) { dx = Math.sin(me.facing); dz = Math.cos(me.facing); }       // looking straight up / down: use the facing
    const targets = [];
    for (const r of remotes.values()) if (!r.rag && !r.ragdoll && !r.dead) targets.push(r.cur);
    return { dirX: dx, dirZ: dz, targets };
  }

  // ---- one fixed simulation tick (your player only) ----------------------------------------------------------------------------------
  function tick() {
    if (!joined) return;
    const down = awaiting || tumbling;
    me.locked = down;                                       // ragdolling: skip input (the latches still drain below)
    const snap = readInput(forwardOf(rig));
    if (snap.grapple && !down) snap.aim = aimFromCamera();
    if (snap.attack && !down) snap.melee = meleeAim();
    const wasOnGround = pv.player.grounded;
    stepPlayer(me, snap, pv);
    for (const e of me.sfx) { audio.play(e); if (e === 'dash' && localPuppet) localPuppet.flash(0.35); }   // a pulse on the pod marks the i-frames
    if (me.slashEvt) {                                      // the swing started: ask the server to judge it (it owns cooldown, cone, reach, damage)
      const e = me.slashEvt; me.slashEvt = null;
      if (socket.connected) socket.emit('slash', { dir: { x: r3(e.dirX), z: r3(e.dirZ) }, speed: Math.round(e.speed) });
    }
    if (!down && !wasOnGround && pv.player.grounded && me.vy < 0) triggerLandDip(rig, me.vy);   // me.vy is still the touchdown speed here

    stepWorld(ctx);

    if (awaiting) {
      respawnWait += STEP;
      if (respawnWait > RESPAWN_FALLBACK) applyRespawn(lastSpawn);     // server silent (offline?): respawn on our own
    } else if (tumbling) {
      tumbleT += STEP;
      if (ragdollCenter(localRag).y < m(MAP.fallY)) {                  // blasted off the roof: that is a fall (the server credits the last attacker)
        tumbling = false; awaiting = true; respawnWait = 0;
        if (socket.connected) socket.emit('respawnReq');
      } else if (tumbleT >= MELEE.tumbleTime) endTumble();             // the pod has bounced for long enough: stand up where it came to rest
    } else if (hasFallen(pv) || forceFall) startFall();               // hasFallen = feet below MAP.fallY

    if ((++tickN) % SEND_EVERY === 0) sendState();
  }

  // ---- HUD ------------------------------------------------------------------------------------------------------------------------
  let netT = 0, boardT = 0, xhairText = '';
  function renderBoard() {
    const rows = [{ name: myName, color: myColor, ko: myKo, ping: Math.round(ping), me: true }];
    for (const r of remotes.values()) rows.push({ name: r.name, color: r.color, ko: r.ko, ping: r.ping, me: false });
    rows.sort((a, b) => b.ko - a.ko || a.name.localeCompare(b.name));
    el.sbRows.replaceChildren(...rows.map((p) => {
      const row = document.createElement('div'); row.className = 'row' + (p.me ? ' me' : '');
      const nm = document.createElement('span'); nm.className = 'nm';
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = '#' + p.color.toString(16).padStart(6, '0');
      const label = document.createElement('span'); label.textContent = p.name;
      nm.append(sw, label);
      const ko = document.createElement('span'); ko.className = 'n'; ko.textContent = String(p.ko);
      const pg = document.createElement('span'); pg.className = 'n'; pg.textContent = p.ping ? p.ping + ' ms' : '-';
      row.append(nm, ko, pg);
      return row;
    }));
  }
  function updateHud(dt, hSpeed) {
    toastT = Math.max(0, toastT - dt);
    if (toastT <= 0 && el.toast.textContent) el.toast.textContent = '';
    el.resume.style.display = joined && !document.pointerLockElement ? 'block' : 'none';

    netT -= dt;
    if (netT <= 0) {
      netT = 0.25;
      el.net.textContent = joined ? 'PLAYERS ' + (remotes.size + 1) + '   PING ' + Math.round(ping) + ' ms' : '';
    }
    el.sb.style.display = showBoard && joined ? 'block' : 'none';
    if (showBoard) { boardT -= dt; if (boardT <= 0) { boardT = 0.25; renderBoard(); } } else boardT = 0;

    const hs = me;
    el.hud.textContent = !joined ? '' : 'spd ' + Math.round(hSpeed / SCALE) + '  runT ' + hs.runT.toFixed(2) + ' / ' + RUN.rampT +
      '  BHOP ' + (hs.bhopChain > 0 ? 'x' + hs.bhopChain : '-') + (hs.bhopTimer > 0 ? ' (window)' : '') +
      '  DASH ' + (hs.dashT > 0 ? 'GO' : hs.dashCd > 0 ? hs.dashCd.toFixed(1) + 's' : 'ready') +
      '  AIRJ ' + hs.airJumpsLeft +
      '  GRAPPLE ' + (hs.grappleActive ? 'GO' : hs.grappleCd > 0 ? hs.grappleCd.toFixed(1) + 's' : 'ready') +
      (hs.wallRunning ? '  WALLRUN' : hs.regrabTimer > 0 ? '  regrab ' + hs.regrabTimer.toFixed(2) + 's' : '') +
      (hs.sliding ? '  SLIDE' : '') + (hs.slideBoostCd > 0 ? '  slideboost ' + hs.slideBoostCd.toFixed(2) + 's' : '  slideboost ready') +
      '  SLASH ' + (hs.attackCd > 0 ? hs.attackCd.toFixed(2) + 's' : 'ready') + (hs.dodgeT > 0 ? '  PHASE' : '') +
      '  PARRY ' + (hs.parryT > 0 ? (hs.parryElapsed <= PARRY.perfectWindow ? 'PERFECT' : 'GUARD') : hs.parryCd > 0 ? hs.parryCd.toFixed(2) + 's' : 'ready');

    // HP bar (bottom centre): the fill snaps down at once, the pale ghost trails behind (CSS transition); colour steps cyan -> amber -> coral
    el.hpBox.style.display = joined ? 'block' : 'none';
    if (joined) {
      const f = Math.max(0, Math.min(1, myHp / myMaxHp)), txt = String(Math.ceil(myHp - 1e-6));
      if (txt !== el.hpNum.textContent) {
        el.hpNum.textContent = txt;
        el.hpFill.style.transform = el.hpGhost.style.transform = 'scaleX(' + f.toFixed(3) + ')';
        el.hpBox.classList.toggle('mid', f <= 0.6 && f > 0.3); el.hpBox.classList.toggle('low', f <= 0.3);
      }
      const ko = 'KO ' + myKo; if (el.koNum.textContent !== ko) el.koNum.textContent = ko;
      el.slashFill.style.transform = 'scaleX(' + (1 - Math.max(0, Math.min(1, hs.attackCd / MELEE.cooldown))).toFixed(3) + ')';   // slash cooldown line fills while the blade recharges
    }

    const gtxt = !joined ? '' : hs.grappleActive ? 'HOOKED' : hs.grappleCd > 0 ? 'GRAPPLE ' + hs.grappleCd.toFixed(1) + 's' : 'GRAPPLE READY';
    if (gtxt !== xhairText) {
      xhairText = gtxt; el.gstat.textContent = gtxt;
      el.xhair.style.background = hs.grappleActive ? '#7fe9ff' : hs.grappleCd > 0 ? '#ff6b6b' : '#fff';
    }
    // "DODGED!" crosshair flash: the dot swells and glows cyan, then settles back (the normal grapple colour is re-applied through xhairText)
    if (dodgeFlashT > 0) {
      dodgeFlashT = Math.max(0, dodgeFlashT - dt);
      const f = dodgeFlashT / flashDur;
      el.xhair.style.background = flashCol; el.xhair.style.transform = 'scale(' + (1 + 2.6 * f).toFixed(2) + ')';
      el.xhair.style.boxShadow = '0 0 0 1px rgba(0, 0, 0, .7), 0 0 ' + Math.round(10 + 22 * f) + 'px ' + flashGlow + ', 0 0 ' + Math.round(6 + 16 * f) + 'px ' + flashGlow2;
      xhairFlashing = true;
    } else if (xhairFlashing) { xhairFlashing = false; el.xhair.style.transform = ''; el.xhair.style.boxShadow = ''; xhairText = ''; }
  }

  // ---- render loop: accumulate real time, run whole ticks, then draw -----------------------------------------------------------------
  let acc = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < MAX_STEPS_PER_FRAME) { tick(); acc -= STEP; n++; }
    if (n >= MAX_STEPS_PER_FRAME) acc = 0;

    // your pod: the tumbling ragdoll while down (the same pod mesh, driven by the physics body), otherwise standing on the capsule, squashed to the collider height,
    // facing the slash direction during a swing (the blade sweep is interpolated between sim ticks with the accumulator `acc`)
    if (joined && localPuppet) {
      if (localRag) { syncRagdollMeshes(localRag, localPuppet.pod, localTorso); localPuppet.setMode('ragdoll'); localPuppet.setAttack(-1); localPuppet.setSpeed(0); localPuppet.setLean(0, 0); localPuppet.setGuard(0); }
      else if (awaiting) { localPuppet.setMode('hidden'); localPuppet.setAttack(-1); localPuppet.setSpeed(0); localPuppet.setLean(0, 0); localPuppet.setGuard(0); }
      else {
        const f = feetPos(pv), swinging = me.attackT > 0;
        localPuppet.setMode('pod');
        localPuppet.setFeet(f.x, f.y, f.z); localPuppet.setHeight(me.height);
        localYaw += angDiff(localYaw, swinging ? me.attackYaw : me.facing) * (1 - Math.exp(-(swinging ? 40 : 14) * dt));
        localPuppet.setYaw(localYaw);
        localPuppet.setAttack(swinging ? Math.min(0.999, (MELEE.attackTime - me.attackT + acc) / MELEE.attackTime) : -1);
        localPuppet.setGuard(me.parryT > 0 ? (me.parryElapsed <= PARRY.perfectWindow ? 2 : 1) : 0);
        localPuppet.setSpeed(Math.hypot(me.vx, me.vz) / SCALE);            // blade charge glow + streak follow your horizontal speed
        const L = me.dodgeT > 0 ? leanTarget(me.dashX, me.dashZ, true) : leanTarget(me.vx, me.vz, false);   // lean into the run, fully into a dodge
        localPuppet.setLean(L.x, L.z);
      }
      if (me.grappleActive && !awaiting) view.setGrapple(0, torsoPos(pv, me), me.grappleAnchor); else view.setGrapple(0, null);
    }

    // everybody else: exponential smoothing toward the latest snapshot
    const k = 1 - Math.exp(-SMOOTH * dt);
    for (const r of remotes.values()) updateRemote(r, k, dt);
    const frozen = hitStopT > 0;                            // hit-stop: for JUICE.hitStop seconds the blade animation and the camera hold still (the simulation keeps running)
    if (frozen) hitStopT = Math.max(0, hitStopT - dt);
    else view.update(dt);                                   // floating blades, slash trails, hit flashes, speed glow, lean

    // chase camera: your capsule, or your tumbling torso while you are down
    const hv = pv, hSpeed = Math.hypot(me.vx, me.vz);
    let focus;
    if (localRag) {
      focus = localTorso;
      if (!frozen) updateCamera(rig, view.camera, hv, focus, dt, 0.15, 0, 0);
    } else {
      focus = feetPos(hv);
      if (!frozen) updateCamera(rig, view.camera, hv, focus, dt, m(CAM.pivot) * me.height / m(PUPPET.height), hSpeed, me.wallRunning ? me.wallSide : 0);
    }
    // camera shake: a decaying random jolt added AFTER updateCamera (which rebuilds position + look every frame, so nothing accumulates)
    if (!frozen) {
      if (shakeAmp > 0.0004) {
        const cam = view.camera, a = shakeAmp;
        cam.position.x += (Math.random() * 2 - 1) * a; cam.position.y += (Math.random() * 2 - 1) * a * 0.7; cam.position.z += (Math.random() * 2 - 1) * a;
        cam.rotateZ((Math.random() * 2 - 1) * a * 0.12);
        shakeAmp *= Math.exp(-JUICE.shakeDecay * dt);
      } else shakeAmp = 0;
    }
    view.setFocus(focus);
    audio.setMotion(hSpeed / SCALE, me.sliding && hv.player.grounded && !localRag);   // slide hiss + high-speed wind (loops follow the speed)
    updateHud(dt, hSpeed);

    view.renderer.render(view.scene, view.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
