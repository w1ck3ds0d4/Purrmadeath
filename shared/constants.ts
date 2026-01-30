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

/** Maximum messages a single client may send per second before being disconnected. */
export const MAX_MESSAGES_PER_SECOND = 60;

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