# Puppet Fighter 3D - architecture

Browser 3D rewrite of the 2.5D `puppetfighter`, now a **dedicated multiplayer game**: Vite + Three.js + Rapier3D (WASM) client, Node.js + Express + Socket.IO server (Render.com).
Client-authoritative movement: every player simulates their own Titanfall 2 style movement locally at 60 Hz (0 ms movement lag) and the server relays 30 Hz state.
The old game stays live in its own repo; this is a separate project. The old local tag mode (bots, tag rules, rounds, sandbox) is gone.

## File map (one line per file; each file's header says what it loads after)

```
index.html                 Join overlay (name, colour, Play, controls), minimal HUD (speed line, player count + ping, crosshair, toast, Tab scoreboard), loads src/main.js as a module.
package.json               Dependencies (three, rapier, socket.io-client, vite for the client; express, socket.io for the server), `start` = node server.js.
server.js                  Express (serves dist/) + Socket.IO room: join / init, timeSync, ping, volatile state in, 30 Hz snapshot out, respawn, disconnect. Imports spawns from src/game/maps.js.
src/config.js              Every tunable number, in OLD 2.5D units. SCALE converts to metres at the point of use. Includes the feel blocks `MANTLE` (ledge mantle) and `LAND` (landing camera dip).        (unchanged)
src/game/maps.js           Map data (DISTRICT_MAP "Glitch" parkour arena) + boxSpan() / floorSlabs() / rampSpan() helpers + validateMap(). Pure data: imported by BOTH client and server.      (unchanged)
src/input.js               Keyboard / mouse state and the per-tick input snapshot (direction, jump / dash edges, slide held, grapple held = Right-Click or E; Left-Click latched as `attack` for Step 2 melee).
src/physics/player.js      Movement rules as stepPlayer(state, input, ctx): momentum run, jump, double jump, air-strafe, b-hop, crouch-slide, dash, wall-run, wall-kick, grapple, ledge mantle, look-steering, `state.sfx`.   (unchanged)
src/physics/ragdoll.js     On-demand cosmetic 6-part Rapier ragdoll (spawnRagdoll / syncRagdollMeshes / despawnRagdoll).      (unchanged)
src/physics/world.js       Rapier world built from the map, one kinematic capsule per local player view, rays, detectWall, groundGap, placePlayer, hasFallen, raycastGrapple, checkLedgeMantle, hasHeadroom.      (unchanged)
src/render/scene.js        Three.js renderer, lights, District meshes, per-player puppets, grapple tethers (`setGrapple(slot, torso, anchor)`), setFocus.      (unchanged)
src/render/camera.js       Mouse-orbit chase camera (PointerLock) with a Rapier raycast boom, landing dip.      (unchanged)
src/main.js                Boot, socket client, YOUR 60 Hz tick (stepPlayer / stepWorld), 30 Hz 'state' send, remote players (smoothed puppets, tethers, ragdolls), fall / R respawn flow, join overlay, HUD, Tab scoreboard, `createAudio()` (zero-asset Web Audio synth). Loads LAST.
src/game/state.js          UNUSED since the tag mode was removed (plain-data match state). Safe to delete.
src/game/rules.js          UNUSED since the tag mode was removed (tag rules). Safe to delete.
```

## Rules

- **Scale:** `SCALE = 0.025`. 1 old unit = 0.025 m, so the 72-unit puppet is 1.8 m. Numbers are stored in old units in
  `config.js` and multiplied by `SCALE` where they are used (`m()` helper). Retune there, never in logic. The server uses the same constant for the spawns; everything on the wire is in METRES.
- **Fixed step:** your simulation runs at `STEP = 1/60` with an accumulator in `main.js`. Rendering runs on `requestAnimationFrame`.
- **Gameplay movement is kinematic:** a single capsule moved by our own velocity code; Rapier's
  `KinematicCharacterController` only resolves collisions (slopes, steps). Gravity is applied by us, not by Rapier.
- **Camera is view-only:** yaw / pitch live in the camera rig and never enter the simulation state.
- **Physics code stays a pure function of (state, input)** where possible.
- **Client-authoritative:** the server never simulates movement. It sanity-clamps what a client sends and relays it. (Cheating is possible by design for this stage; melee hits will need a decision, see Step 6 notes.)
- **Rendering budget:** District must hold 60+ FPS. No background geometry (no skyline / facade / street, only the sky gradient), sun shadow map 1024 x 1024,
  floor slabs and trims never cast shadows (they only receive), one shared geometry per puppet part, camera far plane 400 m. Do not add decorative geometry without checking FPS.

