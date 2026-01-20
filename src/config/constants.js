export const TILE_SIZE = 32;
export const LOAD_BUFFER = 3;
export const SPAWN_SAFE_RADIUS_TILES = 50;

export const TERRAIN_COLORS = {
    grass: 0x2d5016,
    ocean: 0x0d2a4b,
    lake: 0x245a8d,
    river: 0x3d7fb8
};

export const FEATURE_REGION_SIZE = 40;
export const FEATURE_SEARCH_RADIUS = 2;
export const WATER_FEATURE_CHANCE = 0.45;

export const RESOURCE_REGION_SIZE = 64;
export const RESOURCE_FEATURE_SEARCH_RADIUS = 1;
export const BASE_RESOURCE_CHANCE = 0.004;
export const HARVEST_RANGE = 40;

export const ENEMY_SIZE = 24;
export const ENEMY_RADIUS = ENEMY_SIZE / 2;
export const PLAYER_COLLISION_RADIUS = 16;
export const ENEMY_SPEED = 90;
export const ENEMY_MAX_COUNT = 100;
export const ENEMY_SPAWN_INTERVAL_FRAMES = 30;
export const ENEMY_OFFSCREEN_MARGIN_TILES = 4;
export const ENEMY_MIN_PLAYER_DISTANCE_TILES = 8;
export const ENEMY_DESPAWN_DISTANCE_TILES = 95;
export const ENEMY_REPATH_INTERVAL_FRAMES = 30;
export const ENEMY_BLOCKED_REPATH_INTERVAL_FRAMES = 90;
export const ENEMY_REPATH_JITTER_FRAMES = 12;
export const ENEMY_PATH_GRID_RADIUS = 18;
export const ENEMY_PATH_MAX_STEPS = 900;
export const ENEMY_MAX_REPATHS_PER_FRAME = 8;
export const ENEMY_MAX_HP = 40;
export const ENEMY_CONTACT_DAMAGE = 10;
export const ENEMY_CONTACT_COOLDOWN_FRAMES = 35;
export const ENEMY_KNOCKBACK_FRICTION = 0.92;
export const ENEMY_MIN_KNOCKBACK_SPEED = 8;
export const INVULN_FRAMES_ON_HIT = 12;
export const PLAYER_MAX_HP = 100;
export const PLAYER_INVULN_FRAMES = 25;
export const MAX_BULLETS = 70;
export const GOLD_PER_ENEMY_KILL = 5;

export const WEAPONS = {
    sword: {
        damage: 25,
        cooldownFrames: 20,
        range: 52,
        arcRadians: Math.PI * 0.95,
        knockbackSpeed: 260
    },
    pistol: {
        damage: 20,
        cooldownFrames: 12,
        bulletSpeed: 420,
        bulletLifetimeFrames: 90
    }
};

export const RESOURCE_TYPES = {
    wood: { color: 0x1d5b2a, weight: 0.55 },
    stone: { color: 0x7f7f7f, weight: 0.35 },
    iron: { color: 0xffffff, weight: 0.10 }
};

export const RESOURCE_BIOMES = {
    forest: {
        chance: 0.10,
        minNodes: 50,
        maxNodes: 80,
        radius: 7
    },
    quarry: {
        chance: 0.03,
        minNodes: 50,
        maxNodes: 70,
        radius: 7,
        ironChance: 0.14
    },
    mine: {
        chance: 0.02,
        nodeCount: 15,
        radius: 4
    }
};

export const PLAYER_SPEED = 200;

// Building blueprints:
// - Add new buildable structures here.
// - Change `cost` to tune required resources.
// - For walls, set `maxHp` and switch `unbreakable` to `false` when break logic is enabled.
export const BUILDING_TYPES = {
    lumberMill: {
        label: 'Lumber Mill',
        footprint: { w: 2, h: 2 },
        color: 0x8b5a2b,
        // Producer tuning:
        // - `cycleFrames` controls how often output is generated.
        // - `outputPerCycle` controls per-cycle output quantity.
        // - `storageCap` controls max buffered output before collection.
        role: 'producer',
        outputResource: 'wood',
        outputPerCycle: 1,
        cycleFrames: 180,
        storageCap: 50,
        cost: {
            wood: 20,
            stone: 10,
            iron: 0,
            gold: 0
        }
    },
    wallLvl1: {
        label: 'Wall Lvl1',
        footprint: { w: 1, h: 1 },
        color: 0x7a4f2a,
        role: 'wall',
        maxHp: 500,
        unbreakable: true,
        cost: {
            wood: 1,
            stone: 0,
            iron: 0,
            gold: 0
        }
    },
    wallLvl2: {
        label: 'Wall Lvl2',
        footprint: { w: 1, h: 1 },
        color: 0x6f6f6f,
        role: 'wall',
        maxHp: 1500,
        unbreakable: true,
        cost: {
            wood: 0,
            stone: 1,
            iron: 0,
            gold: 0
        }
    },
    wallLvl3: {
        label: 'Wall Lvl3',
        footprint: { w: 1, h: 1 },
        color: 0xd8d8d8,
        role: 'wall',
        maxHp: 3000,
        unbreakable: true,
        cost: {
            wood: 0,
            stone: 0,
            iron: 1,
            gold: 0
        }
    }
};
