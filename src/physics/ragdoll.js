/* ============================================================================
   src/physics/ragdoll.js
   puppetfighter3D: on-demand, purely cosmetic 6-part Rapier ragdoll.

   - Spawned only when a puppet is stunned / falls, despawned on recovery. It never feeds
     back into gameplay: the kinematic capsule (player.js) stays the single source of truth.
   - Ragdoll parts collide ONLY with static world geometry (WALL_GROUP). Never with each
     other, never with player capsules.
   - Everything here is in metres (3D world units). Dimensions are the 72-unit puppet
     (72 * SCALE = 1.8 m) from the 2.5D game.

   Rig (feet at origin y = 0, facing +Z, all in metres):
     legs   capsule r .09,  half-cyl .27 : hip  (+-.14, .72)    centre y .36
     torso  cuboid .26 x .28 x .14       : centre y 1.00 (0.72 .. 1.28)
     arms   capsule r .07,  half-cyl .20 : shoulder (+-.33, 1.22) centre y .95
     head   ball r .24                   : neck y 1.30, centre y 1.56 (top 1.80)

   WALL COLLIDERS: static world colliders may keep Rapier's default groups (0xFFFFFFFF) or use
   WALL_GROUP membership. PLAYER CAPSULES must NOT have the WALL_GROUP bit in their membership
   (give them PLAYER_GROUP), otherwise Rapier's two-way group test lets ragdoll parts touch them.
   ============================================================================ */

// Kept local so this file has no dependency on config.js export names. Swap for the PUPPET /
// SCALE import from '../config.js' once wired up; the numbers below are 72 * 0.025 = 1.8 m.
const SCALE = 0.025;

export const WALL_GROUP = 0x0001;
export const RAGDOLL_GROUP = 0x0002;
export const PLAYER_GROUP = 0x0004;   // suggested membership for player capsules (not WALL_GROUP)
// membership = RAGDOLL, filter = WALL only. Rapier packs (membership << 16) | filter.
export const RAGDOLL_FILTER = (RAGDOLL_GROUP << 16) | WALL_GROUP;

/** Body-part dimensions in metres, exported so puppet meshes can be built to match. */
export const RAGDOLL_RIG = {
  height: 72 * SCALE,
  torso: { hx: 0.26, hy: 0.28, hz: 0.14, cy: 1.00, density: 100 },
  head:  { r: 0.24, cy: 1.56, density: 60 },
  arm:   { r: 0.07, hh: 0.20, cx: 0.33, cy: 0.95, density: 60 },
  leg:   { r: 0.09, hh: 0.27, cx: 0.14, cy: 0.36, density: 80 },
  neckY: 1.30, shoulderY: 1.22, hipY: 0.72,
  linearDamping: 0.5,
  angularDamping: 0.8
};

const PART_NAMES = ['torso', 'head', 'armL', 'armR', 'legL', 'legR'];

// body-centre offsets from the origin (feet) in metres, upright pose
function partCentres() {
  const R = RAGDOLL_RIG;
  return {
    torso: [0, R.torso.cy, 0],
    head:  [0, R.head.cy, 0],
    armL:  [-R.arm.cx, R.arm.cy, 0],
    armR:  [R.arm.cx, R.arm.cy, 0],
    legL:  [-R.leg.cx, R.leg.cy, 0],
    legR:  [R.leg.cx, R.leg.cy, 0]
  };
}

function makeBody(rapier, world, pos, linVel, damp, ccd) {
  const desc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(pos[0], pos[1], pos[2])
    .setLinvel(linVel.x, linVel.y, linVel.z)
    .setLinearDamping(damp.lin)
    .setAngularDamping(damp.ang)
    .setCcdEnabled(ccd);
  return world.createRigidBody(desc);
}

function addCollider(rapier, world, shapeDesc, body, density) {
  shapeDesc
    .setDensity(density)
    .setFriction(0.8)
    .setRestitution(0.05)
    .setCollisionGroups(RAGDOLL_FILTER);
  return world.createCollider(shapeDesc, body);
}

/**
 * Spawn a 6-part ragdoll standing at `originPos` (feet position, metres).
 * @param rapier      the initialised Rapier module (RAPIER)
 * @param world       RAPIER.World
 * @param originPos   {x,y,z} feet position
 * @param linVel      {x,y,z} initial velocity given to every body (m/s)
 * @param impulseVec  {x,y,z} whiplash impulse applied to the torso (kg*m/s)
 * @param opts        optional { yaw (radians, about Y), rng (() => [0,1)) }
 * @returns {{ bodies, joints, alive }}
 */
