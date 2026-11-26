# Puppet Fighter 3D - architecture

Browser-only 3D rewrite of the 2.5D `puppetfighter`. Vite + Three.js + Rapier3D (WASM). Static hosting, no servers.
The old game stays live in its own repo; this is a separate project.

## File map (one line per file; each file's header says what it loads after)

```
index.html                 Page shell + match HUD (timer, IT status, IT-time leaderboard, round / match banner), loads src/main.js as a module.
package.json               Dependencies (three, @dimforge/rapier3d-compat) and vite scripts.
src/config.js              Every tunable number, in OLD 2.5D units. SCALE converts to metres at the point of use.
src/game/maps.js           Map data (DISTRICT_MAP: boxes, pillars, holes, ramps, spawns) + shared floorSlabs() / rampSpan() geometry helpers.
src/input.js                Keyboard state and the per-tick input snapshot (wanted direction, jump edge, dash edge, slide held, grapple held (E / right mouse / left mouse while pointer-locked); grab to follow).
src/game/state.js          Plain-data match state (players, mode, timers, events). No engine deps. Spawns are passed in METRES.
src/game/rules.js          Tag rules over that state: tag, dash shove, slide trip, soft separation, IT-time scoring, rounds / match end.
src/physics/player.js      Movement rules as stepPlayer(state, input, ctx): momentum run, jump, double jump, air-strafe, b-hop, crouch-slide, dash, wall-run, wall-kick, grapple / sticky hand; `state.locked` ignores input (stun / freeze); pillar orbit to follow.
src/physics/ragdoll.js     On-demand cosmetic 6-part Rapier ragdoll (spawnRagdoll / syncRagdollMeshes / despawnRagdoll), RAGDOLL_RIG dimensions, collision groups.
src/physics/world.js       Rapier world built from the map (floor slabs, boxes, pillars, ramp wedges, all in WALL_GROUP), one kinematic capsule per player (PLAYER_GROUP) with a shared character controller, rays, detectWall, groundGap, placePlayer / teleportPlayer, nudgePlayer, hasFallen, raycastGrapple (level + player shots).
src/render/scene.js        Three.js renderer, lights, the District meshes (slabs + rim trims, boxes, pillars, ramps), no background geometry, per-player puppets (faceless capsule + hidden 6-part ragdoll meshes), the red IT cone (setItMarker), setFocus moves the sun, setGrapple draws the grapple tether.
src/render/camera.js       Mouse-orbit chase camera (PointerLock) with a Rapier raycast boom.
src/main.js                Boot, 6-player match (1 human + 5 bots, botInput), the glue between player.js / world.js / rules.js, ragdoll on stun / fall, grapple aim + snag stun, crosshair / grapple HUD, fixed 60 Hz tick decoupled from the render loop. Loads LAST.
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
| Grapple / sticky hand (hold E, right mouse, or left mouse while pointer-locked) | done (see Step 2.6 notes) |
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
  The north / south gauntlets (`DISTRICT_MAP`, see Step 3 notes) are the main wall-run spots: 24-thick, 220-tall panels in two rows 320 apart.
- **Speed FOV (`CAM.fovWarp*`):** `updateCamera(..., speed)` eases the FOV up to +15 degrees between 300 and 750 units / s.
- **HUD:** `spd`, `runT`, `BHOP` (chain count, `(window)` while open), `DASH` (ready / GO / cooldown seconds), `SLIDE`.
- **Visuals:** `state.height` drives the mesh squash (`setPuppetHeight`) and the camera pivot (scaled by height / standing
  height), so the view drops smoothly with the body.

## Step 2.6 notes (grapple / sticky hand)

- **Input:** hold `E`, the right mouse button, or the LEFT mouse button while the pointer is locked (`input.js`; `contextmenu` blocked on the canvas) -> `input.grapple`. The left click that LOCKS the pointer does not fire (the lock is not on yet when `mousedown` arrives); Esc / blur / `pointerlockchange` release it. `stepPlayer` fires on the press edge (`grapplePrev`).
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

**District = "Grapple Cathedral"** (`game/maps.js`, `rect` hw 2200 x hd 1500 = 4400 x 3000 units, lip 14). The whole map is 180-degree rotation symmetric (`twin()`: x, z negated, ramp `dir` flipped),
so every lane / spawn is equal. Same exports as before (`DISTRICT_MAP`, `floorSlabs`, `rampSpan`), so world.js and scene.js did not change. Boxes still have their base at y = 0.
- **Wall-run gauntlets (north z = -1330 / -1010, south = twin):** 7 panels per lane, `length` 650-900, `thickness` 24, `height` 220, rows 320 apart (faces 296 apart, inside the 280-340 brief), each panel overlapping
  the next one's start by 150-350, alternating rows west -> east. Chain: wall-run, wall-kick across, opposite wall-run, ... then slide-hop off the end. Colours: green row A, orange row B.
- **Cathedral (centre):** one 760 x 500 skylight pit (the only hole). Two skybridges, height 140 and width 110: east-west (x +-560, lands on the two 140 decks) and north-south (z +-400, fed by a 110-wide 17-degree
  ramp at each end). Four grapple towers (45 half-size) at (+-470, +-400): heights 340 (NW, SE) and 380 (NE, SW). Falling into the pit = a fall (respawn + you are IT).
- **East / West:** deck 140 at x +-560..920 (the bridge end) with a 17-degree wide ramp (400) down to the plain (downhill crouch-slide run) and 17-degree ramps from the north and south ground. 70-high decks at
  (+-1500, +-520) with 15-degree ramps on the west and east sides. A 40-high kicker ramp (16 degrees, x 1480..1620) sits where the downhill run ends, to launch into a b-hop / air-strafe chain.
- **Pillars (r 30, h 260):** NE / SW and NW / SE corner turns at (+-2020, -+1150) and one on each plain at (+-1850, -+170).
- **Spawns:** 6, all y = 0, checked in Node (distance to every box, ramp, hole and pillar edge, and to the roof edge): all >= 245 (>= 200 required): (-1900,-100), (1900,100), (-300,-700), (300,700), (1700,-1000), (-1700,1000).
- **Checks run:** no piece outside the rect, no overlaps except the two crossing skybridges, all 18 ramps 15-17 degrees, every elevated top has a ramp (or a bridge) onto it, and the open ground is ONE connected region (flood fill at 20 units with the puppet radius
  added), so there is no enclosed pocket or dead end. Not play-tested yet: gap widths in the gauntlet are by the numbers (kickOut 260, 296 between faces), tune panel spacing if the chain feels too tight.

| Item | Status |
|------|--------|
| District ("Grapple Cathedral", 4400 x 3000): floor slabs around 1 central skylight pit (4 slabs), 26 boxes, 6 pillars, 18 ramp wedges | done |
| District meshes: slabs (world-aligned grid), rim trims, boxes, pillars, ramps (the old building shaft + skyline are gone, see Rendering budget) | done |
| Spawn at `DISTRICT_MAP.spawns`, fall below -12 m (ragdoll + respawn, see Step 4-5 wiring), `R` | done |
| Arena, Large, Roof, Complex maps | |

- **Shared geometry (`game/maps.js`):** `floorSlabs(map)` cuts the roof rect into non-overlapping slabs around the holes (4 slabs for District; slabs +
  holes = the rect exactly). `rampSpan(ramp)` gives the low / high edge, width and rotation of a ramp. world.js and scene.js both build from these.
- **Colliders (world.js):** every static piece is in `WALL_GROUP` (floor slabs, boxes, cylinders for pillars, ramps), so `detectWall`, `groundGap` and the
  camera boom all see the same geometry. A skylight hole is simply no collider there, so the player falls through.
- **Ramps are solid wedges** (a convex hull of the edge profile), not tilted slabs: nothing hollow under them to slide into. District slopes: 15 / 16 / 17 degrees.
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
- **Spawn selection:** `MAP.spawn` (default 0) or `?spawn=N` in the page URL (0-5), e.g. `?spawn=2` drops YOU north of the cathedral (the spawn list is rotated so the bots take the other five). Faces the middle of the roof.
- **Rendering notes:** floor slabs share one grid texture with world-aligned offsets (5 m tiles) so lines run straight across slab seams; rim trims are visual
  only (a 14-unit coping strip on the roof edge and around each hole); there is no geometry outside the roof (skylights look into the sky gradient + fog);
  the sun and its 1024 shadow map follow the focus point (`setFocus`: your capsule, or your ragdoll torso while you tumble).

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
away from the roof edge and the skylights, and un-stick themselves (barely moved in 0.5 s -> strafe + hop for 0.7 s).

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

**Known limits / next:** bots have no pathfinding (they can get stuck against the gauntlet panels, the stuck logic frees them); the ragdoll is not synced to the capsule while it tumbles;
no title screen or lobby yet (the match starts straight into the countdown); pillar orbit is still not implemented (wall-run covers curving around pillars).
