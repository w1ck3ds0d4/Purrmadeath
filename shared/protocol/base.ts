// Protocol base types - MessageType enum, BaseMessage, and ErrorMessage.
// All other protocol files import from here.

// ---- Message type registry ----
// Every WebSocket message carries a `type` field from this enum.
// Add new types here as phases are implemented - never inline magic strings.

export enum MessageType {
  // -- Lifecycle --
  /** Client -> Server on connect: identify self */
  HANDSHAKE = 'HANDSHAKE',
  /** Server -> Client: confirm connection, assign client ID */
  HANDSHAKE_ACK = 'HANDSHAKE_ACK',

  // -- Heartbeat --
  PING = 'PING',
  PONG = 'PONG',

  // -- Errors --
  ERROR = 'ERROR',

  // -- Session --
  /** Client -> Server: create a new session (host) */
  SESSION_CREATE = 'SESSION_CREATE',
  /** Client -> Server: join an existing session */
  SESSION_JOIN = 'SESSION_JOIN',
  /** Client -> Server: leave the current session */
  SESSION_LEAVE = 'SESSION_LEAVE',
  /** Server -> Client: acknowledge SESSION_CREATE/JOIN, send session metadata */
  SESSION_ACK = 'SESSION_ACK',
  /** Server -> all: a new player joined the lobby */
  PLAYER_JOINED = 'PLAYER_JOINED',
  /** Server -> all: a player left the lobby or game */
  PLAYER_LEFT = 'PLAYER_LEFT',
  /** Server -> all remaining clients: host left - session is closed */
  SESSION_CLOSED = 'SESSION_CLOSED',
  /** Server -> all: full lobby state snapshot (slot list) */
  SESSION_STATE = 'SESSION_STATE',
  /** Client (host) -> Server: start the game */
  SESSION_START = 'SESSION_START',
  /** Server -> all: game is about to start, here is the seed */
  SESSION_STARTING = 'SESSION_STARTING',

  // -- World sync --
  /** Server -> Client: full entity snapshot (on game start / rejoin) */
  SNAPSHOT = 'SNAPSHOT',
  /** Server -> all: per-tick entity delta */
  DELTA = 'DELTA',
  CHUNK_REQUEST = 'CHUNK_REQUEST',
  CHUNK_DATA = 'CHUNK_DATA',

  // -- Input --
  /** Client -> Server: input frame */
  INPUT = 'INPUT',

  // -- Combat --
  /** Client -> Server: player attack action (melee or ranged) */
  ATTACK = 'ATTACK',
  /** Server -> all: a player performed an attack (for remote arc animation, fires even on miss) */
  ATTACK_PERFORMED = 'ATTACK_PERFORMED',
  /** Server -> all: an attack landed on a target */
  HIT = 'HIT',
  /** Server -> all: a projectile was spawned (ranged attack). */
  PROJECTILE_SPAWN = 'PROJECTILE_SPAWN',
  /** Server -> all: a projectile was destroyed (hit, wall, or expired). */
  PROJECTILE_REMOVE = 'PROJECTILE_REMOVE',
  /** Server -> all: batch of projectiles destroyed in one tick. */
  PROJECTILE_REMOVE_BATCH = 'PROJECTILE_REMOVE_BATCH',

  // -- Pause --
  /** Client -> Server: player votes to pause or resume (toggle). */
  PAUSE_VOTE = 'PAUSE_VOTE',
  /** Server -> all: intermediate vote tally while collecting votes. */
  PAUSE_VOTE_UPDATE = 'PAUSE_VOTE_UPDATE',
  /** Server -> all: authoritative pause state change. */
  PAUSE_STATE = 'PAUSE_STATE',

  // -- Chat --
  CHAT = 'CHAT',

  // -- Resources & Items --
  /** Server -> Client: updated resource counts for this player. */
  RESOURCE_UPDATE = 'RESOURCE_UPDATE',
  /** Client -> Server: player pressed E to interact/pick up nearby item. */
  INTERACT = 'INTERACT',

