// src/physics/world.js
// PHYSICS: the Rapier world, the static map (floor slabs with skylight holes, boxes, pillars, ramps) and the kinematic player capsules.
// Gameplay movement is a kinematic capsule driven by our own velocity; Rapier only resolves collisions.
// One shared world holds up to MAX_PLAYERS capsules (PLAYER_GROUP). addPlayerCapsule(ctx) returns a per-player VIEW
// { RAPIER, world, player }: every function below that takes `ctx` (movePlayer, detectWall, groundGap, feetPos, ...) and
// stepPlayer(state, input, ctx) in player.js work unchanged on a view. Use the base ctx for stepWorld / ragdolls.
// Loads after: config.js, game/maps.js, physics/ragdoll.js (collision-group constants only)

import RAPIER from '@dimforge/rapier3d-compat';
import { SCALE, STEP, m, PUPPET, MOVE, WALLRUN, MAP, GRAPPLE, MANTLE } from '../config.js';
import DISTRICT_MAP, { floorSlabs, rampSpan, boxSpan } from '../game/maps.js';
import { WALL_GROUP, PLAYER_GROUP } from './ragdoll.js';

export { WALL_GROUP, PLAYER_GROUP };                          // WALL_GROUP: collision group of ALL static level geometry
const STATIC_GROUPS = (WALL_GROUP << 16) | 0xFFFF;            // member of WALL_GROUP, collides with everything
const WALL_RAY_GROUPS = (0xFFFF << 16) | WALL_GROUP;          // a query that only sees WALL_GROUP members (never capsules / ragdolls)
const PLAYER_GROUPS = (PLAYER_GROUP << 16) | WALL_GROUP;      // capsule: member of PLAYER_GROUP, collides with the level only

// Rapier gravity. Only the cosmetic ragdoll bodies are dynamic: kinematic capsules and static geometry ignore it, and gameplay
// gravity is still applied by player.js. A bit above 9.81 so tumbles feel snappy at game speed (player fall gravity is 27.5 m/s^2).
const RAGDOLL_GRAVITY = 24;

// Solid wedge for a ramp: a convex hull of the low / high edge profile. (A solid wedge, not a tilted slab, so there is no
// hollow space under the ramp to slide into.) Returns a Float32Array of points in metres.
function rampPoints(r) {
  const s = rampSpan(r), pts = [];
  for (const side of [-1, 1]) {
    const across = s.across + side * s.w;
    const ends = [[s.lo, s.base], [s.hi, s.base], [s.hi, s.y1]];     // underside at span.base (0 = floor)
    if (s.y0 > s.base) ends.push([s.lo, s.y0]);              // a ramp that starts on a ledge has a flat low face; from the base it is a plain prism
    for (const [along, y] of ends) {
      const x = s.alongX ? along : across, z = s.alongX ? across : along;
      pts.push(m(x), m(y), m(z));
    }
  }
  return new Float32Array(pts);
}

// Builds the static map and the (shared) character controller. Returns the BASE ctx { RAPIER, world, controller, players }.
// Capsules are added afterwards with addPlayerCapsule().
export async function createWorld(map = DISTRICT_MAP) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -RAGDOLL_GRAVITY, z: 0 });
  world.timestep = STEP;

  const fixed = (x, y, z) => world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  const solid = (desc, body) => world.createCollider(desc.setCollisionGroups(STATIC_GROUPS), body);

  // ---- rooftop floor: slabs around the skylight holes (top face at y = 0), so a hole really is empty space
  const th = m(MAP.floorThickness) / 2;
  for (const s of floorSlabs(map)) {
    solid(RAPIER.ColliderDesc.cuboid(m(s.hw), th, m(s.hd)), fixed(m(s.x), -th, m(s.z)));
  }

  // ---- boxes: bottom at y0 (default 0 = on the floor), top at h; a box with y0 > 0 floats
  for (const b of map.boxes) {
    const { cy, height } = boxSpan(b);
    solid(RAPIER.ColliderDesc.cuboid(m(b.hw), m(height) / 2, m(b.hd)), fixed(m(b.x), m(cy), m(b.z)));
  }

  // ---- pillars: static cylinders, base on the floor
  for (const p of map.pillars) {
    const ph = m(p.h) / 2;
    solid(RAPIER.ColliderDesc.cylinder(ph, m(p.r)), fixed(m(p.x), ph, m(p.z)));
  }

  // ---- ramps: solid wedges, so the character controller can run (and b-hop) up and down them
  for (const r of map.ramps) {
    const hull = RAPIER.ColliderDesc.convexHull(rampPoints(r));
    if (!hull) throw new Error('ramp hull failed at ' + r.x + ',' + r.z);
    solid(hull, fixed(0, 0, 0));
  }

  // One character controller shared by every capsule (each call reads its result straight away, so there is no cross-talk).
  const controller = world.createCharacterController(0.01);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.enableAutostep(m(MOVE.stepHeight), m(PUPPET.radius) * 0.5, false);
  controller.enableSnapToGround(m(8));
  controller.setMaxSlopeClimbAngle(Math.PI * 0.3);
  controller.setSlideEnabled(true);

  return { RAPIER, world, controller, players: [] };
}

