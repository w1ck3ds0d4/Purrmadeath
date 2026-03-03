import { describe, it, expect } from 'vitest';
import {
  WAVE_MODIFIERS,
  pickWaveModifiers,
  computeModifierAggregate,
  type WaveModifierId,
} from '../../../shared/definitions/WaveModifiers';

describe('WAVE_MODIFIERS', () => {
  const allIds = Object.keys(WAVE_MODIFIERS) as WaveModifierId[];

  it('has 4 modifier types', () => {
    expect(allIds).toHaveLength(4);
    expect(allIds).toContain('swarm');
    expect(allIds).toContain('ironhide');
    expect(allIds).toContain('fog');
    expect(allIds).toContain('frenzy');
  });

  it('all modifiers have valid fields', () => {
    for (const id of allIds) {
      const m = WAVE_MODIFIERS[id];
      expect(m.id).toBe(id);
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
      expect(m.color).toBeGreaterThan(0);
      expect(m.minWave).toBeGreaterThanOrEqual(1);
      expect(m.weight).toBeGreaterThan(0);
    }
  });

  it('all multipliers are positive', () => {
    for (const id of allIds) {
      const m = WAVE_MODIFIERS[id];
      expect(m.enemyCountMult).toBeGreaterThan(0);
      expect(m.enemyHpMult).toBeGreaterThan(0);
      expect(m.enemySpeedMult).toBeGreaterThan(0);
      expect(m.enemyDamageMult).toBeGreaterThan(0);
      expect(m.visionMult).toBeGreaterThan(0);
    }
  });

  it('swarm doubles enemy count but halves HP', () => {
    expect(WAVE_MODIFIERS.swarm.enemyCountMult).toBe(2.0);
    expect(WAVE_MODIFIERS.swarm.enemyHpMult).toBe(0.5);
  });

  it('fog reduces vision', () => {
    expect(WAVE_MODIFIERS.fog.visionMult).toBeLessThan(1.0);
  });
});

describe('pickWaveModifiers', () => {
  it('returns empty for waves 1-2', () => {
    expect(pickWaveModifiers(1)).toHaveLength(0);
    expect(pickWaveModifiers(2)).toHaveLength(0);
  });

  it('returns 0 or 1 modifiers for waves 3-7', () => {
    for (let i = 0; i < 100; i++) {
      const mods = pickWaveModifiers(5);
      expect(mods.length).toBeLessThanOrEqual(1);
    }
  });

  it('returns at most 2 modifiers for waves 8-14', () => {
    for (let i = 0; i < 100; i++) {
      const mods = pickWaveModifiers(10);
      expect(mods.length).toBeLessThanOrEqual(2);
    }
  });

  it('returns at most 3 modifiers for wave 15+', () => {
    for (let i = 0; i < 100; i++) {
      const mods = pickWaveModifiers(20);
      expect(mods.length).toBeLessThanOrEqual(3);
    }
  });

  it('only picks eligible modifiers (respects minWave)', () => {
    for (let i = 0; i < 100; i++) {
      const mods = pickWaveModifiers(3);
      for (const id of mods) {
        expect(WAVE_MODIFIERS[id].minWave).toBeLessThanOrEqual(3);
      }
    }
  });

  it('never returns duplicates', () => {
    for (let i = 0; i < 100; i++) {
      const mods = pickWaveModifiers(20);
      expect(new Set(mods).size).toBe(mods.length);
    }
  });
});

describe('computeModifierAggregate', () => {
  it('returns 1x multipliers for empty list', () => {
    const agg = computeModifierAggregate([]);
    expect(agg.enemyCountMult).toBe(1);
    expect(agg.enemyHpMult).toBe(1);
    expect(agg.enemySpeedMult).toBe(1);
    expect(agg.enemyDamageMult).toBe(1);
    expect(agg.visionMult).toBe(1);
  });

  it('applies single modifier correctly', () => {
    const agg = computeModifierAggregate(['swarm']);
    expect(agg.enemyCountMult).toBe(2.0);
    expect(agg.enemyHpMult).toBe(0.5);
    expect(agg.enemySpeedMult).toBe(1.0);
  });

  it('multiplies multiple modifiers together', () => {
    const agg = computeModifierAggregate(['ironhide', 'frenzy']);
    expect(agg.enemyHpMult).toBe(1.5);
    expect(agg.enemyDamageMult).toBeCloseTo(1.25 * 1.2);
    expect(agg.enemySpeedMult).toBe(1.3);
  });

  it('stacks all 4 modifiers', () => {
    const agg = computeModifierAggregate(['swarm', 'ironhide', 'fog', 'frenzy']);
    expect(agg.enemyCountMult).toBe(2.0);
    expect(agg.visionMult).toBe(0.5);
    expect(agg.enemyDamageMult).toBeCloseTo(1.25 * 1.2);
  });
});
