// ---------------------------------------------------------------------------
// Boss Definitions - unique boss enemies with special attacks and phases
// ---------------------------------------------------------------------------

export type BossAI = 'hunter' | 'kiter' | 'ambusher' | 'building_target' | 'campfire' | 'circler' | 'pursuer' | 'aggressive';

export interface BossPhaseAbility {
  id: string;
  cooldown: number;
  /** Description for tooltip/debug. */
  desc: string;
}

export interface BossPhase {
  /** HP fraction threshold to enter this phase (1.0 = from full HP). */
  hpThreshold: number;
  /** Speed override for this phase (null = keep previous). */
  speed?: number;
  /** Damage reduction multiplier (1.0 = normal, 0.7 = 30% DR). */
  damageTaken?: number;
  /** Abilities active during this phase. */
  abilities: BossPhaseAbility[];
  /** Banner text shown when entering this phase (null for phase 1). */
  bannerText?: string;
}

export interface BossLoot {
  /** Card rarity pool: 'rare+' means rare/epic/legendary, 'epic+' means epic/legendary, 'legendary' means legendary only. */
  cardPool: 'rare+' | 'epic+' | 'legendary';
  /** Number of cards dropped. */
  cardCount: number;
  /** Bonus resource drops: { resource: amount }. */
  bonusResources?: Record<string, number>;
  /** 50% chance bonus drop. */
  bonusDrop?: { type: 'resource'; resource: string; amount: number };
  /** Special effect on kill (applied to all players). */
  onKillEffect?: string;
}

export interface BossDefinition {
  id: string;
  name: string;
  /** Minimum wave to appear. */
  minWave: number;
  /** Base HP before wave scaling. */
  hp: number;
  speed: number;
  damage: number;
  /** Melee attack range (px). */
  range: number;
  knockback: number;
  /** Attack cooldown (seconds). */
  cooldown: number;
  /** Collision/hit-detection radius (px). */
  radius: number;
  /** AI behavior type. */
  ai: BossAI;
  /** Phases (ordered by HP threshold descending - phase 1 first). */
  phases: BossPhase[];
  /** Loot table. */
  loot: BossLoot;
  /** Description shown on boss intro. */
  description: string;
}