## Migration plan

| Step | Focus | Status |
|------|-------|--------|
| 1 | Foundation: Vite + Three + Rapier, test floor, kinematic capsule with WASD, orbit chase camera with raycast boom | done |
| 2 | Movement verbs from the old physics.js, one at a time (see Step 2 progress). Plan changed: movement before maps | in progress |
| 3 | Maps: District wired in (colliders, meshes, spawns, fall respawn); the other maps one at a time | in progress (District done, see Step 3 progress) |
| 4-5 | Local tag rules, bots, HUD, cosmetic ragdolls | superseded: tag mode and bots removed; the cosmetic ragdoll stays (Step 6) |
| 6 | Dedicated Node.js + Socket.IO server, join overlay, 30 Hz client-authoritative netcode, smoothed remote players, ragdoll respawn | done (see Step 6) |
| next | Melee slash (Left-Click), KOs, hit validation | |

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
| Grapple / sticky hand (hold E or right mouse) | done (see Step 2.6 notes) |
| Ledge mantle / vault, forgiving slide-hop window, look-steering, landing dip, procedural audio | done (see Step 2.7) |
| Orbital pillar grab | |
| Squash + tether visuals | |

- `src/physics/player.js` holds `stepPlayer(state, input, ctx)`. State speeds are in metres / s; config numbers stay in old units.
- **runT:** `RUN` in `config.js`. Speed goes `min -> max` over `rampT` seconds of clean ground running (x`itBonus` when IT).
  Held in the air (so jumps, slides, dashes and flings keep it), drains at `stopDecay` with no input on the ground and at
  `wallDecay` while pressed against a wall (moved distance < `wallRatio` of the wanted distance).
- The yellow HUD line (top left) shows live speed in old units and runT, for tuning (plus `slideboost ready / cooldown`).
- **Jump:** `JUMP` in `config.js` (impulse 350, buffer 0.12 s, coyote 0.10 s, gravRise 850, gravFall 1100, airAccel 3).
  Space is latched on key press in `input.js` and consumed by the next tick, so a press is never lost between frames.
  A jump fires when `jumpBuf > 0` and `coyote > 0`; both are zeroed on takeoff, so there is no double jump. Gravity is
  `gravRise` while `vy > 0` and `gravFall` after. In the air, held keys steer toward the wanted velocity at `airAccel`
  (ground uses `MOVE.accel`); with no keys the air momentum is kept. A ceiling bonk zeroes `vy`.
- `movePlayer` disables Rapier's snap-to-ground on any upward move, so a jump is never pulled back to the floor.
- Apex height = `impulse^2 / (2 * gravRise)` = 72 units (one puppet tall). Tune jump height with `impulse` / `gravRise`.
- **Slide (Titanfall 2 flow):** `SLIDE` in `config.js` (height 40, friction 0.91, steerAccel 240, boostAdd 115, maxBoostSpeed 680, boostCd 0.75,
  slopeAccel 650, minSpeed 60, resize 14). The slide is meant to ACCELERATE combos, not brake them:
  - **Entry boost:** Shift held on the ground enters a slide. If `slideBoostCd <= 0`, `SLIDE.boostAdd` is ADDED to the horizontal speed along the
    velocity (along the facing when slower than `minSpeed`), but never past `maxBoostSpeed`; a speed already above 680 (b-hop / dash / ramp speed) is
    kept as is. A boost that fired starts `boostCd` 0.75 s (`state.slideBoostCd`), so tapping Shift from a standstill cannot be spammed. Entering
    with the cooldown running keeps the speed, no boost.
  - **Glide + carve:** horizontal speed is multiplied by `friction^dt` (0.91 / s, so a slide carries far) and held keys steer by `steerAccel` (240) without
    ever adding speed (steering can still creep up to `minSpeed` from a standstill, so a slide never traps you). `runT` is held, not grown or drained.
  - **Downhill:** after the move, while `sliding && grounded && c.y < -1e-4` (the controller moved the capsule DOWN) `slopeAccel * STEP` is added along the
    slide direction. A second guard (`-c.y > 2 %` of the horizontal travel) ignores the micro-jitter of the ground stick on flat floors. Equilibrium on the
    16 degree speed ramps is far above the b-hop cap, so a ramp slide rockets you into a b-hop.
  - **Slide-hop:** hold Shift and tap Space. A jump / launch clears `sliding` on the same tick (the capsule stands back up in the air), the landing
    re-enters the slide at once while Shift is still held, and inside the `BHOP.window` that slide has no friction; Space there jumps out with the b-hop bonus
    and `bhopChain` + 1. A jump press buffered just before touchdown fires on the landing tick (before the slide entry), so nothing is lost.
  - The slide ends on Shift release, a jump / dash / launch, or when airborne past coyote time.
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
  ground) opens a `window` of 0.22 s with no friction and no run-speed clamp (slides keep their speed too). Jumping inside the window
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
- **Wall height:** the wall ray sits `torso` (36) above the feet, so a wall must be taller than the jump arc to be run along. The 230-high
  cyan gauntlet panels (north / south) and the orange billboards over the pit are the main wall-run spots.
