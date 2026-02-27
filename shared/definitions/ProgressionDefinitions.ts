import type { MetaStats } from './MetaStats';

export type AchievementCategory = 'class' | 'buff' | 'building';

export interface Achievement {
  id: string;
  category: AchievementCategory;
  displayName: string;
  description: string;
  /** Short label for what the player earns. */
  reward: string;
  /** CSS hex color for the medal circle when completed. */
  medalColor: string;
  /** Target value to complete the achievement. */
  target: number;
  /** Returns the player's current progress toward `target`. */
  progress: (stats: MetaStats) => number;
}

// Tier colors: diamond > gold > silver > bronze
const DIAMOND = '#b9f2ff';
const GOLD    = '#ffd700';
const SILVER  = '#c0c0c0';
const BRONZE  = '#cd7f32';

export const ACHIEVEMENTS: Achievement[] = [
  // ── Classes (ordered diamond → bronze) ────────────────────────────────────
  {
    id: 'unlock_beastmaster',
    category: 'class',
    displayName: 'Beastmaster',
    description: 'Gather 5,000 resources',
    reward: 'Unlock Beastmaster class',
    medalColor: DIAMOND,
    target: 5000,
    progress: (s) => {
      const r = s.resourcesGathered;
      return r.wood + r.stone + r.iron + r.diamond;
    },
  },
  {
    id: 'unlock_assassin',
    category: 'class',
    displayName: 'Assassin',
    description: 'Kill 500 enemies',
    reward: 'Unlock Assassin class',
    medalColor: GOLD,
    target: 500,
    progress: (s) => s.totalEnemiesKilled,
  },
  {
    id: 'unlock_necromancer',
    category: 'class',
    displayName: 'Necromancer',
    description: 'Survive to wave 15',
    reward: 'Unlock Necromancer class',
    medalColor: SILVER,
    target: 15,
    progress: (s) => s.highestWaveSurvived,
  },
  {
    id: 'unlock_paladin',
    category: 'class',
    displayName: 'Paladin',
    description: 'Build 30 buildings',
    reward: 'Unlock Paladin class',
    medalColor: BRONZE,
    target: 30,
    progress: (s) => s.totalBuildingsBuilt,
  },

  // ── Permanent Buffs (ordered diamond → bronze) ────────────────────────────
  {
    id: 'buff_iron_hide',
    category: 'buff',
    displayName: 'Iron Hide',
    description: 'Deal 50,000 total damage',
    reward: '+1 Defense',
    medalColor: DIAMOND,
    target: 50000,
    progress: (s) => s.totalDamageDealt,
  },
  {
    id: 'buff_thick_fur',
    category: 'buff',
    displayName: 'Thick Fur',
    description: 'Survive 200 total waves',
    reward: '+2 Defense',
    medalColor: DIAMOND,
    target: 200,
    progress: (s) => s.totalWavesSurvived,
  },
  {
    id: 'buff_sharp_claws',
    category: 'buff',
    displayName: 'Sharp Claws',
    description: 'Kill 1,000 enemies',
    reward: '+5% Crit Chance',
    medalColor: GOLD,
    target: 1000,
    progress: (s) => s.totalEnemiesKilled,
  },
  {
    id: 'buff_nine_lives',
    category: 'buff',
    displayName: 'Nine Lives',
    description: 'Complete 50 runs',
    reward: '+10 Max HP',
    medalColor: GOLD,
    target: 50,
    progress: (s) => s.totalRuns,
  },
  {
    id: 'buff_fleet_footed',
    category: 'buff',
    displayName: 'Fleet Footed',
    description: 'Survive 50 total waves',
    reward: '+5% Speed',
    medalColor: SILVER,
    target: 50,
    progress: (s) => s.totalWavesSurvived,
  },
  {
    id: 'buff_endurance',
    category: 'buff',
    displayName: 'Endurance',
    description: 'Play for 2 hours total',
    reward: '+10 Max Stamina',
    medalColor: SILVER,
    target: 7200,
    progress: (s) => s.totalTimePlayed,
  },
  {
    id: 'buff_veteran',
    category: 'buff',
    displayName: 'Veteran',
    description: 'Complete 10 runs',
    reward: '+5 Max HP',
    medalColor: BRONZE,
    target: 10,
    progress: (s) => s.totalRuns,
  },
  {
    id: 'buff_gatherer',
    category: 'buff',
    displayName: 'Gatherer',
    description: 'Gather 500 resources',
    reward: '+10% Gather Speed',
    medalColor: BRONZE,
    target: 500,
    progress: (s) => {
      const r = s.resourcesGathered;
      return r.wood + r.stone + r.iron + r.diamond;
    },
  },

  // ── Buildings (ordered diamond → bronze) ──────────────────────────────────
  {
    id: 'building_fortress',
    category: 'building',
    displayName: 'Fortress Design',
    description: 'Survive to wave 20',
    reward: 'Unlock Fortress Wall',
    medalColor: DIAMOND,
    target: 20,
    progress: (s) => s.highestWaveSurvived,
  },
  {
    id: 'building_healing_shrine',
    category: 'building',
    displayName: 'Sacred Shrine',
    description: 'Play for 5 hours total',
    reward: 'Unlock Healing Shrine',
    medalColor: DIAMOND,
    target: 18000,
    progress: (s) => s.totalTimePlayed,
  },
  {
    id: 'building_workshop',
    category: 'building',
    displayName: 'Workshop Blueprint',
    description: 'Build 75 buildings',
    reward: 'Unlock Workshop',
    medalColor: GOLD,
    target: 75,
    progress: (s) => s.totalBuildingsBuilt,
  },
  {
    id: 'building_cannon',
    category: 'building',
    displayName: 'Cannon Schematic',
    description: 'Kill 750 enemies',
    reward: 'Unlock Cannon turret',
    medalColor: GOLD,
    target: 750,
    progress: (s) => s.totalEnemiesKilled,
  },
  {
    id: 'building_light_tower',
    category: 'building',
    displayName: 'Light Tower',
    description: 'Gather 1,500 stone',
    reward: 'Unlock Light Tower',
    medalColor: SILVER,
    target: 1500,
    progress: (s) => s.resourcesGathered.stone,
  },
  {
    id: 'building_ballista',
    category: 'building',
    displayName: 'Ballista Plans',
    description: 'Kill 200 enemies',
    reward: 'Unlock Ballista turret',
    medalColor: BRONZE,
    target: 200,
    progress: (s) => s.totalEnemiesKilled,
  },
  {
    id: 'building_spike_trap',
    category: 'building',
    displayName: 'Spike Trap',
    description: 'Build 15 buildings',
    reward: 'Unlock Spike Trap',
    medalColor: BRONZE,
    target: 15,
    progress: (s) => s.totalBuildingsBuilt,
  },

];

export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  class: 'Classes',
  buff: 'Permanent Buffs',
  building: 'Buildings',
};

export const CATEGORY_ORDER: AchievementCategory[] = ['class', 'buff', 'building'];

/** Buff achievement info sent to clients for in-game display. */
export interface CompletedBuff {
  displayName: string;
  reward: string;
  medalColor: string;
}

/** Compute which buff achievements a player has completed. */
export function computeCompletedBuffs(stats: MetaStats): CompletedBuff[] {
  return ACHIEVEMENTS
    .filter(a => a.category === 'buff' && a.progress(stats) >= a.target)
    .map(a => ({ displayName: a.displayName, reward: a.reward, medalColor: a.medalColor }));
}
