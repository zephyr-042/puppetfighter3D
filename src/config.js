// src/config.js
// All tunable numbers live here, in the ORIGINAL 2.5D game units (puppetfighter).
// Code multiplies by SCALE at the point of use, so retuning never touches logic.
// Loads after: nothing.

export const SCALE = 0.025;          // 1 old unit = 0.025 m  (72-unit puppet = 1.8 m)
export const STEP = 1 / 60;          // fixed physics step
export const MAX_STEPS_PER_FRAME = 5;

// metres helper: old units -> metres
export const m = (units) => units * SCALE;

// ---- puppet body (old units)
export const PUPPET = {
  height: 72,
  radius: 14,          // matches the old circle-vs-box radius
};

// ---- progressive momentum run (runT): ground speed ramps min -> max over rampT seconds of clean running.
// This is only the plain "hold W" speed. Anything above RUN.max comes from movement skill (air-strafing, b-hops, dash).
export const RUN = {
  min: 210,            // old units / s at runT = 0
  max: 310,            // old units / s once runT >= rampT (the basic ground run cap)
  rampT: 1.0,          // seconds of clean running to reach max
  itBonus: 1.06,       // speed multiplier while the player is IT
  stopDecay: 4,        // runT lost per second with no move input (on the ground)
  wallDecay: 6,        // runT lost per second while pressed against a wall
  wallRatio: 0.5,      // moved / wanted horizontal distance below this = "hitting a wall"
  wallMinSpeed: 120,   // old units / s: only count wall hits when we were actually trying to move this fast
};

// ---- jump (old units)
export const JUMP = {
  impulse: 350,        // upward speed at takeoff, units / s  (apex = impulse^2 / (2 * gravRise) = 72 units, one puppet tall)
  buffer: 0.12,        // s: a jump pressed this long before landing still fires on landing
  coyote: 0.10,        // s: a jump pressed this long after walking off a ledge still works
  gravRise: 850,       // units / s^2 while going up (floaty-free but readable arc)
  gravFall: 1100,      // units / s^2 while falling (heavier = crisper landings)
  // Quake / Source style air control: no horizontal drag in the air. Each tick the wish direction adds speed only while
  // the speed ALONG that direction is below airWishCap, so strafing with the mouse turn keeps adding speed (no top limit).
  doubleJumpImpulse: 320, // upward speed of the air jump, units / s
  maxAirJumps: 1,      // air jumps available after leaving the ground; refilled on the ground and while wall-running
  doubleJumpDir: 70,   // units / s: crisp impulse toward the held keys on an air jump (never lowers horizontal speed)
  airWishCap: 45,      // units / s: the wish speed used for the "how much more can I add" check (small = strafing matters)
  airAccel: 14,        // acceleration factor: max added per tick = airAccel * runSpeed * dt (still limited by the cap check)
};

// ---- b-hop: landing opens a short window where ground friction / the run-speed clamp is skipped
export const BHOP = {
  window: 0.14,        // s after landing: speed is preserved; jumping inside it chains a b-hop
  minAir: 0.05,        // s: time in the air before touching down counts as a landing (filters one-tick grounded flicker)
  bonus: 25,           // units / s added along the movement direction by a b-hop (timing reward)
  maxSpeed: 850,       // units / s: the b-hop bonus never pushes you past this (a higher speed is kept as is)
};

