/**
 * Building constants - costs, sizes, HP, exclusion zones, production,
 * turrets, upgrades, and utility functions.
 */

import { TILE_SIZE } from './core';
import type { BuildingType } from '../components';
import { CAMPFIRE_HOUSING_PER_LEVEL, CAT_HOUSE_CAPACITY } from './civilians';

// ─── Building Ruins ──────────────────────────────────────────────────

/** Seconds the burning visual lasts on ruins before going out. */
export const RUINS_BURN_DURATION = 30;
/** Total seconds before ruins crumble and disappear (includes burn time). */
export const RUINS_DECAY_DURATION = 120;
/** Cost multiplier for repairing ruins to level 1 (fraction of original build cost). */
export const RUINS_REPAIR_COST_MULT = 0.4;
/** Cost multiplier for restoring ruins to their original level (fraction of total invested cost). */
export const RUINS_RESTORE_COST_MULT = 0.6;

// ─── Building Range System ──────────────────────────────────────────────

/** Campfire building range in tiles. All buildings must be within this square of the campfire. */
export const CAMPFIRE_BUILD_RANGE = 80;
/** Campfire building range in world pixels. */
export const CAMPFIRE_BUILD_RANGE_PX = CAMPFIRE_BUILD_RANGE * TILE_SIZE;
/** Additional building range per watchtower level in tiles. */
export const WATCHTOWER_RANGE_PER_LEVEL = 20;
/** Additional building range per watchtower level in world pixels. */
export const WATCHTOWER_RANGE_PER_LEVEL_PX = WATCHTOWER_RANGE_PER_LEVEL * TILE_SIZE;

/** Defence buildings - can be placed adjacent to each other with no exclusion spacing. */
export const DEFENCE_BUILDINGS = new Set([
  'wall', 'gate', 'arrow_turret', 'cannon_turret', 'ballista',
  'laser_tower', 'tesla_coil', 'flame_tower', 'catapult',
  'moat', 'spike_trap', 'bridge', 'siege_workshop', 'watchtower', 'flak_cannon',
]);

/** Check if a building type is a defence building (no exclusion spacing between defence buildings). */
export function isDefenceBuilding(type: string): boolean {
  return DEFENCE_BUILDINGS.has(type);
}

// ─── Buildings (Phase 5) ────────────────────────────────────────────────

/** Campfire HP. When it reaches 0 the run ends. */
export const CAMPFIRE_MAX_HEALTH = 300;

/** Wall HP. */
export const WALL_MAX_HEALTH = 150;

/** Half-extent of a 1x1 building AABB in world pixels (legacy default). */
export const BUILDING_HALF_EXTENT = TILE_SIZE / 2; // 16px

/** Tile dimensions per building type (width x height in tiles). */
export const BUILDING_SIZES: Record<string, { w: number; h: number }> = {
  wall: { w: 1, h: 1 }, campfire: { w: 3, h: 3 }, warehouse: { w: 3, h: 3 },
  lumbermill: { w: 2, h: 2 }, quarry: { w: 2, h: 2 }, mine: { w: 2, h: 2 }, farm: { w: 2, h: 2 },
  arrow_turret: { w: 1, h: 1 }, cannon_turret: { w: 2, h: 2 }, spike_trap: { w: 1, h: 1 }, bridge: { w: 1, h: 1 },
  light_tower: { w: 1, h: 1 }, healing_shrine: { w: 1, h: 1 }, barracks: { w: 2, h: 2 }, potion_shop: { w: 2, h: 2 },
  cat_house: { w: 2, h: 2 },
  gate: { w: 3, h: 1 }, ballista: { w: 2, h: 2 }, laser_tower: { w: 1, h: 1 },
  workshop: { w: 2, h: 2 }, training_center: { w: 2, h: 2 },
  // ── New buildings ──────────────────────────────────────────────────────────
  tesla_coil: { w: 1, h: 1 }, flame_tower: { w: 1, h: 1 }, catapult: { w: 2, h: 2 },
  moat: { w: 1, h: 1 },
  repair_station: { w: 2, h: 2 }, storage_shed: { w: 1, h: 1 },
  teleporter_pad: { w: 1, h: 1 },
  tavern: { w: 2, h: 2 },
  // Achievement-unlocked buildings
  siege_workshop: { w: 2, h: 2 },
  kennel: { w: 2, h: 2 },
  arcane_tower: { w: 1, h: 1 },
  watchtower: { w: 1, h: 1 },
  flak_cannon: { w: 2, h: 2 },
  dragon_roost: { w: 3, h: 3 },
  smeltery: { w: 2, h: 2 },
  market: { w: 2, h: 2 },
};

/**
 * Exclusion zone sizes (in tiles) - no other buildings can be placed within this zone.
 * Auto-generated: footprint + 1 tile padding on each side (footprint + 2).
 * Players, civilians, and enemies can still walk through exclusion zones.
 */
