// src/config.js
// All tunable numbers live here, in the ORIGINAL 2.5D game units (puppetfighter).
// Code multiplies by SCALE at the point of use, so retuning never touches logic.
// Loads after: nothing.

export const SCALE = 0.025;          // 1 old unit = 0.025 m  (72-unit puppet = 1.8 m)
export const STEP = 1 / 60;          // fixed physics step
export const MAX_STEPS_PER_FRAME = 5;

// metres helper: old units -> metres
export const m = (units) => units * SCALE;

// ---- puppet body (old units)
export const PUPPET = {
  height: 72,
  radius: 14,          // matches the old circle-vs-box radius
};

// ---- progressive momentum run (runT): ground speed ramps min -> max over rampT seconds of clean running.
// This is only the plain "hold W" speed. Anything above RUN.max comes from movement skill (air-strafing, b-hops, dash).
export const RUN = {
  min: 210,            // old units / s at runT = 0
  max: 310,            // old units / s once runT >= rampT (the basic ground run cap)
  rampT: 1.0,          // seconds of clean running to reach max
  itBonus: 1.06,       // speed multiplier while the player is IT
  stopDecay: 4,        // runT lost per second with no move input (on the ground)
  wallDecay: 6,        // runT lost per second while pressed against a wall
  wallRatio: 0.5,      // moved / wanted horizontal distance below this = "hitting a wall"
  wallMinSpeed: 120,   // old units / s: only count wall hits when we were actually trying to move this fast
};

// ---- jump (old units)
export const JUMP = {
  impulse: 350,        // upward speed at takeoff, units / s  (apex = impulse^2 / (2 * gravRise) = 72 units, one puppet tall)
  buffer: 0.12,        // s: a jump pressed this long before landing still fires on landing
  coyote: 0.10,        // s: a jump pressed this long after walking off a ledge still works
  gravRise: 850,       // units / s^2 while going up (floaty-free but readable arc)
  gravFall: 1100,      // units / s^2 while falling (heavier = crisper landings)
  // Quake / Source style air control: no horizontal drag in the air. Each tick the wish direction adds speed only while
  // the speed ALONG that direction is below airWishCap, so strafing with the mouse turn keeps adding speed (no top limit).
  doubleJumpImpulse: 320, // upward speed of the air jump, units / s
  maxAirJumps: 1,      // air jumps available after leaving the ground; refilled on the ground and while wall-running
  doubleJumpDir: 70,   // units / s: crisp impulse toward the held keys on an air jump (never lowers horizontal speed)
  airWishCap: 42,      // units / s: the wish speed used for the "how much more can I add" check (small = strafing matters)
  airAccel: 13,        // acceleration factor: max added per tick = airAccel * runSpeed * dt (still limited by the cap check)
  airTurnRate: 2.6,    // 1 / s: while W (input.fwd) is held in the air, this fraction per second (x STEP per tick) of the angle between the velocity and
                       // the wish direction (the camera-relative keys) is rotated away, keeping the horizontal speed (Titanfall-style look-steering; 0 = pure Source strafing)
};

// ---- b-hop: landing opens a short window where ground friction / the run-speed clamp is skipped
export const BHOP = {
  window: 0.22,        // s after landing: speed is preserved; jumping inside it chains a b-hop (forgiving: casual Shift + Space slide-hops hold)
  minAir: 0.05,        // s: time in the air before touching down counts as a landing (filters one-tick grounded flicker)
  bonus: 25,           // units / s added along the movement direction by a b-hop (timing reward)
  maxSpeed: 850,       // units / s: the b-hop bonus never pushes you past this (a higher speed is kept as is)
};

