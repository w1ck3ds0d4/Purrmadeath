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

  // ── Combat ────────────────────────────────────────────────────────────────
  /** Client → Server: player attack action (melee or ranged) */
  ATTACK = 'ATTACK',
  /** Server → all: a player performed an attack (for remote arc animation, fires even on miss) */
  ATTACK_PERFORMED = 'ATTACK_PERFORMED',
  /** Server → all: an attack landed on a target */
  HIT = 'HIT',
  /** Server → all: a projectile was spawned (ranged attack). */
  PROJECTILE_SPAWN = 'PROJECTILE_SPAWN',
  /** Server → all: a projectile was destroyed (hit, wall, or expired). */
  PROJECTILE_REMOVE = 'PROJECTILE_REMOVE',

  // ── Pause ────────────────────────────────────────────────────────────────
  /** Client → Server: player votes to pause or resume (toggle). */
  PAUSE_VOTE = 'PAUSE_VOTE',
  /** Server → all: intermediate vote tally while collecting votes. */
  PAUSE_VOTE_UPDATE = 'PAUSE_VOTE_UPDATE',
  /** Server → all: authoritative pause state change. */
  PAUSE_STATE = 'PAUSE_STATE',

  // ── Chat ──────────────────────────────────────────────────────────────────
  CHAT = 'CHAT',

  // ── Resources & Items ────────────────────────────────────────────────────
  /** Server → Client: updated resource counts for this player. */
  RESOURCE_UPDATE = 'RESOURCE_UPDATE',
  /** Client → Server: player pressed E to interact/pick up nearby item. */
  INTERACT = 'INTERACT',

  // ── Waves ────────────────────────────────────────────────────────────────
  /** Server → all: a new wave is beginning (prep phase or active phase). */
  WAVE_START = 'WAVE_START',
  /** Server → all: a wave has ended (all portals destroyed). */
  WAVE_END = 'WAVE_END',
  /** Server → all: authoritative wave timer sync (pause/resume + drift correction). */
  WAVE_TIMER_SYNC = 'WAVE_TIMER_SYNC',

  // ── Debug ─────────────────────────────────────────────────────────────────
  /** Client → Server: spawn a wave of enemies around the sender (dev tool). */
  DEBUG_SPAWN_ENEMIES = 'DEBUG_SPAWN_ENEMIES',
  /** Client → Server: skip wave prep timer, immediately spawn portals (dev tool). */
  DEBUG_WAVE_SKIP = 'DEBUG_WAVE_SKIP',
  /** Client → Server: pause/resume the wave timer (dev tool). */
  DEBUG_WAVE_PAUSE = 'DEBUG_WAVE_PAUSE',
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
  /** Slot index if this is a player entity. Absent for enemies. */
  slot?: number;
  /** Faction — used by the client renderer to pick the visual. */
  faction?: 'player' | 'enemy' | 'portal' | 'resource' | 'item';
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  /** Present only for 'resource' faction entities. */
  resourceType?: 'wood' | 'stone' | 'iron' | 'diamond';
  /** Present only for 'item' faction entities — resource type or item ID. */
  itemType?: string;
  /** Present only for 'item' faction entities. */
  itemQuantity?: number;
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
  /** True when Shift is held and the player has stamina remaining. */
  sprint: boolean;
  /** Timestamp (performance.now()) the input was sampled. */
  t: number;
}

// ─── Combat ───────────────────────────────────────────────────────────────────

/** Client → Server: player performed an attack. */
export interface AttackMessage extends BaseMessage {
  type: typeof MessageType.ATTACK;
  attackType: 'melee' | 'ranged';
  /** World-space facing angle in radians (mouse direction). */
  facing: number;
  /** Client-predicted attacker position (used for lag-compensated hit detection). */
  x: number;
  y: number;
  /** Client timestamp for latency diagnostics. */
  t: number;
}

/** Server → all: a player swung (even on miss) — clients play the arc animation. */
export interface AttackPerformedMessage extends BaseMessage {
  type: typeof MessageType.ATTACK_PERFORMED;
  /** Entity ID of the attacker. */
  sourceId: number;
  /** Facing angle (radians) of the swing. */
  facing: number;
}

