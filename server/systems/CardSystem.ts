import { CARD_POOL, RARITY_WEIGHTS } from '@shared/definitions/CardDefinitions';
import type { CardDefinition, CardEffect } from '@shared/definitions/CardDefinitions';

/** Per-player buff state accumulated from card picks. */
export interface PlayerBuffs {
  damageMultiplier: number;
  speedMultiplier: number;
  maxHpBonus: number;
  hpRegen: number;
  abilities: string[];
  critChance: number;
  critMultiplier: number;
  reviveHpBonus: number;
  defenseBonus: number;
  staminaRegenMult: number;
  maxStaminaBonus: number;
  knockbackMult: number;
  knockbackResist: number;
  selfRevives: number;
  thornsDamage: number;
  pickupRadiusMult: number;
}

/** Session-wide debuffs from curse/trap cards. */
export interface SessionDebuffs {
  playerDamageMult: number;
  enemySpeedMult: number;
  enemyDamageMult: number;
  playerStaminaRegenMult: number;
  playerMaxHpPenalty: number;
  playerAttackSpeedMult: number;
  enemyKnockbackMult: number;
  buildingDamageMult: number;
  buildingRegenRate: number;
  turretCooldownMult: number;
  productionIntervalMult: number;
  lootMultiplier: number;
  goldDropMult: number;
  guaranteedTitans: number;
  dodgeCooldownMult: number;
  // Curse card bonus fields
  turretDamageMult?: number;
  productionAmountMult?: number;
  buildingDeathExplosion?: boolean;
  titanDoubleCardDrop?: boolean;
}

export function emptyBuffs(): PlayerBuffs {
  return {
    damageMultiplier: 1, speedMultiplier: 1, maxHpBonus: 0, hpRegen: 0, abilities: [],
    critChance: 0, critMultiplier: 0, reviveHpBonus: 0, defenseBonus: 0,
    staminaRegenMult: 1, maxStaminaBonus: 0, knockbackMult: 1, knockbackResist: 0,
    selfRevives: 0, thornsDamage: 0, pickupRadiusMult: 1,
  };
}

