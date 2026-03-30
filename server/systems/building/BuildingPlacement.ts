/**
 * BuildingPlacement - extracted placement, demolition, upgrade, and repair handlers.
 *
 * Each function takes a BuildingContext plus the handler-specific arguments.
 */
import { distance } from '@shared/math/utils';
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
} from '@shared/components';
import type {
  LightRevealComponent,
  HealAuraComponent, BarracksSpawnerComponent,
  WorkerSlotComponent, HousingComponent, RuinsComponent, LaserBeamComponent,
  TeslaCoilComponent, FlameAuraComponent, MoatComponent,
  RepairAuraComponent, TeleporterComponent, TavernComponent,
} from '@shared/components';
import {
  TILE_SIZE, PLAYER_RADIUS, ENEMY_RADIUS, RESOURCE_NODE_RADIUS,
  BUILDING_COSTS, BUILDING_SIZES, buildingHalfExtent, buildingExtent, buildingExclusionExtent, snapBuildingPosition, EXCLUSION_EXEMPT_BUILDINGS, STACKABLE_BUILDINGS,
  BUILDING_MAX_LEVEL, DEMOLISH_REFUND_PERCENT, RUINS_REPAIR_COST_MULT,
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
  BARRACKS_GUARD_PATROL_RADIUS,
  CAT_HOUSE_MAX_HEALTH, CAT_HOUSE_CAPACITY,
  GATE_MAX_HEALTH, BALLISTA_MAX_HEALTH, LASER_TOWER_MAX_HEALTH, WORKSHOP_MAX_HEALTH, TRAINING_CENTER_MAX_HEALTH,
  BALLISTA_RANGE, BALLISTA_COOLDOWN, BALLISTA_DAMAGE, BALLISTA_PROJ_SPEED,
  UPGRADE_BALLISTA_AOE, UPGRADE_BALLISTA_CD, UPGRADE_BALLISTA_DMG,
  UPGRADE_LASER_RANGE, UPGRADE_LASER_DPS,
  WORKSHOP_PROD_INTERVAL,
  TRAINING_CENTER_MAX_GUARDS,
  getUpgradeCost, getRepairCost,
  // New buildings
  TESLA_COIL_MAX_HEALTH, FLAME_TOWER_MAX_HEALTH, CATAPULT_MAX_HEALTH,
  MOAT_MAX_HEALTH,
  REPAIR_STATION_MAX_HEALTH, STORAGE_SHED_MAX_HEALTH,
  TELEPORTER_PAD_MAX_HEALTH, TAVERN_MAX_HEALTH,
  SIEGE_WORKSHOP_MAX_HEALTH, KENNEL_MAX_HEALTH, ARCANE_TOWER_MAX_HEALTH, WATCHTOWER_MAX_HEALTH,
  TESLA_COIL_RANGE, TESLA_COIL_COOLDOWN, TESLA_COIL_DAMAGE, TESLA_COIL_CHAIN_COUNT, TESLA_COIL_CHAIN_RANGE,
  UPGRADE_TESLA_DAMAGE, UPGRADE_TESLA_CHAIN, UPGRADE_TESLA_CD,
  FLAME_TOWER_RANGE, FLAME_TOWER_DPS, FLAME_TOWER_ARC,
  UPGRADE_FLAME_DPS, UPGRADE_FLAME_RANGE,
  CATAPULT_RANGE, CATAPULT_COOLDOWN, CATAPULT_DAMAGE, CATAPULT_PROJ_SPEED,
  UPGRADE_CATAPULT_DMG, UPGRADE_CATAPULT_CD, UPGRADE_CATAPULT_AOE,
  MOAT_SLOW_FACTOR,
  REPAIR_STATION_HP_PER_TICK, REPAIR_STATION_INTERVAL,
  TAVERN_MAX_HEROES, TAVERN_ROSTER_SIZE,
  isDefenceBuilding,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import { MessageType } from '@shared/protocol';
import { HERO_IDS } from '@shared/definitions/HeroDefinitions';
import type {
  BuildPlaceMessage, BuildConfirmMessage, BuildDemolishMessage, BuildUpgradeMessage,
  BuildUpgradeConfirmMessage, BuildRepairMessage, BuildRepairConfirmMessage,
} from '@shared/protocol';
import type { SendFn } from '../../core/GameSession';
import type { BuildingContext } from './BuildingContext';

// ── HP map ────────────────────────────────────────────────────────────────

export const HP_MAP: Record<string, number> = {
  campfire: CAMPFIRE_MAX_HEALTH, wall: WALL_MAX_HEALTH, warehouse: WAREHOUSE_MAX_HEALTH,
  lumbermill: LUMBERMILL_MAX_HEALTH, quarry: QUARRY_MAX_HEALTH, mine: MINE_MAX_HEALTH, farm: FARM_MAX_HEALTH,
  arrow_turret: ARROW_TURRET_MAX_HEALTH, cannon_turret: CANNON_TURRET_MAX_HEALTH,
  spike_trap: SPIKE_TRAP_MAX_HEALTH, bridge: BRIDGE_MAX_HEALTH,
  light_tower: LIGHT_TOWER_MAX_HEALTH, healing_shrine: HEALING_SHRINE_MAX_HEALTH,
  barracks: BARRACKS_MAX_HEALTH,
  potion_shop: POTION_SHOP_MAX_HEALTH,
  cat_house: CAT_HOUSE_MAX_HEALTH,
  gate: GATE_MAX_HEALTH,
  ballista: BALLISTA_MAX_HEALTH,
  laser_tower: LASER_TOWER_MAX_HEALTH,
  workshop: WORKSHOP_MAX_HEALTH,
  training_center: TRAINING_CENTER_MAX_HEALTH,
  tesla_coil: TESLA_COIL_MAX_HEALTH,
  flame_tower: FLAME_TOWER_MAX_HEALTH,
  catapult: CATAPULT_MAX_HEALTH,
  moat: MOAT_MAX_HEALTH,
  repair_station: REPAIR_STATION_MAX_HEALTH,
  storage_shed: STORAGE_SHED_MAX_HEALTH,
  teleporter_pad: TELEPORTER_PAD_MAX_HEALTH,
  tavern: TAVERN_MAX_HEALTH,
  siege_workshop: SIEGE_WORKSHOP_MAX_HEALTH,
  kennel: KENNEL_MAX_HEALTH,
  arcane_tower: ARCANE_TOWER_MAX_HEALTH,
  watchtower: WATCHTOWER_MAX_HEALTH,
};

// ── Cost helpers ──────────────────────────────────────────────────────────

export function deductBuildingCost(
  ctx: BuildingContext,
  buildingType: string,
  player: { entityId: number | null; client: import('../../net/ServerSocket').ConnectedClient; playerId: string },
  send: SendFn,
  costOverride?: Partial<Record<string, number>>,
): boolean {
  const { world, warehouseIds, warehousePool, broadcastWarehouseUpdate } = ctx;
  const costs = costOverride ?? BUILDING_COSTS[buildingType] ?? {};
  const playerRes = world.getComponent<any>(player.entityId!, C.Resources);
  if (!playerRes) return false;

  const hasWarehouse = warehouseIds.size > 0;
  const wp = warehousePool();
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

// ── Footprint Collision ───────────────────────────────────────────────────

/**
 * Check if a building footprint collides with existing entities.
 * @param skipExclusionZones - If true, only check direct overlap (not exclusion zones). Used for BUILD_MOVE.
 */
export function footprintCollides(ctx: BuildingContext, cx: number, cy: number, buildingType: string, rotation: number = 0, skipExclusionZones = false): boolean {
  const { world } = ctx;
  const newExcl = buildingExclusionExtent(buildingType, rotation);
  const newExt = buildingExtent(buildingType, rotation);
  const newExempt = EXCLUSION_EXEMPT_BUILDINGS.has(buildingType);
  const newStackable = STACKABLE_BUILDINGS.has(buildingType);
  for (const id of world.query(C.Position, C.Faction)) {
    const f = world.getComponent<FactionComponent>(id, C.Faction)!;
    const pos = world.getComponent<PositionComponent>(id, C.Position)!;
    let exHx: number;
    let exHy: number;
    if (f.type === 'building') {
      const b = world.getComponent<BuildingComponent>(id, C.Building);
      const bType = b?.buildingType ?? 'wall';
      const existingExempt = EXCLUSION_EXEMPT_BUILDINGS.has(bType);
      const existingStackable = STACKABLE_BUILDINGS.has(bType);
      const bExt = buildingExtent(bType, b?.rotation ?? 0);

      if (skipExclusionZones) {
        // Moving a building: only check direct footprint overlap (no exclusion zones)
        if (Math.abs(pos.x - cx) < newExt.hx + bExt.hx && Math.abs(pos.y - cy) < newExt.hy + bExt.hy) return true;
      } else if (isDefenceBuilding(buildingType) && isDefenceBuilding(bType)) {
        // Defence buildings can be placed adjacent to each other (no exclusion zone)
        if (Math.abs(pos.x - cx) < newExt.hx + bExt.hx && Math.abs(pos.y - cy) < newExt.hy + bExt.hy) return true;
      } else if (newExempt || existingExempt) {
        if (Math.abs(pos.x - cx) < newExt.hx + bExt.hx && Math.abs(pos.y - cy) < newExt.hy + bExt.hy) return true;
      } else if (newStackable && existingStackable) {
        if (Math.abs(pos.x - cx) < newExt.hx + bExt.hx && Math.abs(pos.y - cy) < newExt.hy + bExt.hy) return true;
      } else {
        const bExcl = buildingExclusionExtent(bType, b?.rotation ?? 0);
        exHx = Math.max(newExcl.hx, bExcl.hx);
        exHy = Math.max(newExcl.hy, bExcl.hy);
        if (Math.abs(pos.x - cx) < exHx + newExt.hx && Math.abs(pos.y - cy) < exHy + newExt.hy) return true;
      }
      continue;
    } else if (f.type === 'resource') {
      exHx = RESOURCE_NODE_RADIUS;
      exHy = RESOURCE_NODE_RADIUS;
    } else if (f.type === 'civilian' || f.type === 'guard') {
      exHx = PLAYER_RADIUS;
      exHy = PLAYER_RADIUS;
    } else {
      // Players, enemies, guards, POIs - don't block building placement
      continue;
    }
    if (Math.abs(pos.x - cx) < newExt.hx + exHx && Math.abs(pos.y - cy) < newExt.hy + exHy) return true;
  }
  return false;
}

// ── Bridge cleanup ────────────────────────────────────────────────────────

export function cleanupBridge(ctx: BuildingContext, entityId: number): void {
  const { world, bridgePositions, movementBridgeTiles } = ctx;
  const bridge = world.getComponent<BridgeComponent>(entityId, C.Bridge);
  if (bridge) {
    const key = `${bridge.tileX},${bridge.tileY}`;
    bridgePositions.delete(key);
    movementBridgeTiles.delete(key);
  }
}

// ── Tavern roster generation ──────────────────────────────────────────────

function generateTavernRoster(): string[] {
  const pool = [...HERO_IDS];
  const roster: string[] = [];
  for (let i = 0; i < TAVERN_ROSTER_SIZE && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    roster.push(pool.splice(idx, 1)[0]);
  }
  return roster;
}

// ── Restore building components (for ruin repair) ─────────────────────────

export function restoreBuildingComponents(ctx: BuildingContext, id: number, buildingType: string): void {
  const { world, warehouseIds } = ctx;
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
      world.addComponent(id, C.Housing, { capacity: CAT_HOUSE_CAPACITY[0], residentIds: [] } as HousingComponent);
      break;
    case 'tesla_coil':
      world.addComponent(id, C.TeslaCoil, { range: TESLA_COIL_RANGE, cooldown: TESLA_COIL_COOLDOWN, cooldownTimer: 0, damage: TESLA_COIL_DAMAGE, chainCount: TESLA_COIL_CHAIN_COUNT, chainRange: TESLA_COIL_CHAIN_RANGE } as TeslaCoilComponent);
      break;
    case 'flame_tower':
      world.addComponent(id, C.FlameAura, { range: FLAME_TOWER_RANGE, dps: FLAME_TOWER_DPS, arcRadians: FLAME_TOWER_ARC, facing: 0 } as FlameAuraComponent);
      break;
    case 'catapult':
      world.addComponent(id, C.Turret, { range: CATAPULT_RANGE, cooldown: CATAPULT_COOLDOWN, cooldownTimer: 0, damage: CATAPULT_DAMAGE, projectileSpeed: CATAPULT_PROJ_SPEED } as TurretComponent);
      break;
    case 'moat':
      world.addComponent(id, C.Moat, { slowFactor: MOAT_SLOW_FACTOR } as MoatComponent);
      break;
    case 'repair_station':
      world.addComponent(id, C.RepairAura, { repairPerTick: REPAIR_STATION_HP_PER_TICK[0], interval: REPAIR_STATION_INTERVAL[0], timer: 0 } as RepairAuraComponent);
      world.addComponent(id, C.WorkerSlot, { workerId: null } as WorkerSlotComponent);
      break;
    case 'storage_shed':
      warehouseIds.add(id);
      break;
    case 'teleporter_pad':
      world.addComponent(id, C.Teleporter, { pairedId: null } as TeleporterComponent);
      break;
    case 'tavern': {
      const roster = generateTavernRoster();
      world.addComponent(id, C.Tavern, { maxHeroes: TAVERN_MAX_HEROES[0], heroIds: [], roster } as TavernComponent);
      break;
    }
    case 'siege_workshop': {
      world.addComponent(id, C.SiegeAura, { range: 200, damageBonus: 0.25 } as import('@shared/components').SiegeAuraComponent);
      break;
    }
    case 'kennel': {
      world.addComponent(id, C.Kennel, { spawnInterval: 30, spawnTimer: 30, maxWolves: 2, wolfIds: [] } as import('@shared/components').KennelComponent);
      break;
    }
    case 'arcane_tower': {
      world.addComponent(id, C.ArcaneAura, { range: 250, rangeBonus: 0.50 } as import('@shared/components').ArcaneAuraComponent);
      break;
    }
    case 'watchtower': {
      world.addComponent(id, C.WatchAura, { revealRadius: 400, warningTime: 5 } as import('@shared/components').WatchAuraComponent);
      break;
    }
  }
}

// ── Place handler ─────────────────────────────────────────────────────────

export function handlePlace(ctx: BuildingContext, clientId: string, msg: BuildPlaceMessage, send: SendFn): void {
  const { world, generator, warehouseIds, bridgePositions, movementBridgeTiles, players, respawnTimers, buildingsByPlayer, isActive, spawnBuilding, broadcastWarehouseUpdate } = ctx;
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

  // Campfire gating: only campfire can be placed before campfire exists
  if (!ctx.isCampfirePlaced() && msg.buildingType !== 'campfire') {
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'campfire_required' } as BuildConfirmMessage);
    return;
  }

  // Prevent duplicate campfire placement
  if (msg.buildingType === 'campfire' && ctx.isCampfirePlaced()) {
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'campfire_already_placed' } as BuildConfirmMessage);
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

  if (footprintCollides(ctx, snapX, snapY, msg.buildingType, rotation)) {
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'blocked' } as BuildConfirmMessage);
    return;
  }

  // Building range check: entire building footprint must be within the build range square
  if (msg.buildingType !== 'campfire') {
    // Check all 4 corners of the footprint to ensure the whole building is inside
    const bExt = buildingExtent(msg.buildingType, rotation);
    if (!ctx.isInsideBuildRange(snapX - bExt.hx, snapY - bExt.hy) ||
        !ctx.isInsideBuildRange(snapX + bExt.hx, snapY - bExt.hy) ||
        !ctx.isInsideBuildRange(snapX - bExt.hx, snapY + bExt.hy) ||
        !ctx.isInsideBuildRange(snapX + bExt.hx, snapY + bExt.hy)) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'out_of_range' } as BuildConfirmMessage);
      return;
    }
  }

  // Campfire placement is free (cost only applies to upgrades)
  const placementCostOverride = msg.buildingType === 'campfire' ? {} : undefined;
  if (!deductBuildingCost(ctx, msg.buildingType, player, send, placementCostOverride)) {
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'insufficient_resources' } as BuildConfirmMessage);
    return;
  }

  const maxHp = HP_MAP[msg.buildingType] ?? WALL_MAX_HEALTH;
  const id = spawnBuilding(snapX, snapY, msg.buildingType, maxHp, false, rotation);

  if (msg.buildingType === 'warehouse') {
    warehouseIds.add(id);
    broadcastWarehouseUpdate(send);
  }

  // Campfire placement: set flag, update spawn origin, broadcast range
  if (msg.buildingType === 'campfire') {
    ctx.onCampfirePlaced(id, send);
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
  } else if (msg.buildingType === 'tesla_coil') {
    world.addComponent(id, C.TeslaCoil, {
      range: TESLA_COIL_RANGE, cooldown: TESLA_COIL_COOLDOWN,
      cooldownTimer: 0, damage: TESLA_COIL_DAMAGE,
      chainCount: TESLA_COIL_CHAIN_COUNT, chainRange: TESLA_COIL_CHAIN_RANGE,
    } as TeslaCoilComponent);
  } else if (msg.buildingType === 'flame_tower') {
    world.addComponent(id, C.FlameAura, {
      range: FLAME_TOWER_RANGE, dps: FLAME_TOWER_DPS,
      arcRadians: FLAME_TOWER_ARC, facing: 0,
    } as FlameAuraComponent);
  } else if (msg.buildingType === 'catapult') {
    world.addComponent(id, C.Turret, {
      range: CATAPULT_RANGE, cooldown: CATAPULT_COOLDOWN,
      cooldownTimer: 0, damage: CATAPULT_DAMAGE, projectileSpeed: CATAPULT_PROJ_SPEED,
    } as TurretComponent);
  } else if (msg.buildingType === 'moat') {
    world.addComponent(id, C.Moat, { slowFactor: MOAT_SLOW_FACTOR } as MoatComponent);
  } else if (msg.buildingType === 'repair_station') {
    world.addComponent(id, C.RepairAura, {
      repairPerTick: REPAIR_STATION_HP_PER_TICK[0], interval: REPAIR_STATION_INTERVAL[0], timer: 0,
    } as RepairAuraComponent);
  } else if (msg.buildingType === 'storage_shed') {
    warehouseIds.add(id);
    broadcastWarehouseUpdate(send);
  } else if (msg.buildingType === 'teleporter_pad') {
    let pairedId: number | null = null;
    let bestDist = Infinity;
    for (const otherId of world.query(C.Teleporter, C.Position)) {
      if (otherId === id) continue;
      const tp = world.getComponent<TeleporterComponent>(otherId, C.Teleporter)!;
      if (tp.pairedId !== null) continue;
      const oPos = world.getComponent<PositionComponent>(otherId, C.Position)!;
      const d = distance(oPos.x - snapX, oPos.y - snapY);
      if (d < bestDist) { bestDist = d; pairedId = otherId; }
    }
    world.addComponent(id, C.Teleporter, { pairedId } as TeleporterComponent);
    if (pairedId !== null) {
      const otherTp = world.getComponent<TeleporterComponent>(pairedId, C.Teleporter)!;
      otherTp.pairedId = id;
    }
  } else if (msg.buildingType === 'tavern') {
    const roster = generateTavernRoster();
    world.addComponent(id, C.Tavern, {
      maxHeroes: TAVERN_MAX_HEROES[0], heroIds: [], roster,
    } as TavernComponent);
  } else if (msg.buildingType === 'siege_workshop') {
    world.addComponent(id, C.SiegeAura, { range: 200, damageBonus: 0.25 } as import('@shared/components').SiegeAuraComponent);
  } else if (msg.buildingType === 'kennel') {
    world.addComponent(id, C.Kennel, { spawnInterval: 30, spawnTimer: 30, maxWolves: 2, wolfIds: [] } as import('@shared/components').KennelComponent);
  } else if (msg.buildingType === 'arcane_tower') {
    world.addComponent(id, C.ArcaneAura, { range: 250, rangeBonus: 0.50 } as import('@shared/components').ArcaneAuraComponent);
  } else if (msg.buildingType === 'watchtower') {
    world.addComponent(id, C.WatchAura, { revealRadius: 400, warningTime: 5 } as import('@shared/components').WatchAuraComponent);
  }

  // Attach WorkerSlot to production buildings
  if (['lumbermill', 'quarry', 'mine', 'farm', 'workshop', 'repair_station'].includes(msg.buildingType)) {
    world.addComponent(id, C.WorkerSlot, { workerId: null } as WorkerSlotComponent);
  }

  send(player.client, { type: MessageType.BUILD_CONFIRM, success: true } as BuildConfirmMessage);
  buildingsByPlayer.set(player.playerId, (buildingsByPlayer.get(player.playerId) ?? 0) + 1);
}