export const BOSS_DEFINITIONS: BossDefinition[] = [
  // ── Improved Existing Bosses ──────────────────────────────────────────────

  {
    id: 'ravager',
    name: 'The Ravager',
    minWave: 5,
    hp: 2000,
    speed: 80,
    damage: 60,
    range: 55,
    knockback: 350,
    cooldown: 1.0,
    radius: 35,
    ai: 'hunter',
    phases: [
      {
        hpThreshold: 1.0,
        abilities: [
          { id: 'charge', cooldown: 8, desc: 'Charges at nearest player' },
        ],
      },
      {
        hpThreshold: 0.5,
        speed: 95,
        abilities: [
          { id: 'charge', cooldown: 6, desc: 'Faster charges' },
          { id: 'ground_slam', cooldown: 5, desc: '100px AOE shockwave, 30 dmg + knockback' },
        ],
        bannerText: 'THE RAVAGER ENRAGED!',
      },
    ],
    loot: {
      cardPool: 'rare+',
      cardCount: 1,
      bonusDrop: { type: 'resource', resource: 'iron', amount: 30 },
    },
    description: 'A hulking beast that charges and slams.',
  },

  {
    id: 'necromancer',
    name: 'The Necromancer',
    minWave: 10,
    hp: 1500,
    speed: 50,
    damage: 30,
    range: 40,
    knockback: 200,
    cooldown: 1.5,
    radius: 25,
    ai: 'kiter',
    phases: [
      {
        hpThreshold: 1.0,
        abilities: [
          { id: 'summon', cooldown: 10, desc: 'Summons 3 minions' },
          { id: 'death_bolt', cooldown: 5, desc: 'Slow homing projectile, 40 dmg' },
        ],
      },
      {
        hpThreshold: 0.5,
        abilities: [
          { id: 'summon', cooldown: 6, desc: 'Summons 6 minions' },
          { id: 'death_bolt', cooldown: 4, desc: 'Faster death bolts' },
          { id: 'bone_shield', cooldown: 10, desc: 'Absorbs 200 damage' },
        ],
        bannerText: 'THE NECROMANCER ENRAGED!',
      },
    ],
    loot: {
      cardPool: 'epic+',
      cardCount: 1,
      bonusDrop: { type: 'resource', resource: 'stone', amount: 30 },
    },
    description: 'Raises the dead and fires bolts of dark magic.',
  },

  {
    id: 'shadow_lord',
    name: 'The Shadow Lord',
    minWave: 15,
    hp: 3000,
    speed: 70,
    damage: 50,
    range: 50,
    knockback: 300,
    cooldown: 1.2,
    radius: 30,
    ai: 'ambusher',
    phases: [
      {
        hpThreshold: 1.0,
        abilities: [
          { id: 'teleport', cooldown: 12, desc: 'Teleports to random player' },
          { id: 'shadow_wave', cooldown: 8, desc: '180-deg cone, 120px, 35 dmg + slow' },
        ],
      },
      {
        hpThreshold: 0.5,
        abilities: [
          { id: 'teleport', cooldown: 8, desc: 'Faster teleports, leaves shadow clone' },
          { id: 'shadow_wave', cooldown: 6, desc: 'Faster shadow waves' },
        ],
        bannerText: 'THE SHADOW LORD ENRAGED!',
      },
    ],
    loot: {
      cardPool: 'epic+',
      cardCount: 1,
      bonusDrop: { type: 'resource', resource: 'diamond', amount: 10 },
    },
    description: 'Teleports and creates shadow clones.',
  },

  // ── New Bosses ────────────────────────────────────────────────────────────

  {
    id: 'broodmother',
    name: 'The Broodmother',
    minWave: 8,
    hp: 2500,
    speed: 45,
    damage: 25,
    range: 45,
    knockback: 250,
    cooldown: 1.4,
    radius: 38,
    ai: 'building_target',
    phases: [
      {
        hpThreshold: 1.0,
        abilities: [
          { id: 'burrow', cooldown: 15, desc: 'Burrows, resurfaces at new location spawning 4 spiders' },
        ],
      },
      {
        hpThreshold: 0.5,
        abilities: [
          { id: 'burrow', cooldown: 8, desc: 'Faster burrow, 6 spiders' },
          { id: 'web_shot', cooldown: 10, desc: 'Roots a player for 2s' },
        ],
        bannerText: 'THE BROODMOTHER ENRAGED!',
      },
    ],
    loot: {
      cardPool: 'rare+',
      cardCount: 2,
    },
    description: 'A massive spider that burrows and spawns swarms.',
  },

  {
    id: 'infernal',
    name: 'The Infernal',
    minWave: 12,
    hp: 3500,
    speed: 60,
    damage: 45,
    range: 50,
    knockback: 300,
    cooldown: 1.1,
    radius: 32,
    ai: 'circler',
    phases: [
      {
        hpThreshold: 1.0,
        abilities: [
          { id: 'fire_trail', cooldown: 0, desc: 'Leaves burning trail while walking' },
          { id: 'meteor_rain', cooldown: 10, desc: '3 meteors near players, 30 dmg each' },
        ],
      },
      {
        hpThreshold: 0.4,
        abilities: [
          { id: 'fire_trail', cooldown: 0, desc: 'Doubled fire trail damage' },
          { id: 'meteor_rain', cooldown: 8, desc: 'Faster meteor rain' },
          { id: 'inferno_burst', cooldown: 12, desc: '360-deg fire wave, 40 dmg' },
        ],
        bannerText: 'THE INFERNAL ENRAGED!',
      },
    ],
    loot: {
      cardPool: 'rare+',
      cardCount: 1,
      bonusResources: { wood: 50, stone: 50, iron: 50, diamond: 50, gold: 50, food: 50 },
      bonusDrop: { type: 'resource', resource: 'diamond', amount: 20 },
    },
    description: 'A blazing demon that leaves fire in its wake.',
  },

  {
    id: 'frost_warden',
    name: 'The Frost Warden',
    minWave: 18,
    hp: 4000,
    speed: 50,
    damage: 35,
    range: 55,
    knockback: 250,
    cooldown: 1.3,
    radius: 30,
    ai: 'pursuer',
    phases: [
      {
        hpThreshold: 1.0,
        abilities: [
          { id: 'frost_aura', cooldown: 0, desc: 'Players within 200px slowed 20%' },
          { id: 'ice_spike', cooldown: 12, desc: 'Targets a player, 2s delay, 50 dmg + stun' },
        ],
      },
      {
        hpThreshold: 0.5,
        abilities: [
          { id: 'frost_aura', cooldown: 0, desc: 'Aura slow increased to 40%' },
          { id: 'ice_spike', cooldown: 8, desc: 'Faster ice spikes' },
          { id: 'blizzard', cooldown: 20, desc: '8s channel, 250px, 4 dps + 50% slow' },
        ],
        bannerText: 'THE FROST WARDEN ENRAGED!',
      },
    ],
    loot: {
      cardPool: 'rare+',
      cardCount: 1,
      bonusDrop: { type: 'resource', resource: 'gold', amount: 40 },
      onKillEffect: 'speed_buff',
    },
    description: 'An ancient ice guardian that freezes everything around it.',
  },

  {
    id: 'plague_bearer',
    name: 'The Plague Bearer',
    minWave: 20,
    hp: 3000,
    speed: 70,
    damage: 30,
    range: 45,
    knockback: 200,
    cooldown: 1.0,
    radius: 28,
    ai: 'aggressive',
    phases: [
      {
        hpThreshold: 1.0,
        abilities: [
          { id: 'plague_aura', cooldown: 0, desc: 'Enemies within 80px of boss take no damage' },
          { id: 'plague_spit', cooldown: 8, desc: 'Ranged projectile, 20 dmg + plague stacks' },
        ],
      },
      {
        hpThreshold: 0.5,
        abilities: [
          { id: 'plague_aura', cooldown: 0, desc: 'Plague max stacks increase to 5' },
          { id: 'plague_spit', cooldown: 6, desc: 'Faster plague spit' },
          { id: 'pandemic', cooldown: 15, desc: 'Plagued players spread to allies within 100px' },
        ],
        bannerText: 'THE PLAGUE BEARER ENRAGED!',
      },
    ],
    loot: {
      cardPool: 'rare+',
      cardCount: 1,
      onKillEffect: 'cleanse_all',
    },
    description: 'A diseased monstrosity that poisons everything it touches.',
  },

  {
    id: 'ancient_golem',
    name: 'The Ancient Golem',
    minWave: 25,
    hp: 8000,
    speed: 30,
    damage: 80,
    range: 60,
    knockback: 500,
    cooldown: 1.5,
    radius: 45,
    ai: 'campfire',
    phases: [
      {
        hpThreshold: 1.0,
        damageTaken: 0.5,
        abilities: [
          { id: 'earthquake_stomp', cooldown: 8, desc: '150px AOE, 50 dmg + knockback' },
        ],
      },
      {
        hpThreshold: 0.66,
        speed: 50,
        damageTaken: 1.0,
        abilities: [
          { id: 'earthquake_stomp', cooldown: 6, desc: 'Faster stomps' },
          { id: 'rock_throw', cooldown: 6, desc: 'Boulder at farthest player, 60 dmg, 80px AOE' },
        ],
        bannerText: 'THE GOLEM SHEDS ITS ARMOR!',
      },
      {
        hpThreshold: 0.33,
        speed: 80,
        abilities: [
          { id: 'earthquake_stomp', cooldown: 4, desc: 'Rapid stomps' },
          { id: 'rock_throw', cooldown: 4, desc: 'Rapid boulder throws' },
          { id: 'shatter', cooldown: 0, desc: 'On hit, shoots 4 rock shards' },
        ],
        bannerText: 'THE GOLEM GOES BERSERK!',
      },
    ],
    loot: {
      cardPool: 'legendary',
      cardCount: 1,
      bonusResources: { wood: 100, stone: 100, iron: 100, diamond: 100, gold: 100, food: 100 },
    },
    description: 'An unstoppable colossus from a forgotten age.',
  },
];

