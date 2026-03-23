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
}
