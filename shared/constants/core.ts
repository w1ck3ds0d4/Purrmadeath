/**
 * Core game constants - network, connection, session, world grid,
 * interpolation, day/night cycle, status effects, and miscellaneous.
 */

// ─── Network ────────────────────────────────────────────────────────────────

/** Port the WebSocket game server listens on. */
export const SERVER_PORT = 7777;

/** How many ticks the server runs per second (authoritative game clock). */
export const TICK_RATE = 30;

/** Milliseconds between server ticks. */
export const TICK_MS = 1000 / TICK_RATE;

/** Client sends a PING every N ms to keep the connection alive. */
export const PING_INTERVAL_MS = 2_000;

/** Server drops a client that hasn't responded within this window. */
export const HEARTBEAT_TIMEOUT_MS = 120_000;

/** Maximum WebSocket message size in bytes. Prevents memory exhaustion from oversized payloads. */
export const MAX_MESSAGE_BYTES = 64 * 1024; // 64 KB

/** Maximum messages a single client may send per second before being disconnected.
 *  Clients send one INPUT per render frame; allow headroom for 240 Hz + chat + pings. */
export const MAX_MESSAGES_PER_SECOND = 500;

// ─── Connection ─────────────────────────────────────────────────────────────

/** Hard cap on total WebSocket connections the server accepts (idle + in-game). */
export const MAX_CONNECTIONS = 16;

/** Semantic version string - compared in HANDSHAKE for version gating. */
export const GAME_VERSION = '1.2.3';

/** Milliseconds a disconnected player's slot is held before removal. */
export const RECONNECT_GRACE_MS = 30_000;

// ─── Session ─────────────────────────────────────────────────────────────────

/** Maximum number of players per session. */
export const MAX_PLAYERS = 4;

// ─── World ───────────────────────────────────────────────────────────────────

/** Width and height of a single tile in pixels (at 1x zoom). */
export const TILE_SIZE = 32;

/** Number of tiles along each axis of one chunk (chunk = CHUNK_SIZE x CHUNK_SIZE tiles). */
export const CHUNK_SIZE = 32;

/** How many chunks around the player are kept loaded. */
export const VIEW_RADIUS_CHUNKS = 3;

// ─── Anti-exploit (4.13) ──────────────────────────────────────────────────

/** Max distance (px) between client-reported and server position for attacks.
 *  Beyond this, the server substitutes its own authoritative position. */
export const MAX_ATTACK_POSITION_TOLERANCE = 80;

// ─── Entity Collision ─────────────────────────────────────────────────────

/** Iterations of the entity-entity separation pass per tick.
 *  More iterations = better chain resolution, but costs O(n^2) each. */
export const ENTITY_SEPARATION_ITERATIONS = 3;

// ─── Remote Player Interpolation ────────────────────────────────────────────

/** Lerp speed toward extrapolated target. Higher = snappier, lower = smoother. */
export const REMOTE_PLAYER_INTERP_SPEED = 25;
/** Hard-snap if entity is farther than this from its target (px). */
export const REMOTE_PLAYER_SNAP_DIST = 200;
/** Max seconds of velocity extrapolation to cap prediction on lag spikes. */
export const REMOTE_PLAYER_MAX_EXTRAP = 0.15;

// ─── Day/Night Cycle (Phase 9) ─────────────────────────────────────────────

/** Maximum seconds the day phase lasts before forced night. */
export const DAY_MAX_DURATION = 300;

/** Duration of dusk/dawn transitions in seconds. */
export const DUSK_DAWN_DURATION = 5;

/** Night enemy damage multiplier. */
export const NIGHT_ENEMY_DAMAGE_BUFF = 1.15;

/** Night enemy speed multiplier. */
export const NIGHT_ENEMY_SPEED_BUFF = 1.10;

/** Maximum overlay opacity at full night (0-1). */
export const NIGHT_DARKNESS_ALPHA = 0.92;

/** Player torch (light) radius in world pixels during night. */
export const TORCH_RADIUS = 140;

/** Warm yellow tint for player torch light (0xRRGGBB). */
export const TORCH_COLOR = 0xffcc55;

/** Portal light radius in world pixels during night. */
export const PORTAL_LIGHT_RADIUS = 90;

/** Minimap vision multiplier during night (0-1). */
export const NIGHT_VISION_MULT = 0.6;

/** How often (seconds) the server broadcasts DAY_NIGHT_SYNC. */
export const DAY_NIGHT_SYNC_INTERVAL = 2;

// ── Status effect bitmask (synced via EntitySnapshot.statusEffects) ────────
export const STATUS_BURN    = 1;
export const STATUS_POISON  = 2;
export const STATUS_SLOW    = 4;
export const STATUS_STUN    = 8;
export const STATUS_HOLY    = 16;
export const STATUS_SHADOW  = 32;
export const STATUS_ARCANE  = 64;
export const STATUS_NATURE  = 128;

// ── Element colors (for damage number tinting) ────────────────────────────
export const ELEMENT_COLORS: Record<string, number> = {
  fire:    0xff6622,
  ice:     0x44aaff,
  poison:  0x44dd44,
  thunder: 0xffdd44,
  holy:    0xffe866,
  shadow:  0x9944dd,
  arcane:  0xdd44ff,
  nature:  0x66cc44,
};

/** Pool of cat names for civilians. */
export const CAT_NAMES: string[] = [
  'Whiskers', 'Mittens', 'Mochi', 'Biscuit', 'Pudding',
  'Luna', 'Salem', 'Ginger', 'Cinnamon', 'Pepper',
  'Noodle', 'Waffle', 'Tofu', 'Muffin', 'Pickle',
  'Smokey', 'Shadow', 'Patches', 'Marble', 'Caramel',
  'Clover', 'Peanut', 'Sprout', 'Toffee', 'Churro',
  'Sesame', 'Basil', 'Olive', 'Truffle', 'Fig',
];

export const WOLF_NAMES: string[] = [
  'Fang', 'Storm', 'Ghost', 'Shadow', 'Blaze',
  'Frost', 'Ash', 'Thorn', 'Howl', 'Feral',
  'Ember', 'Claw', 'Rune', 'Dusk', 'Grim',
  'Bolt', 'Snarl', 'Onyx', 'Flint', 'Wisp',
];
