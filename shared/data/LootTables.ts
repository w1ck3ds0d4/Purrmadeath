// ─── Loot table definitions ──────────────────────────────────────────────────
// Each enemy type maps to a table of possible drops. The server rolls each
// entry independently on death - an enemy can drop 0, 1, or several items.

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
  // Fallback table for any unrecognized enemy type
  basic_enemy: {
    entries: [
      { itemType: 'wood',  minQty: 1, maxQty: 3, chance: 0.5, autoPickup: true },
      { itemType: 'stone', minQty: 1, maxQty: 2, chance: 0.3, autoPickup: true },
      { itemType: 'iron',  minQty: 1, maxQty: 1, chance: 0.1, autoPickup: true },
      { itemType: 'gold',  minQty: 1, maxQty: 2, chance: 0.4, autoPickup: true },
    ],
  },

  // ── Per-variant loot tables ──────────────────────────────────────────────
  melee: {
    entries: [
      { itemType: 'wood',  minQty: 1, maxQty: 3, chance: 0.8,  autoPickup: true },
      { itemType: 'stone', minQty: 1, maxQty: 2, chance: 0.4,  autoPickup: true },
      { itemType: 'food',  minQty: 1, maxQty: 2, chance: 0.2,  autoPickup: true },
      { itemType: 'gold',  minQty: 1, maxQty: 1, chance: 0.15, autoPickup: true },
    ],
  },
  ranger: {
    entries: [
      { itemType: 'wood',  minQty: 1, maxQty: 2, chance: 0.5,  autoPickup: true },
      { itemType: 'stone', minQty: 1, maxQty: 2, chance: 0.3,  autoPickup: true },
      { itemType: 'iron',  minQty: 1, maxQty: 1, chance: 0.3,  autoPickup: true },
      { itemType: 'gold',  minQty: 1, maxQty: 2, chance: 0.25, autoPickup: true },
    ],
  },
  ghost: {
    entries: [
      { itemType: 'iron',    minQty: 1, maxQty: 2, chance: 0.4,  autoPickup: true },
      { itemType: 'diamond', minQty: 1, maxQty: 1, chance: 0.15, autoPickup: true },
      { itemType: 'gold',    minQty: 1, maxQty: 3, chance: 0.5,  autoPickup: true },
    ],
  },
  giant: {
    entries: [
      { itemType: 'wood',  minQty: 3, maxQty: 6, chance: 1.0,  autoPickup: true },
      { itemType: 'stone', minQty: 2, maxQty: 5, chance: 1.0,  autoPickup: true },
      { itemType: 'iron',  minQty: 1, maxQty: 3, chance: 0.6,  autoPickup: true },
      { itemType: 'gold',  minQty: 2, maxQty: 4, chance: 0.5,  autoPickup: true },
    ],
  },
  assassin: {
    entries: [
      { itemType: 'gold',    minQty: 2, maxQty: 5, chance: 0.7,  autoPickup: true },
      { itemType: 'iron',    minQty: 1, maxQty: 2, chance: 0.3,  autoPickup: true },
      { itemType: 'diamond', minQty: 1, maxQty: 1, chance: 0.1,  autoPickup: true },
    ],
  },
  titan: {
    entries: [
      { itemType: 'wood',    minQty: 5, maxQty: 10, chance: 1.0,  autoPickup: true },
      { itemType: 'stone',   minQty: 4, maxQty: 8,  chance: 1.0,  autoPickup: true },
      { itemType: 'iron',    minQty: 3, maxQty: 6,  chance: 1.0,  autoPickup: true },
      { itemType: 'gold',    minQty: 5, maxQty: 10, chance: 1.0,  autoPickup: true },
      { itemType: 'diamond', minQty: 1, maxQty: 3,  chance: 0.5,  autoPickup: true },
      { itemType: 'food',    minQty: 3, maxQty: 6,  chance: 0.8,  autoPickup: true },
    ],
  },
};
