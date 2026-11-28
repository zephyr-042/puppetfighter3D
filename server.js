// server.js
// SERVER: Express (static dist/) + Socket.IO room for Puppet Fighter 3D. Client-authoritative movement: each client simulates itself
// at 60 Hz and sends 30 Hz 'state' packets; this server validates / clamps them, keeps the player list, picks spawns and rebroadcasts
// everybody as a 30 Hz 'snapshot'. No physics runs here. Spawns come straight from the shared map data (src/game/maps.js, pure data).
// MELEE (Step 1: Kinetic Slash) is the one thing the server JUDGES: a client only REQUESTS a 'slash' ({ dir, speed }); resolveSlash() below checks the cooldown, the
// cleave cone, the reach and the vertical overlap against the positions it holds, scales damage / knockback with the (sanity-clamped) incoming speed, keeps hp /
// ko / dead / lastHitBy per player, and tells everybody with 'hit' + 'killFeed'. Movement itself stays client-authoritative. The numbers come from src/config.js MELEE.
// Run: `npm run build && npm start` (Render: build `npm install && npm run build`, start `npm start`).

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import DISTRICT_MAP from './src/game/maps.js';
import { SCALE, MELEE } from './src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, 'dist');
const SNAPSHOT_HZ = 30;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 6;         // the scene's tether slots were built for 6 players
const RESPAWN_DELAY_MS = 1200;                                    // ragdoll tumble time before a respawn is granted (fall into the void / R)
const KO_RESPAWN_MS = MELEE.koRespawnDelay;                       // a KO'd pod tumbles a little longer before its clean spawn
const MAX_HP = MELEE.maxHp;
const SLASH_SLACK_MS = 80;                                        // network jitter allowance on the slash cooldown
const SPEED_SLACK = 1.25, SPEED_SLACK_ADD = 60;                   // a claimed slash speed may exceed the speed the server last saw by 25 % + 60 units / s (state packets are 30 Hz)
const REACH_M = MELEE.reach * SCALE, PAD_M = MELEE.radiusPad * SCALE, VERT_M = MELEE.vertical * SCALE;
const STAND_HEIGHT = 1.8;                                         // metres (72 old units)
const CORS_ORIGINS = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : null;   // dev only (vite on another port)

const SPAWNS = DISTRICT_MAP.spawns.map((s) => ({ x: s.x * SCALE, y: (s.y || 0) * SCALE, z: s.z * SCALE }));