- **Speed FOV (`CAM.fovWarp*`):** `updateCamera(..., speed)` eases the FOV up to +15 degrees between 300 and 750 units / s.
- **HUD:** `spd`, `runT`, `BHOP` (chain count, `(window)` while open), `DASH` (ready / GO / cooldown seconds), `SLIDE`.
- **Visuals:** `state.height` drives the mesh squash (`setPuppetHeight`) and the camera pivot (scaled by height / standing
  height), so the view drops smoothly with the body.

## Step 2.7 notes (flow feel: mantle, forgiving slide-hops, look-steering, landing weight, procedural audio)

Small mechanics that join the verbs together so a route never stops on a lip or a mistimed key. Nothing here adds speed except what is said.

- **Ledge mantle / vault (`MANTLE` in config.js, `checkLedgeMantle` in world.js, the block after `movePlayer` in `stepPlayer`).** Triggers when ALL hold: not grounded, not wall-running,
  moving forward (`want` above `MANTLE.minSpeed` 60 units / s per tick) and blocked (`got < want * 0.7`). `checkLedgeMantle(ctx, dirX, dirZ)` then casts ONE downward ray against
  `WALL_GROUP` at `PUPPET.radius + 12` units ahead of the body centre, from `feet + 48` down to `feet + 12` (`castRayAndGetNormal`, solid). A ledge counts when the ray hits an upward-facing surface
  (`normal.y >= 0.7`) inside that range, and `hasHeadroom(ctx, standingHeight, { x, y: top, z })` is clear at the ledge top (`hasHeadroom` gained an optional feet position). A wall taller than
  48 units starts the ray INSIDE its collider, which a solid cast reports at distance 0 with no normal, so it is rejected (that is a wall, not a ledge). On a hit: `vy = max(vy, 180 units / s, what clears the lip)`
  (`sqrt(2 * gravRise * (rise + 3 units)) * 1.08`, since 180 alone only rises about 19 units), the blocked-speed clamp is skipped so the HORIZONTAL velocity is left exactly as it was (100 % kept),
  `wallHit` is not set (no `runT` bleed, no b-hop reset), and a `MANTLE.window` of 0.18 s starts. During the window the move also carries `MANTLE.forward` (1.5 units per tick) of extra forward DISPLACEMENT
  (no velocity) so the capsule slides over the lip as soon as it clears it. When the feet rise to within 12 units of the lip it drops out of the probe's range while still blocked, so while the window is
  open a blocked airborne tick keeps climbing (`vy >= 180`) with the speed untouched. Grounded players are not handled here: autostep covers 24 units, a jump covers the rest and then mantles.
- **Slide-hop forgiveness:** `BHOP.window` 0.14 -> 0.22 s and `SLIDE.friction` 0.84 -> 0.91 per second, so a casual Shift + Space chain keeps its momentum without frame-perfect timing.
- **Look-steering (`airAccelerate(..., carve)`):** the air carve (a pure rotation of `(vx, vz)` toward the wish direction, `JUMP.airTurnRate` 2.6 / s, magnitude preserved) now runs only while W (`input.fwd`) is
  held, in the air and while hooked; strafing with A / D alone keeps pure Quake air-strafing. (`airTurnRate` already existed at 2.2 and carved on any movement key; it is now 2.6 and W-only.)
