/**
 * Shared context object passed to extracted building sub-modules.
 * Replaces the closure variables from the original monolithic factory.
 */
import { World } from '@shared/ecs/World';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import type { SpatialHash } from '../SpatialHash';
import type { CombatSystem } from '../CombatSystem';
import type { SessionPlayer, SendFn } from '../../core/GameSession';

// ── Dependencies injected from GameSession ──────────────────────────────

export interface BuildingSystemDeps {
  world: World;
  generator: WorldGenerator;
  combat: CombatSystem;
  warehousePool: Record<string, number>;
  warehouseIds: Set<number>;
  bridgePositions: Map<string, number>;
  movementBridgeTiles: Set<string>;
  players: Map<string, SessionPlayer>;
  playerEntityIds: Set<number>;
  respawnTimers: Map<string, number>;
  buildingsByPlayer: Map<string, number>;
  cards: {
    playerBuffs: Map<string, { abilities: string[] }>;
    debuffs: { turretCooldownMult: number; productionIntervalMult: number; buildingRegenRate: number };
  };
  /** World event production multiplier (Resource Boom = 3x). */
  getEventProductionMult?: () => number;
  isActive: () => boolean; // phase === 'playing' && !paused && !gameOver
  isWalkable: (wx: number, wy: number) => boolean;
  spawnBuilding: (x: number, y: number, type: string, maxHp: number, permanent: boolean, rotation?: number) => number;
  spawnItemDrop: (x: number, y: number, itemType: string, quantity: number, autoPickup: boolean) => number;
  destroyDeadEntities: (deaths: number[], attackerMap: Map<number, number> | undefined, send: SendFn) => void;
  /** Whether the campfire has been placed by the player. */
  isCampfirePlaced: () => boolean;
  /** Check if a world position is within the building range square. */
  isInsideBuildRange: (wx: number, wy: number) => boolean;
  /** Called when the campfire is placed. Sets flag, updates spawn origin, broadcasts range. */
  onCampfirePlaced: (entityId: number, send: SendFn) => void;
  /** Broadcast updated building range to all clients. */
  broadcastBuildRange: (send: SendFn) => void;
  /** Get the entity ID of the placed market (-1 if none). */
  getMarketEntityId?: () => number;
  /** Set the entity ID of the placed market. */
  setMarketEntityId?: (id: number) => void;
}

// ── Shared context for extracted sub-modules ────────────────────────────

export interface BuildingContext {
  world: World;
  generator: WorldGenerator;
  combat: CombatSystem;
  warehousePool: () => Record<string, number>;
  warehouseIds: Set<number>;
  bridgePositions: Map<string, number>;
  movementBridgeTiles: Set<string>;
  players: Map<string, SessionPlayer>;
  playerEntityIds: Set<number>;
  respawnTimers: Map<string, number>;
  buildingsByPlayer: Map<string, number>;
  cards: {
    playerBuffs: Map<string, { abilities: string[] }>;
    debuffs: { turretCooldownMult: number; productionIntervalMult: number; buildingRegenRate: number };
  };
  getEventProductionMult: () => number;
  isActive: () => boolean;
  isWalkable: (wx: number, wy: number) => boolean;
  spawnBuilding: (x: number, y: number, type: string, maxHp: number, permanent: boolean, rotation?: number) => number;
  spawnItemDrop: (x: number, y: number, itemType: string, quantity: number, autoPickup: boolean) => number;
  destroyDeadEntities: (deaths: number[], attackerMap: Map<number, number> | undefined, send: SendFn) => void;
  enemyHash: SpatialHash;
  broadcastWarehouseUpdate: (send: SendFn) => void;
  isCampfirePlaced: () => boolean;
  isInsideBuildRange: (wx: number, wy: number) => boolean;
  onCampfirePlaced: (entityId: number, send: SendFn) => void;
  broadcastBuildRange: (send: SendFn) => void;
  /** Get the entity ID of the placed market (-1 if none). */
  getMarketEntityId: () => number;
  /** Set the entity ID of the placed market. */
  setMarketEntityId: (id: number) => void;
}