// ── Demolish handler ──────────────────────────────────────────────────────

export function handleDemolish(ctx: BuildingContext, clientId: string, msg: BuildDemolishMessage, send: SendFn): void {
  const { world, warehouseIds, warehousePool, players, respawnTimers, isActive, spawnItemDrop, broadcastWarehouseUpdate } = ctx;
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
  // Campfire cannot be demolished (it's the win condition)
  if (bldg.permanent || bldg.buildingType === 'campfire') {
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'permanent' } as BuildConfirmMessage);
    return;
  }

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
      warehousePool()[res] += Math.floor(amount * DEMOLISH_REFUND_PERCENT);
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
    const wPos = world.getComponent<PositionComponent>(targetId, C.Position);
    if (wPos) {
      const wp = warehousePool();
      const MAX_PER_DROP = 50;
      for (const [res, amount] of Object.entries(wp)) {
        const dropAmount = Math.floor(amount * 0.5);
        if (dropAmount <= 0) continue;
        wp[res] -= dropAmount;
        let remaining = dropAmount;
        while (remaining > 0) {
          const qty = Math.min(remaining, MAX_PER_DROP);
          spawnItemDrop(wPos.x, wPos.y, res, qty, true);
          remaining -= qty;
        }
      }
    }

    warehouseIds.delete(targetId);
    if (warehouseIds.size === 0) {
      const wp = warehousePool();
      wp.wood = 0; wp.stone = 0; wp.iron = 0; wp.diamond = 0; wp.gold = 0; wp.food = 0;
    }
    broadcastWarehouseUpdate(send);
  }

  cleanupBridge(ctx, targetId);
  world.destroyEntity(targetId);
  for (const p of players.values()) {
    send(p.client, { type: MessageType.BUILD_DESTROYED, entityId: targetId } as any);
  }
  send(player.client, { type: MessageType.BUILD_CONFIRM, success: true } as BuildConfirmMessage);
}

