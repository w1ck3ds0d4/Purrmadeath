import { describe, it, expect } from 'vitest';
import {
  CARD_POOL,
  RARITY_WEIGHTS,
  CATEGORY_COLORS,
  RARITY_BORDER_COLORS,
  type CardDefinition,
  type CardEffect,
} from '../../../shared/definitions/CardDefinitions';

describe('CardDefinitions', () => {
  it('has at least 30 cards', () => {
    // Card pool was trimmed from the original 40+ target to the current
    // 30-card MVP set; raise this floor when more cards ship.
    expect(CARD_POOL.length).toBeGreaterThanOrEqual(30);
  });

  it('all card IDs are unique', () => {
    const ids = CARD_POOL.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all card names are unique', () => {
    const names = CARD_POOL.map(c => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all cards have required fields', () => {
    for (const card of CARD_POOL) {
      expect(card.id.length).toBeGreaterThan(0);
      expect(card.name.length).toBeGreaterThan(0);
      expect(card.description.length).toBeGreaterThan(0);
      expect(['buff', 'ability', 'resource', 'curse']).toContain(card.category);
      expect(['common', 'rare', 'epic', 'legendary']).toContain(card.rarity);
      expect(card.effect).toBeDefined();
    }
  });

  it('has cards in every shipping category', () => {
    // `resource` is reserved in the type union + CATEGORY_COLORS for
    // future resource cards, but no cards in CARD_POOL use it today.
    const categories = new Set(CARD_POOL.map(c => c.category));
    expect(categories).toContain('buff');
    expect(categories).toContain('ability');
    expect(categories).toContain('curse');
  });

  it('has cards in every rarity', () => {
    const rarities = new Set(CARD_POOL.map(c => c.rarity));
    expect(rarities).toContain('common');
    expect(rarities).toContain('rare');
    expect(rarities).toContain('epic');
    expect(rarities).toContain('legendary');
  });

  it('stat_buff cards have numeric values', () => {
    const statCards = CARD_POOL.filter(c => c.effect.type === 'stat_buff');
    for (const card of statCards) {
      const eff = card.effect as { type: 'stat_buff'; stat: string; value: number };
      expect(typeof eff.value).toBe('number');
      expect(eff.stat.length).toBeGreaterThan(0);
    }
  });

  it('resource cards have positive amounts', () => {
    const resourceCards = CARD_POOL.filter(c => c.effect.type === 'resource');
    for (const card of resourceCards) {
      const eff = card.effect as { type: 'resource'; resource: string; amount: number };
      expect(eff.amount).toBeGreaterThan(0);
      expect(eff.resource.length).toBeGreaterThan(0);
    }
  });

  it('multi-effect cards have at least 2 sub-effects', () => {
    const multiCards = CARD_POOL.filter(c => c.effect.type === 'multi');
    for (const card of multiCards) {
      const eff = card.effect as { type: 'multi'; effects: CardEffect[] };
      expect(eff.effects.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('curse cards use trap_player or trap_enemy effects', () => {
    // Curse design moved from buff+debuff `multi` effects to dedicated
    // `trap_player` / `trap_enemy` effect types that flip the same stat
    // up for the caster and down for the other side.
    const curses = CARD_POOL.filter(c => c.category === 'curse');
    expect(curses.length).toBeGreaterThanOrEqual(5);
    for (const card of curses) {
      expect(['trap_player', 'trap_enemy']).toContain(card.effect.type);
    }
  });

  it('multiplayer cards have requiresMultiplayer flag', () => {
    // Only Pack Hunter currently ships with the multiplayer requirement;
    // raise the floor when more multiplayer-only cards land.
    const mpCards = CARD_POOL.filter(c => c.requiresMultiplayer);
    expect(mpCards.length).toBeGreaterThanOrEqual(1);
    for (const card of mpCards) {
      expect(card.requiresMultiplayer).toBe(true);
    }
  });
});

describe('Card constants', () => {
  it('RARITY_WEIGHTS has all rarities with positive weights', () => {
    for (const rarity of ['common', 'rare', 'epic', 'legendary'] as const) {
      expect(RARITY_WEIGHTS[rarity]).toBeGreaterThan(0);
    }
    // Common should be most likely
    expect(RARITY_WEIGHTS.common).toBeGreaterThan(RARITY_WEIGHTS.rare);
    expect(RARITY_WEIGHTS.rare).toBeGreaterThan(RARITY_WEIGHTS.epic);
    expect(RARITY_WEIGHTS.epic).toBeGreaterThan(RARITY_WEIGHTS.legendary);
  });

  it('CATEGORY_COLORS has all categories', () => {
    for (const cat of ['buff', 'ability', 'resource', 'curse'] as const) {
      expect(typeof CATEGORY_COLORS[cat]).toBe('number');
      expect(CATEGORY_COLORS[cat]).toBeGreaterThan(0);
    }
  });

  it('RARITY_BORDER_COLORS has all rarities', () => {
    for (const rarity of ['common', 'rare', 'epic', 'legendary'] as const) {
      expect(typeof RARITY_BORDER_COLORS[rarity]).toBe('string');
      expect(RARITY_BORDER_COLORS[rarity].length).toBeGreaterThan(0);
    }
  });
});
