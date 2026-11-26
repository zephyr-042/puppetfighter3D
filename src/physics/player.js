// src/physics/player.js
// PHYSICS: the player's movement rules as a function of (state, input). Ported verb by verb from the old physics.js.
// Done so far: progressive momentum run (runT, plain run capped at RUN.max), jump (buffer, coyote time, rise / fall gravity),
// Quake-style air-strafing (no air drag, no top speed), b-hop landing window, crouch-slide, dash burst, double jump,
// wall-run + wall-kick. Coming next: pillar orbit.
// One state object per player (6 per match). `state.locked` (set by main.js while stunned, in countdown or round / match end)
// makes stepPlayer ignore the input snapshot, so knockback plays out under normal gravity / friction with no steering.
// Loads after: config.js, physics/world.js
// Speeds in `state` are in METRES / s (already scaled); config numbers are in old units and go through m().

import { STEP, m, PUPPET, RUN, MOVE, JUMP, BHOP, DASH, SLIDE, WALLRUN } from '../config.js';
import { movePlayer, hasHeadroom, detectWall, groundGap } from './world.js';

// Input snapshot with nothing pressed (used while a player is locked).
export const IDLE_INPUT = Object.freeze({ ax: 0, az: 0, moving: false, fwd: false, jump: false, dash: false, slide: false });

export function createPlayerState() {
  return { vx: 0, vz: 0, vy: 0, facing: 0, runT: 0, isIt: false, locked: false, wallHit: false, jumpBuf: 0, coyote: 0,
           sliding: false, height: m(PUPPET.height),
           wasGrounded: true, airT: 0, bhopTimer: 0, bhopChain: 0,
           dashT: 0, dashCd: 0, dashX: 0, dashZ: 1, dashSpeed: 0,
           airJumpsLeft: JUMP.maxAirJumps, climbing: false,
           wallRunning: false, wallSide: 0, wallN: { x: 0, z: 0 }, wallT: { x: 0, z: 0 },
           regrabTimer: 0, lastWallN: null };
}

// ground top speed for the current momentum (old units -> metres). This is the PLAIN run speed; b-hop / air speed can exceed it.
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

// Quake / Source air acceleration. (ax, az) = unit wish direction. Speed is added only while the speed ALONG the wish
// direction is below the (small) wish cap, so a wish direction that is sideways to the velocity keeps adding speed as the
// velocity turns; flying straight along it adds nothing. There is no upper limit on the resulting speed.
function airAccelerate(s, ax, az, wishSpeed) {
  const add = Math.min(wishSpeed, m(JUMP.airWishCap)) - (s.vx * ax + s.vz * az);
  if (add <= 0) return;
  const a = Math.min(add, JUMP.airAccel * wishSpeed * STEP);
  s.vx += ax * a; s.vz += az * a;
}

// Is the ground close enough that a jump press now should wait in the buffer for the landing (a b-hop) instead of
// spending the air jump? True when we are falling and will touch down within JUMP.buffer seconds.
function landingSoon(ctx, s) {
  if (s.vy >= 0) return false;
  return groundGap(ctx, -s.vy * JUMP.buffer) < Infinity;
}

