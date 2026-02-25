// ─── Network ────────────────────────────────────────────────────────────────

/** Port the WebSocket game server listens on. */
export const SERVER_PORT = 7777;

/** How many ticks the server runs per second (authoritative game clock). */
export const TICK_RATE = 30;

/** Milliseconds between server ticks. */
export const TICK_MS = 1000 / TICK_RATE;

/** Client sends a PING every N ms to keep the connection alive. */
export const PING_INTERVAL_MS = 2_000;

/** Server drops a client that hasn't responded within this window. */
export const HEARTBEAT_TIMEOUT_MS = 60_000;

/** Maximum WebSocket message size in bytes. Prevents memory exhaustion from oversized payloads. */
export const MAX_MESSAGE_BYTES = 64 * 1024; // 64 KB

/** Maximum messages a single client may send per second before being disconnected.
 *  Clients send one INPUT per render frame; allow headroom for 240 Hz + chat + pings. */
export const MAX_MESSAGES_PER_SECOND = 300;

// ─── Connection ─────────────────────────────────────────────────────────────

/** Hard cap on total WebSocket connections the server accepts (idle + in-game). */
export const MAX_CONNECTIONS = 16;

/** Semantic version string - compared in HANDSHAKE for version gating. */
export const GAME_VERSION = '1.0.7';

/** Milliseconds a disconnected player's slot is held before removal. */
export const RECONNECT_GRACE_MS = 30_000;

// ─── Session ─────────────────────────────────────────────────────────────────

/** Maximum number of players per session. */
export const MAX_PLAYERS = 4;

// ─── World ───────────────────────────────────────────────────────────────────

/** Width and height of a single tile in pixels (at 1× zoom). */
export const TILE_SIZE = 32;

/** Number of tiles along each axis of one chunk (chunk = CHUNK_SIZE × CHUNK_SIZE tiles). */
export const CHUNK_SIZE = 32;

/** How many chunks around the player are kept loaded. */
export const VIEW_RADIUS_CHUNKS = 3;

// ─── Player ───────────────────────────────────────────────────────────────────

/** Collision and render radius of the player circle in world pixels. */
export const PLAYER_RADIUS = 12;

/** Base movement speed in world pixels per second. */
export const PLAYER_BASE_SPEED = 180;

/** Full health at spawn. */
export const PLAYER_MAX_HEALTH = 100;

/** Full stamina at spawn. */
export const PLAYER_MAX_STAMINA = 100;

/** Stamina recovered per second while passive (not sprinting). */
export const PLAYER_STAMINA_REGEN = 15;

/**
 * One color per player slot (index 0–3).
 * P1=blue · P2=red · P3=green · P4=yellow
 */
export const PLAYER_COLORS: readonly number[] = [
  0x4a90d9, // P1 - blue
  0x9944cc, // P2 - purple
  0x52c062, // P3 - green
  0xe0a830, // P4 - yellow
];

/** Speed multiplier applied while sprinting. */
export const PLAYER_SPRINT_MULTIPLIER = 1.5;

/** Stamina drained per second while sprinting. */
export const PLAYER_SPRINT_STAMINA_DRAIN = 30;

// ─── Dodge Roll ──────────────────────────────────────────────────────────────
export const DODGE_ROLL_DURATION = 0.2;
export const DODGE_ROLL_COOLDOWN = 0.6;
export const DODGE_ROLL_SPEED = 300;
export const DODGE_ROLL_STAMINA_COST = 25;

// ─── Critical Hits ───────────────────────────────────────────────────────────
export const CRIT_CHANCE = 0.10;
export const CRIT_MULTIPLIER = 2.0;

// ─── Enemy ────────────────────────────────────────────────────────────────────

/** Collision radius of an enemy in world pixels. */
export const ENEMY_RADIUS = 10;

/** Base movement speed for enemies in world pixels per second. */
export const ENEMY_BASE_SPEED = 75;

/** Starting health for a basic enemy. */
export const ENEMY_MAX_HEALTH = 40;

