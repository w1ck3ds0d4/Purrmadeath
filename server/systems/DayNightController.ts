import {
  DAY_MAX_DURATION,
  DUSK_DAWN_DURATION,
  NIGHT_ENEMY_DAMAGE_BUFF,
  NIGHT_ENEMY_SPEED_BUFF,
  DAY_NIGHT_SYNC_INTERVAL,
} from '@shared/constants';
import { MessageType } from '@shared/protocol';
import type { DayNightSyncMessage, SleepUpdateMessage, DayNightPhase } from '@shared/protocol';
import type { ConnectedClient } from '../net/ServerSocket';
import type { SessionPlayer, SendFn } from '../core/GameSession';

// ── State ────────────────────────────────────────────────────────────────────

export interface DayNightState {
  phase: DayNightPhase;
  /** Seconds remaining in day phase (counts down). */
  dayTimer: number;
  /** Progress through dusk/dawn transition (0→1). */
  transitionProgress: number;
  /** Current darkness level (0 = full day, 1 = full night). Derived. */
  darkness: number;
  /** Player slots that have voted to sleep. */
  sleepVotes: Set<number>;
  /** When true, night never ends (W50 milestone). */
  permanentNight: boolean;
  /** Sync broadcast timer. */
  syncTimer: number;
  /** When true, the day timer is paused (via /pause command). */
  dayPaused: boolean;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface DayNightControllerDeps {
  state: DayNightState;
  players: Map<string, SessionPlayer>;
  /** Called when dusk transition completes → night begins. WaveController should start the wave. */
  onNightStart: (send: SendFn) => void;
  /** Called when dawn transition completes → day begins. */
  onDayStart: (send: SendFn) => void;
  /** Optional: world event overrides (solar eclipse forces night buffs during day). */
  getEventOverrides?: () => { forceNightBuffs?: boolean };
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createDayNightController(deps: DayNightControllerDeps) {
  const { players } = deps;
  const s = deps.state;

  // ── Helpers ─────────────────────────────────────────────────────────────

  function connectedPlayerCount(): number {
    let count = 0;
    for (const p of players.values()) {
      if (p.client) count++;
    }
    return count;
  }

  function updateDarkness(): void {
    switch (s.phase) {
      case 'day':
        // Solar eclipse forces partial darkness during the day
        s.darkness = deps.getEventOverrides?.()?.forceNightBuffs ? 0.7 : 0;
        break;
      case 'dusk':
        s.darkness = s.transitionProgress;
        break;
      case 'night':
        s.darkness = 1;
        break;
      case 'dawn':
        s.darkness = 1 - s.transitionProgress;
        break;
    }
  }

  function broadcastSync(send: SendFn): void {
    const msg: DayNightSyncMessage = {
      type: MessageType.DAY_NIGHT_SYNC,
      phase: s.phase,
      darkness: s.darkness,
      dayTimeRemaining: s.phase === 'day' ? s.dayTimer : -1,
      sleepVotes: s.sleepVotes.size,
      totalPlayers: connectedPlayerCount(),
    };
    for (const p of players.values()) {
      if (p.client) send(p.client, msg);
    }
  }

  function broadcastSleepUpdate(send: SendFn): void {
    const needed = connectedPlayerCount();
    const msg: SleepUpdateMessage = {
      type: MessageType.SLEEP_UPDATE,
      votes: s.sleepVotes.size,
      needed,
      voterSlots: Array.from(s.sleepVotes),
    };
    for (const p of players.values()) {
      if (p.client) send(p.client, msg);
    }
  }

  function startDusk(send: SendFn): void {
    s.phase = 'dusk';
    s.transitionProgress = 0;
    s.sleepVotes.clear();
    console.log('[DayNight] Dusk begins - transitioning to night');
    broadcastSync(send);
  }

  function startNight(send: SendFn): void {
    s.phase = 'night';
    s.darkness = 1;
    console.log('[DayNight] Night begins');
    broadcastSync(send);
    deps.onNightStart(send);
  }

  function startDawn(send: SendFn): void {
    if (s.permanentNight) {
      // W50 milestone: skip dawn, stay night → go directly to day timer but keep darkness
      startDay(send);
      return;
    }
    s.phase = 'dawn';
    s.transitionProgress = 0;
    console.log('[DayNight] Dawn begins - transitioning to day');
    broadcastSync(send);
  }

  function startDay(send: SendFn): void {
    s.phase = s.permanentNight ? 'night' : 'day';
    s.dayTimer = DAY_MAX_DURATION;
    s.sleepVotes.clear();
    s.transitionProgress = 0;
    if (s.permanentNight) {
      s.darkness = 1;
    } else {
      s.darkness = 0;
    }
    console.log(`[DayNight] ${s.permanentNight ? 'Permanent night - day timer reset' : 'Day begins'} (${DAY_MAX_DURATION}s)`);
    broadcastSync(send);
    deps.onDayStart(send);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  function tick(dt: number, send: SendFn): void {
    switch (s.phase) {
      case 'day': {
        if (!s.dayPaused) s.dayTimer -= dt;
        updateDarkness(); // re-evaluate eclipse darkness each tick

        // Periodic sync
        s.syncTimer += dt;
        if (s.syncTimer >= DAY_NIGHT_SYNC_INTERVAL) {
          s.syncTimer = 0;
          broadcastSync(send);
        }

        // Day expires → forced dusk
        if (s.dayTimer <= 0) {
          startDusk(send);
        }
        break;
      }

      case 'dusk': {
        s.transitionProgress += dt / DUSK_DAWN_DURATION;
        updateDarkness();
        if (s.transitionProgress >= 1) {
          startNight(send);
        }
        break;
      }

      case 'night': {
        // Night has no timer - it ends when wave is cleared (external call to onWaveCleared)
        break;
      }

      case 'dawn': {
        s.transitionProgress += dt / DUSK_DAWN_DURATION;
        updateDarkness();
        if (s.transitionProgress >= 1) {
          startDay(send);
        }
        break;
      }
    }
  }

  /** Player votes to sleep (or cancels). */
  function voteSleep(slot: number, vote: boolean, send: SendFn): void {
    if (s.phase !== 'day') return;

    if (vote) {
      s.sleepVotes.add(slot);
    } else {
      s.sleepVotes.delete(slot);
    }

    broadcastSleepUpdate(send);

    // Check if all connected players have voted
    const needed = connectedPlayerCount();
    if (s.sleepVotes.size >= needed && needed > 0) {
      console.log(`[DayNight] All ${needed} players voted to sleep`);
      startDusk(send);
    }
  }

  /** Called by WaveController when the wave is cleared → begin dawn. */
  function onWaveCleared(send: SendFn): void {
    if (s.phase === 'night') {
      startDawn(send);
    }
  }

  /** Called when a player disconnects - remove their vote and re-check. */
  function onPlayerDisconnect(slot: number, send: SendFn): void {
    s.sleepVotes.delete(slot);
    if (s.phase === 'day') {
      broadcastSleepUpdate(send);
      // Re-check in case remaining players all voted
      const needed = connectedPlayerCount();
      if (s.sleepVotes.size >= needed && needed > 0) {
        startDusk(send);
      }
    }
  }

  function isNight(): boolean {
    return s.phase === 'night' || s.phase === 'dusk';
  }

  function getDarkness(): number {
    return s.darkness;
  }

  function getEnemyBuffs(): { damageMult: number; speedMult: number } {
    // Solar eclipse forces night buffs during day
    const overrides = deps.getEventOverrides?.();
    if (overrides?.forceNightBuffs) {
      return { damageMult: NIGHT_ENEMY_DAMAGE_BUFF, speedMult: NIGHT_ENEMY_SPEED_BUFF };
    }
    if (s.phase === 'night' || s.permanentNight) {
      return { damageMult: NIGHT_ENEMY_DAMAGE_BUFF, speedMult: NIGHT_ENEMY_SPEED_BUFF };
    }
    if (s.phase === 'dusk') {
      // Ramp up during dusk
      const d = s.transitionProgress;
      return {
        damageMult: 1 + (NIGHT_ENEMY_DAMAGE_BUFF - 1) * d,
        speedMult: 1 + (NIGHT_ENEMY_SPEED_BUFF - 1) * d,
      };
    }
    return { damageMult: 1, speedMult: 1 };
  }

  /** Begin the first day (called once when game starts). */
  function startFirstDay(send: SendFn, savedTimer?: number): void {
    s.dayTimer = (savedTimer != null && savedTimer > 0) ? savedTimer : DAY_MAX_DURATION;
    s.phase = s.permanentNight ? 'night' : 'day';
    s.darkness = s.permanentNight ? 1 : 0;
    s.sleepVotes.clear();
    s.syncTimer = 0;
    broadcastSync(send);
  }

  /** Toggle day timer pause state. Returns the new paused value. */
  function toggleDayPause(): boolean {
    s.dayPaused = !s.dayPaused;
    return s.dayPaused;
  }

  /** Debug: skip to night immediately. */
  function debugSkipToNight(send: SendFn): void {
    if (s.phase === 'day') {
      console.log('[Debug] Skipping to night');
      startDusk(send);
    }
  }

  /** Debug: skip to day immediately (end night/dusk). */
  function debugSkipToDay(send: SendFn): void {
    if (s.phase === 'night') {
      console.log('[Debug] Skipping to day (from night)');
      startDawn(send);
    } else if (s.phase === 'dusk') {
      console.log('[Debug] Skipping to day (from dusk)');
      startDay(send);
    }
  }

  /** Debug: set day timer to specific seconds. */
  function debugSetTime(seconds: number, send: SendFn): void {
    if (s.phase === 'day') {
      s.dayTimer = Math.max(0, Math.min(DAY_MAX_DURATION, seconds));
      console.log(`[Debug] Day timer set to ${s.dayTimer.toFixed(0)}s`);
      broadcastSync(send);
    }
  }

  return {
    tick,
    voteSleep,
    onWaveCleared,
    onPlayerDisconnect,
    isNight,
    getDarkness,
    getEnemyBuffs,
    startFirstDay,
    startDawn,
    startDay,
    debugSkipToNight,
    debugSkipToDay,
    debugSetTime,
    toggleDayPause,
    broadcastSync,
  };
}

export type DayNightController = ReturnType<typeof createDayNightController>;

/** Create a fresh DayNightState. */
export function createDayNightState(): DayNightState {
  return {
    phase: 'day',
    dayTimer: DAY_MAX_DURATION,
    transitionProgress: 0,
    darkness: 0,
    sleepVotes: new Set(),
    permanentNight: false,
    syncTimer: 0,
    dayPaused: false,
  };
}
