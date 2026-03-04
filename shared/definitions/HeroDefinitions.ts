// ─── Hero Type Registry ──────────────────────────────────────────────────────
// Defines all hireable hero NPCs for the Tavern building.

export interface HeroAbilityDef {
  id: string;
  name: string;
  description: string;
  cooldown: number;
  /** AOE radius (0 = single-target / self). */
  radius: number;
  /** Damage dealt by the ability (0 = non-damage ability). */
  damage: number;
  /** Duration of buff/debuff effect in seconds (0 = instant). */
  duration: number;
}

export interface HeroDef {
  id: string;
  name: string;
  /** Gold cost to hire from tavern. */
  cost: number;
  hp: number;
  damage: number;
  speed: number;
  /** 0 = melee, >0 = ranged attack range (px). */
  range: number;
  ability: HeroAbilityDef;
}

export const HERO_DEFINITIONS: Record<string, HeroDef> = {
  knight: {
    id: 'knight',
    name: 'Sir Paws',
    cost: 50,
    hp: 200,
    damage: 12,
    speed: 50,
    range: 0,
    ability: {
      id: 'taunt',
      name: 'Taunt',
      description: 'Forces nearby enemies to target this hero for 5s',
      cooldown: 15,
      radius: 150,
      damage: 0,
      duration: 5,
    },
  },
  archer: {
    id: 'archer',
    name: 'Whisker Shot',
    cost: 40,
    hp: 80,
    damage: 10,
    speed: 55,
    range: 200,
    ability: {
      id: 'rain_of_arrows',
      name: 'Rain of Arrows',
      description: '8 projectiles in a 100px area',
      cooldown: 20,
      radius: 100,
      damage: 8,
      duration: 0,
    },
  },
  cleric: {
    id: 'cleric',
    name: 'Father Meowgnus',
    cost: 60,
    hp: 100,
    damage: 6,
    speed: 50,
    range: 0,
    ability: {
      id: 'heal_pulse',
      name: 'Heal Pulse',
      description: 'Heals allies in 120px for 20 HP',
      cooldown: 12,
      radius: 120,
      damage: 0,
      duration: 0,
    },
  },
  berserker: {
    id: 'berserker',
    name: 'Clawstorm',
    cost: 45,
    hp: 120,
    damage: 18,
    speed: 65,
    range: 0,
    ability: {
      id: 'whirlwind',
      name: 'Whirlwind',
      description: '360-deg 60px AOE, 25 dmg',
      cooldown: 10,
      radius: 60,
      damage: 25,
      duration: 0,
    },
  },
  wizard: {
    id: 'wizard',
    name: 'Archmage Fluffington',
    cost: 55,
    hp: 70,
    damage: 8,
    speed: 45,
    range: 220,
    ability: {
      id: 'fireball',
      name: 'Fireball',
      description: '80px AOE, 30 dmg',
      cooldown: 15,
      radius: 80,
      damage: 30,
      duration: 0,
    },
  },
  scout: {
    id: 'scout',
    name: 'Shadowpaw',
    cost: 35,
    hp: 60,
    damage: 14,
    speed: 80,
    range: 0,
    ability: {
      id: 'dash_strike',
      name: 'Dash Strike',
      description: 'Teleport to enemy, 20 dmg',
      cooldown: 8,
      radius: 0,
      damage: 20,
      duration: 0,
    },
  },
  paladin: {
    id: 'paladin',
    name: 'Sir Purrsalot',
    cost: 65,
    hp: 180,
    damage: 10,
    speed: 48,
    range: 0,
    ability: {
      id: 'shield_aura',
      name: 'Shield Aura',
      description: '50% DR for allies in 100px, 8s',
      cooldown: 20,
      radius: 100,
      damage: 0,
      duration: 8,
    },
  },
  assassin: {
    id: 'assassin',
    name: 'Nightclaw',
    cost: 50,
    hp: 70,
    damage: 22,
    speed: 70,
    range: 0,
    ability: {
      id: 'teleport_strike',
      name: 'Teleport Strike',
      description: 'Blink to enemy, 35 dmg',
      cooldown: 12,
      radius: 0,
      damage: 35,
      duration: 0,
    },
  },
};

/** All hero definition IDs for roster generation. */
export const HERO_IDS = Object.keys(HERO_DEFINITIONS);

/** Hero stat scaling per tavern upgrade level (index 0 = L1, 1 = L2, 2 = L3). */
export const HERO_LEVEL_SCALING = [1.0, 1.25, 1.5];
