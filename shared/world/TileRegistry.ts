// ─── Tile IDs ─────────────────────────────────────────────────────────────────
// Stored as Uint16 in chunk arrays - max 65 535 tile types.
// Keep values stable across versions (saved worlds depend on them).

export enum TileId {
  Void         = 0,  // unset / error tile
  DeepWater    = 1,
  ShallowWater = 2,
  Sand         = 3,
  Grass        = 4,
  Dirt         = 5,
  Forest       = 6,  // dense tree cover
  Stone        = 7,
  Mountain     = 8,  // impassable rock face
  Tundra       = 9,  // frozen ground
  Cave         = 10, // dark underground stone
}

// ─── Tile definition ──────────────────────────────────────────────────────────

export interface TileDef {
  readonly name: string;
  /** True if entities can walk on this tile. */
  readonly walkable: boolean;
  /** True if the tile blocks movement and projectiles (walls, mountains). */
  readonly solid: boolean;
  /** Base color for Phase 1 flat rendering. Replace with sprite atlas in Phase 9. */
  readonly color: number;
}

// ─── Registry ─────────────────────────────────────────────────────────────────
// Indexed directly by TileId - O(1) lookup, no Map overhead.
// MUST remain in enum value order.

export const TILE_DEFS: readonly TileDef[] = [
  /*  0 Void         */ { name: 'Void',         walkable: false, solid: true,  color: 0x0a0a0f },
  /*  1 DeepWater    */ { name: 'DeepWater',    walkable: false, solid: false, color: 0x1a3d5c },
  /*  2 ShallowWater */ { name: 'ShallowWater', walkable: false, solid: false, color: 0x2e6e9e },
  /*  3 Sand         */ { name: 'Sand',         walkable: true,  solid: false, color: 0xc8a85a },
  /*  4 Grass        */ { name: 'Grass',        walkable: true,  solid: false, color: 0x4a8c3a },
  /*  5 Dirt         */ { name: 'Dirt',         walkable: true,  solid: false, color: 0x8a6a3a },
  /*  6 Forest       */ { name: 'Forest',       walkable: true,  solid: false, color: 0x2d5a27 },
  /*  7 Stone        */ { name: 'Stone',        walkable: true,  solid: false, color: 0x7a7a82 },
  /*  8 Mountain     */ { name: 'Mountain',     walkable: false, solid: true,  color: 0xb0b0b8 },
  /*  9 Tundra       */ { name: 'Tundra',       walkable: true,  solid: false, color: 0xc8ccd4 },
  /* 10 Cave         */ { name: 'Cave',         walkable: true,  solid: false, color: 0x3a3a4a },
];