// ── Upgrade handler ───────────────────────────────────────────────────────

export function handleUpgrade(ctx: BuildingContext, clientId: string, msg: BuildUpgradeMessage, send: SendFn): void {
  const { world, players, respawnTimers, isActive } = ctx;
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

  if (!deductBuildingCost(ctx, bldg.buildingType, player, send, cost as Partial<Record<string, number>>)) {
    send(player.client, { type: MessageType.BUILD_UPGRADE_CONFIRM, success: false, reason: 'insufficient_resources' } as BuildUpgradeConfirmMessage);
    return;
  }

  const oldLevel = bldg.upgradeLevel;
  bldg.upgradeLevel = oldLevel + 1;
  const newLevel = bldg.upgradeLevel;
  const lvlIdx = newLevel - 1;

  const hp = world.getComponent<HealthComponent>(targetId, C.Health)!;
  const baseMaxHp = hp.max / UPGRADE_HP_MULT[oldLevel - 1];
  hp.max = Math.round(baseMaxHp * UPGRADE_HP_MULT[lvlIdx]);
  hp.current = hp.max;

  const prod = world.getComponent<ProductionComponent>(targetId, C.Production);
  if (prod) {
    if (bldg.buildingType === 'workshop' && lvlIdx < WORKSHOP_PROD_INTERVAL.length) {
      prod.interval = WORKSHOP_PROD_INTERVAL[lvlIdx];
    } else if (lvlIdx < UPGRADE_PROD_INTERVAL.length) {
      const baseInterval = prod.interval / UPGRADE_PROD_INTERVAL[oldLevel - 1];
      prod.interval = baseInterval * UPGRADE_PROD_INTERVAL[lvlIdx];
      const baseMax = prod.maxStored / UPGRADE_PROD_MAX[oldLevel - 1];
      prod.maxStored = Math.round(baseMax * UPGRADE_PROD_MAX[lvlIdx]);
    }
  }

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

  const trap = world.getComponent<SpikeTrapComponent>(targetId, C.SpikeTrap);
  if (trap && lvlIdx < UPGRADE_TRAP_DMG.length) {
    trap.damage = Math.round((trap.damage / UPGRADE_TRAP_DMG[oldLevel - 1]) * UPGRADE_TRAP_DMG[lvlIdx]);
  }

  const lr = world.getComponent<LightRevealComponent>(targetId, C.LightReveal);
  if (lr && lvlIdx < UPGRADE_LIGHT_RANGE.length) lr.range = UPGRADE_LIGHT_RANGE[lvlIdx];

  const laser = world.getComponent<LaserBeamComponent>(targetId, C.LaserBeam);
  if (laser) {
    if (lvlIdx < UPGRADE_LASER_RANGE.length) laser.range = UPGRADE_LASER_RANGE[lvlIdx];
    if (lvlIdx < UPGRADE_LASER_DPS.length) laser.damagePerSecond = UPGRADE_LASER_DPS[lvlIdx];
  }

  const ha = world.getComponent<HealAuraComponent>(targetId, C.HealAura);
  if (ha) {
    if (lvlIdx < UPGRADE_HEAL_RATE.length) ha.healPerSecond = UPGRADE_HEAL_RATE[lvlIdx];
    if (lvlIdx < UPGRADE_HEAL_RANGE.length) ha.range = UPGRADE_HEAL_RANGE[lvlIdx];
  }

  const barracks = world.getComponent<BarracksSpawnerComponent>(targetId, C.BarracksSpawner);
  if (barracks && lvlIdx < BARRACKS_MAX_GUARDS.length) barracks.maxGuards = BARRACKS_MAX_GUARDS[lvlIdx];

  const tc = world.getComponent<import('@shared/components').TrainingCenterComponent>(targetId, C.TrainingCenter);
  if (tc && lvlIdx < TRAINING_CENTER_MAX_GUARDS.length) tc.maxGuards = TRAINING_CENTER_MAX_GUARDS[lvlIdx];

  const housing = world.getComponent<HousingComponent>(targetId, C.Housing);
  if (housing && bldg.buildingType === 'cat_house' && lvlIdx < CAT_HOUSE_CAPACITY.length) {
    housing.capacity = CAT_HOUSE_CAPACITY[lvlIdx];
  }

  const tesla = world.getComponent<TeslaCoilComponent>(targetId, C.TeslaCoil);
  if (tesla) {
    if (lvlIdx < UPGRADE_TESLA_DAMAGE.length) tesla.damage = UPGRADE_TESLA_DAMAGE[lvlIdx];
    if (lvlIdx < UPGRADE_TESLA_CHAIN.length) tesla.chainCount = UPGRADE_TESLA_CHAIN[lvlIdx];
    if (lvlIdx < UPGRADE_TESLA_CD.length) tesla.cooldown = TESLA_COIL_COOLDOWN * UPGRADE_TESLA_CD[lvlIdx];
  }

  const flame = world.getComponent<FlameAuraComponent>(targetId, C.FlameAura);
  if (flame) {
    if (lvlIdx < UPGRADE_FLAME_DPS.length) flame.dps = UPGRADE_FLAME_DPS[lvlIdx];
    if (lvlIdx < UPGRADE_FLAME_RANGE.length) flame.range = UPGRADE_FLAME_RANGE[lvlIdx];
  }

  if (turret && bldg.buildingType === 'catapult') {
    turret.cooldown = (turret.cooldown / UPGRADE_CATAPULT_CD[oldLevel - 1]) * UPGRADE_CATAPULT_CD[lvlIdx];
    turret.damage = Math.round((turret.damage / UPGRADE_CATAPULT_DMG[oldLevel - 1]) * UPGRADE_CATAPULT_DMG[lvlIdx]);
    turret.cooldownTimer = 0;
  }

  const repair = world.getComponent<RepairAuraComponent>(targetId, C.RepairAura);
  if (repair) {
    if (lvlIdx < REPAIR_STATION_HP_PER_TICK.length) repair.repairPerTick = REPAIR_STATION_HP_PER_TICK[lvlIdx];
    if (lvlIdx < REPAIR_STATION_INTERVAL.length) repair.interval = REPAIR_STATION_INTERVAL[lvlIdx];
  }

  const tavern = world.getComponent<TavernComponent>(targetId, C.Tavern);
  if (tavern && lvlIdx < TAVERN_MAX_HEROES.length) tavern.maxHeroes = TAVERN_MAX_HEROES[lvlIdx];

  send(player.client, {
    type: MessageType.BUILD_UPGRADE_CONFIRM, success: true, entityId: targetId, newLevel,
  } as BuildUpgradeConfirmMessage);
}

