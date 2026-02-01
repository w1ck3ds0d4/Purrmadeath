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

  // ── Session ───────────────────────────────────────────────────────────────
  /** Client → Server: create a new session (host) */
  SESSION_CREATE = 'SESSION_CREATE',
  /** Client → Server: join an existing session */
  SESSION_JOIN = 'SESSION_JOIN',
  /** Client → Server: leave the current session */
  SESSION_LEAVE = 'SESSION_LEAVE',
  /** Server → Client: acknowledge SESSION_CREATE/JOIN, send session metadata */
  SESSION_ACK = 'SESSION_ACK',
  /** Server → all: a new player joined the lobby */
  PLAYER_JOINED = 'PLAYER_JOINED',
  /** Server → all: a player left the lobby or game */
  PLAYER_LEFT = 'PLAYER_LEFT',
  /** Server → all remaining clients: host left — session is closed */
  SESSION_CLOSED = 'SESSION_CLOSED',
  /** Server → all: full lobby state snapshot (slot list) */
  SESSION_STATE = 'SESSION_STATE',
  /** Client (host) → Server: start the game */
  SESSION_START = 'SESSION_START',
  /** Server → all: game is about to start, here is the seed */
  SESSION_STARTING = 'SESSION_STARTING',

  // ── World sync ────────────────────────────────────────────────────────────
  /** Server → Client: full entity snapshot (on game start / rejoin) */
  SNAPSHOT = 'SNAPSHOT',
  /** Server → all: per-tick entity delta */
  DELTA = 'DELTA',
  CHUNK_REQUEST = 'CHUNK_REQUEST',
  CHUNK_DATA = 'CHUNK_DATA',

  // ── Input ─────────────────────────────────────────────────────────────────
  /** Client → Server: input frame */
  INPUT = 'INPUT',

  // ── Chat ──────────────────────────────────────────────────────────────────
  CHAT = 'CHAT',
}

// ─── Base ─────────────────────────────────────────────────────────────────────

export interface BaseMessage {
  type: string;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

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

// ─── Session ──────────────────────────────────────────────────────────────────

export interface SessionCreateMessage extends BaseMessage {
  type: typeof MessageType.SESSION_CREATE;
}

export interface SessionJoinMessage extends BaseMessage {
  type: typeof MessageType.SESSION_JOIN;
  sessionId: string;
}

export interface SessionLeaveMessage extends BaseMessage {
  type: typeof MessageType.SESSION_LEAVE;
}

/** Sent to the joining/hosting client after SESSION_CREATE or SESSION_JOIN. */
export interface SessionAckMessage extends BaseMessage {
  type: typeof MessageType.SESSION_ACK;
  sessionId: string;
  /** 4-letter uppercase session code shown in the lobby (e.g. "MEOW"). */
  code: string;
  /** World generation seed shared by all players. */
  seed: number;
  /** The player slot index (0–3) assigned to this client. */
  slot: number;
  /** Server-assigned playerId for this client. */
  playerId: string;
  /** True if this client is the host (controls Start). */
  isHost: boolean;
  /** Snapshot of all current lobby slots. */
  players: LobbySlot[];
}

export interface LobbySlot {
  playerId: string;
  displayName: string;
  slot: number;
  isHost: boolean;
}

export interface PlayerJoinedMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_JOINED;
  player: LobbySlot;
}

export interface PlayerLeftMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_LEFT;
  playerId: string;
  slot: number;
}

export interface SessionClosedMessage extends BaseMessage {
  type: typeof MessageType.SESSION_CLOSED;
  reason: string;
}

/** Full lobby state broadcast (re-sync on reconnect or missed events). */
export interface SessionStateMessage extends BaseMessage {
  type: typeof MessageType.SESSION_STATE;
  players: LobbySlot[];
}

export interface SessionStartMessage extends BaseMessage {
  type: typeof MessageType.SESSION_START;
}

/** Server broadcasts this when the game is starting. */
export interface SessionStartingMessage extends BaseMessage {
  type: typeof MessageType.SESSION_STARTING;
  seed: number;
  /** Positions for each player slot { slot → [worldX, worldY] } */
  spawnPositions: Record<number, [number, number]>;
}

// ─── World sync ───────────────────────────────────────────────────────────────

/** Component data for a single entity in a snapshot or delta. */
export interface EntitySnapshot {
  entityId: number;
  /** Slot index if this is a player entity. */
  slot?: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
}

/** Full world snapshot sent on game start or player rejoin. */
export interface SnapshotMessage extends BaseMessage {
  type: typeof MessageType.SNAPSHOT;
  tick: number;
  entities: EntitySnapshot[];
}

/** Per-tick delta — only changed entities. */
export interface DeltaMessage extends BaseMessage {
  type: typeof MessageType.DELTA;
  tick: number;
  /** Last client input sequence number the server processed for this client. */
  lastSeq: number;
  entities: EntitySnapshot[];
  /** Entity IDs removed since last tick. */
  removed: number[];
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface InputMessage extends BaseMessage {
  type: typeof MessageType.INPUT;
  /** Client-side sequence number for prediction reconciliation. */
  seq: number;
  /** Normalised movement vector [-1..1]. */
  dx: number;
  dy: number;
  /** Timestamp (performance.now()) the input was sampled. */
  t: number;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatMessage extends BaseMessage {
  type: typeof MessageType.CHAT;
  /** Sender's display name (set by server on broadcast). */
  displayName: string;
  /** Sender's slot (set by server). */
  slot: number;
  text: string;
}

/** Client → Server chat (no displayName/slot — server fills those). */
export interface ChatSendMessage extends BaseMessage {
  type: typeof MessageType.CHAT;
  text: string;
  displayName?: undefined;
  slot?: undefined;
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type AnyMessage =
  | HandshakeMessage
  | HandshakeAckMessage
  | ErrorMessage
  | SessionCreateMessage
  | SessionJoinMessage
  | SessionLeaveMessage
  | SessionAckMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | SessionClosedMessage
  | SessionStateMessage
  | SessionStartMessage
  | SessionStartingMessage
  | SnapshotMessage
  | DeltaMessage
  | InputMessage
  | ChatMessage
  | BaseMessage;