// Add one kinematic capsule (cylinder half-height + radius = total height) in PLAYER_GROUP and return its VIEW.
// Capsules only collide with the level: never with each other (soft separation is game/rules.js) and never with ragdolls.
export function addPlayerCapsule(ctx) {
  const { world, controller } = ctx;
  const radius = m(PUPPET.radius);
  const halfCyl = (m(PUPPET.height) - 2 * radius) / 2;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, halfCyl + radius + 0.01, 0)
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(halfCyl, radius).setCollisionGroups(PLAYER_GROUPS), body
  );
  const player = { body, collider, controller, halfCyl, radius, height: m(PUPPET.height), vy: 0, grounded: false };
  const view = { RAPIER, world, player, all: ctx.players };   // `all`: every capsule view (grapple shots at players)
  ctx.players.push(view);
  return view;
}

// Move the capsule by a desired displacement (metres) and report where it ended up.
// newHeight (optional, metres): resize the capsule to this total height with the FEET staying put. The resize is queued
// together with the move, so the shape and the new position reach the query structures in the same world step.
export function movePlayer(ctx, dx, dy, dz, newHeight) {
  const { player } = ctx;
  if (dy > 0) player.controller.disableSnapToGround();      // never glue a jump back to the floor
  else player.controller.enableSnapToGround(m(8));
  player.controller.computeColliderMovement(player.collider, { x: dx, y: dy, z: dz }, undefined, WALL_RAY_GROUPS);
  const c = player.controller.computedMovement();
  player.grounded = player.controller.computedGrounded();
  const t = player.body.translation();
  let ny = t.y + c.y;
  if (newHeight !== undefined && Math.abs(newHeight - player.height) > 1e-6) {
    const hc = Math.max(0.01, (newHeight - 2 * player.radius) / 2);
    ny += (hc - player.halfCyl);                            // capsule centre moves by half the height change
    player.collider.setHalfHeight(hc);
    player.halfCyl = hc; player.height = newHeight;
  }
  player.body.setNextKinematicTranslation({ x: t.x + c.x, y: ny, z: t.z + c.z });
  return c;
}

// Collision-aware horizontal shove of a capsule (metres), used to read the soft player separation of game/rules.js
// (collidePlayers) back into the capsule after the world step. The move is clipped by walls, so a nudge never pushes a
// puppet into the level.
export function nudgePlayer(ctx, dx, dz) {
  const { player } = ctx;
  player.controller.disableSnapToGround();
  player.controller.computeColliderMovement(player.collider, { x: dx, y: 0, z: dz }, undefined, WALL_RAY_GROUPS);
  const c = player.controller.computedMovement(), t = player.body.translation();
  const pos = { x: t.x + c.x, y: t.y, z: t.z + c.z };
  player.body.setTranslation(pos, true);
  player.body.setNextKinematicTranslation(pos);
}

// Is there room to stand at total height h right now? (static geometry only; the player's own collider is ignored.)
// The test capsule is a touch smaller than the real one so floors and walls we are merely resting against do not count.
// `at` (optional, metres) = { x, y, z } FEET position to test instead of the current one (used by checkLedgeMantle for the ledge top).
export function hasHeadroom(ctx, h, at = null) {
  const { RAPIER, world, player } = ctx, t = player.body.translation();
  const feetY = at ? at.y : t.y - player.halfCyl - player.radius;
  const r = player.radius * 0.9, hc = Math.max(0.01, (h - 2 * r) / 2 - 0.03);
  const shape = new RAPIER.Capsule(hc, r);
  const pos = { x: at ? at.x : t.x, y: feetY + 0.04 + hc + r, z: at ? at.z : t.z };
  return world.intersectionWithShape(pos, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, WALL_RAY_GROUPS, player.collider) === null;
}

