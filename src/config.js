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

// ---- Step 1 movement (flat run only; the full verb set comes in Step 3)
export const MOVE = {
  speed: 400,          // old units / s, top run speed
  accel: 9,            // how fast velocity chases the wanted velocity (old: k = dt * 9)
  gravity: 900,        // old units / s^2
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
