/** Card categories determine visual styling and effect type. */
export type CardCategory = 'buff' | 'ability' | 'resource' | 'trap';
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
export const CARD_POOL: CardDefinition[] = [
  // ── Buffs ──
  {
    id: 'sharpened_claws', name: 'Sharpened Claws',
    description: '+10% damage',
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
    description: '+20% damage',
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
  {
    id: 'second_wind', name: 'Second Wind',
    description: 'Revive at 50% HP instead of 30%',
    category: 'buff', rarity: 'common',
    effect: { type: 'stat_buff', stat: 'reviveHpBonus', value: 0.20 },
  },
  {
    id: 'steel_whiskers', name: 'Steel Whiskers',
    description: '+3 flat damage reduction',
    category: 'buff', rarity: 'common',
    effect: { type: 'stat_buff', stat: 'defense', value: 3 },
  },
  {
    id: 'catnap', name: 'Catnap',
    description: '+30% stamina regen',
    category: 'buff', rarity: 'common',
    effect: { type: 'stat_buff', stat: 'staminaRegenMult', value: 0.30 },
  },
  {
    id: 'cat_launcher', name: 'Cat Launcher',
    description: '+50% knockback dealt',
    category: 'buff', rarity: 'common',
    effect: { type: 'stat_buff', stat: 'knockbackMult', value: 0.50 },
  },
  {
    id: 'lucky_claws', name: 'Lucky Claws',
    description: '+10% critical hit chance',
    category: 'buff', rarity: 'rare',
    effect: { type: 'stat_buff', stat: 'critChance', value: 0.10 },
  },
  {
    id: 'diamond_coat', name: 'Diamond Coat',
    description: '+6 flat damage reduction',
    category: 'buff', rarity: 'rare',
    effect: { type: 'stat_buff', stat: 'defense', value: 6 },
  },
  {
    id: 'endless_energy', name: 'Endless Energy',
    description: '+50 maximum stamina',
    category: 'buff', rarity: 'rare',
    effect: { type: 'stat_buff', stat: 'maxStamina', value: 50 },
  },
  {
    id: 'immovable_object', name: 'Immovable Object',
    description: '-50% knockback received',
    category: 'buff', rarity: 'rare',
    effect: { type: 'stat_buff', stat: 'knockbackResist', value: 0.50 },
  },
  {
    id: 'predators_eye', name: "Predator's Eye",
    description: '+15% critical hit chance',
    category: 'buff', rarity: 'epic',
    effect: { type: 'stat_buff', stat: 'critChance', value: 0.15 },
  },
  {
    id: 'critical_mass', name: 'Critical Mass',
    description: 'Critical hits deal 3x damage instead of 2x',
    category: 'buff', rarity: 'epic',
    effect: { type: 'stat_buff', stat: 'critMultiplier', value: 1.0 },
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
  {
    id: 'alchemists_pouch', name: "Alchemist's Pouch",
    description: '+1 max potion charge',
    category: 'ability', rarity: 'rare',
    effect: { type: 'ability', ability: 'extra_potion_charge' },
  },
  {
    id: 'last_stand', name: 'Last Stand',
    description: '+30% damage when below 25% HP',
    category: 'ability', rarity: 'rare',
    effect: { type: 'ability', ability: 'last_stand' },
  },
  {
    id: 'vampiric_bite', name: 'Vampiric Bite',
    description: 'Heal 10% of damage dealt',
    category: 'ability', rarity: 'epic',
    effect: { type: 'ability', ability: 'lifesteal' },
  },
  {
    id: 'scavenger', name: 'Scavenger',
    description: '+50% resource drops from enemies',
    category: 'ability', rarity: 'rare',
    effect: { type: 'ability', ability: 'scavenger' },
  },
  {
    id: 'magnetic_fur', name: 'Magnetic Fur',
    description: '+100% item pickup range',
    category: 'ability', rarity: 'rare',
    effect: { type: 'ability', ability: 'magnetic_fur' },
  },
  {
    id: 'thick_walls', name: 'Thick Walls',
    description: 'Buildings take 25% less damage',
    category: 'ability', rarity: 'rare',
    effect: { type: 'ability', ability: 'thick_walls' },
  },
  {
    id: 'building_regen', name: 'Building Regen',
    description: 'Buildings regenerate 5 HP per second',
    category: 'ability', rarity: 'rare',
    effect: { type: 'ability', ability: 'building_regen' },
  },
  {
    id: 'spare_life', name: 'Spare Life',
    description: '+1 self-revive (auto-revive when downed)',
    category: 'ability', rarity: 'epic',
    effect: { type: 'ability', ability: 'spare_life' },
  },
  {
    id: 'rapid_fire', name: 'Rapid Fire',
    description: 'Turrets attack 20% faster',
    category: 'ability', rarity: 'rare',
    effect: { type: 'ability', ability: 'rapid_fire' },
  },
  {
    id: 'bounty_hunter', name: 'Bounty Hunter',
    description: '+50% gold drops from enemies',
    category: 'ability', rarity: 'rare',
    effect: { type: 'ability', ability: 'bounty_hunter' },
  },
  {
    id: 'thorns', name: 'Thorns',
    description: 'Enemies take 5 damage when hitting you',
    category: 'ability', rarity: 'rare',
    effect: { type: 'ability', ability: 'thorns' },
  },
  {
    id: 'pack_hunter', name: 'Pack Hunter',
    description: '+5% damage per ally within 200px',
    category: 'buff', rarity: 'rare',
    effect: { type: 'ability', ability: 'pack_hunter' },
    requiresMultiplayer: true,
  },
  {
    id: 'lone_wolf', name: 'Lone Wolf',
    description: '+15% damage when no ally within 300px',
    category: 'buff', rarity: 'rare',
    effect: { type: 'ability', ability: 'lone_wolf' },
    requiresMultiplayer: true,
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
    id: 'gold_rush', name: 'Gold Rush',
    description: 'Instantly gain 25 gold',
    category: 'resource', rarity: 'common',
    effect: { type: 'resource', resource: 'gold', amount: 25 },
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
    id: 'heavy_paws', name: 'Heavy Paws',
    description: 'ALL players lose 25% stamina regen',
    category: 'trap', rarity: 'common',
    effect: { type: 'trap_player', stat: 'staminaRegen', value: -0.25 },
  },
  {
    id: 'brittle_bones', name: 'Brittle Bones',
    description: 'ALL players lose 20 maximum HP',
    category: 'trap', rarity: 'common',
    effect: { type: 'trap_player', stat: 'maxHp', value: -20 },
  },
  {
    id: 'lead_paws', name: 'Lead Paws',
    description: 'ALL players move 15% slower',
    category: 'trap', rarity: 'common',
    effect: { type: 'trap_player', stat: 'speed', value: -0.15 },
  },
  {
    id: 'rusty_claws', name: 'Rusty Claws',
    description: 'ALL players attack 20% slower',
    category: 'trap', rarity: 'common',
    effect: { type: 'trap_player', stat: 'attackSpeed', value: -0.20 },
  },
  {
    id: 'jammed_gears', name: 'Jammed Gears',
    description: 'Turrets attack 25% slower',
    category: 'trap', rarity: 'common',
    effect: { type: 'ability', ability: 'jammed_gears' },
  },
  {
    id: 'resource_drought', name: 'Resource Drought',
    description: 'Production buildings produce 30% slower',
    category: 'trap', rarity: 'common',
    effect: { type: 'ability', ability: 'resource_drought' },
  },
  {
    id: 'enraged_horde', name: 'Enraged Horde',
    description: 'ALL enemies deal 15% more damage',
    category: 'trap', rarity: 'rare',
    effect: { type: 'trap_enemy', stat: 'damage', value: 0.15 },
  },
  {
    id: 'shoddy_construction', name: 'Shoddy Construction',
    description: 'Buildings take 25% more damage',
    category: 'trap', rarity: 'rare',
    effect: { type: 'ability', ability: 'shoddy_construction' },
  },
  {
    id: 'titans_march', name: "Titan's March",
    description: '+1 Titan spawns every wave',
    category: 'trap', rarity: 'rare',
    effect: { type: 'ability', ability: 'titans_march' },
  },
  {
    id: 'tremor', name: 'Tremor',
    description: 'ALL enemies deal 30% more knockback',
    category: 'trap', rarity: 'rare',
    effect: { type: 'trap_enemy', stat: 'knockback', value: 0.30 },
  },
  {
    id: 'slow_reflexes', name: 'Slow Reflexes',
    description: 'ALL players dodge roll cooldown +30%',
    category: 'trap', rarity: 'epic',
    effect: { type: 'ability', ability: 'slow_reflexes' },
  },
  {
    id: 'soul_link', name: 'Soul Link',
    description: 'Take 3 damage/s when no ally within 250px',
    category: 'trap', rarity: 'epic',
    effect: { type: 'ability', ability: 'soul_link' },
    requiresMultiplayer: true,
  },

  // ── Legendaries ──
  {
    id: 'apex_predator', name: 'Apex Predator',
    description: '+30% damage, +20% speed, +10% crit chance',
    category: 'buff', rarity: 'legendary',
    effect: { type: 'multi', effects: [
      { type: 'stat_buff', stat: 'damage', value: 0.30 },
      { type: 'stat_buff', stat: 'speed', value: 0.20 },
      { type: 'stat_buff', stat: 'critChance', value: 0.10 },
    ]},
  },
  {
    id: 'immortal_fur', name: 'Immortal Fur',
    description: '+100 max HP, +8 HP/s regen',
    category: 'buff', rarity: 'legendary',
    effect: { type: 'multi', effects: [
      { type: 'stat_buff', stat: 'maxHp', value: 100 },
      { type: 'stat_buff', stat: 'hpRegen', value: 8 },
    ]},
  },
  {
    id: 'cats_eye_diamond', name: "Cat's Eye Diamond",
    description: '+25% crit chance, crits deal 4x damage',
    category: 'buff', rarity: 'legendary',
    effect: { type: 'multi', effects: [
      { type: 'stat_buff', stat: 'critChance', value: 0.25 },
      { type: 'stat_buff', stat: 'critMultiplier', value: 2.0 },
    ]},
  },
  {
    id: 'unstoppable_force', name: 'Unstoppable Force',
    description: '+100% knockback dealt, immune to knockback',
    category: 'buff', rarity: 'legendary',
    effect: { type: 'multi', effects: [
      { type: 'stat_buff', stat: 'knockbackMult', value: 1.0 },
      { type: 'stat_buff', stat: 'knockbackResist', value: 1.0 },
    ]},
  },
  {
    id: 'phoenix_down', name: 'Phoenix Down',
    description: '+2 self-revives, revive at 75% HP',
    category: 'ability', rarity: 'legendary',
    effect: { type: 'multi', effects: [
      { type: 'stat_buff', stat: 'reviveHpBonus', value: 0.45 },
      { type: 'ability', ability: 'phoenix_down' },
    ]},
  },
  {
    id: 'blood_fury', name: 'Blood Fury',
    description: '15% lifesteal, 10 thorns damage, +30% damage below 25% HP',
    category: 'ability', rarity: 'legendary',
    effect: { type: 'multi', effects: [
      { type: 'ability', ability: 'lifesteal' },
      { type: 'ability', ability: 'blood_thorns' },
      { type: 'ability', ability: 'last_stand' },
    ]},
  },
  {
    id: 'master_builder', name: 'Master Builder',
    description: 'Buildings -50% damage, +10 HP/s regen, turrets 40% faster',
    category: 'ability', rarity: 'legendary',
    effect: { type: 'multi', effects: [
      { type: 'ability', ability: 'master_walls' },
      { type: 'ability', ability: 'master_regen' },
      { type: 'ability', ability: 'master_turrets' },
    ]},
  },
  {
    id: 'kings_ransom', name: "King's Ransom",
    description: 'Instantly gain 50 of every resource',
    category: 'resource', rarity: 'legendary',
    effect: { type: 'multi', effects: [
      { type: 'resource', resource: 'wood', amount: 50 },
      { type: 'resource', resource: 'stone', amount: 50 },
      { type: 'resource', resource: 'iron', amount: 50 },
      { type: 'resource', resource: 'diamond', amount: 50 },
      { type: 'resource', resource: 'gold', amount: 50 },
      { type: 'resource', resource: 'food', amount: 50 },
    ]},
  },
  {
    id: 'the_rumbling', name: 'The Rumbling',
    description: '+2 Titans spawn every wave',
    category: 'trap', rarity: 'legendary',
    effect: { type: 'ability', ability: 'the_rumbling' },
  },
  {
    id: 'curse_of_weakness', name: 'Curse of Weakness',
    description: 'ALL players -30% damage, -25% speed, -30% stamina regen',
    category: 'trap', rarity: 'legendary',
    effect: { type: 'multi', effects: [
      { type: 'trap_player', stat: 'damage', value: -0.30 },
      { type: 'trap_player', stat: 'speed', value: -0.25 },
      { type: 'trap_player', stat: 'staminaRegen', value: -0.30 },
    ]},
  },
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
  trap:     0xcc3333,
};

/** Rarity border colors for UI. */
export const RARITY_BORDER_COLORS: Record<CardRarity, string> = {
  common:    'rgba(180,180,180,0.3)',
  rare:      'rgba(74,144,217,0.6)',
  epic:      'rgba(170,68,255,0.6)',
  legendary: 'rgba(232,201,106,0.7)',
};
