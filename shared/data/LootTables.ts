// ─── Loot table definitions ──────────────────────────────────────────────────
// Each enemy type maps to a table of possible drops. The server rolls each
// entry independently on death — an enemy can drop 0, 1, or several items.

export interface LootEntry {
  itemType: string;
  minQty: number;
  maxQty: number;
  /** Drop probability 0–1. 1.0 = guaranteed. */
  chance: number;
  /** True = auto-pickup on overlap (resources). False = requires E-interact. */
  autoPickup: boolean;
}

export interface LootTable {
  entries: LootEntry[];
}

export const LOOT_TABLES: Record<string, LootTable> = {
  basic_enemy: {
    entries: [
      { itemType: 'wood',  minQty: 1, maxQty: 3, chance: 0.5, autoPickup: true },
      { itemType: 'stone', minQty: 1, maxQty: 2, chance: 0.3, autoPickup: true },
      { itemType: 'iron',  minQty: 1, maxQty: 1, chance: 0.1, autoPickup: true },
      { itemType: 'gold',  minQty: 1, maxQty: 2, chance: 0.4, autoPickup: true },
    ],
  },
};