- **Landing dip (`LAND` in config.js, `triggerLandDip(rig, impactVy)` in camera.js):** main.js calls it for the human on the tick a fall touches down (was airborne, now grounded, `vy < 0`; only
  `vy < -4 m / s` counts). The camera pivot dips up to `LAND.dip` 0.15 m (less for a softer landing; a softer one never cuts a harder one short) and rebounds smoothly over `LAND.time` 0.2 s
  (fast ease down for the first quarter, cosine ease back). Eased in `updateCamera`, view only.
- **Procedural audio (`createAudio()` in main.js, no files):** the `AudioContext` is created and resumed by the first `pointerdown` / `keydown`; until then every call is a no-op. `[M]` mutes. One-shots are oscillator
  pitch sweeps and bandpass-swept noise bursts: jump (sine thump 210 -> 80 Hz), air jump (thump + rising chirp), wall-kick (thump + chirp + noise tick), wall-run attach (low sine click),
  dash (fast noise whoosh), grapple fire (whoosh + sawtooth / square metallic thwip, whether or not the shot hits). Two always-running noise loops only change gain / cutoff: slide hiss (bandpass, follows slide speed,
  only while sliding on the ground) and wind (lowpass, silent below 450 units / s, full at 850). Everything goes through a master gain and a compressor.
  `stepPlayer` fills `state.sfx` (`'jump' | 'airjump' | 'kick' | 'attach' | 'dash' | 'grapple'`, cleared at the start of each step); main.js plays your events right after the step. Remote players make no sound.
- **Not verified in a browser / with real Rapier.** `stepPlayer`'s mantle flow was exercised against a stub world (28 and 44 unit lips at 700 units / s: ends on top with the speed never below 700; a 60 unit wall does not
  mantle); the dip curve was checked numerically. The real ray / headroom / controller interplay and every sound's loudness and taste still need a play-test. Tune from `MANTLE`, `LAND` and the `SFX` table in `createAudio()`.

## Step 2.6 notes (grapple / sticky hand)

- **Input:** hold `E` or the right mouse button (`input.js`, `contextmenu` blocked on the canvas) -> `input.grapple`. `stepPlayer` fires on the press edge (`grapplePrev`).
- **Config:** `GRAPPLE` in `config.js` (maxRange 1120 = 28 m, playerRange 640 = 16 m, pullAccel 1450, maxPullSpeed 780, detachJumpBoost 180, cooldown 1.6, maxDuration 2.2,
  plus missCooldown 0.3, gravity 450, detachDist 72 = 1.8 m, hitStun 0.4, hitShove 220, aimPad 20, torso 0.6).
- **Shot (`raycastGrapple` in world.js):** a ray from the CAMERA eye along the camera look direction (`aimFromCamera` in main.js, so it goes through the crosshair). Static geometry is tested with a real Rapier ray
  (`WALL_GROUP`); every other capsule (never the owner, never a downed player) is tested analytically as a vertical segment with radius + `aimPad` (aim assist), limited to `playerRange`.
  The closest hit wins, so a wall in front of a player blocks the shot. Every capsule view now carries `all` (all capsule views) for this. A miss only costs `missCooldown`.
- **Hooked (`stepPlayer`, `grappleActive`):** each tick `pullAccel * dt` is added toward the anchor (measured from the torso), then ONLY the speed toward the anchor is capped at `maxPullSpeed`. Sideways speed is
  untouched, so aiming off-centre bends the path into a swing arc. Gravity is `GRAPPLE.gravity`, wall-run and slide are off, air-strafe still steers, the air jump is refilled every tick.
  On a player target `main.js` moves the anchor to their torso (`y + 0.9`) every tick; a downed target or a non-`play` mode releases the hook.
- **Release:** `input.grapple` let go, `maxDuration`, torso within `detachDist` of the anchor, a dash press, or Space. Space gives `vy = max(vy, detachJumpBoost)` and the press is consumed, so
  it neither air-jumps nor wall-kicks; the next tick is a normal air-strafe / wall-run tick. Every release starts `cooldown` (`endGrapple`). A locked (stunned / countdown) player releases at once.
