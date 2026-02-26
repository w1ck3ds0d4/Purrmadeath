import type { MetaStats } from './MetaStats';

export type AchievementCategory = 'class' | 'buff' | 'building' | 'ability';

export interface Achievement {
  id: string;
  category: AchievementCategory;
  displayName: string;
  description: string;
  /** Short label for what the player earns. */
  reward: string;
  /** Target value to complete the achievement. */
  target: number;
  /** Returns the player's current progress toward `target`. */
  progress: (stats: MetaStats) => number;
}

export const ACHIEVEMENTS: Achievement[] = [
  // ── Classes ──────────────────────────────────────────────────────────────
  {
    id: 'unlock_assassin',
    category: 'class',
    displayName: 'Assassin',
    description: 'Kill 500 enemies',
    reward: 'Unlock Assassin class',
    target: 500,
    progress: (s) => s.totalEnemiesKilled,
  },
  {
    id: 'unlock_paladin',
    category: 'class',
    displayName: 'Paladin',
    description: 'Build 50 buildings',
    reward: 'Unlock Paladin class',
    target: 50,
    progress: (s) => s.totalBuildingsBuilt,
  },
  {
    id: 'unlock_necromancer',
    category: 'class',
    displayName: 'Necromancer',
    description: 'Survive to wave 15',
    reward: 'Unlock Necromancer class',
    target: 15,
    progress: (s) => s.highestWaveSurvived,
  },
  {
    id: 'unlock_beastmaster',
    category: 'class',
    displayName: 'Beastmaster',
    description: 'Gather 2,000 resources',
    reward: 'Unlock Beastmaster class',
    target: 2000,
    progress: (s) => {
      const r = s.resourcesGathered;
      return r.wood + r.stone + r.iron + r.diamond;
    },
  },

  // ── Permanent Buffs ──────────────────────────────────────────────────────
  {
    id: 'buff_veteran',
    category: 'buff',
    displayName: 'Veteran',
    description: 'Complete 10 runs',
    reward: '+5 Max HP',
    target: 10,
    progress: (s) => s.totalRuns,
  },
  {
    id: 'buff_iron_hide',
    category: 'buff',
    displayName: 'Iron Hide',
    description: 'Deal 25,000 total damage',
    reward: '+1 Defense',
    target: 25000,
    progress: (s) => s.totalDamageDealt,
  },
  {
    id: 'buff_fleet_footed',
    category: 'buff',
    displayName: 'Fleet Footed',
    description: 'Survive 50 total waves',
    reward: '+5% Speed',
    target: 50,
    progress: (s) => s.totalWavesSurvived,
  },
  {
    id: 'buff_sharp_claws',
    category: 'buff',
    displayName: 'Sharp Claws',
    description: 'Kill 1,000 enemies',
    reward: '+5% Crit Chance',
    target: 1000,
    progress: (s) => s.totalEnemiesKilled,
  },
  {
    id: 'buff_endurance',
    category: 'buff',
    displayName: 'Endurance',
    description: 'Play for 2 hours total',
    reward: '+10 Max Stamina',
    target: 7200,
    progress: (s) => s.totalTimePlayed,
  },

  // ── Buildings ────────────────────────────────────────────────────────────
  {
    id: 'building_ballista',
    category: 'building',
    displayName: 'Ballista Plans',
    description: 'Kill 200 enemies',
    reward: 'Unlock Ballista turret',
    target: 200,
    progress: (s) => s.totalEnemiesKilled,
  },
  {
    id: 'building_workshop',
    category: 'building',
    displayName: 'Workshop Blueprint',
    description: 'Build 75 buildings',
    reward: 'Unlock Workshop',
    target: 75,
    progress: (s) => s.totalBuildingsBuilt,
  },
  {
    id: 'building_fortress',
    category: 'building',
    displayName: 'Fortress Design',
    description: 'Survive to wave 20',
    reward: 'Unlock Fortress Wall',
    target: 20,
    progress: (s) => s.highestWaveSurvived,
  },

  // ── Abilities ────────────────────────────────────────────────────────────
  {
    id: 'ability_war_cry',
    category: 'ability',
    displayName: 'Battle Cry',
    description: 'Survive 25 total waves',
    reward: 'Unlock War Cry ability',
    target: 25,
    progress: (s) => s.totalWavesSurvived,
  },
  {
    id: 'ability_lifesteal',
    category: 'ability',
    displayName: 'Life Drain',
    description: 'Deal 50,000 total damage',
    reward: 'Unlock Lifesteal ability',
    target: 50000,
    progress: (s) => s.totalDamageDealt,
  },
  {
    id: 'ability_tracking',
    category: 'ability',
    displayName: 'Eagle Eye',
    description: 'Complete 15 runs',
    reward: 'Unlock Tracking ability',
    target: 15,
    progress: (s) => s.totalRuns,
  },
];

export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  class: 'Classes',
  buff: 'Permanent Buffs',
  building: 'Buildings',
  ability: 'Abilities',
};

export const CATEGORY_ORDER: AchievementCategory[] = ['class', 'buff', 'building', 'ability'];
