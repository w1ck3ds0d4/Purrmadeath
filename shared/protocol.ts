// ─── Message type registry ───────────────────────────────────────────────────
// Every WebSocket message carries a `type` field from this enum.
// Add new types here as phases are implemented - never inline magic strings.

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
  /** Server → all remaining clients: host left - session is closed */
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

  // ── Death & Respawn (4.11) ──────────────────────────────────────────────
  /** Server → all: a player has been downed (HP reached 0). */
  PLAYER_DOWNED = 'PLAYER_DOWNED',
  /** Server → all: revive progress update for a downed player. */
  REVIVE_PROGRESS = 'REVIVE_PROGRESS',
  /** Server → all: a downed player has been revived by a teammate. */
  PLAYER_REVIVED = 'PLAYER_REVIVED',
  /** Server → all: a player has fully died (bleed-out expired). */
  PLAYER_DIED = 'PLAYER_DIED',
  /** Server → all: a player has respawned at the spawn origin. */
  PLAYER_RESPAWNED = 'PLAYER_RESPAWNED',

  // ── Wave Wipe (4.12) ───────────────────────────────────────────────────
  /** Server → all: full party wipe occurred. */
  PARTY_WIPE = 'PARTY_WIPE',
  /** Server → all: run is over. */
  GAME_OVER = 'GAME_OVER',

  // ── Waves ────────────────────────────────────────────────────────────────
  /** Server → all: a new wave is beginning (prep phase or active phase). */
  WAVE_START = 'WAVE_START',
  /** Server → all: a wave has ended (all portals destroyed). */
  WAVE_END = 'WAVE_END',
  /** Server → all: authoritative wave timer sync (pause/resume + drift correction). */
  WAVE_TIMER_SYNC = 'WAVE_TIMER_SYNC',

  // ── Buildings (Phase 5) ──────────────────────────────────────────────────
  /** Client → Server: player attempts to place a building. */
  BUILD_PLACE = 'BUILD_PLACE',
  /** Server → placing client: placement confirmed or rejected. */
  BUILD_CONFIRM = 'BUILD_CONFIRM',
  /** Server → all: a building entity was destroyed. */
  BUILD_DESTROYED = 'BUILD_DESTROYED',
  /** Server → all: a building has been converted to ruins (can be repaired). */
  BUILD_RUINED = 'BUILD_RUINED',
  /** Server → all: the campfire was destroyed - run ends. */
  CAMPFIRE_DESTROYED = 'CAMPFIRE_DESTROYED',
  /** Client → Server: player attempts to demolish a building. */
  BUILD_DEMOLISH = 'BUILD_DEMOLISH',
  /** Client → Server: player attempts to upgrade a building. */
  BUILD_UPGRADE = 'BUILD_UPGRADE',
  /** Server → placing client: upgrade confirmed or rejected. */
  BUILD_UPGRADE_CONFIRM = 'BUILD_UPGRADE_CONFIRM',
  /** Client → Server: player attempts to repair a building. */
  BUILD_REPAIR = 'BUILD_REPAIR',
  /** Server → placing client: repair confirmed or rejected. */
  BUILD_REPAIR_CONFIRM = 'BUILD_REPAIR_CONFIRM',
  /** Server → all: cannon turret AOE explosion visual. */
  AOE_EXPLOSION = 'AOE_EXPLOSION',
  /** Server -> all: incoming meteor warning (red circle on ground before impact). */
  METEOR_WARNING = 'METEOR_WARNING',
  /** Server → All: warehouse shared resource pool update. */
  WAREHOUSE_UPDATE = 'WAREHOUSE_UPDATE',

  // ── Save Slots ──────────────────────────────────────────────────────────────
  /** Client → Server: request save slot info for the current player. */
  SAVE_SLOTS_REQUEST = 'SAVE_SLOTS_REQUEST',
  /** Server → Client: save slot info response. */
  SAVE_SLOTS_RESPONSE = 'SAVE_SLOTS_RESPONSE',
  /** Server → all: game was auto-saved (toast notification). */
  GAME_SAVED = 'GAME_SAVED',
  /** Client → Server: delete a save slot. */
  SAVE_DELETE = 'SAVE_DELETE',

  // ── Debug ─────────────────────────────────────────────────────────────────
  /** Client → Server: spawn a wave of enemies around the sender (dev tool). */
  DEBUG_SPAWN_ENEMIES = 'DEBUG_SPAWN_ENEMIES',
  /** Client → Server: skip wave prep timer, immediately spawn portals (dev tool). */
  DEBUG_WAVE_SKIP = 'DEBUG_WAVE_SKIP',
  /** Client → Server: pause/resume the wave timer (dev tool). */
  DEBUG_WAVE_PAUSE = 'DEBUG_WAVE_PAUSE',
  /** Client → Server: give resources to the sender (dev tool). */
  DEBUG_GIVE_RESOURCES = 'DEBUG_GIVE_RESOURCES',
  /** Client → Server: give a specific card to the sender (dev tool). */
  DEBUG_GIVE_CARD = 'DEBUG_GIVE_CARD',
  /** Client → Server: give skill points to the sender (dev tool). */
  DEBUG_GIVE_SKILL_POINTS = 'DEBUG_GIVE_SKILL_POINTS',
  /** Client → Server: skip to night (dev tool). */
  DEBUG_SKIP_NIGHT = 'DEBUG_SKIP_NIGHT',
  /** Client → Server: skip to day (dev tool). */
  DEBUG_SKIP_DAY = 'DEBUG_SKIP_DAY',
  /** Client → Server: set day timer to specific seconds (dev tool). */
  DEBUG_SET_TIME = 'DEBUG_SET_TIME',
  /** Client → Server: force a wave modifier (dev tool). */
  DEBUG_FORCE_MODIFIER = 'DEBUG_FORCE_MODIFIER',
  /** Client → Server: force a world event (dev tool). */
  DEBUG_FORCE_EVENT = 'DEBUG_FORCE_EVENT',

  // ── Phase 6 ────────────────────────────────────────────────────────────────
  /** Server → all: a new enemy type appeared for the first time this run. */
  ENEMY_INTRO = 'ENEMY_INTRO',
  /** Client → Server: request persistent meta stats. */
  META_STATS_REQUEST = 'META_STATS_REQUEST',
  /** Server → Client: response with persistent meta stats. */
  META_STATS_RESPONSE = 'META_STATS_RESPONSE',

  CARD_OFFER   = 'CARD_OFFER',
  CARD_PICK    = 'CARD_PICK',
  CARD_APPLIED = 'CARD_APPLIED',
  /** Server → Client: sync card abilities + picked card IDs after save load. */
  CARD_SYNC    = 'CARD_SYNC',

  // ── Phase 7 ────────────────────────────────────────────────────────────────
  /** Client → Server: player selects a class in the lobby. */
  CLASS_SELECT = 'CLASS_SELECT',
  /** Client (host) → Server: kick a player from the lobby by slot. */
  PLAYER_KICK = 'PLAYER_KICK',

  // ── Skill Tree ──────────────────────────────────────────────────────────────
  /** Client → Server: allocate a skill point to a node. */
  SKILL_ALLOCATE = 'SKILL_ALLOCATE',
  /** Server → Client: full skill allocation state. */
  SKILL_STATE = 'SKILL_STATE',
  /** Client → Server: assign an ability to a hotbar slot. */
  ABILITY_SLOT_ASSIGN = 'ABILITY_SLOT_ASSIGN',
  /** Client → Server: activate an ability (Q/E/R). */
  ABILITY_USE = 'ABILITY_USE',
  /** Server → all: broadcast ability visual effect. */
  ABILITY_EFFECT = 'ABILITY_EFFECT',

  // ── Potions ──────────────────────────────────────────────────────────────
  /** Server → Client: potion shop state (sent when player opens shop). */
  POTION_SHOP_STATE = 'POTION_SHOP_STATE',
  /** Client → Server: unlock a potion at a shop. */
  POTION_UNLOCK = 'POTION_UNLOCK',
  /** Client → Server: equip a potion to hotbar slot 4. */
  POTION_EQUIP = 'POTION_EQUIP',
  /** Client → Server: restock charges at a shop. */
  POTION_RESTOCK = 'POTION_RESTOCK',
  /** Client → Server: use the currently equipped potion. */
  POTION_USE = 'POTION_USE',
  /** Server → Client: full potion state sync (after use, equip, restock, save load). */
  POTION_STATE = 'POTION_STATE',

  // ── Phase 9: Day/Night ──────────────────────────────────────────────────
  /** Server → all: day/night phase sync (periodic + on transitions). */
  DAY_NIGHT_SYNC = 'DAY_NIGHT_SYNC',
  /** Client → Server: player votes to sleep (skip day). */
  SLEEP_VOTE = 'SLEEP_VOTE',
  /** Server → all: sleep vote tally update. */
  SLEEP_UPDATE = 'SLEEP_UPDATE',

  // ── Phase 9: Wave Modifiers & World Events ─────────────────────────────
  /** Server → all: wave modifier(s) rolled for the upcoming wave. */
  WAVE_MODIFIER = 'WAVE_MODIFIER',
  /** Server → all: day event roulette roll result. */
  DAY_EVENT_ROLL = 'DAY_EVENT_ROLL',
  /** Server → all: a world event has started. */
  WORLD_EVENT_START = 'WORLD_EVENT_START',
  /** Server → all: a world event has ended. */
  WORLD_EVENT_END = 'WORLD_EVENT_END',

  // ── Phase 10: Card Drops & Bosses ─────────────────────────────────────
  /** Server → all: a player picked up a card drop. */
  CARD_PICKUP = 'CARD_PICKUP',
  /** Server → all: a boss enemy has spawned. */
  BOSS_INTRO = 'BOSS_INTRO',
  /** Server → all: a boss changed phase (enrage, etc). */
  BOSS_PHASE = 'BOSS_PHASE',

  // ── Phase 8: Civilians ──────────────────────────────────────────────────
  /** Server → all: a civilian said something (speech bubble). */
  CIVILIAN_SPEECH = 'CIVILIAN_SPEECH',
  /** Server → all: a civilian was killed. */
  CIVILIAN_DIED = 'CIVILIAN_DIED',
  /** Server → all: a new civilian was spawned. */
  CIVILIAN_SPAWNED = 'CIVILIAN_SPAWNED',
  /** Client → Server: request civilian panel state. */
  CIVILIAN_PANEL_REQUEST = 'CIVILIAN_PANEL_REQUEST',
  /** Server → Client: full civilian panel state. */
  CIVILIAN_PANEL_STATE = 'CIVILIAN_PANEL_STATE',
  /** Client → Server: assign a civilian to a building (or unassign). */
  CIVILIAN_ASSIGN = 'CIVILIAN_ASSIGN',
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