  // -- Death & Respawn (4.11) --
  /** Server -> all: a player has been downed (HP reached 0). */
  PLAYER_DOWNED = 'PLAYER_DOWNED',
  /** Server -> all: revive progress update for a downed player. */
  REVIVE_PROGRESS = 'REVIVE_PROGRESS',
  /** Server -> all: a downed player has been revived by a teammate. */
  PLAYER_REVIVED = 'PLAYER_REVIVED',
  /** Server -> all: a player has fully died (bleed-out expired). */
  PLAYER_DIED = 'PLAYER_DIED',
  /** Server -> all: a player has respawned at the spawn origin. */
  PLAYER_RESPAWNED = 'PLAYER_RESPAWNED',

  // -- Wave Wipe (4.12) --
  /** Server -> all: full party wipe occurred. */
  PARTY_WIPE = 'PARTY_WIPE',
  /** Server -> all: run is over. */
  GAME_OVER = 'GAME_OVER',

  // -- Waves --
  /** Server -> all: a new wave is beginning (prep phase or active phase). */
  WAVE_START = 'WAVE_START',
  /** Server -> all: a wave has ended (all portals destroyed). */
  WAVE_END = 'WAVE_END',
  /** Server -> all: authoritative wave timer sync (pause/resume + drift correction). */
  WAVE_TIMER_SYNC = 'WAVE_TIMER_SYNC',

  // -- Buildings (Phase 5) --
  /** Client -> Server: player attempts to place a building. */
  BUILD_PLACE = 'BUILD_PLACE',
  /** Server -> placing client: placement confirmed or rejected. */
  BUILD_CONFIRM = 'BUILD_CONFIRM',
  /** Server -> all: a building entity was destroyed. */
  BUILD_DESTROYED = 'BUILD_DESTROYED',
  /** Server -> all: a building has been converted to ruins (can be repaired). */
  BUILD_RUINED = 'BUILD_RUINED',
  /** Server -> all: the campfire was destroyed - run ends. */
  CAMPFIRE_DESTROYED = 'CAMPFIRE_DESTROYED',
  /** Client -> Server: player attempts to demolish a building. */
  BUILD_DEMOLISH = 'BUILD_DEMOLISH',
  /** Client -> Server: player attempts to upgrade a building. */
  BUILD_UPGRADE = 'BUILD_UPGRADE',
  /** Server -> placing client: upgrade confirmed or rejected. */
  BUILD_UPGRADE_CONFIRM = 'BUILD_UPGRADE_CONFIRM',
  /** Client -> Server: player attempts to repair a building. */
  BUILD_REPAIR = 'BUILD_REPAIR',
  /** Server -> placing client: repair confirmed or rejected. */
  BUILD_REPAIR_CONFIRM = 'BUILD_REPAIR_CONFIRM',
  /** Server -> all: building range update (campfire placed, range expanded by watchtower). */
  BUILD_RANGE_UPDATE = 'BUILD_RANGE_UPDATE',
  /** Server -> all: cannon turret AOE explosion visual. */
  AOE_EXPLOSION = 'AOE_EXPLOSION',
  /** Server -> all: incoming meteor warning (red circle on ground before impact). */
  METEOR_WARNING = 'METEOR_WARNING',
  /** Server -> All: warehouse shared resource pool update. */
  WAREHOUSE_UPDATE = 'WAREHOUSE_UPDATE',

  // -- Save Slots --
  /** Client -> Server: request save slot info for the current player. */
  SAVE_SLOTS_REQUEST = 'SAVE_SLOTS_REQUEST',
  /** Server -> Client: save slot info response. */
  SAVE_SLOTS_RESPONSE = 'SAVE_SLOTS_RESPONSE',
  /** Server -> all: game was auto-saved (toast notification). */
  GAME_SAVED = 'GAME_SAVED',
  /** Client -> Server: delete a save slot. */
  SAVE_DELETE = 'SAVE_DELETE',
  /** Server -> client: generic notification toast (e.g. inventory full). */
  NOTIFICATION = 'NOTIFICATION',

