import { describe, it, expect } from 'vitest';
import {
  pickWaveFactions,
  getSpawnWeightsForFaction,
  pickEnemyVariantForFaction,
  ENEMY_FACTIONS,
} from '../../../shared/definitions/EnemyVariants';

describe('pickWaveFactions', () => {
  it('returns only bandits for waves 1-4', () => {
    for (let w = 1; w <= 4; w++) {
      expect(pickWaveFactions(w)).toEqual(['bandits']);
    }
  });

  it('returns bandits + undead for waves 5-8', () => {
    for (let w = 5; w <= 8; w++) {
      const factions = pickWaveFactions(w);
      expect(factions).toEqual(['bandits', 'undead']);
    }
  });

  it('returns exactly 2 factions for wave 9+', () => {
    for (let i = 0; i < 20; i++) {
      const factions = pickWaveFactions(9 + i);
      expect(factions).toHaveLength(2);
      // Both should be valid factions
      for (const f of factions) {
        expect(ENEMY_FACTIONS).toContain(f);
      }
      // Should be distinct
      expect(factions[0]).not.toBe(factions[1]);
    }
  });
});

describe('getSpawnWeightsForFaction', () => {
  it('undead faction favors ghosts', () => {
    const weights = getSpawnWeightsForFaction(5, 'undead');
    const ghostWeight = weights.find(w => w.variant === 'ghost')?.weight ?? 0;
    const meleeWeight = weights.find(w => w.variant === 'melee')?.weight ?? 0;
    expect(ghostWeight).toBeGreaterThan(meleeWeight);
  });

  it('corrupted faction favors assassins at wave 7+', () => {
    const weights = getSpawnWeightsForFaction(7, 'corrupted');
    const assassinWeight = weights.find(w => w.variant === 'assassin')?.weight ?? 0;
    const meleeWeight = weights.find(w => w.variant === 'melee')?.weight ?? 0;
    expect(assassinWeight).toBeGreaterThan(meleeWeight);
  });

  it('bandits use standard weights', () => {
    const weights = getSpawnWeightsForFaction(1, 'bandits');
    expect(weights).toHaveLength(2); // melee + ranger at wave 1
    expect(weights[0].variant).toBe('melee');
    expect(weights[1].variant).toBe('ranger');
  });

  it('respects wave unlock thresholds', () => {
    // Wave 2 undead should not have ghost (unlocks at W3)
    const weights = getSpawnWeightsForFaction(2, 'undead');
    const hasGhost = weights.some(w => w.variant === 'ghost');
    expect(hasGhost).toBe(false);
  });
});

describe('pickEnemyVariantForFaction', () => {
  it('always returns a valid variant', () => {
    for (let i = 0; i < 50; i++) {
      const variant = pickEnemyVariantForFaction(10, 'corrupted');
      expect(['melee', 'ranger', 'ghost', 'giant', 'assassin']).toContain(variant);
    }
  });
});