/** Distance (px) at which an enemy begins chasing the nearest player. */
export const ENEMY_AGGRO_RANGE = 500;

/** Number of test enemies spawned on game start (replaced by portals in 4.7). */
export const ENEMY_INITIAL_COUNT = 5;

/** Base melee damage dealt by enemies (before defense reduction). */
export const ENEMY_MELEE_DAMAGE = 10;

/** Melee reach for enemies in world pixels (shorter than player's 60). */
export const ENEMY_MELEE_RANGE = 40;

/** Seconds between enemy melee swings (slower than player's 0.5). */
export const ENEMY_MELEE_COOLDOWN = 1.0;

/** Knockback impulse applied to a player struck by an enemy (px/s). */
export const ENEMY_MELEE_KNOCKBACK = 200;

// ─── Enemy ranger variant ───────────────────────────────────────────────────

/** Chance (0–1) for a spawned enemy to be a ranger instead of melee. */
export const ENEMY_RANGER_SPAWN_CHANCE = 0.3;

/** Ranger firing range in world pixels. */
export const ENEMY_RANGER_RANGE = 200;

/** Seconds between ranger shots. */
export const ENEMY_RANGER_COOLDOWN = 2.0;

/** Damage per ranger projectile. */
export const ENEMY_RANGER_DAMAGE = 8;

/** Ranger projectile speed (px/s). */
export const ENEMY_RANGER_PROJECTILE_SPEED = 300;

/** Ranger base movement speed — slightly slower than melee. */
export const ENEMY_RANGER_SPEED = 60;

/** Ranger health — slightly less than melee. */
export const ENEMY_RANGER_HEALTH = 30;

// ─── Wave difficulty scaling ────────────────────────────────────────────────

/** Compound HP multiplier per wave: enemy HP = base × (1 + scale)^(wave-1). */
export const ENEMY_HP_SCALE_PER_WAVE = 0.02;

/** Compound damage multiplier per wave. */
export const ENEMY_DAMAGE_SCALE_PER_WAVE = 0.01;

/** Every N waves, portals spawn +1 enemy per spawn interval. */
export const PORTAL_EXTRA_SPAWN_EVERY_N_WAVES = 3;

// ─── Melee combat ─────────────────────────────────────────────────────────────

/** Reach of a melee swing in world pixels. */
export const MELEE_RANGE = 60;
/** Full swing arc in radians (120°). Hit is within ±60° of facing. */
export const MELEE_ARC = (2 * Math.PI) / 3;
/** Base damage per melee hit (before defense reduction). */
export const MELEE_DAMAGE = 15;
/** Seconds between melee swings. */
export const MELEE_COOLDOWN = 0;
/** Knockback impulse speed applied to the struck entity (px/s). */
export const MELEE_KNOCKBACK = 250;

// ─── Ranged combat ──────────────────────────────────────────────────────────

/** Base damage per ranged hit (before defense reduction). */
export const RANGED_DAMAGE = 10;
/** Seconds between ranged shots. */
export const RANGED_COOLDOWN = 0;
/** Projectile travel speed in world pixels per second. */
export const RANGED_SPEED = 400;
/** Seconds before a projectile despawns (~500 px range at 400 px/s). */
export const RANGED_LIFETIME = 1.25;
/** Knockback impulse applied to the struck entity by a projectile (px/s). */
export const RANGED_KNOCKBACK = 0;
/** Collision radius of a projectile in world pixels. */
export const PROJECTILE_RADIUS = 4;
/** Homing projectile turn rate in radians per second (mage). */
export const HOMING_TURN_RATE = 8;
/** Homing projectile detection range in world pixels. */
export const HOMING_DETECT_RANGE = 300;

// ─── Waves & Portals ─────────────────────────────────────────────────────

/** Seconds of prep time before wave 1 begins. */
export const WAVE_PREP_INITIAL = 180;

/** Seconds of prep time between subsequent waves. */
export const WAVE_PREP_BETWEEN = 60;

/** Base portal health for wave 1. */
export const PORTAL_BASE_HP = 100;