// ─── Error ────────────────────────────────────────────────────────────────────

export interface ErrorMessage extends BaseMessage {
  type: typeof MessageType.ERROR;
  code: string;
  message: string;
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface SessionCreateMessage extends BaseMessage {
  type: typeof MessageType.SESSION_CREATE;
  /** Optional save slot (1-3) to resume from. Omit for new game. */
  saveSlot?: number;
  /** Player's chosen class (defaults to 'warrior' if absent). */
  playerClass?: import('./definitions/ClassDefinitions').PlayerClass;
}

export interface SessionJoinMessage extends BaseMessage {
  type: typeof MessageType.SESSION_JOIN;
  /** 4-letter invite code (case-insensitive). Empty string = join any active session (dev/LAN). */
  code: string;
  /** Player's chosen class (defaults to 'warrior' if absent). */
  playerClass?: import('./definitions/ClassDefinitions').PlayerClass;
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
  /** Advanced classes this player has unlocked via lifetime milestones. */
  unlockedClasses?: string[];
  /** Permanent buff achievements this player has completed. */
  completedBuffs?: { displayName: string; reward: string; medalColor: string }[];
}

export interface LobbySlot {
  playerId: string;
  displayName: string;
  slot: number;
  isHost: boolean;
  /** Player's chosen class. Defaults to 'warrior' if absent. */
  playerClass?: import('./definitions/ClassDefinitions').PlayerClass;
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
  /** Positions for each player slot { slot → [worldX, worldY] } */
  spawnPositions: Record<number, [number, number]>;
}

// ─── World sync ───────────────────────────────────────────────────────────────

/** Component data for a single entity in a snapshot or delta. */
export interface EntitySnapshot {
  entityId: number;
  /** Slot index if this is a player entity. Absent for enemies. */
  slot?: number;
  /** Faction - used by the client renderer to pick the visual. */
  faction?: 'player' | 'enemy' | 'portal' | 'resource' | 'item' | 'building' | 'guard' | 'civilian';
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  /** Present only for 'resource' faction entities. */
  resourceType?: 'wood' | 'stone' | 'iron' | 'diamond';
  /** Present only for 'item' faction entities - resource type or item ID. */
  itemType?: string;
  /** Present only for 'item' faction entities. */
  itemQuantity?: number;
  /** True if this player entity is in the downed state. */
  downed?: boolean;
  /** Present only for 'building' faction entities. */
  buildingType?: import('./components').BuildingType;
  /** Stored resource count for production buildings (lumbermill/mine/farm). */
  productionStored?: number;
  /** Max stored capacity for production buildings. */
  productionMax?: number;
  /** Resource type produced by production buildings. */
  productionResource?: string;
  /** Enemy variant type (melee or ranger). Only present for enemy faction. */
  enemyVariant?: import('./components').EnemyVariantType;
  /** Enemy faction name (bandits, undead, corrupted). Only present for enemy faction. */
  enemyFaction?: string;
  /** Building upgrade level (1 = base). Only present for building faction. */
  upgradeLevel?: number;
  /** True when a ghost enemy is currently hidden (invisible). */
  ghostHidden?: boolean;
  /** Non-standard enemy radius (e.g. giant = 20). Only sent when != default 10. */
  enemyRadius?: number;
  /** Player class type (warrior/ranger/mage). Only present for player faction. */
  playerClass?: string;
  /** True when entity is mid-dodge-roll (invincible + ghost visual). */
  dodging?: boolean;
  /** Civilian NPC name. Only present for civilian faction. */
  civilianName?: string;
  /** Civilian AI state (idle/working/fleeing/wandering). Only present for civilian faction. */
  civilianState?: string;
  /** Civilian hunger level 0–100. Only present for civilian faction. */
  civilianHunger?: number;
  /** True if this production building has an assigned worker. Only present for building faction. */
  workerAssigned?: boolean;
  /** Bitmask of active status effects (burn, poison, slow, stun, etc). Only present for enemies. */
  statusEffects?: number;
  /** Card rarity for card drops (common/rare/epic/legendary). Only present for item faction card drops. */
  cardRarity?: string;
  /** Boss definition ID. Only present for boss enemies. */
  bossId?: string;
  /** True if this building is in ruins state (destroyed but repairable). */
  isRuins?: boolean;
  /** True if the ruins are still burning (visual fire effect). */
  ruinsBurning?: boolean;
}

/** Full world snapshot sent on game start or player rejoin. */
export interface SnapshotMessage extends BaseMessage {
  type: typeof MessageType.SNAPSHOT;
  tick: number;
  entities: EntitySnapshot[];
}

/** Per-tick delta - only changed entities. */
export interface DeltaMessage extends BaseMessage {
  type: typeof MessageType.DELTA;
  tick: number;
  /** Last client input sequence number the server processed for this client. */
  lastSeq: number;
  entities: EntitySnapshot[];
  /** Entity IDs removed since last tick. */
  removed: number[];
  /** Optional server-side stats for the debug console. */
  serverStats?: {
    wave: number; enemyCount: number; portalCount: number; playerCount: number;
    tickProfile?: { combat: number; enemy: number; movement: number; projectile: number; buildings: number; waves: number; total: number };
  };
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
  /** True on the frame the player initiates a dodge roll. */
  dodge?: boolean;
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

/** Server → all: a player swung (even on miss) - clients play the arc animation. */
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
  crit?: boolean;
  /** Primary element of the attack (for damage number tinting). */
  element?: string;
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
  /** Mortar target position (cannon turret only). */
  targetX?: number;
  targetY?: number;
  /** Total flight time for mortar arc (seconds). */
  totalFlightTime?: number;
  /** True if projectile pierces through targets (ranger). */
  pierce?: boolean;
  /** True if projectile homes in on nearest enemy (mage). */
  homing?: boolean;
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
  /** Server-authoritative elapsed play time in seconds (excludes paused time). */
  elapsedTime?: number;
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

/** Client → Server chat (no displayName/slot - server fills those). */
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
  food: number;
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

export interface DebugGiveCardMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_GIVE_CARD;
  cardId: string;
}

export interface DebugGiveSkillPointsMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_GIVE_SKILL_POINTS;
  count?: number;
}