- **Player snag (not wired in the multiplayer client, see Step 6):** reaching a player sets `grappleHit`; `main.js` (after `stepGameRules`) gives that player `stun = hitStun`, a horizontal shove away from the grappler (`max(hitShove, 0.6 * grappler speed)`) and ends their own hook.
  It works the same for IT (tag set-up) and runners (sabotage / escape). state.js / rules.js are untouched: it only writes the existing `stun`, `vx`, `vz` fields, which the existing knock / ragdoll code already reads.
- **Visuals / HUD:** `view.setGrapple(i, torso, anchor)` draws a thin glowing cylinder + hook ball per hooked player. The crosshair dot and the status line under it ("GRAPPLE READY" / cooldown seconds / "HOOKED")
  are created from `main.js` (`makeCrosshair`), so `index.html` did not change. The yellow tuning line also shows `GRAPPLE ready / GO / cooldown`.
- **Not done:** the tether is cosmetic (no rope collision); remote players cannot be hooked (they have no capsule in the multiplayer client).

## Step 3 progress (maps)

| Item | Status |
|------|--------|
| District colliders: floor slabs around the central pit, 42 boxes (16 floating), 4 pillars, 6 ramp wedges | map data done; `y0` consumer patch in world.js pending (see Step 3.1) |
| District meshes: slabs (world-aligned grid), rim trims, boxes, pillars, ramps (the old building shaft + skyline are gone, see Rendering budget) | done |
| Spawn at `DISTRICT_MAP.spawns`, fall below -12 m (ragdoll + server respawn, see Step 6), `R` | done |
| Arena, Large, Roof, Complex maps | |

- **Shared geometry (`game/maps.js`):** `floorSlabs(map)` cuts the roof rect into non-overlapping slabs around the holes (12 slabs for District; slabs +
  holes = the rect exactly). `rampSpan(ramp)` gives the low / high edge, width and rotation of a ramp. world.js and scene.js both build from these.
- **Colliders (world.js):** every static piece is in `WALL_GROUP` (floor slabs, boxes, cylinders for pillars, ramps), so `detectWall`, `groundGap` and the
  camera boom all see the same geometry. A skylight hole is simply no collider there, so the player falls through.
- **Ramps are solid wedges** (a convex hull of the edge profile), not tilted slabs: nothing hollow under them to slide into. Slopes in the current District: 16.0 (speed ramps) and 12.9 (deck ramps) degrees.
  A near-horizontal wall ray never counts a ramp surface as a wall (the normal filter rejects slopes under 30 degrees from horizontal).
- **Slope handling in player.js (needed once ramps existed):**
  1. The "blocked" velocity clamp is skipped when the controller climbed on its own (`vy <= 0` but `c.y > 0`): on a slope the controller turns part of the
     horizontal move into height, and clamping that every tick bled speed (310 -> ~130 on ramp 3).
  2. Ground stick: while on a surface the move also asks for `MOVE.stick` (8 units) extra downward travel so the puppet stays glued when the surface falls away
     (ramp crest, small drop). Skipped the tick after a climb (pressing into a slope only costs climb), and the first 2 airborne ticks after leaving a surface still
     count as on it. Rapier's own snap-to-ground did not hold on a crest.
- **Falling:** `hasFallen(ctx)` = feet below `MAP.fallY` (-480 units = -12 m). `main.js` then treats it as a fall (a local ragdoll tumbles, `respawnReq` goes to the server, which answers with a clean spawn after 1.2 s). `R` triggers the same
  fall (the same respawn request). `placePlayer` / `teleportPlayer`
  restore the standing capsule (a slide shrinks it) and `main.js` resets all movement state (`createPlayerState`).
- **Spawn selection (old single-player behaviour; the server picks spawns now, see Step 6):** `MAP.spawn` (default 0) or `?spawn=N` in the page URL (0-5), e.g. `?spawn=2` drops YOU on the SE pocket (the spawn list is rotated so the bots take the other five). Faces the middle of the roof (the pit).
- **Rendering notes:** floor slabs share one grid texture with world-aligned offsets (5 m tiles) so lines run straight across slab seams; rim trims are visual
  only (a 14-unit coping strip on the roof edge and around each hole); there is no geometry outside the roof (the pit looks into the sky gradient + fog);
  the sun and its 1024 shadow map follow the focus point (`setFocus`: your capsule, or your ragdoll torso while you tumble).

