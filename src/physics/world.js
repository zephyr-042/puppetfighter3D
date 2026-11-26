// src/physics/world.js
// PHYSICS: the Rapier world, the static map (floor slabs with skylight holes, boxes, pillars, ramps) and the kinematic capsule.
// Gameplay movement is a kinematic capsule driven by our own velocity; Rapier only resolves collisions.
// Loads after: config.js, game/maps.js

import RAPIER from '@dimforge/rapier3d-compat';
import { SCALE, STEP, m, PUPPET, MOVE, WALLRUN, MAP } from '../config.js';
import DISTRICT_MAP, { floorSlabs, rampSpan } from '../game/maps.js';

export const WALL_GROUP = 0x0001;    // collision group of ALL static level geometry (wall / ground / camera rays look at this group)
const STATIC_GROUPS = (WALL_GROUP << 16) | 0xFFFF;       // member of WALL_GROUP, collides with everything
const WALL_RAY_GROUPS = (0xFFFF << 16) | WALL_GROUP;     // a ray that only sees WALL_GROUP members

// Solid wedge for a ramp: a convex hull of the low / high edge profile. (A solid wedge, not a tilted slab, so there is no
// hollow space under the ramp to slide into.) Returns a Float32Array of points in metres.
function rampPoints(r) {
  const s = rampSpan(r), pts = [];
  for (const side of [-1, 1]) {
    const across = s.across + side * s.w;
    const ends = [[s.lo, 0], [s.hi, 0], [s.hi, s.y1]];
    if (s.y0 > 0) ends.push([s.lo, s.y0]);                   // a ramp that starts on a ledge has a flat low face; from the floor it is a plain prism
    for (const [along, y] of ends) {
      const x = s.alongX ? along : across, z = s.alongX ? across : along;
      pts.push(m(x), m(y), m(z));
    }
  }
  return new Float32Array(pts);
}

export async function createWorld(map = DISTRICT_MAP) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });   // gravity is applied by our own movement code
  world.timestep = STEP;

  const fixed = (x, y, z) => world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  const solid = (desc, body) => world.createCollider(desc.setCollisionGroups(STATIC_GROUPS), body);

  // ---- rooftop floor: slabs around the skylight holes (top face at y = 0), so a hole really is empty space
  const th = m(MAP.floorThickness) / 2;
  for (const s of floorSlabs(map)) {
    solid(RAPIER.ColliderDesc.cuboid(m(s.hw), th, m(s.hd)), fixed(m(s.x), -th, m(s.z)));
  }

  // ---- boxes: base on the floor (y = 0), top at h
  for (const b of map.boxes) {
    const bh = m(b.h) / 2;
    solid(RAPIER.ColliderDesc.cuboid(m(b.hw), bh, m(b.hd)), fixed(m(b.x), bh, m(b.z)));
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

  // ---- the puppet: kinematic capsule. cylinder half-height + radius = total height
  const radius = m(PUPPET.radius);
  const halfCyl = (m(PUPPET.height) - 2 * radius) / 2;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, halfCyl + radius + 0.01, 0)
  );
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfCyl, radius), body);

  const controller = world.createCharacterController(0.01);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.enableAutostep(m(MOVE.stepHeight), radius * 0.5, false);
  controller.enableSnapToGround(m(8));
  controller.setMaxSlopeClimbAngle(Math.PI * 0.3);
  controller.setSlideEnabled(true);

  const player = { body, collider, controller, halfCyl, radius, height: m(PUPPET.height), vy: 0, grounded: false };
  return { RAPIER, world, player };
}

// Move the capsule by a desired displacement (metres) and report where it ended up.
// newHeight (optional, metres): resize the capsule to this total height with the FEET staying put. The resize is queued
// together with the move, so the shape and the new position reach the query structures in the same world step.
export function movePlayer(ctx, dx, dy, dz, newHeight) {
  const { player } = ctx;
  if (dy > 0) player.controller.disableSnapToGround();      // never glue a jump back to the floor
  else player.controller.enableSnapToGround(m(8));
  player.controller.computeColliderMovement(player.collider, { x: dx, y: dy, z: dz });
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

// Is there room to stand at total height h right now? (static geometry only; the player's own collider is ignored.)
// The test capsule is a touch smaller than the real one so floors and walls we are merely resting against do not count.
export function hasHeadroom(ctx, h) {
  const { RAPIER, world, player } = ctx, t = player.body.translation();
  const feetY = t.y - player.halfCyl - player.radius;
  const r = player.radius * 0.9, hc = Math.max(0.01, (h - 2 * r) / 2 - 0.03);
  const shape = new RAPIER.Capsule(hc, r);
  const pos = { x: t.x, y: feetY + 0.04 + hc + r, z: t.z };
  return world.intersectionWithShape(pos, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, undefined, player.collider) === null;
}

// Apply the pending kinematic move and update query structures for this tick.
export function stepWorld(ctx) {
  ctx.world.step();
}

// Feet position of the puppet in metres.
export function feetPos(ctx) {
  const p = ctx.player, t = p.body.translation();
  return { x: t.x, y: t.y - p.halfCyl - p.radius, z: t.z };
}

// Put the standing puppet on a spawn point (old units, y = feet height). Also restores the full standing capsule, in case the
// player was sliding. Steps the world once so the query structures see the new position before the next move.
export function teleportPlayer(ctx, x, y, z) {
  const p = ctx.player, full = m(PUPPET.height), hc = (full - 2 * p.radius) / 2;
  p.collider.setHalfHeight(hc); p.halfCyl = hc; p.height = full;
  const pos = { x: m(x), y: m(y) + hc + p.radius + 0.01, z: m(z) };
  p.body.setTranslation(pos, true);
  p.body.setNextKinematicTranslation(pos);
  p.grounded = false;
  ctx.world.step();
}

// Fell off the roof or through a skylight: the feet are below MAP.fallY.
export function hasFallen(ctx) {
  return feetPos(ctx).y < m(MAP.fallY);
}

// Cast a ray against static level geometry only (never the puppet itself). Returns distance or null.
export function raycastStatic(ctx, ox, oy, oz, dx, dy, dz, maxDist) {
  const { RAPIER, world, player } = ctx;
  const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
  const hit = world.castRay(ray, maxDist, true, undefined, WALL_RAY_GROUPS, player.collider);
  return hit ? hit.timeOfImpact : null;
}

// Look for a wall beside the player. Casts a horizontal ray to the left and one to the right at torso height, out to
// PUPPET.radius + WALLRUN.detectDist from the body centre, against static geometry only (WALL_GROUP).
// `yaw` is the travel direction: forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw) (same handedness as input.js).
// Returns { hit: false } or { hit: true, side: -1 (left) | 1 (right), normal: {x, z} (unit, pointing away from the wall), dist }.
export function detectWall(ctx, yaw) {
  const { RAPIER, world, player } = ctx, t = player.body.translation();
  const feetY = t.y - player.halfCyl - player.radius;
  const oy = feetY + m(WALLRUN.torso);
  const reach = player.radius + m(WALLRUN.detectDist);
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

export { SCALE };