export interface DebugSetTimeMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_SET_TIME;
  seconds: number;
}

export interface DebugForceModifierMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_FORCE_MODIFIER;
  modifierId: string;
}

export interface DebugForceEventMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_FORCE_EVENT;
  eventId: string;
}

// ─── Death & Respawn (4.11) ──────────────────────────────────────────────────

/** Server → all: a player has been downed (HP reached 0). */
export interface PlayerDownedMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_DOWNED;
  entityId: number;
  slot: number;
  bleedTimer: number;
}

/** Server → all: revive progress for a downed player. */
export interface ReviveProgressMessage extends BaseMessage {
  type: typeof MessageType.REVIVE_PROGRESS;
  targetId: number;
  /** 0–1 progress toward completion. */
  progress: number;
  reviverId: number;
}

/** Server → all: a downed player has been revived by a teammate. */
export interface PlayerRevivedMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_REVIVED;
  entityId: number;
  slot: number;
  hp: number;
}

/** Server → all: a player has fully died (bleed-out expired). */
export interface PlayerDiedMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_DIED;
  entityId: number;
  slot: number;
  respawnTimer: number;
}

/** Server → all: a player has respawned. */
export interface PlayerRespawnedMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_RESPAWNED;
  entityId: number;
  slot: number;
  x: number;
  y: number;
  hp: number;
}