export const BUILDING_EXCLUSION_SIZES: Record<string, { w: number; h: number }> = (() => {
  const sizes: Record<string, { w: number; h: number }> = {};
  for (const [type, size] of Object.entries(BUILDING_SIZES)) {
    sizes[type] = { w: size.w + 2, h: size.h + 2 };
  }
  // Campfire keeps its 5x5 (3x3 footprint + 1 padding = 5x5, same result)
  return sizes;
})();

/** Buildings that can be placed inside ANY building's exclusion zone (only footprint overlap blocks). */
export const EXCLUSION_EXEMPT_BUILDINGS = new Set(['bridge', 'moat', 'spike_trap', 'wall']);

/**
 * Buildings that ignore exclusion zones only when placed near OTHER buildings
 * of the same group. They still respect exclusion zones of non-stackable buildings.
 * e.g. walls can be placed adjacent to walls/gates, but not inside a turret's zone.
 */
export const STACKABLE_BUILDINGS = new Set(['wall', 'gate']);

/**
 * Exclusion extent (half-width, half-height) for placement checks.
 * Falls back to building footprint if no exclusion size is defined.
 */
export function buildingExclusionExtent(type: string, rotation: number = 0): { hx: number; hy: number } {
  const size = BUILDING_EXCLUSION_SIZES[type] ?? BUILDING_SIZES[type] ?? { w: 1, h: 1 };
  const w = rotation === 1 ? size.h : size.w;
  const h = rotation === 1 ? size.w : size.h;
  return { hx: (w * TILE_SIZE) / 2, hy: (h * TILE_SIZE) / 2 };
}

/**
 * Half-extent in world pixels for a building of the given type.
 * For square buildings (backward compat) - returns single number.
 */
export function buildingHalfExtent(type: string): number {
  const size = BUILDING_SIZES[type];
  if (!size) return TILE_SIZE / 2;
  // For square buildings, use the width (same as height)
  return (size.w * TILE_SIZE) / 2;
}

/**
 * Full extent (half-width, half-height) for a building, accounting for rotation.
 * Rotation 1 swaps width and height.
 */
export function buildingExtent(type: string, rotation: number = 0): { hx: number; hy: number } {
  const size = BUILDING_SIZES[type] ?? { w: 1, h: 1 };
  const w = rotation === 1 ? size.h : size.w;
  const h = rotation === 1 ? size.w : size.h;
  return { hx: (w * TILE_SIZE) / 2, hy: (h * TILE_SIZE) / 2 };
}

/**
 * Snap a world-pixel coordinate to the correct grid position for a building.
 * Each axis snaps independently: odd tile count = tile center, even = tile corner.
 */