// One fixed tick. `ctx` is the physics world (movePlayer moves the capsule and reports the result).
export function stepPlayer(s, inp, ctx) {
  if (s.locked) inp = IDLE_INPUT;                             // stunned / frozen: no steering, jumps, dashes or slides (knockback keeps its velocity)
  const grounded = ctx.player.grounded;
  // A landing needs a real stretch in the air. Rapier's grounded flag can drop for a single tick while running on flat
  // ground (the resting push into the floor is smaller than the controller's skin), and that must not open a b-hop window.
  const landed = grounded && !s.wasGrounded && s.airT >= BHOP.minAir;
  s.airT = grounded ? 0 : s.airT + STEP;
  s.wasGrounded = grounded;
  updateRunT(s, inp, grounded);

  // ---- b-hop window: landing opens it; it runs down while we stand; letting it expire ends the chain
  if (landed) s.bhopTimer = BHOP.window;
  else if (grounded && s.bhopTimer > 0) {
    s.bhopTimer -= STEP;
    if (s.bhopTimer <= 0) { s.bhopTimer = 0; s.bhopChain = 0; }
  }

  // ---- timers
  if (s.dashCd > 0) s.dashCd = Math.max(0, s.dashCd - STEP);
  if (s.dashT > 0) s.dashT = Math.max(0, s.dashT - STEP);
  if (s.regrabTimer > 0) s.regrabTimer = Math.max(0, s.regrabTimer - STEP);
  if (grounded) s.airJumpsLeft = JUMP.maxAirJumps;

  // ---- wall-run detection: in the air, holding W, fast enough, with a wall beside us that is not the one we just kicked off
  s.wallRunning = false;
  const hs = Math.hypot(s.vx, s.vz);
  if (!grounded && inp.fwd && s.dashT <= 0 && s.airT >= WALLRUN.minAir && hs > m(WALLRUN.minSpeed)) {
    const w = detectWall(ctx, Math.atan2(s.vx, s.vz));
    const sameWall = s.regrabTimer > 0 && s.lastWallN && (w.hit && w.normal.x * s.lastWallN.x + w.normal.z * s.lastWallN.z > 0.9);
    if (w.hit && !sameWall) {
      let tx = -w.normal.z, tz = w.normal.x;                  // wall tangent, signed to point the way we are travelling
      if (s.vx * tx + s.vz * tz < 0) { tx = -tx; tz = -tz; }
      if (Math.abs(s.vx * tx + s.vz * tz) / hs >= WALLRUN.minTangent) {
        s.wallRunning = true; s.wallSide = w.side; s.wallN = w.normal; s.wallT = { x: tx, z: tz };
        s.airJumpsLeft = JUMP.maxAirJumps;                    // catching a wall refills the air jump
      }
    }
  }

  // ---- jump: buffer (pressed shortly before landing) + coyote time (shortly after leaving a ledge)
  if (inp.jump) s.jumpBuf = JUMP.buffer; else s.jumpBuf = Math.max(0, s.jumpBuf - STEP);
  if (grounded && s.vy <= 0) s.coyote = JUMP.coyote; else s.coyote = Math.max(0, s.coyote - STEP);
  let jumped = false, launched = false, airJumped = false;     // launched: a jump / air jump / kick set vy this tick
  if (s.jumpBuf > 0 && s.wallRunning) {                        // ---- wall-kick: up, away from the wall, a bit forward
    const speed = Math.max(hs, m(WALLRUN.holdSpeed)) + m(WALLRUN.kickFwd);
    s.vy = m(WALLRUN.kickUp);
    s.vx = s.wallT.x * speed + s.wallN.x * m(WALLRUN.kickOut);
    s.vz = s.wallT.z * speed + s.wallN.z * m(WALLRUN.kickOut);
    s.regrabTimer = WALLRUN.regrabCd; s.lastWallN = s.wallN;   // must chain to a DIFFERENT wall
    s.jumpBuf = 0; s.coyote = 0; s.bhopTimer = 0; s.dashT = 0;
    s.wallRunning = false; launched = true;
  } else if (s.jumpBuf > 0 && s.coyote > 0) {
    s.vy = m(JUMP.impulse); s.jumpBuf = 0; s.coyote = 0; jumped = true;
    s.dashT = 0;                                             // jumping out of a dash keeps its speed but frees the steering
    if (s.bhopTimer > 0) {                                   // jumped inside the landing window: b-hop timing bonus
      const v0 = Math.hypot(s.vx, s.vz);
      let dx = 0, dz = 0;
      if (inp.moving) { dx = inp.ax; dz = inp.az; }
      else if (v0 > 1e-3) { dx = s.vx / v0; dz = s.vz / v0; }
      s.vx += dx * m(BHOP.bonus); s.vz += dz * m(BHOP.bonus);
      const cap = Math.max(m(BHOP.maxSpeed), v0), v1 = Math.hypot(s.vx, s.vz);   // ceiling, but never reduce a faster speed
      if (v1 > cap) { s.vx *= cap / v1; s.vz *= cap / v1; }
      s.bhopChain++;
    }
    s.bhopTimer = 0;
    launched = true;
  } else if (s.jumpBuf > 0 && !grounded && s.coyote <= 0 && s.airJumpsLeft > 0 && !landingSoon(ctx, s)) {
    // ---- air jump: coyote time is over, so this press spends an air jump. Crisp push toward the held keys, speed never lost.
    s.vy = m(JUMP.doubleJumpImpulse);
    s.airJumpsLeft--; s.jumpBuf = 0; s.dashT = 0; launched = true; airJumped = true;
    if (inp.moving) {
      const v0 = Math.hypot(s.vx, s.vz);
      s.vx += inp.ax * m(JUMP.doubleJumpDir); s.vz += inp.az * m(JUMP.doubleJumpDir);
      const v1 = Math.hypot(s.vx, s.vz);
      if (v1 < v0 && v1 > 1e-6) { s.vx *= v0 / v1; s.vz *= v0 / v1; }   // a snap-turn redirects, it does not brake
    }
  }

  // ---- dash (F): locks a horizontal direction for DASH.duration at DASH.speed (or the current speed if that is higher)
  if (inp.dash && s.dashCd <= 0 && s.dashT <= 0) {
    let dx = inp.ax, dz = inp.az;
    if (!inp.moving) { dx = Math.sin(s.facing); dz = Math.cos(s.facing); }
    s.dashX = dx; s.dashZ = dz;
    s.dashSpeed = Math.max(m(DASH.speed), Math.hypot(s.vx, s.vz));
    s.dashT = DASH.duration; s.dashCd = DASH.cooldown;
    s.sliding = false;
  }
  const dashing = s.dashT > 0;
  if (dashing) s.wallRunning = false;                         // a dash breaks away from the wall

  // ---- slide state: Shift held on the ground enters (with a speed boost), releasing / jumping / leaving the ground ends it
  if (jumped || launched || dashing || s.wallRunning) s.sliding = false;
  else if (s.sliding && (!inp.slide || (!grounded && s.coyote <= 0))) s.sliding = false;
  else if (!s.sliding && inp.slide && grounded) {
    s.sliding = true;
    const v = Math.hypot(s.vx, s.vz);
    if (v > m(SLIDE.minSpeed)) {                              // faster than maxEntrySpeed (b-hop speed): kept as is, no boost, no clamp
      const t = v > m(SLIDE.maxEntrySpeed) ? v : Math.min(v * SLIDE.entryBoost, m(SLIDE.maxEntrySpeed));
      s.vx *= t / v; s.vz *= t / v;
    }
  }

  // ---- horizontal
  const sp = runSpeed(s);
  if (dashing) {                                              // locked burst
    s.vx = s.dashX * s.dashSpeed; s.vz = s.dashZ * s.dashSpeed;
  } else if (s.wallRunning) {                                 // run along the wall: speed kept (min holdSpeed), aimed along the tangent
    const spd = Math.max(hs, m(WALLRUN.holdSpeed)), pin = m(WALLRUN.stick);
    s.vx = s.wallT.x * spd - s.wallN.x * pin;
    s.vz = s.wallT.z * spd - s.wallN.z * pin;
  } else if (s.sliding && grounded) {
    if (s.bhopTimer <= 0) {                                   // (inside the landing window a slide keeps all its speed)
      const f = Math.pow(SLIDE.friction, STEP);               // glide: low friction, momentum kept
      s.vx *= f; s.vz *= f;
    }
    if (inp.moving) {                                         // light steering: turns the slide, never adds speed
      const cap = Math.max(Math.hypot(s.vx, s.vz), m(SLIDE.minSpeed)), a = m(SLIDE.steerAccel) * STEP;
      s.vx += inp.ax * a; s.vz += inp.az * a;
      const v = Math.hypot(s.vx, s.vz);
      if (v > cap) { s.vx *= cap / v; s.vz *= cap / v; }
    }
  } else if (grounded && !jumped) {
    if (s.bhopTimer > 0) { /* landing window: no friction, no run-speed clamp, speed is preserved */ }
    else {                                                    // normal ground: velocity chases the wanted velocity, so speed above
      const k = Math.min(1, STEP * MOVE.accel);               // the run cap bleeds back down smoothly
      s.vx += (inp.ax * sp - s.vx) * k;
      s.vz += (inp.az * sp - s.vz) * k;
    }
  } else if (inp.moving && !airJumped) {                      // air (and the takeoff tick): Quake air-strafe, no drag.
    airAccelerate(s, inp.ax, inp.az, sp);                     // (the air-jump tick skips it, so the snap-turn keeps its speed)
  }

  // ---- vertical: stick to the ground, otherwise gravity (light while dashing, heavier on the way down than up)
  if (launched) { /* takeoff tick: move with the full impulse */ }
  else if (s.wallRunning) {                                   // light gravity, and the fall speed is clamped
    s.vy = Math.max(s.vy - m(WALLRUN.wallGrav) * STEP, -m(WALLRUN.maxFall));
  }
  else if (grounded && s.vy <= 0) s.vy = -0.5;
  else s.vy -= m(dashing ? DASH.airGrav : (s.vy > 0 ? JUMP.gravRise : JUMP.gravFall)) * STEP;

  // ---- capsule height: eases to the slide height while sliding, back to standing only when there is headroom
  const standH = m(PUPPET.height), slideH = m(SLIDE.height);
  let target = s.sliding ? slideH : standH;
  if (target > s.height + 1e-6 && !hasHeadroom(ctx, standH)) target = slideH;   // low ceiling: stay crouched
  let h = s.height + (target - s.height) * Math.min(1, STEP * SLIDE.resize);
  if (Math.abs(target - h) < 0.004) h = target;

  // glued to the ground: the controller's own snap does not hold on a surface that turns downward (a ramp crest), so while
  // grounded we also ask for a little extra downward travel; the controller stops at the surface, and on a real ledge it
  // pulls us down at most MOVE.stick. s.vy itself stays tiny, so walking off a high ledge still starts a normal fall.
  // Skipped right after a climb (pressing down into a slope only makes the controller turn less of the move into height), and
  // the first two airborne ticks after leaving a surface still count as being on it, which is what covers a ramp crest.
  const onSurface = grounded || s.airT < 0.04;
  const stickDown = (onSurface && !launched && !s.wallRunning && s.vy <= 0 && !s.climbing) ? m(MOVE.stick) : 0;
  const c = movePlayer(ctx, s.vx * STEP, s.vy * STEP - stickDown, s.vz * STEP, h);
  s.height = h;
  if (s.vy > 0 && c.y < s.vy * STEP * 0.5) s.vy = 0;        // bonked a ceiling: stop rising

  // wall detection: we wanted to cover vx,vz this tick but the controller let us move much less
  const want = Math.hypot(s.vx, s.vz) * STEP, got = Math.hypot(c.x, c.z);
  s.wallHit = want > m(RUN.wallMinSpeed) * STEP && got < want * RUN.wallRatio;
  if (s.wallHit) { s.bhopTimer = 0; if (grounded) s.bhopChain = 0; }   // slamming into a wall ends the b-hop window
  // blocked: the speed into the obstacle is gone. Keep only the motion the controller actually allowed (the slide along
  // the wall), otherwise uncapped air speed would pile up against a wall and shoot out of it later
  // (not when the controller merely climbed a slope or step: we asked for no upward motion, it moved up anyway, and the
  // horizontal shortfall went into height, not into a wall. Clamping there would bleed speed every tick on every ramp.)
  const climbed = s.vy <= 0 && c.y > 1e-4;
  s.climbing = climbed;
  if (want > 1e-6 && got < want * 0.98 && !climbed) { s.vx = c.x / STEP; s.vz = c.z / STEP; }

  // face the way we are moving (smoothly)
  if (inp.moving || dashing || (s.sliding && Math.hypot(s.vx, s.vz) > m(SLIDE.minSpeed))) {
    const d = Math.atan2(Math.sin(Math.atan2(s.vx, s.vz) - s.facing), Math.cos(Math.atan2(s.vx, s.vz) - s.facing));
    s.facing += d * Math.min(1, STEP * 12);
  }
}
