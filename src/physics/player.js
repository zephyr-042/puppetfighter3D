// src/physics/player.js
// PHYSICS: the player's movement rules as a function of (state, input). Ported verb by verb from the old physics.js.
// Done so far: progressive momentum run (runT, plain run capped at RUN.max), jump (buffer, coyote time, rise / fall gravity),
// Quake-style air-strafing (no air drag, no top speed), b-hop landing window, crouch-slide, dash burst, double jump,
// wall-run + wall-kick, dash with Phase-Dodge i-frames (`dodgeT`), grapple / sticky hand (hold E / right mouse), automatic ledge mantle, Kinetic Slash (Left-Click: floating-blade cleave +
// magnetic lunge that hands your momentum back, see MELEE) and applyKnockback (what a hit does to the victim). Coming next: pillar orbit.
// One state object per player (6 per match). `state.locked` (set by main.js while stunned, in countdown or round / match end)
// makes stepPlayer ignore the input snapshot, so knockback plays out under normal gravity / friction with no steering.
// Loads after: config.js, physics/world.js
// Speeds in `state` are in METRES / s (already scaled); config numbers are in old units and go through m().

// MAX_FLOW_SPEED (below) is the soft aerodynamic ceiling on horizontal speed.
import { STEP, SCALE, m, PUPPET, RUN, MOVE, JUMP, BHOP, DASH, SLIDE, WALLRUN, GRAPPLE, MANTLE, MELEE, PARRY } from '../config.js';
import { movePlayer, hasHeadroom, detectWall, groundGap, groundNormal, raycastGrapple, feetPos, checkLedgeMantle } from './world.js';

// Soft aerodynamic speed ceiling, old units / s (Titanfall 2 "flow" zone). Horizontal speed above it bleeds back toward it
// (see the end of the horizontal section in stepPlayer), so grapple slingshots and b-hop chains top out around 760 instead of running away.
const MAX_FLOW_SPEED = 760;

// Input snapshot with nothing pressed (used while a player is locked).
export const IDLE_INPUT = Object.freeze({ ax: 0, az: 0, moving: false, fwd: false, jump: false, dash: false, slide: false, grapple: false, attack: false, parry: false });

export function createPlayerState() {
  return { vx: 0, vz: 0, vy: 0, facing: 0, runT: 0, isIt: false, locked: false, wallHit: false, jumpBuf: 0, coyote: 0,
           sliding: false, crouching: false, downhill: false, slideBoostCd: 0, height: m(PUPPET.height),   // crouching: slow Shift on the ground (SLIDE.crouchSpeed, no boost); downhill: grounded on a real slope (groundNormal.y < 0.985) with the velocity pointing down it
           wasGrounded: true, airT: 0, bhopTimer: 0, bhopChain: 0,
           dashT: 0, dashCd: 0, dashX: 0, dashZ: 1, dashSpeed: 0,
           dashElapsed: 0,     // s since the current dash started (the server treats the first DASH.dodgeIframes s as Phase-Dodge i-frames)
           parryT: 0, parryElapsed: 0, parryCd: 0,   // Slice M2 guard: s of guard left (PARRY.duration), s since it started (perfect while <= PARRY.perfectWindow), cooldown
           dodgeT: 0,          // s of Phase-Dodge i-frames left (set to DASH.dodgeIframes when F dashes, ticks down by STEP; main.js ignores server hits while > 0)
           airJumpsLeft: JUMP.maxAirJumps, climbing: false,
           wallRunning: false, wallSide: 0, wallN: { x: 0, z: 0 }, wallT: { x: 0, z: 0 },
           regrabTimer: 0, lastWallN: null, wallDropCd: 0,
           grappleActive: false, grappleAnchor: { x: 0, y: 0, z: 0 }, grappleTarget: -1, grappleT: 0, grappleCd: 0, grapplePrev: false,
           grappleHit: -1,     // grappleHit: index of a player the hook just reached (main.js consumes it: shove + stun)
           mantleT: 0,         // s left of the mantle forward-step window (see MANTLE)
           attackType: 'slash', // Slice M3: what the current / last Left-Click was: 'slash' | 'uppercut' (sliding) | 'slam' (falling); drives the blade animation + the server request
           diving: false,      // Air Dive in progress: vy is held at -MELEE.diveSpeed until touchdown
           diveStartY: 0,      // metres: feet height when the dive started
           dropHeight: 0,      // metres fallen during the last dive, set on touchdown together with slamLanded (the server derives the same number itself)
           slamLanded: false,  // set on the tick the dive touches down; main.js emits 'slam' to the server and clears it
           attackT: 0, attackCd: 0, attackYaw: 0,                  // melee: s left of the blade swing (MELEE.attackTime), cooldown (MELEE.cooldown), yaw the pod faces during the swing
           lungeT: 0, lungeX: 0, lungeZ: 1, lungeV: 0, lungePre: 0, // magnetic lunge: s left, direction, lunge speed (m / s), the momentum to hand back afterwards (m / s)
           stunT: 0,           // s left of hit-stun (set by applyKnockback): input ignored, knockback plays out
           slashEvt: null,     // { dirX, dirZ, speed } set on the tick a slash starts; main.js sends it to the server and clears it (speed = pre-lunge horizontal speed, old units / s)
           sfx: [] };          // sound events of THIS tick ('jump' | 'airjump' | 'kick' | 'attach' | 'dash' | 'grapple' | 'slash' | 'parry'); cleared at the start of stepPlayer, read by main.js
}

