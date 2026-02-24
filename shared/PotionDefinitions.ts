// ─── Potion System Definitions ────────────────────────────────────────────────

export type PotionType = 'health' | 'speed' | 'damage' | 'shield';

export type PotionEffectType = 'heal' | 'speed_boost' | 'damage_boost' | 'shield';

export interface PotionEffect {
  type: PotionEffectType;
  /** Heal amount, speed multiplier bonus, damage multiplier bonus, or shield HP. */
  value: number;
  /** Duration in seconds (0 for instant effects like heal). */
  duration: number;
}

export interface PotionDefinition {
  id: PotionType;
  name: string;
  shortName: string;
  description: string;
  unlockCost: Partial<Record<'wood' | 'stone' | 'iron' | 'diamond' | 'food', number>>;
  restockCost: Partial<Record<'wood' | 'stone' | 'iron' | 'diamond' | 'food', number>>;
  /** Cooldown in seconds after use. */
  cooldown: number;
  /** Effect per shop level (index 0 = level 1). */
  effectByLevel: PotionEffect[];
  /** Hex color for UI display. */
  color: number;
}

/** Charges available per shop level (index 0 = level 1). */
export const POTION_CHARGES_BY_LEVEL = [2, 3, 4];

/** Max interaction range in world pixels to open/restock at a potion shop. */
export const POTION_SHOP_INTERACT_RANGE = 80;

/** Potion use cooldown in seconds. */
export const POTION_USE_COOLDOWN = 1;

/** All potions available in the shop. */
export const POTION_POOL: Record<PotionType, PotionDefinition> = {
  health: {
    id: 'health',
    name: 'Catnip Tea',
    shortName: 'Heal',
    description: 'Instantly restores HP',
    unlockCost: { stone: 5, food: 10 },
    restockCost: { food: 5 },
    cooldown: 15,
    effectByLevel: [
      { type: 'heal', value: 40, duration: 0 },
      { type: 'heal', value: 60, duration: 0 },
      { type: 'heal', value: 80, duration: 0 },
    ],
    color: 0x44cc66,
  },
  speed: {
    id: 'speed',
    name: 'Quick Pounce Brew',
    shortName: 'Speed',
    description: 'Temporary speed boost',
    unlockCost: { iron: 5, food: 10 },
    restockCost: { food: 3, iron: 2 },
    cooldown: 20,
    effectByLevel: [
      { type: 'speed_boost', value: 0.5, duration: 6 },
      { type: 'speed_boost', value: 0.5, duration: 8 },
      { type: 'speed_boost', value: 0.5, duration: 10 },
    ],
    color: 0x44aaff,
  },
  damage: {
    id: 'damage',
    name: "Tiger's Rage Elixir",
    shortName: 'Damage',
    description: 'Temporary damage boost',
    unlockCost: { iron: 8, diamond: 2 },
    restockCost: { iron: 3, diamond: 1 },
    cooldown: 25,
    effectByLevel: [
      { type: 'damage_boost', value: 0.3, duration: 6 },
      { type: 'damage_boost', value: 0.3, duration: 8 },
      { type: 'damage_boost', value: 0.3, duration: 10 },
    ],
    color: 0xff6644,
  },
  shield: {
    id: 'shield',
    name: 'Iron Fur Tonic',
    shortName: 'Shield',
    description: 'Absorbs incoming damage',
    unlockCost: { stone: 10, diamond: 3 },
    restockCost: { stone: 5, diamond: 1 },
    cooldown: 25,
    effectByLevel: [
      { type: 'shield', value: 40, duration: 10 },
      { type: 'shield', value: 60, duration: 10 },
      { type: 'shield', value: 80, duration: 10 },
    ],
    color: 0xaa66ff,
  },
};

/** Ordered list of all potion types for UI display. */
export const POTION_TYPES: PotionType[] = ['health', 'speed', 'damage', 'shield'];
