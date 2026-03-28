import { TileId } from '@shared/world/TileRegistry';
import type { POIType } from '@shared/components';

// ─── POI spawn configuration ────────────────────────────────────────────────

/** Render/collision radius of a POI in world pixels. */
export const POI_RADIUS = 18;

/** Interaction radius for E-key POIs (camp, shrine, chest). */
export const POI_INTERACT_RADIUS = 60;

/** Proximity trigger radius for enemy nests (px). */
export const NEST_TRIGGER_RADIUS = 150;

/** Max POIs generated per chunk (keeps them rare and special). */
export const MAX_POIS_PER_CHUNK = 2;

/** Minimum distance from spawn origin before POIs can generate (px). */
export const POI_MIN_DIST_FROM_SPAWN = 400;

/** Shrine buff duration in seconds. */
export const SHRINE_BUFF_DURATION = 120;

/** Shrine buff values by type. */
export const SHRINE_BUFF_VALUES: Record<string, Record<string, number>> = {
  speed:   { speedFlat: 40 },
  damage:  { damageFlat: 10 },
  regen:   { hpRegen: 5 },
  defense: { defenseFlat: 3 },
};

/** Number of enemies spawned by an enemy nest (min-max). */
export const NEST_ENEMY_COUNT = { min: 4, max: 8 };

// ─── Rendering colors per POI type ──────────────────────────────────────────

export const POI_COLORS: Record<POIType, { body: number; core: number }> = {
  abandoned_camp: { body: 0x8B6914, core: 0xD4A843 },  // brown/gold - old campfire
  shrine:         { body: 0x6A5ACD, core: 0xB8A9FF },  // purple/lavender - magical
  enemy_nest:     { body: 0x8B0000, core: 0xFF4444 },  // dark red/red - danger
  treasure_chest: { body: 0xDAA520, core: 0xFFD700 },  // goldenrod/gold - treasure
};

/** Display names for each POI type. */
export const POI_NAMES: Record<POIType, string> = {
  abandoned_camp: 'Abandoned Camp',
  shrine:         'Ancient Shrine',
  enemy_nest:     'Enemy Nest',
  treasure_chest: 'Treasure Chest',
};

// ─── Biome-weighted spawn tables ────────────────────────────────────────────

export interface POISpawnEntry {
  poiType: POIType;
  /** Relative probability weight. */
  weight: number;
}

/**
 * Which POI types can spawn on which tile type, with relative weights.
 * Tiles not listed here never spawn POIs.
 */
export const POI_SPAWN_TABLE: Partial<Record<number, POISpawnEntry[]>> = {
  [TileId.Grass]:  [
    { poiType: 'abandoned_camp', weight: 3 },
    { poiType: 'shrine',         weight: 1 },
    { poiType: 'treasure_chest', weight: 1 },
  ],
  [TileId.Dirt]:   [
    { poiType: 'abandoned_camp', weight: 3 },
    { poiType: 'enemy_nest',     weight: 2 },
    { poiType: 'treasure_chest', weight: 1 },
  ],
  [TileId.Forest]: [
    { poiType: 'abandoned_camp', weight: 2 },
    { poiType: 'enemy_nest',     weight: 3 },
    { poiType: 'shrine',         weight: 1 },
    { poiType: 'treasure_chest', weight: 1 },
  ],
  [TileId.Stone]:  [
    { poiType: 'enemy_nest',     weight: 3 },
    { poiType: 'treasure_chest', weight: 2 },
    { poiType: 'shrine',         weight: 1 },
  ],
  [TileId.Sand]:   [
    { poiType: 'abandoned_camp', weight: 2 },
    { poiType: 'treasure_chest', weight: 1 },
  ],
  [TileId.Tundra]: [
    { poiType: 'shrine',         weight: 2 },
    { poiType: 'enemy_nest',     weight: 2 },
    { poiType: 'treasure_chest', weight: 1 },
  ],
  [TileId.Cave]:   [
    { poiType: 'enemy_nest',     weight: 4 },
    { poiType: 'treasure_chest', weight: 3 },
    { poiType: 'shrine',         weight: 1 },
  ],
};

/**
 * Per-tile-type chance (0-1) that a POI spawns on any given tile.
 * Much rarer than resources (~1/20th to 1/50th of resource density).
 */
export const POI_TILE_SPAWN_CHANCE: Partial<Record<number, number>> = {
  [TileId.Sand]:   0.0005,
  [TileId.Grass]:  0.0008,
  [TileId.Dirt]:   0.0008,
  [TileId.Forest]: 0.001,
  [TileId.Stone]:  0.001,
  [TileId.Tundra]: 0.0006,
  [TileId.Cave]:   0.0012,
};
