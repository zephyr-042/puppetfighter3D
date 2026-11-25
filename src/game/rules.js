/* ============================================================================
   src/game/rules.js
   puppetfighter3D: tag rules. Pure functions over the plain state from state.js (no engine
   deps). All numbers are the original 2.5D values times SCALE = 0.025 (metres, m/s).
   NOTE: collidePlayers() soft-separates players by editing x / z, so the physics layer must
   read the corrected positions back into the kinematic capsules after each step.
   ============================================================================ */
import { resetRoundPlayers, pushEvent } from './state.js';

const SCALE = 0.025;   // swap for the config.js export once wired up

export const RULES = {
  TAG_REACH: 44 * SCALE,          // 1.1 m   horizontal contact distance
  TAG_VERT: 82 * SCALE,           // 2.05 m  vertical overlap window
  BODY_SEP: 30 * SCALE,           // 0.75 m  soft separation distance
  SEP_STIFFNESS: 12,              // 1/s, how fast separation resolves
  TAG_CD: 1.4,                    // s, after a tag
  TAG_KNOCK: 380 * SCALE,         // 9.5 m/s on the new IT
  TAG_STUN: 0.6,
  DASH_SHOVE_KNOCK: 420 * SCALE,  // 10.5 m/s on IT
  DASH_SHOVE_STUN: 0.5,
  SLIDE_TRIP_SPEED: 320 * SCALE,  // 8.0 m/s
  SLIDE_TRIP_KNOCK: 340 * SCALE,  // 8.5 m/s sideways
  SLIDE_TRIP_STUN: 0.55,
  FALL_TAG_CD: 1.0
};

function hspeed(p) { return Math.hypot(p.vx, p.vz); }

function knock(p, dx, dz, speed, stun) {
  let len = Math.hypot(dx, dz);
  if (len < 1e-6) { dx = 0; dz = 1; len = 1; }
  dx /= len; dz /= len;
  p.vx = dx * speed;
  p.vz = dz * speed;
  p.stun = stun;
  p.stunMax = stun;
  p.stunDir = Math.atan2(dx, dz);
}

function inContact(a, b) {
  return Math.abs(a.y - b.y) < RULES.TAG_VERT && Math.hypot(a.x - b.x, a.z - b.z) < RULES.TAG_REACH;
}

/**
 * Pair interactions (tag, dash shove, slide sabotage) and soft body separation.
 * Exported so it can be called on its own. dt scales the separation only.
 */
export function collidePlayers(gs, dt) {
  const P = gs.players;
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j];
      if (Math.abs(a.y - b.y) >= RULES.TAG_VERT) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);

      if (d < RULES.TAG_REACH) {
        if (a.isIt !== b.isIt) {
          const it = a.isIt ? a : b, run = a.isIt ? b : a;
          if (run.dashing && it.stun <= 0) {
            // dashing runner shoves IT away
            knock(it, it.x - run.x, it.z - run.z, RULES.DASH_SHOVE_KNOCK, RULES.DASH_SHOVE_STUN);
            pushEvent(gs, { type: 'shove', from: run.id, to: it.id });
          } else if (gs.tagCd <= 0 && it.stun <= 0) {
            // IT passes the tag; the new IT is knocked away from the tagger and stunned
            it.isIt = false;
            run.isIt = true;
            gs.tagCd = RULES.TAG_CD;
            knock(run, run.x - it.x, run.z - it.z, RULES.TAG_KNOCK, RULES.TAG_STUN);
            pushEvent(gs, { type: 'tag', from: it.id, to: run.id });
          }
        } else if (!a.isIt) {
          // runner vs runner: fast slide trips the other one
          const trip = function (s, v) {
            if (!s.sliding || s.stun > 0 || v.stun > 0 || hspeed(s) <= RULES.SLIDE_TRIP_SPEED) return false;
            const sp = hspeed(s), px = -s.vz / sp, pz = s.vx / sp;       // perpendicular to slide direction
            const side = (px * (v.x - s.x) + pz * (v.z - s.z)) >= 0 ? 1 : -1;
            knock(v, px * side, pz * side, RULES.SLIDE_TRIP_KNOCK, RULES.SLIDE_TRIP_STUN);
            v.runT = 0;
            v.bhopChain = 0;
            pushEvent(gs, { type: 'trip', from: s.id, to: v.id });
            return true;
          };
          if (!trip(a, b)) trip(b, a);
        }
      }

      // soft separation
      if (d < RULES.BODY_SEP) {
        const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
        const push = (RULES.BODY_SEP - d) * Math.min(1, RULES.SEP_STIFFNESS * dt) * 0.5;
        a.x -= nx * push; a.z -= nz * push;
        b.x += nx * push; b.z += nz * push;
      }
    }
  }
}

/** Lowest itTime wins; tie -> the one not currently IT; then lowest id. Returns a player or null. */
export function pickRoundWinner(players) {
  let best = null;
  for (const p of players) {
    if (!best) { best = p; continue; }
    const EPS = 1e-9;
    if (p.itTime < best.itTime - EPS) best = p;
    else if (Math.abs(p.itTime - best.itTime) <= EPS && best.isIt && !p.isIt) best = p;
  }
  return best;
}

function endRound(gs) {
  const w = pickRoundWinner(gs.players);
  gs.timeLeft = 0;
  if (w) {
    w.score += 1;
    gs.winner = w.id;
    pushEvent(gs, { type: 'roundWin', id: w.id, round: gs.round });
    if (w.score >= gs.wins) {
      gs.mode = 'matchend';
      pushEvent(gs, { type: 'matchWin', id: w.id });
      return;
    }
  }
  gs.mode = 'roundend';
  gs.roundEndLeft = gs.roundEndTime;
}

export function stepGameRules(gs, dt) {
  if (gs.tagCd > 0) gs.tagCd = Math.max(0, gs.tagCd - dt);

  if (gs.mode === 'countdown') {
    gs.countdownLeft -= dt;
    if (gs.countdownLeft <= 0) { gs.mode = 'play'; pushEvent(gs, { type: 'go' }); }
    return;
  }
  if (gs.mode === 'roundend') {
    gs.roundEndLeft -= dt;
    if (gs.roundEndLeft <= 0) {
      gs.round += 1;
      resetRoundPlayers(gs, gs.spawns);
      gs.mode = 'countdown';
      gs.countdownLeft = gs.countdownTime;
      pushEvent(gs, { type: 'round', round: gs.round });
    }
    return;
  }
  if (gs.mode !== 'play') return;

  const P = gs.players;

  // stun recovery
  for (const p of P) if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);

  // fall penalty: one penalty per fall (rising edge of `fell`)
  for (const p of P) {
    if (p.fell && !p.fellHandled) {
      p.fellHandled = true;
      if (!p.isIt) {
        for (const q of P) q.isIt = false;
        p.isIt = true;
        gs.tagCd = RULES.FALL_TAG_CD;
        pushEvent(gs, { type: 'fell', id: p.id });
      }
    } else if (!p.fell) p.fellHandled = false;
  }

  collidePlayers(gs, dt);

  // IT-time scoring and round end
  for (const p of P) if (p.isIt) p.itTime += dt;
  gs.timeLeft -= dt;
  if (gs.timeLeft <= 0) endRound(gs);
}
