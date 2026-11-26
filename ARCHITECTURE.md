# Puppet Fighter 3D - architecture

Browser-only 3D rewrite of the 2.5D `puppetfighter`. Vite + Three.js + Rapier3D (WASM). Static hosting, no servers.
The old game stays live in its own repo; this is a separate project.

## File map (one line per file; each file's header says what it loads after)

```
index.html                 Page shell + match HUD (timer, IT status, IT-time leaderboard, round / match banner), bottom hint bar incl. `[G] Mode: TAG / SANDBOX`, loads src/main.js as a module.
package.json               Dependencies (three, @dimforge/rapier3d-compat) and vite scripts.
src/config.js              Every tunable number, in OLD 2.5D units. SCALE converts to metres at the point of use.
src/game/maps.js           Map data (DISTRICT_MAP "Glitch" parkour arena: boxes with optional floating y0, pillars, holes, ramps, spawns) + shared boxSpan() / floorSlabs() / rampSpan() helpers + validateMap() (Node-runnable data checks).
src/input.js                Keyboard state and the per-tick input snapshot (wanted direction, jump edge, dash edge, slide held, grapple held (E / right mouse); grab to follow).
src/game/state.js          Plain-data match state (players, mode, timers, events). No engine deps. Spawns are passed in METRES.
src/game/rules.js          Tag rules over that state: tag, dash shove, slide trip, soft separation, IT-time scoring, rounds / match end.
src/physics/player.js      Movement rules as stepPlayer(state, input, ctx): momentum run, jump, double jump, air-strafe, b-hop, crouch-slide (Titanfall 2 style: entry boost, slope acceleration, slide-hop), dash, wall-run, wall-kick, grapple / sticky hand; `state.locked` ignores input (stun / freeze); pillar orbit to follow.
src/physics/ragdoll.js     On-demand cosmetic 6-part Rapier ragdoll (spawnRagdoll / syncRagdollMeshes / despawnRagdoll), RAGDOLL_RIG dimensions, collision groups.
src/physics/world.js       Rapier world built from the map (floor slabs, boxes, pillars, ramp wedges, all in WALL_GROUP), one kinematic capsule per player (PLAYER_GROUP) with a shared character controller, rays, detectWall, groundGap, placePlayer / teleportPlayer, nudgePlayer, hasFallen, raycastGrapple (level + player shots).
src/render/scene.js        Three.js renderer, lights, the District meshes (slabs + rim trims, boxes, pillars, ramps), no background geometry, per-player puppets (faceless capsule + hidden 6-part ragdoll meshes), the red IT cone (setItMarker), setFocus moves the sun, setGrapple draws the grapple tether.
src/render/camera.js       Mouse-orbit chase camera (PointerLock) with a Rapier raycast boom.
src/main.js                Boot, 6-player match (1 human + 5 bots, botInput), the glue between player.js / world.js / rules.js, ragdoll on stun / fall, grapple aim + snag stun, crosshair / grapple HUD, fixed 60 Hz tick decoupled from the render loop, `[G]` / `?sandbox=1` TAG <-> SANDBOX toggle. Loads LAST.
```

## Rules

- **Scale:** `SCALE = 0.025`. 1 old unit = 0.025 m, so the 72-unit puppet is 1.8 m. Numbers are stored in old units in
  `config.js` and multiplied by `SCALE` where they are used (`m()` helper). Retune there, never in logic.
- **Fixed step:** simulation runs at `STEP = 1/60` with an accumulator in `main.js`. Rendering runs on `requestAnimationFrame`.
- **Gameplay movement is kinematic:** a single capsule moved by our own velocity code; Rapier's
  `KinematicCharacterController` only resolves collisions (slopes, steps). Gravity is applied by us, not by Rapier.
- **Camera is view-only:** yaw / pitch live in the camera rig and never enter the simulation state.
- **Physics code stays a pure function of (state, input)** where possible, so guest prediction can replay it later.
- **Rendering budget:** District must hold 60+ FPS. No background geometry (no skyline / facade / street, only the sky gradient), sun shadow map 1024 x 1024,
  floor slabs and trims never cast shadows (they only receive), one shared geometry per puppet part, camera far plane 400 m. Do not add decorative geometry without checking FPS.

## Migration plan

