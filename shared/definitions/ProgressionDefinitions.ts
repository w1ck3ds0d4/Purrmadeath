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

export const ACHIEVEMENTS: Achievement[] = [];

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
export function computeCompletedBuffs(_stats: MetaStats): CompletedBuff[] {
  return [];
}
