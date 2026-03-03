import { describe, it, expect } from 'vitest';
import {
  POTION_POOL,
  POTION_TYPES,
  POTION_CHARGES_BY_LEVEL,
  POTION_SHOP_INTERACT_RANGE,
  POTION_USE_COOLDOWN,
  type PotionDefinition,
} from '../../../shared/definitions/PotionDefinitions';

describe('PotionDefinitions', () => {
  it('has exactly 4 potion types', () => {
    expect(POTION_TYPES).toHaveLength(4);
    expect(POTION_TYPES).toContain('health');
    expect(POTION_TYPES).toContain('speed');
    expect(POTION_TYPES).toContain('damage');
    expect(POTION_TYPES).toContain('shield');
  });

  it('POTION_POOL has all potion types', () => {
    for (const type of POTION_TYPES) {
      expect(POTION_POOL[type]).toBeDefined();
    }
  });

  it('all potions have required fields', () => {
    for (const type of POTION_TYPES) {
      const potion = POTION_POOL[type];
      expect(potion.id).toBe(type);
      expect(potion.name.length).toBeGreaterThan(0);
      expect(potion.shortName.length).toBeGreaterThan(0);
      expect(potion.description.length).toBeGreaterThan(0);
      expect(potion.cooldown).toBeGreaterThan(0);
      expect(typeof potion.color).toBe('number');
      expect(potion.color).toBeGreaterThan(0);
    }
  });

  it('all potions have 3 effect levels', () => {
    for (const type of POTION_TYPES) {
      const potion = POTION_POOL[type];
      expect(potion.effectByLevel).toHaveLength(3);
    }
  });

  it('effect values are positive', () => {
    for (const type of POTION_TYPES) {
      for (const eff of POTION_POOL[type].effectByLevel) {
        expect(eff.value).toBeGreaterThan(0);
        expect(eff.duration).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('health potion has instant heal (duration 0)', () => {
    for (const eff of POTION_POOL.health.effectByLevel) {
      expect(eff.type).toBe('heal');
      expect(eff.duration).toBe(0);
    }
  });

  it('buff potions have duration > 0', () => {
    for (const type of ['speed', 'damage', 'shield'] as const) {
      for (const eff of POTION_POOL[type].effectByLevel) {
        expect(eff.duration).toBeGreaterThan(0);
      }
    }
  });

  it('all potions have unlock and restock costs', () => {
    for (const type of POTION_TYPES) {
      const potion = POTION_POOL[type];
      expect(Object.keys(potion.unlockCost).length).toBeGreaterThan(0);
      expect(Object.keys(potion.restockCost).length).toBeGreaterThan(0);
      // All costs should be positive
      for (const val of Object.values(potion.unlockCost)) {
        expect(val).toBeGreaterThan(0);
      }
      for (const val of Object.values(potion.restockCost)) {
        expect(val).toBeGreaterThan(0);
      }
    }
  });

  it('POTION_CHARGES_BY_LEVEL has 3 levels and increases', () => {
    expect(POTION_CHARGES_BY_LEVEL).toHaveLength(3);
    for (let i = 1; i < POTION_CHARGES_BY_LEVEL.length; i++) {
      expect(POTION_CHARGES_BY_LEVEL[i]).toBeGreaterThan(POTION_CHARGES_BY_LEVEL[i - 1]);
    }
  });

  it('constants are sensible', () => {
    expect(POTION_SHOP_INTERACT_RANGE).toBeGreaterThan(0);
    expect(POTION_USE_COOLDOWN).toBeGreaterThan(0);
  });
});
