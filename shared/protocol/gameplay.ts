// Protocol gameplay messages - Entity snapshots, input, combat, projectiles,
// death/respawn, wave wipe, resources, and interactions.

import { BaseMessage, MessageType } from './base';

// ---- World sync ----

/** Component data for a single entity in a snapshot or delta. */
export interface EntitySnapshot {
  entityId: number;
  /** Slot index if this is a player entity. Absent for enemies. */
  slot?: number;
  /** Faction - used by the client renderer to pick the visual. */
  faction?: 'player' | 'enemy' | 'portal' | 'resource' | 'item' | 'building' | 'guard' | 'civilian' | 'poi';
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
  buildingType?: import('../components').BuildingType;
  /** Building rotation: 0 = default, 1 = rotated 90 degrees. */
  buildingRotation?: number;
  /** Stored resource count for production buildings (lumbermill/mine/farm). */
  productionStored?: number;
  /** Max stored capacity for production buildings. */
  productionMax?: number;
  /** Resource type produced by production buildings. */
  productionResource?: string;
  /** Enemy variant type (melee or ranger). Only present for enemy faction. */
  enemyVariant?: import('../components').EnemyVariantType;
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
  /** Guard/wolf display name. Only present for guard faction wolves. */
  guardName?: string;
  /** Civilian AI state (idle/working/fleeing/wandering). Only present for civilian faction. */
  civilianState?: string;
  /** Civilian hunger level 0-100. Only present for civilian faction. */
  civilianHunger?: number;
  /** True if this production building has an assigned worker. Only present for building faction. */
  workerAssigned?: boolean;
  /** Bitmask of active status effects (burn, poison, slow, stun, etc). Only present for enemies. */
  statusEffects?: number;
  /** Card rarity for card drops (common/rare/epic/legendary). Only present for item faction card drops. */
  cardRarity?: string;
  /** Boss definition ID. Only present for boss enemies. */
  bossId?: string;
  /** Laser tower target entity ID (for client beam rendering). -1 or absent = idle. */
  laserTargetId?: number;
  /** Guard role (warrior/ranger/mage) for training center guards. */
  guardRole?: string;
  /** True if this building is in ruins state (destroyed but repairable). */
  isRuins?: boolean;
  /** True if the ruins are still burning (visual fire effect). */
  ruinsBurning?: boolean;
  /** Active buff IDs on this entity (for client VFX rendering). Only present for player faction. */
  activeBuffIds?: string[];
  /** Unbreakable Charge progress (0-1) and damage stored. Only present during charge. */
  chargeProgress?: number;
  chargeDamage?: number;
  /** POI type. Only present for 'poi' faction entities. */
  poiType?: import('../components').POIType;
  /** True if this POI has been consumed/used. Only present for 'poi' faction entities. */
  poiConsumed?: boolean;
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
  /** Civilian spawn timer info for in-world building tags. */
  civilianSpawn?: {
    nextSpawnSeconds: number;
    population: number;
    capacity: number;
  };
}

// ---- Input ----

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

// ---- Combat ----

/** Client -> Server: player performed an attack. */
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

/** Server -> all: a player swung (even on miss) - clients play the arc animation. */
export interface AttackPerformedMessage extends BaseMessage {
  type: typeof MessageType.ATTACK_PERFORMED;
  /** Entity ID of the attacker. */
  sourceId: number;
  /** Facing angle (radians) of the swing. */
  facing: number;
}

/** Server -> all: an attack connected with a target. */
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
  /** True if the target dodged this attack. */
  dodged?: boolean;
}

/** Server -> all: a new projectile was created (ranged attack). */
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
  /** True if this is a ballista bolt (bigger arrow visual). */
  ballista?: boolean;
  /** Elemental projectile colors for cycling. */
  colors?: number[];
  /** Elemental type hint (for VFX color override). */
  element?: string;
  /** True if this is a sniper shot (massive arrow visual). */
  sniper?: boolean;
}

/** Server -> all: a projectile was destroyed. */
export interface ProjectileRemoveMessage extends BaseMessage {
  type: typeof MessageType.PROJECTILE_REMOVE;
  projectileId: number;
}

/** Server -> all: batch of projectiles destroyed in one tick (reduces message count). */
export interface ProjectileRemoveBatchMessage extends BaseMessage {
  type: typeof MessageType.PROJECTILE_REMOVE_BATCH;
  projectileIds: number[];
}

// ---- Death & Respawn ----

/** Server -> all: a player has been downed (HP reached 0). */
export interface PlayerDownedMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_DOWNED;
  entityId: number;
  slot: number;
  bleedTimer: number;
}

/** Server -> all: revive progress for a downed player. */
export interface ReviveProgressMessage extends BaseMessage {
  type: typeof MessageType.REVIVE_PROGRESS;
  targetId: number;
  /** 0-1 progress toward completion. */
  progress: number;
  reviverId: number;
}

/** Server -> all: a downed player has been revived by a teammate. */
export interface PlayerRevivedMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_REVIVED;
  entityId: number;
  slot: number;
  hp: number;
}

/** Server -> all: a player has fully died (bleed-out expired). */
export interface PlayerDiedMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_DIED;
  entityId: number;
  slot: number;
  respawnTimer: number;
}

/** Server -> all: a player has respawned. */
export interface PlayerRespawnedMessage extends BaseMessage {
  type: typeof MessageType.PLAYER_RESPAWNED;
  entityId: number;
  slot: number;
  x: number;
  y: number;
  hp: number;
}

// ---- Wave Wipe ----

/** Server -> all: full party wipe occurred. */
export interface PartyWipeMessage extends BaseMessage {
  type: typeof MessageType.PARTY_WIPE;
  wipeCount: number;
  outcome: 'penalty' | 'game_over';
}

/** Server -> all: run is over. */
export interface GameOverMessage extends BaseMessage {
  type: typeof MessageType.GAME_OVER;
  waveReached: number;
  reason: string;
  enemiesKilled: number;
  timePlayed: number; // seconds
}

// ---- Resources & Items ----

/** Server -> Client: updated resource counts for this player. */
export interface ResourceUpdateMessage extends BaseMessage {
  type: typeof MessageType.RESOURCE_UPDATE;
  wood: number;
  stone: number;
  iron: number;
  diamond: number;
  gold: number;
  food: number;
  weapons: number;
}

/** Client -> Server: player pressed E to interact/pick up nearby item. */
export interface InteractMessage extends BaseMessage {
  type: typeof MessageType.INTERACT;
  /** Client-predicted player position (lag compensation). */
  x: number;
  y: number;
  t: number;
}

// ─── POI Messages ──────────────────────────────────────────────────────────

/** Server -> client: result of interacting with a POI (loot, buff, etc). */
export interface POIResultMessage extends BaseMessage {
  type: typeof MessageType.POI_RESULT;
  poiType: import('../components').POIType;
  /** Loot rewards for camp/chest POIs. */
  rewards?: { itemType: string; quantity: number }[];
  /** Shrine buff type applied. */
  buffType?: string;
  /** Shrine buff duration in seconds. */
  buffDuration?: number;
}

/** Server -> all: an enemy nest POI was triggered by a nearby player. */
export interface POINestTriggeredMessage extends BaseMessage {
  type: typeof MessageType.POI_NEST_TRIGGERED;
  entityId: number;
  enemyCount: number;
}

/** Server -> all: an enemy nest was cleared, loot dropped. */
export interface POINestClearedMessage extends BaseMessage {
  type: typeof MessageType.POI_NEST_CLEARED;
  entityId: number;
}