/** Server → all: an attack connected with a target. */
export interface HitMessage extends BaseMessage {
  type: typeof MessageType.HIT;
  sourceId: number;
  targetId: number;
  damage: number;
  knockbackVx: number;
  knockbackVy: number;
}

/** Server → all: a new projectile was created (ranged attack). */
export interface ProjectileSpawnMessage extends BaseMessage {
  type: typeof MessageType.PROJECTILE_SPAWN;
  /** Entity ID of the projectile (used to correlate with PROJECTILE_REMOVE). */
  projectileId: number;
  /** Spawn position. */
  x: number;
  y: number;
  /** Constant velocity for client-side prediction. */
  vx: number;
  vy: number;
  /** Slot of the player who fired (for color). */
  ownerSlot: number;
}

/** Server → all: a projectile was destroyed. */
export interface ProjectileRemoveMessage extends BaseMessage {
  type: typeof MessageType.PROJECTILE_REMOVE;
  projectileId: number;
}

// ─── Pause ────────────────────────────────────────────────────────────────────

/** Client → Server: the player wants to pause (or resume). */
export interface PauseVoteMessage extends BaseMessage {
  type: typeof MessageType.PAUSE_VOTE;
}

/** Server → all: intermediate vote tally while collecting votes. */
export interface PauseVoteUpdateMessage extends BaseMessage {
  type: typeof MessageType.PAUSE_VOTE_UPDATE;
  /** 'pause' if collecting votes to pause, 'resume' if collecting votes to resume. */
  direction: 'pause' | 'resume';
  /** Display names of players who have voted so far. */
  voters: string[];
  /** Total number of votes needed (= player count). */
  required: number;
}

/** Server → all: authoritative pause state transition. */
export interface PauseStateMessage extends BaseMessage {
  type: typeof MessageType.PAUSE_STATE;
  /** True = game is now paused. False = game has resumed. */
  paused: boolean;
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

// ─── Debug ────────────────────────────────────────────────────────────────────

/** Server → all: a wave is starting (prep countdown or portals activating). */
export interface WaveStartMessage extends BaseMessage {
  type: typeof MessageType.WAVE_START;
  waveNumber: number;
  /** Seconds of prep time before portals activate (0 = portals are now live). */
  prepDuration: number;
}

/** Server → all: a wave has ended (all portals destroyed). */
export interface WaveEndMessage extends BaseMessage {
  type: typeof MessageType.WAVE_END;
  waveNumber: number;
  outcome: 'cleared' | 'failed';
}

// ─── Resources & Items ────────────────────────────────────────────────────────

/** Server → Client: updated resource counts for this player. */
export interface ResourceUpdateMessage extends BaseMessage {
  type: typeof MessageType.RESOURCE_UPDATE;
  wood: number;
  stone: number;
  iron: number;
  diamond: number;
  gold: number;
}

/** Client → Server: player pressed E to interact/pick up nearby item. */
export interface InteractMessage extends BaseMessage {
  type: typeof MessageType.INTERACT;
  /** Client-predicted player position (lag compensation). */
  x: number;
  y: number;
  t: number;
}

// ─── Waves ────────────────────────────────────────────────────────────────────

/** Server → all: authoritative timer sync (sent on pause/resume + periodic drift correction). */
export interface WaveTimerSyncMessage extends BaseMessage {
  type: typeof MessageType.WAVE_TIMER_SYNC;
  waveNumber: number;
  /** Seconds remaining in prep phase (-1 if active or idle). */
  remaining: number;
  /** True if the wave timer is currently paused (debug). */
  paused: boolean;
}

export interface DebugSpawnEnemiesMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_SPAWN_ENEMIES;
  /** Number of enemies to spawn (capped server-side). Defaults to 5. */
  count?: number;
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
  | AttackMessage
  | AttackPerformedMessage
  | HitMessage
  | ProjectileSpawnMessage
  | ProjectileRemoveMessage
  | PauseVoteMessage
  | PauseVoteUpdateMessage
  | PauseStateMessage
  | ChatMessage
  | WaveStartMessage
  | WaveEndMessage
  | WaveTimerSyncMessage
  | ResourceUpdateMessage
  | InteractMessage
  | DebugSpawnEnemiesMessage
  | BaseMessage;
