# Puppet Fighter 3D - architecture

Browser-only 3D rewrite of the 2.5D `puppetfighter`. Vite + Three.js + Rapier3D (WASM). Static hosting, no servers.
The old game stays live in its own repo; this is a separate project.

## File map (one line per file; each file's header says what it loads after)

```
index.html                 Page shell, loads src/main.js as a module.
package.json               Dependencies (three, @dimforge/rapier3d-compat) and vite scripts.
src/config.js              Every tunable number, in OLD 2.5D units. SCALE converts to metres at the point of use.
src/physics/world.js       Rapier world, static test floor + blocks, kinematic capsule + character controller, static raycast.
src/render/scene.js        Three.js renderer, lights, floor / blocks meshes, placeholder capsule puppet.
src/render/camera.js       Mouse-orbit chase camera (PointerLock) with a Rapier raycast boom.
src/main.js                Boot, keyboard, fixed 60 Hz tick decoupled from the render loop. Loads LAST.
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
| 2 | Maps: Roof first plus one ramp, then the other maps one at a time | |
| 3 | Movement verbs from the old physics.js: momentum, jump buffer, slide, dash, analytic pillar orbit | |
| 4 | Tag rules, scoring, rounds, dummies, HUD | |
| 5 | Procedural 3D puppet, cosmetic ragdoll on stun / fall | |
| 6 | Supabase lobby + WebRTC host / guest netcode | |

## Step 1 notes

- Movement here is a placeholder: camera-relative WASD, velocity chasing a wanted velocity, gravity, autostep.
  It moves to `src/physics/player.js` in Step 3 (jump, slide, dash, grab).
- `TEST_BLOCKS` in `config.js` (a two-step staircase, a tall wall, a crate) exists only to test step-up and the camera boom.
  Step 2 replaces it with real map data.
- Run: `npm install` then `npm run dev`. Build: `npm run build` (output in `dist/`).
