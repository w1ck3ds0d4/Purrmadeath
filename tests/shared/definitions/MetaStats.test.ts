import { describe, it, expect } from 'vitest';
import { emptyMetaStats, mergeRunStats, type RunStats, type MetaStats } from '../../../shared/definitions/MetaStats';

function makeRun(overrides?: Partial<RunStats>): RunStats {
  return {
    damageDealt: 0,
    resourcesGathered: { wood: 0, stone: 0, iron: 0, diamond: 0 },
    enemiesKilled: 0,
    killsByType: {},
    wavesSurvived: 0,
    timePlayed: 0,
    buildingsBuilt: 0,
    ...overrides,
  };
}

describe('emptyMetaStats', () => {
  it('returns all zeroed counters', () => {
    const m = emptyMetaStats();
    expect(m.totalDamageDealt).toBe(0);
    expect(m.totalEnemiesKilled).toBe(0);
    expect(m.totalWavesSurvived).toBe(0);
    expect(m.highestWaveSurvived).toBe(0);
    expect(m.totalTimePlayed).toBe(0);
    expect(m.totalBuildingsBuilt).toBe(0);
    expect(m.totalRuns).toBe(0);
    expect(m.resourcesGathered.wood).toBe(0);
    expect(m.resourcesGathered.stone).toBe(0);
    expect(m.resourcesGathered.iron).toBe(0);
    expect(m.resourcesGathered.diamond).toBe(0);
    expect(Object.keys(m.killsByType)).toHaveLength(0);
    expect(m.unlockedClasses).toHaveLength(0);
  });
});

describe('mergeRunStats', () => {
  it('accumulates damage dealt', () => {
    const meta = emptyMetaStats();
    mergeRunStats(meta, makeRun({ damageDealt: 500 }));
    expect(meta.totalDamageDealt).toBe(500);
    mergeRunStats(meta, makeRun({ damageDealt: 300 }));
    expect(meta.totalDamageDealt).toBe(800);
  });

  it('accumulates resources per type', () => {
    const meta = emptyMetaStats();
    mergeRunStats(meta, makeRun({
      resourcesGathered: { wood: 10, stone: 20, iron: 5, diamond: 1 },
    }));
    mergeRunStats(meta, makeRun({
      resourcesGathered: { wood: 5, stone: 0, iron: 3, diamond: 2 },
    }));
    expect(meta.resourcesGathered.wood).toBe(15);
    expect(meta.resourcesGathered.stone).toBe(20);
    expect(meta.resourcesGathered.iron).toBe(8);
    expect(meta.resourcesGathered.diamond).toBe(3);
  });

  it('accumulates enemies killed', () => {
    const meta = emptyMetaStats();
    mergeRunStats(meta, makeRun({ enemiesKilled: 50 }));
    mergeRunStats(meta, makeRun({ enemiesKilled: 30 }));
    expect(meta.totalEnemiesKilled).toBe(80);
  });

  it('merges killsByType across runs', () => {
    const meta = emptyMetaStats();
    mergeRunStats(meta, makeRun({ killsByType: { melee: 10, ranger: 5 } }));
    mergeRunStats(meta, makeRun({ killsByType: { melee: 3, ghost: 2 } }));
    expect(meta.killsByType.melee).toBe(13);
    expect(meta.killsByType.ranger).toBe(5);
    expect(meta.killsByType.ghost).toBe(2);
  });

  it('accumulates total waves survived', () => {
    const meta = emptyMetaStats();
    mergeRunStats(meta, makeRun({ wavesSurvived: 5 }));
    mergeRunStats(meta, makeRun({ wavesSurvived: 10 }));
    expect(meta.totalWavesSurvived).toBe(15);
  });

  it('tracks highest wave survived with Math.max', () => {
    const meta = emptyMetaStats();
    mergeRunStats(meta, makeRun({ wavesSurvived: 5 }));
    expect(meta.highestWaveSurvived).toBe(5);

    mergeRunStats(meta, makeRun({ wavesSurvived: 3 }));
    expect(meta.highestWaveSurvived).toBe(5); // should NOT decrease

    mergeRunStats(meta, makeRun({ wavesSurvived: 10 }));
    expect(meta.highestWaveSurvived).toBe(10);
  });

  it('accumulates time played', () => {
    const meta = emptyMetaStats();
    mergeRunStats(meta, makeRun({ timePlayed: 300 }));
    mergeRunStats(meta, makeRun({ timePlayed: 500 }));
    expect(meta.totalTimePlayed).toBe(800);
  });

  it('increments total runs', () => {
    const meta = emptyMetaStats();
    mergeRunStats(meta, makeRun());
    mergeRunStats(meta, makeRun());
    mergeRunStats(meta, makeRun());
    expect(meta.totalRuns).toBe(3);
  });

  it('accumulates buildings built', () => {
    const meta = emptyMetaStats();
    mergeRunStats(meta, makeRun({ buildingsBuilt: 12 }));
    mergeRunStats(meta, makeRun({ buildingsBuilt: 8 }));
    expect(meta.totalBuildingsBuilt).toBe(20);
  });

  it('handles zero-value run correctly', () => {
    const meta = emptyMetaStats();
    mergeRunStats(meta, makeRun());
    expect(meta.totalRuns).toBe(1);
    expect(meta.totalDamageDealt).toBe(0);
    expect(meta.highestWaveSurvived).toBe(0);
  });
});
