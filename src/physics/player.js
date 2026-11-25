// src/physics/player.js
// PHYSICS: the player's movement rules as a function of (state, input). Ported verb by verb from the old physics.js.
// Done so far: progressive momentum run (runT), jump (buffer, coyote time, rise / fall gravity, air steering),
// crouch-slide (entry boost, low friction, light steering, capsule resize with headroom check). Coming next: dash, pillar orbit.
// Loads after: config.js, physics/world.js
// Speeds in `state` are in METRES / s (already scaled); config numbers are in old units and go through m().

import { STEP, m, PUPPET, RUN, MOVE, JUMP, SLIDE } from '../config.js';
import { movePlayer, hasHeadroom } from './world.js';

export function createPlayerState() {
  return { vx: 0, vz: 0, vy: 0, facing: 0, runT: 0, isIt: false, wallHit: false, jumpBuf: 0, coyote: 0,
           sliding: false, height: m(PUPPET.height) };
}

// ground top speed for the current momentum (old units -> metres)
export function runSpeed(s) {
  const f = Math.min(1, s.runT / RUN.rampT);
  return m(RUN.min + (RUN.max - RUN.min) * f) * (s.isIt ? RUN.itBonus : 1);
}

// runT bookkeeping. Grows only on clean ground running; held in the air (so jumps / slides / dashes keep it);
// drains fast when the player lets go of the keys or runs into something.
function updateRunT(s, inp, grounded) {
  if (s.wallHit) s.runT -= STEP * RUN.wallDecay;
  else if (s.sliding) { /* a slide holds the momentum: no growth, no decay */ }
  else if (inp.moving) { if (grounded) s.runT += STEP; }
  else if (grounded) s.runT -= STEP * RUN.stopDecay;
  s.runT = Math.max(0, Math.min(RUN.rampT, s.runT));
}

// One fixed tick. `ctx` is the physics world (movePlayer moves the capsule and reports the result).
export function stepPlayer(s, inp, ctx) {
  const grounded = ctx.player.grounded;
  updateRunT(s, inp, grounded);

  // ---- jump: buffer (pressed shortly before landing) + coyote time (shortly after leaving a ledge)
  if (inp.jump) s.jumpBuf = JUMP.buffer; else s.jumpBuf = Math.max(0, s.jumpBuf - STEP);
  if (grounded && s.vy <= 0) s.coyote = JUMP.coyote; else s.coyote = Math.max(0, s.coyote - STEP);
  let jumped = false;
  if (s.jumpBuf > 0 && s.coyote > 0) { s.vy = m(JUMP.impulse); s.jumpBuf = 0; s.coyote = 0; jumped = true; }

  // ---- slide state: Shift held on the ground enters (with a speed boost), releasing / jumping / leaving the ground ends it
  if (jumped) s.sliding = false;
  else if (s.sliding && (!inp.slide || (!grounded && s.coyote <= 0))) s.sliding = false;
  else if (!s.sliding && inp.slide && grounded) {
    s.sliding = true;
    const v = Math.hypot(s.vx, s.vz);
    if (v > m(SLIDE.minSpeed)) {
      const t = v > m(SLIDE.maxEntrySpeed) ? v : Math.min(v * SLIDE.entryBoost, m(SLIDE.maxEntrySpeed));
      s.vx *= t / v; s.vz *= t / v;
    }
  }

  // ---- horizontal: velocity chases the wanted velocity. Ground k = dt * 9; in the air only light steering,
  // and with no keys held the air momentum is kept (it does not brake to a stop mid-jump)
  const sp = runSpeed(s);
  if (s.sliding && grounded) {
    const f = Math.pow(SLIDE.friction, STEP);               // glide: low friction, momentum kept
    s.vx *= f; s.vz *= f;
    if (inp.moving) {                                       // light steering: turns the slide, never adds speed
      const cap = Math.max(Math.hypot(s.vx, s.vz), m(SLIDE.minSpeed)), a = m(SLIDE.steerAccel) * STEP;
      s.vx += inp.ax * a; s.vz += inp.az * a;
      const v = Math.hypot(s.vx, s.vz);
      if (v > cap) { s.vx *= cap / v; s.vz *= cap / v; }
    }
  } else if (grounded && !jumped) {
    const k = Math.min(1, STEP * MOVE.accel);
    s.vx += (inp.ax * sp - s.vx) * k;
    s.vz += (inp.az * sp - s.vz) * k;
  } else if (inp.moving) {
    const k = Math.min(1, STEP * JUMP.airAccel);
    s.vx += (inp.ax * sp - s.vx) * k;
    s.vz += (inp.az * sp - s.vz) * k;
  }

  // ---- vertical: stick to the ground, otherwise heavier gravity on the way down than on the way up
  if (jumped) { /* takeoff tick: move with the full impulse */ }
  else if (grounded && s.vy <= 0) s.vy = -0.5;
  else s.vy -= m(s.vy > 0 ? JUMP.gravRise : JUMP.gravFall) * STEP;

  // ---- capsule height: eases to the slide height while sliding, back to standing only when there is headroom
  const standH = m(PUPPET.height), slideH = m(SLIDE.height);
  let target = s.sliding ? slideH : standH;
  if (target > s.height + 1e-6 && !hasHeadroom(ctx, standH)) target = slideH;   // low ceiling: stay crouched
  let h = s.height + (target - s.height) * Math.min(1, STEP * SLIDE.resize);
  if (Math.abs(target - h) < 0.004) h = target;

  const c = movePlayer(ctx, s.vx * STEP, s.vy * STEP, s.vz * STEP, h);
  s.height = h;
  if (s.vy > 0 && c.y < s.vy * STEP * 0.5) s.vy = 0;        // bonked a ceiling: stop rising

  // wall detection: we wanted to cover vx,vz this tick but the controller let us move much less
  const want = Math.hypot(s.vx, s.vz) * STEP, got = Math.hypot(c.x, c.z);
  s.wallHit = want > m(RUN.wallMinSpeed) * STEP && got < want * RUN.wallRatio;

  // face the way we are moving (smoothly)
  if (inp.moving || (s.sliding && Math.hypot(s.vx, s.vz) > m(SLIDE.minSpeed))) {
    const d = Math.atan2(Math.sin(Math.atan2(s.vx, s.vz) - s.facing), Math.cos(Math.atan2(s.vx, s.vz) - s.facing));
    s.facing += d * Math.min(1, STEP * 12);
  }
}