// ── Lookup helpers ────────────────────────────────────────────────────────────

export const BOSS_MAP: Record<string, BossDefinition> = {};
for (const def of BOSS_DEFINITIONS) BOSS_MAP[def.id] = def;

/**
 * Pick a boss for the given wave from the eligible pool.
 * Ancient Golem has a 20% chance to replace a normal boss on W25+.
 */
export function getBossForWave(wave: number): BossDefinition | null {
  const eligible = BOSS_DEFINITIONS.filter(b => wave >= b.minWave);
  if (eligible.length === 0) return null;

  // Ancient Golem is rare - only 20% chance when eligible
  if (wave >= 25 && Math.random() < 0.2) {
    return BOSS_MAP['ancient_golem'];
  }

  // Filter out ancient golem from normal pool
  const normalPool = eligible.filter(b => b.id !== 'ancient_golem');
  if (normalPool.length === 0) return eligible[Math.floor(Math.random() * eligible.length)];
  return normalPool[Math.floor(Math.random() * normalPool.length)];
}

/**
 * Check if a wave is a boss wave.
 * W30+ can spawn double bosses.
 */
export function getBossCountForWave(wave: number, bossInterval: number, firstBossWave: number): number {
  if (wave < firstBossWave) return 0;
  if (wave % bossInterval !== 0) return 0;
  if (wave >= 30) return 2;
  return 1;
}

/**
 * Get the current phase index for a boss based on its HP fraction.
 */
export function getBossPhaseIndex(def: BossDefinition, hpFraction: number): number {
  // Phases are ordered from high HP to low HP threshold
  for (let i = def.phases.length - 1; i >= 0; i--) {
    if (hpFraction <= def.phases[i].hpThreshold) return i;
  }
  return 0;
}