/** Additional portal health per wave number. */
export const PORTAL_HP_PER_WAVE = 20;

/** Base seconds between enemy spawns from a portal. */
export const PORTAL_BASE_SPAWN_INTERVAL = 8;

/** Multiplicative decay applied to spawn interval each wave (faster spawning). */
export const PORTAL_SPAWN_INTERVAL_DECAY = 0.85;

/** Number of portals spawned for wave 1. */
export const PORTALS_PER_WAVE_BASE = 1;

/** Additional portals per wave beyond wave 1. */
export const PORTALS_PER_WAVE_GROWTH = 1;

/** Minimum distance (px) from player centroid to place portals. */
export const PORTAL_MIN_DIST = 400;

/** Maximum distance (px) from player centroid to place portals. */
export const PORTAL_MAX_DIST = 800;

/** Minimum distance (px) between two portals. */
export const PORTAL_MIN_SPACING = 200;

/** Collision/render radius of a portal in world pixels. */
export const PORTAL_RADIUS = 18;

// ─── Resource Nodes ─────────────────────────────────────────────────────

/** Collision/render radius of a resource node in world pixels. */
export const RESOURCE_NODE_RADIUS = 14;

/** Flat damage all classes deal to resource nodes (normalizes gathering speed). */
export const GATHERING_DAMAGE = 15;

export const TREE_MAX_HEALTH = 30;
export const TREE_WOOD_YIELD = 5;
export const STONE_MAX_HEALTH = 50;
export const STONE_YIELD = 3;
export const IRON_MAX_HEALTH = 80;
export const IRON_YIELD = 2;
export const DIAMOND_MAX_HEALTH = 120;
export const DIAMOND_YIELD = 1;

/** Chunks around spawn origin to populate with resource nodes. */
export const RESOURCE_SPAWN_RADIUS_CHUNKS = 5;
/** Performance cap on total resource node entities. */
export const MAX_RESOURCE_NODES = 1500;

// ─── Item Drops ─────────────────────────────────────────────────────────

/** Render radius of an item drop in world pixels. */
export const ITEM_DROP_RADIUS = 8;
/** Seconds before an uncollected item drop despawns. */
export const ITEM_DROP_LIFETIME = 60;
/** Auto-pickup radius in world pixels. */
export const ITEM_DROP_PICKUP_RADIUS = 28;
/** E-interact pickup radius in world pixels. */
export const ITEM_DROP_INTERACT_RADIUS = 40;
/** Initial scatter velocity when an item drop spawns (px/s). */
export const ITEM_DROP_SCATTER_SPEED = 120;
/** Friction decay rate for item drop scatter velocity. */
export const ITEM_DROP_FRICTION = 6;

// ─── Death & Respawn (4.11) ───────────────────────────────────────────

/** Seconds a downed player has before they fully die (bleed-out timer). */
export const DOWNED_BLEED_TIME = 30;
/** Seconds a teammate must stay near a downed player to complete a revive. */
export const REVIVE_DURATION = 5;
/** HP restored on revive as a fraction of max HP (0.3 = 30%). */
export const REVIVE_HP_PERCENT = 0.3;
/** Seconds after full death before the player respawns at origin. */
export const RESPAWN_DELAY = 8;
/** Max distance (px) between reviver and downed player for revive to work. */
export const REVIVE_RANGE = 50;

// ─── Wave Wipe (4.12) ────────────────────────────────────────────────

/** Fraction of resources lost on first party wipe (0.25 = 25%). */
export const WIPE_1_RESOURCE_LOSS_PERCENT = 0.25;

// ─── Anti-exploit (4.13) ──────────────────────────────────────────────

/** Max distance (px) between client-reported and server position for attacks.
 *  Beyond this, the server substitutes its own authoritative position. */
export const MAX_ATTACK_POSITION_TOLERANCE = 80;

// ─── Entity Collision ─────────────────────────────────────────────────

/** Iterations of the entity-entity separation pass per tick.
 *  More iterations = better chain resolution, but costs O(n²) each. */
