// ---------------------------------------------------------------------------
// Card Drop Tables - drop chances and rarity weights per source
// ---------------------------------------------------------------------------

import { CARD_POOL, type CardDefinition, type CardRarity } from './CardDefinitions';
import type { EnemyVariantType } from '../components';

// -- Drop chance per enemy variant (0-1) -------------------------------------

export const CARD_DROP_CHANCES: Record<string, number> = {
  melee:    0.02,
  ranger:   0.03,
  ghost:    0.04,
  giant:    0.08,
  assassin: 0.05,
  titan:    0.25,
  boss:     1.0,
};

// -- Rarity weights per drop source ------------------------------------------

export type CardDropSource = 'regular_enemy' | 'boss' | 'milestone' | 'world_event';

const CARD_RARITY_WEIGHTS: Record<CardDropSource, Record<CardRarity, number>> = {
  regular_enemy: { common: 70, rare: 25, epic: 5,  legendary: 0  },
  boss:          { common: 0,  rare: 50, epic: 40, legendary: 10 },
  milestone:     { common: 0,  rare: 0,  epic: 70, legendary: 30 },
  world_event:   { common: 0,  rare: 60, epic: 30, legendary: 10 },
};

// -- Card drop roll ----------------------------------------------------------

/**
 * Roll a card drop for the given source.
 * Returns a CardDefinition or null if the pool is empty.
 * All categories (including curses) can drop from any source.
 * Excludes already-picked cards.
 */
export function rollCardDrop(
  _source: CardDropSource,
  _pickedCardIds: Set<string>,
): CardDefinition | null {
  return null;
}

/**
 * Roll a card with a minimum rarity for boss loot.
 * 'rare+' = rare/epic/legendary, 'epic+' = epic/legendary, 'legendary' = legendary only.
 */
export function rollBossLootCard(
  _pool: 'rare+' | 'epic+' | 'legendary',
  _pickedCardIds: Set<string>,
): CardDefinition | null {
  return null;
}

/**
 * Check if an enemy kill should drop a card, and if so return it.
 * Returns null if no drop.
 */
export function rollEnemyCardDrop(
  _variant: EnemyVariantType | 'boss',
  _pickedCardIds: Set<string>,
): CardDefinition | null {
  return null;
}
