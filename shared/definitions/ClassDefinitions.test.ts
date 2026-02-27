import { describe, it, expect } from 'vitest';
import {
  PLAYER_CLASSES,
  CLASS_STATS,
  DEFAULT_CLASS,
  CLASS_DISPLAY_NAMES,
  CLASS_COLORS,
} from './ClassDefinitions';
import type { PlayerClass } from './ClassDefinitions';

describe('ClassDefinitions', () => {
  it('defines exactly 3 classes', () => {
    expect(PLAYER_CLASSES).toHaveLength(3);
    expect(PLAYER_CLASSES).toContain('warrior');
    expect(PLAYER_CLASSES).toContain('ranger');
    expect(PLAYER_CLASSES).toContain('mage');
  });

  it('DEFAULT_CLASS is a valid class', () => {
    expect((PLAYER_CLASSES as readonly string[]).includes(DEFAULT_CLASS)).toBe(true);
  });

  it.each(PLAYER_CLASSES as unknown as PlayerClass[])('CLASS_STATS[%s] has valid fields', (cls) => {
    const stats = CLASS_STATS[cls];
    expect(stats.hp).toBeGreaterThan(0);
    expect(stats.speed).toBeGreaterThan(0);
    expect(stats.defense).toBeGreaterThanOrEqual(0);
    expect(stats.stamina).toBeGreaterThan(0);
    expect(['melee', 'ranged']).toContain(stats.attackType);
    expect(stats.baseDamage).toBeGreaterThan(0);
    expect(stats.weaponName.length).toBeGreaterThan(0);
  });

  it.each(PLAYER_CLASSES as unknown as PlayerClass[])('CLASS_DISPLAY_NAMES[%s] exists', (cls) => {
    expect(typeof CLASS_DISPLAY_NAMES[cls]).toBe('string');
    expect(CLASS_DISPLAY_NAMES[cls].length).toBeGreaterThan(0);
  });

  it.each(PLAYER_CLASSES as unknown as PlayerClass[])('CLASS_COLORS[%s] is a valid hex number', (cls) => {
    expect(typeof CLASS_COLORS[cls]).toBe('number');
    expect(CLASS_COLORS[cls]).toBeGreaterThan(0);
  });

  it('warrior is melee, ranger and mage are ranged', () => {
    expect(CLASS_STATS.warrior.attackType).toBe('melee');
    expect(CLASS_STATS.ranger.attackType).toBe('ranged');
    expect(CLASS_STATS.mage.attackType).toBe('ranged');
  });
});