// ── Repair handler ────────────────────────────────────────────────────────

export function handleRepair(ctx: BuildingContext, clientId: string, msg: BuildRepairMessage, send: SendFn): void {
  const { world, players, respawnTimers, isActive } = ctx;
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

  if (!deductBuildingCost(ctx, bldg.buildingType, player, send, cost as Partial<Record<string, number>>)) {
    send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'insufficient_resources' } as BuildRepairConfirmMessage);
    return;
  }

  hp.current = hp.max;
  send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: true, entityId: targetId } as BuildRepairConfirmMessage);
}

// ── Ruin repair handler ───────────────────────────────────────────────────

export function handleRuinRepair(ctx: BuildingContext, clientId: string, msg: BuildRepairMessage, send: SendFn): void {
  const { world, players, respawnTimers, isActive } = ctx;
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
    handleRepair(ctx, clientId, msg, send);
    return;
  }

  const baseCost = BUILDING_COSTS[ruins.originalType];
  if (!baseCost) {
    send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'invalid_type' } as BuildRepairConfirmMessage);
    return;
  }

  const repairCost: Record<string, number> = {};
  for (const [res, amount] of Object.entries(baseCost)) {
    repairCost[res] = Math.ceil(amount! * RUINS_REPAIR_COST_MULT);
  }

  if (!deductBuildingCost(ctx, ruins.originalType, player, send, repairCost)) {
    send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'insufficient_resources' } as BuildRepairConfirmMessage);
    return;
  }

  world.removeComponent(targetId, C.Ruins);

  const bldg = world.getComponent<BuildingComponent>(targetId, C.Building);
  if (bldg) bldg.upgradeLevel = 1;

  const baseHp = HP_MAP[ruins.originalType] ?? 100;
  const hp = world.getComponent<HealthComponent>(targetId, C.Health);
  if (hp) { hp.max = baseHp; hp.current = baseHp; }

  restoreBuildingComponents(ctx, targetId, ruins.originalType);

  send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: true, entityId: targetId } as BuildRepairConfirmMessage);
}

