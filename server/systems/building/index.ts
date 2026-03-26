/**
 * BuildingSystem - factory that creates the building system for a game session.
 *
 * Split into sub-modules:
 *   - BuildingContext.ts  - shared context interface
 *   - BuildingTicks.ts    - all per-tick building logic
 *   - BuildingPlacement.ts - placement, demolition, upgrade, repair handlers
 *
 * The factory pattern is preserved: createBuildingSystem(deps) => { publicAPI }
 */
import {
  C,
  PositionComponent,
} from '@shared/components';
import { MessageType } from '@shared/protocol';
import { createSpatialHash } from '../SpatialHash';
import type { BuildingSystemDeps } from './BuildingContext';
import type { BuildingContext } from './BuildingContext';
import type { SendFn } from '../../core/GameSession';

import * as Ticks from './BuildingTicks';
import * as Placement from './BuildingPlacement';

// Re-export the deps interface so existing importers work
export type { BuildingSystemDeps } from './BuildingContext';

export function createBuildingSystem(deps: BuildingSystemDeps) {
  const {
    world, generator, combat,
    warehouseIds, bridgePositions, movementBridgeTiles,
    players, playerEntityIds, respawnTimers, buildingsByPlayer, cards,
    isActive, isWalkable, spawnBuilding, destroyDeadEntities,
  } = deps;

  // Warehouse pool accessor
  function wPool(): Record<string, number> { return deps.warehousePool; }

  // Spatial hash for enemy positions - rebuilt once per tick
  const enemyHash = createSpatialHash(256);
  function rebuildEnemyHash(): void {
    enemyHash.clear();
    for (const eid of world.query(C.EnemyStats, C.Position)) {
      const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
      enemyHash.insert(eid, ep.x, ep.y);
    }
  }

  // Broadcast warehouse update to all players
  function broadcastWarehouseUpdate(send: SendFn): void {
    const msg = {
      type: MessageType.WAREHOUSE_UPDATE,
      ...wPool(),
      exists: warehouseIds.size > 0,
    };
    for (const p of players.values()) send(p.client, msg);
  }

  // Build the shared context object
  const ctx: BuildingContext = {
    world,
    generator,
    combat,
    warehousePool: wPool,
    warehouseIds,
    bridgePositions,
    movementBridgeTiles,
    players,
    playerEntityIds,
    respawnTimers,
    buildingsByPlayer,
    cards,
    getEventProductionMult: () => deps.getEventProductionMult?.() ?? 1.0,
    isActive,
    isWalkable,
    spawnBuilding,
    spawnItemDrop: deps.spawnItemDrop,
    destroyDeadEntities,
    enemyHash,
    broadcastWarehouseUpdate,
    isCampfirePlaced: deps.isCampfirePlaced ?? (() => true),
    isInsideBuildRange: deps.isInsideBuildRange ?? (() => true),
    onCampfirePlaced: deps.onCampfirePlaced ?? (() => {}),
    broadcastBuildRange: deps.broadcastBuildRange ?? (() => {}),
  };

  return {
    handlePlace: (clientId: string, msg: any, send: SendFn) => Placement.handlePlace(ctx, clientId, msg, send),
    handleDemolish: (clientId: string, msg: any, send: SendFn) => Placement.handleDemolish(ctx, clientId, msg, send),
    handleUpgrade: (clientId: string, msg: any, send: SendFn) => Placement.handleUpgrade(ctx, clientId, msg, send),
    handleRepair: (clientId: string, msg: any, send: SendFn) => Placement.handleRuinRepair(ctx, clientId, msg, send),
    handleMove: (clientId: string, msg: any, send: SendFn) => Placement.handleBuildMove(ctx, clientId, msg, send),
    broadcastWarehouseUpdate,
    depositPlayerToWarehouse: (playerEntityId: number, send: SendFn) => Placement.depositPlayerToWarehouse(ctx, playerEntityId, send),
    cleanupBridge: (entityId: number) => Placement.cleanupBridge(ctx, entityId),
    spawnTrainedGuard: (x: number, y: number, buildingId: number, role: 'warrior' | 'ranger' | 'mage') => Ticks.spawnTrainedGuard(world, x, y, buildingId, role),
    tick(dt: number, send: SendFn): void {
      rebuildEnemyHash();
      Ticks.tickSiegeWorkshops(ctx);
      Ticks.tickProduction(ctx, dt);
      Ticks.tickTurrets(ctx, dt, send);
      Ticks.tickLaserBeams(ctx, dt, send);
      Ticks.tickGhostVisibility(ctx);
      Ticks.tickHealAuras(ctx, dt);
      Ticks.tickBarracks(ctx, dt);
      Ticks.tickSpikeTraps(ctx, dt, send);
      Ticks.tickBuildingRegen(ctx, dt);
      Ticks.tickRuins(ctx, dt, send);
      Ticks.tickTeslaCoils(ctx, dt, send);
      Ticks.tickFlameTowers(ctx, dt, send);
      Ticks.tickRepairStations(ctx, dt);
      Ticks.tickMoats(ctx);
      Ticks.tickKennels(ctx, dt);
    },
  };
}

export type BuildingSystem = ReturnType<typeof createBuildingSystem>;