  // -- Debug --
  /** Client -> Server: spawn a wave of enemies around the sender (dev tool). */
  DEBUG_SPAWN_ENEMIES = 'DEBUG_SPAWN_ENEMIES',
  /** Client -> Server: skip wave prep timer, immediately spawn portals (dev tool). */
  DEBUG_WAVE_SKIP = 'DEBUG_WAVE_SKIP',
  /** Client -> Server: pause/resume the wave timer (dev tool). */
  DEBUG_WAVE_PAUSE = 'DEBUG_WAVE_PAUSE',
  /** Client -> Server: give resources to the sender (dev tool). */
  DEBUG_GIVE_RESOURCES = 'DEBUG_GIVE_RESOURCES',
  /** Client -> Server: give a specific card to the sender (dev tool). */
  DEBUG_GIVE_CARD = 'DEBUG_GIVE_CARD',
  /** Client -> Server: give skill points to the sender (dev tool). */
  DEBUG_GIVE_SKILL_POINTS = 'DEBUG_GIVE_SKILL_POINTS',
  /** Client -> Server: skip to night (dev tool). */
  DEBUG_SKIP_NIGHT = 'DEBUG_SKIP_NIGHT',
  /** Client -> Server: skip to day (dev tool). */
  DEBUG_SKIP_DAY = 'DEBUG_SKIP_DAY',
  /** Client -> Server: set day timer to specific seconds (dev tool). */
  DEBUG_SET_TIME = 'DEBUG_SET_TIME',
  /** Client -> Server: force a wave modifier (dev tool). */
  DEBUG_FORCE_MODIFIER = 'DEBUG_FORCE_MODIFIER',
  /** Client -> Server: force a world event (dev tool). */
  DEBUG_FORCE_EVENT = 'DEBUG_FORCE_EVENT',

  // -- Phase 6 --
  /** Server -> all: a new enemy type appeared for the first time this run. */
  ENEMY_INTRO = 'ENEMY_INTRO',
  /** Client -> Server: request persistent meta stats. */
  META_STATS_REQUEST = 'META_STATS_REQUEST',
  /** Server -> Client: response with persistent meta stats. */
  META_STATS_RESPONSE = 'META_STATS_RESPONSE',
  /** Client -> Server: upload local meta stats for sync. */
  META_STATS_UPLOAD = 'META_STATS_UPLOAD',
  /** Client -> Server: reset all meta stats to zero. */
  META_STATS_RESET = 'META_STATS_RESET',

  CARD_OFFER   = 'CARD_OFFER',
  CARD_PICK    = 'CARD_PICK',
  CARD_APPLIED = 'CARD_APPLIED',
  /** Server -> Client: sync card abilities + picked card IDs after save load. */
  CARD_SYNC    = 'CARD_SYNC',

  // -- Phase 7 --
  /** Client -> Server: player selects a class in the lobby. */
  CLASS_SELECT = 'CLASS_SELECT',
  /** Client (host) -> Server: kick a player from the lobby by slot. */
  PLAYER_KICK = 'PLAYER_KICK',

  // -- Skill Tree --
  /** Client -> Server: allocate a skill point to a node. */
  SKILL_ALLOCATE = 'SKILL_ALLOCATE',
  /** Server -> Client: full skill allocation state. */
  SKILL_STATE = 'SKILL_STATE',
  /** Client -> Server: assign an ability to a hotbar slot. */
  ABILITY_SLOT_ASSIGN = 'ABILITY_SLOT_ASSIGN',
  /** Client -> Server: activate an ability (Q/E/R). */
  ABILITY_USE = 'ABILITY_USE',
  /** Server -> all: broadcast ability visual effect. */
  ABILITY_EFFECT = 'ABILITY_EFFECT',

  // -- Potions --
  /** Server -> Client: potion shop state (sent when player opens shop). */
  POTION_SHOP_STATE = 'POTION_SHOP_STATE',
  /** Client -> Server: unlock a potion at a shop. */
  POTION_UNLOCK = 'POTION_UNLOCK',
  /** Client -> Server: equip a potion to hotbar slot 4. */
  POTION_EQUIP = 'POTION_EQUIP',
  /** Client -> Server: restock charges at a shop. */
  POTION_RESTOCK = 'POTION_RESTOCK',
  /** Client -> Server: use the currently equipped potion. */
  POTION_USE = 'POTION_USE',
  /** Server -> Client: full potion state sync (after use, equip, restock, save load). */
  POTION_STATE = 'POTION_STATE',

