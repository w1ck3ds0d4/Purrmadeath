import { World } from '@shared/ecs/World';
import { distance } from '@shared/math/utils';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import {
  C,
  PositionComponent,
  HealthComponent,
  FactionComponent,
  ResourcesComponent,
  BuildingComponent,
  ProductionComponent,
  TurretComponent,
  SpikeTrapComponent,
  BridgeComponent,
  PlayerInputComponent,
} from '@shared/components';
import type {
  EnemyStatsComponent, GhostStateComponent, LightRevealComponent,
  HealAuraComponent, BarracksSpawnerComponent, GuardComponent,
  WorkerSlotComponent, HousingComponent, RuinsComponent, LaserBeamComponent,
} from '@shared/components';
import {
  TILE_SIZE, PLAYER_RADIUS, ENEMY_RADIUS, RESOURCE_NODE_RADIUS,
  PROJECTILE_RADIUS, RANGED_LIFETIME,
  BUILDING_COSTS, BUILDING_SIZES, buildingHalfExtent, buildingExtent, snapBuildingPosition,
  BUILDING_MAX_LEVEL, DEMOLISH_REFUND_PERCENT, RUINS_REPAIR_COST_MULT, RUINS_RESTORE_COST_MULT,
  CAMPFIRE_MAX_HEALTH, WALL_MAX_HEALTH, WAREHOUSE_MAX_HEALTH,
  LUMBERMILL_MAX_HEALTH, QUARRY_MAX_HEALTH, MINE_MAX_HEALTH, FARM_MAX_HEALTH,
  ARROW_TURRET_MAX_HEALTH, CANNON_TURRET_MAX_HEALTH, SPIKE_TRAP_MAX_HEALTH,
  BRIDGE_MAX_HEALTH, LIGHT_TOWER_MAX_HEALTH, HEALING_SHRINE_MAX_HEALTH, BARRACKS_MAX_HEALTH, POTION_SHOP_MAX_HEALTH,
  LUMBERMILL_PRODUCTION_INTERVAL, QUARRY_PRODUCTION_INTERVAL, MINE_PRODUCTION_INTERVAL, FARM_PRODUCTION_INTERVAL,
  PRODUCTION_AMOUNT, PRODUCTION_MAX_STORED,
  ARROW_TURRET_RANGE, ARROW_TURRET_COOLDOWN, ARROW_TURRET_DAMAGE, ARROW_TURRET_PROJ_SPEED,
  CANNON_TURRET_RANGE, CANNON_TURRET_COOLDOWN, CANNON_TURRET_DAMAGE, CANNON_TURRET_PROJ_SPEED,
  SPIKE_TRAP_DAMAGE, SPIKE_TRAP_COOLDOWN, SPIKE_TRAP_SELF_DAMAGE,
  WAREHOUSE_DEPOSIT_RADIUS,
  UPGRADE_HP_MULT, UPGRADE_PROD_INTERVAL, UPGRADE_PROD_MAX,
  UPGRADE_ARROW_CD, UPGRADE_ARROW_DMG, UPGRADE_CANNON_CD, UPGRADE_CANNON_DMG,
  UPGRADE_CANNON_AOE, CANNON_AOE_BASE_RADIUS, UPGRADE_TRAP_DMG,
  UPGRADE_LIGHT_RANGE, UPGRADE_HEAL_RATE, UPGRADE_HEAL_RANGE,
  BARRACKS_MAX_GUARDS, BARRACKS_SPAWN_INTERVAL,
  BARRACKS_GUARD_HP, BARRACKS_GUARD_DAMAGE, BARRACKS_GUARD_SPEED, BARRACKS_GUARD_PATROL_RADIUS,
  GUARD_ATTACK_COOLDOWN, GUARD_MELEE_RANGE, GUARD_MELEE_KNOCKBACK, GUARD_RADIUS,
  CAT_HOUSE_MAX_HEALTH, DORMITORY_MAX_HEALTH, CAT_HOUSE_CAPACITY, DORMITORY_CAPACITY,
  GATE_MAX_HEALTH, BALLISTA_MAX_HEALTH, LASER_TOWER_MAX_HEALTH, WORKSHOP_MAX_HEALTH, TRAINING_CENTER_MAX_HEALTH,
  BALLISTA_RANGE, BALLISTA_COOLDOWN, BALLISTA_DAMAGE, BALLISTA_PROJ_SPEED,
  UPGRADE_BALLISTA_AOE, UPGRADE_BALLISTA_CD, UPGRADE_BALLISTA_DMG,
  UPGRADE_LASER_RANGE, UPGRADE_LASER_DPS,
  WORKSHOP_PROD_INTERVAL,
  TRAINING_CENTER_MAX_GUARDS,
  TC_WARRIOR_HP, TC_WARRIOR_DAMAGE, TC_WARRIOR_SPEED,
  TC_RANGER_HP, TC_RANGER_DAMAGE, TC_RANGER_RANGE, TC_RANGER_SPEED,
  TC_MAGE_HP, TC_MAGE_DAMAGE, TC_MAGE_RANGE, TC_MAGE_SPEED,
  getUpgradeCost, getRepairCost,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import { MessageType } from '@shared/protocol';
import type {
  BuildPlaceMessage, BuildConfirmMessage, BuildDemolishMessage, BuildUpgradeMessage,
  BuildUpgradeConfirmMessage, BuildRepairMessage, BuildRepairConfirmMessage,
  HitMessage, ProjectileSpawnMessage,
} from '@shared/protocol';
import type { ConnectedClient } from '../net/ServerSocket';
import type { CombatSystem } from './CombatSystem';
import type { SessionPlayer, SendFn } from '../core/GameSession';

// ── HP map for new buildings ────────────────────────────────────────────────

const HP_MAP: Record<string, number> = {
  campfire: CAMPFIRE_MAX_HEALTH, wall: WALL_MAX_HEALTH, warehouse: WAREHOUSE_MAX_HEALTH,
  lumbermill: LUMBERMILL_MAX_HEALTH, quarry: QUARRY_MAX_HEALTH, mine: MINE_MAX_HEALTH, farm: FARM_MAX_HEALTH,
  arrow_turret: ARROW_TURRET_MAX_HEALTH, cannon_turret: CANNON_TURRET_MAX_HEALTH,
  spike_trap: SPIKE_TRAP_MAX_HEALTH, bridge: BRIDGE_MAX_HEALTH,
  light_tower: LIGHT_TOWER_MAX_HEALTH, healing_shrine: HEALING_SHRINE_MAX_HEALTH,
  barracks: BARRACKS_MAX_HEALTH,
  potion_shop: POTION_SHOP_MAX_HEALTH,
  cat_house: CAT_HOUSE_MAX_HEALTH,
  dormitory: DORMITORY_MAX_HEALTH,
  gate: GATE_MAX_HEALTH,
  ballista: BALLISTA_MAX_HEALTH,
  laser_tower: LASER_TOWER_MAX_HEALTH,
  workshop: WORKSHOP_MAX_HEALTH,
  training_center: TRAINING_CENTER_MAX_HEALTH,
};

// ── Dependencies injected from GameSession ──────────────────────────────────

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

// ── Factory ─────────────────────────────────────────────────────────────────

export function createBuildingSystem(deps: BuildingSystemDeps) {
  const {
    world, generator, combat,
    warehouseIds, bridgePositions, movementBridgeTiles,
    players, playerEntityIds, respawnTimers, buildingsByPlayer, cards,
    isActive, isWalkable, spawnBuilding, destroyDeadEntities,
  } = deps;

  // Warehouse pool is a mutable ref - read via closure each time
  function wPool(): Record<string, number> { return deps.warehousePool; }

  // ── Cost helpers ──────────────────────────────────────────────────────────

  function deductBuildingCost(
    buildingType: string, player: SessionPlayer, send: SendFn,
    costOverride?: Partial<Record<string, number>>,
  ): boolean {
    const costs = costOverride ?? BUILDING_COSTS[buildingType] ?? {};
    const playerRes = world.getComponent<any>(player.entityId!, C.Resources);
    if (!playerRes) return false;

    const hasWarehouse = warehouseIds.size > 0;
    const wp = wPool();
    const pPool = playerRes as Record<string, number>;

    for (const [res, amount] of Object.entries(costs)) {
      const total = (hasWarehouse ? (wp[res] ?? 0) : 0) + (pPool[res] ?? 0);
      if (total < amount!) return false;
    }

    let drewFromWarehouse = false;
    let drewFromPlayer = false;
    for (const [res, amount] of Object.entries(costs)) {
      let remaining = amount!;
      if (hasWarehouse) {
        const fromW = Math.min(remaining, wp[res] ?? 0);
        if (fromW > 0) { wp[res] -= fromW; remaining -= fromW; drewFromWarehouse = true; }
      }
      if (remaining > 0) { pPool[res] -= remaining; drewFromPlayer = true; }
    }

    if (drewFromWarehouse) broadcastWarehouseUpdate(send);
    if (drewFromPlayer) {
      send(player.client, {
        type: MessageType.RESOURCE_UPDATE,
        wood: playerRes.wood, stone: playerRes.stone, iron: playerRes.iron,
        diamond: playerRes.diamond, gold: playerRes.gold, food: playerRes.food, weapons: playerRes.weapons,
      });
    }
    return true;
  }

  function broadcastWarehouseUpdate(send: SendFn): void {
    const msg = {
      type: MessageType.WAREHOUSE_UPDATE,
      ...wPool(),
      exists: warehouseIds.size > 0,
    };
    for (const p of players.values()) send(p.client, msg);
  }

  // ── Footprint collision ───────────────────────────────────────────────────

  function footprintCollides(cx: number, cy: number, buildingType: string, rotation: number = 0): boolean {
    const newExt = buildingExtent(buildingType, rotation);
    for (const id of world.query(C.Position, C.Faction)) {
      const f = world.getComponent<FactionComponent>(id, C.Faction)!;
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      let exHx: number;
      let exHy: number;
      if (f.type === 'building') {
        const b = world.getComponent<BuildingComponent>(id, C.Building);
        const bExt = buildingExtent(b?.buildingType ?? 'wall', b?.rotation ?? 0);
        exHx = bExt.hx;
        exHy = bExt.hy;
      } else if (f.type === 'resource') {
        exHx = RESOURCE_NODE_RADIUS;
        exHy = RESOURCE_NODE_RADIUS;
      } else if (f.type === 'player') {
        if (world.hasComponent(id, C.Downed)) continue;
        exHx = PLAYER_RADIUS;
        exHy = PLAYER_RADIUS;
      } else if (f.type === 'enemy') {
        exHx = ENEMY_RADIUS;
        exHy = ENEMY_RADIUS;
      } else {
        continue;
      }
      if (Math.abs(pos.x - cx) < newExt.hx + exHx && Math.abs(pos.y - cy) < newExt.hy + exHy) return true;
    }
    return false;
  }

  function cleanupBridge(entityId: number): void {
    const bridge = world.getComponent<BridgeComponent>(entityId, C.Bridge);
    if (bridge) {
      const key = `${bridge.tileX},${bridge.tileY}`;
      bridgePositions.delete(key);
      movementBridgeTiles.delete(key);
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handlePlace(clientId: string, msg: BuildPlaceMessage, send: SendFn): void {
    if (!isActive()) return;
    const player = players.get(clientId);
    if (!player || player.entityId === null) return;
    if (world.hasComponent(player.entityId, C.Downed)) return;
    if (respawnTimers.has(clientId)) return;
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;

    if (!BUILDING_COSTS[msg.buildingType]) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'unknown_type' } as BuildConfirmMessage);
      return;
    }

    const rotation = msg.rotation ?? 0;
    const { x: snapX, y: snapY } = snapBuildingPosition(msg.x, msg.y, msg.buildingType, rotation);
    const bSize = BUILDING_SIZES[msg.buildingType] ?? { w: 1, h: 1 };
    const tilesW = rotation === 1 ? bSize.h : bSize.w;
    const tilesH = rotation === 1 ? bSize.w : bSize.h;
    const ext = buildingExtent(msg.buildingType, rotation);
    const startTX = Math.floor((snapX - ext.hx) / TILE_SIZE);
    const startTY = Math.floor((snapY - ext.hy) / TILE_SIZE);
    const isBridge = msg.buildingType === 'bridge';
    for (let dy = 0; dy < tilesH; dy++) {
      for (let dx = 0; dx < tilesW; dx++) {
        const tx = startTX + dx;
        const ty = startTY + dy;
        const tileId = generator.getTile(tx, ty);
        const walkable = TILE_DEFS[tileId]?.walkable ?? false;
        if (isBridge) {
          if (walkable || bridgePositions.has(`${tx},${ty}`)) {
            send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'not_water' } as BuildConfirmMessage);
            return;
          }
        } else if (!walkable) {
          send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'not_walkable' } as BuildConfirmMessage);
          return;
        }
      }
    }

    if (footprintCollides(snapX, snapY, msg.buildingType, rotation)) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'blocked' } as BuildConfirmMessage);
      return;
    }

    if (!deductBuildingCost(msg.buildingType, player, send)) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'insufficient_resources' } as BuildConfirmMessage);
      return;
    }

    const maxHp = HP_MAP[msg.buildingType] ?? WALL_MAX_HEALTH;
    const id = spawnBuilding(snapX, snapY, msg.buildingType, maxHp, false, rotation);

    if (msg.buildingType === 'warehouse') {
      warehouseIds.add(id);
      broadcastWarehouseUpdate(send);
    }

    // Attach special components
    if (msg.buildingType === 'lumbermill') {
      world.addComponent(id, C.Production, {
        resourceType: 'wood', interval: LUMBERMILL_PRODUCTION_INTERVAL,
        timer: 0, amount: PRODUCTION_AMOUNT, stored: 0, maxStored: PRODUCTION_MAX_STORED,
      } as ProductionComponent);
    } else if (msg.buildingType === 'quarry') {
      world.addComponent(id, C.Production, {
        resourceType: 'stone', interval: QUARRY_PRODUCTION_INTERVAL,
        timer: 0, amount: PRODUCTION_AMOUNT, stored: 0, maxStored: PRODUCTION_MAX_STORED,
      } as ProductionComponent);
    } else if (msg.buildingType === 'mine') {
      world.addComponent(id, C.Production, {
        resourceType: 'iron', interval: MINE_PRODUCTION_INTERVAL,
        timer: 0, amount: PRODUCTION_AMOUNT, stored: 0, maxStored: PRODUCTION_MAX_STORED,
        secondaryResourceType: 'diamond', secondaryChance: 0.2,
      } as ProductionComponent);
    } else if (msg.buildingType === 'farm') {
      world.addComponent(id, C.Production, {
        resourceType: 'food', interval: FARM_PRODUCTION_INTERVAL,
        timer: 0, amount: PRODUCTION_AMOUNT, stored: 0, maxStored: PRODUCTION_MAX_STORED,
      } as ProductionComponent);
    } else if (msg.buildingType === 'arrow_turret') {
      world.addComponent(id, C.Turret, {
        range: ARROW_TURRET_RANGE, cooldown: ARROW_TURRET_COOLDOWN,
        cooldownTimer: 0, damage: ARROW_TURRET_DAMAGE, projectileSpeed: ARROW_TURRET_PROJ_SPEED,
      } as TurretComponent);
    } else if (msg.buildingType === 'cannon_turret') {
      world.addComponent(id, C.Turret, {
        range: CANNON_TURRET_RANGE, cooldown: CANNON_TURRET_COOLDOWN,
        cooldownTimer: 0, damage: CANNON_TURRET_DAMAGE, projectileSpeed: CANNON_TURRET_PROJ_SPEED,
      } as TurretComponent);
    } else if (msg.buildingType === 'spike_trap') {
      world.addComponent(id, C.SpikeTrap, {
        damage: SPIKE_TRAP_DAMAGE, cooldown: SPIKE_TRAP_COOLDOWN,
        selfDamage: SPIKE_TRAP_SELF_DAMAGE, enemyCooldowns: new Map(),
      } as SpikeTrapComponent);
    } else if (msg.buildingType === 'bridge') {
      const tileX = Math.floor(snapX / TILE_SIZE);
      const tileY = Math.floor(snapY / TILE_SIZE);
      world.addComponent(id, C.Bridge, { tileX, tileY } as BridgeComponent);
      bridgePositions.set(`${tileX},${tileY}`, id);
      movementBridgeTiles.add(`${tileX},${tileY}`);
    } else if (msg.buildingType === 'laser_tower') {
      world.addComponent(id, C.LaserBeam, {
        range: UPGRADE_LASER_RANGE[0], damagePerSecond: UPGRADE_LASER_DPS[0], targetId: null,
      } as LaserBeamComponent);
    } else if (msg.buildingType === 'light_tower') {
      world.addComponent(id, C.LightReveal, { range: UPGRADE_LIGHT_RANGE[0] } as LightRevealComponent);
    } else if (msg.buildingType === 'healing_shrine') {
      world.addComponent(id, C.HealAura, { range: UPGRADE_HEAL_RANGE[0], healPerSecond: UPGRADE_HEAL_RATE[0] } as HealAuraComponent);
    } else if (msg.buildingType === 'ballista') {
      world.addComponent(id, C.Turret, {
        range: BALLISTA_RANGE, cooldown: BALLISTA_COOLDOWN,
        cooldownTimer: 0, damage: BALLISTA_DAMAGE, projectileSpeed: BALLISTA_PROJ_SPEED,
      } as TurretComponent);
    } else if (msg.buildingType === 'workshop') {
      world.addComponent(id, C.Production, {
        resourceType: 'weapons', interval: WORKSHOP_PROD_INTERVAL[0],
        timer: 0, amount: 1, stored: 0, maxStored: PRODUCTION_MAX_STORED,
      } as ProductionComponent);
    } else if (msg.buildingType === 'barracks') {
      world.addComponent(id, C.BarracksSpawner, {
        maxGuards: BARRACKS_MAX_GUARDS[0], spawnTimer: BARRACKS_SPAWN_INTERVAL,
        spawnInterval: BARRACKS_SPAWN_INTERVAL, guardIds: [],
      } as BarracksSpawnerComponent);
    } else if (msg.buildingType === 'training_center') {
      world.addComponent(id, C.TrainingCenter, {
        maxGuards: TRAINING_CENTER_MAX_GUARDS[0], guardIds: [],
      } as import('@shared/components').TrainingCenterComponent);
    } else if (msg.buildingType === 'cat_house') {
      world.addComponent(id, C.Housing, { capacity: CAT_HOUSE_CAPACITY[0], residentIds: [] } as HousingComponent);
    } else if (msg.buildingType === 'dormitory') {
      world.addComponent(id, C.Housing, { capacity: DORMITORY_CAPACITY[0], residentIds: [] } as HousingComponent);
    }

    // Attach WorkerSlot to production buildings so civilians can staff them
    if (['lumbermill', 'quarry', 'mine', 'farm', 'workshop'].includes(msg.buildingType)) {
      world.addComponent(id, C.WorkerSlot, { workerId: null } as WorkerSlotComponent);
    }

    send(player.client, { type: MessageType.BUILD_CONFIRM, success: true } as BuildConfirmMessage);
    buildingsByPlayer.set(player.playerId, (buildingsByPlayer.get(player.playerId) ?? 0) + 1);
  }

  function handleDemolish(clientId: string, msg: BuildDemolishMessage, send: SendFn): void {
    if (!isActive()) return;
    const player = players.get(clientId);
    if (!player || player.entityId === null) return;
    if (world.hasComponent(player.entityId, C.Downed)) return;
    if (respawnTimers.has(clientId)) return;

    const targetId = msg.entityId;
    if (!Number.isFinite(targetId)) return;
    if (!world.hasEntity(targetId)) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'no_building' } as BuildConfirmMessage);
      return;
    }
    const bldg = world.getComponent<BuildingComponent>(targetId, C.Building);
    if (!bldg) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'no_building' } as BuildConfirmMessage);
      return;
    }
    if (bldg.permanent) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'permanent' } as BuildConfirmMessage);
      return;
    }

    // Calculate total invested cost for refund
    const baseCosts = BUILDING_COSTS[bldg.buildingType] ?? {};
    const totalCosts: Record<string, number> = {};
    for (const [res, amount] of Object.entries(baseCosts)) totalCosts[res] = amount!;
    for (let lvl = 1; lvl < bldg.upgradeLevel; lvl++) {
      const upgCost = getUpgradeCost(bldg.buildingType, lvl);
      if (upgCost) {
        for (const [res, amount] of Object.entries(upgCost)) totalCosts[res] = (totalCosts[res] ?? 0) + (amount as number);
      }
    }

    const isDemolingWarehouse = warehouseIds.has(targetId);

    if (warehouseIds.size > 0 && !(isDemolingWarehouse && warehouseIds.size === 1)) {
      for (const [res, amount] of Object.entries(totalCosts)) {
        wPool()[res] += Math.floor(amount * DEMOLISH_REFUND_PERCENT);
      }
      broadcastWarehouseUpdate(send);
    } else {
      const res = world.getComponent<any>(player.entityId, C.Resources);
      if (res) {
        for (const [key, amount] of Object.entries(totalCosts)) {
          (res as Record<string, number>)[key] += Math.floor(amount * DEMOLISH_REFUND_PERCENT);
        }
        send(player.client, {
          type: MessageType.RESOURCE_UPDATE,
          wood: res.wood, stone: res.stone, iron: res.iron, diamond: res.diamond, gold: res.gold, food: res.food, weapons: res.weapons,
        });
      }
    }

    if (isDemolingWarehouse) {
      // Drop 50% of warehouse contents on the ground before removing
      const wPos = world.getComponent<PositionComponent>(targetId, C.Position);
      if (wPos) {
        const wp = wPool();
        const MAX_PER_DROP = 50;
        for (const [res, amount] of Object.entries(wp)) {
          const dropAmount = Math.floor(amount * 0.5);
          if (dropAmount <= 0) continue;
          wp[res] -= dropAmount;
          let remaining = dropAmount;
          while (remaining > 0) {
            const qty = Math.min(remaining, MAX_PER_DROP);
            deps.spawnItemDrop(wPos.x, wPos.y, res, qty, true);
            remaining -= qty;
          }
        }
      }

      warehouseIds.delete(targetId);
      if (warehouseIds.size === 0) {
        const wp = wPool();
        wp.wood = 0; wp.stone = 0; wp.iron = 0; wp.diamond = 0; wp.gold = 0; wp.food = 0;
      }
      broadcastWarehouseUpdate(send);
    }

    cleanupBridge(targetId);
    world.destroyEntity(targetId);
    for (const p of players.values()) {
      send(p.client, { type: MessageType.BUILD_DESTROYED, entityId: targetId } as any);
    }
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: true } as BuildConfirmMessage);
  }

  function handleUpgrade(clientId: string, msg: BuildUpgradeMessage, send: SendFn): void {
    if (!isActive()) return;
    const player = players.get(clientId);
    if (!player || player.entityId === null) return;
    if (world.hasComponent(player.entityId, C.Downed)) return;
    if (respawnTimers.has(clientId)) return;

    const targetId = msg.entityId;
    if (!Number.isFinite(targetId)) return;
    if (!world.hasEntity(targetId)) {
      send(player.client, { type: MessageType.BUILD_UPGRADE_CONFIRM, success: false, reason: 'no_building' } as BuildUpgradeConfirmMessage);
      return;
    }
    const bldg = world.getComponent<BuildingComponent>(targetId, C.Building);
    if (!bldg) {
      send(player.client, { type: MessageType.BUILD_UPGRADE_CONFIRM, success: false, reason: 'no_building' } as BuildUpgradeConfirmMessage);
      return;
    }

    const maxLevel = BUILDING_MAX_LEVEL[bldg.buildingType] ?? 1;
    if (bldg.upgradeLevel >= maxLevel) {
      send(player.client, { type: MessageType.BUILD_UPGRADE_CONFIRM, success: false, reason: 'max_level' } as BuildUpgradeConfirmMessage);
      return;
    }

    const cost = getUpgradeCost(bldg.buildingType, bldg.upgradeLevel);
    if (!cost) {
      send(player.client, { type: MessageType.BUILD_UPGRADE_CONFIRM, success: false, reason: 'max_level' } as BuildUpgradeConfirmMessage);
      return;
    }

    if (!deductBuildingCost(bldg.buildingType, player, send, cost as Partial<Record<string, number>>)) {
      send(player.client, { type: MessageType.BUILD_UPGRADE_CONFIRM, success: false, reason: 'insufficient_resources' } as BuildUpgradeConfirmMessage);
      return;
    }

    const oldLevel = bldg.upgradeLevel;
    bldg.upgradeLevel = oldLevel + 1;
    const newLevel = bldg.upgradeLevel;
    const lvlIdx = newLevel - 1;

    // Scale HP + fully repair
    const hp = world.getComponent<HealthComponent>(targetId, C.Health)!;
    const baseMaxHp = hp.max / UPGRADE_HP_MULT[oldLevel - 1];
    hp.max = Math.round(baseMaxHp * UPGRADE_HP_MULT[lvlIdx]);
    hp.current = hp.max;

    // Scale production
    const prod = world.getComponent<ProductionComponent>(targetId, C.Production);
    if (prod) {
      if (bldg.buildingType === 'workshop' && lvlIdx < WORKSHOP_PROD_INTERVAL.length) {
        // Workshop uses absolute interval values per level
        prod.interval = WORKSHOP_PROD_INTERVAL[lvlIdx];
      } else if (lvlIdx < UPGRADE_PROD_INTERVAL.length) {
        const baseInterval = prod.interval / UPGRADE_PROD_INTERVAL[oldLevel - 1];
        prod.interval = baseInterval * UPGRADE_PROD_INTERVAL[lvlIdx];
        const baseMax = prod.maxStored / UPGRADE_PROD_MAX[oldLevel - 1];
        prod.maxStored = Math.round(baseMax * UPGRADE_PROD_MAX[lvlIdx]);
      }
    }

    // Scale turrets
    const turret = world.getComponent<TurretComponent>(targetId, C.Turret);
    if (turret && lvlIdx < UPGRADE_ARROW_CD.length) {
      if (bldg.buildingType === 'arrow_turret') {
        turret.cooldown = (turret.cooldown / UPGRADE_ARROW_CD[oldLevel - 1]) * UPGRADE_ARROW_CD[lvlIdx];
        turret.damage = Math.round((turret.damage / UPGRADE_ARROW_DMG[oldLevel - 1]) * UPGRADE_ARROW_DMG[lvlIdx]);
      } else if (bldg.buildingType === 'cannon_turret') {
        turret.cooldown = (turret.cooldown / UPGRADE_CANNON_CD[oldLevel - 1]) * UPGRADE_CANNON_CD[lvlIdx];
        turret.damage = Math.round((turret.damage / UPGRADE_CANNON_DMG[oldLevel - 1]) * UPGRADE_CANNON_DMG[lvlIdx]);
      } else if (bldg.buildingType === 'ballista') {
        turret.cooldown = (turret.cooldown / UPGRADE_BALLISTA_CD[oldLevel - 1]) * UPGRADE_BALLISTA_CD[lvlIdx];
        turret.damage = Math.round((turret.damage / UPGRADE_BALLISTA_DMG[oldLevel - 1]) * UPGRADE_BALLISTA_DMG[lvlIdx]);
      }
      turret.cooldownTimer = 0;
    }

    // Scale spike trap
    const trap = world.getComponent<SpikeTrapComponent>(targetId, C.SpikeTrap);
    if (trap && lvlIdx < UPGRADE_TRAP_DMG.length) {
      trap.damage = Math.round((trap.damage / UPGRADE_TRAP_DMG[oldLevel - 1]) * UPGRADE_TRAP_DMG[lvlIdx]);
    }

    // Scale light tower
    const lr = world.getComponent<LightRevealComponent>(targetId, C.LightReveal);
    if (lr && lvlIdx < UPGRADE_LIGHT_RANGE.length) lr.range = UPGRADE_LIGHT_RANGE[lvlIdx];

    // Scale laser tower
    const laser = world.getComponent<LaserBeamComponent>(targetId, C.LaserBeam);
    if (laser) {
      if (lvlIdx < UPGRADE_LASER_RANGE.length) laser.range = UPGRADE_LASER_RANGE[lvlIdx];
      if (lvlIdx < UPGRADE_LASER_DPS.length) laser.damagePerSecond = UPGRADE_LASER_DPS[lvlIdx];
    }

    // Scale healing shrine
    const ha = world.getComponent<HealAuraComponent>(targetId, C.HealAura);
    if (ha) {
      if (lvlIdx < UPGRADE_HEAL_RATE.length) ha.healPerSecond = UPGRADE_HEAL_RATE[lvlIdx];
      if (lvlIdx < UPGRADE_HEAL_RANGE.length) ha.range = UPGRADE_HEAL_RANGE[lvlIdx];
    }

    // Scale barracks
    const barracks = world.getComponent<BarracksSpawnerComponent>(targetId, C.BarracksSpawner);
    if (barracks && lvlIdx < BARRACKS_MAX_GUARDS.length) barracks.maxGuards = BARRACKS_MAX_GUARDS[lvlIdx];

    // Scale training center
    const tc = world.getComponent<import('@shared/components').TrainingCenterComponent>(targetId, C.TrainingCenter);
    if (tc && lvlIdx < TRAINING_CENTER_MAX_GUARDS.length) tc.maxGuards = TRAINING_CENTER_MAX_GUARDS[lvlIdx];

    // Scale housing
    const housing = world.getComponent<HousingComponent>(targetId, C.Housing);
    if (housing && bldg.buildingType === 'cat_house' && lvlIdx < CAT_HOUSE_CAPACITY.length) {
      housing.capacity = CAT_HOUSE_CAPACITY[lvlIdx];
    }
    if (housing && bldg.buildingType === 'dormitory' && lvlIdx < DORMITORY_CAPACITY.length) {
      housing.capacity = DORMITORY_CAPACITY[lvlIdx];
    }

    send(player.client, {
      type: MessageType.BUILD_UPGRADE_CONFIRM, success: true, entityId: targetId, newLevel,
    } as BuildUpgradeConfirmMessage);
  }

  function handleRepair(clientId: string, msg: BuildRepairMessage, send: SendFn): void {
    if (!isActive()) return;
    const player = players.get(clientId);
    if (!player || player.entityId === null) return;
    if (world.hasComponent(player.entityId, C.Downed)) return;
    if (respawnTimers.has(clientId)) return;

    const targetId = msg.entityId;
    if (!Number.isFinite(targetId)) return;
    if (!world.hasEntity(targetId)) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'no_building' } as BuildRepairConfirmMessage);
      return;
    }
    const bldg = world.getComponent<BuildingComponent>(targetId, C.Building);
    if (!bldg) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'no_building' } as BuildRepairConfirmMessage);
      return;
    }
    const hp = world.getComponent<HealthComponent>(targetId, C.Health);
    if (!hp || hp.current >= hp.max) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'full_hp' } as BuildRepairConfirmMessage);
      return;
    }

    const missingHp = hp.max - hp.current;
    const cost = getRepairCost(bldg.buildingType, missingHp, hp.max);
    if (!cost) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'full_hp' } as BuildRepairConfirmMessage);
      return;
    }

    if (!deductBuildingCost(bldg.buildingType, player, send, cost as Partial<Record<string, number>>)) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'insufficient_resources' } as BuildRepairConfirmMessage);
      return;
    }

    hp.current = hp.max;
    send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: true, entityId: targetId } as BuildRepairConfirmMessage);
  }

  // ── Tick methods ──────────────────────────────────────────────────────────

  function tickWarehouseDeposit(send: SendFn): void {
    if (warehouseIds.size === 0) return;

    const whPositions: PositionComponent[] = [];
    for (const wid of warehouseIds) {
      const pos = world.getComponent<PositionComponent>(wid, C.Position);
      if (pos) whPositions.push(pos);
    }
    if (whPositions.length === 0) return;

    const r2 = WAREHOUSE_DEPOSIT_RADIUS * WAREHOUSE_DEPOSIT_RADIUS;
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pPos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (!pPos) continue;

      let near = false;
      for (const wPos of whPositions) {
        const dx = pPos.x - wPos.x, dy = pPos.y - wPos.y;
        if (dx * dx + dy * dy <= r2) { near = true; break; }
      }
      if (!near) continue;

      const res = world.getComponent<ResourcesComponent>(p.entityId, C.Resources);
      if (!res) continue;

      let transferred = false;
      for (const key of ['wood', 'stone', 'iron', 'diamond', 'gold', 'food'] as const) {
        if (res[key] > 0) {
          wPool()[key] += res[key];
          res[key] = 0;
          transferred = true;
        }
      }
      if (transferred) {
        send(p.client, {
          type: MessageType.RESOURCE_UPDATE,
          wood: res.wood, stone: res.stone, iron: res.iron, diamond: res.diamond, gold: res.gold, food: res.food, weapons: res.weapons,
        });
        broadcastWarehouseUpdate(send);
      }
    }
  }

  function tickProduction(dt: number): void {
    const eventMult = deps.getEventProductionMult?.() ?? 1.0;
    const intervalMult = cards.debuffs.productionIntervalMult / eventMult;
    for (const id of world.query(C.Production, C.Position)) {
      // Worker gating: buildings with WorkerSlot only produce when staffed
      const ws = world.getComponent<WorkerSlotComponent>(id, C.WorkerSlot);
      if (ws && ws.workerId === null) continue;
      if (ws && ws.workerId !== null && !world.hasEntity(ws.workerId)) { ws.workerId = null; continue; }

      const prod = world.getComponent<ProductionComponent>(id, C.Production)!;
      prod.timer += dt;
      const effectiveInterval = prod.interval * intervalMult;
      if (prod.timer < effectiveInterval) continue;
      prod.timer -= effectiveInterval;
      prod.stored = Math.min(prod.stored + prod.amount, prod.maxStored);
    }
  }

  function tickTurrets(dt: number, send: SendFn): void {
    for (const id of world.query(C.Turret, C.Position)) {
      const turret = world.getComponent<TurretComponent>(id, C.Turret)!;
      turret.cooldownTimer -= dt;
      if (turret.cooldownTimer > 0) continue;

      const tpos = world.getComponent<PositionComponent>(id, C.Position)!;
      const bldg = world.getComponent<BuildingComponent>(id, C.Building);
      const halfExt = buildingHalfExtent(bldg?.buildingType ?? 'arrow_turret');

      let bestId = -1;
      let bestDist = turret.range * turret.range;
      for (const eid of world.query(C.Position, C.Faction)) {
        const ef = world.getComponent<FactionComponent>(eid, C.Faction)!;
        if (ef.type !== 'enemy' && ef.type !== 'portal') continue;
        const ghostSt = world.getComponent<GhostStateComponent>(eid, C.GhostState);
        if (ghostSt?.hidden) continue;
        const epos = world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = epos.x - tpos.x, dy = epos.y - tpos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) { bestDist = d2; bestId = eid; }
      }

      if (bestId < 0) continue;
      turret.cooldownTimer = turret.cooldown * cards.debuffs.turretCooldownMult;

      const epos = world.getComponent<PositionComponent>(bestId, C.Position)!;
      const dx = epos.x - tpos.x, dy = epos.y - tpos.y;
      const dist = distance(dx, dy);
      if (dist < 0.01) continue;
      const nx = dx / dist, ny = dy / dist;

      const spawnOffset = halfExt + PROJECTILE_RADIUS + 2;
      const px = tpos.x + nx * spawnOffset, py = tpos.y + ny * spawnOffset;

      const projId = world.createEntity();
      world.addComponent(projId, C.Position, { x: px, y: py });
      const projComp: any = { ownerId: id, damage: turret.damage, lifetime: RANGED_LIFETIME };

      const isCannon = bldg?.buildingType === 'cannon_turret';
      const isBallista = bldg?.buildingType === 'ballista';
      if (isCannon) {
        const lvlIdx = (bldg!.upgradeLevel ?? 1) - 1;
        projComp.aoeRadius = UPGRADE_CANNON_AOE[lvlIdx] ?? CANNON_AOE_BASE_RADIUS;
        projComp.targetX = epos.x;
        projComp.targetY = epos.y;
        const flightTime = dist / turret.projectileSpeed;
        projComp.flightTime = flightTime;
        projComp.totalFlightTime = flightTime;
      } else if (isBallista) {
        projComp.pierce = true;
        projComp.hitEntities = [];
        const lvlIdx = (bldg!.upgradeLevel ?? 1) - 1;
        projComp.aoeRadius = UPGRADE_BALLISTA_AOE[lvlIdx] ?? UPGRADE_BALLISTA_AOE[0];
      }
      world.addComponent(projId, C.Velocity, { vx: nx * turret.projectileSpeed, vy: ny * turret.projectileSpeed });
      world.addComponent(projId, C.Projectile, projComp);
      world.addComponent(projId, C.Faction, { type: 'player' });

      const spawnMsg: ProjectileSpawnMessage = {
        type: MessageType.PROJECTILE_SPAWN,
        projectileId: projId, x: px, y: py,
        vx: nx * turret.projectileSpeed, vy: ny * turret.projectileSpeed,
        ownerSlot: -1,
        ...(isCannon ? { targetX: epos.x, targetY: epos.y, totalFlightTime: dist / turret.projectileSpeed } : {}),
        ...(isBallista ? { pierce: true, ballista: true } : {}),
      };
      for (const p of players.values()) send(p.client, spawnMsg);
    }
  }

  function tickLaserBeams(dt: number, send: SendFn): void {
    for (const id of world.query(C.LaserBeam, C.Position)) {
      const laser = world.getComponent<LaserBeamComponent>(id, C.LaserBeam)!;
      const tpos = world.getComponent<PositionComponent>(id, C.Position)!;

      // Validate current target is still alive and in range
      if (laser.targetId !== null) {
        let valid = false;
        if (world.hasEntity(laser.targetId)) {
          const tgtPos = world.getComponent<PositionComponent>(laser.targetId, C.Position);
          const tgtHp = world.getComponent<HealthComponent>(laser.targetId, C.Health);
          if (tgtPos && tgtHp && tgtHp.current > 0) {
            const dx = tgtPos.x - tpos.x, dy = tgtPos.y - tpos.y;
            if (dx * dx + dy * dy <= laser.range * laser.range) valid = true;
          }
        }
        if (!valid) laser.targetId = null;
      }

      // Acquire new target if idle
      if (laser.targetId === null) {
        let bestId = -1;
        let bestDist = laser.range * laser.range;
        for (const eid of world.query(C.Position, C.Faction, C.Health)) {
          const ef = world.getComponent<FactionComponent>(eid, C.Faction)!;
          if (ef.type !== 'enemy' && ef.type !== 'portal') continue;
          const ghostSt = world.getComponent<GhostStateComponent>(eid, C.GhostState);
          if (ghostSt?.hidden) continue;
          const ehp = world.getComponent<HealthComponent>(eid, C.Health)!;
          if (ehp.current <= 0) continue;
          const epos = world.getComponent<PositionComponent>(eid, C.Position)!;
          const dx = epos.x - tpos.x, dy = epos.y - tpos.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist) { bestDist = d2; bestId = eid; }
        }
        if (bestId >= 0) laser.targetId = bestId;
      }

      // Apply continuous damage
      if (laser.targetId !== null) {
        const ehp = world.getComponent<HealthComponent>(laser.targetId, C.Health);
        if (ehp && ehp.current > 0) {
          const dmg = laser.damagePerSecond * dt;
          ehp.current = Math.max(0, ehp.current - dmg);

          // Send periodic hit messages (every ~0.5s worth of damage) for visual feedback
          const hitMsg: HitMessage = {
            type: MessageType.HIT,
            sourceId: id, targetId: laser.targetId,
            damage: Math.round(dmg), knockbackVx: 0, knockbackVy: 0,
          };
          for (const p of players.values()) send(p.client, hitMsg);

          if (ehp.current <= 0) {
            laser.targetId = null;
          }
        }
      }
    }
  }

  function tickGhostVisibility(): void {
    for (const eid of world.query(C.GhostState, C.Position)) {
      const ghost = world.getComponent<GhostStateComponent>(eid, C.GhostState)!;
      if (!ghost.hidden) continue;

      let revealed = false;
      for (const lid of world.query(C.LightReveal, C.Position)) {
        const lpos = world.getComponent<PositionComponent>(lid, C.Position)!;
        const lr = world.getComponent<LightRevealComponent>(lid, C.LightReveal)!;
        const epos = world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = epos.x - lpos.x, dy = epos.y - lpos.y;
        if (dx * dx + dy * dy <= lr.range * lr.range) { revealed = true; break; }
      }

      if (!revealed) {
        const epos = world.getComponent<PositionComponent>(eid, C.Position)!;
        for (const p of players.values()) {
          if (!p.entityId) continue;
          const pBuffs = cards.playerBuffs.get(p.client.id);
          if (!pBuffs?.abilities.includes('reveal_ghosts')) continue;
          const ppos = world.getComponent<PositionComponent>(p.entityId, C.Position);
          if (!ppos) continue;
          const dx2 = epos.x - ppos.x, dy2 = epos.y - ppos.y;
          if (dx2 * dx2 + dy2 * dy2 <= 300 * 300) { revealed = true; break; }
        }
      }

      if (revealed) ghost.hidden = false;
    }
  }

  function tickHealAuras(dt: number): void {
    for (const sid of world.query(C.HealAura, C.Position)) {
      const aura = world.getComponent<HealAuraComponent>(sid, C.HealAura)!;
      const spos = world.getComponent<PositionComponent>(sid, C.Position)!;
      const rangeSq = aura.range * aura.range;
      const healAmount = aura.healPerSecond * dt;

      for (const pid of playerEntityIds) {
        if (world.hasComponent(pid, C.Downed)) continue;
        const ppos = world.getComponent<PositionComponent>(pid, C.Position);
        const php = world.getComponent<HealthComponent>(pid, C.Health);
        if (!ppos || !php || php.current >= php.max) continue;
        const dx = ppos.x - spos.x, dy = ppos.y - spos.y;
        if (dx * dx + dy * dy <= rangeSq) {
          php.current = Math.min(php.max, php.current + healAmount);
        }
      }
    }
  }

  function tickBarracks(dt: number): void {
    for (const bid of world.query(C.BarracksSpawner, C.Position)) {
      const spawner = world.getComponent<BarracksSpawnerComponent>(bid, C.BarracksSpawner)!;
      const bpos = world.getComponent<PositionComponent>(bid, C.Position)!;

      spawner.guardIds = spawner.guardIds.filter(gid => world.hasEntity(gid));

      if (spawner.guardIds.length < spawner.maxGuards) {
        spawner.spawnTimer -= dt;
        if (spawner.spawnTimer <= 0) {
          spawner.spawnTimer = spawner.spawnInterval;
          const bHalf = buildingHalfExtent('barracks');
          const spawnDist = bHalf + 16 + Math.random() * 20;
          const angle = Math.random() * Math.PI * 2;
          const gx = bpos.x + Math.cos(angle) * spawnDist;
          const gy = bpos.y + Math.sin(angle) * spawnDist;
          if (!isWalkable(gx, gy)) continue;
          const gid = spawnGuard(gx, gy, bid);
          if (gid !== null) spawner.guardIds.push(gid);
        }
      }
    }
  }

  function spawnGuard(x: number, y: number, barracksId: number): number | null {
    const id = world.createEntity();
    world.addComponent(id, C.Position, { x, y });
    world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
    world.addComponent(id, C.Health, { current: BARRACKS_GUARD_HP, max: BARRACKS_GUARD_HP });
    world.addComponent(id, C.Speed, { base: BARRACKS_GUARD_SPEED, multiplier: 1 });
    world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
    world.addComponent(id, C.Faction, { type: 'guard' });
    world.addComponent(id, C.Facing, { angle: 0 });
    world.addComponent(id, C.AttackCooldown, { remaining: 0, max: GUARD_ATTACK_COOLDOWN });
    world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    world.addComponent(id, C.Guard, { barracksId, patrolRadius: BARRACKS_GUARD_PATROL_RADIUS } as GuardComponent);
    world.addComponent(id, C.EnemyStats, {
      damage: BARRACKS_GUARD_DAMAGE, range: GUARD_MELEE_RANGE, knockback: GUARD_MELEE_KNOCKBACK, radius: GUARD_RADIUS,
      rangedRange: 0, projectileSpeed: 0, rangedDamage: 0, rangedCooldown: 0,
    });
    return id;
  }

  function spawnTrainedGuard(x: number, y: number, buildingId: number, role: 'warrior' | 'ranger' | 'mage'): number | null {
    const roleStats = {
      warrior: { hp: TC_WARRIOR_HP, dmg: TC_WARRIOR_DAMAGE, speed: TC_WARRIOR_SPEED, range: GUARD_MELEE_RANGE, rangedRange: 0, projSpeed: 0, rangedDmg: 0, rangedCd: 0 },
      ranger:  { hp: TC_RANGER_HP,  dmg: TC_RANGER_DAMAGE,  speed: TC_RANGER_SPEED,  range: GUARD_MELEE_RANGE, rangedRange: TC_RANGER_RANGE, projSpeed: 300, rangedDmg: TC_RANGER_DAMAGE, rangedCd: 1.5 },
      mage:    { hp: TC_MAGE_HP,    dmg: TC_MAGE_DAMAGE,    speed: TC_MAGE_SPEED,    range: GUARD_MELEE_RANGE, rangedRange: TC_MAGE_RANGE, projSpeed: 250, rangedDmg: TC_MAGE_DAMAGE, rangedCd: 2.0 },
    };
    const s = roleStats[role];
    const id = world.createEntity();
    world.addComponent(id, C.Position, { x, y });
    world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
    world.addComponent(id, C.Health, { current: s.hp, max: s.hp });
    world.addComponent(id, C.Speed, { base: s.speed, multiplier: 1 });
    world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
    world.addComponent(id, C.Faction, { type: 'guard' });
    world.addComponent(id, C.Facing, { angle: 0 });
    world.addComponent(id, C.AttackCooldown, { remaining: 0, max: GUARD_ATTACK_COOLDOWN });
    world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    world.addComponent(id, C.Guard, { barracksId: buildingId, patrolRadius: BARRACKS_GUARD_PATROL_RADIUS, guardRole: role } as GuardComponent);
    world.addComponent(id, C.EnemyStats, {
      damage: s.dmg, range: s.range, knockback: GUARD_MELEE_KNOCKBACK, radius: GUARD_RADIUS,
      rangedRange: s.rangedRange, projectileSpeed: s.projSpeed, rangedDamage: s.rangedDmg, rangedCooldown: s.rangedCd,
    });
    return id;
  }

  function tickBuildingRegen(dt: number): void {
    const rate = cards.debuffs.buildingRegenRate;
    if (rate <= 0) return;
    for (const id of world.query(C.Building, C.Health)) {
      const hp = world.getComponent<HealthComponent>(id, C.Health)!;
      if (hp.current >= hp.max || hp.current <= 0) continue;
      hp.current = Math.min(hp.max, hp.current + rate * dt);
    }
  }

  function tickSpikeTraps(dt: number, send: SendFn): void {
    const trapDeaths: number[] = [];
    const entityDeaths: number[] = [];
    const attackerMap = new Map<number, number>();

    for (const id of world.query(C.SpikeTrap, C.Position, C.Health)) {
      const trap = world.getComponent<SpikeTrapComponent>(id, C.SpikeTrap)!;
      const tpos = world.getComponent<PositionComponent>(id, C.Position)!;
      const thp = world.getComponent<HealthComponent>(id, C.Health)!;
      const trapHalf = buildingHalfExtent('spike_trap');
      let trapDestroyed = false;

      for (const [eid, remaining] of trap.enemyCooldowns) {
        if (remaining > 0) trap.enemyCooldowns.set(eid, remaining - dt);
      }

      for (const eid of world.query(C.Position, C.Health, C.Faction)) {
        const ef = world.getComponent<FactionComponent>(eid, C.Faction)!;
        if (ef.type !== 'enemy' && ef.type !== 'player') continue;
        if (world.hasComponent(eid, C.Downed)) continue;

        const epos = world.getComponent<PositionComponent>(eid, C.Position)!;
        const entityRadius = ef.type === 'player' ? PLAYER_RADIUS : ENEMY_RADIUS;

        const edx = Math.abs(epos.x - tpos.x);
        const edy = Math.abs(epos.y - tpos.y);
        if (edx > trapHalf + entityRadius || edy > trapHalf + entityRadius) continue;

        const cd = trap.enemyCooldowns.get(eid) ?? 0;
        if (cd > 0) continue;

        const ehp = world.getComponent<HealthComponent>(eid, C.Health);
        if (!ehp) continue;
        ehp.current = Math.max(0, ehp.current - trap.damage);
        trap.enemyCooldowns.set(eid, trap.cooldown);

        const hitMsg: HitMessage = {
          type: MessageType.HIT,
          sourceId: id, targetId: eid,
          damage: trap.damage, knockbackVx: 0, knockbackVy: 0,
        };
        for (const p of players.values()) send(p.client, hitMsg);

        if (ehp.current <= 0) {
          entityDeaths.push(eid);
          attackerMap.set(eid, id);
        }

        thp.current -= trap.selfDamage;
        if (thp.current <= 0) {
          trapDeaths.push(id);
          trapDestroyed = true;
          break;
        }
      }

      if (trapDestroyed) continue;

      for (const eid of trap.enemyCooldowns.keys()) {
        if (!world.hasEntity(eid)) trap.enemyCooldowns.delete(eid);
      }
    }

    if (entityDeaths.length > 0) destroyDeadEntities(entityDeaths, attackerMap, send);
    if (trapDeaths.length > 0) destroyDeadEntities(trapDeaths, undefined, send);
  }

  // ── Ruins tick ───────────────────────────────────────────────────────────

  function tickRuins(dt: number, send: SendFn): void {
    for (const id of world.query(C.Ruins, C.Position)) {
      const ruins = world.getComponent<RuinsComponent>(id, C.Ruins)!;

      // Tick burn timer
      if (ruins.burnTimer > 0) {
        ruins.burnTimer = Math.max(0, ruins.burnTimer - dt);
      }

      // Tick decay timer
      ruins.decayTimer -= dt;
      if (ruins.decayTimer <= 0) {
        // Ruins crumble - fully remove entity
        const destroyedMsg = {
          type: MessageType.BUILD_DESTROYED,
          entityId: id,
        };
        for (const p of players.values()) send(p.client, destroyedMsg);
        world.destroyEntity(id);
      }
    }
  }

  /** Repair a ruin back to a functional building. */
  function handleRuinRepair(clientId: string, msg: BuildRepairMessage, send: SendFn): void {
    if (!isActive()) return;
    const player = players.get(clientId);
    if (!player || player.entityId === null) return;
    if (world.hasComponent(player.entityId, C.Downed)) return;
    if (respawnTimers.has(clientId)) return;

    const targetId = msg.entityId;
    if (!Number.isFinite(targetId)) return;
    if (!world.hasEntity(targetId)) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'no_building' } as BuildRepairConfirmMessage);
      return;
    }

    const ruins = world.getComponent<RuinsComponent>(targetId, C.Ruins);
    if (!ruins) {
      // Not a ruin - delegate to normal repair
      handleRepair(clientId, msg, send);
      return;
    }

    // Calculate repair cost based on whether player wants level 1 or original level
    // Default: restore to level 1 at 40% of base cost
    const baseCost = BUILDING_COSTS[ruins.originalType];
    if (!baseCost) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'invalid_type' } as BuildRepairConfirmMessage);
      return;
    }

    const repairCost: Record<string, number> = {};
    for (const [res, amount] of Object.entries(baseCost)) {
      repairCost[res] = Math.ceil(amount! * RUINS_REPAIR_COST_MULT);
    }

    if (!deductBuildingCost(ruins.originalType, player, send, repairCost)) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'insufficient_resources' } as BuildRepairConfirmMessage);
      return;
    }

    // Remove Ruins component
    world.removeComponent(targetId, C.Ruins);

    // Restore building to level 1
    const bldg = world.getComponent<BuildingComponent>(targetId, C.Building);
    if (bldg) bldg.upgradeLevel = 1;

    // Restore HP to full (level 1 base HP)
    const baseHp = HP_MAP[ruins.originalType] ?? 100;
    const hp = world.getComponent<HealthComponent>(targetId, C.Health);
    if (hp) { hp.max = baseHp; hp.current = baseHp; }

    // Re-add functional components based on building type
    restoreBuildingComponents(targetId, ruins.originalType);

    send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: true, entityId: targetId } as BuildRepairConfirmMessage);
  }

  /** Re-adds the functional components for a restored ruin. */
  function restoreBuildingComponents(id: number, buildingType: string): void {
    switch (buildingType) {
      case 'lumbermill':
        world.addComponent(id, C.Production, { timer: 0, interval: LUMBERMILL_PRODUCTION_INTERVAL, amount: PRODUCTION_AMOUNT, maxStored: PRODUCTION_MAX_STORED, stored: 0, resourceType: 'wood' } as ProductionComponent);
        world.addComponent(id, C.WorkerSlot, { workerId: null } as WorkerSlotComponent);
        break;
      case 'quarry':
        world.addComponent(id, C.Production, { timer: 0, interval: QUARRY_PRODUCTION_INTERVAL, amount: PRODUCTION_AMOUNT, maxStored: PRODUCTION_MAX_STORED, stored: 0, resourceType: 'stone' } as ProductionComponent);
        world.addComponent(id, C.WorkerSlot, { workerId: null } as WorkerSlotComponent);
        break;
      case 'mine':
        world.addComponent(id, C.Production, { timer: 0, interval: MINE_PRODUCTION_INTERVAL, amount: PRODUCTION_AMOUNT, maxStored: PRODUCTION_MAX_STORED, stored: 0, resourceType: 'iron' } as ProductionComponent);
        world.addComponent(id, C.WorkerSlot, { workerId: null } as WorkerSlotComponent);
        break;
      case 'farm':
        world.addComponent(id, C.Production, { timer: 0, interval: FARM_PRODUCTION_INTERVAL, amount: PRODUCTION_AMOUNT, maxStored: PRODUCTION_MAX_STORED, stored: 0, resourceType: 'food' } as ProductionComponent);
        world.addComponent(id, C.WorkerSlot, { workerId: null } as WorkerSlotComponent);
        break;
      case 'workshop':
        world.addComponent(id, C.Production, { timer: 0, interval: WORKSHOP_PROD_INTERVAL[0], amount: 1, maxStored: PRODUCTION_MAX_STORED, stored: 0, resourceType: 'weapons' } as ProductionComponent);
        world.addComponent(id, C.WorkerSlot, { workerId: null } as WorkerSlotComponent);
        break;
      case 'arrow_turret':
        world.addComponent(id, C.Turret, { range: ARROW_TURRET_RANGE, cooldown: ARROW_TURRET_COOLDOWN, cooldownTimer: 0, damage: ARROW_TURRET_DAMAGE, projectileSpeed: ARROW_TURRET_PROJ_SPEED, aoeRadius: 0, turretType: 'arrow' } as TurretComponent);
        break;
      case 'cannon_turret':
        world.addComponent(id, C.Turret, { range: CANNON_TURRET_RANGE, cooldown: CANNON_TURRET_COOLDOWN, cooldownTimer: 0, damage: CANNON_TURRET_DAMAGE, projectileSpeed: CANNON_TURRET_PROJ_SPEED, aoeRadius: CANNON_AOE_BASE_RADIUS, turretType: 'cannon' } as TurretComponent);
        break;
      case 'ballista':
        world.addComponent(id, C.Turret, { range: BALLISTA_RANGE, cooldown: BALLISTA_COOLDOWN, cooldownTimer: 0, damage: BALLISTA_DAMAGE, projectileSpeed: BALLISTA_PROJ_SPEED } as TurretComponent);
        break;
      case 'spike_trap':
        world.addComponent(id, C.SpikeTrap, { damage: SPIKE_TRAP_DAMAGE, cooldown: SPIKE_TRAP_COOLDOWN, selfDamage: SPIKE_TRAP_SELF_DAMAGE, enemyCooldowns: new Map() } as SpikeTrapComponent);
        break;
      case 'laser_tower':
        world.addComponent(id, C.LaserBeam, { range: UPGRADE_LASER_RANGE[0], damagePerSecond: UPGRADE_LASER_DPS[0], targetId: null } as LaserBeamComponent);
        break;
      case 'light_tower':
        world.addComponent(id, C.LightReveal, { range: UPGRADE_LIGHT_RANGE[0] } as LightRevealComponent);
        break;
      case 'healing_shrine':
        world.addComponent(id, C.HealAura, { range: UPGRADE_HEAL_RANGE[0], healPerSecond: UPGRADE_HEAL_RATE[0] } as HealAuraComponent);
        break;
      case 'barracks':
        world.addComponent(id, C.BarracksSpawner, { maxGuards: BARRACKS_MAX_GUARDS[0], spawnInterval: BARRACKS_SPAWN_INTERVAL, spawnTimer: 0, guardIds: [] } as BarracksSpawnerComponent);
        break;
      case 'training_center':
        world.addComponent(id, C.TrainingCenter, { maxGuards: TRAINING_CENTER_MAX_GUARDS[0], guardIds: [] } as import('@shared/components').TrainingCenterComponent);
        break;
      case 'warehouse':
        warehouseIds.add(id);
        break;
      case 'cat_house':
      case 'dormitory': {
        const cap = buildingType === 'cat_house' ? CAT_HOUSE_CAPACITY[0] : DORMITORY_CAPACITY[0];
        world.addComponent(id, C.Housing, { capacity: cap, residentIds: [] } as HousingComponent);
        break;
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    handlePlace,
    handleDemolish,
    handleUpgrade,
    handleRepair: handleRuinRepair,
    broadcastWarehouseUpdate,
    cleanupBridge,
    spawnTrainedGuard,
    tick(dt: number, send: SendFn): void {
      tickWarehouseDeposit(send);
      tickProduction(dt);
      tickTurrets(dt, send);
      tickLaserBeams(dt, send);
      tickGhostVisibility();
      tickHealAuras(dt);
      tickBarracks(dt);
      tickSpikeTraps(dt, send);
      tickBuildingRegen(dt);
      tickRuins(dt, send);
    },
  };
}

export type BuildingSystem = ReturnType<typeof createBuildingSystem>;