export function spawnRagdoll(rapier, world, originPos, linVel, impulseVec, opts) {
  const R = RAGDOLL_RIG;
  const o = opts || {};
  const rng = o.rng || Math.random;
  const yaw = o.yaw || 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const lv = linVel || { x: 0, y: 0, z: 0 };
  const imp = impulseVec || { x: 0, y: 0, z: 0 };
  const damp = { lin: R.linearDamping, ang: R.angularDamping };
  const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };

  const centres = partCentres();
  const bodies = {};
  for (const name of PART_NAMES) {
    const c = centres[name];
    // rotate the local offset by yaw about Y, then translate to the origin
    const wx = originPos.x + c[0] * cy + c[2] * sy;
    const wy = originPos.y + c[1];
    const wz = originPos.z - c[0] * sy + c[2] * cy;
    const body = makeBody(rapier, world, [wx, wy, wz], lv, damp, name === 'torso' || name === 'head');
    if (yaw) body.setRotation(rot, true);
    bodies[name] = body;
  }

  addCollider(rapier, world, rapier.ColliderDesc.cuboid(R.torso.hx, R.torso.hy, R.torso.hz), bodies.torso, R.torso.density);
  addCollider(rapier, world, rapier.ColliderDesc.ball(R.head.r), bodies.head, R.head.density);
  addCollider(rapier, world, rapier.ColliderDesc.capsule(R.arm.hh, R.arm.r), bodies.armL, R.arm.density);
  addCollider(rapier, world, rapier.ColliderDesc.capsule(R.arm.hh, R.arm.r), bodies.armR, R.arm.density);
  addCollider(rapier, world, rapier.ColliderDesc.capsule(R.leg.hh, R.leg.r), bodies.legL, R.leg.density);
  addCollider(rapier, world, rapier.ColliderDesc.capsule(R.leg.hh, R.leg.r), bodies.legR, R.leg.density);

  // spherical joints: anchor on the torso (local) <-> anchor on the limb (local)
  const tC = R.torso.cy, joints = [];
  const joint = (a1, body, a2) => {
    const data = rapier.JointData.spherical(
      { x: a1[0], y: a1[1], z: a1[2] },
      { x: a2[0], y: a2[1], z: a2[2] });
    joints.push(world.createImpulseJoint(data, bodies.torso, body, true));
  };
  joint([0, R.neckY - tC, 0], bodies.head, [0, R.neckY - R.head.cy, 0]);                         // neck
  joint([-R.arm.cx, R.shoulderY - tC, 0], bodies.armL, [0, R.shoulderY - R.arm.cy, 0]);          // L shoulder
  joint([R.arm.cx, R.shoulderY - tC, 0], bodies.armR, [0, R.shoulderY - R.arm.cy, 0]);           // R shoulder
  joint([-R.leg.cx, R.hipY - tC, 0], bodies.legL, [0, R.hipY - R.leg.cy, 0]);                    // L hip
  joint([R.leg.cx, R.hipY - tC, 0], bodies.legR, [0, R.hipY - R.leg.cy, 0]);                     // R hip

  // whiplash: impulse + a little random torque so hits cartwheel
  bodies.torso.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true);
  const mag = Math.hypot(imp.x, imp.y, imp.z) * 0.15 + 0.3;
  bodies.torso.applyTorqueImpulse({
    x: (rng() - 0.5) * 2 * mag,
    y: (rng() - 0.5) * 2 * mag,
    z: (rng() - 0.5) * 2 * mag
  }, true);

  return { bodies, joints, alive: true };
}

/**
 * Copy every body's pose onto the matching Three.js mesh. Meshes must have their origin at the
 * body centre (see RAGDOLL_RIG). Returns the torso position for the chase camera; pass `out` to
 * avoid an allocation per frame.
 * @param partMeshes { torso, head, armL, armR, legL, legR } (THREE.Object3D)
 */
export function syncRagdollMeshes(ragdoll, partMeshes, out) {
  const res = out || { x: 0, y: 0, z: 0 };
  if (!ragdoll || !ragdoll.alive) return res;
  for (const name of PART_NAMES) {
    const mesh = partMeshes && partMeshes[name];
    if (!mesh) continue;
    const t = ragdoll.bodies[name].translation();
    const q = ragdoll.bodies[name].rotation();
    mesh.position.set(t.x, t.y, t.z);
    mesh.quaternion.set(q.x, q.y, q.z, q.w);
  }
  const tt = ragdoll.bodies.torso.translation();
  res.x = tt.x; res.y = tt.y; res.z = tt.z;
  return res;
}

/** Remove the 5 joints, then the 6 bodies (which also drops their colliders). Safe to call twice. */
export function despawnRagdoll(world, ragdoll) {
  if (!ragdoll || !ragdoll.alive) return;
  ragdoll.alive = false;
  for (const j of ragdoll.joints) world.removeImpulseJoint(j, true);
  ragdoll.joints.length = 0;
  for (const name of PART_NAMES) world.removeRigidBody(ragdoll.bodies[name]);
  ragdoll.bodies = null;
}