// ── Warehouse deposit (public API) ────────────────────────────────────────

export function depositPlayerToWarehouse(ctx: BuildingContext, playerEntityId: number, send: SendFn): boolean {
  const { world, warehouseIds, warehousePool, broadcastWarehouseUpdate } = ctx;
  if (warehouseIds.size === 0) return false;

  const pPos = world.getComponent<PositionComponent>(playerEntityId, C.Position);
  if (!pPos) return false;

  const r2 = WAREHOUSE_DEPOSIT_RADIUS * WAREHOUSE_DEPOSIT_RADIUS;
  let near = false;
  for (const wid of warehouseIds) {
    const wPos = world.getComponent<PositionComponent>(wid, C.Position);
    if (!wPos) continue;
    const dx = pPos.x - wPos.x, dy = pPos.y - wPos.y;
    if (dx * dx + dy * dy <= r2) { near = true; break; }
  }
  if (!near) return false;

  const res = world.getComponent<ResourcesComponent>(playerEntityId, C.Resources);
  if (!res) return false;

  let transferred = false;
  for (const key of ['wood', 'stone', 'iron', 'diamond', 'gold', 'food'] as const) {
    if (res[key] > 0) {
      warehousePool()[key] += res[key];
      res[key] = 0;
      transferred = true;
    }
  }
  return transferred;
}

