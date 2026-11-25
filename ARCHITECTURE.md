# Puppet Fighter 3D - architecture

Browser-only 3D rewrite of the 2.5D `puppetfighter`. Vite + Three.js + Rapier3D (WASM). Static hosting, no servers.
The old game stays live in its own repo; this is a separate project.

## File map (one line per file; each file's header says what it loads after)

```
index.html                 Page shell, loads src/main.js as a module.
package.json               Dependencies (three, @dimforge/rapier3d-compat) and vite scripts.
src/config.js              Every tunable number, in OLD 2.5D units. SCALE converts to metres at the point of use.
src/input.js                Keyboard state and the per-tick input snapshot (wanted direction, jump edge, slide held; dash / grab to follow).
src/physics/player.js      Movement rules as stepPlayer(state, input, ctx): momentum run, jump, crouch-slide now; dash, pillar orbit to follow.
src/physics/world.js       Rapier world, static test floor + blocks, kinematic capsule + character controller, static raycast.
src/render/scene.js        Three.js renderer, lights, floor / blocks meshes, placeholder capsule puppet (setPuppetHeight squashes it).
src/render/camera.js       Mouse-orbit chase camera (PointerLock) with a Rapier raycast boom.
src/main.js                Boot, fixed 60 Hz tick decoupled from the render loop. Loads LAST.
```

## Rules

- **Scale:** `SCALE = 0.025`. 1 old unit = 0.025 m, so the 72-unit puppet is 1.8 m. Numbers are stored in old units in
  `config.js` and multiplied by `SCALE` where they are used (`m()` helper). Retune there, never in logic.
- **Fixed step:** simulation runs at `STEP = 1/60` with an accumulator in `main.js`. Rendering runs on `requestAnimationFrame`.
- **Gameplay movement is kinematic:** a single capsule moved by our own velocity code; Rapier's
  `KinematicCharacterController` only resolves collisions (slopes, steps). Gravity is applied by us, not by Rapier.
- **Camera is view-only:** yaw / pitch live in the camera rig and never enter the simulation state.
- **Physics code stays a pure function of (state, input)** where possible, so guest prediction can replay it later.

## Migration plan

| Step | Focus | Status |
|------|-------|--------|
| 1 | Foundation: Vite + Three + Rapier, test floor, kinematic capsule with WASD, orbit chase camera with raycast boom | done |
| 2 | Movement verbs from the old physics.js, one at a time (see Step 2 progress). Plan changed: movement before maps | in progress |
| 3 | Maps: Roof first plus one ramp, then the other maps one at a time | |
| 4 | Tag rules, scoring, rounds, dummies, HUD | |
| 5 | Procedural 3D puppet, cosmetic ragdoll on stun / fall | |
| 6 | Supabase lobby + WebRTC host / guest netcode | |

## Step 1 notes

- Movement started as a placeholder: camera-relative WASD, velocity chasing a wanted velocity, gravity, autostep.
- `TEST_BLOCKS` in `config.js` (a two-step staircase, a tall wall, a crate) exists only to test step-up and the camera boom.
  Step 3 (maps) replaces it with real map data.
- Run: `npm install` then `npm run dev`. Build: `npm run build` (output in `dist/`).

## Step 2 progress (movement verbs, one at a time)

| Verb | Status |
|------|--------|
| Progressive momentum run (`runT`) | done |
| Jump (buffer, coyote time, heavier fall) | done |
| Crouch-slide (+ capsule squash, low camera) | done |
| Dash | |
| Orbital pillar grab | |
| Speed FOV warp, squash + tether visuals | |

- `src/physics/player.js` holds `stepPlayer(state, input, ctx)`. State speeds are in metres / s; config numbers stay in old units.
- **runT:** `RUN` in `config.js`. Speed goes `min -> max` over `rampT` seconds of clean ground running (x`itBonus` when IT).
  Held in the air (so jumps, slides, dashes and flings keep it), drains at `stopDecay` with no input on the ground and at
  `wallDecay` while pressed against a wall (moved distance < `wallRatio` of the wanted distance).
- The yellow HUD line (top left) shows live speed in old units and runT, for tuning.
- **Jump:** `JUMP` in `config.js` (impulse 350, buffer 0.12 s, coyote 0.10 s, gravRise 850, gravFall 1100, airAccel 3).
  Space is latched on key press in `input.js` and consumed by the next tick, so a press is never lost between frames.
  A jump fires when `jumpBuf > 0` and `coyote > 0`; both are zeroed on takeoff, so there is no double jump. Gravity is
  `gravRise` while `vy > 0` and `gravFall` after. In the air, held keys steer toward the wanted velocity at `airAccel`
  (ground uses `MOVE.accel`); with no keys the air momentum is kept. A ceiling bonk zeroes `vy`.
- `movePlayer` disables Rapier's snap-to-ground on any upward move, so a jump is never pulled back to the floor.
- Apex height = `impulse^2 / (2 * gravRise)` = 72 units (one puppet tall). Tune jump height with `impulse` / `gravRise`.
- **Slide:** `SLIDE` in `config.js` (height 40, entryBoost 1.2, maxEntrySpeed 460, friction 0.55 per second, steerAccel 90,
  minSpeed 60, resize 14). Shift held on the ground enters a slide; above `minSpeed` the entry speed is multiplied by
  `entryBoost` but never pushed past `maxEntrySpeed` (a faster entry is kept as is). While sliding, horizontal speed is
  multiplied by `friction^dt` per tick and held keys steer by `steerAccel` without ever adding speed (steering can still
  creep up to `minSpeed` from a standstill, so a slide never traps you). `runT` is held, not grown or drained, so the
  momentum comes back when you stand up. The slide ends on Shift release, on a jump, or when airborne past coyote time.
- **Capsule resize:** `movePlayer(..., newHeight)` changes the collider half-height and shifts the capsule centre by half
  the change so the FEET stay put; the shape change and the new position reach Rapier in the same world step. Height
  eases at `SLIDE.resize`. Standing up first calls `hasHeadroom(ctx, standingHeight)` (a slightly smaller test capsule
  against static geometry); under a low ceiling the puppet stays crouched until there is room.
- **Visuals:** `state.height` drives the mesh squash (`setPuppetHeight`) and the camera pivot (scaled by height / standing
  height), so the view drops smoothly with the body.