// ---- wall-run + wall-kick (old units). Engages in the air while holding W, fast enough, with a wall beside you.
export const WALLRUN = {
  detectDist: 28,      // wall rays reach PUPPET.radius + detectDist from the body centre
  torso: 36,           // height above the feet where the wall rays are cast
  minSpeed: 220,       // units / s horizontal: slower than this and you do not catch the wall
  minAir: 0.05,        // s in the air before a wall can be caught (filters one-tick grounded flicker, same idea as BHOP.minAir)
  minTangent: 0.3,     // share of your speed that must run ALONG the wall (0.3 ~ within 72 degrees of parallel); head-on hits do not stick
  holdSpeed: 360,      // units / s: wall-running never goes slower than this (a faster speed is kept)
  stick: 60,           // units / s pressed into the wall while running, so the body stays on the surface
  wallGrav: 240,       // units / s^2 gravity while wall-running (normal fall is JUMP.gravFall)
  maxFall: 150,        // units / s: downward speed is clamped to this while wall-running
  kickUp: 360,         // upward speed of the wall-kick
  kickOut: 115,        // speed pushed away from the wall along its normal (small: a clean pop that can curve back onto the next inline panel)
  kickFwd: 85,         // extra speed along the run direction
  regrabCd: 0.25,      // s during which the wall you just kicked off cannot be caught again
  entryUp: 90,         // units / s: upward pop when a wall is caught while FALLING (vy < 0), so runs carry along the whole wall instead of dipping off early
  stickReach: 12,      // units: extra wall-ray reach while ALREADY wall-running (hysteresis): skimming a corner or curving round a pillar keeps the lock
  dropCd: 0.15,        // s after a NATURAL drop (not a wall-kick) in which a catch gets no entryUp pop: grazing a wall end cannot spam the pop
  camTilt: 0.22,       // radians of camera roll while wall-running (leans away from the wall)
  tiltEase: 10,        // 1 / s: attach rate of the damped roll / FOV kick / pivot drop (the release is slower, see camHold)
  camHold: 0.12,       // s the camera keeps the wall-run lean after the physics drops the wall, so a 1-3 tick edge blip never shakes the view
  camFov: 4,           // degrees of extra FOV while wall-running (camera.js)
  camDrop: 8,          // old units (0.2 m): the camera pivot sits this much lower while wall-running (camera.js)
};

// ---- dash burst (F): horizontal launch along the held direction (or facing). Keeps runT and any higher speed.
export const DASH = {
  speed: 540,          // units / s during the dash (never lowers a faster speed)
  duration: 0.2,       // s the direction is locked
  cooldown: 1.3,       // s between dashes
  airGrav: 250,        // units / s^2 while dashing (floaty, so a dash carries across gaps)
  dodgeIframes: 0.16,  // s of Phase-Dodge invulnerability from the moment F triggers a dash (state.dodgeT): a server 'hit' that arrives in this window is ignored locally
};

// ---- grapple / sticky hand (hold E or right mouse): hooks level geometry or another player, pulls you toward the anchor
// while keeping your sideways speed (swing arc). Space while hooked = release with an upward pop.
export const GRAPPLE = {
  maxRange: 1120,      // old units (28 m): longest shot at level geometry
  playerRange: 640,    // old units (16 m): longest shot at another player
  pullAccel: 1450,     // units / s^2 added toward the anchor while hooked
  maxPullSpeed: 780,   // units / s: cap on the speed TOWARD the anchor (sideways speed is untouched, so a swing keeps its arc)
  detachJumpBoost: 180, // units / s: Space while hooked sets vy to at least this on release
  cooldown: 1.6,       // s after any release
  maxDuration: 2.2,    // s a hook can be held
  missCooldown: 0.3,   // s after a shot that hit nothing
  gravity: 450,        // units / s^2 while hooked (lighter than JUMP.gravRise / gravFall, so swings carry)
  detachDist: 72,      // units (1.8 m): reaching the anchor this closely ends the hook (on a player: shove + stun)
  hitStun: 0.4,        // s of stun on a player the hook reaches
  hitShove: 220,       // units / s: minimum shove on that player (away from the grappler)
  aimPad: 20,          // units: aim-assist added to the capsule radius when shooting at players
  torso: 0.6,          // fraction of the current height where the rope leaves the body / the pull is measured from
};

