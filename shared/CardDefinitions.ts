/** Card categories determine visual styling and effect type. */
export type CardCategory = 'buff' | 'ability' | 'resource' | 'trap';
export type CardRarity = 'common' | 'rare' | 'epic';

export interface CardDefinition {
  id: string;
  name: string;
  description: string;
  category: CardCategory;
  rarity: CardRarity;
  effect: CardEffect;
}

export type CardEffect =
  | { type: 'stat_buff'; stat: 'damage' | 'speed' | 'maxHp' | 'hpRegen'; value: number }
  | { type: 'ability'; ability: string }
  | { type: 'resource'; resource: string; amount: number }
  | { type: 'trap_player'; stat: 'damage' | 'speed'; value: number }
  | { type: 'trap_enemy'; stat: 'speed' | 'damage'; value: number };

/** The full card pool. */
export const CARD_POOL: CardDefinition[] = [
  // ── Buffs ──
  {
    id: 'sharpened_claws', name: 'Sharpened Claws',
    description: '+10% melee & ranged damage',
    category: 'buff', rarity: 'common',
    effect: { type: 'stat_buff', stat: 'damage', value: 0.10 },
  },
  {
    id: 'quick_paws', name: 'Quick Paws',
    description: '+15% movement speed',
    category: 'buff', rarity: 'common',
    effect: { type: 'stat_buff', stat: 'speed', value: 0.15 },
  },
  {
    id: 'nine_lives', name: 'Nine Lives',
    description: 'Regenerate 2 HP per second',
    category: 'buff', rarity: 'rare',
    effect: { type: 'stat_buff', stat: 'hpRegen', value: 2 },
  },
  {
    id: 'thick_fur', name: 'Thick Fur',
    description: '+25 maximum HP',
    category: 'buff', rarity: 'common',
    effect: { type: 'stat_buff', stat: 'maxHp', value: 25 },
  },
  {
    id: 'razor_fangs', name: 'Razor Fangs',
    description: '+20% melee & ranged damage',
    category: 'buff', rarity: 'rare',
    effect: { type: 'stat_buff', stat: 'damage', value: 0.20 },
  },
  {
    id: 'feline_grace', name: 'Feline Grace',
    description: '+25% movement speed',
    category: 'buff', rarity: 'rare',
    effect: { type: 'stat_buff', stat: 'speed', value: 0.25 },
  },
  {
    id: 'iron_hide', name: 'Iron Hide',
    description: '+50 maximum HP',
    category: 'buff', rarity: 'epic',
    effect: { type: 'stat_buff', stat: 'maxHp', value: 50 },
  },
  {
    id: 'healing_purr', name: 'Healing Purr',
    description: 'Regenerate 5 HP per second',
    category: 'buff', rarity: 'epic',
    effect: { type: 'stat_buff', stat: 'hpRegen', value: 5 },
  },

  // ── Abilities ──
  {
    id: 'ghost_sight', name: 'Ghost Sight',
    description: 'Reveal hidden ghosts within 300px',
    category: 'ability', rarity: 'rare',
    effect: { type: 'ability', ability: 'reveal_ghosts' },
  },
  {
    id: 'rapid_strikes', name: 'Rapid Strikes',
    description: 'Hold attack button to auto-attack',
    category: 'ability', rarity: 'epic',
    effect: { type: 'ability', ability: 'hold_attack' },
  },

  // ── Resources ──
  {
    id: 'lumber_stash', name: 'Lumber Stash',
    description: 'Instantly gain 50 wood',
    category: 'resource', rarity: 'common',
    effect: { type: 'resource', resource: 'wood', amount: 50 },
  },
  {
    id: 'stone_cache', name: 'Stone Cache',
    description: 'Instantly gain 30 stone',
    category: 'resource', rarity: 'common',
    effect: { type: 'resource', resource: 'stone', amount: 30 },
  },
  {
    id: 'iron_shipment', name: 'Iron Shipment',
    description: 'Instantly gain 20 iron',
    category: 'resource', rarity: 'rare',
    effect: { type: 'resource', resource: 'iron', amount: 20 },
  },
  {
    id: 'diamond_find', name: 'Diamond Find',
    description: 'Instantly gain 5 diamond',
    category: 'resource', rarity: 'epic',
    effect: { type: 'resource', resource: 'diamond', amount: 5 },
  },
  {
    id: 'food_surplus', name: 'Food Surplus',
    description: 'Instantly gain 40 food',
    category: 'resource', rarity: 'common',
    effect: { type: 'resource', resource: 'food', amount: 40 },
  },

  {
    id: 'alchemists_pouch', name: "Alchemist's Pouch",
    description: '+1 max potion charge',
    category: 'ability', rarity: 'rare',
    effect: { type: 'ability', ability: 'extra_potion_charge' },
  },

  // ── Traps (negative effects) ──
  {
    id: 'cursed_claws', name: 'Cursed Claws',
    description: 'ALL players deal 20% less damage',
    category: 'trap', rarity: 'common',
    effect: { type: 'trap_player', stat: 'damage', value: -0.20 },
  },
  {
    id: 'adrenaline_surge', name: 'Adrenaline Surge',
    description: 'ALL enemies move 10% faster',
    category: 'trap', rarity: 'common',
    effect: { type: 'trap_enemy', stat: 'speed', value: 0.10 },
  },
  {
    id: 'enraged_horde', name: 'Enraged Horde',
    description: 'ALL enemies deal 15% more damage',
    category: 'trap', rarity: 'rare',
    effect: { type: 'trap_enemy', stat: 'damage', value: 0.15 },
  },
];

/** Rarity weights for card selection. */
export const RARITY_WEIGHTS: Record<CardRarity, number> = {
  common: 60,
  rare: 30,
  epic: 10,
};

/** Category color for UI styling. */
export const CATEGORY_COLORS: Record<CardCategory, number> = {
  buff:     0x4a90d9,
  ability:  0xaa44ff,
  resource: 0x66aa66,
  trap:     0xcc3333,
};

/** Rarity border colors for UI. */
export const RARITY_BORDER_COLORS: Record<CardRarity, string> = {
  common: 'rgba(180,180,180,0.3)',
  rare:   'rgba(74,144,217,0.6)',
  epic:   'rgba(170,68,255,0.6)',
};