## Step 3.1: elevated floating boxes (`y0`) + "Glitch" District redesign

**Box contract.** `boxes` entries are `{ x, z, hw, hd, h, c, y0? }`. `h` is the TOP height and `y0` the BOTTOM height, both in old units, `y0` default 0.
`boxSpan(b)` (maps.js) returns `{ y0, top, cy, height }` with `cy = (y0 + h) / 2` and `height = h - y0`. world.js and scene.js must both use it:
the Rapier cuboid half-height is `m(height) / 2` and the collider / mesh centre is `y = m(cy)`; the mesh `BoxGeometry` height is `m(height)`.
A box with `y0 = 0` is byte-identical to the old behaviour. Colours stay `[r, g, b]` (0..255); maps.js has a `hex(0xRRGGBB)` helper so the palette reads as web colours.

**Consumer patch (world.js / scene.js).** Those two files were NOT part of the source snapshot this change was made from, so they are specified here instead of rewritten.
Everywhere either file builds a box from `b.h`, change the vertical numbers only:

```js
import { boxSpan } from '../game/maps.js';           // scene.js: '../game/maps.js' as well
const s = boxSpan(b);
// world.js: RAPIER.ColliderDesc.cuboid(m(b.hw), m(s.height) / 2, m(b.hd)).setTranslation(m(b.x), m(s.cy), m(b.z))
// scene.js: new THREE.BoxGeometry(m(b.hw * 2), m(s.height), m(b.hd * 2));  mesh.position.set(m(b.x), m(s.cy), m(b.z));
```

(Old code was `cuboid(.., m(b.h) / 2, ..)` at `y = m(b.h / 2)`.) Ramps: `rampSpan(r)` now also returns `base` (wedge underside, default 0); build the hull
profile as `(0, base) (len, base) (len, y1) (0, y0)`, i.e. replace the hard-coded 0 underside with `span.base`. No District ramp sets `base`, so nothing changes today.
Shadows / rim trims are unchanged. Floating boxes are normal `WALL_GROUP` colliders, so `detectWall`, `groundGap`, the camera boom and `raycastGrapple` see them with no further change.

**`floorSlabs(map)` / `rampSpan(r)` seam guarantees.** Holes are clamped to the rect; every slab also carries exact edges `x0 / x1 / z0 / z1`, and neighbouring slabs share the same numbers
(build the collider from `hw / hd` or from the edges, both exact for integer maps). slabs + holes tile the rect exactly (checked by `validateMap`). Ramps always rise from `base`
(0 = floor), so there is no air gap under a wedge, and the high edge of a ramp that meets a deck face touches it exactly.

**DISTRICT_MAP "Glitch" layout** (rect `hw 1600, hd 1200` = 3200 x 2400, point-symmetric under `(x, z) -> (-x, -z)`, built with `addBoxSym` etc.):

| Zone | Pieces |
|------|--------|
| Centre | skylight pit `hw 420, hd 260`; two floating skybridges (`y0 110, h 130`, 120 wide, ends touch the decks at x = +-480); two floating orange `0xe67e22` billboards (`y0 150, h 330`, 20 thick) above them |
| North / South | 9 cyan `0x3498db` wall-run panels per side (`h 230`, 20 thick), rows 230 / 250 apart face to face, staggered so each panel ends where the opposite row's next one starts; exit onto an h115 launch pad and a 16.0 degree gold `0xf1c40f` downhill speed ramp (400 long, 300 wide) |
| East / West | h110 decks, wide double ramps `0 -> 110`, h260 cover blocks on the deck (`y0 110`), two floating ledges per deck (`y0 210, h 230`, 100 over the deck: double jump or grapple) |
| Perimeter | 4 grapple towers (`h 380`) with yellow beacon caps (`y0 380, h 404`), 4 round pillars (`r 34, h 280`) |
| Spawns | 6, all `y = 0`, in the NE / SW / SE / NW pockets and the north / south rim, each >= 200 clear of every hole / obstacle footprint (min 222) |

Known limits: the gauntlet exit pad is a head-on h115 face for a player wall-running straight at it (wall-kick or jump over it, or take the ramp from below); nothing here has been play-tested for
speed tuning.