| Step | Focus | Status |
|------|-------|--------|
| 1 | Foundation: Vite + Three + Rapier, test floor, kinematic capsule with WASD, orbit chase camera with raycast boom | done |
| 2 | Movement verbs from the old physics.js, one at a time (see Step 2 progress). Plan changed: movement before maps | in progress |
| 3 | Maps: District wired in (colliders, meshes, spawns, fall respawn); the other maps one at a time | in progress (District done, see Step 3 progress) |
| 4 | Tag rules, scoring, rounds, bots, HUD | done (see Step 4-5 wiring) |
| 5 | Procedural 3D puppet, cosmetic ragdoll on stun / fall | done as faceless capsule + 6-part ragdoll (see Step 4-5 wiring) |
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
| Grapple / sticky hand (hold E or right mouse) | done (see Step 2.6 notes) |
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
- **Slide (Titanfall 2 flow):** `SLIDE` in `config.js` (height 40, friction 0.84, steerAccel 240, boostAdd 115, maxBoostSpeed 680, boostCd 0.75,
  slopeAccel 650, minSpeed 60, resize 14). The slide is meant to ACCELERATE combos, not brake them:
  - **Entry boost:** Shift held on the ground enters a slide. If `slideBoostCd <= 0`, `SLIDE.boostAdd` is ADDED to the horizontal speed along the
    velocity (along the facing when slower than `minSpeed`), but never past `maxBoostSpeed`; a speed already above 680 (b-hop / dash / ramp speed) is
    kept as is. A boost that fired starts `boostCd` 0.75 s (`state.slideBoostCd`), so tapping Shift from a standstill cannot be spammed. Entering
    with the cooldown running keeps the speed, no boost.
  - **Glide + carve:** horizontal speed is multiplied by `friction^dt` (0.84 / s, so a slide carries far) and held keys steer by `steerAccel` (240) without
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
- **Wall height:** the wall ray sits `torso` (36) above the feet, so a wall must be taller than the jump arc to be run along. The 230-high
  cyan gauntlet panels (north / south) and the orange billboards over the pit are the main wall-run spots.
- **Speed FOV (`CAM.fovWarp*`):** `updateCamera(..., speed)` eases the FOV up to +15 degrees between 300 and 750 units / s.
- **HUD:** `spd`, `runT`, `BHOP` (chain count, `(window)` while open), `DASH` (ready / GO / cooldown seconds), `SLIDE`.
- **Visuals:** `state.height` drives the mesh squash (`setPuppetHeight`) and the camera pivot (scaled by height / standing
  height), so the view drops smoothly with the body.

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
- **Player snag:** reaching a player sets `grappleHit`; `main.js` (after `stepGameRules`) gives that player `stun = hitStun`, a horizontal shove away from the grappler (`max(hitShove, 0.6 * grappler speed)`) and ends their own hook.
  It works the same for IT (tag set-up) and runners (sabotage / escape). state.js / rules.js are untouched: it only writes the existing `stun`, `vx`, `vz` fields, which the existing knock / ragdoll code already reads.
- **Visuals / HUD:** `view.setGrapple(i, torso, anchor)` draws a thin glowing cylinder + hook ball per hooked player. The crosshair dot and the status line under it ("GRAPPLE READY" / cooldown seconds / "HOOKED")
  are created from `main.js` (`makeCrosshair`), so `index.html` did not change. The yellow tuning line also shows `GRAPPLE ready / GO / cooldown`.
- **Not done:** bots never grapple (no `aim`), and the tether is cosmetic (no rope collision).

## Step 3 progress (maps)

| Item | Status |
|------|--------|
| District colliders: floor slabs around the central pit, 42 boxes (16 floating), 4 pillars, 6 ramp wedges | map data done; `y0` consumer patch in world.js pending (see Step 3.1) |
| District meshes: slabs (world-aligned grid), rim trims, boxes, pillars, ramps (the old building shaft + skyline are gone, see Rendering budget) | done |
| Spawn at `DISTRICT_MAP.spawns`, fall below -12 m (ragdoll + respawn, see Step 4-5 wiring), `R` | done |
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
- **Falling:** `hasFallen(ctx)` = feet below `MAP.fallY` (-480 units = -12 m). `main.js` then treats it as a fall (ragdoll tumbles into the void, the player reappears on their spawn after 1.2 s). `R` triggers the same
  fall (it is a "stuck" button, so it is NOT a free escape from IT). `placePlayer` / `teleportPlayer`
  restore the standing capsule (a slide shrinks it) and `main.js` resets all movement state (`createPlayerState`).
