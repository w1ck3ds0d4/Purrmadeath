import { describe, it, expect } from 'vitest';
import {
  BOSS_DEFINITIONS,
  BOSS_MAP,
  getBossForWave,
  getBossCountForWave,
  getBossPhaseIndex,
  type BossDefinition,
} from '../../../shared/definitions/BossDefinitions';

describe('BossDefinitions', () => {
  it('has at least 8 bosses', () => {
    expect(BOSS_DEFINITIONS.length).toBeGreaterThanOrEqual(8);
  });

  it('all boss IDs are unique', () => {
    const ids = BOSS_DEFINITIONS.map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all boss names are unique', () => {
    const names = BOSS_DEFINITIONS.map(b => b.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all bosses have valid stats', () => {
    for (const boss of BOSS_DEFINITIONS) {
      expect(boss.hp).toBeGreaterThan(0);
      expect(boss.speed).toBeGreaterThan(0);
      expect(boss.damage).toBeGreaterThan(0);
      expect(boss.range).toBeGreaterThan(0);
      expect(boss.knockback).toBeGreaterThan(0);
      expect(boss.cooldown).toBeGreaterThan(0);
      expect(boss.radius).toBeGreaterThan(0);
      expect(boss.minWave).toBeGreaterThanOrEqual(1);
      expect(boss.description.length).toBeGreaterThan(0);
    }
  });

  it('all bosses have at least one phase', () => {
    for (const boss of BOSS_DEFINITIONS) {
      expect(boss.phases.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('first phase always has hpThreshold 1.0', () => {
    for (const boss of BOSS_DEFINITIONS) {
      expect(boss.phases[0].hpThreshold).toBe(1.0);
    }
  });

  it('phase thresholds are in descending order', () => {
    for (const boss of BOSS_DEFINITIONS) {
      for (let i = 1; i < boss.phases.length; i++) {
        expect(boss.phases[i].hpThreshold).toBeLessThan(boss.phases[i - 1].hpThreshold);
      }
    }
  });

  it('all phases have at least one ability', () => {
    for (const boss of BOSS_DEFINITIONS) {
      for (const phase of boss.phases) {
        expect(phase.abilities.length).toBeGreaterThanOrEqual(1);
        for (const ability of phase.abilities) {
          expect(ability.id.length).toBeGreaterThan(0);
          // cooldown >= 0 (0 = passive/aura abilities like fire_trail, frost_aura)
          expect(ability.cooldown).toBeGreaterThanOrEqual(0);
          expect(ability.desc.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('later phases have banner text (except first phase)', () => {
    for (const boss of BOSS_DEFINITIONS) {
      // First phase should NOT have banner text (it is the initial phase)
      expect(boss.phases[0].bannerText).toBeUndefined();
      // Remaining phases should have banner text
      for (let i = 1; i < boss.phases.length; i++) {
        expect(boss.phases[i].bannerText).toBeDefined();
        expect(boss.phases[i].bannerText!.length).toBeGreaterThan(0);
      }
    }
  });

  it('all bosses have valid loot tables', () => {
    for (const boss of BOSS_DEFINITIONS) {
      expect(['rare+', 'epic+', 'legendary']).toContain(boss.loot.cardPool);
      expect(boss.loot.cardCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('all bosses have valid AI types', () => {
    const validAI = ['hunter', 'kiter', 'ambusher', 'building_target', 'campfire', 'circler', 'pursuer', 'aggressive'];
    for (const boss of BOSS_DEFINITIONS) {
      expect(validAI).toContain(boss.ai);
    }
  });
});

describe('BOSS_MAP', () => {
  it('maps all boss IDs', () => {
    for (const boss of BOSS_DEFINITIONS) {
      expect(BOSS_MAP[boss.id]).toBe(boss);
    }
  });

  it('has same count as BOSS_DEFINITIONS', () => {
    expect(Object.keys(BOSS_MAP).length).toBe(BOSS_DEFINITIONS.length);
  });
});

describe('getBossForWave', () => {
  it('returns null for waves below minimum boss wave', () => {
    expect(getBossForWave(1)).toBeNull();
    expect(getBossForWave(2)).toBeNull();
    expect(getBossForWave(3)).toBeNull();
    expect(getBossForWave(4)).toBeNull();
  });

  it('returns a boss for wave 5+', () => {
    // Run multiple times due to randomness
    let foundBoss = false;
    for (let i = 0; i < 20; i++) {
      if (getBossForWave(5) !== null) { foundBoss = true; break; }
    }
    expect(foundBoss).toBe(true);
  });

  it('returns eligible bosses only', () => {
    for (let i = 0; i < 50; i++) {
      const boss = getBossForWave(5);
      if (boss) {
        expect(boss.minWave).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('getBossCountForWave', () => {
  it('returns 0 before first boss wave', () => {
    expect(getBossCountForWave(1, 5, 5)).toBe(0);
    expect(getBossCountForWave(4, 5, 5)).toBe(0);
  });

  it('returns 1 for boss wave intervals', () => {
    expect(getBossCountForWave(5, 5, 5)).toBe(1);
    expect(getBossCountForWave(10, 5, 5)).toBe(1);
    expect(getBossCountForWave(15, 5, 5)).toBe(1);
    expect(getBossCountForWave(25, 5, 5)).toBe(1);
  });

  it('returns 0 for non-boss waves', () => {
    expect(getBossCountForWave(6, 5, 5)).toBe(0);
    expect(getBossCountForWave(7, 5, 5)).toBe(0);
    expect(getBossCountForWave(11, 5, 5)).toBe(0);
  });

  it('returns 2 for W30+', () => {
    expect(getBossCountForWave(30, 5, 5)).toBe(2);
    expect(getBossCountForWave(35, 5, 5)).toBe(2);
    expect(getBossCountForWave(40, 5, 5)).toBe(2);
  });
});

describe('getBossPhaseIndex', () => {
  it('returns 0 at full HP', () => {
    const boss = BOSS_DEFINITIONS[0]; // Ravager
    expect(getBossPhaseIndex(boss, 1.0)).toBe(0);
    expect(getBossPhaseIndex(boss, 0.8)).toBe(0);
  });

  it('transitions to phase 2 at threshold', () => {
    const ravager = BOSS_DEFINITIONS.find(b => b.id === 'ravager')!;
    // Phase 2 threshold is 0.5
    expect(getBossPhaseIndex(ravager, 0.5)).toBe(1);
    expect(getBossPhaseIndex(ravager, 0.3)).toBe(1);
  });

  it('handles bosses with 3 phases', () => {
    const necro = BOSS_DEFINITIONS.find(b => b.id === 'necromancer')!;
    if (necro.phases.length >= 3) {
      const lastPhase = necro.phases[necro.phases.length - 1];
      expect(getBossPhaseIndex(necro, lastPhase.hpThreshold - 0.01)).toBe(necro.phases.length - 1);
    }
  });

  it('returns last phase at very low HP', () => {
    for (const boss of BOSS_DEFINITIONS) {
      const idx = getBossPhaseIndex(boss, 0.01);
      expect(idx).toBe(boss.phases.length - 1);
    }
  });
});