// ---- crouch-slide (old units). Titanfall 2 flow: low friction, hard steering, a flat boost on entry, downhill acceleration.
export const SLIDE = {
  height: 40,          // capsule height while sliding (40 units = 1.0 m; standing is PUPPET.height = 72 = 1.8 m)
  friction: 0.91,      // speed multiplier per SECOND while sliding (applied as friction^dt each tick): slides carry momentum far
  steerAccel: 240,     // units / s^2 of sideways steering toward the held keys (carves the slide, adds no speed)
  boostAdd: 115,       // units / s ADDED to the horizontal speed on slide entry (along the velocity, or the facing when slow)
  maxBoostSpeed: 680,  // the boost never pushes you above this; a faster entry (b-hop / dash / ramp speed) is kept as is, never reduced
  boostCd: 0.75,       // s after a boost before the next slide entry can boost again (no boost spam from a standstill)
  slopeAccel: 650,     // units / s^2 added along the slide direction while sliding DOWNHILL (grounded and the move went down: c.y < -1e-4)
  minSpeed: 60,        // units / s: below this the facing direction is used for the boost, and steering may still creep up to this speed
  resize: 14,          // how fast the capsule height eases between standing and sliding (1 / s)
  entryMinSpeed: 230,  // old units / s: you must be running near full speed (or landing from the air at >= 170, or on a downhill) to START a slide; below this Shift = a plain crouch
  exitSpeed: 150,      // old units / s: a slide that decays below this on flat ground (outside the b-hop window) settles into a crouch instead of drifting on
  crouchSpeed: 125,    // old units / s: steady crouch-walk speed
  landEntrySpeed: 170, // old units / s: the lower entry speed that counts when you just landed from a jump / wall-run / grapple
};

// ---- ledge mantle / vault: an airborne player who is blocked by a ledge top that is 12..48 units above the feet is popped up and over it,
// keeping 100 % of the horizontal speed (wall-kicks and grapples onto decks / skybridges never bonk the lip). See checkLedgeMantle in world.js.
export const MANTLE = {
  maxRise: 48,         // old units: the downward probe starts this far above the feet (a ledge top higher than this is a wall, not a mantle)
  minRise: 12,         // old units: the probe ends this far above the feet (a lower top is just a step: autostep / walking handles it)
  reach: 12,           // old units: the probe sits PUPPET.radius + reach ahead of the body centre (just past the blocking face)
  minNormalY: 0.7,     // the surface under the probe must face up at least this much to count as walkable (cos 45 degrees)
  minSpeed: 60,        // units / s: slower than this is not "moving forward into the ledge"
  popSpeed: 180,       // units / s: minimum upward speed of the pop (the pop is raised to whatever clears the lip, see player.js)
  clear: 3,            // old units: the pop aims this far above the ledge top
  forward: 1.5,        // old units per tick: small forward step added to the move while the mantle window is open (displacement only, no speed)
  window: 0.18,        // s after the last probe hit during which the mantle continues (forward step, keep-climbing, speed kept)
};

