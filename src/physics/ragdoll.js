/* ============================================================================
   src/physics/ragdoll.js
   puppetfighter3D: on-demand, purely cosmetic SINGLE-BODY POD ragdoll.

   The player is one sleek armoured pod (a capsule), so the tumbling ragdoll is the exact same pod:
   ONE dynamic Rapier rigid body with ONE capsule collider that matches the player capsule
   (height 1.8 m, radius 0.35 m). No limbs, no joints, no humanoid parts: heavy hits and KOs send
   the very same pod cartwheeling and bouncing across the arena.

   - Spawned only when a pod is knocked out / tumbles / falls, despawned on recovery. It never feeds
     back into gameplay except through the pose main.js reads when a (non-lethal) tumble ends: the
     kinematic capsule (player.js) stays the single source of truth for movement.
   - The pod collides ONLY with static world geometry (WALL_GROUP). Never with other pods, never
     with player capsules.
   - Everything here is in metres (3D world units): 72 * SCALE = 1.8 m tall, 14 * SCALE = 0.35 m radius.

   Rig (feet at origin y = 0, all in metres):
     pod   capsule r .35, half-cylinder .55 : centre y .90 (spans 0 .. 1.8)

   WALL COLLIDERS: static world colliders may keep Rapier's default groups (0xFFFFFFFF) or use
   WALL_GROUP membership. PLAYER CAPSULES must NOT have the WALL_GROUP bit in their membership
   (give them PLAYER_GROUP), otherwise Rapier's two-way group test lets the pod touch them.
   ============================================================================ */

// Kept local so this file has no dependency on config.js export names. The numbers below are
// 72 * 0.025 = 1.8 m (height) and 14 * 0.025 = 0.35 m (radius), i.e. PUPPET.height / PUPPET.radius.
const SCALE = 0.025;

export const WALL_GROUP = 0x0001;
export const RAGDOLL_GROUP = 0x0002;
export const PLAYER_GROUP = 0x0004;   // suggested membership for player capsules (not WALL_GROUP)
// membership = RAGDOLL, filter = WALL only. Rapier packs (membership << 16) | filter.
export const RAGDOLL_FILTER = (RAGDOLL_GROUP << 16) | WALL_GROUP;

/** Pod dimensions in metres, exported so the pod mesh (render/scene.js) can be built to match. */
export const RAGDOLL_RIG = {
  height: 72 * SCALE,                                   // 1.8 m
  radius: 14 * SCALE,                                   // 0.35 m
  halfCyl: (72 * SCALE - 2 * 14 * SCALE) / 2,           // 0.55 m: Rapier capsule half-height of the straight part
  centerY: 72 * SCALE / 2,                              // 0.9 m: body centre above the feet when the pod stands upright
  density: 90,
  friction: 0.55,                                       // a capsule on its side rolls instead of sticking
  restitution: 0.3,                                     // bouncy: heavy hits make the pod bounce across the roof
  linearDamping: 0.4,
  angularDamping: 0.5,
  gravityScale: 1,                                      // raise (e.g. 1.6) if the tumble feels floaty next to the 21-27 m/s^2 player gravity
  spin: 0.55,                                           // rad per (m/s) of horizontal speed: how hard a fast pod tips over and rolls
  maxSpin: 14                                           // rad / s clamp on that spin
};
export const POD_RIG = RAGDOLL_RIG;                     // alias with the new name

/**
 * Spawn the tumbling pod standing at `originPos` (feet position, metres).
 * @param rapier      the initialised Rapier module (RAPIER)
 * @param world       RAPIER.World
 * @param originPos   {x,y,z} feet position
 * @param linVel      {x,y,z} initial velocity of the pod (m/s)
 * @param impulseVec  {x,y,z} optional extra impulse (kg*m/s) on top of linVel (pass null / zero for none)
 * @param opts        optional { yaw (radians, about Y), rng (() => [0,1)), angVel ({x,y,z} rad/s, replaces the automatic tip-over spin) }
 * @returns {{ body, alive }}
 */
export function spawnRagdoll(rapier, world, originPos, linVel, impulseVec, opts) {
  const R = RAGDOLL_RIG;
  const o = opts || {};
  const rng = o.rng || Math.random;
  const yaw = o.yaw || 0;
  const lv = linVel || { x: 0, y: 0, z: 0 };
  const imp = impulseVec || { x: 0, y: 0, z: 0 };

  const desc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(originPos.x, originPos.y + R.centerY, originPos.z)
    .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
    .setLinvel(lv.x, lv.y, lv.z)
    .setLinearDamping(R.linearDamping)
    .setAngularDamping(R.angularDamping)
    .setGravityScale(R.gravityScale)
    .setCcdEnabled(true);                               // a blasted pod can move 0.4 m per tick: never tunnel through a 0.55 m wall
  const body = world.createRigidBody(desc);

  const col = rapier.ColliderDesc.capsule(R.halfCyl, R.radius)
    .setDensity(R.density)
    .setFriction(R.friction)
    .setRestitution(R.restitution)
    .setCollisionGroups(RAGDOLL_FILTER);
  world.createCollider(col, body);

  if (imp.x || imp.y || imp.z) body.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true);

  // tip-over spin: a pod hit sideways rolls along its travel direction (omega = up x v), plus a little random wobble so no two tumbles match
  const clampSpin = (v) => Math.max(-R.maxSpin, Math.min(R.maxSpin, v));
  const av = o.angVel || {
    x: clampSpin(lv.z * R.spin + (rng() - 0.5) * 3),
    y: (rng() - 0.5) * 4,
    z: clampSpin(-lv.x * R.spin + (rng() - 0.5) * 3)
  };
  body.setAngvel({ x: av.x, y: av.y, z: av.z }, true);

  return { body, alive: true };
}

/**
 * Copy the pod body's pose onto the pod Object3D (position + rotation; the object's origin must be the
 * pod centre, which render/scene.js `pod` is). Returns the centre for the chase camera; pass `out` to
 * avoid an allocation per frame.
 * @param podObject THREE.Object3D (the puppet's `pod` group)
 */
export function syncRagdollMeshes(ragdoll, podObject, out) {
  const res = out || { x: 0, y: 0, z: 0 };
  if (!ragdoll || !ragdoll.alive) return res;
  const t = ragdoll.body.translation(), q = ragdoll.body.rotation();
  if (podObject) {
    podObject.position.set(t.x, t.y, t.z);
    podObject.quaternion.set(q.x, q.y, q.z, q.w);
  }
  res.x = t.x; res.y = t.y; res.z = t.z;
  return res;
}

/** Current pod centre in metres (for the tumble-recovery placement in main.js). */
export function ragdollCenter(ragdoll, out) {
  const res = out || { x: 0, y: 0, z: 0 };
  if (!ragdoll || !ragdoll.alive) return res;
  const t = ragdoll.body.translation();
  res.x = t.x; res.y = t.y; res.z = t.z;
  return res;
}

/** Current pod linear velocity in m/s. */
export function ragdollVelocity(ragdoll, out) {
  const res = out || { x: 0, y: 0, z: 0 };
  if (!ragdoll || !ragdoll.alive) return res;
  const v = ragdoll.body.linvel();
  res.x = v.x; res.y = v.y; res.z = v.z;
  return res;
}

/** Remove the pod body (which also drops its collider). Safe to call twice. */
export function despawnRagdoll(world, ragdoll) {
  if (!ragdoll || !ragdoll.alive) return;
  ragdoll.alive = false;
  world.removeRigidBody(ragdoll.body);
  ragdoll.body = null;
}