**Verification.** `validateMap(DISTRICT_MAP)` (exported from maps.js, pure data, no engine) checks: exports, shape and everything inside the rect, 3D box / box overlaps that respect `y0..h`,
ramp / ramp, ramp / box (using the ramp height over the overlap), ramp / pillar, pillar overlaps, nothing standing in a hole (floating boxes may span it), slab + hole tiling, 6 spawns at `y = 0`
with >= 200 clearance, a ground flood fill (20-unit cells, 20-unit body radius, obstacles that reach below head height `72`, ramps and holes blocked) in which all spawns share one region with 0 sealed pockets,
and that every ramp's low edge meets that connected ground. Run it under Node (maps.js is an ES module, so copy it to `.mjs` or run with `--input-type=module`):

```sh
cp src/game/maps.js /tmp/maps.mjs && node -e "import('/tmp/maps.mjs').then(({DISTRICT_MAP:m,validateMap:v})=>{const r=v(m);console.log(r.ok,r.stats,r.errors)})"
```

Last run: ok, 42 boxes (16 floating), 4 pillars, 6 ramps, 1 hole, 4 floor slabs, min spawn clearance 222, 12184 open ground cells, 0 pockets. Injected faults (box overlapping a skybridge, box in the pit,
spawn off the floor, wall sealing a lane, overlapping ramp) are all reported.

## Step 6: multiplayer (server.js + src/main.js)

### Run / deploy

