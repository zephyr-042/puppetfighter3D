/* ============================================================================
   src/game/state.js
   puppetfighter3D: plain-data game state. No Three.js, no Rapier, no config.js imports, so it
   is trivially snapshot-able for netcode. Units are metres / seconds (SCALE = 0.025 already
   applied: 72 old units = 1.8 m). Yaw convention: 0 faces +Z, rotation about +Y.
   Players are faceless (no eyes / face fields) by design: colour + capsule/block only.
   ============================================================================ */

export const MAX_PLAYERS = 6;
export const MODES = ['title', 'countdown', 'play', 'roundend', 'matchend'];

const PALETTE = [0xe0503c, 0x3c8de0, 0x4cc46a, 0xe0b83c, 0xa65ce0, 0x3cd6d0];
const EVENT_CAP = 64;

export function createPlayer(id, name, color) {
  return {
    id: id,
    name: name || ('P' + (id + 1)),
    color: color != null ? color : PALETTE[id % PALETTE.length],
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0,
    isIt: false,
    itTime: 0,          // seconds spent as IT this round (reset every round)
    score: 0,           // rounds won
    stun: 0,            // seconds of stun left
    stunMax: 0,         // duration the current stun started with (for recovery blending)
    stunDir: 0,         // world yaw (radians) of the last knock direction, atan2(dx, dz)
    sliding: false,
    dashing: false,
    grabbing: false,
    fell: false,        // set by player.js when the player fell out of the map
    fellHandled: false, // rules-internal: edge detector so one fall = one penalty
    runT: 0,            // run-up timer (reset when tripped)
    bhopChain: 0        // consecutive bunny hops (reset when tripped)
  };
}

/**
 * @param opts { wins=3, roundTime=60, countdown=3, roundEndTime=3, spawns, rng }
 */
export function createGameState(opts) {
  const o = opts || {};
  return {
    mode: 'title',          // 'title' | 'countdown' | 'play' | 'roundend' | 'matchend'
    players: [],
    round: 0,
    wins: o.wins != null ? o.wins : 3,
    roundTime: o.roundTime != null ? o.roundTime : 60,
    countdownTime: o.countdown != null ? o.countdown : 3,
    roundEndTime: o.roundEndTime != null ? o.roundEndTime : 3,
    timeLeft: o.roundTime != null ? o.roundTime : 60,
    countdownLeft: 0,
    roundEndLeft: 0,
    tagCd: 0,               // global tag cooldown (s)
    winner: null,           // player id of the last round winner, then of the match
    spawns: o.spawns || [],
    rng: o.rng || Math.random,
    events: []              // { type, ... }, drained by the consumer with drainEvents()
  };
}

export function pushEvent(gs, ev) {
  gs.events.push(ev);
  if (gs.events.length > EVENT_CAP) gs.events.shift();
}

/** Return and clear the queued events (call once per rendered frame, not per physics step). */
export function drainEvents(gs) {
  const out = gs.events;
  gs.events = [];
  return out;
}

export function addPlayer(gs, info) {
  if (gs.players.length >= MAX_PLAYERS) return null;
  const id = gs.players.length;
  const i = info || {};
  const p = createPlayer(id, i.name, i.color);
  gs.players.push(p);
  return p;
}

/**
 * Put every player on a spawn, clear all transient state, zero the round's itTime, restore the
 * round timer and pick one random IT. Scores persist. Does not change gs.mode.
 */
export function resetRoundPlayers(gs, spawns) {
  if (spawns && spawns.length) gs.spawns = spawns;
  const sp = gs.spawns;
  gs.players.forEach(function (p, i) {
    const s = sp.length ? sp[i % sp.length] : { x: 0, y: 0, z: 0 };
    p.x = s.x; p.y = s.y || 0; p.z = s.z;
    p.vx = p.vy = p.vz = 0;
    p.yaw = 0;
    p.isIt = false;
    p.itTime = 0;
    p.stun = 0; p.stunMax = 0; p.stunDir = 0;
    p.sliding = p.dashing = p.grabbing = false;
    p.fell = false; p.fellHandled = false;
    p.runT = 0; p.bhopChain = 0;
  });
  if (gs.players.length) gs.players[Math.floor(gs.rng() * gs.players.length) % gs.players.length].isIt = true;
  gs.timeLeft = gs.roundTime;
  gs.tagCd = 0;
}

/** New match: scores to 0, round 1, positions reset, countdown running. */
export function startMatch(gs, spawns) {
  gs.players.forEach(function (p) { p.score = 0; });
  gs.round = 1;
  gs.winner = null;
  resetRoundPlayers(gs, spawns);
  gs.mode = 'countdown';
  gs.countdownLeft = gs.countdownTime;
}
