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
      | 'critChance' | 'critMultiplier' | 'critDamage' | 'reviveHpBonus' | 'defense'
      | 'staminaRegenMult' | 'maxStamina' | 'knockbackMult' | 'knockbackResist'
      | 'dodgeChance';
      value: number }
  | { type: 'ability'; ability: string }
  | { type: 'resource'; resource: string; amount: number }
  | { type: 'trap_player'; stat: 'damage' | 'speed' | 'staminaRegen' | 'maxHp' | 'attackSpeed'; value: number }
  | { type: 'trap_enemy'; stat: 'speed' | 'damage' | 'knockback'; value: number }
  | { type: 'multi'; effects: CardEffect[] };

/** The full card pool - 30 cards: 15 stat, 10 build-defining, 5 curses. */
export const CARD_POOL: CardDefinition[] = [
  // ── Stat Cards (15) - scaling power per wave ──────────────────────────────
  { id: 'sharpened_claws', name: 'Sharpened Claws', description: '+10% damage',
    category: 'buff', rarity: 'common', effect: { type: 'stat_buff', stat: 'damage', value: 0.10 } },
  { id: 'razor_fangs', name: 'Razor Fangs', description: '+20% damage',
    category: 'buff', rarity: 'rare', effect: { type: 'stat_buff', stat: 'damage', value: 0.20 } },
  { id: 'thick_fur', name: 'Thick Fur', description: '+25 max HP',
    category: 'buff', rarity: 'common', effect: { type: 'stat_buff', stat: 'maxHp', value: 25 } },
  { id: 'iron_hide', name: 'Iron Hide', description: '+50 max HP',
    category: 'buff', rarity: 'epic', effect: { type: 'stat_buff', stat: 'maxHp', value: 50 } },
  { id: 'quick_paws', name: 'Quick Paws', description: '+15% movement speed',
    category: 'buff', rarity: 'common', effect: { type: 'stat_buff', stat: 'speed', value: 0.15 } },
  { id: 'feline_grace', name: 'Feline Grace', description: '+25% movement speed',
    category: 'buff', rarity: 'rare', effect: { type: 'stat_buff', stat: 'speed', value: 0.25 } },
  { id: 'lucky_claws', name: 'Lucky Claws', description: '+10% critical hit chance',
    category: 'buff', rarity: 'rare', effect: { type: 'stat_buff', stat: 'critChance', value: 0.10 } },
  { id: 'predators_eye', name: "Predator's Eye", description: '+15% crit chance, +20% crit damage',
    category: 'buff', rarity: 'epic', effect: { type: 'multi', effects: [
      { type: 'stat_buff', stat: 'critChance', value: 0.15 },
      { type: 'stat_buff', stat: 'critDamage', value: 0.20 },
    ] } },
  { id: 'steel_whiskers', name: 'Steel Whiskers', description: '+3 flat damage reduction',
    category: 'buff', rarity: 'common', effect: { type: 'stat_buff', stat: 'defense', value: 3 } },
  { id: 'nine_lives', name: 'Nine Lives', description: 'Regenerate 5 HP per second',
    category: 'buff', rarity: 'rare', effect: { type: 'stat_buff', stat: 'hpRegen', value: 5 } },
  { id: 'endurance', name: 'Endurance', description: '+30 maximum stamina',
    category: 'buff', rarity: 'common', effect: { type: 'stat_buff', stat: 'maxStamina', value: 30 } },
  { id: 'cat_nap', name: 'Cat Nap', description: '+30% stamina regeneration',
    category: 'buff', rarity: 'common', effect: { type: 'stat_buff', stat: 'staminaRegenMult', value: 0.30 } },
  { id: 'fleet_footed', name: 'Fleet Footed', description: '+20% dodge chance',
    category: 'buff', rarity: 'rare', effect: { type: 'stat_buff', stat: 'dodgeChance', value: 0.20 } },
  { id: 'battle_hardened', name: 'Battle Hardened', description: '+10% damage, +20 HP, +5% crit',
    category: 'buff', rarity: 'epic', effect: { type: 'multi', effects: [
      { type: 'stat_buff', stat: 'damage', value: 0.10 },
      { type: 'stat_buff', stat: 'maxHp', value: 20 },
      { type: 'stat_buff', stat: 'critChance', value: 0.05 },
    ] } },
  { id: 'apex_predator', name: 'Apex Predator', description: '+30% damage, +50 HP, +10% crit',
    category: 'buff', rarity: 'legendary', effect: { type: 'multi', effects: [
      { type: 'stat_buff', stat: 'damage', value: 0.30 },
      { type: 'stat_buff', stat: 'maxHp', value: 50 },
      { type: 'stat_buff', stat: 'critChance', value: 0.10 },
    ] } },

  // ── Build-Defining Cards (10) - change playstyle ──────────────────────────
  { id: 'vampiric_bite', name: 'Vampiric Bite', description: 'Heal 10% of damage dealt',
    category: 'ability', rarity: 'epic', effect: { type: 'ability', ability: 'vampiric_bite' } },
  { id: 'last_stand', name: 'Last Stand', description: '+30% damage when below 25% HP',
    category: 'ability', rarity: 'rare', effect: { type: 'ability', ability: 'last_stand' } },
  { id: 'pack_hunter', name: 'Pack Hunter', description: '+5% damage per nearby ally within 200px',
    category: 'ability', rarity: 'rare', effect: { type: 'ability', ability: 'pack_hunter' },
    requiresMultiplayer: true },
  { id: 'bounty_hunter', name: 'Bounty Hunter', description: '+50% gold drops from enemies',
    category: 'ability', rarity: 'rare', effect: { type: 'ability', ability: 'bounty_hunter' } },
  { id: 'building_regen', name: 'Building Regen', description: 'All buildings regenerate 5 HP/s',
    category: 'ability', rarity: 'rare', effect: { type: 'ability', ability: 'building_regen' } },
  { id: 'rapid_strikes', name: 'Rapid Strikes', description: 'Hold attack button for auto-attack',
    category: 'ability', rarity: 'epic', effect: { type: 'ability', ability: 'hold_attack' } },
  { id: 'magnetic_fur', name: 'Magnetic Fur', description: '+100% item pickup range',
    category: 'ability', rarity: 'rare', effect: { type: 'ability', ability: 'magnetic_fur' } },
  { id: 'second_wind', name: 'Second Wind', description: 'Revive at 50% HP instead of 30%',
    category: 'ability', rarity: 'common', effect: { type: 'stat_buff', stat: 'reviveHpBonus', value: 0.20 } },
  { id: 'alchemists_pouch', name: "Alchemist's Pouch", description: '+1 max potion charge',
    category: 'ability', rarity: 'rare', effect: { type: 'ability', ability: 'extra_potion' } },
  { id: 'explosive_touch', name: 'Explosive Touch', description: 'Melee attacks create a 40px shockwave',
    category: 'ability', rarity: 'legendary', effect: { type: 'ability', ability: 'explosive_touch' } },

  // ── Curse Cards (5) - affect all players ──────────────────────────────────
  { id: 'fragile_bones', name: 'Fragile Bones', description: 'All players lose 15% max HP',
    category: 'curse', rarity: 'common', effect: { type: 'trap_player', stat: 'maxHp', value: 0.15 } },
  { id: 'heavy_paws', name: 'Heavy Paws', description: 'All players lose 10% movement speed',
    category: 'curse', rarity: 'common', effect: { type: 'trap_player', stat: 'speed', value: 0.10 } },
  { id: 'dulled_claws', name: 'Dulled Claws', description: 'All players lose 15% damage',
    category: 'curse', rarity: 'rare', effect: { type: 'trap_player', stat: 'damage', value: 0.15 } },
  { id: 'enemy_rage', name: 'Enemy Rage', description: 'Enemies deal 20% more damage',
    category: 'curse', rarity: 'rare', effect: { type: 'trap_enemy', stat: 'damage', value: 0.20 } },
  { id: 'thick_fog', name: 'Thick Fog', description: 'Enemies move 25% faster',
    category: 'curse', rarity: 'epic', effect: { type: 'trap_enemy', stat: 'speed', value: 0.25 } },
];

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