// Torso point (metres) where the grapple rope leaves the body and the pull is measured from.
export function torsoPos(ctx, s) {
  const f = feetPos(ctx);
  return { x: f.x, y: f.y + s.height * GRAPPLE.torso, z: f.z };
}

// Release the hook and start the cooldown (also used by main.js when the hooked player goes down or the round changes).
export function endGrapple(s, cd = GRAPPLE.cooldown) {
  s.grappleActive = false; s.grappleTarget = -1; s.grappleT = 0; s.grappleCd = cd;
}

// A confirmed hit on THIS player (main.js calls it for the 'hit' event whose targetId is you). (kx, ky, kz) is the knockback velocity in m / s.
// Velocity that points back at the attacker is cancelled first (so running into a slash cannot eat the knockback), then the knockback is added;
// the vertical part lifts the pod off the floor so ground friction cannot swallow it. Grapple, dash, slide and any lunge are cut, input is ignored for `stun`.
export function applyKnockback(s, kx, ky, kz, stun = MELEE.hitStun) {
  const h = Math.hypot(kx, kz);
  if (h > 1e-6) {
    const dx = kx / h, dz = kz / h, along = s.vx * dx + s.vz * dz;
    if (along < 0) { s.vx -= dx * along; s.vz -= dz * along; }
  }
  s.vx += kx; s.vz += kz;
  s.vy = Math.max(s.vy, 0) + ky;
  s.stunT = Math.max(s.stunT, stun);
  s.lungeT = 0; s.dashT = 0; s.sliding = false; s.crouching = false; s.wallRunning = false; s.mantleT = 0; s.bhopTimer = 0; s.diving = false;
  if (s.grappleActive) endGrapple(s);
}

// ground top speed for the current momentum (old units -> metres). This is the PLAIN run speed; b-hop / air speed can exceed it.
export function runSpeed(s) {
  const f = Math.min(1, s.runT / RUN.rampT);
  return m(RUN.min + (RUN.max - RUN.min) * f) * (s.isIt ? RUN.itBonus : 1);
}

// runT bookkeeping. Grows only on clean ground running; held in the air (so jumps / slides / dashes keep it);
// drains fast when the player lets go of the keys or runs into something.
function updateRunT(s, inp, grounded) {
  if (s.crouching) s.runT = 0;                                // a crouch holds no running momentum
  else if (s.wallHit) s.runT -= STEP * RUN.wallDecay;
  else if (s.sliding) { /* a slide holds the momentum: no growth, no decay */ }
  else if (inp.moving) { if (grounded) s.runT += STEP; }
  else if (grounded) s.runT -= STEP * RUN.stopDecay;
  s.runT = Math.max(0, Math.min(RUN.rampT, s.runT));
}