export const ENTITY_SEPARATION_ITERATIONS = 3;

// ─── Buildings (Phase 5) ────────────────────────────────────────────────

/** Campfire HP. When it reaches 0 the run ends. */
export const CAMPFIRE_MAX_HEALTH = 300;

/** Wall HP. */
export const WALL_MAX_HEALTH = 150;

/** Half-extent of a 1×1 building AABB in world pixels (legacy default). */
export const BUILDING_HALF_EXTENT = TILE_SIZE / 2; // 16px

/** Tile dimensions per building type (tiles along each edge). */
export const BUILDING_SIZES: Record<string, number> = {
  wall: 1, campfire: 3, warehouse: 3, lumbermill: 2, quarry: 2, mine: 2, farm: 2,
  arrow_turret: 1, cannon_turret: 2, spike_trap: 1, bridge: 1,
  light_tower: 1, healing_shrine: 1, barracks: 2, potion_shop: 2,
};

/** Half-extent in world pixels for a building of the given type. */
export function buildingHalfExtent(type: string): number {
  return ((BUILDING_SIZES[type] ?? 1) * TILE_SIZE) / 2;
}

/**
 * Snap a world-pixel coordinate to the correct grid position for a building.
 * Odd-tile buildings align to tile centers; even-tile buildings align to tile corners.
 */
export function snapBuildingPosition(wx: number, wy: number, type: string): { x: number; y: number } {
  const tiles = BUILDING_SIZES[type] ?? 1;
  if (tiles % 2 === 1) {
    return { x: Math.floor(wx / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2,
             y: Math.floor(wy / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2 };
  } else {
    return { x: Math.round(wx / TILE_SIZE) * TILE_SIZE,
             y: Math.round(wy / TILE_SIZE) * TILE_SIZE };
  }
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

/** Radius (px) for auto-depositing player resources into the warehouse. */
export const WAREHOUSE_DEPOSIT_RADIUS = 80;

/** Fraction of original cost refunded when demolishing a building. */
export const DEMOLISH_REFUND_PERCENT = 0.5;

/** Per-building-type resource costs for placement. */
export const BUILDING_COSTS: Record<string, Partial<Record<'wood' | 'stone' | 'iron' | 'diamond' | 'food', number>>> = {
  campfire:       { wood: 20, stone: 15, iron: 5 },
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
};

/** Ordered list of building types the player can cycle through in build mode. */
export const PLACEABLE_BUILDINGS: string[] = [
  'wall', 'warehouse', 'lumbermill', 'quarry', 'mine', 'farm',
  'arrow_turret', 'cannon_turret', 'spike_trap', 'bridge',
  'light_tower', 'healing_shrine', 'potion_shop',
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

import type { BuildingType } from './components';

/** Max upgrade level per building type. */
export const BUILDING_MAX_LEVEL: Record<BuildingType, number> = {
  campfire: 5, bridge: 1,
  wall: 3, warehouse: 3, lumbermill: 3, quarry: 3, mine: 3, farm: 3,
  arrow_turret: 3, cannon_turret: 3, spike_trap: 3,
  light_tower: 3, healing_shrine: 3, barracks: 3, potion_shop: 3,
};

/** Cost multiplier for each upgrade level (index 0 = level 2, index 1 = level 3, etc.). */
export const UPGRADE_COST_MULTIPLIERS = [1.5, 2.5, 3.5, 4.5];

// Stat multipliers indexed by (level - 1). Level 1 = index 0 = 1.0 (base).
/** HP multiplier per level (campfire uses all 5, others use first 3). */
export const UPGRADE_HP_MULT        = [1, 1.5, 2.0, 2.5, 3.0];
/** Production interval multiplier (lower = faster). 1x → 3x → 5x speed. */
export const UPGRADE_PROD_INTERVAL  = [1, 0.333, 0.2];
/** Production max stored multiplier. 10 → 30 → 50 storage. */
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
  const mult = UPGRADE_COST_MULTIPLIERS[currentLevel - 1]; // level 1→2 uses index 0
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