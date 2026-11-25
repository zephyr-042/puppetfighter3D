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

// ---- progressive momentum run (runT): ground speed ramps min -> max over rampT seconds of clean running
export const RUN = {
  min: 210,            // old units / s at runT = 0
  max: 400,            // old units / s once runT >= rampT
  rampT: 1.25,         // seconds of clean running to reach max
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
  airAccel: 3,         // how fast velocity chases the wanted velocity in the air (ground uses MOVE.accel = 9)
};

// ---- crouch-slide (old units)
export const SLIDE = {
  height: 40,          // capsule height while sliding (40 units = 1.0 m; standing is PUPPET.height = 72 = 1.8 m)
  entryBoost: 1.2,     // speed multiplier on entering a slide while moving faster than minSpeed
  maxEntrySpeed: 460,  // the boost never pushes you above this (a faster entry speed is kept, not reduced)
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
];
