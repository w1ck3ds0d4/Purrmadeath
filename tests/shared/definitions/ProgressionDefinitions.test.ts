import { describe, it, expect } from 'vitest';
import { ACHIEVEMENTS, type Achievement } from '../../../shared/definitions/ProgressionDefinitions';
import { emptyMetaStats } from '../../../shared/definitions/MetaStats';

describe('ProgressionDefinitions', () => {
  it('has at least 10 achievements', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(10);
  });

  it('all achievement IDs are unique', () => {
    const ids = ACHIEVEMENTS.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all achievements have required fields', () => {
    for (const ach of ACHIEVEMENTS) {
      expect(ach.id.length).toBeGreaterThan(0);
      expect(['class', 'buff', 'building']).toContain(ach.category);
      expect(ach.displayName.length).toBeGreaterThan(0);
      expect(ach.description.length).toBeGreaterThan(0);
      expect(ach.reward.length).toBeGreaterThan(0);
      expect(ach.medalColor.length).toBeGreaterThan(0);
      expect(ach.target).toBeGreaterThan(0);
      expect(typeof ach.progress).toBe('function');
    }
  });

  it('has achievements in all 3 categories', () => {
    const cats = new Set(ACHIEVEMENTS.map(a => a.category));
    expect(cats).toContain('class');
    expect(cats).toContain('buff');
    expect(cats).toContain('building');
  });

  it('medal colors are valid CSS hex', () => {
    for (const ach of ACHIEVEMENTS) {
      expect(ach.medalColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('progress functions return 0 for empty stats', () => {
    const empty = emptyMetaStats();
    for (const ach of ACHIEVEMENTS) {
      const progress = ach.progress(empty);
      expect(progress).toBe(0);
    }
  });

  it('class unlock achievements include expected classes', () => {
    const classAch = ACHIEVEMENTS.filter(a => a.category === 'class');
    const names = classAch.map(a => a.displayName);
    expect(names).toContain('Assassin');
    expect(names).toContain('Paladin');
    expect(names).toContain('Necromancer');
    expect(names).toContain('Beastmaster');
  });

  it('buff achievements grant stat rewards', () => {
    const buffs = ACHIEVEMENTS.filter(a => a.category === 'buff');
    expect(buffs.length).toBeGreaterThanOrEqual(5);
    for (const buff of buffs) {
      // Reward should describe a stat bonus
      expect(buff.reward).toMatch(/^\+/);
    }
  });

  it('progress functions respond to stat changes', () => {
    const stats = emptyMetaStats();
    stats.totalEnemiesKilled = 999;
    stats.totalBuildingsBuilt = 999;
    stats.totalWavesSurvived = 999;
    stats.highestWaveSurvived = 99;
    stats.totalRuns = 999;
    stats.totalTimePlayed = 99999;
    stats.totalDamageDealt = 99999;
    stats.resourcesGathered = { wood: 9999, stone: 9999, iron: 9999, diamond: 9999 };

    for (const ach of ACHIEVEMENTS) {
      const progress = ach.progress(stats);
      expect(progress).toBeGreaterThan(0);
    }
  });
});
