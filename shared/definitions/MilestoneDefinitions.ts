import type { MetaStats } from './MetaStats';

export interface ClassMilestone {
  classId: string;
  displayName: string;
  description: string;
  check: (stats: MetaStats) => boolean;
}

export const CLASS_MILESTONES: ClassMilestone[] = [
  // Warrior placeholder subclasses
  { classId: 'templar', displayName: "Templar's Path",
    description: 'Survive to wave 15 as a warrior',
    check: (s) => s.highestWaveSurvived >= 15 },
  { classId: 'slayer', displayName: "Slayer's Path",
    description: 'Kill 1000 enemies as a warrior',
    check: (s) => s.totalEnemiesKilled >= 1000 },
  // Ranger placeholder subclasses
  { classId: 'shadow_hunter', displayName: "Shadow Hunter's Path",
    description: 'Survive to wave 10 as a ranger',
    check: (s) => s.highestWaveSurvived >= 10 },
  { classId: 'windwalker', displayName: "Windwalker's Path",
    description: 'Survive to wave 10 as a ranger',
    check: (s) => s.highestWaveSurvived >= 10 },
];

/** Compute which advanced classes a player has unlocked based on their lifetime stats. */
export function computeUnlockedClasses(stats: MetaStats): string[] {
  return CLASS_MILESTONES.filter(m => m.check(stats)).map(m => m.classId);
}
