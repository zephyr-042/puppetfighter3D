# Puppet Fighter 3D - architecture

Browser-only 3D rewrite of the 2.5D `puppetfighter`. Vite + Three.js + Rapier3D (WASM). Static hosting, no servers.
The old game stays live in its own repo; this is a separate project.

## File map (one line per file; each file's header says what it loads after)

```
index.html                 Page shell, loads src/main.js as a module.
package.json               Dependencies (three, @dimforge/rapier3d-compat) and vite scripts.
src/config.js              Every tunable number, in OLD 2.5D units. SCALE converts to metres at the point of use.
src/game/maps.js           Map data (DISTRICT_MAP: boxes, pillars, holes, ramps, spawns) + shared floorSlabs() / rampSpan() geometry helpers.
src/input.js                Keyboard state and the per-tick input snapshot (wanted direction, jump edge, dash edge, slide held; grab to follow).
src/physics/player.js      Movement rules as stepPlayer(state, input, ctx): momentum run, jump, double jump, air-strafe, b-hop, crouch-slide, dash, wall-run, wall-kick; pillar orbit to follow.
src/physics/world.js       Rapier world built from the map (floor slabs, boxes, pillars, ramp wedges, all in WALL_GROUP), kinematic capsule + character controller, rays, detectWall, groundGap, teleportPlayer, hasFallen.
src/render/scene.js        Three.js renderer, lights, the District meshes (slabs + rim trims, boxes, pillars, ramps), city backdrop, placeholder capsule puppet (setPuppetHeight squashes it, setFocus moves the sun).
src/render/camera.js       Mouse-orbit chase camera (PointerLock) with a Rapier raycast boom.
src/main.js                Boot, spawn / fall respawn / R, fixed 60 Hz tick decoupled from the render loop. Loads LAST.
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
| 3 | Maps: District wired in (colliders, meshes, spawns, fall respawn); the other maps one at a time | in progress (District done, see Step 3 progress) |
| 4 | Tag rules, scoring, rounds, dummies, HUD | |
| 5 | Procedural 3D puppet, cosmetic ragdoll on stun / fall | |
| 6 | Supabase lobby + WebRTC host / guest netcode | |

## Step 1 notes

- Movement started as a placeholder: camera-relative WASD, velocity chasing a wanted velocity, gravity, autostep.
- The Step 1 test floor and `TEST_BLOCKS` are gone: `DISTRICT_MAP` (game/maps.js) replaced them in Step 3.
- Run: `npm install` then `npm run dev`. Build: `npm run build` (output in `dist/`).

## Step 2 progress (movement verbs, one at a time)

| Verb | Status |
|------|--------|
| Progressive momentum run (`runT`) | done |
| Jump (buffer, coyote time, heavier fall) | done |
| Crouch-slide (+ capsule squash, low camera) | done |
| Solid blocks (one Rapier cuboid per map box; was the test gym, now the District map) | done |
| Quake-style air-strafe + b-hop (no speed cap) | done |
| Dash (F) | done |
| Speed FOV warp | done |
| Double jump | done |
| Wall-run + wall-kick (+ camera roll) | done |
| Orbital pillar grab | |
| Squash + tether visuals | |

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
- **Run cap:** `RUN` is now `min 210 -> max 310` over `rampT 1.0 s`. Holding W only ever reaches 310; every higher speed is earned
  with air-strafing, b-hops or the dash. Speed above the cap on the ground bleeds back toward it (velocity chases the wanted velocity).
- **Air-strafe (`airAccelerate` in player.js):** Quake / Source style. No horizontal drag in the air. Each tick the wish direction adds
  `min(airWishCap - speedAlongWish, airAccel * runSpeed * dt)` (only when positive). Flying straight adds nothing; a wish direction
  sideways to the velocity, followed by turning the camera, keeps adding speed with no upper limit. Tune the gain with `JUMP.airWishCap`
  (bigger = faster gain) and `JUMP.airAccel`.
- **B-hop (`BHOP` in config.js):** a landing (needs `minAir` 0.05 s in the air, which filters Rapier's one-tick grounded flicker on flat
  ground) opens a `window` of 0.14 s with no friction and no run-speed clamp (slides keep their speed too). Jumping inside the window
  (jump buffer counts) adds `bonus` 25 units / s along the wish direction (ceiling `maxSpeed` 850 for the BONUS only, a faster speed is
  never reduced) and increments `bhopChain`. Letting the window expire, or hitting a wall, resets the chain and speed bleeds to the run cap.
  Blocked horizontal motion (walls) also removes the blocked speed, so uncapped air speed cannot pile up against a wall.
- **Dash (`DASH`, key F):** `input.js` latches F like Space. The dash locks the held direction (or facing) for `duration` 0.2 s at
  `max(speed, current speed)`, with light gravity (`airGrav`), keeps `runT`, cancels a slide, and has a 1.3 s `cooldown`. A jump cancels
  the lock but keeps the speed, so dash -> jump -> b-hop chains work.
- **Double jump (`JUMP.doubleJumpImpulse / maxAirJumps / doubleJumpDir`):** `airJumpsLeft` is refilled whenever grounded and whenever a
  wall is caught. A Space press in the air AFTER coyote time spends one: `vy = 320`, plus a 70 units / s push toward the held keys;
  if that would lower the horizontal speed it is scaled back up, and the air-strafe step is skipped on that tick, so a snap-turn
  never brakes. A press made while the ground is less than `JUMP.buffer` seconds away (falling) is NOT an air jump: it stays in the
  buffer and becomes the landing b-hop (`landingSoon` / `groundGap`). This keeps b-hop chains intact.
- **Wall-run (`WALLRUN`, `detectWall` in world.js):** `detectWall(ctx, yaw)` casts a horizontal ray to each side at `feet + WALLRUN.torso`
  (reach = radius + `detectDist`) against `WALL_GROUP` colliders only (the floor and every block are members; the player is not).
  `yaw` is the travel direction, forward = (sin, cos). A wall is caught when ALL hold: in the air for at least `minAir`, W held (`input.fwd`),
  horizontal speed above `minSpeed`, not dashing, at least `minTangent` of the speed runs along the wall (head-on hits do not stick), and it
  is not the wall just kicked off while `regrabTimer > 0`. While caught: velocity is aimed along the wall tangent at `max(speed, holdSpeed)`
  (b-hop speed kept) with a small `stick` push into the wall, gravity is `wallGrav`, fall speed is clamped to `maxFall`, the air jump is
  refilled, and sliding / air-strafe are off. Releasing W, running out of wall, landing or dashing ends it.
- **Wall-kick:** Space while wall-running: `vy = kickUp`, velocity = tangent * (speed + `kickFwd`) + normal * `kickOut`, `regrabTimer = regrabCd`
  (0.25 s) and `lastWallN` = that wall, so the same wall cannot be caught again straight away; chain to a different wall instead. The b-hop
  chain count is left alone, and normal air-strafing continues from the next tick.
- **Camera roll:** `updateCamera(..., wallSide)` eases `rig.roll` to `wallSide * camTilt` and applies it with `camera.rotateZ` after `lookAt`
  (leans away from the wall). HUD shows `AIRJ n`, `WALLRUN`, and `regrab` seconds.
- **Wall height:** the wall ray sits `torso` (36) above the feet, so a wall must be taller than the jump arc to be run along. The 175-high
  Maze Alley brick walls are the main wall-run spot (east face of `box(-560, -660)` is x = -500, z -780..-540).
- **Speed FOV (`CAM.fovWarp*`):** `updateCamera(..., speed)` eases the FOV up to +15 degrees between 300 and 750 units / s.
- **HUD:** `spd`, `runT`, `BHOP` (chain count, `(window)` while open), `DASH` (ready / GO / cooldown seconds), `SLIDE`.
- **Visuals:** `state.height` drives the mesh squash (`setPuppetHeight`) and the camera pivot (scaled by height / standing
  height), so the view drops smoothly with the body.

## Step 3 progress (maps)

| Item | Status |
|------|--------|
| District colliders: floor slabs around the 3 skylights, 42 boxes, 13 pillars, 3 ramp wedges | done |
| District meshes: slabs (world-aligned grid), rim trims, boxes, pillars, ramps, building shaft + skyline | done |
| Spawn at `DISTRICT_MAP.spawns`, respawn below -12 m, `R` | done |
| Arena, Large, Roof, Complex maps | |

- **Shared geometry (`game/maps.js`):** `floorSlabs(map)` cuts the roof rect into non-overlapping slabs around the holes (12 slabs for District; slabs +
  holes = the rect exactly). `rampSpan(ramp)` gives the low / high edge, width and rotation of a ramp. world.js and scene.js both build from these.
- **Colliders (world.js):** every static piece is in `WALL_GROUP` (floor slabs, boxes, cylinders for pillars, ramps), so `detectWall`, `groundGap` and the
  camera boom all see the same geometry. A skylight hole is simply no collider there, so the player falls through.
- **Ramps are solid wedges** (a convex hull of the edge profile), not tilted slabs: nothing hollow under them to slide into. Slopes 14.4 / 20.0 / 20.8 degrees.
  A near-horizontal wall ray never counts a ramp surface as a wall (the normal filter rejects slopes under 30 degrees from horizontal).
- **Slope handling in player.js (needed once ramps existed):**
  1. The "blocked" velocity clamp is skipped when the controller climbed on its own (`vy <= 0` but `c.y > 0`): on a slope the controller turns part of the
     horizontal move into height, and clamping that every tick bled speed (310 -> ~130 on ramp 3).
  2. Ground stick: while on a surface the move also asks for `MOVE.stick` (8 units) extra downward travel so the puppet stays glued when the surface falls away
     (ramp crest, small drop). Skipped the tick after a climb (pressing into a slope only costs climb), and the first 2 airborne ticks after leaving a surface still
     count as on it. Rapier's own snap-to-ground did not hold on a crest.
- **Falling:** `hasFallen(ctx)` = feet below `MAP.fallY` (-480 units = -12 m). `main.js` then respawns at the spawn point. `R` also respawns. `teleportPlayer`
  restores the standing capsule (a slide shrinks it) and resets all movement state (`createPlayerState`).
- **Spawn selection:** `MAP.spawn` (default 0) or `?spawn=N` in the page URL (0-5), e.g. `?spawn=2` drops you beside Maze Alley. Faces the middle of the roof.
- **Rendering notes:** floor slabs share one grid texture with world-aligned offsets (5 m tiles) so lines run straight across slab seams; rim trims are visual
  only (a 14-unit coping strip on the roof edge and around each hole); the roof sits on a 200 m dark facade shaft so skylights look into a drop; ~90 seeded dark
  towers form the skyline; the sun and its 4096 shadow map follow the player (`setFocus`).
