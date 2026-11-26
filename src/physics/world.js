// src/physics/world.js
// PHYSICS: the Rapier world, the static test floor and the kinematic capsule controller.
// Gameplay movement is a kinematic capsule driven by our own velocity; Rapier only resolves collisions.
// Loads after: config.js

import RAPIER from '@dimforge/rapier3d-compat';
import { SCALE, STEP, m, PUPPET, MOVE, TEST_FLOOR, TEST_BLOCKS } from '../config.js';

export const WALL_GROUP = 0x0001;    // collision group of static level geometry (the camera ray hits these)

export async function createWorld() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });   // gravity is applied by our own movement code
  world.timestep = STEP;

  // ---- static test floor: a thick box whose top face sits at y = 0
  const hw = m(TEST_FLOOR.hw), hd = m(TEST_FLOOR.hd), th = m(TEST_FLOOR.thickness) / 2;
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -th, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(hw, th, hd), floorBody);

  // ---- static test blocks: one cuboid per TEST_BLOCKS entry, same centre and half-extents as the meshes in render/scene.js
  // (x, z = centre, hw / hd = half width / depth, h = height; the bottom sits on the floor at y = 0)
  for (const b of TEST_BLOCKS) {
    const bh = m(b.h) / 2;
    const bb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(m(b.x), bh, m(b.z)));
    world.createCollider(RAPIER.ColliderDesc.cuboid(m(b.hw), bh, m(b.hd)), bb);
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

// Cast a ray against static level geometry only (never the puppet itself). Returns distance or null.
export function raycastStatic(ctx, ox, oy, oz, dx, dy, dz, maxDist) {
  const { RAPIER, world, player } = ctx;
  const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
  const hit = world.castRay(ray, maxDist, true, undefined, undefined, player.collider);
  return hit ? hit.timeOfImpact : null;
}

export { SCALE };