// ---- melee: Kinetic Slash (Left-Click). The floating energy blade cleaves a forward cone; a magnetic lunge snaps you onto the target and hands your momentum back.
// The SERVER judges every hit (server.js imports this block) using the numbers below, so client and server can never disagree on reach / damage.
// Damage and knockback scale LINEARLY with the horizontal speed you bring into the swing (dmgSpeedMin -> dmgSpeedMax), so a b-hop / wall-run / grapple slash hits hardest.
export const MELEE = {
  reach: 180,          // old units (4.5 m): forward reach of the cleave (measured to the target's capsule axis, + radiusPad on the server)
  coneCos: 0.65,       // cosine of the half-angle of the cleave cone (~50 degrees each side): generous, the lunge does the rest
  cooldown: 0.55,      // s between slashes (client gate + server gate)
  attackTime: 0.22,    // s the blade swing lasts (player state `attackT`, drives the 140 degree sweep + crescent trail in scene.js)
  baseDmg: 35,         // damage of a slash at (or below) dmgSpeedMin
  maxDmg: 75,          // damage of a slash at (or above) dmgSpeedMax
  dmgSpeedMin: 300,    // units / s: horizontal speed where the damage / knockback scaling starts
  dmgSpeedMax: 760,    // units / s: horizontal speed where it is at full strength (= the soft MAX_FLOW_SPEED ceiling in player.js)
  baseKnock: 420,      // units / s of knockback at dmgSpeedMin (horizontal, along the slash direction)
  maxKnock: 880,       // units / s of knockback at dmgSpeedMax: blasts opponents off the roof
  knockUp: 0.3,        // upward launch = knockUp * horizontal knockback, so a victim leaves the floor (no ground friction) and carries
  lungeSpeed: 560,     // units / s: magnetic lunge speed (never lowers a faster speed)
  lungeDuration: 0.14, // s the lunge lasts (shortened so you stop standOff short of a locked target)
  standOff: 36,        // old units (0.9 m): a magnetic lunge stops this far from the target it locked, so you never overshoot through them
  hitStun: 0.25,       // s a victim cannot steer after any hit (knockback plays out under normal gravity)
  tumbleKnock: 640,    // units / s: a hit with at least this knockback sends the victim's pod tumbling (ragdoll) instead of just a stagger
  tumbleTime: 0.85,    // s the (non-lethal) tumble lasts before the pod stands back up where it came to rest, keeping a little momentum
  koRespawnDelay: 2000,// ms (server): a KO'd pod tumbles this long before the server grants a clean spawn
  voidCredit: 4,       // s (server): a player who falls into the void (respawnReq) this soon after being hit credits the last attacker with the KO
  maxHp: 100,          // hit points of every pod
  regenDelay: 4,       // s (server) without taking damage before hit points come back
  regenRate: 8,        // hit points / s (server) once regeneration has started
  // Slice M3: contextual Left-Click moves (no extra keys). Sliding + LMB = Slide Uppercut, falling (vy < -4 m / s) + LMB = Air Dive Slam.
  uppercutUp: 520,     // old units / s (13.0 m / s): the Uppercut's vertical knock-up on a hit opponent (replaces the normal knockUp part)
  uppercutPop: 220,    // old units / s (5.5 m / s): minimum upward speed YOU get from an uppercut (you rise out of the slide with it)
  diveSpeed: 880,      // old units / s (22.0 m / s): downward speed held during an Air Dive until touchdown
  diveRadius: 120,     // old units (3.0 m): radius of the shockwave ring on touchdown (measured to the target's capsule axis)
  diveMinHeight: 88,   // old units (2.2 m): an Air Dive needs at least this much clear air under your feet (a plain standing jump peaks at 72, so it can never slam)
  diveDmgMin: 35,      // shockwave damage at a drop of diveMinHeight (a regular block / parry / dodge still applies)
  diveDmgMax: 65,      // shockwave damage at a drop of diveMaxHeight or more (high grapple / tower dives)
  diveMaxHeight: 320,  // old units (8.0 m): the drop where the damage scaling tops out
  diveKnockScale: 0.25,// the shockwave knockback grows linearly from x1 (min drop) to x(1 + diveKnockScale) (max drop)
  diveKnock: 560,      // old units / s (14 m / s): horizontal knockback of the shockwave, straight away from the impact point
  diveKnockUp: 0.5,    // upward launch = diveKnockUp * the horizontal shockwave knockback
  diveVertical: 80,    // old units (2.0 m): max vertical gap between the impact point (feet) and a target's feet for the shockwave to hit
  radiusPad: 14,       // old units (0.35 m, the pod radius): server adds this to `reach` because it measures to the capsule axis
  vertical: 88,        // old units (2.2 m): max vertical distance between the two capsule centres for a slash to connect
};

// ---- parry / block (Slice M2, Right-Click). Holding the guard for `duration` s: the first `perfectWindow` s is a PERFECT parry (a slash into it does nothing to the
// defender and staggers + shoves the attacker), the rest is a regular block (damage x blockDmgMult, knockback x blockKnockMult). The SERVER judges it (server.js imports this block).
export const PARRY = {
  duration: 0.55,      // s total guard window
  perfectWindow: 0.22, // s at the start of the guard that count as a perfect parry
  cooldown: 1.15,      // s from the press until the next parry can start
  blockDmgMult: 0.3,   // regular block: 70 % damage reduction
  blockKnockMult: 0.5, // regular block: half the knockback
  attackerStun: 0.65,  // s the attacker of a PERFECT parry is staggered (no steering / actions)
  attackerKnock: 6.0,  // m / s: backward shove on the attacker of a perfect parry (horizontal; the vertical part is MELEE.knockUp of it)
  hitStop: 0.06,       // s camera + blade freeze when a perfect parry happens to you (client juice)
  shakePerfect: 0.09,  // m: camera shake impulse of a perfect parry (client juice)
  flareTime: 0.35,     // s the crosshair flares after "PARRIED!" (client juice)
};

