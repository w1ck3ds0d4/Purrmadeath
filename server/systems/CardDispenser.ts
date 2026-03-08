import { World } from '@shared/ecs/World';
import {
  C,
  HealthComponent,
} from '@shared/components';
import type { SpeedComponent, DefenseComponent, StaminaComponent, KnockbackReceiverComponent } from '@shared/components';
import { CLASS_STATS } from '@shared/definitions/ClassDefinitions';
import { MessageType } from '@shared/protocol';
import type { CardPickupMessage } from '@shared/protocol';
import type { CardDefinition, CardEffect } from '@shared/definitions/CardDefinitions';
import type { ConnectedClient } from '../net/ServerSocket';
import type { SessionPlayer, SendFn } from '../core/GameSession';
import type { CardSystem } from './CardSystem';

// -- Mutable state shared with GameSession -----------------------------------

export interface CardState {
  offerTimer: number; // kept for backwards compat, always -1 now
}

// -- Dependencies ------------------------------------------------------------

export interface CardDispenserDeps {
  world: World;
  cards: CardSystem;
  state: CardState;
  players: Map<string, SessionPlayer>;
  offerTimeout: number;
  setPaused: (value: boolean) => void;
  creditResources: (entityId: number, resource: string, amount: number, send: SendFn) => void;
  /** Returns skill-based maxHp bonus for a player. */
  getSkillMaxHpBonus?: (clientId: string) => number;
}

// -- Factory -----------------------------------------------------------------

export function createCardDispenser(deps: CardDispenserDeps) {
  const { world, cards, players, creditResources } = deps;

  /**
   * Auto-grant a card directly to a specific player.
   * No picker UI, no pause - card is applied immediately and all players are notified via CARD_PICKUP.
   */
  function autoGrant(player: SessionPlayer, card: CardDefinition, send: SendFn): void {
    if (!player.entityId) return;

    // Apply card effect
    cards.forceApplyCard(player.client.id, card);
    applyToEntity(player, card, send);

    // Broadcast CARD_PICKUP to all players (reuse existing toast system)
    const pickupMsg: CardPickupMessage = {
      type: MessageType.CARD_PICKUP,
      slot: player.slot,
      cardId: card.id,
      cardName: card.name,
      rarity: card.rarity,
      category: card.category,
      displayName: player.displayName,
    };
    for (const p of players.values()) {
      // Include abilities list for the recipient
      if (p.client.id === player.client.id && hasAbilityEffect(card.effect)) {
        send(p.client, { ...pickupMsg, abilities: [...cards.getBuffs(player.client.id).abilities] } as any);
      } else {
        send(p.client, pickupMsg);
      }
    }

    console.log(`[Cards] Auto-granted "${card.name}" (${card.rarity} ${card.category}) to ${player.displayName}`);
  }

  function applyToEntity(player: SessionPlayer, card: CardDefinition, send: SendFn): void {
    if (!player.entityId) return;
    applyEffectToEntity(player, card.effect, send);
  }

  function applyEffectToEntity(player: SessionPlayer, effect: CardEffect, send: SendFn): void {
    const eid = player.entityId!;
    const buffs = cards.getBuffs(player.client.id);

    if (effect.type === 'stat_buff') {
      if (effect.stat === 'speed') {
        const spd = world.getComponent<SpeedComponent>(eid, C.Speed);
        if (spd) spd.multiplier = buffs.speedMultiplier;
      } else if (effect.stat === 'maxHp') {
        const hp = world.getComponent<HealthComponent>(eid, C.Health);
        if (hp) {
          const baseHp = CLASS_STATS[player.playerClass].hp;
          const skillMod = deps.getSkillMaxHpBonus?.(player.client.id) ?? 0;
          hp.max = Math.max(1, baseHp + skillMod + buffs.maxHpBonus - cards.debuffs.playerMaxHpPenalty);
          hp.current = Math.min(hp.current + Math.max(0, effect.value), hp.max);
        }
      } else if (effect.stat === 'defense') {
        const def = world.getComponent<DefenseComponent>(eid, C.Defense);
        if (def) def.flat = buffs.defenseBonus;
      } else if (effect.stat === 'maxStamina') {
        const stam = world.getComponent<StaminaComponent>(eid, C.Stamina);
        if (stam) { stam.max += effect.value; stam.current = Math.min(stam.current + effect.value, stam.max); }
      } else if (effect.stat === 'knockbackResist') {
        const kb = world.getComponent<KnockbackReceiverComponent>(eid, C.KnockbackReceiver);
        if (kb) kb.resist = buffs.knockbackResist;
      }
    } else if (effect.type === 'resource') {
      creditResources(eid, effect.resource, effect.amount, send);
    } else if (effect.type === 'trap_player') {
      if (effect.stat === 'speed') {
        for (const p of players.values()) {
          if (!p.entityId) continue;
          const pBuffs = cards.getBuffs(p.client.id);
          const spd = world.getComponent<SpeedComponent>(p.entityId, C.Speed);
          if (spd) spd.multiplier = pBuffs.speedMultiplier;
        }
      } else if (effect.stat === 'maxHp') {
        for (const p of players.values()) {
          if (!p.entityId) continue;
          const pBuffs = cards.getBuffs(p.client.id);
          const hp = world.getComponent<HealthComponent>(p.entityId, C.Health);
          if (hp) {
            const pBaseHp = CLASS_STATS[p.playerClass].hp;
            const pSkillMod = deps.getSkillMaxHpBonus?.(p.client.id) ?? 0;
            hp.max = Math.max(1, pBaseHp + pSkillMod + pBuffs.maxHpBonus - cards.debuffs.playerMaxHpPenalty);
            hp.current = Math.min(hp.current, hp.max);
          }
        }
      }
    } else if (effect.type === 'multi') {
      for (const sub of effect.effects) applyEffectToEntity(player, sub, send);
    }
  }

  /** Check if a card effect contains any ability effects (including inside multi). */
  function hasAbilityEffect(effect: CardEffect): boolean {
    if (effect.type === 'ability') return true;
    if (effect.type === 'multi') return effect.effects.some(hasAbilityEffect);
    return false;
  }

  function tickHpRegen(dt: number): void {
    for (const p of players.values()) {
      if (!p.entityId) continue;
      const buffs = cards.playerBuffs.get(p.client.id);
      if (!buffs || buffs.hpRegen <= 0) continue;
      const hp = world.getComponent<HealthComponent>(p.entityId, C.Health);
      if (!hp || hp.current >= hp.max || hp.current <= 0) continue;
      if (world.hasComponent(p.entityId, C.Downed)) continue;
      hp.current = Math.min(hp.max, hp.current + buffs.hpRegen * dt);
    }
  }

  return {
    autoGrant,
    tickHpRegen,
  };
}

export type CardDispenser = ReturnType<typeof createCardDispenser>;