// ─── Wave Wipe (4.12) ───────────────────────────────────────────────────────

/** Server → all: full party wipe occurred. */
export interface PartyWipeMessage extends BaseMessage {
  type: typeof MessageType.PARTY_WIPE;
  wipeCount: number;
  outcome: 'penalty' | 'game_over';
}

/** Server → all: run is over. */
export interface GameOverMessage extends BaseMessage {
  type: typeof MessageType.GAME_OVER;
  waveReached: number;
  reason: string;
  enemiesKilled: number;
  timePlayed: number; // seconds
}

// ─── Buildings (Phase 5) ──────────────────────────────────────────────────────

/** Client → Server: player attempts to place a building. */
export interface BuildPlaceMessage extends BaseMessage {
  type: typeof MessageType.BUILD_PLACE;
  buildingType: import('./components').BuildingType;
  /** World-pixel position (server will grid-snap). */
  x: number;
  y: number;
}

/** Server → placing client: placement confirmed or rejected. */
export interface BuildConfirmMessage extends BaseMessage {
  type: typeof MessageType.BUILD_CONFIRM;
  success: boolean;
  reason?: string;
}

/** Server → all: a building entity was destroyed. */
export interface BuildDestroyedMessage extends BaseMessage {
  type: typeof MessageType.BUILD_DESTROYED;
  entityId: number;
}

