// src/main.js
// MAIN: boots the world + scene, joins the Socket.IO room, runs YOUR player at 60 Hz (client-authoritative, 0 ms movement lag), sends a
// volatile 'state' packet at 30 Hz, and renders every remote player from the server's 30 Hz 'snapshot' with exponential smoothing.
// No bots and no tag rules here any more: movement lives in physics/player.js, the room in server.js, keyboard in input.js.
//
// One local tick (STEP = 1/60):
//   1. read input -> stepPlayer (queues the kinematic move)      2. stepWorld (capsule moves, ragdolls tumble)
//   3. fell below the map / R pressed -> local ragdoll + 'respawnReq'     4. every 2nd tick: send 'state'
// Remote players are cosmetic: one puppet each (capsule squashed to `height`, grapple tether, ragdoll while their `ragdoll` flag is set).
// Audio: createAudio() below is a zero-asset Web Audio synth (oscillator sweeps + filtered noise), unlocked by the first click / keypress, [M] mutes.
// Loads after: everything

import * as THREE from 'three';
import { io } from 'socket.io-client';
import { STEP, MAX_STEPS_PER_FRAME, SCALE, RUN, CAM, PUPPET, GRAPPLE, m } from './config.js';
import DISTRICT_MAP from './game/maps.js';
import { createWorld, addPlayerCapsule, stepWorld, feetPos, placePlayer, hasFallen } from './physics/world.js';
import { createPlayerState, stepPlayer, endGrapple, torsoPos } from './physics/player.js';
import { spawnRagdoll, syncRagdollMeshes, despawnRagdoll } from './physics/ragdoll.js';
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
  // ---- DOM ----------------------------------------------------------------------------------------------------------------------
  const el = { hud: $('hud'), net: $('net'), netWarn: $('netWarn'), toast: $('toast'), resume: $('resume'), xhair: $('crosshair'), gstat: $('grappleStatus'),
               sb: $('scoreboard'), sbRows: $('sbRows'), overlay: $('overlay'), name: $('nameInput'), color: $('colorInput'),
               play: $('playBtn'), msg: $('overlayMsg') };
  let toastT = 0;
  const toast = (msg, t = 1.6) => { el.toast.textContent = msg; toastT = t; };

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
  function faceCenter(x, z) { me.facing = Math.atan2(-x, -z); rig.yaw = Math.atan2(x, z); rig.pitch = 0.25; }
  placePlayer(pv, lastSpawn.x, lastSpawn.y, lastSpawn.z, false);
  faceCenter(lastSpawn.x, lastSpawn.z);
  stepWorld(ctx);

  // ---- net state ----------------------------------------------------------------------------------------------------------------
  const serverUrl = new URLSearchParams(location.search).get('server') || undefined;   // dev: ?server=http://localhost:3000 (needs CORS_ORIGIN there)
  const socket = io(serverUrl, { transports: ['websocket', 'polling'] });
  let myId = null, myName = '', myColor = 0x5ee6ff, myKo = 0;
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
  let awaiting = false, respawnWait = 0, forceFall = false;           // awaiting = ragdolling, waiting for the server's 'respawn'
  let fallPos = { x: 0, y: 0, z: 0 }, fallVel = { x: 0, y: 0, z: 0 }, fallYaw = 0;
  let tickN = 0;

  function spawnRag(pos, vel, yaw) {
    return spawnRagdoll(ctx.RAPIER, ctx.world, pos, vel, { x: vel.x * 0.5, y: 0, z: vel.z * 0.5 }, { yaw, rng: Math.random });
  }
  function killLocalRagdoll() {
    if (localRag) { despawnRagdoll(ctx.world, localRag); localRag = null; }
    if (localPuppet) { localPuppet.showRagdoll(false); localPuppet.showCapsule(true); }
  }
  function applyRespawn(sp) {
    killLocalRagdoll();
    lastSpawn = sp;
    placePlayer(pv, sp.x, sp.y || 0, sp.z, false);
    me = createPlayerState();                               // momentum, cooldowns, chains, grapple: all fresh
    faceCenter(sp.x, sp.z);
    awaiting = false; respawnWait = 0; forceFall = false;
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
    awaiting = true; respawnWait = 0; forceFall = false;
    placePlayer(pv, lastSpawn.x, lastSpawn.y || 0, lastSpawn.z, false);   // park the capsule safely; it stays hidden while down
    me = createPlayerState(); me.locked = true; me.facing = fallYaw;
    sendState();                                            // 'ragdoll: true' goes out at once
    if (socket.connected) socket.emit('respawnReq');
  }

  // ---- state packet (30 Hz) ----------------------------------------------------------------------------------------------------
  function sendState() {
    if (!joined || !socket.connected) return;
    let x, y, z, vx, vy, vz, yaw, h;
    if (awaiting) { x = fallPos.x; y = fallPos.y; z = fallPos.z; vx = fallVel.x; vy = fallVel.y; vz = fallVel.z; yaw = fallYaw; h = m(PUPPET.height); }
    else { const f = feetPos(pv); x = f.x; y = f.y; z = f.z; vx = me.vx; vy = me.vy; vz = me.vz; yaw = me.facing; h = me.height; }
    const ga = !awaiting && me.grappleActive;
    socket.volatile.emit('state', {
      x: r3(x), y: r3(y), z: r3(z), vx: r3(vx), vy: r3(vy), vz: r3(vz), yaw: r3(yaw), height: r3(h),
      sliding: !awaiting && !!me.sliding, dashing: !awaiting && me.dashT > 0, wallRunning: !awaiting && !!me.wallRunning,
      grappleActive: ga, grappleAnchor: ga ? { x: r3(me.grappleAnchor.x), y: r3(me.grappleAnchor.y), z: r3(me.grappleAnchor.z) } : null,
      ragdoll: awaiting,
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
    };
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
    r.puppet.showRagdoll(false); r.puppet.showCapsule(false);
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
    r.grappleActive = !!d.grappleActive; r.anchor = d.grappleAnchor || null;
    if (d.ko !== undefined) r.ko = d.ko | 0;
    if (d.ping !== undefined) r.ping = d.ping | 0;
    const flag = !!d.ragdoll;
    if (flag && !r.ragdoll) {                               // just fell: tumble where they fell
      r.ragdoll = true;
      Object.assign(r.cur, t);
      killRemoteRag(r);
      r.rag = spawnRag({ x: t.x, y: t.y, z: t.z }, { x: r.vel.x, y: Math.min(r.vel.y, 0), z: r.vel.z }, t.yaw);
    } else if (!flag && r.ragdoll) {                        // respawned: drop the ragdoll, snap to the new spawn
      r.ragdoll = false;
      killRemoteRag(r);
      Object.assign(r.cur, t);
    }
  }

  function updateRemote(r, k) {
    const c = r.cur, t = r.tgt, dx = t.x - c.x, dy = t.y - c.y, dz = t.z - c.z;
    if (dx * dx + dy * dy + dz * dz > SNAP_DIST * SNAP_DIST) { c.x = t.x; c.y = t.y; c.z = t.z; c.yaw = t.yaw; c.height = t.height; }
    else {
      c.x += dx * k; c.y += dy * k; c.z += dz * k;
      c.yaw += angDiff(c.yaw, t.yaw) * k;
      c.height += (t.height - c.height) * k;
    }
    const pu = r.puppet;
    if (r.rag) { syncRagdollMeshes(r.rag, pu.parts, r.torso); pu.showRagdoll(true); pu.showCapsule(false); }
    else {
      pu.setFeet(c.x, c.y, c.z); pu.setHeight(c.height);
      if (pu.setYaw) pu.setYaw(c.yaw);
      pu.showRagdoll(false); pu.showCapsule(true);
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
  socket.on('init', ({ id, spawn, players, serverTime }) => {
    clearTimeout(joinTimer);
    myId = id;
    clockOffset = serverTime - Date.now();                             // rough until the timeSync samples refine it
    clearRemotes();
    for (const p of players) if (p.id !== id) addRemote(p);
    if (!localPuppet) localPuppet = view.addPuppet(myColor);
    joined = true; lastSnapT = 0; myKo = 0;
    applyRespawn(spawn);
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
      if (d.id === myId) { myKo = d.ko | 0; continue; }
      const r = remotes.get(d.id);
      if (r) applyRemote(r, d);
    }
  });
  socket.on('respawn', ({ spawn }) => { if (joined && awaiting) applyRespawn(spawn); });

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
    if (e.code === 'KeyR' && !e.repeat && joined && !awaiting) forceFall = true;       // "I am stuck": handled exactly like a fall
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Tab') showBoard = false; });
  window.addEventListener('blur', () => { showBoard = false; });

  // ---- grapple aim: from the camera eye along the camera look direction (the crosshair) ----------------------------------------------
  const _eye = new THREE.Vector3(), _look = new THREE.Vector3();
  function aimFromCamera() {
    view.camera.getWorldPosition(_eye); view.camera.getWorldDirection(_look);
    return { origin: { x: _eye.x, y: _eye.y, z: _eye.z }, dir: { x: _look.x, y: _look.y, z: _look.z }, owner: 0, skip: () => false };
  }

  // ---- one fixed simulation tick (your player only) ----------------------------------------------------------------------------------
  function tick() {
    if (!joined) return;
    me.locked = awaiting;                                   // ragdolling: skip input (the latches still drain below)
    const snap = readInput(forwardOf(rig));
    if (snap.grapple && !awaiting) snap.aim = aimFromCamera();
    const wasOnGround = pv.player.grounded;
    stepPlayer(me, snap, pv);
    for (const e of me.sfx) audio.play(e);
    if (!awaiting && !wasOnGround && pv.player.grounded && me.vy < 0) triggerLandDip(rig, me.vy);   // me.vy is still the touchdown speed here

    stepWorld(ctx);

    if (awaiting) {
      respawnWait += STEP;
      if (respawnWait > RESPAWN_FALLBACK) applyRespawn(lastSpawn);     // server silent (offline?): respawn on our own
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
      (hs.sliding ? '  SLIDE' : '') + (hs.slideBoostCd > 0 ? '  slideboost ' + hs.slideBoostCd.toFixed(2) + 's' : '  slideboost ready');

    const gtxt = !joined ? '' : hs.grappleActive ? 'HOOKED' : hs.grappleCd > 0 ? 'GRAPPLE ' + hs.grappleCd.toFixed(1) + 's' : 'GRAPPLE READY';
    if (gtxt !== xhairText) {
      xhairText = gtxt; el.gstat.textContent = gtxt;
      el.xhair.style.background = hs.grappleActive ? '#7fe9ff' : hs.grappleCd > 0 ? '#ff6b6b' : '#fff';
    }
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

    // your puppet: ragdoll while down, otherwise the capsule squashed to the collider height
    if (joined && localPuppet) {
      if (localRag) { syncRagdollMeshes(localRag, localPuppet.parts, localTorso); localPuppet.showRagdoll(true); localPuppet.showCapsule(false); }
      else { const f = feetPos(pv); localPuppet.setFeet(f.x, f.y, f.z); localPuppet.setHeight(me.height); localPuppet.showRagdoll(false); localPuppet.showCapsule(!awaiting); }
      if (me.grappleActive && !awaiting) view.setGrapple(0, torsoPos(pv, me), me.grappleAnchor); else view.setGrapple(0, null);
    }

    // everybody else: exponential smoothing toward the latest snapshot
    const k = 1 - Math.exp(-SMOOTH * dt);
    for (const r of remotes.values()) updateRemote(r, k);

    // chase camera: your capsule, or your tumbling torso while you are down
    const hv = pv, hSpeed = Math.hypot(me.vx, me.vz);
    let focus;
    if (localRag) {
      focus = localTorso;
      updateCamera(rig, view.camera, hv, focus, dt, 0.15, 0, 0);
    } else {
      focus = feetPos(hv);
      updateCamera(rig, view.camera, hv, focus, dt, m(CAM.pivot) * me.height / m(PUPPET.height), hSpeed, me.wallRunning ? me.wallSide : 0);
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
