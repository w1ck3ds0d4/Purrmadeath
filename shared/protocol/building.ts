// Protocol building messages - Build, upgrade, demolish, repair, AOE, meteor,
// warehouse, laser, flame, tesla, teleporter, civilians, training, and tavern/heroes.

import { BaseMessage, MessageType } from './base';

// ---- Buildings (Phase 5) ----

/** Client -> Server: player attempts to place a building. */
export interface BuildPlaceMessage extends BaseMessage {
  type: typeof MessageType.BUILD_PLACE;
  buildingType: import('../components').BuildingType;
  /** World-pixel position (server will grid-snap). */
  x: number;
  y: number;
  /** Building rotation: 0 = default, 1 = rotated 90 degrees. */
  rotation?: number;
}

/** Server -> placing client: placement confirmed or rejected. */
export interface BuildConfirmMessage extends BaseMessage {
  type: typeof MessageType.BUILD_CONFIRM;
  success: boolean;
  reason?: string;
}

/** Server -> all: a building entity was destroyed. */
export interface BuildDestroyedMessage extends BaseMessage {
  type: typeof MessageType.BUILD_DESTROYED;
  entityId: number;
}

/** Server -> all: a building has been converted to ruins. */
export interface BuildRuinedMessage extends BaseMessage {
  type: typeof MessageType.BUILD_RUINED;
  entityId: number;
  buildingType: string;
  originalLevel: number;
}

/** Server -> all: the campfire was destroyed - run ends. */
export interface CampfireDestroyedMessage extends BaseMessage {
  type: typeof MessageType.CAMPFIRE_DESTROYED;
}

/** Client -> Server: player attempts to demolish a building (by entity ID). */
export interface BuildDemolishMessage extends BaseMessage {
  type: typeof MessageType.BUILD_DEMOLISH;
  entityId: number;
}

/** Client -> Server: player attempts to upgrade a building. */
export interface BuildUpgradeMessage extends BaseMessage {
  type: typeof MessageType.BUILD_UPGRADE;
  entityId: number;
}

/** Server -> placing client: upgrade confirmed or rejected. */
export interface BuildUpgradeConfirmMessage extends BaseMessage {
  type: typeof MessageType.BUILD_UPGRADE_CONFIRM;
  success: boolean;
  entityId?: number;
  newLevel?: number;
  reason?: string;
}

/** Client -> Server: player attempts to repair a building. */
export interface BuildRepairMessage extends BaseMessage {
  type: typeof MessageType.BUILD_REPAIR;
  entityId: number;
}

/** Server -> placing client: repair confirmed or rejected. */
export interface BuildRepairConfirmMessage extends BaseMessage {
  type: typeof MessageType.BUILD_REPAIR_CONFIRM;
  success: boolean;
  entityId?: number;
  reason?: string;
}

/** Client -> Server: player attempts to move a building to a new position. */
export interface BuildMoveMessage extends BaseMessage {
  type: typeof MessageType.BUILD_MOVE;
  entityId: number;
  /** New world-pixel position. */
  x: number;
  y: number;
}

/** Server -> all: building range update (sent when campfire placed or watchtower upgraded). */
export interface BuildRangeUpdateMessage extends BaseMessage {
  type: typeof MessageType.BUILD_RANGE_UPDATE;
  /** Campfire center X in world pixels. */
  campfireX: number;
  /** Campfire center Y in world pixels. */
  campfireY: number;
  /** Half-extent of the building range square in world pixels. */
  rangeHalfExtent: number;
  /** Whether the campfire has been placed. */
  campfirePlaced: boolean;
}

/** Server -> all: cannon turret AOE explosion at impact point. */
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

/** Server -> All: warehouse shared resource pool update. */
export interface WarehouseUpdateMessage extends BaseMessage {
  type: typeof MessageType.WAREHOUSE_UPDATE;
  wood: number;
  stone: number;
  iron: number;
  diamond: number;
  gold: number;
  food: number;
  weapons: number;
  exists: boolean;
}

// ---- Laser Beam ----

export interface LaserBeamVFXMessage extends BaseMessage {
  type: typeof MessageType.LASER_BEAM;
  /** Laser tower source position. */
  sourceX: number;
  sourceY: number;
  /** Target position. */
  targetX: number;
  targetY: number;
}

// ---- Flame Cone ----