/** Server → all: a building has been converted to ruins. */
export interface BuildRuinedMessage extends BaseMessage {
  type: typeof MessageType.BUILD_RUINED;
  entityId: number;
  buildingType: string;
  originalLevel: number;
}

/** Server → all: the campfire was destroyed - run ends. */
export interface CampfireDestroyedMessage extends BaseMessage {
  type: typeof MessageType.CAMPFIRE_DESTROYED;
}

/** Client → Server: player attempts to demolish a building (by entity ID). */
export interface BuildDemolishMessage extends BaseMessage {
  type: typeof MessageType.BUILD_DEMOLISH;
  entityId: number;
}

/** Client → Server: player attempts to upgrade a building. */
export interface BuildUpgradeMessage extends BaseMessage {
  type: typeof MessageType.BUILD_UPGRADE;
  entityId: number;
}

/** Server → placing client: upgrade confirmed or rejected. */
export interface BuildUpgradeConfirmMessage extends BaseMessage {
  type: typeof MessageType.BUILD_UPGRADE_CONFIRM;
  success: boolean;
  entityId?: number;
  newLevel?: number;
  reason?: string;
}

/** Client → Server: player attempts to repair a building. */
export interface BuildRepairMessage extends BaseMessage {
  type: typeof MessageType.BUILD_REPAIR;
  entityId: number;
}

/** Server → placing client: repair confirmed or rejected. */
export interface BuildRepairConfirmMessage extends BaseMessage {
  type: typeof MessageType.BUILD_REPAIR_CONFIRM;
  success: boolean;
  entityId?: number;
  reason?: string;
}

/** Server → all: cannon turret AOE explosion at impact point. */
export interface AoeExplosionMessage extends BaseMessage {
  type: typeof MessageType.AOE_EXPLOSION;
  x: number;
  y: number;
  radius: number;
  /** If true, render as a large meteor impact with crater. */
  meteor?: boolean;
}

/** Server -> all: incoming meteor warning indicator before impact. */
export interface MeteorWarningMessage extends BaseMessage {
  type: typeof MessageType.METEOR_WARNING;
  x: number;
  y: number;
  radius: number;
  /** Time in seconds until impact. */
  delay: number;
}

/** Server → All: warehouse shared resource pool update. */
export interface WarehouseUpdateMessage extends BaseMessage {
  type: typeof MessageType.WAREHOUSE_UPDATE;
  wood: number;
  stone: number;
  iron: number;
  diamond: number;
  gold: number;
  food: number;
  exists: boolean;
}

