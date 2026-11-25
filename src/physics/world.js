// src/physics/world.js
// PHYSICS: the Rapier world, the static test floor and the kinematic capsule controller.
// Gameplay movement is a kinematic capsule driven by our own velocity; Rapier only resolves collisions.
// Loads after: config.js

import RAPIER from '@dimforge/rapier3d-compat';
import { SCALE, STEP, m, PUPPET, MOVE, TEST_FLOOR } from '../config.js';

export const WALL_GROUP = 0x0001;    // collision group of static level geometry (the camera ray hits these)

export async function createWorld() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });   // gravity is applied by our own movement code
  world.timestep = STEP;

  // ---- static test floor: a thick box whose top face sits at y = 0
  const hw = m(TEST_FLOOR.hw), hd = m(TEST_FLOOR.hd), th = m(TEST_FLOOR.thickness) / 2;
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -th, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(hw, th, hd), floorBody);

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

  const player = { body, collider, controller, halfCyl, radius, vy: 0, grounded: false };
  return { RAPIER, world, player };
}

// Move the capsule by a desired displacement (metres) and report where it ended up.
export function movePlayer(ctx, dx, dy, dz) {
  const { player } = ctx;
  player.controller.computeColliderMovement(player.collider, { x: dx, y: dy, z: dz });
  const c = player.controller.computedMovement();
  player.grounded = player.controller.computedGrounded();
  const t = player.body.translation();
  player.body.setNextKinematicTranslation({ x: t.x + c.x, y: t.y + c.y, z: t.z + c.z });
  return c;
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