// Ledge mantle probe. (dirX, dirZ) = the horizontal direction we are being blocked in (the velocity direction). Casts ONE downward ray at
// PUPPET.radius + MANTLE.reach ahead of the body centre, from feet + maxRise (48) down to feet + minRise (12), against WALL_GROUP only.
// A ledge is found when the ray hits an upward-facing surface inside that range: the probe origin is free space (a wall taller than maxRise
// would start the ray INSIDE its collider, which a solid cast reports at distance 0 with no normal, so it is rejected) and the standing
// capsule fits on top (hasHeadroom at the ledge top). Returns { top, rise } (metres: absolute height of the surface, height above the feet) or null.
// The caller (stepPlayer) has already checked airborne + moving forward + blocked; this only answers "is there a walkable lip right here".
export function checkLedgeMantle(ctx, dirX, dirZ) {
  const { RAPIER, world, player } = ctx, t = player.body.translation();
  const l = Math.hypot(dirX, dirZ);
  if (l < 1e-6) return null;
  const dx = dirX / l, dz = dirZ / l;
  const feetY = t.y - player.halfCyl - player.radius;
  const ahead = m(PUPPET.radius + MANTLE.reach);
  const ox = t.x + dx * ahead, oz = t.z + dz * ahead, oy = feetY + m(MANTLE.maxRise);
  const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: 0, y: -1, z: 0 });
  const h = world.castRayAndGetNormal(ray, m(MANTLE.maxRise - MANTLE.minRise), true, undefined, WALL_RAY_GROUPS, player.collider);
  if (!h || h.timeOfImpact < 1e-4 || h.normal.y < MANTLE.minNormalY) return null;
  const top = oy - h.timeOfImpact, rise = top - feetY;
  if (rise < m(MANTLE.minRise) - 1e-4 || rise > m(MANTLE.maxRise) + 1e-4) return null;
  if (!hasHeadroom(ctx, m(PUPPET.height), { x: ox, y: top, z: oz })) return null;
  return { top, rise };
}

// Apply the pending kinematic moves of every capsule (and step the cosmetic ragdolls) for this tick. Takes the BASE ctx.
export function stepWorld(ctx) {
  ctx.world.step();
}

// Feet position of the puppet in metres.
export function feetPos(ctx) {
  const p = ctx.player, t = p.body.translation();
  return { x: t.x, y: t.y - p.halfCyl - p.radius, z: t.z };
}

// Put the standing puppet at a feet position in METRES. Also restores the full standing capsule, in case the player was
// sliding. With step = true (default) the world is stepped once so the query structures see the new position before the next
// move; pass false when placing several capsules and step once afterwards.
export function placePlayer(ctx, x, y, z, step = true) {
  const p = ctx.player, full = m(PUPPET.height), hc = (full - 2 * p.radius) / 2;
  p.collider.setHalfHeight(hc); p.halfCyl = hc; p.height = full;
  const pos = { x, y: y + hc + p.radius + 0.01, z };
  p.body.setTranslation(pos, true);
  p.body.setNextKinematicTranslation(pos);
  p.grounded = false;
  if (step) ctx.world.step();
}

// Same, but the position is in old units (y = feet height), like the map data.
export function teleportPlayer(ctx, x, y, z) {
  placePlayer(ctx, m(x), m(y), m(z));
}

// Fell off the roof or through a skylight: the feet are below MAP.fallY.
export function hasFallen(ctx) {
  return feetPos(ctx).y < m(MAP.fallY);
}

// Cast a ray against static level geometry only (never a puppet). Returns distance or null.
export function raycastStatic(ctx, ox, oy, oz, dx, dy, dz, maxDist) {
  const { RAPIER, world, player } = ctx;
  const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
  const hit = world.castRay(ray, maxDist, true, undefined, WALL_RAY_GROUPS, player.collider);
  return hit ? hit.timeOfImpact : null;
}

