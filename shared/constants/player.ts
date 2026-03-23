/**
 * Player constants - class stats, movement, stamina, carry limits,
 * dodge roll, critical hits, death/respawn, and wave wipe penalties.
 */

// ─── Player ───────────────────────────────────────────────────────────────────

/** Collision and render radius of the player circle in world pixels. */
export const PLAYER_RADIUS = 12;

/** Base movement speed in world pixels per second. */
export const PLAYER_BASE_SPEED = 180;

/** Full health at spawn. */
export const PLAYER_MAX_HEALTH = 100;

/** Per-resource carry limits for players. Gold is unlimited (Infinity). */
export const PLAYER_CARRY_LIMITS: Record<string, number> = {
  wood: 100,
  stone: 50,
  iron: 50,
  diamond: 50,
  gold: Infinity,
};

/** Full stamina at spawn. */
export const PLAYER_MAX_STAMINA = 100;

/** Stamina recovered per second while passive (not sprinting). */
export const PLAYER_STAMINA_REGEN = 15;

/**
 * One color per player slot (index 0-3).
 * P1=blue - P2=red - P3=green - P4=yellow
 */
export const PLAYER_COLORS: readonly number[] = [
  0x4a90d9, // P1 - blue
  0x9944cc, // P2 - purple
  0x52c062, // P3 - green
  0xe0a830, // P4 - yellow
];

/** Speed multiplier applied while sprinting. */
export const PLAYER_SPRINT_MULTIPLIER = 1.5;

/** Stamina drained per second while sprinting. */
export const PLAYER_SPRINT_STAMINA_DRAIN = 30;

// ─── Dodge Roll ──────────────────────────────────────────────────────────────
export const DODGE_ROLL_DURATION = 0.2;
export const DODGE_ROLL_COOLDOWN = 0.6;
export const DODGE_ROLL_SPEED = 300;
export const DODGE_ROLL_STAMINA_COST = 25;

// ─── Critical Hits ───────────────────────────────────────────────────────────
export const CRIT_CHANCE = 0.10;
export const CRIT_MULTIPLIER = 2.0;

// ─── Death & Respawn (4.11) ───────────────────────────────────────────

/** Seconds a downed player has before they fully die (bleed-out timer). */
export const DOWNED_BLEED_TIME = 30;
/** Seconds a teammate must stay near a downed player to complete a revive. */
export const REVIVE_DURATION = 5;
/** HP restored on revive as a fraction of max HP (0.3 = 30%). */
export const REVIVE_HP_PERCENT = 0.3;
/** Seconds after full death before the player respawns at origin. */
export const RESPAWN_DELAY = 8;
/** Max distance (px) between reviver and downed player for revive to work. */
export const REVIVE_RANGE = 50;

// ─── Wave Wipe (4.12) ────────────────────────────────────────────────

/** Fraction of resources lost on first party wipe (0.25 = 25%). */
export const WIPE_1_RESOURCE_LOSS_PERCENT = 0.25;
