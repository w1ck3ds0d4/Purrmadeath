// ---------------------------------------------------------------------------
// WaveModifierSystem - rolls and tracks per-wave modifiers
// ---------------------------------------------------------------------------

import {
  type WaveModifierId,
  WAVE_MODIFIERS,
  pickWaveModifiers,
  computeModifierAggregate,
  type ModifierAggregate,
} from '@shared/definitions/WaveModifiers';
import { MessageType } from '@shared/protocol';
import type { WaveModifierMessage } from '@shared/protocol';
import type { SendFn, SessionPlayer } from '../core/GameSession';

const EMPTY_AGGREGATE: ModifierAggregate = {
  enemyCountMult: 1, enemyHpMult: 1, enemySpeedMult: 1, enemyDamageMult: 1, visionMult: 1,
};

export function createWaveModifierSystem(players: Map<string, SessionPlayer>) {
  let active: WaveModifierId[] = [];
  let aggregate: ModifierAggregate = { ...EMPTY_AGGREGATE };

  return {
    /** Roll modifier(s) for the given wave and broadcast to clients. */
    rollModifiers(wave: number, send: SendFn): WaveModifierId[] {
      active = pickWaveModifiers(wave);
      aggregate = active.length > 0 ? computeModifierAggregate(active) : { ...EMPTY_AGGREGATE };

      if (active.length > 0) {
        const msg: WaveModifierMessage = {
          type: MessageType.WAVE_MODIFIER,
          waveNumber: wave,
          modifiers: active.map(id => {
            const def = WAVE_MODIFIERS[id];
            return { id: def.id, name: def.name, description: def.description, color: def.color };
          }),
        };
        for (const p of players.values()) send(p.client, msg);
        console.log(`[WaveModifier] Wave ${wave}: ${active.join(', ')}`);
      }

      return active;
    },

    /** Get the combined multipliers of all active modifiers. */
    getAggregate(): ModifierAggregate {
      return aggregate;
    },

    /** Get the list of active modifier IDs. */
    getActive(): WaveModifierId[] {
      return active;
    },

    /** Force-apply a specific modifier (debug command). */
    forceModifier(modifierId: WaveModifierId, wave: number, send: SendFn): void {
      if (!WAVE_MODIFIERS[modifierId]) return;
      active.push(modifierId);
      aggregate = computeModifierAggregate(active);

      const msg: WaveModifierMessage = {
        type: MessageType.WAVE_MODIFIER,
        waveNumber: wave,
        modifiers: active.map(id => {
          const def = WAVE_MODIFIERS[id];
          return { id: def.id, name: def.name, description: def.description, color: def.color };
        }),
      };
      for (const p of players.values()) send(p.client, msg);
      console.log(`[WaveModifier] Forced: ${modifierId}`);
    },

    /** Clear modifiers (call on wave end). */
    clear(): void {
      active = [];
      aggregate = { ...EMPTY_AGGREGATE };
    },
  };
}

export type WaveModifierSystem = ReturnType<typeof createWaveModifierSystem>;