// ---- http ------------------------------------------------------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
const haveDist = fs.existsSync(path.join(DIST, 'index.html'));
if (haveDist) {
  app.use(express.static(DIST, { maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('*', (_req, res) => res.status(503).type('text').send('No dist/ build found. Run `npm run build` first (or use `npm run dev` for the Vite dev server).'));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: CORS_ORIGINS ? { origin: CORS_ORIGINS } : undefined,
  transports: ['websocket', 'polling'],
});

// ---- players ---------------------------------------------------------------------------------------------------------------------
const players = new Map();                                        // socket id -> player record

const num = (v, fallback, lim) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : fallback);
const r3 = (v) => Math.round(v * 1000) / 1000;
const cleanName = (n, id) => String(n ?? '').replace(/[\u0000-\u001f<>&"'`]/g, '').trim().slice(0, 16) || 'Player' + id.slice(0, 3);
const cleanColor = (c) => (Number.isInteger(c) && c >= 0 && c <= 0xffffff ? c : 0x5ee6ff);

function joinedPlayers() { return [...players.values()].filter((p) => p.joined); }

// Static info (sent on join / init) and the full public record.
function publicPlayer(p) {
  return { id: p.id, name: p.name, color: p.color, ...dyn(p) };
}
// Dynamic part (what a 'snapshot' carries per player).
function dyn(p) {
  return {
    x: r3(p.x), y: r3(p.y), z: r3(p.z), vx: r3(p.vx), vy: r3(p.vy), vz: r3(p.vz), yaw: r3(p.yaw), height: r3(p.height),
    sliding: p.sliding, dashing: p.dashing, wallRunning: p.wallRunning, grappleActive: p.grappleActive,
    grappleAnchor: p.grappleAnchor, ragdoll: p.ragdoll, ko: p.ko, ping: p.ping,
    hp: Math.round(p.hp * 10) / 10, maxHp: p.maxHp, dead: p.dead,
  };
}

// Clean spawn: the spawn farthest (on the ground plane) from every other live player; ties are random. Alone: random.
function pickSpawn(excludeId) {
  const others = joinedPlayers().filter((p) => p.id !== excludeId && !p.ragdoll);
  if (!others.length) return SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
  let best = [], bestD = -1;
  for (const s of SPAWNS) {
    let d = Infinity;
    for (const o of others) d = Math.min(d, Math.hypot(o.x - s.x, o.z - s.z));
    if (d > bestD + 1e-6) { bestD = d; best = [s]; }
    else if (Math.abs(d - bestD) <= 1e-6) best.push(s);
  }
  return best[Math.floor(Math.random() * best.length)];
}

function placeAt(p, s) {
  p.x = s.x; p.y = s.y; p.z = s.z; p.vx = p.vy = p.vz = 0;
  p.ragdoll = false; p.grappleActive = false; p.grappleAnchor = null; p.sliding = p.dashing = p.wallRunning = false;
}

// ---- melee (server-authoritative) ----------------------------------------------------------------------------------------------------
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hSpeedUnits = (p) => Math.hypot(p.vx, p.vz) / SCALE;       // the player's last reported horizontal speed, old units / s

// Pure judge: attacker `p` swings along data.dir with data.speed. Returns the list of hits (targets inside the cleave) with damage + knockback applied to
// NOBODY yet: the caller applies them. `others` = candidate targets. Positions are the feet positions in metres from the last 'state' packets.
function resolveSlash(p, data, others) {
  // aim: horizontal unit vector. Falls back to the facing the client last reported if the vector is missing / degenerate.
  const dr = data && typeof data.dir === 'object' && data.dir ? data.dir : {};
  let dx = num(dr.x, 0, 10), dz = num(dr.z, 0, 10);
  let dl = Math.hypot(dx, dz);
  if (dl < 1e-3) { dx = Math.sin(p.yaw); dz = Math.cos(p.yaw); dl = 1; }
  dx /= dl; dz /= dl;

  // incoming speed: claimed by the client, but never more than what the server has seen it do (+ slack), and never above the soft flow ceiling
  const claimed = num(data && data.speed, 0, 5000);
  const speed = Math.max(0, Math.min(claimed, hSpeedUnits(p) * SPEED_SLACK + SPEED_SLACK_ADD, MELEE.dmgSpeedMax));
  const t = clamp01((speed - MELEE.dmgSpeedMin) / (MELEE.dmgSpeedMax - MELEE.dmgSpeedMin));
  const damage = Math.round(lerp(MELEE.baseDmg, MELEE.maxDmg, t));
  const knock = lerp(MELEE.baseKnock, MELEE.maxKnock, t) * SCALE;           // m / s, horizontal
  const knockVec = { x: r3(dx * knock), y: r3(knock * MELEE.knockUp), z: r3(dz * knock) };

  const aCy = p.y + p.height / 2;
  const hits = [];
  for (const q of others) {
    if (q.id === p.id || !q.joined || q.dead || q.ragdoll || q.respawnPending) continue;   // KO'd / tumbling / falling pods cannot be hit again
    const tx = q.x - p.x, tz = q.z - p.z, dist = Math.hypot(tx, tz);
    if (dist > REACH_M + PAD_M) continue;                                      // reach (measured to the capsule axis, + the pod radius)
    if (dist > 0.45 && (tx * dx + tz * dz) / dist < MELEE.coneCos) continue;  // cleave cone (a pod inside the body is always in the cone)
    if (Math.abs((q.y + q.height / 2) - aCy) >= VERT_M) continue;             // vertical overlap < 2.2 m
    hits.push({ target: q, damage, knockVec });
  }
  return { dx, dz, speed, hits };
}

// Respawn a player after `delay` ms: clean spawn, full hp, 'respawn' to that client. (Shared by KOs and by falling into the void.)
function scheduleRespawn(q, delay) {
  q.respawnPending = true;
  q.ragdoll = true;
  setTimeout(() => {
    q.respawnPending = false;
    if (!players.has(q.id) || !q.joined) return;
    const spawn = pickSpawn(q.id);
    placeAt(q, spawn);
    q.hp = q.maxHp; q.dead = false; q.lastHitBy = null; q.lastHitAt = 0; q.lastDamageAt = 0;
    io.to(q.id).emit('respawn', { spawn, hp: q.hp });
  }, delay);
}

// +1 KO to the last attacker and a 'killFeed' line. cause: 'slash' | 'void'. (killer may have left in the meantime: then nobody is credited.)
function creditKo(victim, cause) {
  const killer = victim.lastHitBy ? players.get(victim.lastHitBy) : null;
  victim.lastHitBy = null;
  if (!killer || !killer.joined || killer.id === victim.id) return false;
  killer.ko++;
  io.to('game').emit('killFeed', {
    killerId: killer.id, killerName: killer.name, killerColor: killer.color,
    victimId: victim.id, victimName: victim.name, victimColor: victim.color, cause, ko: killer.ko,
  });
  console.log(`# ${killer.name} KO'd ${victim.name} (${cause}) -> ${killer.ko} KOs`);
  return true;
}

io.on('connection', (socket) => {
  const id = socket.id;
  const p = {
    id, joined: false, name: '', color: 0x5ee6ff,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, height: STAND_HEIGHT,
    sliding: false, dashing: false, wallRunning: false, grappleActive: false, grappleAnchor: null, ragdoll: false,
    ko: 0, ping: 0, lastState: 0, respawnPending: false,
    hp: MAX_HP, maxHp: MAX_HP, dead: false, lastHitBy: null, lastHitAt: 0, lastDamageAt: 0, lastSlash: 0,
  };
  players.set(id, p);

  // clock sync: the client times the round trip itself and derives offset = serverNow + rtt / 2 - clientNow
  socket.on('timeSync', (cb) => { if (typeof cb === 'function') cb(Date.now()); });

  // the client reports its measured round-trip time (shown on the scoreboard)
  socket.on('ping', (rtt) => { p.ping = Math.round(num(rtt, p.ping, 9999)); });

  socket.on('join', (data) => {
    if (p.joined) return;
    if (joinedPlayers().length >= MAX_PLAYERS) { socket.emit('full', { max: MAX_PLAYERS }); return; }
    p.name = cleanName(data && data.name, id);
    p.color = cleanColor(data && data.color);
    const spawn = pickSpawn(id);
    placeAt(p, spawn);
    p.hp = p.maxHp = MAX_HP; p.dead = false; p.ko = 0; p.lastHitBy = null;
    p.joined = true;
    socket.join('game');
    socket.emit('init', { id, spawn, hp: p.hp, maxHp: p.maxHp, players: joinedPlayers().map(publicPlayer), serverTime: Date.now() });
    socket.to('game').emit('playerJoined', publicPlayer(p));
    console.log(`+ ${p.name} (${id}) joined, ${joinedPlayers().length} online`);
  });

  // volatile 30 Hz state packet from the owning client (client-authoritative; values are only sanity-clamped)
  socket.on('state', (d) => {
    if (!p.joined || !d || typeof d !== 'object') return;
    const now = Date.now();
    if (now - p.lastState < 10) return;                           // flood guard (clients send ~every 33 ms)
    p.lastState = now;
    p.x = num(d.x, p.x, 1000); p.y = num(d.y, p.y, 1000); p.z = num(d.z, p.z, 1000);
    p.vx = num(d.vx, p.vx, 300); p.vy = num(d.vy, p.vy, 300); p.vz = num(d.vz, p.vz, 300);
    p.yaw = num(d.yaw, p.yaw, 100);
    p.height = Math.max(0.5, Math.min(2.5, num(d.height, p.height, 5)));
    p.sliding = !!d.sliding; p.dashing = !!d.dashing; p.wallRunning = !!d.wallRunning;
    p.grappleActive = !!d.grappleActive;
    const a = d.grappleAnchor;
    p.grappleAnchor = p.grappleActive && a && typeof a === 'object' ? { x: num(a.x, 0, 1000), y: num(a.y, 0, 1000), z: num(a.z, 0, 1000) } : null;
    p.ragdoll = !!d.ragdoll || p.respawnPending;                  // a KO'd / respawning pod stays down whatever the packet says
  });

  // Kinetic Slash request: { dir: { x, z }, speed } (dir = horizontal aim, speed = horizontal speed in old units / s when the swing started).
  // The server owns the outcome: cooldown, cone, reach, vertical overlap, damage, knockback, hp, KOs.
  socket.on('slash', (d) => {
    if (!p.joined || p.dead || p.ragdoll || p.respawnPending || !d || typeof d !== 'object') return;   // KO'd / tumbling / falling pods cannot swing
    const now = Date.now();
    if (now - p.lastSlash < MELEE.cooldown * 1000 - SLASH_SLACK_MS) return;          // cooldown gate (client enforces the exact 0.55 s)
    p.lastSlash = now;
    const res = resolveSlash(p, d, joinedPlayers());
    // everybody else sees the swing (hit or miss): blade sweep + whoosh. `yaw` = the slash direction.
    socket.to('game').emit('slashFx', { id, yaw: r3(Math.atan2(res.dx, res.dz)) });
    for (const h of res.hits) {
      const q = h.target;
      q.hp = Math.max(0, q.hp - h.damage);
      q.lastHitBy = id; q.lastHitAt = now; q.lastDamageAt = now;
      const kill = q.hp <= 0;
      io.to('game').emit('hit', { attackerId: id, targetId: q.id, damage: h.damage, knockVec: h.knockVec, kill, hp: q.hp });
      if (kill) {
        q.dead = true;
        creditKo(q, 'slash');
        scheduleRespawn(q, KO_RESPAWN_MS);
      }
    }
  });

  // a player fell below the map (or pressed R): after the ragdoll tumble they get a clean spawn
  // A player who was hit within the last MELEE.voidCredit seconds and then falls into the void credits their last attacker with the KO.
  socket.on('respawnReq', () => {
    if (!p.joined || p.respawnPending) return;
    if (!p.dead && p.lastHitBy && Date.now() - p.lastHitAt <= MELEE.voidCredit * 1000) creditKo(p, 'void');
    p.lastHitBy = null;
    scheduleRespawn(p, RESPAWN_DELAY_MS);
  });

  socket.on('disconnect', () => {
    const was = p.joined;
    players.delete(id);
    io.emit('playerLeft', id);
    if (was) console.log(`- ${p.name} (${id}) left, ${joinedPlayers().length} online`);
  });
});

// ---- 30 Hz snapshot broadcast ----------------------------------------------------------------------------------------------------
setInterval(() => {
  const list = joinedPlayers();
  if (!list.length) return;
  const now = Date.now();
  for (const p of list) {                                          // slow hit-point regeneration once MELEE.regenDelay seconds have passed without damage
    if (!p.dead && p.hp < p.maxHp && now - p.lastDamageAt > MELEE.regenDelay * 1000) p.hp = Math.min(p.maxHp, p.hp + MELEE.regenRate / SNAPSHOT_HZ);
  }
  io.to('game').volatile.emit('snapshot', { t: Date.now(), players: list.map((p) => ({ id: p.id, ...dyn(p) })) });
}, 1000 / SNAPSHOT_HZ);

server.listen(PORT, () => console.log(`Puppet Fighter 3D listening on :${PORT} (${haveDist ? 'serving dist/' : 'NO dist/ build'})`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { io.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
}
