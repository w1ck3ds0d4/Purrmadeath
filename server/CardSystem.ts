import { CARD_POOL, RARITY_WEIGHTS } from '@shared/CardDefinitions';
import type { CardDefinition, CardEffect } from '@shared/CardDefinitions';

/** Per-player buff state accumulated from card picks. */
export interface PlayerBuffs {
  damageMultiplier: number;
  speedMultiplier: number;
  maxHpBonus: number;
  hpRegen: number;
  abilities: string[];
}

/** Session-wide debuffs from trap cards. */
export interface SessionDebuffs {
  playerDamageMult: number;
  enemySpeedMult: number;
  enemyDamageMult: number;
}

export function emptyBuffs(): PlayerBuffs {
  return { damageMultiplier: 1, speedMultiplier: 1, maxHpBonus: 0, hpRegen: 0, abilities: [] };
}

export function emptyDebuffs(): SessionDebuffs {
  return { playerDamageMult: 1, enemySpeedMult: 1, enemyDamageMult: 1 };
}

/**
 * Manages card offers, picks, and buff application.
 */
export class CardSystem {
  /** Per-player accumulated buffs (keyed by clientId). */
  readonly playerBuffs = new Map<string, PlayerBuffs>();
  /** Session-wide debuffs from trap cards. */
  readonly debuffs: SessionDebuffs = emptyDebuffs();
  /** Cards already picked this session (to avoid exact duplicates). */
  private pickedCardIds = new Set<string>();
  /** Pending offers: clientId → card IDs offered. */
  private pendingOffers = new Map<string, string[]>();

  /** Generate an offer of 3 cards for a player. At most 1 trap card. */
  generateOffer(): CardDefinition[] {
    const available = CARD_POOL.filter(c => !this.pickedCardIds.has(c.id));
    if (available.length === 0) {
      // All cards picked — allow repeats
      return this.pickWeighted(CARD_POOL, 3);
    }
    return this.pickWeighted(available, 3);
  }

  /** Record a pending offer for a player (for validation on pick). */
  setPendingOffer(clientId: string, cards: CardDefinition[]): void {
    this.pendingOffers.set(clientId, cards.map(c => c.id));
  }

  /** Validate and apply a card pick. Returns the card or null if invalid. */
  applyPick(clientId: string, cardId: string): CardDefinition | null {
    const offered = this.pendingOffers.get(clientId);
    if (!offered || !offered.includes(cardId)) return null;
    this.pendingOffers.delete(clientId);

    const card = CARD_POOL.find(c => c.id === cardId);
    if (!card) return null;

    this.pickedCardIds.add(cardId);
    this.applyEffect(clientId, card.effect);
    return card;
  }

  /** Auto-pick the first non-trap card from a player's pending offer. */
  autoPickNonTrap(clientId: string): CardDefinition | null {
    const offered = this.pendingOffers.get(clientId);
    if (!offered) return null;
    const nonTrap = offered.find(id => {
      const c = CARD_POOL.find(p => p.id === id);
      return c && c.category !== 'trap';
    });
    const pickId = nonTrap ?? offered[0];
    return this.applyPick(clientId, pickId);
  }

  /** Check if a player has a pending offer. */
  hasPendingOffer(clientId: string): boolean {
    return this.pendingOffers.has(clientId);
  }

  /** Get or create buffs for a player. */
  getBuffs(clientId: string): PlayerBuffs {
    let b = this.playerBuffs.get(clientId);
    if (!b) { b = emptyBuffs(); this.playerBuffs.set(clientId, b); }
    return b;
  }

  /** Clear all state (for session reset). */
  reset(): void {
    this.playerBuffs.clear();
    this.pendingOffers.clear();
    this.pickedCardIds.clear();
    Object.assign(this.debuffs, emptyDebuffs());
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private applyEffect(clientId: string, effect: CardEffect): void {
    const buffs = this.getBuffs(clientId);

    switch (effect.type) {
      case 'stat_buff':
        switch (effect.stat) {
          case 'damage':  buffs.damageMultiplier *= (1 + effect.value); break;
          case 'speed':   buffs.speedMultiplier *= (1 + effect.value); break;
          case 'maxHp':   buffs.maxHpBonus += effect.value; break;
          case 'hpRegen': buffs.hpRegen += effect.value; break;
        }
        break;
      case 'ability':
        if (!buffs.abilities.includes(effect.ability)) {
          buffs.abilities.push(effect.ability);
        }
        break;
      case 'resource':
        // Handled externally in GameSession (credits resources to player)
        break;
      case 'trap_player':
        if (effect.stat === 'damage') this.debuffs.playerDamageMult *= (1 + effect.value);
        if (effect.stat === 'speed') {
          // Apply to all existing players
          for (const b of this.playerBuffs.values()) {
            b.speedMultiplier *= (1 + effect.value);
          }
        }
        break;
      case 'trap_enemy':
        if (effect.stat === 'speed') this.debuffs.enemySpeedMult *= (1 + effect.value);
        if (effect.stat === 'damage') this.debuffs.enemyDamageMult *= (1 + effect.value);
        break;
    }
  }

  private pickWeighted(pool: CardDefinition[], count: number): CardDefinition[] {
    const result: CardDefinition[] = [];
    const remaining = [...pool];
    let trapCount = 0;

    for (let i = 0; i < count && remaining.length > 0; i++) {
      // Filter out traps if we already have one
      const eligible = trapCount > 0
        ? remaining.filter(c => c.category !== 'trap')
        : remaining;
      if (eligible.length === 0) break;

      const totalWeight = eligible.reduce((sum, c) => sum + RARITY_WEIGHTS[c.rarity], 0);
      let roll = Math.random() * totalWeight;
      let picked: CardDefinition | null = null;
      for (const card of eligible) {
        roll -= RARITY_WEIGHTS[card.rarity];
        if (roll <= 0) { picked = card; break; }
      }
      if (!picked) picked = eligible[eligible.length - 1];

      result.push(picked);
      if (picked.category === 'trap') trapCount++;
      // Remove from remaining to avoid duplicates in same offer
      const idx = remaining.indexOf(picked);
      if (idx >= 0) remaining.splice(idx, 1);
    }

    return result;
  }
}
