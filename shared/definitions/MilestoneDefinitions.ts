import type { MetaStats } from './MetaStats';

export interface ClassMilestone {
  classId: string;
  displayName: string;
  description: string;
  check: (stats: MetaStats) => boolean;
}

export const CLASS_MILESTONES: ClassMilestone[] = [];

/** Compute which advanced classes a player has unlocked based on their lifetime stats. */
export function computeUnlockedClasses(_stats: MetaStats): string[] {
  return [];
}
