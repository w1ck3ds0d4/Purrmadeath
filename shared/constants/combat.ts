/**
 * Combat constants - enemy stats, melee/ranged combat, enemy AI,
 * wave difficulty scaling, and portals.
 */

// ─── Enemy ────────────────────────────────────────────────────────────────────

/** Collision radius of an enemy in world pixels. */
export const ENEMY_RADIUS = 10;

/** Base movement speed for enemies in world pixels per second. */
export const ENEMY_BASE_SPEED = 75;

/** Starting health for a basic enemy. */
export const ENEMY_MAX_HEALTH = 40;

/** Distance (px) at which an enemy begins chasing the nearest player. */
export const ENEMY_AGGRO_RANGE = 500;

/** Number of test enemies spawned on game start (replaced by portals in 4.7). */
export const ENEMY_INITIAL_COUNT = 5;

/** Base melee damage dealt by enemies (before defense reduction). */
export const ENEMY_MELEE_DAMAGE = 10;

/** Melee reach for enemies in world pixels (shorter than player's 60). */
export const ENEMY_MELEE_RANGE = 40;

/** Seconds between enemy melee swings (slower than player's 0.5). */
export const ENEMY_MELEE_COOLDOWN = 1.0;

/** Knockback impulse applied to a player struck by an enemy (px/s). */
export const ENEMY_MELEE_KNOCKBACK = 200;

// ─── Enemy ranger variant ───────────────────────────────────────────────────

/** Chance (0-1) for a spawned enemy to be a ranger instead of melee. */
export const ENEMY_RANGER_SPAWN_CHANCE = 0.3;

/** Ranger firing range in world pixels. */
export const ENEMY_RANGER_RANGE = 200;

/** Seconds between ranger shots. */
export const ENEMY_RANGER_COOLDOWN = 2.0;

/** Damage per ranger projectile. */
export const ENEMY_RANGER_DAMAGE = 8;

/** Ranger projectile speed (px/s). */
export const ENEMY_RANGER_PROJECTILE_SPEED = 300;

/** Ranger base movement speed - slightly slower than melee. */
export const ENEMY_RANGER_SPEED = 60;

/** Ranger health - slightly less than melee. */
export const ENEMY_RANGER_HEALTH = 30;

// ─── Wave difficulty scaling ────────────────────────────────────────────────

/** Compound HP multiplier per wave: enemy HP = base x (1 + scale)^(wave-1). */
export const ENEMY_HP_SCALE_PER_WAVE = 0.02;

/** Compound damage multiplier per wave. */
export const ENEMY_DAMAGE_SCALE_PER_WAVE = 0.01;

/** Every N waves, portals spawn +1 enemy per spawn interval. */
export const PORTAL_EXTRA_SPAWN_EVERY_N_WAVES = 3;

// ─── Enemy AI (Pathfinding & Navigation) ────────────────────────────────────

/** How often (seconds) to recompute an enemy's A* path. */
export const ENEMY_REPLAN_INTERVAL = 0.5;
/** If target moved more than this many pixels, force a path replan. */
export const ENEMY_REPLAN_DIST_THRESHOLD = 64;
/** Distance (px) at which an A* waypoint is considered reached. */
export const ENEMY_WAYPOINT_REACH = 16;
/** Stuck detection: minimum movement distance (px) within ENEMY_STUCK_TIME. */
export const ENEMY_STUCK_DIST = 8;
/** Stuck detection: time window (seconds). */
export const ENEMY_STUCK_TIME = 1;
/** Local obstacle avoidance: forward scan distance (px). */
export const ENEMY_AVOIDANCE_LOOK_AHEAD = 48;
/** Local obstacle avoidance: extra padding beyond collision radii (px). */
export const ENEMY_AVOIDANCE_MARGIN = 8;
/** Local obstacle avoidance: perpendicular steering blend multiplier. */
export const ENEMY_AVOIDANCE_STRENGTH = 1.5;

// ─── Melee combat ─────────────────────────────────────────────────────────────

/** Reach of a melee swing in world pixels. */
export const MELEE_RANGE = 60;
/** Full swing arc in radians (120 deg). Hit is within +/-60 deg of facing. */
export const MELEE_ARC = (2 * Math.PI) / 3;
/** Base damage per melee hit (before defense reduction). */
export const MELEE_DAMAGE = 15;
/** Seconds between melee swings. */
export const MELEE_COOLDOWN = 0;
/** Knockback impulse speed applied to the struck entity (px/s). */
export const MELEE_KNOCKBACK = 250;

// ─── Ranged combat ──────────────────────────────────────────────────────────

/** Base damage per ranged hit (before defense reduction). */
export const RANGED_DAMAGE = 10;
/** Seconds between ranged shots. */
export const RANGED_COOLDOWN = 0;
/** Projectile travel speed in world pixels per second. */
export const RANGED_SPEED = 400;
/** Seconds before a projectile despawns (~500 px range at 400 px/s). */
export const RANGED_LIFETIME = 1.25;
/** Knockback impulse applied to the struck entity by a projectile (px/s). */
export const RANGED_KNOCKBACK = 0;
/** Collision radius of a projectile in world pixels. */
export const PROJECTILE_RADIUS = 4;
/** Homing projectile turn rate in radians per second (mage). */
export const HOMING_TURN_RATE = 8;
/** Homing projectile detection range in world pixels. */
export const HOMING_DETECT_RANGE = 300;

// ─── Waves & Portals ─────────────────────────────────────────────────────

/** Seconds of prep time before wave 1 begins. */
export const WAVE_PREP_INITIAL = 180;

/** Seconds of prep time between subsequent waves. */
export const WAVE_PREP_BETWEEN = 60;

/** Base portal health for wave 1. */
export const PORTAL_BASE_HP = 100;

/** Additional portal health per wave number. */
export const PORTAL_HP_PER_WAVE = 20;

/** Base seconds between enemy spawns from a portal. */
export const PORTAL_BASE_SPAWN_INTERVAL = 10;

/** Multiplicative decay applied to spawn interval each wave (faster spawning). */
export const PORTAL_SPAWN_INTERVAL_DECAY = 0.9;

/** Number of portals spawned for wave 1. */
export const PORTALS_PER_WAVE_BASE = 1;

/** Additional portals per wave beyond wave 1 (0.5 = +1 portal every 2 waves). */
export const PORTALS_PER_WAVE_GROWTH = 0.5;

/** Minimum distance (px) from player centroid to place portals. */
export const PORTAL_MIN_DIST = 400;

/** Maximum distance (px) from player centroid to place portals. */
export const PORTAL_MAX_DIST = 800;

/** Minimum distance (px) between two portals. */
export const PORTAL_MIN_SPACING = 200;

/** Collision/render radius of a portal in world pixels. */
export const PORTAL_RADIUS = 18;

// ─── Boss System ────────────────────────────────────────────────────────

/** Boss spawns every N waves. */
export const BOSS_SPAWN_INTERVAL = 5;
/** First wave a boss can appear. */
export const BOSS_FIRST_WAVE = 10;
/** Card drop spawns at campfire every N waves. */
export const MILESTONE_CARD_INTERVAL = 10;
