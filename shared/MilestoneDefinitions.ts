import type { MetaStats } from './MetaStats';

export interface ClassMilestone {
  classId: string;
  displayName: string;
  description: string;
  check: (stats: MetaStats) => boolean;
}

export const CLASS_MILESTONES: ClassMilestone[] = [
  {
    classId: 'assassin',
    displayName: 'Assassin',
    description: 'Kill 500 enemies',
    check: (s) => s.totalEnemiesKilled >= 500,
  },
  {
    classId: 'paladin',
    displayName: 'Paladin',
    description: 'Build 50 buildings',
    check: (s) => s.totalBuildingsBuilt >= 50,
  },
  {
    classId: 'necromancer',
    displayName: 'Necromancer',
    description: 'Survive to wave 15',
    check: (s) => (s.highestWaveSurvived ?? 0) >= 15,
  },
  {
    classId: 'beastmaster',
    displayName: 'Beastmaster',
    description: 'Gather 2000 resources',
    check: (s) => {
      const r = s.resourcesGathered;
      return (r.wood + r.stone + r.iron + r.diamond) >= 2000;
    },
  },
];

/** Compute which advanced classes a player has unlocked based on their lifetime stats. */
export function computeUnlockedClasses(stats: MetaStats): string[] {
  return CLASS_MILESTONES.filter(m => m.check(stats)).map(m => m.classId);
}