// Quake / Source air acceleration. (ax, az) = unit wish direction. Speed is added only while the speed ALONG the wish
// direction is below the (small) wish cap, so a wish direction that is sideways to the velocity keeps adding speed as the
// velocity turns; flying straight along it adds nothing. There is no upper limit on the resulting speed.
function airAccelerate(s, ax, az, wishSpeed, carve) {
  // look-steering / air carving (only while W is held: `carve`): rotate the existing horizontal velocity a small fraction
  // (JUMP.airTurnRate * STEP) of the way toward the wish direction (camera-relative keys), so aiming the crosshair curves the flight.
  // A pure rotation, so the horizontal magnitude is preserved (it only aims the speed, it never adds or removes any).
  const v = Math.hypot(s.vx, s.vz);
  if (carve && v > 1e-3 && JUMP.airTurnRate > 0) {
    const ang = Math.atan2(s.vx * az - s.vz * ax, s.vx * ax + s.vz * az);   // signed angle from velocity to wish (about +y)
    const r = ang * Math.min(1, JUMP.airTurnRate * STEP), cs = Math.cos(r), sn = Math.sin(r);
    const vx = s.vx, vz = s.vz;
    s.vx = vx * cs - vz * sn; s.vz = vz * cs + vx * sn;
  }
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
  if (s.stunT > 0) { s.stunT = Math.max(0, s.stunT - STEP); inp = IDLE_INPUT; }   // hit-stun: knockback plays out with no steering
  if (s.locked) inp = IDLE_INPUT;                             // stunned / frozen: no steering, jumps, dashes or slides (knockback keeps its velocity)
  s.sfx.length = 0;                                           // this tick's sound events (main.js plays them right after the step)
  const grounded = ctx.player.grounded;
  if (s.diving && grounded) { s.diving = false; s.slamLanded = true; s.dropHeight = Math.max(0, s.diveStartY - feetPos(ctx).y); }   // Air Dive touchdown: main.js sends 'slam' (the server owns the shockwave)
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
  if (s.dashT > 0) { s.dashElapsed += STEP; s.dashT = Math.max(0, s.dashT - STEP); }
  if (s.parryCd > 0) s.parryCd = Math.max(0, s.parryCd - STEP);
  if (s.parryT > 0) { s.parryElapsed += STEP; s.parryT = Math.max(0, s.parryT - STEP); }
  if (s.dodgeT > 0) s.dodgeT = Math.max(0, s.dodgeT - STEP);
  if (s.slideBoostCd > 0) s.slideBoostCd = Math.max(0, s.slideBoostCd - STEP);
  if (s.attackCd > 0) s.attackCd = Math.max(0, s.attackCd - STEP);
  if (s.attackT > 0) s.attackT = Math.max(0, s.attackT - STEP);
  if (s.regrabTimer > 0) s.regrabTimer = Math.max(0, s.regrabTimer - STEP);
  if (s.wallDropCd > 0) s.wallDropCd = Math.max(0, s.wallDropCd - STEP);
  if (grounded) s.airJumpsLeft = JUMP.maxAirJumps;

  // ---- parry / block (Right-Click edge): raises the guard for PARRY.duration. Not while swinging, locked or stunned (inp is idle then).
  if (inp.parry && s.parryCd <= 0 && s.parryT <= 0 && s.attackT <= 0 && !s.locked) {
    s.parryT = PARRY.duration; s.parryElapsed = 0; s.parryCd = PARRY.cooldown; s.sfx.push('parry');
  }

  // ---- grapple / sticky hand: a press (edge) fires a shot along the aim ray (inp.aim, set by main.js for the human); while hooked
  // the velocity is pulled toward the anchor and only the speed TOWARD it is capped, so sideways speed survives and the
  // pull bends the path into a swing. Ends on release, timeout, reaching the anchor, Space (upward pop) or a dash.
  if (s.grappleCd > 0) s.grappleCd = Math.max(0, s.grappleCd - STEP);
  let grappling = false, grapJump = false;
  if (!s.grappleActive && inp.grapple && !s.grapplePrev && s.grappleCd <= 0 && s.dashT <= 0 && inp.aim) {
    const r = raycastGrapple(ctx, inp.aim.origin, inp.aim.dir, m(GRAPPLE.maxRange), inp.aim.owner, inp.aim.skip);
    s.sfx.push('grapple');                                    // the shot is fired whether or not it hits
    if (r.hit) {
      s.grappleActive = true; s.grappleT = 0; s.grappleTarget = r.targetPlayer;
      s.grappleAnchor = { x: r.point.x, y: r.point.y, z: r.point.z };
    } else s.grappleCd = GRAPPLE.missCooldown;
  }
  s.grapplePrev = !!inp.grapple;
  if (s.grappleActive) {
    s.grappleT += STEP;
    const gp = torsoPos(ctx, s), a = s.grappleAnchor;
    const gx = a.x - gp.x, gy = a.y - gp.y, gz = a.z - gp.z, gd = Math.hypot(gx, gy, gz);
    if (gd < m(GRAPPLE.detachDist)) {                         // reached the anchor (a player: main.js shoves + stuns them)
      if (s.grappleTarget >= 0) s.grappleHit = s.grappleTarget;
      endGrapple(s);
    } else if (!inp.grapple || s.grappleT >= GRAPPLE.maxDuration) endGrapple(s);
    else if (inp.jump) {                                      // Space: clean release with an upward pop, straight into air-strafe / wall-run
      endGrapple(s);
      s.vy = Math.max(s.vy, m(GRAPPLE.detachJumpBoost));
      grapJump = true;
    } else if (inp.dash && s.dashCd <= 0) endGrapple(s);      // the dash takes over below
    else {
      const nx = gx / gd, ny = gy / gd, nz = gz / gd, acc = m(GRAPPLE.pullAccel) * STEP;
      s.vx += nx * acc; s.vy += ny * acc; s.vz += nz * acc;
      const over = s.vx * nx + s.vy * ny + s.vz * nz - m(GRAPPLE.maxPullSpeed);   // speed toward the anchor above the cap
      if (over > 0) { s.vx -= nx * over; s.vy -= ny * over; s.vz -= nz * over; }
      s.airJumpsLeft = JUMP.maxAirJumps;                      // hooking refills the air jump
      grappling = true;
    }
  }

  // ---- wall-run detection: in the air, holding W, fast enough, with a wall beside us that is not the one we just kicked off
  const wasWallRunning = s.wallRunning;                       // (an ATTACH is a tick that wall-runs after one that did not)
  s.wallRunning = false;
  const hs = Math.hypot(s.vx, s.vz);
  if (!grounded && !grappling && inp.fwd && s.dashT <= 0 && s.airT >= WALLRUN.minAir && hs > m(WALLRUN.minSpeed)) {
    // Already on a wall: track it directly. The rays are cast square to the LAST wall (yaw = its tangent, which follows a curved pillar
    // as the normal turns) and reach `stickReach` further, so skimming a corner keeps the lock instead of dropping for a tick.
    const w = wasWallRunning ? detectWall(ctx, Math.atan2(s.wallT.x, s.wallT.z), WALLRUN.stickReach)
                             : detectWall(ctx, Math.atan2(s.vx, s.vz));
    const sameWall = s.regrabTimer > 0 && s.lastWallN && (w.hit && w.normal.x * s.lastWallN.x + w.normal.z * s.lastWallN.z > 0.9);
    if (w.hit && !sameWall) {
      let tx = -w.normal.z, tz = w.normal.x;                  // wall tangent, signed to point the way we are travelling
      if (s.vx * tx + s.vz * tz < 0) { tx = -tx; tz = -tz; }
      if (Math.abs(s.vx * tx + s.vz * tz) / hs >= WALLRUN.minTangent) {
        s.wallRunning = true; s.wallSide = w.side; s.wallN = w.normal; s.wallT = { x: tx, z: tz };
        s.airJumpsLeft = JUMP.maxAirJumps;                    // catching a wall refills the air jump
        // entry pop: once per wall-run chain (a fresh attach, not within dropCd of a natural drop), and only for a falling catch
        if (!wasWallRunning && s.wallDropCd <= 0 && s.vy < 0) s.vy = m(WALLRUN.entryUp);
      }
    }
  }
  if (s.wallRunning && !wasWallRunning) s.sfx.push('attach');
  // natural drop (the wall ended / was lost, no wall-kick: a kick happens below and leaves wasWallRunning false next tick)
  if (wasWallRunning && !s.wallRunning && !grounded) s.wallDropCd = WALLRUN.dropCd;

  // ---- jump: buffer (pressed shortly before landing) + coyote time (shortly after leaving a ledge)
  if (inp.jump) s.jumpBuf = JUMP.buffer; else s.jumpBuf = Math.max(0, s.jumpBuf - STEP);
  if (grapJump) s.jumpBuf = 0;                                // that press was spent releasing the hook
  if (grounded && s.vy <= 0) s.coyote = JUMP.coyote; else s.coyote = Math.max(0, s.coyote - STEP);
  let jumped = false, launched = grapJump, airJumped = false;     // launched: a jump / air jump / kick set vy this tick
  if (s.jumpBuf > 0 && s.wallRunning) {                        // ---- wall-kick: up, away from the wall, a bit forward
    const speed = Math.max(hs, m(WALLRUN.holdSpeed)) + m(WALLRUN.kickFwd);
    s.vy = m(WALLRUN.kickUp);
    s.vx = s.wallT.x * speed + s.wallN.x * m(WALLRUN.kickOut);
    s.vz = s.wallT.z * speed + s.wallN.z * m(WALLRUN.kickOut);
    s.regrabTimer = WALLRUN.regrabCd; s.lastWallN = s.wallN;   // must chain to a DIFFERENT wall
    s.jumpBuf = 0; s.coyote = 0; s.bhopTimer = 0; s.dashT = 0;
    s.wallRunning = false; launched = true; s.sfx.push('kick');
  } else if (s.jumpBuf > 0 && s.coyote > 0) {
    s.vy = m(JUMP.impulse); s.jumpBuf = 0; s.coyote = 0; jumped = true; s.sfx.push('jump');
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
    s.airJumpsLeft--; s.jumpBuf = 0; s.dashT = 0; launched = true; airJumped = true; s.sfx.push('airjump');
    if (inp.moving) {
      const v0 = Math.hypot(s.vx, s.vz);
      s.vx += inp.ax * m(JUMP.doubleJumpDir); s.vz += inp.az * m(JUMP.doubleJumpDir);
      const v1 = Math.hypot(s.vx, s.vz);
      // Clamp to max(entry speed, BHOP.maxSpeed): already flying faster (wall-kick / grapple, e.g. 680) keeps that speed and just snap-turns,
      // but a flat-ground air jump can never push you past the BHOP.maxSpeed tier (520). Never brakes either (v1 < v0 is scaled back up to v0).
      const cap = Math.max(v0, m(BHOP.maxSpeed));
      if (v1 > cap) { s.vx *= cap / v1; s.vz *= cap / v1; }
      else if (v1 < v0 && v1 > 1e-6) { s.vx *= v0 / v1; s.vz *= v0 / v1; }   // a snap-turn redirects, it does not brake
    }
  }

  if (s.diving && (launched || s.wallRunning || grappling)) s.diving = false;   // a jump / kick / wall catch / hook ends the dive

  // ---- dash (F): locks a horizontal direction for DASH.duration at DASH.speed (or the current speed if that is higher)
  if (inp.dash && s.dashCd <= 0 && s.dashT <= 0) {
    let dx = inp.ax, dz = inp.az;
    if (!inp.moving) { dx = Math.sin(s.facing); dz = Math.cos(s.facing); }
    s.dashX = dx; s.dashZ = dz;
    s.dashSpeed = Math.max(m(DASH.speed), Math.hypot(s.vx, s.vz));
    s.dashT = DASH.duration; s.dashCd = DASH.cooldown; s.dashElapsed = 0;
    s.dodgeT = DASH.dodgeIframes;                             // Phase-Dodge: invulnerable for the first dodgeIframes seconds of the dash (independent of dashT, so a jump-cancel keeps it)
    s.sliding = false; s.sfx.push('dash');
  }
  const dashing = s.dashT > 0;
  if (dashing) s.wallRunning = false;                         // a dash breaks away from the wall

  // ---- Kinetic Slash (Left-Click -> inp.attack) + magnetic lunge. The slash itself (swing + hit request) always fires off cooldown; the LUNGE is only
  // added when it would not fight another verb: not while dashing (already a locked burst), hooked (the pull owns the velocity) or wall-running (the
  // rail is kept, you still slash). The lunge snaps the horizontal velocity along the aim (or onto the nearest opponent inside the cleave cone, see
  // inp.melee.targets) at max(lungeSpeed, current speed) for lungeDuration, then hands back exactly the speed you came in with, so a slash chains straight into
  // wall-runs and b-hops. Damage / knockback scale with that INCOMING horizontal speed, which the server re-checks (see s.slashEvt, main.js, server.js).
  if (inp.attack && s.attackCd <= 0) {
    const mel = inp.melee || null;
    let ax = mel ? mel.dirX : Math.sin(s.facing), az = mel ? mel.dirZ : Math.cos(s.facing);
    const al = Math.hypot(ax, az);
    if (al > 1e-6) { ax /= al; az /= al; } else { ax = Math.sin(s.facing); az = Math.cos(s.facing); }
    const pre = Math.hypot(s.vx, s.vz);

    // magnetic lock: nearest opponent inside the cleave cone and reach (feet positions, metres)
    let dirX = ax, dirZ = az, lockDist = -1;
    if (mel && mel.targets && mel.targets.length) {
      const f = feetPos(ctx), reach = m(MELEE.reach);
      let best = Infinity;
      for (const t of mel.targets) {
        const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz);
        if (d > reach || d >= best) continue;
        if (d > 0.45 && (dx * ax + dz * az) / d < MELEE.coneCos) continue;      // (very close targets are inside the body: always inside the cone)
        if (Math.abs((t.y + 0.9) - (f.y + s.height * 0.5)) > m(MELEE.vertical)) continue;
        best = d; lockDist = d;
        if (d > 0.45) { dirX = dx / d; dirZ = dz / d; } else { dirX = ax; dirZ = az; }
      }
    }

    // contextual move: sliding -> Uppercut (rising slash), falling from >= MELEE.diveMinHeight -> Air Dive Slam, otherwise the normal slash
    let type = 'slash';
    if (s.sliding) type = 'uppercut';
    else if (!grounded && s.vy < -3.0 && !grappling && !s.wallRunning && groundGap(ctx, m(MELEE.diveMinHeight)) >= m(MELEE.diveMinHeight)) type = 'slam';   // needs >= 2.2 m of air under the feet: a standing jump just slashes
    s.attackType = type;
    if (type === 'uppercut') {                                // clear the slide into a rising pop (the forward lunge below still applies)
      s.sliding = false; s.vy = Math.max(s.vy, m(MELEE.uppercutPop)); launched = true; s.coyote = 0;
    } else if (type === 'slam') {                             // dive: straight down at diveSpeed until touchdown (any dash is cancelled)
      s.diving = true; s.diveStartY = feetPos(ctx).y; s.vy = -m(MELEE.diveSpeed); s.dashT = 0;
    }
    s.parryT = 0;                                             // swinging drops the guard
    s.attackT = MELEE.attackTime; s.attackCd = MELEE.cooldown; s.attackYaw = Math.atan2(dirX, dirZ);
    s.sfx.push('slash');
    s.slashEvt = { dirX, dirZ, speed: Math.min(pre / SCALE, 2000), type };   // type 'slam' only announces the dive to the server: the damage comes with 'slam' on touchdown

    if (!dashing && !grappling && !s.wallRunning && type !== 'slam') {
      const lv = Math.max(m(MELEE.lungeSpeed), pre);
      let dur = MELEE.lungeDuration;
      if (lockDist >= 0) dur = Math.min(dur, Math.max(0, (lockDist - m(MELEE.standOff)) / lv));   // stop standOff short of the locked target
      if (dur > STEP * 0.5) { s.lungeT = dur; s.lungeX = dirX; s.lungeZ = dirZ; s.lungeV = lv; s.lungePre = pre; }
    }
  }
  if (s.wallRunning || grappling) s.lungeT = 0;               // catching a wall / a hook mid-lunge: that verb owns the velocity now

  // ---- slide / crouch state. Shift on the ground: fast enough (SLIDE.entryMinSpeed), landing from the air (>= landEntrySpeed) or on a downhill = a momentum SLIDE (with the
  // Titanfall-style boost); otherwise a plain CROUCH (SLIDE.crouchSpeed, no boost). A slide that slows below SLIDE.exitSpeed on flat ground becomes a crouch.
  // Releasing Shift / jumping / leaving the ground ends either.
  // Slide-hop: Shift stays held through a jump, so the landing re-enters the slide at once (inside the b-hop window it keeps all its
  // speed, and a Space press there jumps straight out of it with the b-hop bonus). A jump / launch always clears `sliding` first, so
  // the capsule stands back up in the air and the chain never gets stuck crouched.
  if (jumped || launched || dashing || s.wallRunning || grappling) { s.sliding = false; s.crouching = false; }
  else if (!inp.slide || (!grounded && s.coyote <= 0)) { s.sliding = false; s.crouching = false; }   // releasing Shift / leaving the ground ends both
  else if (s.sliding) {
    // a slide that has run out of speed on flat ground (and is not inside the b-hop landing window) settles into a crouch: no endless drifting.
    // `downhill` is true only on a real slope (groundNormal) with the velocity pointing down it, so a flat floor always lets the slide decay into a crouch.
    if (grounded && s.bhopTimer <= 0 && !s.downhill && Math.hypot(s.vx, s.vz) < m(SLIDE.exitSpeed)) { s.sliding = false; s.crouching = true; }
  } else if (s.crouching) {
    // crouch-walking down a slope turns into a slide (no boost: the slope itself accelerates it)
    if (grounded && s.downhill && Math.hypot(s.vx, s.vz) >= m(SLIDE.minSpeed)) { s.crouching = false; s.sliding = true; }
  } else if (grounded) {                                      // Shift pressed (or still held) on the ground: slide or crouch?
    const v = Math.hypot(s.vx, s.vz);
    const recentLand = landed || s.bhopTimer > 0;             // just came down from a jump / wall-run / grapple / fall
    if (v >= m(SLIDE.entryMinSpeed) || (recentLand && v >= m(SLIDE.landEntrySpeed)) || (s.downhill && v >= m(SLIDE.minSpeed))) {
      s.sliding = true;
      if (s.slideBoostCd <= 0) {                              // flat burst: along the velocity (v is above minSpeed on every path in here except a crawl down a slope: then the facing)
        const cap = m(SLIDE.maxBoostSpeed);
        const add = Math.min(m(SLIDE.boostAdd), cap - v);     // a speed already above the cap is kept: no boost, no clamp
        if (add > 1e-4) {
          let dx, dz;
          if (v > m(SLIDE.minSpeed)) { dx = s.vx / v; dz = s.vz / v; }
          else { dx = Math.sin(s.facing); dz = Math.cos(s.facing); }
          s.vx += dx * add; s.vz += dz * add;
          s.slideBoostCd = SLIDE.boostCd;
        }
      }
    } else s.crouching = true;                                // standing still / walking slowly: a plain crouch, zero boost
  }

  // ---- horizontal
  const sp = runSpeed(s);
  let lungeDone = false;
  if (s.lungeT > 0 && !dashing) {                             // magnetic lunge: a crisp snap along the slash direction (no friction, no air-strafe)
    s.lungeT = Math.max(0, s.lungeT - STEP);
    s.vx = s.lungeX * s.lungeV; s.vz = s.lungeZ * s.lungeV;
    lungeDone = s.lungeT <= 0;                                // the momentum is handed back after this tick's move (below)
  } else if (dashing) {                                       // locked burst
    s.vx = s.dashX * s.dashSpeed; s.vz = s.dashZ * s.dashSpeed;
  } else if (s.wallRunning) {                                 // run along the wall: speed kept (min holdSpeed), aimed along the tangent
    const spd = Math.max(hs, m(WALLRUN.holdSpeed)), pin = m(WALLRUN.stick);
    s.vx = s.wallT.x * spd - s.wallN.x * pin;
    s.vz = s.wallT.z * spd - s.wallN.z * pin;
  } else if (grappling) {                                     // hooked: the pull owns the velocity, light air steering on top
    if (inp.moving) airAccelerate(s, inp.ax, inp.az, sp, inp.fwd);
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
  } else if (s.crouching && grounded && !jumped && !grapJump) {   // crouch-walk: velocity chases crouchSpeed toward the keys, or 0 with no keys (a clean stop, no drifting)
    const k = Math.min(1, STEP * MOVE.accel * 2), cs = m(SLIDE.crouchSpeed);
    s.vx += ((inp.moving ? inp.ax * cs : 0) - s.vx) * k;
    s.vz += ((inp.moving ? inp.az * cs : 0) - s.vz) * k;
    if (!inp.moving && Math.hypot(s.vx, s.vz) < 0.05) { s.vx = 0; s.vz = 0; }
  } else if (grounded && !jumped && !grapJump) {
    if (s.bhopTimer > 0) { /* landing window: no friction, no run-speed clamp, speed is preserved */ }
    else {                                                    // normal ground: velocity chases the wanted velocity, so speed above
      const k = Math.min(1, STEP * MOVE.accel);               // the run cap bleeds back down smoothly
      s.vx += (inp.ax * sp - s.vx) * k;
      s.vz += (inp.az * sp - s.vz) * k;
    }
  } else if (inp.moving && !airJumped) {                      // air (and the takeoff tick): Quake air-strafe, no drag.
    airAccelerate(s, inp.ax, inp.az, sp, inp.fwd);            // (the air-jump tick skips it, so the snap-turn keeps its speed)
  }

  // ---- soft speed ceiling: the horizontal excess over MAX_FLOW_SPEED bleeds off smoothly (never a hard clamp, never below the ceiling)
  {
    const v = Math.hypot(s.vx, s.vz), cap = m(MAX_FLOW_SPEED);
    if (v > cap) {
      const nv = v + (cap - v) * Math.min(1, STEP * 3.5);
      s.vx *= nv / v; s.vz *= nv / v;
    }
  }

  // ---- vertical: stick to the ground, otherwise gravity (light while dashing, heavier on the way down than up)
  if (launched) { /* takeoff tick: move with the full impulse */ }
  else if (s.diving) s.vy = -m(MELEE.diveSpeed);               // Air Dive: held at full dive speed until touchdown
  else if (s.wallRunning) {                                   // light gravity, and the fall speed is clamped
    s.vy = Math.max(s.vy - m(WALLRUN.wallGrav) * STEP, -m(WALLRUN.maxFall));
  }
  else if (grappling) s.vy -= m(GRAPPLE.gravity) * STEP;      // hooked: lighter gravity so swings carry
  else if (grounded && s.vy <= 0) s.vy = -0.5;
  else s.vy -= m(dashing ? DASH.airGrav : (s.vy > 0 ? JUMP.gravRise : JUMP.gravFall)) * STEP;

  // ---- capsule height: eases to the slide height while sliding, back to standing only when there is headroom
  const standH = m(PUPPET.height), slideH = m(SLIDE.height);
  let target = (s.sliding || s.crouching) ? slideH : standH;
  if (target > s.height + 1e-6 && !hasHeadroom(ctx, standH)) target = slideH;   // low ceiling: stay crouched
  let h = s.height + (target - s.height) * Math.min(1, STEP * SLIDE.resize);
  if (Math.abs(target - h) < 0.004) h = target;

  // glued to the ground: the controller's own snap does not hold on a surface that turns downward (a ramp crest), so while
  // grounded we also ask for a little extra downward travel; the controller stops at the surface, and on a real ledge it
  // pulls us down at most MOVE.stick. s.vy itself stays tiny, so walking off a high ledge still starts a normal fall.
  // Skipped right after a climb (pressing down into a slope only makes the controller turn less of the move into height), and
  // the first two airborne ticks after leaving a surface still count as being on it, which is what covers a ramp crest.
  const onSurface = grounded || s.airT < 0.04;
  const stickDown = (onSurface && !launched && !s.wallRunning && !grappling && s.vy <= 0 && !s.climbing) ? m(MOVE.stick) : 0;
  // mantle forward step: while the window is open (a mantle just triggered) the move also carries a small extra forward DISPLACEMENT, so the
  // capsule slides over the lip as soon as it clears it. It changes no velocity, so no speed is added or lost.
  let fwdX = 0, fwdZ = 0;
  if (s.mantleT > 0) {
    s.mantleT = Math.max(0, s.mantleT - STEP);
    const hv = Math.hypot(s.vx, s.vz);
    if (hv > 1e-3) { fwdX = s.vx / hv * m(MANTLE.forward); fwdZ = s.vz / hv * m(MANTLE.forward); }
  }
  const c = movePlayer(ctx, s.vx * STEP + fwdX, s.vy * STEP - stickDown, s.vz * STEP + fwdZ, h);
  s.height = h;
  if (s.vy > 0 && c.y < s.vy * STEP * 0.5) s.vy = 0;        // bonked a ceiling: stop rising

  // wall detection: we wanted to cover vx,vz this tick but the controller let us move much less
  const want = Math.hypot(s.vx, s.vz) * STEP, got = Math.hypot(c.x, c.z);

  // ---- ledge mantle: airborne, moving forward, blocked (got < 70 % of want) and a walkable ledge top lies 12..48 units above the feet
  // just past the blocking face (checkLedgeMantle) with standing headroom on it: pop up and over. The upward speed is the larger of
  // MANTLE.popSpeed, the current vy and what it takes to clear the lip, and the HORIZONTAL velocity is left exactly as it was (the blocked-speed
  // clamp below is skipped), so a wall-kick or grapple release onto a deck / skybridge keeps 100 % of its speed.
  let mantled = false;
  if (!ctx.player.grounded && !s.wallRunning && want > m(MANTLE.minSpeed) * STEP && got < want * 0.7) {
    const lp = checkLedgeMantle(ctx, s.vx, s.vz);
    if (lp) {
      mantled = true;
      const need = lp.rise + m(MANTLE.clear);                 // metres to rise so the feet end up just above the ledge top
      const clearVy = Math.sqrt(2 * m(JUMP.gravRise) * need) * 1.08;
      s.vy = Math.max(s.vy, m(MANTLE.popSpeed), clearVy);
      s.mantleT = MANTLE.window;
    } else if (s.mantleT > 0) {
      // mid-mantle: the feet have risen to within minRise of the lip, below the probe's range. Still blocked by that last sliver of lip,
      // so keep climbing over it with the speed untouched (the window is refreshed by every probe hit and ends 0.18 s after the last one).
      mantled = true;
      s.vy = Math.max(s.vy, m(MANTLE.popSpeed));
    }
  }
  if (mantled) s.diving = false;
  s.wallHit = !mantled && want > m(RUN.wallMinSpeed) * STEP && got < want * RUN.wallRatio;
  if (s.wallHit) { s.bhopTimer = 0; if (grounded) s.bhopChain = 0; }   // slamming into a wall ends the b-hop window
  // blocked: the speed into the obstacle is gone. Keep only the motion the controller actually allowed (the slide along
  // the wall), otherwise uncapped air speed would pile up against a wall and shoot out of it later
  // (not when the controller merely climbed a slope or step: we asked for no upward motion, it moved up anyway, and the
  // horizontal shortfall went into height, not into a wall. Clamping there would bleed speed every tick on every ramp.)
  const climbed = s.vy <= 0 && c.y > 1e-4;
  s.climbing = climbed;
  if (want > 1e-6 && got < want * 0.98 && !climbed && !mantled) { s.vx = c.x / STEP; s.vz = c.z / STEP; }

  // lunge over: hand the incoming speed back along the slash direction (unless a wall stopped the lunge, then the clamped velocity stands)
  if (lungeDone && got >= want * 0.7) { s.vx = s.lungeX * s.lungePre; s.vz = s.lungeZ * s.lungePre; }

  // downhill slide: judged from the TRUE surface normal under the capsule, never from the vertical part of the move. (The MOVE.stick skin settling
  // pulls every grounded tick a little downward even on a perfectly flat floor, which used to read as "downhill" and accelerate the slide forever.)
  // A flat floor has normal.y >= 0.995, a real ramp (>= 10 degrees) <= 0.985. The horizontal part of the normal points DOWNHILL, so the velocity is going
  // down the slope only when its dot product with (n.x, n.z) is positive. Flat ground therefore never sets `downhill` and never adds slopeAccel:
  // the slide decays under SLIDE.friction and settles into a crouch below SLIDE.exitSpeed (see the slide / crouch state above, read next tick).
  const n = groundNormal(ctx);
  const onSlope = grounded && n.y < 0.985;
  const downSlope = onSlope && (s.vx * n.x + s.vz * n.z) > 0.05;
  s.downhill = downSlope && got > m(SLIDE.minSpeed) * STEP;   // read next tick: keeps a slide going / promotes a crouch on a slope
  if (s.sliding && downSlope) {
    const v = Math.hypot(s.vx, s.vz);
    const dx = v > 1e-3 ? s.vx / v : Math.sin(s.facing), dz = v > 1e-3 ? s.vz / v : Math.cos(s.facing);
    const a = m(SLIDE.slopeAccel) * STEP;
    s.vx += dx * a; s.vz += dz * a;
  }

  // face the way we are moving (smoothly)
  if (inp.moving || dashing || (s.sliding && Math.hypot(s.vx, s.vz) > m(SLIDE.minSpeed))) {
    const d = Math.atan2(Math.sin(Math.atan2(s.vx, s.vz) - s.facing), Math.cos(Math.atan2(s.vx, s.vz) - s.facing));
    s.facing += d * Math.min(1, STEP * 12);
  }
}
