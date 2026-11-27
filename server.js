// server.js
// SERVER: Express (static dist/) + Socket.IO room for Puppet Fighter 3D. Client-authoritative movement: each client simulates itself
// at 60 Hz and sends 30 Hz 'state' packets; this server validates / clamps them, keeps the player list, picks spawns and rebroadcasts
// everybody as a 30 Hz 'snapshot'. No physics runs here. Spawns come straight from the shared map data (src/game/maps.js, pure data).
// Run: `npm run build && npm start` (Render: build `npm install && npm run build`, start `npm start`).

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import DISTRICT_MAP from './src/game/maps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, 'dist');
const SCALE = 0.025;                                              // old 2.5D units -> metres (same as config.js SCALE)
const SNAPSHOT_HZ = 30;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 6;         // the scene's tether slots were built for 6 players
const RESPAWN_DELAY_MS = 1200;                                    // ragdoll tumble time before a respawn is granted
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

io.on('connection', (socket) => {
  const id = socket.id;
  const p = {
    id, joined: false, name: '', color: 0x5ee6ff,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, height: STAND_HEIGHT,
    sliding: false, dashing: false, wallRunning: false, grappleActive: false, grappleAnchor: null, ragdoll: false,
    ko: 0, ping: 0, lastState: 0, respawnPending: false,
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
    p.joined = true;
    socket.join('game');
    socket.emit('init', { id, spawn, players: joinedPlayers().map(publicPlayer), serverTime: Date.now() });
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
    p.ragdoll = !!d.ragdoll;
  });

  // a player fell below the map (or pressed R): after the ragdoll tumble they get a clean spawn
  socket.on('respawnReq', () => {
    if (!p.joined || p.respawnPending) return;
    p.respawnPending = true;
    p.ragdoll = true;
    setTimeout(() => {
      p.respawnPending = false;
      if (!players.has(id) || !p.joined) return;
      const spawn = pickSpawn(id);
      placeAt(p, spawn);
      socket.emit('respawn', { spawn });
    }, RESPAWN_DELAY_MS);
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
  io.to('game').volatile.emit('snapshot', { t: Date.now(), players: list.map((p) => ({ id: p.id, ...dyn(p) })) });
}, 1000 / SNAPSHOT_HZ);

server.listen(PORT, () => console.log(`Puppet Fighter 3D listening on :${PORT} (${haveDist ? 'serving dist/' : 'NO dist/ build'})`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { io.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
}
