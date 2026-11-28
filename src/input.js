// src/input.js
// INPUT: keyboard / mouse state and the per-tick input snapshot the simulation reads.
// Bindings (Slice M2):  Left-Click = melee slash (`attack`), Right-Click = parry / block (`parry`, single-press edge), both only while the pointer is locked.
// Grapple (`grapple`, held) = E or a mouse side button (button 3 / 4): Right-Click no longer grapples. Dash / Phase-Dodge (`dash`, edge) = Q or F.
// Loads after: nothing (the camera forward vector is passed in, so input never imports the camera).

const keys = {};
let jumpQueued = false;                              // latched on key press, consumed by the next tick (no press is ever lost)
let dashQueued = false;                              // same latch for the dash (Q / F)
let attackQueued = false;                            // same latch for Left-Click (melee)
let parryQueued = false;                             // same latch for Right-Click (parry / block)
let grappleMouse = false;                            // mouse side button (3 / 4) held

// Typing in the join overlay (name field) must not feed the game or swallow Space.
const typing = (e) => { const t = e.target; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
const isSide = (b) => b === 3 || b === 4;

window.addEventListener('keydown', (e) => {
  if (typing(e)) return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jumpQueued = true; }
  if ((e.code === 'KeyF' || e.code === 'KeyQ') && !e.repeat) dashQueued = true;
  keys[e.code] = true;
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });   // always release, even while typing, so nothing sticks
window.addEventListener('mousedown', (e) => {
  if (isSide(e.button)) { grappleMouse = true; if (document.pointerLockElement) e.preventDefault(); }          // grapple: side button (held); no browser back / forward while playing
  else if (e.button === 0 && document.pointerLockElement) attackQueued = true;                                  // melee: left mouse, only while playing
  else if (e.button === 2 && document.pointerLockElement) parryQueued = true;                                   // parry / block: right mouse, only while playing
});
window.addEventListener('mouseup', (e) => {
  if (isSide(e.button)) { grappleMouse = false; if (document.pointerLockElement) e.preventDefault(); }
});
window.addEventListener('auxclick', (e) => { if (isSide(e.button) && document.pointerLockElement) e.preventDefault(); });
window.addEventListener('contextmenu', (e) => { if (e.target && e.target.tagName === 'CANVAS') e.preventDefault(); });   // no browser menu on the game canvas
window.addEventListener('blur', () => { clearInput(true); });

// Drop every pending edge (jump / dash / attack / parry). With `all`, also forget held keys and the mouse side button.
export function clearInput(all = false) {
  jumpQueued = false; dashQueued = false; attackQueued = false; parryQueued = false;
  if (all) { for (const k in keys) keys[k] = false; grappleMouse = false; }
}

// Snapshot for one tick. `f` = camera forward on the ground ({x, z}, unit length).
// jump / dash / attack / parry: true on the tick after Space / Q or F / Left-Click / Right-Click was pressed (edge, not held). slide: Shift is held. fwd: W is held.
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
  const attack = attackQueued; attackQueued = false;
  const parry = parryQueued; parryQueued = false;
  const slide = !!(keys.ShiftLeft || keys.ShiftRight);   // held, not an edge
  const fwd = !!keys.KeyW;                               // forward held (wall-running needs it)
  const grapple = !!(keys.KeyE || grappleMouse);         // held (E or a mouse side button); player.js fires on the press edge
  return { ax, az, moving: l > 0, fwd, jump, dash, slide, grapple, attack, parry };
}
