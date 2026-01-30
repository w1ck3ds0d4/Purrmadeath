// ─── Message type registry ───────────────────────────────────────────────────
// Every WebSocket message carries a `type` field from this enum.
// Add new types here as phases are implemented — never inline magic strings.

export enum MessageType {
  // ── Lifecycle ──────────────────────────────────────────────────────────────
  /** Client → Server on connect: identify self */
  HANDSHAKE = 'HANDSHAKE',
  /** Server → Client: confirm connection, assign client ID */
  HANDSHAKE_ACK = 'HANDSHAKE_ACK',

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  PING = 'PING',
  PONG = 'PONG',

  // ── Errors ────────────────────────────────────────────────────────────────
  ERROR = 'ERROR',

  // ── Session (Phase 3+) ────────────────────────────────────────────────────
  SESSION_CREATE = 'SESSION_CREATE',
  SESSION_JOIN = 'SESSION_JOIN',
  SESSION_LEAVE = 'SESSION_LEAVE',
  SESSION_STATE = 'SESSION_STATE',

  // ── World sync (Phase 3+) ─────────────────────────────────────────────────
  SNAPSHOT = 'SNAPSHOT',
  DELTA = 'DELTA',
  CHUNK_REQUEST = 'CHUNK_REQUEST',
  CHUNK_DATA = 'CHUNK_DATA',

  // ── Input (Phase 3+) ──────────────────────────────────────────────────────
  INPUT = 'INPUT',

  // ── Chat (Phase 3+) ───────────────────────────────────────────────────────
  CHAT = 'CHAT',
}

// ─── Base ─────────────────────────────────────────────────────────────────────

export interface BaseMessage {
  type: string;
}

// ─── Lifecycle payloads ───────────────────────────────────────────────────────

export interface HandshakeMessage extends BaseMessage {
  type: typeof MessageType.HANDSHAKE;
  /** Display name chosen by the player. */
  displayName: string;
}

export interface HandshakeAckMessage extends BaseMessage {
  type: typeof MessageType.HANDSHAKE_ACK;
  /** Unique ID assigned by the server for this connection. */
  clientId: string;
  /** Current server tick number (for clock sync). */
  serverTick: number;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export interface ErrorMessage extends BaseMessage {
  type: typeof MessageType.ERROR;
  code: string;
  message: string;
}

// ─── Union (add new message types here as phases are implemented) ─────────────

export type AnyMessage =
  | HandshakeMessage
  | HandshakeAckMessage
  | ErrorMessage
  | BaseMessage;