export interface FlameConeMessage extends BaseMessage {
  type: typeof MessageType.FLAME_CONE;
  sourceX: number;
  sourceY: number;
  facing: number;
  range: number;
  arcRadians: number;
}

// ---- Tesla Coil ----

export interface TeslaChainMessage extends BaseMessage {
  type: typeof MessageType.TESLA_CHAIN;
  /** Source tower position. */
  sourceX: number;
  sourceY: number;
  /** Chain target positions in order. */
  chain: Array<{ x: number; y: number }>;
}

// ---- Teleporter ----

export interface TeleporterUseMessage extends BaseMessage {
  type: typeof MessageType.TELEPORTER_USE;
  /** Entity ID of the teleporter pad the player is near. */
  teleporterId: number;
}

export interface TeleporterResultMessage extends BaseMessage {
  type: typeof MessageType.TELEPORTER_RESULT;
  success: boolean;
  /** Destination position (if success). */
  x?: number;
  y?: number;
  reason?: string;
}

// ---- Civilians (Phase 8) ----

/** Server -> all: a civilian said something. */
export interface CivilianSpeechMessage extends BaseMessage {
  type: typeof MessageType.CIVILIAN_SPEECH;
  entityId: number;
  text: string;
}

/** Server -> all: a civilian was killed. */
export interface CivilianDiedMessage extends BaseMessage {
  type: typeof MessageType.CIVILIAN_DIED;
  entityId: number;
  name: string;
}

/** Server -> all: a new civilian was spawned. */
export interface CivilianSpawnedMessage extends BaseMessage {
  type: typeof MessageType.CIVILIAN_SPAWNED;
  entityId: number;
  name: string;
}

/** Client -> Server: request civilian panel data. */
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
  /** Building type the civilian is specialized in, or null. */
  specialty: string | null;
}

/** One production building available for assignment. */
export interface WorkableBuildingEntry {
  entityId: number;
  buildingType: string;
  workerName: string | null;
  /** Max worker slots for this building (usually 1). */
  maxWorkers: number;
  /** Current production rate (resources per tick, or HP per tick for repair). */
  productionRate: number;
  /** Resource type produced (e.g. 'wood', 'stone'), or 'repair' for repair station. */
  resourceType: string;
  /** Building upgrade level. */
  level: number;
}

/** Server -> Client: full civilian panel state. */
export interface CivilianPanelStateMessage extends BaseMessage {
  type: typeof MessageType.CIVILIAN_PANEL_STATE;
  civilians: CivilianPanelEntry[];
  buildings: WorkableBuildingEntry[];
  population: number;
  housingCapacity: number;
  /** Seconds until next civilian spawn (0 if at capacity). */
  nextSpawnSeconds: number;
}

/** Client -> Server: assign a civilian to a building (or null to unassign). */
export interface CivilianAssignMessage extends BaseMessage {
  type: typeof MessageType.CIVILIAN_ASSIGN;
  civilianId: number;
  buildingId: number | null;
}

// ---- Training Center ----

/** Client -> Server: request to train a guard at a training center. */
export interface TrainGuardMessage extends BaseMessage {
  type: typeof MessageType.TRAIN_GUARD;
  buildingId: number;
  role: 'warrior' | 'ranger' | 'mage';
}

/** Server -> Client: training result. */
export interface TrainGuardResultMessage extends BaseMessage {
  type: typeof MessageType.TRAIN_GUARD_RESULT;
  success: boolean;
  reason?: string;
}

// ---- Tavern / Heroes ----

export interface TavernStateMessage extends BaseMessage {
  type: typeof MessageType.TAVERN_STATE;
  tavernId: number;
  roster: Array<{ heroId: string; name: string; cost: number; hp: number; damage: number; ability: string }>;
  activeCount: number;
  maxHeroes: number;
}

export interface HireHeroMessage extends BaseMessage {
  type: typeof MessageType.HIRE_HERO;
  tavernId: number;
  heroId: string;
}

export interface HireHeroResultMessage extends BaseMessage {
  type: typeof MessageType.HIRE_HERO_RESULT;
  success: boolean;
  reason?: string;
}

export interface HeroDiedMessage extends BaseMessage {
  type: typeof MessageType.HERO_DIED;
  heroId: string;
  heroName: string;
}

export interface HeroAbilityMessage extends BaseMessage {
  type: typeof MessageType.HERO_ABILITY;
  heroId: string;
  abilityId: string;
  x: number;
  y: number;
  radius: number;
}