// Look for a wall beside the player. Casts a horizontal ray to the left and one to the right at torso height, out to
// PUPPET.radius + WALLRUN.detectDist from the body centre, against static geometry only (WALL_GROUP).
// `yaw` is the travel direction: forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw) (same handedness as input.js).
// `extraReach` (old units) is added to WALLRUN.detectDist: player.js passes WALLRUN.stickReach while already wall-running (hysteresis).
// Returns { hit: false } or { hit: true, side: -1 (left) | 1 (right), normal: {x, z} (unit, pointing away from the wall), dist }.
export function detectWall(ctx, yaw, extraReach = 0) {
  const { RAPIER, world, player } = ctx, t = player.body.translation();
  const feetY = t.y - player.halfCyl - player.radius;
  const oy = feetY + m(WALLRUN.torso);
  const reach = player.radius + m(WALLRUN.detectDist + extraReach);
  const rx = -Math.cos(yaw), rz = Math.sin(yaw);
  let best = { hit: false };
  for (const side of [-1, 1]) {
    const ray = new RAPIER.Ray({ x: t.x, y: oy, z: t.z }, { x: rx * side, y: 0, z: rz * side });
    const h = world.castRayAndGetNormal(ray, reach, true, undefined, WALL_RAY_GROUPS, player.collider);
    if (!h) continue;
    const l = Math.hypot(h.normal.x, h.normal.z);
    if (l < 0.5) continue;                                    // a floor / ceiling face, not a wall
    if (!best.hit || h.timeOfImpact < best.dist) best = { hit: true, side, normal: { x: h.normal.x / l, z: h.normal.z / l }, dist: h.timeOfImpact };
  }
  return best;
}

// Distance (metres) from the feet straight down to static geometry, or Infinity if nothing is within maxDist.
export function groundGap(ctx, maxDist) {
  const { RAPIER, world, player } = ctx, t = player.body.translation();
  const half = player.halfCyl + player.radius;
  const ray = new RAPIER.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 });
  const h = world.castRay(ray, half + maxDist, true, undefined, WALL_RAY_GROUPS, player.collider);
  return h ? Math.max(0, h.timeOfImpact - half) : Infinity;
}

// Grapple shot. origin / dir are world-space metres ({x, y, z}; dir need not be unit length), maxDist in metres.
// Checks static level geometry (WALL_GROUP) with a real ray, and every OTHER capsule (not ownerIdx, not skip(idx)) within
// GRAPPLE.playerRange with a ray-vs-capsule test fattened by GRAPPLE.aimPad (aim assist). The closest hit wins; a player
// behind a wall is not hit. Returns { hit, point: {x, y, z} | null, targetPlayer: -1 | index }.
export function raycastGrapple(ctx, origin, dir, maxDist, ownerIdx = -1, skip = null) {
  const { RAPIER, world, player } = ctx;
  const none = { hit: false, point: null, targetPlayer: -1 };
  const dl = Math.hypot(dir.x, dir.y, dir.z);
  if (dl < 1e-6) return none;
  const d = { x: dir.x / dl, y: dir.y / dl, z: dir.z / dl };
  let best = maxDist, out = none;
  const sh = world.castRay(new RAPIER.Ray(origin, d), maxDist, true, undefined, WALL_RAY_GROUPS, player.collider);
  if (sh) {
    best = sh.timeOfImpact;
    out = { hit: true, point: { x: origin.x + d.x * best, y: origin.y + d.y * best, z: origin.z + d.z * best }, targetPlayer: -1 };
  }
  const reach = Math.min(m(GRAPPLE.playerRange), maxDist);
  const R = player.radius + m(GRAPPLE.aimPad);
  const all = ctx.all || [];
  for (let i = 0; i < all.length; i++) {
    if (i === ownerIdx || (skip && skip(i))) continue;
    const q = all[i].player, t = q.body.translation();
    // the capsule's core is a vertical segment a..b; find the closest approach between it and the ray
    const ay = t.y - q.halfCyl, ey = 2 * q.halfCyl;                  // segment: (t.x, ay + u * ey, t.z), u in [0, 1]
    const wx = t.x - origin.x, wy = ay - origin.y, wz = t.z - origin.z;
    const A = ey * ey, B = ey * d.y, D = ey * wy, E = d.x * wx + d.y * wy + d.z * wz;
    let u = 0;
    if (A > 1e-9 && A - B * B > 1e-9) u = (B * E - D) / (A - B * B);
    u = Math.max(0, Math.min(1, u));
    const s = Math.max(0, Math.min(reach, E + u * B));               // ray parameter, limited to the reach
    if (A > 1e-9) u = Math.max(0, Math.min(1, (origin.y + d.y * s - ay) / ey));   // best point on the segment for that s
    const px = t.x, py = ay + u * ey, pz = t.z;
    const dist = Math.hypot(origin.x + d.x * s - px, origin.y + d.y * s - py, origin.z + d.z * s - pz);
    if (dist <= R && s < best) { best = s; out = { hit: true, point: { x: px, y: py, z: pz }, targetPlayer: i }; }
  }
  return out;
}

export { SCALE };
