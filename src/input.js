// src/input.js
// INPUT: keyboard state and the per-tick input snapshot the simulation reads.
// Loads after: nothing (the camera forward vector is passed in, so input never imports the camera).

const keys = {};
let jumpQueued = false;                              // latched on key press, consumed by the next tick (no press is ever lost)
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jumpQueued = true; }
  keys[e.code] = true;
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; jumpQueued = false; });

// Snapshot for one tick. `f` = camera forward on the ground ({x, z}, unit length).
// jump: true on the tick after Space was pressed (edge, not held). slide: Shift is held.
// ax, az: wanted horizontal direction in world space (unit length, or 0 when no key is held).
export function readInput(f) {
  const rx = -f.z, rz = f.x;                          // right = forward rotated 90 degrees
  let ax = 0, az = 0;
  if (keys.KeyW) { ax += f.x; az += f.z; }
  if (keys.KeyS) { ax -= f.x; az -= f.z; }
  if (keys.KeyD) { ax += rx;  az += rz; }
  if (keys.KeyA) { ax -= rx;  az -= rz; }
  const l = Math.hypot(ax, az);
  if (l > 0) { ax /= l; az /= l; }
  const jump = jumpQueued; jumpQueued = false;
  const slide = !!(keys.ShiftLeft || keys.ShiftRight);   // held, not an edge
  return { ax, az, moving: l > 0, jump, slide };
}
