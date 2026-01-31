import { TileId } from './TileRegistry';

// ─── Biome IDs ────────────────────────────────────────────────────────────────

export enum BiomeId {
  Ocean     = 0,
  Shore     = 1,
  Desert    = 2,
  Grassland = 3,
  Forest    = 4,
  Highland  = 5, // cold uplands — tundra + stone
  Cave      = 6, // dark stone biome at mid-high elevations
  Mountain  = 7, // impassable peaks
}

// ─── Biome definition ─────────────────────────────────────────────────────────

export interface BiomeDef {
  readonly name: string;
  /** The dominant tile for this biome. */
  readonly primaryTile: TileId;
  /** Secondary tile used for detail variation (larger impact in Phase 9). */
  readonly accentTile: TileId;
  /**
   * Ambient fog / light tint color for this biome (Phase 9).
   * Not used in Phase 1 flat rendering.
   */
  readonly fogColor: number;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const BIOME_DEFS: readonly BiomeDef[] = [
  /* 0 Ocean     */ { name: 'Ocean',     primaryTile: TileId.DeepWater,    accentTile: TileId.DeepWater,    fogColor: 0x1a3d5c },
  /* 1 Shore     */ { name: 'Shore',     primaryTile: TileId.ShallowWater, accentTile: TileId.Sand,         fogColor: 0x2e6e9e },
  /* 2 Desert    */ { name: 'Desert',    primaryTile: TileId.Sand,         accentTile: TileId.Stone,        fogColor: 0xc8a85a },
  /* 3 Grassland */ { name: 'Grassland', primaryTile: TileId.Grass,        accentTile: TileId.Dirt,         fogColor: 0x4a8c3a },
  /* 4 Forest    */ { name: 'Forest',    primaryTile: TileId.Forest,       accentTile: TileId.Grass,        fogColor: 0x2d5a27 },
  /* 5 Highland  */ { name: 'Highland',  primaryTile: TileId.Tundra,       accentTile: TileId.Stone,        fogColor: 0xc8ccd4 },
  /* 6 Cave      */ { name: 'Cave',      primaryTile: TileId.Cave,         accentTile: TileId.Stone,        fogColor: 0x3a3a4a },
  /* 7 Mountain  */ { name: 'Mountain',  primaryTile: TileId.Mountain,     accentTile: TileId.Stone,        fogColor: 0xb0b0b8 },
];
