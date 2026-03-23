// Protocol social and event messages - Chat, pause, waves, day/night, sleep,
// wave modifiers, world events, notifications, debug, meta stats, enemy/boss intros, card drops.

import { BaseMessage, MessageType } from './base';

// ---- Chat ----

export interface ChatMessage extends BaseMessage {
  type: typeof MessageType.CHAT;
  /** Sender's display name (set by server on broadcast). */
  displayName: string;
  /** Sender's slot (set by server). */
  slot: number;
  text: string;
}

/** Client -> Server chat (no displayName/slot - server fills those). */
export interface ChatSendMessage extends BaseMessage {
  type: typeof MessageType.CHAT;
  text: string;
  displayName?: undefined;
  slot?: undefined;
}

// ---- Pause ----

/** Client -> Server: the player wants to pause (or resume). */
export interface PauseVoteMessage extends BaseMessage {
  type: typeof MessageType.PAUSE_VOTE;
}

/** Server -> all: intermediate vote tally while collecting votes. */
export interface PauseVoteUpdateMessage extends BaseMessage {
  type: typeof MessageType.PAUSE_VOTE_UPDATE;
  /** 'pause' if collecting votes to pause, 'resume' if collecting votes to resume. */
  direction: 'pause' | 'resume';
  /** Display names of players who have voted so far. */
  voters: string[];
  /** Total number of votes needed (= player count). */
  required: number;
}

/** Server -> all: authoritative pause state transition. */
export interface PauseStateMessage extends BaseMessage {
  type: typeof MessageType.PAUSE_STATE;
  /** True = game is now paused. False = game has resumed. */
  paused: boolean;
  /** Server-authoritative elapsed play time in seconds (excludes paused time). */
  elapsedTime?: number;
}

// ---- Waves ----

/** Server -> all: a wave is starting (prep countdown or portals activating). */
export interface WaveStartMessage extends BaseMessage {
  type: typeof MessageType.WAVE_START;
  waveNumber: number;
  /** Seconds of prep time before portals activate (0 = portals are now live). */
  prepDuration: number;
}

/** Server -> all: a wave has ended (all portals destroyed). */
export interface WaveEndMessage extends BaseMessage {
  type: typeof MessageType.WAVE_END;
  waveNumber: number;
  outcome: 'cleared' | 'failed';
}

/** Server -> all: authoritative timer sync (sent on pause/resume + periodic drift correction). */
export interface WaveTimerSyncMessage extends BaseMessage {
  type: typeof MessageType.WAVE_TIMER_SYNC;
  waveNumber: number;
  /** Seconds remaining in prep phase (-1 if active or idle). */
  remaining: number;
  /** True if the wave timer is currently paused (debug). */
  paused: boolean;
}

// ---- Notification ----

/** Server -> client: generic notification toast. */
export interface NotificationMessage extends BaseMessage {
  type: typeof MessageType.NOTIFICATION;
  text: string;
  level: 'info' | 'warning' | 'danger' | 'success';
}

// ---- Day/Night (Phase 9) ----

export type DayNightPhase = 'day' | 'dusk' | 'night' | 'dawn';

/** Server -> all: day/night phase sync. */
export interface DayNightSyncMessage extends BaseMessage {
  type: typeof MessageType.DAY_NIGHT_SYNC;
  phase: DayNightPhase;
  /** Current darkness level (0 = full day, 1 = full night). */
  darkness: number;
  /** Seconds remaining in the day phase (-1 if not day). */
  dayTimeRemaining: number;
  /** Number of players who have voted to sleep. */
  sleepVotes: number;
  /** Total connected players. */
  totalPlayers: number;
}

/** Client -> Server: player votes to sleep or cancels. */
export interface SleepVoteMessage extends BaseMessage {
  type: typeof MessageType.SLEEP_VOTE;
  /** True = vote to sleep, false = cancel vote. */
  vote: boolean;
}

/** Server -> all: sleep vote tally update. */
export interface SleepUpdateMessage extends BaseMessage {
  type: typeof MessageType.SLEEP_UPDATE;
  votes: number;
  needed: number;
  /** Slots of players who have voted. */
  voterSlots: number[];
}

