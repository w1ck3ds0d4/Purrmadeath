// Protocol session messages - Handshake, session lifecycle, lobby, class select,
// player kick, and save slot messages.

import { BaseMessage, MessageType } from './base';

// ---- Lifecycle ----

export interface HandshakeMessage extends BaseMessage {
  type: typeof MessageType.HANDSHAKE;
  /** Display name chosen by the player. */
  displayName: string;
  /** Client build version (compared server-side for version gating). */
  version: string;
  /** Persistent player UUID (generated once, stored in localStorage). */
  playerId?: string;
}

export interface HandshakeAckMessage extends BaseMessage {
  type: typeof MessageType.HANDSHAKE_ACK;
  /** Unique ID assigned by the server for this connection. */
  clientId: string;
  /** Current server tick number (for clock sync). */
  serverTick: number;
  /** Server build version - client compares to trigger auto-update on mismatch. */
  serverVersion: string;
  /** If the server recognises this IP, the display name last used by this player. */
  lastDisplayName?: string;
}

// ---- Session ----

export interface SessionCreateMessage extends BaseMessage {
  type: typeof MessageType.SESSION_CREATE;
  /** Optional save slot (1-3) to resume from. Omit for new game. */
  saveSlot?: number;
  /** Player's chosen class (defaults to 'warrior' if absent). */
  playerClass?: import('../definitions/ClassDefinitions').PlayerClass;
}

export interface SessionJoinMessage extends BaseMessage {
  type: typeof MessageType.SESSION_JOIN;
  /** 4-letter invite code (case-insensitive). Empty string = join any active session (dev/LAN). */
  code: string;
  /** Player's chosen class (defaults to 'warrior' if absent). */
  playerClass?: import('../definitions/ClassDefinitions').PlayerClass;
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
  /** The player slot index (0-3) assigned to this client. */
  slot: number;
  /** Server-assigned playerId for this client. */
  playerId: string;
  /** True if this client is the host (controls Start). */
  isHost: boolean;
  /** Snapshot of all current lobby slots. */
  players: LobbySlot[];
  /** Advanced classes this player has unlocked via lifetime milestones. */
  unlockedClasses?: string[];
  /** Permanent buff achievements this player has completed. */
  completedBuffs?: { displayName: string; reward: string; medalColor: string }[];
  /** Building types this player has unlocked via achievements. */
  unlockedBuildings?: string[];
}

export interface LobbySlot {
  playerId: string;
  displayName: string;
  slot: number;
  isHost: boolean;
  /** Player's chosen class. Defaults to 'warrior' if absent. */
  playerClass?: import('../definitions/ClassDefinitions').PlayerClass;
  /** True if this player's class is locked from a loaded save. */
  classLocked?: boolean;
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
  /** Positions for each player slot { slot -> [worldX, worldY] } */
  spawnPositions: Record<number, [number, number]>;
}

// ---- Class Select & Kick ----

/** Client -> Server: player selects a class in the lobby. */
export interface ClassSelectMessage extends BaseMessage {
  type: typeof MessageType.CLASS_SELECT;
  playerClass: import('../definitions/ClassDefinitions').PlayerClass;
}

/** Client (host) -> Server: kick a player by slot index. */
export interface PlayerKickMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_KICK;
  slot: number;
}

// ---- Save Slots ----

/** Client -> Server: request save slot info for the host player. */
export interface SaveSlotsRequestMessage extends BaseMessage {
  type: typeof MessageType.SAVE_SLOTS_REQUEST;
}

/** Server -> Client: save slot info (3 slots). */
export interface SaveSlotsResponseMessage extends BaseMessage {
  type: typeof MessageType.SAVE_SLOTS_RESPONSE;
  slots: import('../SaveFormat').SaveSlotInfo[];
}

/** Server -> all: game was auto-saved after wave clear. */
export interface GameSavedMessage extends BaseMessage {
  type: typeof MessageType.GAME_SAVED;
  wave: number;
  slot: number;
}

/** Client -> Server: delete a save slot. */
export interface SaveDeleteMessage extends BaseMessage {
  type: typeof MessageType.SAVE_DELETE;
  slot: number;
}
