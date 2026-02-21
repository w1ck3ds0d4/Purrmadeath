import { describe, it, expect } from 'vitest';
import { LOOT_TABLES } from './LootTables';

describe('LootTables', () => {
  it('has a basic_enemy fallback table', () => {
    expect(LOOT_TABLES.basic_enemy).toBeDefined();
    expect(LOOT_TABLES.basic_enemy.entries.length).toBeGreaterThan(0);
  });

  it('has tables for all 5 enemy variants', () => {
    for (const variant of ['melee', 'ranger', 'ghost', 'giant', 'assassin']) {
      expect(LOOT_TABLES[variant]).toBeDefined();
      expect(LOOT_TABLES[variant].entries.length).toBeGreaterThan(0);
    }
  });

  it('giant has guaranteed drops (chance = 1.0)', () => {
    const guaranteed = LOOT_TABLES.giant.entries.filter(e => e.chance === 1.0);
    expect(guaranteed.length).toBeGreaterThanOrEqual(2);
  });

  it('ghost drops diamond with non-zero chance', () => {
    const diamond = LOOT_TABLES.ghost.entries.find(e => e.itemType === 'diamond');
    expect(diamond).toBeDefined();
    expect(diamond!.chance).toBeGreaterThan(0);
  });

  it('all entries have valid chance values (0-1)', () => {
    for (const [, table] of Object.entries(LOOT_TABLES)) {
      for (const entry of table.entries) {
        expect(entry.chance).toBeGreaterThanOrEqual(0);
        expect(entry.chance).toBeLessThanOrEqual(1);
        expect(entry.minQty).toBeLessThanOrEqual(entry.maxQty);
      }
    }
  });

  it('assassin drops gold with high chance', () => {
    const gold = LOOT_TABLES.assassin.entries.find(e => e.itemType === 'gold');
    expect(gold).toBeDefined();
    expect(gold!.chance).toBeGreaterThanOrEqual(0.5);
  });
});