// ─── Save Slots ──────────────────────────────────────────────────────────────

/** Client → Server: request save slot info for the host player. */
export interface SaveSlotsRequestMessage extends BaseMessage {
  type: typeof MessageType.SAVE_SLOTS_REQUEST;
}

/** Server → Client: save slot info (3 slots). */
export interface SaveSlotsResponseMessage extends BaseMessage {
  type: typeof MessageType.SAVE_SLOTS_RESPONSE;
  slots: import('./SaveFormat').SaveSlotInfo[];
}

/** Server → all: game was auto-saved after wave clear. */
export interface GameSavedMessage extends BaseMessage {
  type: typeof MessageType.GAME_SAVED;
  wave: number;
  slot: number;
}

/** Client → Server: delete a save slot. */
export interface SaveDeleteMessage extends BaseMessage {
  type: typeof MessageType.SAVE_DELETE;
  slot: number;
}

// ── Phase 6 ──────────────────────────────────────────────────────────────────

/** Server → all: a new enemy type appeared for the first time this run. */
export interface EnemyIntroMessage extends BaseMessage {
  type: typeof MessageType.ENEMY_INTRO;
  variant: string;
  displayName: string;
}

/** Client → Server: request persistent meta stats. */
export interface MetaStatsRequestMessage extends BaseMessage {
  type: typeof MessageType.META_STATS_REQUEST;
}

/** Server → Client: persistent meta stats response. */
export interface MetaStatsResponseMessage extends BaseMessage {
  type: typeof MessageType.META_STATS_RESPONSE;
  stats: import('./definitions/MetaStats').MetaStats;
}

// ── Cards ───────────────────────────────────────────────────────────────────

export interface CardOfferMessage extends BaseMessage {
  type: typeof MessageType.CARD_OFFER;
  cards: import('./definitions/CardDefinitions').CardDefinition[];
}

export interface CardPickMessage extends BaseMessage {
  type: typeof MessageType.CARD_PICK;
  cardId: string;
}

export interface CardAppliedMessage extends BaseMessage {
  type: typeof MessageType.CARD_APPLIED;
  displayName: string;
  cardId: string;
  cardName: string;
  category: import('./definitions/CardDefinitions').CardCategory;
  isTrap: boolean;
  /** Synced abilities list for the receiving player (only present for ability-type cards). */
  abilities?: string[];
}

/** Server → Client: restore card abilities + picked IDs from a loaded save. */
export interface CardSyncMessage extends BaseMessage {
  type: typeof MessageType.CARD_SYNC;
  abilities: string[];
  pickedCardIds: string[];
}

// ── Phase 7 ──────────────────────────────────────────────────────────────────

/** Client → Server: player selects a class in the lobby. */
export interface ClassSelectMessage extends BaseMessage {
  type: typeof MessageType.CLASS_SELECT;
  playerClass: import('./definitions/ClassDefinitions').PlayerClass;
}

/** Client (host) → Server: kick a player by slot index. */
export interface PlayerKickMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_KICK;
  slot: number;
}

// ── Skill Tree Messages ──────────────────────────────────────────────────────

/** Client → Server: allocate a skill point to a node. */
export interface SkillAllocateMessage extends BaseMessage {
  type: typeof MessageType.SKILL_ALLOCATE;
  nodeId: string;
}

/** Server → Client: full skill allocation state (sent after allocation or on join). */
export interface SkillStateMessage extends BaseMessage {
  type: typeof MessageType.SKILL_STATE;
  allocated: string[];
  skillPoints: number;
  abilityCooldowns: Record<string, number>;
  slotAssignments?: [string | null, string | null, string | null];
}

/** Client → Server: assign an ability to a hotbar slot (Q=0, E=1, R=2). */
export interface AbilitySlotAssignMessage extends BaseMessage {
  type: typeof MessageType.ABILITY_SLOT_ASSIGN;
  slot: 0 | 1 | 2;
  abilityId: string | null;
}

/** Client → Server: activate an ability (Q/E/R). */
export interface AbilityUseMessage extends BaseMessage {
  type: typeof MessageType.ABILITY_USE;
  abilityId: string;
  facing: number;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
}

/** Server → all: broadcast ability visual effect. */
export interface AbilityEffectMessage extends BaseMessage {
  type: typeof MessageType.ABILITY_EFFECT;
  abilityId: string;
  sourceId: number;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  facing?: number;
  duration?: number;
  radius?: number;
}

// ── Potions ──────────────────────────────────────────────────────────────────