export function snapBuildingPosition(wx: number, wy: number, type: string, rotation: number = 0): { x: number; y: number } {
  const size = BUILDING_SIZES[type] ?? { w: 1, h: 1 };
  const tw = rotation === 1 ? size.h : size.w;
  const th = rotation === 1 ? size.w : size.h;
  const snapAxis = (val: number, tiles: number) => {
    if (tiles % 2 === 1) return Math.floor(val / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
    return Math.round(val / TILE_SIZE) * TILE_SIZE;
  };
  return { x: snapAxis(wx, tw), y: snapAxis(wy, th) };
}

/** Wood cost to place a Wall. */
export const WALL_COST_WOOD = 5;

/** Warehouse HP. */
export const WAREHOUSE_MAX_HEALTH = 200;

/** Lumbermill HP. */
export const LUMBERMILL_MAX_HEALTH = 180;

/** Quarry HP (stone production). */
export const QUARRY_MAX_HEALTH = 180;
/** Mine HP (iron/diamond production). */
export const MINE_MAX_HEALTH = 200;

/** Farm HP. */
export const FARM_MAX_HEALTH = 150;

/** Arrow turret HP. */
export const ARROW_TURRET_MAX_HEALTH = 100;

/** Cannon turret HP. */
export const CANNON_TURRET_MAX_HEALTH = 200;

/** Spike trap HP (breaks after repeated use). */
export const SPIKE_TRAP_MAX_HEALTH = 50;

/** Bridge HP (effectively invulnerable). */
export const BRIDGE_MAX_HEALTH = 999;

/** Light tower HP. */
export const LIGHT_TOWER_MAX_HEALTH = 120;
/** Healing shrine HP. */
export const HEALING_SHRINE_MAX_HEALTH = 100;
/** Barracks HP. */
export const BARRACKS_MAX_HEALTH = 200;
/** Potion shop HP. */
export const POTION_SHOP_MAX_HEALTH = 150;
/** Cat house HP. */
export const CAT_HOUSE_MAX_HEALTH = 100;
/** Gate HP. */
export const GATE_MAX_HEALTH = 250;
/** Ballista HP. */
export const BALLISTA_MAX_HEALTH = 120;
/** Laser tower HP. */
export const LASER_TOWER_MAX_HEALTH = 100;
/** Workshop HP. */
export const WORKSHOP_MAX_HEALTH = 150;
/** Training center HP. */
export const TRAINING_CENTER_MAX_HEALTH = 220;

// ── New Building HP ─────────────────────────────────────────────────────────
/** Tesla coil HP. */
export const TESLA_COIL_MAX_HEALTH = 100;
/** Flame tower HP. */
export const FLAME_TOWER_MAX_HEALTH = 100;
/** Catapult HP. */
export const CATAPULT_MAX_HEALTH = 200;
/** Moat HP (effectively indestructible). */
export const MOAT_MAX_HEALTH = 999;
/** Repair station HP. */
export const REPAIR_STATION_MAX_HEALTH = 150;
/** Storage shed HP. */
export const STORAGE_SHED_MAX_HEALTH = 80;
/** Teleporter pad HP. */
export const TELEPORTER_PAD_MAX_HEALTH = 100;
/** Tavern HP. */
export const TAVERN_MAX_HEALTH = 200;
// Achievement-unlocked buildings
export const SIEGE_WORKSHOP_MAX_HEALTH = 250;
export const KENNEL_MAX_HEALTH = 200;
export const ARCANE_TOWER_MAX_HEALTH = 150;
export const WATCHTOWER_MAX_HEALTH = 120;
/** Flak Cannon HP (spread-shot turret). */
export const FLAK_CANNON_MAX_HEALTH = 180;
/** Dragon Roost HP (summons dragon patrol). */
export const DRAGON_ROOST_MAX_HEALTH = 350;
/** Smeltery HP (converts iron to steel). */
export const SMELTERY_MAX_HEALTH = 200;
/** Market HP (converts resources to gold). */
export const MARKET_MAX_HEALTH = 150;

/** Radius (px) for auto-depositing player resources into the warehouse. */
export const WAREHOUSE_DEPOSIT_RADIUS = 80;

/** Fraction of original cost refunded when demolishing a building. */
export const DEMOLISH_REFUND_PERCENT = 0.5;

/** Per-building-type resource costs for placement. */
export const BUILDING_COSTS: Record<string, Partial<Record<'wood' | 'stone' | 'iron' | 'diamond' | 'food', number>>> = {
  campfire:       {},
  wall:           { wood: 5 },
  warehouse:      { wood: 10, stone: 5 },
  lumbermill:     { wood: 15, stone: 5 },
  quarry:         { wood: 10, stone: 10 },
  mine:           { wood: 15, stone: 15, iron: 5 },
  farm:           { wood: 10 },
  arrow_turret:   { stone: 5, iron: 5 },
  cannon_turret:  { stone: 10, iron: 10, diamond: 2 },
  spike_trap:     { wood: 3, iron: 2 },
  bridge:         { wood: 5, stone: 2 },
  light_tower:    { stone: 8, iron: 3 },
  healing_shrine: { stone: 10, iron: 5 },
  barracks:       { wood: 15, iron: 10 },
  potion_shop:    { wood: 15, stone: 10, food: 5 },
  cat_house:      { wood: 10, stone: 5 },
  gate:           { wood: 8, stone: 5 },
  ballista:       { stone: 8, iron: 8 },
  laser_tower:    { stone: 10, iron: 10, diamond: 1 },
  workshop:       { wood: 15, iron: 10, diamond: 2 },
  training_center: { wood: 20, iron: 15, diamond: 3 },
  // ── New buildings ──────────────────────────────────────────────────────────
  tesla_coil:      { stone: 8, iron: 8, diamond: 1 },
  flame_tower:     { stone: 6, iron: 6 },
  catapult:        { stone: 15, iron: 10, diamond: 3 },
  moat:            { stone: 3 },
  repair_station:  { wood: 15, iron: 10 },
  storage_shed:    { wood: 5, stone: 3 },
  teleporter_pad:  { iron: 10, diamond: 5 },
  tavern:          { wood: 20, stone: 15, iron: 10 },
  // Achievement-unlocked buildings
  siege_workshop:  { wood: 25, stone: 20, iron: 15, diamond: 5 },
  kennel:          { wood: 20, stone: 10, iron: 10 },
  arcane_tower:    { stone: 15, iron: 15, diamond: 8 },
  watchtower:      { wood: 15, stone: 15, iron: 5 },
  flak_cannon:     { stone: 20, iron: 15, diamond: 5 },
  dragon_roost:    { wood: 50, stone: 50, iron: 30, diamond: 15 },
  smeltery:        { stone: 25, iron: 20 },
  market:          { wood: 20, stone: 15, iron: 5 },
};

/** Ordered list of building types the player can cycle through in build mode. */
export const PLACEABLE_BUILDINGS: string[] = [
  'campfire',
  'wall', 'warehouse', 'lumbermill', 'quarry', 'mine', 'farm',
  'arrow_turret', 'cannon_turret', 'spike_trap', 'bridge',
  'light_tower', 'healing_shrine', 'potion_shop',
  'cat_house',
  'gate', 'ballista', 'laser_tower', 'workshop', 'training_center',
  'tesla_coil', 'flame_tower', 'catapult', 'moat',
  'repair_station', 'teleporter_pad',
  'tavern',
  'watchtower',
  // Achievement-unlocked buildings
  'siege_workshop', 'kennel', 'arcane_tower',
  'flak_cannon', 'dragon_roost', 'smeltery', 'market',
];

// ─── Production Buildings ──────────────────────────────────────────────────

/** Seconds between lumbermill production ticks. */
export const LUMBERMILL_PRODUCTION_INTERVAL = 10;
/** Seconds between quarry production ticks (stone). */
export const QUARRY_PRODUCTION_INTERVAL = 15;
/** Seconds between mine production ticks (iron/diamond). */
export const MINE_PRODUCTION_INTERVAL = 20;
/** Seconds between farm production ticks. */
export const FARM_PRODUCTION_INTERVAL = 8;
/** Amount produced per tick (all production buildings). */
export const PRODUCTION_AMOUNT = 1;
/** Max resources a production building can store locally. */
export const PRODUCTION_MAX_STORED = 10;

// ─── Arrow Turret ──────────────────────────────────────────────────────────

/** Targeting range for arrow turrets (px). */
export const ARROW_TURRET_RANGE = 200;
/** Seconds between arrow turret shots. */
export const ARROW_TURRET_COOLDOWN = 2;
/** Damage per arrow turret projectile. */
export const ARROW_TURRET_DAMAGE = 8;
/** Arrow turret projectile speed (px/s). */
export const ARROW_TURRET_PROJ_SPEED = 350;

// ─── Cannon Turret ─────────────────────────────────────────────────────────

/** Targeting range for cannon turrets (px). */
export const CANNON_TURRET_RANGE = 300;
/** Seconds between cannon turret shots. */
export const CANNON_TURRET_COOLDOWN = 4;
/** Damage per cannon turret projectile. */
export const CANNON_TURRET_DAMAGE = 20;
/** Cannon turret projectile speed (px/s). */
export const CANNON_TURRET_PROJ_SPEED = 250;

// ─── Spike Trap ────────────────────────────────────────────────────────────

/** Damage dealt to entities walking over a spike trap. */
export const SPIKE_TRAP_DAMAGE = 5;
/** Seconds between spike trap triggers on the same entity. */
export const SPIKE_TRAP_COOLDOWN = 1;
/** Damage the spike trap takes each time it triggers. */
export const SPIKE_TRAP_SELF_DAMAGE = 1;

// ─── Cannon AOE ──────────────────────────────────────────────────────────────

/** Base AOE explosion radius for cannon turret projectiles (px). */
export const CANNON_AOE_BASE_RADIUS = 100;

// ─── Building Upgrades ──────────────────────────────────────────────────────

/** Max upgrade level per building type. */
export const BUILDING_MAX_LEVEL: Record<BuildingType, number> = {
  campfire: 5, bridge: 1,
  wall: 3, warehouse: 3, lumbermill: 3, quarry: 3, mine: 3, farm: 3,
  arrow_turret: 3, cannon_turret: 3, spike_trap: 3,
  light_tower: 3, healing_shrine: 3, barracks: 3, potion_shop: 3,
  cat_house: 3,
  gate: 3, ballista: 3, laser_tower: 3, workshop: 3, training_center: 3,
  // ── New buildings ──────────────────────────────────────────────────────────
  tesla_coil: 3, flame_tower: 3, catapult: 3,
  moat: 1,
  repair_station: 3, storage_shed: 1,
  teleporter_pad: 1,
  tavern: 3,
  // Achievement-unlocked buildings
  siege_workshop: 3,
  kennel: 3,
  arcane_tower: 3,
  watchtower: 3,
  flak_cannon: 3,
  dragon_roost: 3,
  smeltery: 3,
  market: 3,
};

/** Cost multiplier for each upgrade level (index 0 = level 2, index 1 = level 3, etc.). */
export const UPGRADE_COST_MULTIPLIERS = [1.5, 2.5, 3.5, 4.5];

// Stat multipliers indexed by (level - 1). Level 1 = index 0 = 1.0 (base).
/** HP multiplier per level (campfire uses all 5, others use first 3). */
export const UPGRADE_HP_MULT        = [1, 1.5, 2.0, 2.5, 3.0];
/** Production interval multiplier (lower = faster). 1x -> 3x -> 5x speed. */
export const UPGRADE_PROD_INTERVAL  = [1, 0.333, 0.2];
/** Production max stored multiplier. 10 -> 30 -> 50 storage. */
export const UPGRADE_PROD_MAX       = [1, 3, 5];
/** Arrow turret cooldown multiplier (lower = faster fire rate). */
export const UPGRADE_ARROW_CD       = [1, 0.8, 0.6];
/** Arrow turret damage multiplier. */
export const UPGRADE_ARROW_DMG      = [1, 1.25, 1.5];
/** Cannon turret cooldown multiplier. */
export const UPGRADE_CANNON_CD      = [1, 0.8, 0.6];
/** Cannon turret damage multiplier. */
export const UPGRADE_CANNON_DMG     = [1, 1.4, 1.8];
/** Cannon AOE radius per level (absolute values in px). */
export const UPGRADE_CANNON_AOE     = [80, 120, 180];
/** Spike trap damage multiplier. */
export const UPGRADE_TRAP_DMG       = [1, 1.5, 2.0];

// ─── Light Tower ────────────────────────────────────────────────────────────

/** Light tower ghost-reveal range per level (px). */
export const UPGRADE_LIGHT_RANGE    = [200, 300, 400];

// ─── Healing Shrine ─────────────────────────────────────────────────────────

/** Heal rate per level (HP/s per player in range). */
export const UPGRADE_HEAL_RATE      = [3, 5, 8];
/** Heal aura range per level (px). */
export const UPGRADE_HEAL_RANGE     = [120, 160, 200];

// ─── Barracks ───────────────────────────────────────────────────────────────

/** Max guards per barracks level. */
export const BARRACKS_MAX_GUARDS    = [1, 2, 3];
/** Seconds between guard spawns. */
export const BARRACKS_SPAWN_INTERVAL = 15;
/** Guard stats. */
export const BARRACKS_GUARD_HP      = 80;
export const BARRACKS_GUARD_DAMAGE  = 12;
export const BARRACKS_GUARD_SPEED   = 60;
export const BARRACKS_GUARD_PATROL_RADIUS = 150;
/** Guard melee attack cooldown (seconds). */
export const GUARD_ATTACK_COOLDOWN = 1.0;
/** Guard melee attack range (px). */
export const GUARD_MELEE_RANGE = 40;
/** Guard melee knockback impulse (px/s). */
export const GUARD_MELEE_KNOCKBACK = 150;
/** Guard collision/render radius (px). */
export const GUARD_RADIUS = 10;
/** Guard detection range for hostile enemies (px). */
export const GUARD_DETECT_RANGE = 150;

// ─── Ballista ──────────────────────────────────────────────────────────────

/** Ballista targeting range (px). */
export const BALLISTA_RANGE = 400;
/** Ballista cooldown (seconds). */
export const BALLISTA_COOLDOWN = 5;
/** Ballista damage per bolt. */
export const BALLISTA_DAMAGE = 40;
/** Ballista projectile speed (px/s). */
export const BALLISTA_PROJ_SPEED = 500;
/** Ballista AOE radius per level (px) - explosion on ground impact. */
export const UPGRADE_BALLISTA_AOE = [60, 80, 100];
/** Ballista cooldown multiplier per level. */
export const UPGRADE_BALLISTA_CD = [1, 0.85, 0.7];
/** Ballista damage multiplier per level. */
export const UPGRADE_BALLISTA_DMG = [1, 1.3, 1.6];

// ─── Laser Tower ───────────────────────────────────────────────────────────

/** Laser tower targeting range per level (px). */
export const UPGRADE_LASER_RANGE = [250, 300, 350];
/** Laser tower DPS per level. */
export const UPGRADE_LASER_DPS = [15, 22, 30];

// ─── Workshop ──────────────────────────────────────────────────────────────

/** Workshop production interval per level (seconds per weapon). */
export const WORKSHOP_PROD_INTERVAL = [30, 22, 15];

// ─── Training Center ───────────────────────────────────────────────────────

/** Max trained guards per training center level. */
export const TRAINING_CENTER_MAX_GUARDS = [2, 3, 4];
/** Training center guard role stats. */
export const TC_WARRIOR_HP = 100;
export const TC_WARRIOR_DAMAGE = 15;
export const TC_WARRIOR_SPEED = 55;
export const TC_RANGER_HP = 60;
export const TC_RANGER_DAMAGE = 10;
export const TC_RANGER_RANGE = 180;
export const TC_RANGER_SPEED = 50;
export const TC_MAGE_HP = 50;
export const TC_MAGE_DAMAGE = 8;
export const TC_MAGE_RANGE = 200;
export const TC_MAGE_SPEED = 45;

/**
 * Returns the resource cost to upgrade a building from its current level to the next,
 * or null if the building is at max level.
 */
export function getUpgradeCost(
  buildingType: BuildingType,
  currentLevel: number,
): Partial<Record<'wood' | 'stone' | 'iron' | 'diamond' | 'food', number>> | null {
  const maxLevel = BUILDING_MAX_LEVEL[buildingType];
  if (currentLevel >= maxLevel) return null;
  const baseCost = BUILDING_COSTS[buildingType];
  if (!baseCost) return null;
  const mult = UPGRADE_COST_MULTIPLIERS[currentLevel - 1]; // level 1->2 uses index 0
  const cost: Partial<Record<'wood' | 'stone' | 'iron' | 'diamond' | 'food', number>> = {};
  for (const [res, amount] of Object.entries(baseCost)) {
    cost[res as 'wood' | 'stone' | 'iron' | 'diamond' | 'food'] = Math.ceil((amount as number) * mult);
  }
  return cost;
}

/**
 * Returns the resource cost to fully repair a building, proportional to missing HP.
 * Returns null if the building is at full HP.
 */
export function getRepairCost(
  buildingType: BuildingType,
  missingHp: number,
  maxHp: number,
): Partial<Record<'wood' | 'stone' | 'iron' | 'diamond' | 'food', number>> | null {
  if (missingHp <= 0) return null;
  const baseCost = BUILDING_COSTS[buildingType];
  if (!baseCost) return null;
  const fraction = missingHp / maxHp;
  const cost: Partial<Record<'wood' | 'stone' | 'iron' | 'diamond' | 'food', number>> = {};
  let hasAnyCost = false;
  for (const [res, amount] of Object.entries(baseCost)) {
    const val = Math.ceil((amount as number) * fraction);
    if (val > 0) {
      cost[res as 'wood' | 'stone' | 'iron' | 'diamond' | 'food'] = val;
      hasAnyCost = true;
    }
  }
  return hasAnyCost ? cost : null;
}

// ── Tesla Coil ────────────────────────────────────────────────────────────
export const TESLA_COIL_RANGE = 180;
export const TESLA_COIL_COOLDOWN = 2.5;
export const TESLA_COIL_DAMAGE = 10;
export const TESLA_COIL_CHAIN_COUNT = 2;
export const TESLA_COIL_CHAIN_RANGE = 80;
/** Tesla coil upgrade arrays (level 1/2/3). */
export const UPGRADE_TESLA_DAMAGE = [10, 14, 18];
export const UPGRADE_TESLA_CHAIN = [2, 2, 3];
export const UPGRADE_TESLA_CD = [1, 0.85, 0.7];

// ── Flame Tower ───────────────────────────────────────────────────────────
export const FLAME_TOWER_RANGE = 100;
export const FLAME_TOWER_DPS = 12;
/** 60-degree cone (30 deg each side). */
export const FLAME_TOWER_ARC = Math.PI / 3;
export const UPGRADE_FLAME_DPS = [12, 18, 25];
export const UPGRADE_FLAME_RANGE = [100, 120, 140];

// ── Catapult ──────────────────────────────────────────────────────────────
export const CATAPULT_RANGE = 500;
export const CATAPULT_COOLDOWN = 6;
export const CATAPULT_DAMAGE = 35;
export const CATAPULT_AOE_RADIUS = 120;
export const CATAPULT_PROJ_SPEED = 200;
export const UPGRADE_CATAPULT_DMG = [1, 1.3, 1.6];
export const UPGRADE_CATAPULT_CD = [1, 0.85, 0.7];
export const UPGRADE_CATAPULT_AOE = [120, 150, 180];

// ── Moat ──────────────────────────────────────────────────────────────────
export const MOAT_SLOW_FACTOR = 0.5;

// ── Repair Station (worker building) ──────────────────────────────────────
export const REPAIR_STATION_HP_PER_TICK = [10, 15, 20];
export const REPAIR_STATION_INTERVAL = [5, 4, 3];
export const REPAIR_STATION_COST_WOOD = 1;
export const REPAIR_STATION_COST_STONE = 1;

// ── Tavern ────────────────────────────────────────────────────────────────
export const TAVERN_MAX_HEROES = [2, 3, 4];
export const TAVERN_ROSTER_SIZE = 4;

// ── Upgrade Preview ──────────────────────────────────────────────────────

/** Returns human-readable stat changes for upgrading from `level` to `level+1`. */
export function getUpgradePreview(type: string, level: number): string[] {
  const maxLvl = (BUILDING_MAX_LEVEL as Record<string, number>)[type] ?? 1;
  if (level >= maxLvl) return ['Max level'];
  const next = level; // index into arrays (level 1 = index 0, so next level = index `level`)
  const lines: string[] = [];

  // HP (all buildings)
  const hpBase = ({
    wall: WALL_MAX_HEALTH, campfire: CAMPFIRE_MAX_HEALTH, warehouse: WAREHOUSE_MAX_HEALTH,
    arrow_turret: ARROW_TURRET_MAX_HEALTH, cannon_turret: CANNON_TURRET_MAX_HEALTH,
    ballista: BALLISTA_MAX_HEALTH, laser_tower: LASER_TOWER_MAX_HEALTH,
    lumbermill: LUMBERMILL_MAX_HEALTH, quarry: QUARRY_MAX_HEALTH, mine: MINE_MAX_HEALTH,
    farm: FARM_MAX_HEALTH, workshop: WORKSHOP_MAX_HEALTH, training_center: TRAINING_CENTER_MAX_HEALTH,
    light_tower: LIGHT_TOWER_MAX_HEALTH, healing_shrine: HEALING_SHRINE_MAX_HEALTH,
    cat_house: CAT_HOUSE_MAX_HEALTH, gate: GATE_MAX_HEALTH, potion_shop: POTION_SHOP_MAX_HEALTH,
    tesla_coil: TESLA_COIL_MAX_HEALTH, flame_tower: FLAME_TOWER_MAX_HEALTH,
    catapult: CATAPULT_MAX_HEALTH, repair_station: REPAIR_STATION_MAX_HEALTH,
    tavern: TAVERN_MAX_HEALTH, spike_trap: SPIKE_TRAP_MAX_HEALTH,
    siege_workshop: SIEGE_WORKSHOP_MAX_HEALTH, kennel: KENNEL_MAX_HEALTH,
    arcane_tower: ARCANE_TOWER_MAX_HEALTH, watchtower: WATCHTOWER_MAX_HEALTH,
    flak_cannon: FLAK_CANNON_MAX_HEALTH, dragon_roost: DRAGON_ROOST_MAX_HEALTH, smeltery: SMELTERY_MAX_HEALTH, market: MARKET_MAX_HEALTH,
  } as Record<string, number>)[type];
  if (hpBase && UPGRADE_HP_MULT[next]) {
    const curHp = Math.round(hpBase * (UPGRADE_HP_MULT[level - 1] ?? 1));
    const nextHp = Math.round(hpBase * UPGRADE_HP_MULT[next]);
    if (nextHp > curHp) lines.push(`HP: ${curHp} -> ${nextHp}`);
  }

  // Per-building stats
  switch (type) {
    case 'arrow_turret':
      if (UPGRADE_ARROW_DMG[next]) lines.push(`Damage: x${UPGRADE_ARROW_DMG[level - 1]} -> x${UPGRADE_ARROW_DMG[next]}`);
      if (UPGRADE_ARROW_CD[next]) lines.push(`Cooldown: x${UPGRADE_ARROW_CD[level - 1]} -> x${UPGRADE_ARROW_CD[next]}`);
      break;
    case 'cannon_turret':
      if (UPGRADE_CANNON_DMG[next]) lines.push(`Damage: x${UPGRADE_CANNON_DMG[level - 1]} -> x${UPGRADE_CANNON_DMG[next]}`);
      if (UPGRADE_CANNON_CD[next]) lines.push(`Cooldown: x${UPGRADE_CANNON_CD[level - 1]} -> x${UPGRADE_CANNON_CD[next]}`);
      if (UPGRADE_CANNON_AOE[next]) lines.push(`AOE: ${UPGRADE_CANNON_AOE[level - 1]}px -> ${UPGRADE_CANNON_AOE[next]}px`);
      break;
    case 'ballista':
      if (UPGRADE_BALLISTA_DMG[next]) lines.push(`Damage: x${UPGRADE_BALLISTA_DMG[level - 1]} -> x${UPGRADE_BALLISTA_DMG[next]}`);
      if (UPGRADE_BALLISTA_CD[next]) lines.push(`Cooldown: x${UPGRADE_BALLISTA_CD[level - 1]} -> x${UPGRADE_BALLISTA_CD[next]}`);
      if (UPGRADE_BALLISTA_AOE[next]) lines.push(`AOE: ${UPGRADE_BALLISTA_AOE[level - 1]}px -> ${UPGRADE_BALLISTA_AOE[next]}px`);
      break;
    case 'laser_tower':
      if (UPGRADE_LASER_DPS[next]) lines.push(`DPS: ${UPGRADE_LASER_DPS[level - 1]} -> ${UPGRADE_LASER_DPS[next]}`);
      if (UPGRADE_LASER_RANGE[next]) lines.push(`Range: ${UPGRADE_LASER_RANGE[level - 1]}px -> ${UPGRADE_LASER_RANGE[next]}px`);
      break;
    case 'tesla_coil':
      if (UPGRADE_TESLA_DAMAGE[next]) lines.push(`Damage: ${UPGRADE_TESLA_DAMAGE[level - 1]} -> ${UPGRADE_TESLA_DAMAGE[next]}`);
      if (UPGRADE_TESLA_CHAIN[next]) lines.push(`Chains: ${UPGRADE_TESLA_CHAIN[level - 1]} -> ${UPGRADE_TESLA_CHAIN[next]}`);
      if (UPGRADE_TESLA_CD[next]) lines.push(`Cooldown: x${UPGRADE_TESLA_CD[level - 1]} -> x${UPGRADE_TESLA_CD[next]}`);
      break;
    case 'flame_tower':
      if (UPGRADE_FLAME_DPS[next]) lines.push(`DPS: ${UPGRADE_FLAME_DPS[level - 1]} -> ${UPGRADE_FLAME_DPS[next]}`);
      if (UPGRADE_FLAME_RANGE[next]) lines.push(`Range: ${UPGRADE_FLAME_RANGE[level - 1]}px -> ${UPGRADE_FLAME_RANGE[next]}px`);
      break;
    case 'catapult':
      if (UPGRADE_CATAPULT_DMG[next]) lines.push(`Damage: x${UPGRADE_CATAPULT_DMG[level - 1]} -> x${UPGRADE_CATAPULT_DMG[next]}`);
      if (UPGRADE_CATAPULT_CD[next]) lines.push(`Cooldown: x${UPGRADE_CATAPULT_CD[level - 1]} -> x${UPGRADE_CATAPULT_CD[next]}`);
      if (UPGRADE_CATAPULT_AOE[next]) lines.push(`AOE: ${UPGRADE_CATAPULT_AOE[level - 1]}px -> ${UPGRADE_CATAPULT_AOE[next]}px`);
      break;
    case 'spike_trap':
      if (UPGRADE_TRAP_DMG[next]) lines.push(`Damage: x${UPGRADE_TRAP_DMG[level - 1]} -> x${UPGRADE_TRAP_DMG[next]}`);
      break;
    case 'light_tower':
      if (UPGRADE_LIGHT_RANGE[next]) lines.push(`Range: ${UPGRADE_LIGHT_RANGE[level - 1]}px -> ${UPGRADE_LIGHT_RANGE[next]}px`);
      break;
    case 'healing_shrine':
      if (UPGRADE_HEAL_RATE[next]) lines.push(`Heal: ${UPGRADE_HEAL_RATE[level - 1]} HP/s -> ${UPGRADE_HEAL_RATE[next]} HP/s`);
      if (UPGRADE_HEAL_RANGE[next]) lines.push(`Range: ${UPGRADE_HEAL_RANGE[level - 1]}px -> ${UPGRADE_HEAL_RANGE[next]}px`);
      break;
    case 'lumbermill': case 'quarry': case 'mine': case 'farm':
      if (UPGRADE_PROD_INTERVAL[next]) lines.push(`Speed: x${(1 / UPGRADE_PROD_INTERVAL[level - 1]).toFixed(1)} -> x${(1 / UPGRADE_PROD_INTERVAL[next]).toFixed(1)}`);
      if (UPGRADE_PROD_MAX[next]) lines.push(`Storage: x${UPGRADE_PROD_MAX[level - 1]} -> x${UPGRADE_PROD_MAX[next]}`);
      break;
    case 'workshop':
      if (WORKSHOP_PROD_INTERVAL[next]) lines.push(`Interval: ${WORKSHOP_PROD_INTERVAL[level - 1]}s -> ${WORKSHOP_PROD_INTERVAL[next]}s`);
      break;
    case 'barracks':
      if (BARRACKS_MAX_GUARDS[next]) lines.push(`Max guards: ${BARRACKS_MAX_GUARDS[level - 1]} -> ${BARRACKS_MAX_GUARDS[next]}`);
      break;
    case 'training_center':
      if (TRAINING_CENTER_MAX_GUARDS[next]) lines.push(`Max guards: ${TRAINING_CENTER_MAX_GUARDS[level - 1]} -> ${TRAINING_CENTER_MAX_GUARDS[next]}`);
      break;
    case 'cat_house':
      if (CAT_HOUSE_CAPACITY[next]) lines.push(`Housing: ${CAT_HOUSE_CAPACITY[level - 1]} -> ${CAT_HOUSE_CAPACITY[next]}`);
      break;
    case 'campfire':
      if (CAMPFIRE_HOUSING_PER_LEVEL[next]) lines.push(`Housing: ${CAMPFIRE_HOUSING_PER_LEVEL[level - 1]} -> ${CAMPFIRE_HOUSING_PER_LEVEL[next]}`);
      break;
    case 'repair_station':
      if (REPAIR_STATION_HP_PER_TICK[next]) lines.push(`Repair: ${REPAIR_STATION_HP_PER_TICK[level - 1]} HP -> ${REPAIR_STATION_HP_PER_TICK[next]} HP`);
      if (REPAIR_STATION_INTERVAL[next]) lines.push(`Interval: ${REPAIR_STATION_INTERVAL[level - 1]}s -> ${REPAIR_STATION_INTERVAL[next]}s`);
      break;
    case 'tavern':
      if (TAVERN_MAX_HEROES[next]) lines.push(`Max heroes: ${TAVERN_MAX_HEROES[level - 1]} -> ${TAVERN_MAX_HEROES[next]}`);
      break;
  }

  return lines.length > 0 ? lines : ['Increased HP'];
}
