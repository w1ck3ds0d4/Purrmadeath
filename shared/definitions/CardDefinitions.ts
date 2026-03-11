/** Card categories determine visual styling and effect type. */
export type CardCategory = 'buff' | 'ability' | 'resource' | 'curse';
export type CardRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface CardDefinition {
  id: string;
  name: string;
  description: string;
  category: CardCategory;
  rarity: CardRarity;
  effect: CardEffect;
  /** If true, this card only appears when 2+ players are in the session. */
  requiresMultiplayer?: boolean;
}

export type CardEffect =
  | { type: 'stat_buff'; stat: 'damage' | 'speed' | 'maxHp' | 'hpRegen'
      | 'critChance' | 'critMultiplier' | 'reviveHpBonus' | 'defense'
      | 'staminaRegenMult' | 'maxStamina' | 'knockbackMult' | 'knockbackResist';
      value: number }
  | { type: 'ability'; ability: string }
  | { type: 'resource'; resource: string; amount: number }
  | { type: 'trap_player'; stat: 'damage' | 'speed' | 'staminaRegen' | 'maxHp' | 'attackSpeed'; value: number }
  | { type: 'trap_enemy'; stat: 'speed' | 'damage' | 'knockback'; value: number }
  | { type: 'multi'; effects: CardEffect[] };

/** The full card pool. */
export const CARD_POOL: CardDefinition[] = [];

/** Rarity weights for card selection. */
export const RARITY_WEIGHTS: Record<CardRarity, number> = {
  common: 60,
  rare: 30,
  epic: 10,
  legendary: 3,
};

/** Category color for UI styling. */
export const CATEGORY_COLORS: Record<CardCategory, number> = {
  buff:     0x4a90d9,
  ability:  0xaa44ff,
  resource: 0x66aa66,
  curse:    0xcc6633,
};

/** Rarity border colors for UI. */
export const RARITY_BORDER_COLORS: Record<CardRarity, string> = {
  common:    'rgba(180,180,180,0.3)',
  rare:      'rgba(74,144,217,0.6)',
  epic:      'rgba(170,68,255,0.6)',
  legendary: 'rgba(232,201,106,0.7)',
};