// ── Building Move ─────────────────────────────────────────────────────────

/** Move an existing building to a new position. Keeps level, HP, and components. */
export function handleBuildMove(
  ctx: BuildingContext,
  clientId: string,
  msg: import('@shared/protocol').BuildMoveMessage,
  send: SendFn,
): void {
  const { world, players, respawnTimers, isActive } = ctx;
  if (!isActive()) return;
  const player = players.get(clientId);
  if (!player || player.entityId === null) return;
  if (world.hasComponent(player.entityId, C.Downed)) return;
  if (respawnTimers.has(clientId)) return;

  const targetId = msg.entityId;
  if (!world.hasEntity(targetId)) {
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'no_building' } as BuildConfirmMessage);
    return;
  }

  const bldg = world.getComponent<BuildingComponent>(targetId, C.Building);
  if (!bldg) {
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'no_building' } as BuildConfirmMessage);
    return;
  }

  // Can't move campfire
  if (bldg.buildingType === 'campfire') {
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'permanent' } as BuildConfirmMessage);
    return;
  }

  const rotation = bldg.rotation ?? 0;
  const { x: snapX, y: snapY } = snapBuildingPosition(msg.x, msg.y, bldg.buildingType, rotation);
  const bExt = buildingExtent(bldg.buildingType, rotation);

  // Walkability check at new position
  const generator = ctx.generator;
  const tilesW = rotation === 1 ? (BUILDING_SIZES[bldg.buildingType]?.h ?? 1) : (BUILDING_SIZES[bldg.buildingType]?.w ?? 1);
  const tilesH = rotation === 1 ? (BUILDING_SIZES[bldg.buildingType]?.w ?? 1) : (BUILDING_SIZES[bldg.buildingType]?.h ?? 1);
  const startTX = Math.floor((snapX - bExt.hx) / TILE_SIZE);
  const startTY = Math.floor((snapY - bExt.hy) / TILE_SIZE);
  const isBridge = bldg.buildingType === 'bridge';
  for (let dy = 0; dy < tilesH; dy++) {
    for (let dx = 0; dx < tilesW; dx++) {
      const tileId = generator.getTile(startTX + dx, startTY + dy);
      const walkable = TILE_DEFS[tileId]?.walkable ?? false;
      if (isBridge ? walkable : !walkable) {
        send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'not_walkable' } as BuildConfirmMessage);
        return;
      }
    }
  }

  // Building range check at new position
  if (!ctx.isInsideBuildRange(snapX - bExt.hx, snapY - bExt.hy) ||
      !ctx.isInsideBuildRange(snapX + bExt.hx, snapY - bExt.hy) ||
      !ctx.isInsideBuildRange(snapX - bExt.hx, snapY + bExt.hy) ||
      !ctx.isInsideBuildRange(snapX + bExt.hx, snapY + bExt.hy)) {
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'out_of_range' } as BuildConfirmMessage);
    return;
  }

  // Temporarily remove the building from collision checks so it doesn't collide with itself
  const oldPos = world.getComponent<PositionComponent>(targetId, C.Position)!;
  const savedX = oldPos.x, savedY = oldPos.y;
  // Move off-screen temporarily for collision check
  oldPos.x = -99999; oldPos.y = -99999;

  // Skip exclusion zones when moving - only prevent direct overlap with other buildings
  if (footprintCollides(ctx, snapX, snapY, bldg.buildingType, rotation, true)) {
    // Restore position on failure
    oldPos.x = savedX; oldPos.y = savedY;
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'blocked' } as BuildConfirmMessage);
    return;
  }

  // Move the building to the new position
  oldPos.x = snapX;
  oldPos.y = snapY;

  send(player.client, { type: MessageType.BUILD_CONFIRM, success: true } as BuildConfirmMessage);
}
