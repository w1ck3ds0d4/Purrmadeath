// ─── Network ────────────────────────────────────────────────────────────────

/** Port the WebSocket game server listens on. */
export const SERVER_PORT = 7777;

/** How many ticks the server runs per second (authoritative game clock). */
export const TICK_RATE = 20;

/** Milliseconds between server ticks. */
export const TICK_MS = 1000 / TICK_RATE;

/** Client sends a PING every N ms to keep the connection alive. */
export const PING_INTERVAL_MS = 15_000;

/** Server drops a client that hasn't responded within this window. */
export const HEARTBEAT_TIMEOUT_MS = 60_000;

/** Maximum WebSocket message size in bytes. Prevents memory exhaustion from oversized payloads. */
export const MAX_MESSAGE_BYTES = 64 * 1024; // 64 KB

/** Maximum messages a single client may send per second before being disconnected.
 *  Clients send one INPUT per render frame; allow headroom for 240 Hz + chat + pings. */
export const MAX_MESSAGES_PER_SECOND = 300;

// ─── Connection ─────────────────────────────────────────────────────────────

/** Hard cap on total WebSocket connections the server accepts (idle + in-game). */
export const MAX_CONNECTIONS = 16;

/** Semantic version string — compared in HANDSHAKE for version gating. */
export const GAME_VERSION = '1.0.3';

/** Milliseconds a disconnected player's slot is held before removal. */
export const RECONNECT_GRACE_MS = 30_000;

// ─── Session ─────────────────────────────────────────────────────────────────

/** Maximum number of players per session. */
export const MAX_PLAYERS = 4;

// ─── World ───────────────────────────────────────────────────────────────────

/** Width and height of a single tile in pixels (at 1× zoom). */
export const TILE_SIZE = 32;

/** Number of tiles along each axis of one chunk (chunk = CHUNK_SIZE × CHUNK_SIZE tiles). */
export const CHUNK_SIZE = 32;

/** How many chunks around the player are kept loaded. */
export const VIEW_RADIUS_CHUNKS = 3;

// ─── Player ───────────────────────────────────────────────────────────────────

/** Collision and render radius of the player circle in world pixels. */
export const PLAYER_RADIUS = 12;

/** Base movement speed in world pixels per second. */
export const PLAYER_BASE_SPEED = 180;

/** Full health at spawn. */
export const PLAYER_MAX_HEALTH = 100;

/** Full stamina at spawn. */
export const PLAYER_MAX_STAMINA = 100;

/** Stamina recovered per second while passive (not sprinting). */
export const PLAYER_STAMINA_REGEN = 15;

/**
 * One color per player slot (index 0–3).
 * P1=blue · P2=red · P3=green · P4=yellow
 */
export const PLAYER_COLORS: readonly number[] = [
  0x4a90d9, // P1 — blue
  0xe05252, // P2 — red
  0x52c062, // P3 — green
  0xe0a830, // P4 — yellow
];

/** Speed multiplier applied while sprinting. */
export const PLAYER_SPRINT_MULTIPLIER = 1.5;

/** Stamina drained per second while sprinting. */
export const PLAYER_SPRINT_STAMINA_DRAIN = 30;

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

// ─── Melee combat ─────────────────────────────────────────────────────────────

/** Reach of a melee swing in world pixels. */
export const MELEE_RANGE = 60;
/** Full swing arc in radians (120°). Hit is within ±60° of facing. */
export const MELEE_ARC = (2 * Math.PI) / 3;
/** Base damage per melee hit (before defense reduction). */
export const MELEE_DAMAGE = 15;
/** Seconds between melee swings. */
export const MELEE_COOLDOWN = 0.5;
/** Knockback impulse speed applied to the struck entity (px/s). */
export const MELEE_KNOCKBACK = 250;

// ─── Ranged combat ──────────────────────────────────────────────────────────

/** Base damage per ranged hit (before defense reduction). */
export const RANGED_DAMAGE = 10;
/** Seconds between ranged shots. */
export const RANGED_COOLDOWN = 0.8;
/** Projectile travel speed in world pixels per second. */
export const RANGED_SPEED = 400;
/** Seconds before a projectile despawns (~500 px range at 400 px/s). */
export const RANGED_LIFETIME = 1.25;
/** Knockback impulse applied to the struck entity by a projectile (px/s). */
export const RANGED_KNOCKBACK = 0;
/** Collision radius of a projectile in world pixels. */
export const PROJECTILE_RADIUS = 4;

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
export const PORTAL_BASE_SPAWN_INTERVAL = 8;

/** Multiplicative decay applied to spawn interval each wave (faster spawning). */
export const PORTAL_SPAWN_INTERVAL_DECAY = 0.85;

/** Number of portals spawned for wave 1. */
export const PORTALS_PER_WAVE_BASE = 1;

/** Additional portals per wave beyond wave 1. */
export const PORTALS_PER_WAVE_GROWTH = 1;

/** Minimum distance (px) from player centroid to place portals. */
export const PORTAL_MIN_DIST = 400;

/** Maximum distance (px) from player centroid to place portals. */
export const PORTAL_MAX_DIST = 800;

/** Minimum distance (px) between two portals. */
export const PORTAL_MIN_SPACING = 200;

/** Collision/render radius of a portal in world pixels. */
export const PORTAL_RADIUS = 18;

// ─── Resource Nodes ─────────────────────────────────────────────────────

/** Collision/render radius of a resource node in world pixels. */
export const RESOURCE_NODE_RADIUS = 14;

export const TREE_MAX_HEALTH = 30;
export const TREE_WOOD_YIELD = 5;
export const STONE_MAX_HEALTH = 50;
export const STONE_YIELD = 3;
export const IRON_MAX_HEALTH = 80;
export const IRON_YIELD = 2;
export const DIAMOND_MAX_HEALTH = 120;
export const DIAMOND_YIELD = 1;

/** Chunks around spawn origin to populate with resource nodes. */
export const RESOURCE_SPAWN_RADIUS_CHUNKS = 5;
/** Performance cap on total resource node entities. */
export const MAX_RESOURCE_NODES = 400;

// ─── Item Drops ─────────────────────────────────────────────────────────

/** Render radius of an item drop in world pixels. */
export const ITEM_DROP_RADIUS = 8;
/** Seconds before an uncollected item drop despawns. */
export const ITEM_DROP_LIFETIME = 60;
/** Auto-pickup radius in world pixels. */
export const ITEM_DROP_PICKUP_RADIUS = 28;
/** E-interact pickup radius in world pixels. */
export const ITEM_DROP_INTERACT_RADIUS = 40;
/** Initial scatter velocity when an item drop spawns (px/s). */
export const ITEM_DROP_SCATTER_SPEED = 120;
/** Friction decay rate for item drop scatter velocity. */
export const ITEM_DROP_FRICTION = 6;

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

// ─── Anti-exploit (4.13) ──────────────────────────────────────────────

/** Max distance (px) between client-reported and server position for attacks.
 *  Beyond this, the server substitutes its own authoritative position. */
export const MAX_ATTACK_POSITION_TOLERANCE = 80;

// ─── Entity Collision ─────────────────────────────────────────────────

/** Iterations of the entity-entity separation pass per tick.
 *  More iterations = better chain resolution, but costs O(n²) each. */
export const ENTITY_SEPARATION_ITERATIONS = 2;