/** Server → Client: full shop state when player opens a potion shop. */
export interface PotionShopStateMessage extends BaseMessage {
  type: typeof MessageType.POTION_SHOP_STATE;
  shopEntityId: number;
  shopLevel: number;
  unlockedPotions: string[];
  equippedPotion: string | null;
  charges: number;
  maxCharges: number;
}

/** Client → Server: unlock a potion. */
export interface PotionUnlockMessage extends BaseMessage {
  type: typeof MessageType.POTION_UNLOCK;
  potionType: string;
  shopEntityId: number;
}

/** Client → Server: equip a potion to slot 4. */
export interface PotionEquipMessage extends BaseMessage {
  type: typeof MessageType.POTION_EQUIP;
  potionType: string;
}

/** Client → Server: restock charges at a shop. */
export interface PotionRestockMessage extends BaseMessage {
  type: typeof MessageType.POTION_RESTOCK;
  shopEntityId: number;
}

/** Client → Server: use equipped potion. */
export interface PotionUseMessage extends BaseMessage {
  type: typeof MessageType.POTION_USE;
}

/** Server → Client: full potion state sync. */
export interface PotionStateMessage extends BaseMessage {
  type: typeof MessageType.POTION_STATE;
  equippedPotion: string | null;
  unlockedPotions: string[];
  charges: number;
  maxCharges: number;
  cooldown: number;
  cooldownMax: number;
}

// ── Phase 8: Civilian Messages ──────────────────────────────────────────────

/** Server → all: a civilian said something. */
export interface CivilianSpeechMessage extends BaseMessage {
  type: typeof MessageType.CIVILIAN_SPEECH;
  entityId: number;
  text: string;
}

/** Server → all: a civilian was killed. */
export interface CivilianDiedMessage extends BaseMessage {
  type: typeof MessageType.CIVILIAN_DIED;
  entityId: number;
  name: string;
}

/** Server → all: a new civilian was spawned. */
export interface CivilianSpawnedMessage extends BaseMessage {
  type: typeof MessageType.CIVILIAN_SPAWNED;
  entityId: number;
  name: string;
}

/** Client → Server: request civilian panel data. */
export interface CivilianPanelRequestMessage extends BaseMessage {
  type: typeof MessageType.CIVILIAN_PANEL_REQUEST;
}

/** One civilian's info for the panel. */
export interface CivilianPanelEntry {
  entityId: number;
  name: string;
  state: string;
  hunger: number;
  hp: number;
  maxHp: number;
  assignedBuildingId: number | null;
  assignedBuildingType: string | null;
  downed: boolean;
}

/** One production building available for assignment. */
export interface WorkableBuildingEntry {
  entityId: number;
  buildingType: string;
  workerName: string | null;
}

/** Server → Client: full civilian panel state. */
export interface CivilianPanelStateMessage extends BaseMessage {
  type: typeof MessageType.CIVILIAN_PANEL_STATE;
  civilians: CivilianPanelEntry[];
  buildings: WorkableBuildingEntry[];
  population: number;
  housingCapacity: number;
}

/** Client → Server: assign a civilian to a building (or null to unassign). */
export interface CivilianAssignMessage extends BaseMessage {
  type: typeof MessageType.CIVILIAN_ASSIGN;
  civilianId: number;
  buildingId: number | null;
}

// ── Phase 9: Day/Night Messages ──────────────────────────────────────────────

export type DayNightPhase = 'day' | 'dusk' | 'night' | 'dawn';

/** Server → all: day/night phase sync. */
export interface DayNightSyncMessage extends BaseMessage {
  type: typeof MessageType.DAY_NIGHT_SYNC;
  phase: DayNightPhase;
  /** Current darkness level (0 = full day, 1 = full night). */
  darkness: number;
  /** Seconds remaining in the day phase (-1 if not day). */
  dayTimeRemaining: number;
  /** Number of players who have voted to sleep. */
  sleepVotes: number;
  /** Total connected players. */
  totalPlayers: number;
}

/** Client → Server: player votes to sleep or cancels. */
export interface SleepVoteMessage extends BaseMessage {
  type: typeof MessageType.SLEEP_VOTE;
  /** True = vote to sleep, false = cancel vote. */
  vote: boolean;
}

/** Server → all: sleep vote tally update. */
export interface SleepUpdateMessage extends BaseMessage {
  type: typeof MessageType.SLEEP_UPDATE;
  votes: number;
  needed: number;
  /** Slots of players who have voted. */
  voterSlots: number[];
}

