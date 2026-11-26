// src/input.js
// INPUT: keyboard state and the per-tick input snapshot the simulation reads.
// Loads after: nothing (the camera forward vector is passed in, so input never imports the camera).

const keys = {};
let jumpQueued = false;                              // latched on key press, consumed by the next tick (no press is ever lost)
let dashQueued = false;                              // same latch for the dash (F)
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jumpQueued = true; }
  if (e.code === 'KeyF' && !e.repeat) dashQueued = true;
  keys[e.code] = true;
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
let grappleRight = false, grappleLeft = false;       // right mouse (always) / left mouse (only while the pointer is locked) held
window.addEventListener('mousedown', (e) => {
  if (e.button === 2) grappleRight = true;
  // Left click fires the grapple only once the pointer is locked: the click that LOCKS the pointer arrives while it is still
  // unlocked, so it never fires a stray grapple.
  else if (e.button === 0 && document.pointerLockElement) grappleLeft = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 2) grappleRight = false; else if (e.button === 0) grappleLeft = false; });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) grappleLeft = false; });   // Esc: no stuck hook button
window.addEventListener('contextmenu', (e) => { if (e.target && e.target.tagName === 'CANVAS') e.preventDefault(); });   // no browser menu on the game canvas
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; jumpQueued = false; dashQueued = false; grappleRight = grappleLeft = false; });

// Snapshot for one tick. `f` = camera forward on the ground ({x, z}, unit length).
// jump / dash: true on the tick after Space / F was pressed (edge, not held). slide: Shift is held. fwd: W is held.
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
  const dash = dashQueued; dashQueued = false;
  const slide = !!(keys.ShiftLeft || keys.ShiftRight);   // held, not an edge
  const fwd = !!keys.KeyW;                               // forward held (wall-running needs it)
  const grapple = !!(keys.KeyE || grappleRight || grappleLeft);   // held (E, right mouse, or left mouse while pointer-locked); player.js fires on the press edge
  return { ax, az, moving: l > 0, fwd, jump, dash, slide, grapple };
}
