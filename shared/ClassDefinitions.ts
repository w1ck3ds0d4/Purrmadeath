/**
 * Player class definitions — base stats, weapon info, and display data.
 * Used by both server (spawning, attack routing) and client (UI, hotbar).
 */

export type PlayerClass = 'warrior' | 'ranger' | 'mage' | 'assassin' | 'paladin' | 'necromancer' | 'beastmaster';

export const PLAYER_CLASSES: readonly PlayerClass[] = ['warrior', 'ranger', 'mage', 'assassin', 'paladin', 'necromancer', 'beastmaster'] as const;

/** Classes available without milestone unlocks. */
export const BASE_CLASSES: readonly PlayerClass[] = ['warrior', 'ranger', 'mage'] as const;

export const DEFAULT_CLASS: PlayerClass = 'warrior';

export interface ClassStats {
  hp: number;
  speed: number;
  defense: number;
  stamina: number;
  attackType: 'melee' | 'ranged';
  baseDamage: number;
  weaponName: string;
}

export const CLASS_STATS: Record<PlayerClass, ClassStats> = {
  warrior: {
    hp: 120,
    speed: 180,
    defense: 2,
    stamina: 100,
    attackType: 'melee',
    baseDamage: 18,
    weaponName: 'Sword',
  },
  ranger: {
    hp: 80,
    speed: 220,
    defense: 0,
    stamina: 120,
    attackType: 'ranged',
    baseDamage: 12,
    weaponName: 'Bow',
  },
  mage: {
    hp: 70,
    speed: 200,
    defense: 0,
    stamina: 80,
    attackType: 'ranged', // homing added in Phase 7B
    baseDamage: 14,
    weaponName: 'Staff',
  },
  assassin: {
    hp: 65,
    speed: 240,
    defense: 0,
    stamina: 100,
    attackType: 'melee',
    baseDamage: 22,
    weaponName: 'Daggers',
  },
  paladin: {
    hp: 100,
    speed: 170,
    defense: 3,
    stamina: 90,
    attackType: 'melee',
    baseDamage: 15,
    weaponName: 'Mace',
  },
  necromancer: {
    hp: 60,
    speed: 190,
    defense: 0,
    stamina: 90,
    attackType: 'ranged',
    baseDamage: 16,
    weaponName: 'Tome',
  },
  beastmaster: {
    hp: 90,
    speed: 200,
    defense: 1,
    stamina: 110,
    attackType: 'melee',
    baseDamage: 14,
    weaponName: 'Claws',
  },
};

export const CLASS_DISPLAY_NAMES: Record<PlayerClass, string> = {
  warrior: 'Warrior',
  ranger: 'Ranger',
  mage: 'Mage',
  assassin: 'Assassin',
  paladin: 'Paladin',
  necromancer: 'Necromancer',
  beastmaster: 'Beastmaster',
};

export const CLASS_COLORS: Record<PlayerClass, number> = {
  warrior: 0xcc6633,    // bronze/brown
  ranger: 0x33aa55,     // forest green
  mage: 0x7744cc,       // purple
  assassin: 0x993333,   // dark red
  paladin: 0xccaa44,    // gold
  necromancer: 0x339988, // teal
  beastmaster: 0xcc7733, // orange
};