// ─── Wave Modifiers & World Events ────────────────────────────────────────────

/** Server → all: wave modifier(s) rolled for the upcoming wave. */
export interface WaveModifierMessage extends BaseMessage {
  type: typeof MessageType.WAVE_MODIFIER;
  waveNumber: number;
  modifiers: { id: string; name: string; description: string; color: number }[];
}

/** Server → all: day event roulette result (sent at start of each day). */
export interface DayEventRollMessage extends BaseMessage {
  type: typeof MessageType.DAY_EVENT_ROLL;
  /** The event that was rolled, or null for safe day. */
  eventId: string | null;
  eventName: string | null;
}

/** Server → all: a world event has started. */
export interface WorldEventStartMessage extends BaseMessage {
  type: typeof MessageType.WORLD_EVENT_START;
  eventId: string;
  name: string;
  /** Short description of what the event does. */
  description: string;
  /** Duration in seconds (0 = instant). */
  duration: number;
  /** Ambient tint color override (Blood Moon). */
  tintColor?: number;
  /** Torch/vision radius multiplier (Solar Eclipse). */
  visionMult?: number;
  /** Enemy damage multiplier while event is active. */
  damageMult?: number;
  /** Production speed multiplier (Resource Boom). */
  productionMult?: number;
  /** Camera shake intensity (Earthquake). */
  shakeIntensity?: number;
}

/** Server → all: a world event has ended. */
export interface WorldEventEndMessage extends BaseMessage {
  type: typeof MessageType.WORLD_EVENT_END;
  eventId: string;
}

// ─── Card Drops & Bosses ─────────────────────────────────────────────────────

/** Server → all: a player picked up a card drop. */
export interface CardPickupMessage extends BaseMessage {
  type: typeof MessageType.CARD_PICKUP;
  /** Slot of the player who picked up the card. */
  slot: number;
  cardId: string;
  cardName: string;
  rarity: string;
  category: string;
  displayName: string;
}

/** Server → all: a boss enemy has spawned. */
export interface BossIntroMessage extends BaseMessage {
  type: typeof MessageType.BOSS_INTRO;
  bossId: string;
  bossName: string;
  entityId: number;
  description: string;
  maxHp: number;
}

/** Server → all: a boss changed phase. */
export interface BossPhaseMessage extends BaseMessage {
  type: typeof MessageType.BOSS_PHASE;
  entityId: number;
  bossId: string;
  phaseIndex: number;
  bannerText: string;
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
  | PlayerDownedMessage
  | ReviveProgressMessage
  | PlayerRevivedMessage
  | PlayerDiedMessage
  | PlayerRespawnedMessage
  | PartyWipeMessage
  | GameOverMessage
  | BuildPlaceMessage
  | BuildConfirmMessage
  | BuildDestroyedMessage
  | BuildRuinedMessage
  | CampfireDestroyedMessage
  | BuildDemolishMessage
  | BuildUpgradeMessage
  | BuildUpgradeConfirmMessage
  | BuildRepairMessage
  | BuildRepairConfirmMessage
  | AoeExplosionMessage
  | MeteorWarningMessage
  | WarehouseUpdateMessage
  | SaveSlotsRequestMessage
  | SaveSlotsResponseMessage
  | GameSavedMessage
  | SaveDeleteMessage
  | EnemyIntroMessage
  | MetaStatsRequestMessage
  | MetaStatsResponseMessage
  | CardOfferMessage
  | CardPickMessage
  | CardAppliedMessage
  | ClassSelectMessage
  | PlayerKickMessage
  | SkillAllocateMessage
  | SkillStateMessage
  | AbilitySlotAssignMessage
  | AbilityUseMessage
  | AbilityEffectMessage
  | PotionShopStateMessage
  | PotionUnlockMessage
  | PotionEquipMessage
  | PotionRestockMessage
  | PotionUseMessage
  | PotionStateMessage
  | CivilianSpeechMessage
  | CivilianDiedMessage
  | CivilianSpawnedMessage
  | CivilianPanelRequestMessage
  | CivilianPanelStateMessage
  | CivilianAssignMessage
  | DayNightSyncMessage
  | SleepVoteMessage
  | SleepUpdateMessage
  | WaveModifierMessage
  | DayEventRollMessage
  | WorldEventStartMessage
  | WorldEventEndMessage
  | CardPickupMessage
  | BossIntroMessage
  | BossPhaseMessage
  | BaseMessage;