// ---- juice (Slice M1): speed-charged blade, pod lean, hit-stop and camera shake. Purely visual / feel: nothing here touches movement or the server.
export const JUICE = {
  chargeFrom: 300,     // units / s: horizontal speed where the blade starts to charge (= MELEE.dmgSpeedMin)
  chargeTo: 760,       // units / s: speed where the blade is fully charged = full 75 damage lethal slash (= MELEE.dmgSpeedMax)
  bladeGlowMin: 0.6,   // blade emissiveIntensity at chargeFrom (and below)
  bladeGlowMax: 2.4,   // blade emissiveIntensity at chargeTo
  streakFrom: 500,     // units / s: above this the blade's glow trail lengthens (streak behind the hilt + a longer slash crescent)
  streakLen: 1.4,      // m: length of the glow streak at chargeTo
  tiltMax: 0.22,       // rad: most the pod leans into its horizontal movement / dodge direction
  tiltSpeed: 500,      // units / s: speed at which the lean is at full tilt (a dodge always leans fully)
  tiltEase: 12,        // 1 / s: how fast the lean follows (smooth, never snaps)
  heavyDmg: 60,        // damage at or above which YOUR landed hit gets hit-stop + shake (a KO always does)
  hitStop: 0.045,      // s the camera + blade animation freeze when you land a heavy hit / KO
  shakeHeavy: 0.06,    // m: camera shake impulse of a heavy hit you land
  shakeKO: 0.11,       // m: camera shake impulse of a KO you score
  shakeHurt: 0.05,     // m: small shake when a hit sends YOUR pod tumbling
  shakeDecay: 16,      // 1 / s: exponential decay of the shake
  dodgeFlash: 0.35,    // s the crosshair flashes after a "DODGED!"
};

// ---- movement
export const MOVE = {
  accel: 9,            // how fast velocity chases the wanted velocity (old: k = dt * 9)
  stepHeight: 24,      // max step-up, old units
  stick: 8,            // old units: while grounded, ask for this much extra downward move each tick so the puppet stays glued to
                       // a surface that falls away (ramp crests, small drops). Same distance as the controller's snap-to-ground.
};

// ---- camera (old units where it makes sense)
export const CAM = {
  dist: 150,           // boom length behind the puppet
  height: 36,          // lift above the pivot at full distance
  pivot: 55,           // pivot height above the puppet's feet (chest/eye)
  pad: 8,              // gap kept between camera and a wall
  minDist: 4,
  mouseSens: 0.0025,   // radians per pixel
  pitchMin: -0.5,
  pitchMax: 1.2,
  fov: 75,
  fovWarp: 15,         // degrees of extra FOV at full speed
  fovWarpFrom: 300,    // units / s: horizontal speed where the warp starts
  fovWarpTo: 750,      // units / s: horizontal speed where the warp is at full strength
  fovWarpEase: 6,      // 1 / s: how fast the FOV follows
};

// ---- landing camera dip (camera.js triggerLandDip): the pivot dips on a hard landing and rebounds, so touchdowns have weight
export const LAND = {
  minVy: 4,            // m / s: only a fall faster than this (vy < -4) triggers the dip
  dip: 0.15,           // metres of pivot drop at a hard landing (softer landings dip less)
  time: 0.2,           // s for the whole dip + rebound
};

// ---- map (the map data itself lives in game/maps.js; these are the map-wide settings, old units)
export const MAP = {
  floorThickness: 20,  // depth of the rooftop floor slabs below y = 0 (0.5 m)
  fallY: -480,         // old units (-12 m): the feet below this = fell off the roof / through a skylight -> respawn
  spawn: 0,            // default index into the map's spawns list (override with ?spawn=N in the page URL)
};
