import { TileId } from '@shared/world/TileRegistry';
import type { ResourceType } from '@shared/components';
import {
  TREE_MAX_HEALTH,
  TREE_WOOD_YIELD,
  STONE_MAX_HEALTH,
  STONE_YIELD,
  IRON_MAX_HEALTH,
  IRON_YIELD,
  DIAMOND_MAX_HEALTH,
  DIAMOND_YIELD,
} from '@shared/constants';

// ─── Per-resource stats ──────────────────────────────────────────────────────

export interface ResourceStats {
  hp: number;
  yield: number;
}

export const RESOURCE_STATS: Record<ResourceType, ResourceStats> = {
  wood:    { hp: TREE_MAX_HEALTH,    yield: TREE_WOOD_YIELD },
  stone:   { hp: STONE_MAX_HEALTH,   yield: STONE_YIELD },
  iron:    { hp: IRON_MAX_HEALTH,    yield: IRON_YIELD },
  diamond: { hp: DIAMOND_MAX_HEALTH, yield: DIAMOND_YIELD },
};

// ─── Biome-weighted spawn tables ─────────────────────────────────────────────

export interface ResourceSpawnEntry {
  resourceType: ResourceType;
  /** Relative probability - higher = more common on this tile type. */
  weight: number;
}

/**
 * Which resources can spawn on which tile type, with relative weights.
 * Tiles not listed here never spawn resource nodes.
 */
export const RESOURCE_SPAWN_TABLE: Partial<Record<number, ResourceSpawnEntry[]>> = {
  [TileId.Sand]:   [{ resourceType: 'wood',  weight: 1 }, { resourceType: 'stone', weight: 2 }],
  [TileId.Grass]:  [{ resourceType: 'wood',  weight: 3 }, { resourceType: 'stone', weight: 1 }],
  [TileId.Dirt]:   [{ resourceType: 'wood',  weight: 2 }, { resourceType: 'stone', weight: 2 }],
  [TileId.Forest]: [{ resourceType: 'wood',  weight: 5 }, { resourceType: 'stone', weight: 1 }],
  [TileId.Stone]:  [{ resourceType: 'stone', weight: 4 }, { resourceType: 'iron',  weight: 2 }],
  [TileId.Tundra]: [{ resourceType: 'stone', weight: 3 }, { resourceType: 'iron',  weight: 1 }],
  [TileId.Cave]:   [{ resourceType: 'stone', weight: 3 }, { resourceType: 'iron',  weight: 4 }, { resourceType: 'diamond', weight: 0.2 }],
};

/**
 * Per-tile-type chance (0-1) that a resource node spawns on any given tile.
 * Higher values = denser resource coverage in that biome.
 */
export const TILE_SPAWN_CHANCE: Partial<Record<number, number>> = {
  [TileId.Sand]:   0.01,   // sparse
  [TileId.Grass]:  0.015,
  [TileId.Dirt]:   0.015,
  [TileId.Forest]: 0.04,   // dense - forests have many trees
  [TileId.Stone]:  0.035,
  [TileId.Tundra]: 0.02,
  [TileId.Cave]:   0.03,
};