  // -- Phase 9: Day/Night --
  /** Server -> all: day/night phase sync (periodic + on transitions). */
  DAY_NIGHT_SYNC = 'DAY_NIGHT_SYNC',
  /** Client -> Server: player votes to sleep (skip day). */
  SLEEP_VOTE = 'SLEEP_VOTE',
  /** Server -> all: sleep vote tally update. */
  SLEEP_UPDATE = 'SLEEP_UPDATE',

  // -- Phase 9: Wave Modifiers & World Events --
  /** Server -> all: wave modifier(s) rolled for the upcoming wave. */
  WAVE_MODIFIER = 'WAVE_MODIFIER',
  /** Server -> all: day event roulette roll result. */
  DAY_EVENT_ROLL = 'DAY_EVENT_ROLL',
  /** Server -> all: a world event has started. */
  WORLD_EVENT_START = 'WORLD_EVENT_START',
  /** Server -> all: a world event has ended. */
  WORLD_EVENT_END = 'WORLD_EVENT_END',

  // -- Phase 10: Card Drops & Bosses --
  /** Server -> all: a player picked up a card drop. */
  CARD_PICKUP = 'CARD_PICKUP',
  /** Server -> all: a boss enemy has spawned. */
  BOSS_INTRO = 'BOSS_INTRO',
  /** Server -> all: a boss changed phase (enrage, etc). */
  BOSS_PHASE = 'BOSS_PHASE',

  // -- Phase 8: Civilians --
  /** Server -> all: a civilian said something (speech bubble). */
  CIVILIAN_SPEECH = 'CIVILIAN_SPEECH',
  /** Server -> all: a civilian was killed. */
  CIVILIAN_DIED = 'CIVILIAN_DIED',
  /** Server -> all: a new civilian was spawned. */
  CIVILIAN_SPAWNED = 'CIVILIAN_SPAWNED',
  /** Client -> Server: request civilian panel state. */
  CIVILIAN_PANEL_REQUEST = 'CIVILIAN_PANEL_REQUEST',
  /** Server -> Client: full civilian panel state. */
  CIVILIAN_PANEL_STATE = 'CIVILIAN_PANEL_STATE',
  /** Client -> Server: assign a civilian to a building (or unassign). */
  CIVILIAN_ASSIGN = 'CIVILIAN_ASSIGN',

  // -- Training Center --
  /** Client -> Server: train a guard at a training center. */
  TRAIN_GUARD = 'TRAIN_GUARD',
  /** Server -> Client: training result (success/fail + reason). */
  TRAIN_GUARD_RESULT = 'TRAIN_GUARD_RESULT',

  // -- Teleporter --
  /** Client -> Server: player pressed E near a teleporter pad. */
  TELEPORTER_USE = 'TELEPORTER_USE',
  /** Server -> Client: teleporter result (success + destination, or fail). */
  TELEPORTER_RESULT = 'TELEPORTER_RESULT',

  // -- Laser Tower --
  /** Server -> all: laser beam VFX (source + target each tick). */
  LASER_BEAM = 'LASER_BEAM',
  /** Server -> all: flame cone VFX (source position, facing, range). */
  FLAME_CONE = 'FLAME_CONE',

  // -- Tesla Coil --
  /** Server -> all: tesla coil chain lightning VFX. */
  TESLA_CHAIN = 'TESLA_CHAIN',

  // -- Tavern / Heroes --
  /** Server -> Client: tavern roster and active hero state. */
  TAVERN_STATE = 'TAVERN_STATE',
  /** Client -> Server: player wants to hire a hero from a tavern. */
  HIRE_HERO = 'HIRE_HERO',
  /** Server -> Client: hire result (success/reason). */
  HIRE_HERO_RESULT = 'HIRE_HERO_RESULT',
  /** Server -> all: a hero was killed. */
  HERO_DIED = 'HERO_DIED',
  /** Server -> all: a hero used an ability (VFX). */
  HERO_ABILITY = 'HERO_ABILITY',
}

// ---- Base ----

export interface BaseMessage {
  type: string;
}

// ---- Error ----

export interface ErrorMessage extends BaseMessage {
  type: typeof MessageType.ERROR;
  code: string;
  message: string;
}