// ---- wall-run + wall-kick (old units). Engages in the air while holding W, fast enough, with a wall beside you.
export const WALLRUN = {
  detectDist: 28,      // wall rays reach PUPPET.radius + detectDist from the body centre
  torso: 36,           // height above the feet where the wall rays are cast
  minSpeed: 220,       // units / s horizontal: slower than this and you do not catch the wall
  minAir: 0.05,        // s in the air before a wall can be caught (filters one-tick grounded flicker, same idea as BHOP.minAir)
  minTangent: 0.3,     // share of your speed that must run ALONG the wall (0.3 ~ within 72 degrees of parallel); head-on hits do not stick
  holdSpeed: 360,      // units / s: wall-running never goes slower than this (a faster speed is kept)
  stick: 60,           // units / s pressed into the wall while running, so the body stays on the surface
  wallGrav: 240,       // units / s^2 gravity while wall-running (normal fall is JUMP.gravFall)
  maxFall: 150,        // units / s: downward speed is clamped to this while wall-running
  kickUp: 360,         // upward speed of the wall-kick
  kickOut: 260,        // speed pushed away from the wall along its normal
  kickFwd: 50,         // extra speed along the run direction
  regrabCd: 0.25,      // s during which the wall you just kicked off cannot be caught again
  camTilt: 0.21,       // radians of camera roll while wall-running (leans away from the wall)
  tiltEase: 8,         // 1 / s: how fast the roll follows
};

// ---- dash burst (F): horizontal launch along the held direction (or facing). Keeps runT and any higher speed.
export const DASH = {
  speed: 540,          // units / s during the dash (never lowers a faster speed)
  duration: 0.2,       // s the direction is locked
  cooldown: 1.3,       // s between dashes
  airGrav: 250,        // units / s^2 while dashing (floaty, so a dash carries across gaps)
};

// ---- crouch-slide (old units)
export const SLIDE = {
  height: 40,          // capsule height while sliding (40 units = 1.0 m; standing is PUPPET.height = 72 = 1.8 m)
  entryBoost: 1.2,     // speed multiplier on entering a slide while moving faster than minSpeed
  maxEntrySpeed: 460,  // the entry boost never pushes you above this; an entry already faster (b-hop speed) is kept as is, never reduced
  friction: 0.55,      // speed multiplier per SECOND while sliding (applied as friction^dt each tick)
  steerAccel: 90,      // units / s^2 of sideways steering toward the held keys (turns the slide, adds no speed)
  minSpeed: 60,        // units / s: below this there is no entry boost, and steering may still creep up to this speed
  resize: 14,          // how fast the capsule height eases between standing and sliding (1 / s)
};

// ---- movement
export const MOVE = {
  accel: 9,            // how fast velocity chases the wanted velocity (old: k = dt * 9)
  stepHeight: 24,      // max step-up, old units
};

// ---- camera (old units where it makes sense)
export const CAM = {
  dist: 150,           // boom length behind the puppet
  height: 36,          // lift above the pivot at full distance
  pivot: 55,           // pivot height above the puppet's feet (chest/eye)
  pad: 8,              // gap kept between camera and a wall
  minDist: 4,
  mouseSens: 0.0025,   // radians per pixel
  pitchMin: -0.5,
  pitchMax: 1.2,
  fov: 75,
  fovWarp: 15,         // degrees of extra FOV at full speed
  fovWarpFrom: 300,    // units / s: horizontal speed where the warp starts
  fovWarpTo: 750,      // units / s: horizontal speed where the warp is at full strength
  fovWarpEase: 6,      // 1 / s: how fast the FOV follows
};

// ---- test floor (old units)
export const TEST_FLOOR = {
  hw: 760,             // half width  (same as the Roof map)
  hd: 500,             // half depth
  thickness: 20,
};

// ---- test obstacles (old units)
export const TEST_BLOCKS = [
  { x: 0, z: -180, hw: 120, hd: 40, h: 60, c: 0x80584a },
  { x: -240, z: 60, hw: 50, hd: 50, h: 24, c: 0x947048 },
  { x: -340, z: 60, hw: 50, hd: 50, h: 48, c: 0x707882 },
  { x: 240, z: 120, hw: 70, hd: 70, h: 90, c: 0x626a76 },
  // wall-run corridor: two tall parallel walls 170 apart (centre to centre), 440 long, 220 high.
  // The wall ray sits 36 above the feet, so wall-running needs walls taller than the jump arc (the blocks above are too low).
  { x: 450, z: -250, hw: 12, hd: 220, h: 220, c: 0x5b6b7c },
  { x: 620, z: -250, hw: 12, hd: 220, h: 220, c: 0x6b5b7c },
];
