/** Persistent per-player statistics tracked across all runs. */
export interface MetaStats {
  totalDamageDealt: number;
  resourcesGathered: { wood: number; stone: number; iron: number; diamond: number };
  totalEnemiesKilled: number;
  killsByType: Record<string, number>;
  totalWavesSurvived: number;
  highestWaveSurvived: number;
  totalTimePlayed: number;
  totalBuildingsBuilt: number;
  totalRuns: number;
  unlockedClasses: string[];
  // Achievement tracking fields
  totalDamageTaken?: number;
  totalCriticalHits?: number;
  totalPortalsDestroyed?: number;
  totalWolvesSummoned?: number;
  totalAbilitiesUsed?: number;
  totalWallsBuilt?: number;
}

/** Create a blank MetaStats object with all counters at 0. */
export function emptyMetaStats(): MetaStats {
  return {
    totalDamageDealt: 0,
    resourcesGathered: { wood: 0, stone: 0, iron: 0, diamond: 0 },
    totalEnemiesKilled: 0,
    killsByType: {},
    totalWavesSurvived: 0,
    highestWaveSurvived: 0,
    totalTimePlayed: 0,
    totalBuildingsBuilt: 0,
    totalRuns: 0,
    unlockedClasses: [],
    totalDamageTaken: 0,
    totalCriticalHits: 0,
    totalPortalsDestroyed: 0,
    totalWolvesSummoned: 0,
    totalAbilitiesUsed: 0,
    totalWallsBuilt: 0,
  };
}

/** Per-run stats delta that gets merged into MetaStats at run end. */
export interface RunStats {
  damageDealt: number;
  resourcesGathered: { wood: number; stone: number; iron: number; diamond: number };
  enemiesKilled: number;
  killsByType: Record<string, number>;
  wavesSurvived: number;
  timePlayed: number;
  buildingsBuilt: number;
  // Achievement tracking
  damageTaken: number;
  criticalHits: number;
  portalsDestroyed: number;
  wolvesSummoned: number;
  abilitiesUsed: number;
  wallsBuilt: number;
}

/**
 * Merge two MetaStats objects together (e.g. syncing local singleplayer stats
 * with remote server stats). Uses max for cumulative counters to avoid
 * double-counting, and union for unlocked classes.
 */
export function mergeMetaStats(target: MetaStats, source: MetaStats): void {
  target.totalDamageDealt = Math.max(target.totalDamageDealt, source.totalDamageDealt);
  target.resourcesGathered.wood = Math.max(target.resourcesGathered.wood, source.resourcesGathered.wood);
  target.resourcesGathered.stone = Math.max(target.resourcesGathered.stone, source.resourcesGathered.stone);
  target.resourcesGathered.iron = Math.max(target.resourcesGathered.iron, source.resourcesGathered.iron);
  target.resourcesGathered.diamond = Math.max(target.resourcesGathered.diamond, source.resourcesGathered.diamond);
  target.totalEnemiesKilled = Math.max(target.totalEnemiesKilled, source.totalEnemiesKilled);
  for (const [type, count] of Object.entries(source.killsByType)) {
    target.killsByType[type] = Math.max(target.killsByType[type] ?? 0, count);
  }
  target.totalWavesSurvived = Math.max(target.totalWavesSurvived, source.totalWavesSurvived);
  target.highestWaveSurvived = Math.max(target.highestWaveSurvived, source.highestWaveSurvived);
  target.totalTimePlayed = Math.max(target.totalTimePlayed, source.totalTimePlayed);
  target.totalBuildingsBuilt = Math.max(target.totalBuildingsBuilt, source.totalBuildingsBuilt);
  target.totalRuns = Math.max(target.totalRuns, source.totalRuns);
  // Union unlocked classes
  const allClasses = new Set([...target.unlockedClasses, ...source.unlockedClasses]);
  target.unlockedClasses = [...allClasses];
  // Achievement tracking
  target.totalDamageTaken = Math.max(target.totalDamageTaken ?? 0, source.totalDamageTaken ?? 0);
  target.totalCriticalHits = Math.max(target.totalCriticalHits ?? 0, source.totalCriticalHits ?? 0);
  target.totalPortalsDestroyed = Math.max(target.totalPortalsDestroyed ?? 0, source.totalPortalsDestroyed ?? 0);
  target.totalWolvesSummoned = Math.max(target.totalWolvesSummoned ?? 0, source.totalWolvesSummoned ?? 0);
  target.totalAbilitiesUsed = Math.max(target.totalAbilitiesUsed ?? 0, source.totalAbilitiesUsed ?? 0);
  target.totalWallsBuilt = Math.max(target.totalWallsBuilt ?? 0, source.totalWallsBuilt ?? 0);
}

/** Merge a single run's stats into the persistent MetaStats. */
export function mergeRunStats(meta: MetaStats, run: RunStats): void {
  meta.totalDamageDealt += run.damageDealt;
  meta.resourcesGathered.wood += run.resourcesGathered.wood;
  meta.resourcesGathered.stone += run.resourcesGathered.stone;
  meta.resourcesGathered.iron += run.resourcesGathered.iron;
  meta.resourcesGathered.diamond += run.resourcesGathered.diamond;
  meta.totalEnemiesKilled += run.enemiesKilled;
  for (const [type, count] of Object.entries(run.killsByType)) {
    meta.killsByType[type] = (meta.killsByType[type] ?? 0) + count;
  }
  meta.totalWavesSurvived += run.wavesSurvived;
  meta.highestWaveSurvived = Math.max(meta.highestWaveSurvived ?? 0, run.wavesSurvived);
  meta.totalTimePlayed += run.timePlayed;
  meta.totalBuildingsBuilt += run.buildingsBuilt;
  meta.totalRuns++;
  // Achievement tracking
  meta.totalDamageTaken = (meta.totalDamageTaken ?? 0) + run.damageTaken;
  meta.totalCriticalHits = (meta.totalCriticalHits ?? 0) + run.criticalHits;
  meta.totalPortalsDestroyed = (meta.totalPortalsDestroyed ?? 0) + run.portalsDestroyed;
  meta.totalWolvesSummoned = (meta.totalWolvesSummoned ?? 0) + run.wolvesSummoned;
  meta.totalAbilitiesUsed = (meta.totalAbilitiesUsed ?? 0) + run.abilitiesUsed;
  meta.totalWallsBuilt = (meta.totalWallsBuilt ?? 0) + run.wallsBuilt;
}
