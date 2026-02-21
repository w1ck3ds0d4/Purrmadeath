import { World } from '@shared/ecs/World';
import {
  C,
  HealthComponent,
} from '@shared/components';
import type { SpeedComponent } from '@shared/components';
import { PLAYER_MAX_HEALTH } from '@shared/constants';
import { MessageType } from '@shared/protocol';
import type { CardOfferMessage, CardAppliedMessage, CardPickMessage } from '@shared/protocol';
import type { CardDefinition } from '@shared/CardDefinitions';
import type { ConnectedClient } from '../net/ServerSocket';
import type { SessionPlayer, SendFn } from '../GameSession';
import type { CardSystem } from '../CardSystem';

// ── Mutable state shared with GameSession ───────────────────────────────────

export interface CardState {
  offerTimer: number; // seconds remaining, -1 = no pending offer
}

// ── Dependencies ────────────────────────────────────────────────────────────

export interface CardDispenserDeps {
  world: World;
  cards: CardSystem;
  state: CardState;
  players: Map<string, SessionPlayer>;
  offerTimeout: number;
  setPaused: (value: boolean) => void;
  creditResources: (entityId: number, resource: string, amount: number, send: SendFn) => void;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createCardDispenser(deps: CardDispenserDeps) {
  const { world, cards, players, setPaused, creditResources } = deps;
  const s = deps.state;

  function sendOffers(send: SendFn): void {
    for (const p of players.values()) {
      const offer = cards.generateOffer();
      cards.setPendingOffer(p.client.id, offer);
      const msg: CardOfferMessage = { type: MessageType.CARD_OFFER, cards: offer };
      send(p.client, msg);
    }
    s.offerTimer = deps.offerTimeout;
    setPaused(true);
    console.log(`[Cards] Card offers sent to ${players.size} player(s)`);
  }

  function handlePick(clientId: string, msg: CardPickMessage, send: SendFn): void {
    const player = players.get(clientId);
    if (!player) return;

    const card = cards.applyPick(clientId, msg.cardId);
    if (!card) return;

    applyToEntity(player, card, send);

    const applied: CardAppliedMessage = {
      type: MessageType.CARD_APPLIED,
      displayName: player.displayName,
      cardName: card.name,
      category: card.category,
      isTrap: card.category === 'trap',
    };
    for (const p of players.values()) send(p.client, applied);

    let anyPending = false;
    for (const p of players.values()) {
      if (cards.hasPendingOffer(p.client.id)) { anyPending = true; break; }
    }
    if (!anyPending) {
      s.offerTimer = -1;
      setPaused(false);
    }
  }

  function tickTimer(dt: number, send: SendFn): void {
    if (s.offerTimer < 0) return;
    s.offerTimer -= dt;
    if (s.offerTimer > 0) return;

    s.offerTimer = -1;
    setPaused(false);
    for (const p of players.values()) {
      if (!cards.hasPendingOffer(p.client.id)) continue;
      const card = cards.autoPickNonTrap(p.client.id);
      if (!card) continue;

      applyToEntity(p, card, send);

      const applied: CardAppliedMessage = {
        type: MessageType.CARD_APPLIED,
        displayName: p.displayName,
        cardName: card.name,
        category: card.category,
        isTrap: card.category === 'trap',
      };
      for (const pp of players.values()) send(pp.client, applied);
    }
  }

  function applyToEntity(player: SessionPlayer, card: CardDefinition, send: SendFn): void {
    if (!player.entityId) return;
    const eid = player.entityId;
    const buffs = cards.getBuffs(player.client.id);
    const effect = card.effect;

    if (effect.type === 'stat_buff') {
      if (effect.stat === 'speed') {
        const spd = world.getComponent<SpeedComponent>(eid, C.Speed);
        if (spd) spd.multiplier = buffs.speedMultiplier;
      } else if (effect.stat === 'maxHp') {
        const hp = world.getComponent<HealthComponent>(eid, C.Health);
        if (hp) {
          hp.max = PLAYER_MAX_HEALTH + buffs.maxHpBonus;
          hp.current = Math.min(hp.current + effect.value, hp.max);
        }
      }
    } else if (effect.type === 'resource') {
      creditResources(eid, effect.resource, effect.amount, send);
    } else if (effect.type === 'trap_player' && effect.stat === 'speed') {
      for (const p of players.values()) {
        if (!p.entityId) continue;
        const pBuffs = cards.getBuffs(p.client.id);
        const spd = world.getComponent<SpeedComponent>(p.entityId, C.Speed);
        if (spd) spd.multiplier = pBuffs.speedMultiplier;
      }
    }
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
    sendOffers,
    handlePick,
    tickTimer,
    tickHpRegen,
  };
}

export type CardDispenser = ReturnType<typeof createCardDispenser>;