- **Spawn selection:** `MAP.spawn` (default 0) or `?spawn=N` in the page URL (0-5), e.g. `?spawn=2` drops YOU on the SE pocket (the spawn list is rotated so the bots take the other five). Faces the middle of the roof (the pit).
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
speed tuning. Bots still have no pathfinding and do not use the new verticality.

**Verification.** `validateMap(DISTRICT_MAP)` (exported from maps.js, pure data, no engine) checks: exports, shape and everything inside the rect, 3D box / box overlaps that respect `y0..h`,
ramp / ramp, ramp / box (using the ramp height over the overlap), ramp / pillar, pillar overlaps, nothing standing in a hole (floating boxes may span it), slab + hole tiling, 6 spawns at `y = 0`
with >= 200 clearance, a ground flood fill (20-unit cells, 20-unit body radius, obstacles that reach below head height `72`, ramps and holes blocked) in which all spawns share one region with 0 sealed pockets,
and that every ramp's low edge meets that connected ground. Run it under Node (maps.js is an ES module, so copy it to `.mjs` or run with `--input-type=module`):

```sh
cp src/game/maps.js /tmp/maps.mjs && node -e "import('/tmp/maps.mjs').then(({DISTRICT_MAP:m,validateMap:v})=>{const r=v(m);console.log(r.ok,r.stats,r.errors)})"
```

Last run: ok, 42 boxes (16 floating), 4 pillars, 6 ramps, 1 hole, 4 floor slabs, min spawn clearance 222, 12184 open ground cells, 0 pockets. Injected faults (box overlapping a skybridge, box in the pit,
spawn off the floor, wall sealing a lane, overlapping ramp) are all reported.

## Step 4-5 wiring (tag match, bots, ragdolls, HUD)

Six players: `YOU` (index 0) + `BOT 1..5`. `createGameState({ spawns })`, `addPlayer` x6, `resetRoundPlayers(gs, spawnsM)`, then `mode = 'countdown'`
(same as `startMatch`). Game state is in METRES; `DISTRICT_MAP.spawns` are old units, so `main.js` converts them once (`spawnsM`) before handing them to
state.js, which re-uses them on every round reset. `state.js` and `rules.js` are unchanged.

**Per-player physics.** `world.js` keeps one shared Rapier world and one shared `KinematicCharacterController`. `addPlayerCapsule(ctx)` makes a kinematic capsule in
`PLAYER_GROUP` (collides with the level only, never with other capsules or ragdolls) and returns a per-player VIEW `{ RAPIER, world, player }`. Every world.js helper
and `stepPlayer(state, input, view)` take that view, so player.js needed no signature change. Use the base ctx for `stepWorld` and `spawnRagdoll`.
World gravity is -24 m/s^2 but only the dynamic ragdoll bodies feel it; capsules stay kinematic and player.js still applies gameplay gravity.

