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
  // ── Stat Buff Achievements (10) - permanent player bonuses ────────────────
  { id: 'first_blood', category: 'buff', displayName: 'First Blood', description: 'Kill 10 enemies',
    reward: '+5 Max HP', medalColor: BRONZE, target: 10,
    progress: (s) => s.totalEnemiesKilled },
  { id: 'veteran', category: 'buff', displayName: 'Veteran', description: 'Kill 500 enemies',
    reward: '+10 Max HP', medalColor: SILVER, target: 500,
    progress: (s) => s.totalEnemiesKilled },
  { id: 'slayer', category: 'buff', displayName: 'Slayer', description: 'Kill 2000 enemies',
    reward: '+15 Max HP', medalColor: GOLD, target: 2000,
    progress: (s) => s.totalEnemiesKilled },
  { id: 'gatherer', category: 'buff', displayName: 'Gatherer', description: 'Gather 1000 total resources',
    reward: '+10% Gather Speed', medalColor: BRONZE, target: 1000,
    progress: (s) => s.resourcesGathered.wood + s.resourcesGathered.stone + s.resourcesGathered.iron + s.resourcesGathered.diamond },
  { id: 'architect', category: 'buff', displayName: 'Architect', description: 'Build 50 buildings',
    reward: '+5 Max HP', medalColor: SILVER, target: 50,
    progress: (s) => s.totalBuildingsBuilt },
  { id: 'survivor', category: 'buff', displayName: 'Survivor', description: 'Survive to wave 10',
    reward: '+10 Max Stamina', medalColor: BRONZE, target: 10,
    progress: (s) => s.highestWaveSurvived },
  { id: 'enduring', category: 'buff', displayName: 'Enduring', description: 'Survive to wave 20',
    reward: '+3 Defense', medalColor: GOLD, target: 20,
    progress: (s) => s.highestWaveSurvived },
  { id: 'ironclad', category: 'buff', displayName: 'Ironclad', description: 'Take 5000 total damage across all runs',
    reward: '+10 Max HP', medalColor: SILVER, target: 5000,
    progress: (s) => s.totalDamageTaken ?? 0 },
  { id: 'speed_demon', category: 'buff', displayName: 'Speed Demon', description: 'Play for 1 hour total',
    reward: '+5% Speed', medalColor: BRONZE, target: 3600,
    progress: (s) => s.totalTimePlayed },
  { id: 'critical_eye', category: 'buff', displayName: 'Critical Eye', description: 'Land 100 critical hits',
    reward: '+5% Crit Chance', medalColor: SILVER, target: 100,
    progress: (s) => s.totalCriticalHits ?? 0 },

  // ── Building Unlock Achievements (4) - unlock new buildings via meta progress ──
  { id: 'artillery_expert', category: 'building', displayName: 'Artillery Expert', description: 'Kill 200 enemies with turrets',
    reward: 'Unlock Flak Cannon', medalColor: GOLD, target: 200,
    progress: (s) => s.totalTurretKills ?? 0 },
  { id: 'dragon_tamer', category: 'building', displayName: 'Dragon Tamer', description: 'Survive to wave 50',
    reward: 'Unlock Dragon Roost', medalColor: GOLD, target: 50,
    progress: (s) => s.highestWaveSurvived },
  { id: 'master_smith', category: 'building', displayName: 'Master Smith', description: 'Gather 100 iron total',
    reward: 'Unlock Smeltery', medalColor: GOLD, target: 100,
    progress: (s) => s.resourcesGathered.iron },
  { id: 'trade_baron', category: 'building', displayName: 'Trade Baron', description: 'Have 10 civilians total',
    reward: 'Unlock Market', medalColor: GOLD, target: 10,
    progress: (s) => s.totalCiviliansSpawned ?? 0 },
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

/** Map from building achievement ID to the building type it unlocks. */
const BUILDING_UNLOCK_MAP: Record<string, string> = {
  artillery_expert: 'flak_cannon',
  dragon_tamer: 'dragon_roost',
  master_smith: 'smeltery',
  trade_baron: 'market',
};

/** Compute which buildings a player has unlocked via achievements. */
export function computeUnlockedBuildings(stats: MetaStats): string[] {
  return ACHIEVEMENTS
    .filter(a => a.category === 'building' && a.progress(stats) >= a.target)
    .map(a => BUILDING_UNLOCK_MAP[a.id])
    .filter((b): b is string => b != null);
}
