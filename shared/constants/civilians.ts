/**
 * Civilian constants - population, hunger, housing, names, specialization.
 */

// ─── Civilians (Phase 8) ──────────────────────────────────────────────────

/** Collision/render radius of a civilian in world pixels. */
export const CIVILIAN_RADIUS = 8;
/** Base walk speed for civilians (px/s). */
export const CIVILIAN_SPEED = 50;
/** Civilian max HP. */
export const CIVILIAN_MAX_HP = 30;
/** Speed when fleeing from enemies (px/s). */
export const CIVILIAN_FLEE_SPEED = 100;
/** Distance (px) at which civilians start fleeing from enemies. */
export const CIVILIAN_FLEE_RANGE = 200;
/** Range (px) a civilian must be within to count as "at work". */
export const CIVILIAN_WORK_RANGE = 50;

/** Seconds between hunger ticks. */
export const CIVILIAN_HUNGER_INTERVAL = 60;
/** Hunger increase per tick when no food is available. */
export const CIVILIAN_HUNGER_PER_TICK = 10;
/** Food consumed from warehouse per hunger tick. */
export const CIVILIAN_FOOD_CONSUME = 1;
/** Damage per tick when hunger reaches 100. */
export const CIVILIAN_STARVATION_DAMAGE = 5;

/** Number of civilians that spawn at game start. */
export const CIVILIAN_INITIAL_COUNT = 2;
/** A new civilian spawns every N cleared waves (if housing allows). */
export const CIVILIAN_SPAWN_WAVE_INTERVAL = 3;
/** Hard cap on total civilian population. */
export const CIVILIAN_MAX_POPULATION = 20;
/** Base campfire housing capacity (flat, used as fallback). */
export const CAMPFIRE_HOUSING_CAPACITY = 2;
/** Campfire housing capacity per upgrade level (levels 1-5). */
export const CAMPFIRE_HOUSING_PER_LEVEL = [2, 4, 6, 8, 10];
/** Number of civilians spawned on wave clear after a campfire level-up. */
export const CAMPFIRE_SPAWN_ON_LEVELUP = 2;

/** Seconds a speech bubble stays visible. */
export const CIVILIAN_SPEECH_DURATION = 4;
/** Seconds a downed civilian bleeds out before dying permanently. */
export const CIVILIAN_BLEED_TIME = 30;

/** Housing capacity per upgrade level for cat_house. */
export const CAT_HOUSE_CAPACITY = [2, 3, 4];

// ── Civilian Specialization ───────────────────────────────────────────────
export const CIVILIAN_SPECIALIZATION_THRESHOLD = 5;
export const CIVILIAN_SPECIALTY_BONUS = 0.75;