**Tick order (main.js `tick`, 60 Hz):**
1. each player: input (human `readInput`, bot `botInput`, or `IDLE_INPUT` when locked), `stepPlayer` queues the kinematic move. `state.locked` = not `play` mode, or `stun > 0`, or downed;
   locked players ignore input, so a knock plays out through normal friction / gravity (the human's input latches are still drained every tick).
2. `stepWorld`: all capsules move, ragdolls tumble.
3. capsules -> `gs.players[i]`: feet x / y / z, velocity, yaw, `sliding`, `dashing`, `runT`, `bhopChain`, `fell` (set for exactly one tick, rising edge for the fall penalty).
4. `stepGameRules(gs, STEP)`.
5. `gs` -> capsules: (a) a changed `vx / vz` means the rules knocked the player (tag, shove, trip): adopted into the movement state; (b) the position delta from
   `collidePlayers` soft separation is applied with `nudgePlayer` (collision-aware, so it can not push a puppet into a wall); (c) a new `gs.round` re-places everyone
   (`placeAll`); (d) ragdoll on / off (below).

**Bots (`botInput(gs, idx)` in main.js).** No pathfinding. IT bot: chase the nearest runner (leading its velocity slightly), occasional hop, dash when within 5.5 m.
Runner bot: run straight away from IT with a sine weave, dash within 4.2 m (a dashing runner shoves IT, see rules.js). Both look 0.5 s ahead along their velocity and steer
away from the roof edge and the pit, and un-stick themselves (barely moved in 0.5 s -> strafe + hop for 0.7 s).

**Ragdoll lifecycle (cosmetic only; the capsule stays the single source of truth):**
- `stun > 0` and no ragdoll: `spawnRagdoll(RAPIER, world, feet, velocity, knock impulse, { yaw })`, the capsule mesh is hidden, 6 meshes (`RAGDOLL_RIG` sizes, player colour, faceless)
  follow the bodies each frame (`syncRagdollMeshes`). The capsule keeps moving under the knockback, so the ragdoll can end up a little away from it.
- `stun` ends (or a new round starts): `despawnRagdoll`, capsule shown again.
- Fall (feet below `MAP.fallY`) or `R`: ragdoll spawns where they fell, the capsule is parked on its spawn and stays hidden for `FALL_DOWN` = 1.2 s, and the rules see the
  player at y = -1000 meanwhile (untaggable, no separation). `gs.fell` is raised for one tick, so rules.js hands them IT (fall penalty). After 1.2 s the ragdoll is removed and
  the capsule appears on the spawn.
- Chase camera: while YOUR ragdoll exists, `updateCamera` follows its torso (and the sun follows it); otherwise the capsule as before. The red IT cone follows the IT puppet's
  torso while that puppet is ragdolling.

**Puppets (render/scene.js).** `view.addPuppet(color)` returns `{ capsule, parts, setFeet, setHeight, showCapsule, showRagdoll }`. The capsule squashes with `state.height`
(smooth, eased in player.js). One shared emissive red cone (`setItMarker`) hovers above whoever is IT. Geometry is shared by all puppets; each puppet owns one material.

**HUD (index.html + main.js `updateHud`).** Top centre: round number, timer (red under 10 s), `TAG THEM!` (you are IT) / `RUN!`. Top right: live IT-time leaderboard (lowest IT time
first = currently winning, IT marker, round wins), refreshed ~7x / s and only written to the DOM when it changed. Centre banner: countdown number, `GO!`, round winner
(`roundend`), match winner (`matchend`, press Enter to start a new match via `startMatch`). Small toast line for tag / shove / trip / fall events (`drainEvents`, once per frame).
Top left keeps the movement tuning line. Match settings (first to 3 round wins, 60 s rounds, 3 s countdown) are the `createGameState` defaults.

**Known limits / next:** bots have no pathfinding (they can get boxed in by the wall-run gauntlets, the stuck logic frees them); the ragdoll is not synced to the capsule while it tumbles;
no title screen or lobby yet (the match starts straight into the countdown); pillar orbit is still not implemented (wall-run covers curving around pillars).

## Sandbox / free-roam practice mode (main.js, index.html)

`[G]` toggles **TAG MATCH (6 Players)** <-> **SANDBOX (Solo Free-Roam)**; `?sandbox=1` starts in the sandbox (the URL is kept in sync with `history.replaceState`).
The bottom hint bar shows `[G] Mode: TAG / SANDBOX` with the active mode highlighted (`#modeTag` / `#modeSandbox`, updated in `updateHud`).

| | TAG MATCH | SANDBOX |
|---|---|---|
| Bots (players 1..5) | simulated | parked far off the map (`PARK_POS`, `limbo = PARK`), not stepped, not rendered, not grapple targets (`skip`) |
| `stepGameRules` | every tick | not run: no tags, shoves, trips, soft separation, IT time, timer, countdown, round / match end |
| `gs.mode` / IT | rules own them | forced to `'play'` every tick, every `isIt = false`, `stun = 0` |
| HUD | round, timer, status, leaderboard, banners | `SANDBOX` / `FREE ROAM`; timer, leaderboard and banners hidden |
| `R` / falling off | fall = ragdoll + 1.2 s down + IT penalty | `sandboxRespawn()`: instant teleport to your spawn (`spawnsM[0]`), no ragdoll, no limbo, no penalty; all movement state, cooldowns and chains reset (`createPlayerState`), camera faces the middle |

Switching to SANDBOX ends bot ragdolls, parks the capsules and respawns you. Switching back calls `startMatch(gs, spawnsM)` + `placeAll()` (fresh match: scores 0,
countdown, bots back on their spawns). `state.js`, `rules.js` and the other files are untouched; the sandbox only gates the calls in `main.js`.
