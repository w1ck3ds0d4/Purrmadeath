/** Persistent per-player statistics tracked across all runs. */
export interface MetaStats {
  totalDamageDealt: number;
  resourcesGathered: { wood: number; stone: number; iron: number; diamond: number };
  totalEnemiesKilled: number;
  killsByType: Record<string, number>;
  totalWavesSurvived: number;
  totalTimePlayed: number;
  totalBuildingsBuilt: number;
  totalRuns: number;
}

/** Create a blank MetaStats object with all counters at 0. */
export function emptyMetaStats(): MetaStats {
  return {
    totalDamageDealt: 0,
    resourcesGathered: { wood: 0, stone: 0, iron: 0, diamond: 0 },
    totalEnemiesKilled: 0,
    killsByType: {},
    totalWavesSurvived: 0,
    totalTimePlayed: 0,
    totalBuildingsBuilt: 0,
    totalRuns: 0,
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
  meta.totalTimePlayed += run.timePlayed;
  meta.totalBuildingsBuilt += run.buildingsBuilt;
  meta.totalRuns++;
}