export function emptyDebuffs(): SessionDebuffs {
  return {
    playerDamageMult: 1, enemySpeedMult: 1, enemyDamageMult: 1,
    playerStaminaRegenMult: 1, playerMaxHpPenalty: 0, playerAttackSpeedMult: 1,
    enemyKnockbackMult: 1, buildingDamageMult: 1, buildingRegenRate: 0,
    turretCooldownMult: 1, productionIntervalMult: 1,
    lootMultiplier: 1, goldDropMult: 1, guaranteedTitans: 0, dodgeCooldownMult: 1,
  };
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
  private _pickedCardIds = new Set<string>();
  /** Read-only access to picked card IDs. */
  get pickedCardIds(): ReadonlySet<string> { return this._pickedCardIds; }
  /** Pending offers: clientId → card IDs offered. */
  private pendingOffers = new Map<string, string[]>();

  /** Generate an offer of 3 cards for a player. At most 1 curse card. */
  generateOffer(playerCount: number = 1): CardDefinition[] {
    const available = CARD_POOL.filter(c =>
      !this._pickedCardIds.has(c.id) &&
      (!c.requiresMultiplayer || playerCount > 1)
    );
    if (available.length === 0) {
      const fallback = CARD_POOL.filter(c => !c.requiresMultiplayer || playerCount > 1);
      return this.pickWeighted(fallback, 3);
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

    this._pickedCardIds.add(cardId);
    this.applyEffect(clientId, card.effect);
    return card;
  }

  /** Auto-pick the first non-curse card from a player's pending offer. */
  autoPickNonCurse(clientId: string): CardDefinition | null {
    const offered = this.pendingOffers.get(clientId);
    if (!offered) return null;
    const nonCurse = offered.find(id => {
      const c = CARD_POOL.find(p => p.id === id);
      return c && c.category !== 'curse';
    });
    const pickId = nonCurse ?? offered[0];
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

  /** Serialize card state for a player (for save system). */
  serialize(clientId: string): { buffs: PlayerBuffs; pickedCards: string[] } {
    return {
      buffs: { ...this.getBuffs(clientId), abilities: [...this.getBuffs(clientId).abilities] },
      pickedCards: [...this._pickedCardIds],
    };
  }

  /** Restore card state for a player from save data. */
  restore(clientId: string, buffs: Partial<PlayerBuffs> & { abilities: string[] }, pickedCards: string[]): void {
    const full: PlayerBuffs = {
      ...emptyBuffs(),
      ...buffs,
      abilities: [...buffs.abilities],
    };
    this.playerBuffs.set(clientId, full);
    for (const id of pickedCards) this._pickedCardIds.add(id);
  }

  /** Restore session-wide debuffs from save data. */
  restoreDebuffs(debuffs: Partial<SessionDebuffs>): void {
    Object.assign(this.debuffs, { ...emptyDebuffs(), ...debuffs });
  }

  /** Force-apply a card without an offer (used for Titan card drops). */
  forceApplyCard(clientId: string, card: CardDefinition): void {
    this._pickedCardIds.add(card.id);
    this.applyEffect(clientId, card.effect);
  }

  /** Clear all state (for session reset). */
  reset(): void {
    this.playerBuffs.clear();
    this.pendingOffers.clear();
    this._pickedCardIds.clear();
    Object.assign(this.debuffs, emptyDebuffs());
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private applyEffect(clientId: string, effect: CardEffect): void {
    const buffs = this.getBuffs(clientId);

    switch (effect.type) {
      case 'stat_buff':
        switch (effect.stat) {
          case 'damage':          buffs.damageMultiplier *= (1 + effect.value); break;
          case 'speed':           buffs.speedMultiplier *= (1 + effect.value); break;
          case 'maxHp':           buffs.maxHpBonus += effect.value; break;
          case 'hpRegen':         buffs.hpRegen += effect.value; break;
          case 'critChance':      buffs.critChance += effect.value; break;
          case 'critMultiplier':  buffs.critMultiplier += effect.value; break;
          case 'reviveHpBonus':   buffs.reviveHpBonus += effect.value; break;
          case 'defense':         buffs.defenseBonus += effect.value; break;
          case 'staminaRegenMult': buffs.staminaRegenMult *= (1 + effect.value); break;
          case 'maxStamina':      buffs.maxStaminaBonus += effect.value; break;
          case 'knockbackMult':   buffs.knockbackMult *= (1 + effect.value); break;
          case 'knockbackResist': buffs.knockbackResist = Math.min(1, buffs.knockbackResist + effect.value); break;
        }
        break;
      case 'ability':
        if (!buffs.abilities.includes(effect.ability)) {
          buffs.abilities.push(effect.ability);
        }
        // Session-wide ability effects
        switch (effect.ability) {
          case 'spare_life':        buffs.selfRevives += 1; break;
          case 'thorns':            buffs.thornsDamage += 5; break;
          case 'magnetic_fur':      buffs.pickupRadiusMult *= 2; break;
          case 'thick_walls':       this.debuffs.buildingDamageMult *= 0.75; break;
          case 'building_regen':    this.debuffs.buildingRegenRate += 5; break;
          case 'rapid_fire':        this.debuffs.turretCooldownMult *= 0.80; break;
          case 'scavenger':         this.debuffs.lootMultiplier *= 1.50; break;
          case 'bounty_hunter':     this.debuffs.goldDropMult *= 1.50; break;
          case 'jammed_gears':      this.debuffs.turretCooldownMult *= 1.25; break;
          case 'resource_drought':  this.debuffs.productionIntervalMult *= 1.30; break;
          case 'shoddy_construction': this.debuffs.buildingDamageMult *= 1.25; break;
          case 'titans_march':      this.debuffs.guaranteedTitans += 1; break;
          case 'slow_reflexes':     this.debuffs.dodgeCooldownMult *= 1.30; break;
          // Legendary abilities
          case 'phoenix_down':      buffs.selfRevives += 2; break;
          case 'blood_thorns':      buffs.thornsDamage += 10; break;
          case 'master_walls':      this.debuffs.buildingDamageMult *= 0.50; break;
          case 'master_regen':      this.debuffs.buildingRegenRate += 10; break;
          case 'master_turrets':    this.debuffs.turretCooldownMult *= 0.60; break;
          case 'the_rumbling':      this.debuffs.guaranteedTitans += 2; break;
          // Curse card buff abilities
          case 'turret_damage_boost': this.debuffs.turretDamageMult = (this.debuffs.turretDamageMult ?? 1) * 1.50; break;
          case 'production_boost':    this.debuffs.productionAmountMult = (this.debuffs.productionAmountMult ?? 1) * 2.0; break;
          case 'worthy_foes_loot':    this.debuffs.lootMultiplier *= 2.0; break;
          case 'volatile_buildings':  this.debuffs.buildingDeathExplosion = true; break;
          case 'titan_double_drop':   this.debuffs.titanDoubleCardDrop = true; break;
          case 'soul_bond_heal':      buffs.abilities.push('soul_bond_heal'); break;
          case 'massive_loot':        this.debuffs.lootMultiplier *= 3.0; break;
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
        if (effect.stat === 'staminaRegen') {
          this.debuffs.playerStaminaRegenMult *= (1 + effect.value);
        }
        if (effect.stat === 'maxHp') {
          this.debuffs.playerMaxHpPenalty += Math.abs(effect.value);
        }
        if (effect.stat === 'attackSpeed') {
          this.debuffs.playerAttackSpeedMult *= (1 + effect.value);
        }
        break;
      case 'trap_enemy':
        if (effect.stat === 'speed') this.debuffs.enemySpeedMult *= (1 + effect.value);
        if (effect.stat === 'damage') this.debuffs.enemyDamageMult *= (1 + effect.value);
        if (effect.stat === 'knockback') this.debuffs.enemyKnockbackMult *= (1 + effect.value);
        break;
      case 'multi':
        for (const sub of effect.effects) this.applyEffect(clientId, sub);
        break;
    }
  }

  private pickWeighted(pool: CardDefinition[], count: number): CardDefinition[] {
    const result: CardDefinition[] = [];
    const remaining = [...pool];
    let curseCount = 0;

    for (let i = 0; i < count && remaining.length > 0; i++) {
      // Filter out curses if we already have one
      const eligible = curseCount > 0
        ? remaining.filter(c => c.category !== 'curse')
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
      if (picked.category === 'curse') curseCount++;
      // Remove from remaining to avoid duplicates in same offer
      const idx = remaining.indexOf(picked);
      if (idx >= 0) remaining.splice(idx, 1);
    }

    return result;
  }
}