// ---- Wave Modifiers & World Events ----

/** Server -> all: wave modifier(s) rolled for the upcoming wave. */
export interface WaveModifierMessage extends BaseMessage {
  type: typeof MessageType.WAVE_MODIFIER;
  waveNumber: number;
  modifiers: { id: string; name: string; description: string; color: number }[];
}

/** Server -> all: day event roulette result (sent at start of each day). */
export interface DayEventRollMessage extends BaseMessage {
  type: typeof MessageType.DAY_EVENT_ROLL;
  /** The event that was rolled, or null for safe day. */
  eventId: string | null;
  eventName: string | null;
}

/** Server -> all: a world event has started. */
export interface WorldEventStartMessage extends BaseMessage {
  type: typeof MessageType.WORLD_EVENT_START;
  eventId: string;
  name: string;
  /** Short description of what the event does. */
  description: string;
  /** Duration in seconds (0 = instant). */
  duration: number;
  /** Ambient tint color override (Blood Moon). */
  tintColor?: number;
  /** Torch/vision radius multiplier (Solar Eclipse). */
  visionMult?: number;
  /** Enemy damage multiplier while event is active. */
  damageMult?: number;
  /** Production speed multiplier (Resource Boom). */
  productionMult?: number;
  /** Camera shake intensity (Earthquake). */
  shakeIntensity?: number;
}

/** Server -> all: a world event has ended. */
export interface WorldEventEndMessage extends BaseMessage {
  type: typeof MessageType.WORLD_EVENT_END;
  eventId: string;
}

// ---- Enemy & Boss Intros ----

/** Server -> all: a new enemy type appeared for the first time this run. */
export interface EnemyIntroMessage extends BaseMessage {
  type: typeof MessageType.ENEMY_INTRO;
  variant: string;
  displayName: string;
}

/** Server -> all: a boss enemy has spawned. */
export interface BossIntroMessage extends BaseMessage {
  type: typeof MessageType.BOSS_INTRO;
  bossId: string;
  bossName: string;
  entityId: number;
  description: string;
  maxHp: number;
}

/** Server -> all: a boss changed phase. */
export interface BossPhaseMessage extends BaseMessage {
  type: typeof MessageType.BOSS_PHASE;
  entityId: number;
  bossId: string;
  phaseIndex: number;
  bannerText: string;
}

// ---- Card Drops ----

/** Server -> all: a player picked up a card drop. */
export interface CardPickupMessage extends BaseMessage {
  type: typeof MessageType.CARD_PICKUP;
  /** Slot of the player who picked up the card. */
  slot: number;
  cardId: string;
  cardName: string;
  rarity: string;
  category: string;
  displayName: string;
}

// ---- Meta Stats ----

/** Client -> Server: request persistent meta stats. */
export interface MetaStatsRequestMessage extends BaseMessage {
  type: typeof MessageType.META_STATS_REQUEST;
}

/** Server -> Client: persistent meta stats response. */
export interface MetaStatsResponseMessage extends BaseMessage {
  type: typeof MessageType.META_STATS_RESPONSE;
  stats: import('../definitions/MetaStats').MetaStats;
}

/** Client -> Server: upload local meta stats for sync (singleplayer -> remote). */
export interface MetaStatsUploadMessage extends BaseMessage {
  type: typeof MessageType.META_STATS_UPLOAD;
  stats: import('../definitions/MetaStats').MetaStats;
}

// ---- Debug ----

export interface DebugSpawnEnemiesMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_SPAWN_ENEMIES;
  /** Number of enemies to spawn (capped server-side). Defaults to 5. */
  count?: number;
}

export interface DebugGiveCardMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_GIVE_CARD;
  cardId: string;
}

export interface DebugGiveSkillPointsMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_GIVE_SKILL_POINTS;
  count?: number;
}

export interface DebugSetTimeMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_SET_TIME;
  seconds: number;
}

export interface DebugForceModifierMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_FORCE_MODIFIER;
  modifierId: string;
}

export interface DebugForceEventMessage extends BaseMessage {
  type: typeof MessageType.DEBUG_FORCE_EVENT;
  eventId: string;
}
