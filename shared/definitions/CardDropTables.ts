// ---------------------------------------------------------------------------
// Card Drop Tables - drop chances and rarity weights per source
// ---------------------------------------------------------------------------

import { CARD_POOL, type CardDefinition, type CardRarity } from './CardDefinitions';
import type { EnemyVariantType } from '../components';

// ── Drop chance per enemy variant (0-1) ─────────────────────────────────────

export const CARD_DROP_CHANCES: Record<string, number> = {
  melee:    0.02,
  ranger:   0.03,
  ghost:    0.04,
  giant:    0.08,
  assassin: 0.05,
  titan:    0.25,
  boss:     1.0,
};

// ── Rarity weights per drop source ──────────────────────────────────────────

export type CardDropSource = 'regular_enemy' | 'boss' | 'milestone' | 'world_event';

const CARD_RARITY_WEIGHTS: Record<CardDropSource, Record<CardRarity, number>> = {
  regular_enemy: { common: 70, rare: 25, epic: 5,  legendary: 0  },
  boss:          { common: 0,  rare: 50, epic: 40, legendary: 10 },
  milestone:     { common: 0,  rare: 0,  epic: 70, legendary: 30 },
  world_event:   { common: 0,  rare: 60, epic: 30, legendary: 10 },
};

// ── Card drop roll ──────────────────────────────────────────────────────────

/**
 * Roll a card drop for the given source.
 * Returns a CardDefinition or null if the pool is empty.
 * Excludes traps for boss/milestone/event sources.
 * Excludes already-picked cards.
 */
export function rollCardDrop(
  source: CardDropSource,
  pickedCardIds: Set<string>,
): CardDefinition | null {
  const weights = CARD_RARITY_WEIGHTS[source];
  const excludeTraps = source !== 'regular_enemy';

  // Filter pool
  let pool = CARD_POOL.filter(c => {
    if (pickedCardIds.has(c.id)) return false;
    if (excludeTraps && c.category === 'trap') return false;
    if (weights[c.rarity] <= 0) return false;
    return true;
  });

  if (pool.length === 0) {
    // Fallback: allow duplicates but still respect rarity weights
    pool = CARD_POOL.filter(c => {
      if (excludeTraps && c.category === 'trap') return false;
      if (weights[c.rarity] <= 0) return false;
      return true;
    });
  }

  if (pool.length === 0) return null;

  // Weighted random by rarity
  const weighted = pool.map(c => ({ card: c, weight: weights[c.rarity] }));
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const w of weighted) {
    roll -= w.weight;
    if (roll <= 0) return w.card;
  }
  return weighted[weighted.length - 1].card;
}

/**
 * Check if an enemy kill should drop a card, and if so return it.
 * Returns null if no drop.
 */
export function rollEnemyCardDrop(
  variant: EnemyVariantType | 'boss',
  pickedCardIds: Set<string>,
): CardDefinition | null {
  const chance = CARD_DROP_CHANCES[variant] ?? 0;
  if (Math.random() > chance) return null;
  const source: CardDropSource = variant === 'boss' ? 'boss' : 'regular_enemy';
  return rollCardDrop(source, pickedCardIds);
}