- **Local:** `npm install`, `npm run build`, `npm start` (http://localhost:3000). `npm run dev` runs Vite alone (no server): open `?server=http://localhost:3000` and start the server with
  `CORS_ORIGIN=http://localhost:5173 npm start` so the socket may cross origins.
- **Render.com (Web Service):** Build Command `npm install && npm run build`, Start Command `npm start`. Render injects `PORT`. `vite` lives in `dependencies` so the build works even when Render skips devDependencies.
  Health check path: `/healthz`. Socket.IO uses WebSocket (polling fallback); the free tier sleeps when idle, so the first join after a pause is slow.
- **Env:** `PORT` (default 3000), `MAX_PLAYERS` (default 6), `CORS_ORIGIN` (comma list, dev only).
- Without a `dist/` build the server answers 503 with a hint instead of serving the raw `index.html` (it needs Vite to resolve `three` and the other bare imports).

### Wire protocol (all positions in METRES, `yaw` in radians)

| Event | Dir | Payload | Notes |
|-------|-----|---------|-------|
| `join` | C -> S | `{ name, color }` | Name trimmed to 16 chars, colour is a 0xRRGGBB integer. Rejected with `full` above `MAX_PLAYERS`. |
| `init` | S -> C | `{ id, spawn, players, serverTime }` | `spawn` = `{x,y,z}` picked from `DISTRICT_MAP.spawns * SCALE`, the farthest from every live player. `players` includes you (filter by `id`). A repeat `init` (re-join after a reconnect) resets the remote list. |
| `playerJoined` | S -> others | public player `{ id, name, color, x..z, vx..vz, yaw, height, flags, ko, ping }` | |
| `playerLeft` | S -> all | `id` | |
| `timeSync` | C -> S | ack callback `cb(Date.now())` | Client times the round trip: `rtt = now - t0`, `clockOffset = serverTime + rtt / 2 - Date.now()`, keeping the quickest samples. Burst of 5 on connect, then every 2 s. `serverNow()` in main.js = `Date.now() + clockOffset`. |
| `ping` | C -> S | `rtt` (ms, smoothed) | Shown on the scoreboard. |
| `state` | C -> S (volatile) | `{ x,y,z, vx,vy,vz, yaw, height, sliding, dashing, wallRunning, grappleActive, grappleAnchor, ragdoll }` | 30 Hz (every 2nd sim tick). Server clamps ranges, ignores packets closer than 10 ms, nulls the anchor unless `grappleActive`. |
| `snapshot` | S -> room (volatile) | `{ t, players: [{ id, ...dynamic fields, ko, ping }] }` | 30 Hz `setInterval(1000 / 30)`. Static info (name, colour) only travels in `init` / `playerJoined`. Clients drop snapshots with `t` older than the last one. |
| `respawnReq` | C -> S | none | Sent on a fall below `MAP.fallY` or `R`. The server marks the player `ragdoll`, waits `RESPAWN_DELAY_MS` (1200 ms = the tumble) and then picks a clean spawn. Duplicates while pending are ignored. |
| `respawn` | S -> C | `{ spawn }` | The client re-places the capsule, resets all movement state (`createPlayerState`) and faces the middle of the roof. |

### Client loop (main.js)

- **Your player:** `tick()` at 60 Hz: `readInput` -> `stepPlayer` -> `stepWorld` -> fall check -> every 2nd tick `sendState()`. No input prediction or reconciliation exists because nothing about you is simulated elsewhere.
  Grapple aim is the camera ray through the crosshair (`aimFromCamera`). Only level geometry can be hooked: remote players have no capsule, so `GRAPPLE` player snags (`grappleHit`) never fire.
- **Remote players:** one puppet each (`view.addPuppet(color)`; a puppet's colour is fixed, so puppets of leavers are pooled by colour and reused). Each frame `k = 1 - exp(-18 * dt)`:
  position, `height` (-> `setHeight`, so slides squash) and `yaw` (shortest-angle) ease toward the latest snapshot. A gap above 20 m snaps (respawn, lag spike). `setYaw` is called if the puppet has one
  (the faceless capsule does not need it; yaw only orients ragdolls).
- **Grapple tethers:** `view.setGrapple(slot, torso, anchor)`. Slot 0 is you, slots 1-5 go to remotes (freed on leave). That is why the server caps the room at 6 by default. Before raising `MAX_PLAYERS`, check how many slots `scene.js` allocates.
- **Ragdolls:** falling below `MAP.fallY` (`hasFallen`) or `R` -> `startFall()`: a local ragdoll tumbles where you fell, the capsule is parked on the last spawn and hidden, `state.ragdoll = true` is sent with the frozen fall position and velocity,
  `respawnReq` goes out. Remotes see the flag flip and spawn their own cosmetic ragdoll at that position / velocity (`spawnRagdoll` / `despawnRagdoll`), so ragdolls are NOT synced bit for bit. When the flag drops, the ragdoll is removed and the puppet snaps to the new spawn.
  If the server stays silent for 4 s you respawn locally (offline fallback). While the capsule is parked, input is locked (`state.locked`) but the latches still drain.
- **Join flow:** the world and scene boot behind the overlay. Play saves name + colour to `localStorage` (`pf3d.name`, `pf3d.color`), requests PointerLock (inside the click so the browser allows it) and sends `join`; `init` hides the overlay.
  After a socket reconnect the client re-joins automatically (new id, new spawn). A "DISCONNECTED" banner shows meanwhile. The HUD shows a "click to capture mouse" hint whenever the pointer is not locked during play.
- **HUD:** top-left tuning line (speed, runT, bhop, dash, air jumps, grapple, wall-run, slide boost), bottom-left `PLAYERS n  PING ms`, centre crosshair + grapple status, toast line (join / leave / mute), `Tab` held = scoreboard (`Player | KOs | Ping`, KOs sorted descending).
- **Input (`input.js`):** grapple = `KeyE` or right mouse (button 2), held; the grapple fires on the press edge inside `stepPlayer`. Left mouse (button 0) is latched as `attack` only while the pointer is locked, and nothing reads it yet (melee stage).
  Key events from text inputs are ignored, so the name field accepts spaces.

### Known limits / next

- KOs are always 0 until melee exists. The server already carries a `ko` field per player and puts it in every snapshot.
- Client-authoritative means a modified client can teleport or fake `ragdoll`. The melee stage should make the server (or the victim) the judge of melee hits, using `serverNow()`-stamped swings.
- No lag compensation or extrapolation: remotes trail the real position by roughly one snapshot interval plus the smoothing lag (about 60-100 ms plus network).
- One room, one map (District), no lobby, no names above heads, no spectating.
- Not verified in a browser with real Rapier: server.js was exercised with a stub map and two socket clients (join, init, playerJoined, timeSync, ping, state -> snapshot, respawn delay and duplicate guard, playerLeft, /healthz, static fallback).
  The client (`main.js`) was only syntax-checked; play-test the join flow, tether slots, ragdoll hand-off and smoothing.
