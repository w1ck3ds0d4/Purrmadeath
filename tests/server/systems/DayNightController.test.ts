import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDayNightController,
  createDayNightState,
  type DayNightState,
  type DayNightControllerDeps,
} from '../../../server/systems/DayNightController';
import { DAY_MAX_DURATION, DUSK_DAWN_DURATION } from '@shared/constants';
import type { ConnectedClient } from '../../../server/net/ServerSocket';
import type { SendFn, SessionPlayer } from '../../../server/core/GameSession';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockSend(): SendFn {
  return vi.fn() as unknown as SendFn;
}

function createMockPlayer(slot: number, connected = true): SessionPlayer {
  return {
    slot,
    client: connected ? ({ id: `client-${slot}` } as ConnectedClient) : null,
    entityId: slot + 100,
    isHost: slot === 0,
    displayName: `Player${slot}`,
  } as SessionPlayer;
}

function setup(playerCount = 1) {
  const state = createDayNightState();
  const players = new Map<string, SessionPlayer>();
  for (let i = 0; i < playerCount; i++) {
    const p = createMockPlayer(i);
    players.set(`client-${i}`, p);
  }

  const onNightStart = vi.fn();
  const onDayStart = vi.fn();

  const deps: DayNightControllerDeps = {
    state,
    players,
    onNightStart,
    onDayStart,
  };

  const controller = createDayNightController(deps);
  const send = mockSend();

  return { state, players, controller, send, onNightStart, onDayStart };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DayNightController', () => {
  describe('initial state', () => {
    it('starts in day phase with full timer', () => {
      const { state } = setup();
      expect(state.phase).toBe('day');
      expect(state.dayTimer).toBe(DAY_MAX_DURATION);
      expect(state.darkness).toBe(0);
    });
  });

  describe('day phase', () => {
    it('decrements day timer', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(10, send);
      expect(state.dayTimer).toBe(DAY_MAX_DURATION - 10);
    });

    it('transitions to dusk when timer expires', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send);
      expect(state.phase).toBe('dusk');
    });
  });

  describe('dusk phase', () => {
    it('increases darkness from 0 to 1', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk

      // Tick halfway through dusk
      controller.tick(DUSK_DAWN_DURATION / 2, send);
      expect(state.darkness).toBeGreaterThan(0.3);
      expect(state.darkness).toBeLessThan(0.7);
    });

    it('transitions to night after dusk duration', () => {
      const { state, controller, send, onNightStart } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night

      expect(state.phase).toBe('night');
      expect(state.darkness).toBe(1);
      expect(onNightStart).toHaveBeenCalled();
    });
  });

  describe('night phase', () => {
    it('stays in night until wave cleared', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night

      // Tick many seconds - should stay night
      controller.tick(100, send);
      expect(state.phase).toBe('night');
      expect(state.darkness).toBe(1);
    });

    it('transitions to dawn when wave cleared', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night

      controller.onWaveCleared(send);
      expect(state.phase).toBe('dawn');
    });
  });

  describe('dawn phase', () => {
    it('decreases darkness from 1 to 0', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night
      controller.onWaveCleared(send); // → dawn

      controller.tick(DUSK_DAWN_DURATION / 2, send);
      expect(state.darkness).toBeGreaterThan(0.3);
      expect(state.darkness).toBeLessThan(0.7);
    });

    it('transitions back to day after dawn duration', () => {
      const { state, controller, send, onDayStart } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night
      controller.onWaveCleared(send); // → dawn
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → day

      expect(state.phase).toBe('day');
      expect(state.darkness).toBe(0);
      expect(state.dayTimer).toBe(DAY_MAX_DURATION);
      expect(onDayStart).toHaveBeenCalled();
    });
  });

  describe('sleep voting', () => {
    it('single player vote triggers dusk', () => {
      const { state, controller, send } = setup(1);
      controller.startFirstDay(send);

      controller.voteSleep(0, true, send);
      expect(state.phase).toBe('dusk');
    });

    it('requires all players to vote in multiplayer', () => {
      const { state, controller, send } = setup(3);
      controller.startFirstDay(send);

      controller.voteSleep(0, true, send);
      expect(state.phase).toBe('day');

      controller.voteSleep(1, true, send);
      expect(state.phase).toBe('day');

      controller.voteSleep(2, true, send);
      expect(state.phase).toBe('dusk');
    });

    it('cancelling vote prevents transition', () => {
      const { state, controller, send } = setup(2);
      controller.startFirstDay(send);

      controller.voteSleep(0, true, send);
      controller.voteSleep(1, true, send);
      // Already in dusk from previous vote
    });

    it('cancel before all voted keeps day', () => {
      const { state, controller, send } = setup(2);
      controller.startFirstDay(send);

      controller.voteSleep(0, true, send);
      controller.voteSleep(0, false, send); // cancel
      controller.voteSleep(1, true, send);
      expect(state.phase).toBe('day'); // only 1/2 voted
    });

    it('ignores votes outside day phase', () => {
      const { state, controller, send } = setup(1);
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night

      controller.voteSleep(0, true, send);
      expect(state.phase).toBe('night'); // unchanged
    });

    it('votes cleared on new day', () => {
      const { state, controller, send } = setup(2);
      controller.startFirstDay(send);
      expect(state.sleepVotes.size).toBe(0);

      controller.voteSleep(0, true, send);
      expect(state.sleepVotes.size).toBe(1);

      // Full cycle back to day
      controller.voteSleep(1, true, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night
      controller.onWaveCleared(send); // → dawn
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → day

      expect(state.sleepVotes.size).toBe(0);
    });
  });

  describe('player disconnect', () => {
    it('removes vote and re-checks threshold', () => {
      const { state, players, controller, send } = setup(2);
      controller.startFirstDay(send);

      controller.voteSleep(0, true, send);
      expect(state.phase).toBe('day');

      // Player 1 disconnects - now only 1 player, 1 vote = all voted
      players.get('client-1')!.client = null as unknown as ConnectedClient;
      controller.onPlayerDisconnect(1, send);
      expect(state.phase).toBe('dusk');
    });
  });

  describe('permanent night', () => {
    it('skips dawn and stays at darkness 1', () => {
      const { state, controller, send, onDayStart } = setup();
      state.permanentNight = true;
      controller.startFirstDay(send);

      expect(state.phase).toBe('night');
      expect(state.darkness).toBe(1);
    });

    it('after wave cleared, goes to night not day', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night

      state.permanentNight = true;
      controller.onWaveCleared(send); // dawn → startDay → night (permanent)

      expect(state.phase).toBe('night');
      expect(state.darkness).toBe(1);
    });
  });

  describe('debug commands', () => {
    it('debugSkipToNight skips from day to dusk', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);

      controller.debugSkipToNight(send);
      expect(state.phase).toBe('dusk');
    });

    it('debugSkipToNight does nothing if not day', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night

      controller.debugSkipToNight(send);
      expect(state.phase).toBe('night'); // unchanged
    });

    it('debugSkipToDay from night triggers dawn', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night

      controller.debugSkipToDay(send);
      expect(state.phase).toBe('dawn');
    });

    it('debugSkipToDay from dusk goes to day', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk

      controller.debugSkipToDay(send);
      expect(state.phase).toBe('day');
    });

    it('debugSetTime changes day timer', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);

      controller.debugSetTime(30, send);
      expect(state.dayTimer).toBe(30);
    });

    it('debugSetTime clamps to valid range', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);

      controller.debugSetTime(-10, send);
      expect(state.dayTimer).toBe(0);

      controller.debugSetTime(99999, send);
      expect(state.dayTimer).toBe(DAY_MAX_DURATION);
    });

    it('debugSetTime does nothing outside day phase', () => {
      const { state, controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night

      controller.debugSetTime(100, send);
      // dayTimer should not be 100 since we're in night phase
      expect(state.phase).toBe('night');
    });
  });

  describe('enemy buffs', () => {
    it('returns 1x during day', () => {
      const { controller, send } = setup();
      controller.startFirstDay(send);
      const buffs = controller.getEnemyBuffs();
      expect(buffs.damageMult).toBe(1);
      expect(buffs.speedMult).toBe(1);
    });

    it('returns full buffs during night', () => {
      const { controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION + 1, send); // → night

      const buffs = controller.getEnemyBuffs();
      expect(buffs.damageMult).toBeGreaterThan(1);
      expect(buffs.speedMult).toBeGreaterThan(1);
    });

    it('ramps up during dusk', () => {
      const { controller, send } = setup();
      controller.startFirstDay(send);
      controller.tick(DAY_MAX_DURATION + 1, send); // → dusk
      controller.tick(DUSK_DAWN_DURATION / 2, send); // mid-dusk

      const buffs = controller.getEnemyBuffs();
      expect(buffs.damageMult).toBeGreaterThan(1);
      expect(buffs.damageMult).toBeLessThan(1.15);
    });
  });
});
