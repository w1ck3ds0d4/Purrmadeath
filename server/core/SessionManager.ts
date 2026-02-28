import * as fs from 'fs';
import * as path from 'path';
import type { ConnectedClient } from '../net/ServerSocket';
import type { ServerSocket } from '../net/ServerSocket';
import { GameSession } from './GameSession';
import type { DiscoveryBeacon } from '../discovery';
import { MessageType } from '@shared/protocol';
import type { HandshakeMessage } from '@shared/protocol';
import type {
  SessionCreateMessage,
  SessionJoinMessage,
  SessionStartMessage,
  SessionLeaveMessage,
  InputMessage,
  AttackMessage,
  InteractMessage,
  DebugSpawnEnemiesMessage,
  ChatSendMessage,
  SessionAckMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  SessionClosedMessage,
  ChatMessage,
  BuildPlaceMessage,
  BuildDemolishMessage,
  BuildUpgradeMessage,
  BuildRepairMessage,
  ClassSelectMessage,
  PlayerKickMessage,
  SkillAllocateMessage,
  AbilityUseMessage,
  PotionUnlockMessage,
  PotionEquipMessage,
  PotionRestockMessage,
} from '@shared/protocol';
import { PLAYER_CLASSES, BASE_CLASSES } from '@shared/definitions/ClassDefinitions';
import type { PlayerClass } from '@shared/definitions/ClassDefinitions';
import { GAME_VERSION, RECONNECT_GRACE_MS } from '@shared/constants';
import type { MetaStats } from '@shared/definitions/MetaStats';
import { emptyMetaStats, mergeRunStats } from '@shared/definitions/MetaStats';
import { computeUnlockedClasses } from '@shared/definitions/MilestoneDefinitions';
import { computeCompletedBuffs } from '@shared/definitions/ProgressionDefinitions';
import type { MetaStatsRequestMessage, CardPickMessage } from '@shared/protocol';

/** Minimum interval (ms) between SESSION_CREATE or SESSION_JOIN per client. */
const SESSION_ACTION_COOLDOWN_MS = 2_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAVES_DIR = path.join(process.cwd(), 'saves');
const META_DIR = path.join(process.cwd(), 'metastats');

/** Pending reconnection: player disconnected mid-game, slot held for a grace period. */
interface PendingReconnect {
  /** IP of the disconnected player. */
  ip: string;
  /** Original client ID in GameSession. */
  oldClientId: string;
  displayName: string;
  slot: number;
  isHost: boolean;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * SessionManager wires socket message handlers to GameSession lifecycle.
 *
 * Phase 3 supports exactly one session at a time (the single-LAN-server model).
 * Phase 8 will add multi-session lobbies.
 */
export class SessionManager {
  private session: GameSession | null = null;

  /** displayName stored on HANDSHAKE - keyed by clientId. */
  private displayNames = new Map<string, string>();

  /** Persistent player UUID from HANDSHAKE - keyed by clientId. */
  private clientPlayerIds = new Map<string, string>();

  /** IP → last-known display name (persists while server runs). */
  private knownPlayers = new Map<string, string>();

  /** Save data: hostPlayerId → slot (1-3) → SaveData. */
  private saves = new Map<string, Map<number, import('@shared/SaveFormat').SaveData>>();

  /** Per-client session action cooldown (clientId → last action timestamp). */
  private lastSessionAction = new Map<string, number>();

  /** Players disconnected mid-game waiting for reconnection (keyed by IP). */
  private pendingReconnects = new Map<string, PendingReconnect>();

  /** Persistent per-player meta stats (keyed by playerId/UUID). */
  private metaStats = new Map<string, MetaStats>();

  constructor(
    private readonly socket: ServerSocket,
    private readonly beacon: DiscoveryBeacon,
  ) {
    // Wire up IP → name lookup so HANDSHAKE_ACK includes lastDisplayName
    socket.setNameLookup((ip) => this.knownPlayers.get(ip));

    socket.on(MessageType.HANDSHAKE,      (c, m) => this.onHandshake(c, m as HandshakeMessage));
    socket.on(MessageType.SESSION_CREATE, (c, m) => this.onSessionCreate(c, m as SessionCreateMessage));
    socket.on(MessageType.SESSION_JOIN,   (c, m) => this.onSessionJoin(c, m as SessionJoinMessage));
    socket.on(MessageType.SESSION_LEAVE,  (c, m) => this.onSessionLeave(c, m as SessionLeaveMessage));
    socket.on(MessageType.SESSION_START,  (c, m) => this.onSessionStart(c, m as SessionStartMessage));
    socket.on(MessageType.INPUT,          (c, m) => this.onInput(c, m as InputMessage));
    socket.on(MessageType.ATTACK,               (c, m) => this.onAttack(c, m as AttackMessage));
    socket.on(MessageType.INTERACT,             (c, m) => this.onInteract(c, m as InteractMessage));
    socket.on(MessageType.BUILD_PLACE,          (c, m) => this.onBuildPlace(c, m as BuildPlaceMessage));
    socket.on(MessageType.BUILD_DEMOLISH,      (c, m) => this.onBuildDemolish(c, m as BuildDemolishMessage));
    socket.on(MessageType.BUILD_UPGRADE,       (c, m) => this.onBuildUpgrade(c, m as BuildUpgradeMessage));
    socket.on(MessageType.BUILD_REPAIR,        (c, m) => this.onBuildRepair(c, m as BuildRepairMessage));
    socket.on(MessageType.DEBUG_SPAWN_ENEMIES,  (c, m) => this.onDebugAction(c, () => this.onDebugSpawnEnemies(c, m as DebugSpawnEnemiesMessage)));
    socket.on(MessageType.DEBUG_WAVE_SKIP,     (c) => this.onDebugAction(c, () => this.session?.debugWaveSkip((cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.DEBUG_WAVE_PAUSE,    (c) => this.onDebugAction(c, () => this.session?.debugWavePause((cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.DEBUG_GIVE_RESOURCES, (c) => this.onDebugAction(c, () => this.session?.debugGiveResources(c.id, (cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.DEBUG_GIVE_CARD, (c, m) => this.onDebugAction(c, () => this.session?.debugGiveCard(c.id, (m as import('@shared/protocol').DebugGiveCardMessage).cardId, (cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.DEBUG_GIVE_SKILL_POINTS, (c, m) => this.onDebugAction(c, () => this.session?.debugGiveSkillPoints(c.id, (m as import('@shared/protocol').DebugGiveSkillPointsMessage).count ?? 1, (cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.DEBUG_SKIP_NIGHT, (c) => this.onDebugAction(c, () => this.session?.debugSkipNight((cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.DEBUG_SKIP_DAY, (c) => this.onDebugAction(c, () => this.session?.debugSkipDay((cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.DEBUG_SET_TIME, (c, m) => this.onDebugAction(c, () => this.session?.debugSetTime((m as import('@shared/protocol').DebugSetTimeMessage).seconds, (cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.CHAT,                 (c, m) => this.onChat(c, m as ChatSendMessage));
    socket.on(MessageType.PAUSE_VOTE,            (c) => this.onPauseVote(c));
    socket.on(MessageType.SLEEP_VOTE,            (c, m) => this.onSleepVote(c, m as import('@shared/protocol').SleepVoteMessage));
    socket.on(MessageType.SAVE_SLOTS_REQUEST,    (c) => this.onSaveSlotsRequest(c));
    socket.on(MessageType.SAVE_DELETE,             (c, m) => this.onSaveDelete(c, m as import('@shared/protocol').SaveDeleteMessage));
    socket.on(MessageType.META_STATS_REQUEST,      (c) => this.onMetaStatsRequest(c));
    socket.on(MessageType.CARD_PICK,               (c, m) => this.session?.handleCardPick(c.id, m as CardPickMessage, (cl, msg) => this.socket.send(cl, msg)));
    socket.on(MessageType.SKILL_ALLOCATE,          (c, m) => this.session?.handleSkillAllocate(c.id, m as SkillAllocateMessage, (cl, msg) => this.socket.send(cl, msg)));
    socket.on(MessageType.ABILITY_USE,             (c, m) => this.session?.handleAbilityUse(c.id, m as AbilityUseMessage, (cl, msg) => this.socket.send(cl, msg)));
    socket.on(MessageType.CLASS_SELECT,            (c, m) => this.onClassSelect(c, m as ClassSelectMessage));
    socket.on(MessageType.PLAYER_KICK,             (c, m) => this.onPlayerKick(c, m as PlayerKickMessage));
    socket.on(MessageType.POTION_UNLOCK,           (c, m) => this.session?.handlePotionUnlock(c.id, m as PotionUnlockMessage, (cl, msg) => this.socket.send(cl, msg)));
    socket.on(MessageType.POTION_EQUIP,            (c, m) => this.session?.handlePotionEquip(c.id, m as PotionEquipMessage, (cl, msg) => this.socket.send(cl, msg)));
    socket.on(MessageType.POTION_RESTOCK,          (c, m) => this.session?.handlePotionRestock(c.id, m as PotionRestockMessage, (cl, msg) => this.socket.send(cl, msg)));
    socket.on(MessageType.POTION_USE,              (c) => this.session?.handlePotionUse(c.id, (cl, msg) => this.socket.send(cl, msg)));
    socket.on(MessageType.CIVILIAN_PANEL_REQUEST,  (c) => this.session?.handleCivilianPanelRequest(c.id, (cl, msg) => this.socket.send(cl, msg)));
    socket.on(MessageType.CIVILIAN_ASSIGN,         (c, m) => this.session?.handleCivilianAssign(c.id, m as import('@shared/protocol').CivilianAssignMessage, (cl, msg) => this.socket.send(cl, msg)));
    socket.onDisconnect((c) => this.onDisconnect(c));

    // Load persisted saves and meta stats from disk
    this.loadSavesFromDisk();
    this.loadMetaStatsFromDisk();
  }

  /** Load all save files from ./saves/ into memory on startup. */
  private loadSavesFromDisk(): void {
    if (!fs.existsSync(SAVES_DIR)) return;
    const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const match = file.match(/^([0-9a-f-]+)_slot(\d)\.json$/);
      if (!match) continue;
      const [, playerId, slotStr] = match;
      if (!UUID_RE.test(playerId)) continue;
      const slot = parseInt(slotStr, 10);
      if (slot < 1 || slot > 3) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SAVES_DIR, file), 'utf-8'));
        if (!this.saves.has(playerId)) this.saves.set(playerId, new Map());
        this.saves.get(playerId)!.set(slot, data);
      } catch {
        console.warn(`[Save] Failed to load ${file}`);
      }
    }
    const total = [...this.saves.values()].reduce((n, m) => n + m.size, 0);
    if (total > 0) console.log(`[Save] Loaded ${total} save(s) from disk`);
  }

  /** Write a save to disk. */
  private writeSaveToDisk(playerId: string, slot: number, data: import('@shared/SaveFormat').SaveData): void {
    if (!UUID_RE.test(playerId)) return;
    if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true });
    const filePath = path.join(SAVES_DIR, `${playerId}_slot${slot}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  }

  /** Load all meta stats files from ./metastats/ into memory on startup. */
  private loadMetaStatsFromDisk(): void {
    if (!fs.existsSync(META_DIR)) return;
    const files = fs.readdirSync(META_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const playerId = file.replace('.json', '');
      if (!UUID_RE.test(playerId)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(META_DIR, file), 'utf-8'));
        const defaults = emptyMetaStats();
        const merged: MetaStats = {
          ...defaults,
          ...data,
          resourcesGathered: { ...defaults.resourcesGathered, ...data.resourcesGathered },
          unlockedClasses: data.unlockedClasses ?? [],
        };
        this.metaStats.set(playerId, merged);
      } catch {
        console.warn(`[MetaStats] Failed to load ${file}`);
      }
    }
    if (this.metaStats.size > 0) console.log(`[MetaStats] Loaded stats for ${this.metaStats.size} player(s)`);
  }

  /** Write a player's meta stats to disk. */
  private writeMetaStatsToDisk(playerId: string, stats: MetaStats): void {
    if (!UUID_RE.test(playerId)) return;
    if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });
    const filePath = path.join(META_DIR, `${playerId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(stats), 'utf-8');
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  private onHandshake(client: ConnectedClient, msg: HandshakeMessage): void {
    // Version gate: reject clients with mismatched version
    const clientVersion = (msg.version ?? '').trim();
    if (clientVersion && clientVersion !== GAME_VERSION) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'VERSION_MISMATCH',
        message: `Server version ${GAME_VERSION}, client version ${clientVersion}. Please update.`,
      });
      return;
    }

    const name = (msg.displayName ?? '').trim().slice(0, 24) || `Player${client.id}`;
    this.displayNames.set(client.id, name);

    // Store persistent player UUID (generated client-side, stored in localStorage)
    // Validate UUID v4 format to prevent injection / save hijacking
    if (msg.playerId && UUID_RE.test(msg.playerId)) {
      this.clientPlayerIds.set(client.id, msg.playerId);
    }

    // Save IP → name for returning player recognition
    this.knownPlayers.set(client.ip, name);

    // Check for pending reconnection (same IP reconnecting mid-game)
    const pending = this.pendingReconnects.get(client.ip);
    if (pending && this.session) {
      clearTimeout(pending.timer);
      this.pendingReconnects.delete(client.ip);

      const player = this.session.rebindPlayer(pending.oldClientId, client);
      if (player) {
        console.log(`[Session] ${name} reconnected to slot ${player.slot}`);
        // Send session state so the client can re-enter the game
        const ack: SessionAckMessage = {
          type: MessageType.SESSION_ACK,
          sessionId: this.session.id,
          code: this.session.code,
          seed: this.session.seed,
          slot: player.slot,
          playerId: player.playerId,
          isHost: player.isHost,
          players: this.session.getLobbySlots(),
          completedBuffs: this.getCompletedBuffs(client.id),
        };
        this.socket.send(client, ack);
        return;
      }
    }
  }

  private onSessionCreate(client: ConnectedClient, msg: SessionCreateMessage): void {
    // Require HANDSHAKE first
    if (!this.displayNames.has(client.id)) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'NOT_IDENTIFIED',
        message: 'Send HANDSHAKE before creating a session.',
      });
      return;
    }

    // Rate limit
    if (!this.checkSessionCooldown(client)) return;

    if (this.session) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'SESSION_EXISTS',
        message: 'A session is already running. Join it instead.',
      });
      return;
    }

    // Validate save slot range (1-3)
    const rawSlot = msg.saveSlot;
    if (rawSlot !== undefined && (!Number.isInteger(rawSlot) || rawSlot < 1 || rawSlot > 3)) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'INVALID_SAVE_SLOT',
        message: 'Save slot must be 1, 2, or 3.',
      });
      return;
    }

    // Check for save slot resume
    const hostPlayerId = this.clientPlayerIds.get(client.id);
    const saveSlot = rawSlot;
    let loadedSave: import('@shared/SaveFormat').SaveData | undefined;
    if (saveSlot && hostPlayerId) {
      const hostSaves = this.saves.get(hostPlayerId);
      loadedSave = hostSaves?.get(saveSlot);
    }

    const seed = loadedSave?.seed ?? Math.floor(Math.random() * 2 ** 31);
    const sessionId = `session-${Date.now()}`;
    this.session = new GameSession(sessionId, seed);

    // Wire up auto-save callback
    if (hostPlayerId) {
      this.session.onSave = (data) => {
        if (!this.saves.has(hostPlayerId)) {
          this.saves.set(hostPlayerId, new Map());
        }
        const slot = saveSlot ?? 1;
        this.saves.get(hostPlayerId)!.set(slot, data);
        this.writeSaveToDisk(hostPlayerId, slot, data);
        console.log(`[Save] Auto-saved slot ${slot} for host ${hostPlayerId} (wave ${data.currentWave})`);
      };
      this.session.saveSlot = saveSlot ?? 1;
      this.session.hostPlayerId = hostPlayerId;
      const delSlot = saveSlot ?? 1;
      this.session.onSaveDelete = () => {
        const hostSaves = this.saves.get(hostPlayerId);
        if (hostSaves) hostSaves.delete(delSlot);
        const filePath = path.join(SAVES_DIR, `${hostPlayerId}_slot${delSlot}.json`);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[Save] Deleted save slot ${delSlot} for ${hostPlayerId} (game over)`);
        }
      };

      // Load save data if resuming (validation may reject corrupt saves)
      if (loadedSave) {
        this.session.loadSave(loadedSave, (c, m) => this.socket.send(c, m));
        // loadSave returns false for invalid data - session starts fresh in that case
        console.log(`[Save] Loaded slot ${saveSlot} for host ${hostPlayerId} (wave ${loadedSave.currentWave})`);
      }
    }

    // Wire up run-end stats merge (always, regardless of hostPlayerId)
    this.session.onRunEnd = (playerStats) => {
      for (const [pid, runStats] of playerStats) {
        if (!UUID_RE.test(pid)) continue;
        let meta = this.metaStats.get(pid);
        if (!meta) { meta = emptyMetaStats(); this.metaStats.set(pid, meta); }
        mergeRunStats(meta, runStats);
        // Recompute class unlocks after stats merge
        meta.unlockedClasses = computeUnlockedClasses(meta);
        this.writeMetaStatsToDisk(pid, meta);
      }
      console.log(`[MetaStats] Merged run stats for ${playerStats.size} player(s)`);
    };

    const displayName = this.displayNames.get(client.id) ?? `Player${client.id}`;
    const unlocked = this.getUnlockedClasses(client.id);
    const playerClass = this.validatePlayerClass(msg.playerClass, unlocked);
    const player = this.session.addPlayer(client, displayName, /* isHost */ true, hostPlayerId, playerClass);

    const ack: SessionAckMessage = {
      type: MessageType.SESSION_ACK,
      sessionId,
      code: this.session.code,
      seed,
      slot: player.slot,
      playerId: player.playerId,
      isHost: true,
      players: this.session.getLobbySlots(),
      unlockedClasses: unlocked,
      completedBuffs: this.getCompletedBuffs(client.id),
    };
    this.socket.send(client, ack);
    this.beacon.update({ code: this.session.code, playerCount: this.session.playerCount });

    console.log(`[Session] ${displayName} created session ${sessionId} (code: ${this.session.code})`);
  }

  private onSessionJoin(client: ConnectedClient, msg: SessionJoinMessage): void {
    // Require HANDSHAKE first
    if (!this.displayNames.has(client.id)) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'NOT_IDENTIFIED',
        message: 'Send HANDSHAKE before joining a session.',
      });
      return;
    }

    // Rate limit
    if (!this.checkSessionCooldown(client)) return;

    if (!this.session) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'NO_SESSION',
        message: 'No session exists. Host one first.',
      });
      return;
    }

    // Validate invite code (case-insensitive). Empty string = accept any (dev/LAN compat).
    const code = (msg.code ?? '').toUpperCase().trim();
    if (code && code !== this.session.code) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'INVALID_CODE',
        message: 'Invalid invite code.',
      });
      return;
    }

    if (this.session.getPlayer(client.id)) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'ALREADY_IN_SESSION',
        message: 'You are already in this session.',
      });
      return;
    }

    if (this.session.isFull) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'SESSION_FULL',
        message: 'Session is full.',
      });
      return;
    }

    if (this.session.isPlaying) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'SESSION_STARTED',
        message: 'The game has already started.',
      });
      return;
    }

    const displayName = this.displayNames.get(client.id) ?? `Player${client.id}`;
    const joinerId = this.clientPlayerIds.get(client.id);
    const unlocked = this.getUnlockedClasses(client.id);
    const joinClass = this.validatePlayerClass(msg.playerClass, unlocked);
    const player = this.session.addPlayer(client, displayName, /* isHost */ false, joinerId, joinClass);

    // Acknowledge to the joining player
    const ack: SessionAckMessage = {
      type: MessageType.SESSION_ACK,
      sessionId: this.session.id,
      code: this.session.code,
      seed: this.session.seed,
      slot: player.slot,
      playerId: player.playerId,
      isHost: false,
      players: this.session.getLobbySlots(),
      unlockedClasses: unlocked,
      completedBuffs: this.getCompletedBuffs(client.id),
    };
    this.socket.send(client, ack);

    // Notify all other players in the session
    const joined: PlayerJoinedMessage = {
      type: MessageType.PLAYER_JOINED,
      player: { playerId: player.playerId, displayName, slot: player.slot, isHost: false, playerClass: player.playerClass },
    };
    this.broadcastToSession(joined, client.id);
    this.beacon.update({ playerCount: this.session.playerCount });

    console.log(`[Session] ${displayName} joined slot ${player.slot}`);
  }

  private onSessionLeave(client: ConnectedClient, _msg: SessionLeaveMessage): void {
    this.handlePlayerLeave(client, /* isDisconnect */ false);
  }

  private onSessionStart(client: ConnectedClient, _msg: SessionStartMessage): void {
    if (!this.session) return;

    const player = this.session.getPlayer(client.id);
    if (!player?.isHost) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'NOT_HOST',
        message: 'Only the host can start the game.',
      });
      return;
    }

    if (this.session.playerCount < 1) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'NOT_ENOUGH_PLAYERS',
        message: 'Need at least 1 player.',
      });
      return;
    }

    console.log(`[Session] Game starting - ${this.session.playerCount} player(s)`);
    this.session.start((c, msg) => this.socket.send(c, msg));
  }

  private onInput(client: ConnectedClient, msg: InputMessage): void {
    this.session?.applyInput(client.id, msg);
  }

  private onAttack(client: ConnectedClient, msg: AttackMessage): void {
    this.session?.handleAttack(client.id, msg, (c, m) => this.socket.send(c, m));
  }

  private onInteract(client: ConnectedClient, msg: InteractMessage): void {
    this.session?.handleInteract(client.id, msg, (c, m) => this.socket.send(c, m));
  }

  private onBuildPlace(client: ConnectedClient, msg: BuildPlaceMessage): void {
    this.session?.handleBuildPlace(client.id, msg, (c, m) => this.socket.send(c, m));
  }

  private onBuildDemolish(client: ConnectedClient, msg: BuildDemolishMessage): void {
    this.session?.handleBuildDemolish(client.id, msg, (c, m) => this.socket.send(c, m));
  }

  private onBuildUpgrade(client: ConnectedClient, msg: BuildUpgradeMessage): void {
    this.session?.handleBuildUpgrade(client.id, msg, (c, m) => this.socket.send(c, m));
  }

  private onBuildRepair(client: ConnectedClient, msg: BuildRepairMessage): void {
    this.session?.handleBuildRepair(client.id, msg, (c, m) => this.socket.send(c, m));
  }

  /** Host-only guard for debug commands. */
  private onDebugAction(client: ConnectedClient, action: () => void): void {
    if (!this.session?.getPlayer(client.id)?.isHost) return;
    action();
  }

  private onDebugSpawnEnemies(client: ConnectedClient, msg: DebugSpawnEnemiesMessage): void {
    this.session?.debugSpawnEnemies(client.id, msg.count);
  }

  private onClassSelect(client: ConnectedClient, msg: ClassSelectMessage): void {
    if (!this.session) return;
    const unlocked = this.getUnlockedClasses(client.id);
    const playerClass = this.validatePlayerClass(msg.playerClass, unlocked);
    this.session.handleClassSelect(client.id, playerClass, (c, m) => this.socket.send(c, m));
  }

  private onPlayerKick(client: ConnectedClient, msg: PlayerKickMessage): void {
    if (!this.session) return;
    const kicker = this.session.getPlayer(client.id);
    if (!kicker?.isHost) {
      this.socket.send(client, { type: MessageType.ERROR, code: 'NOT_HOST', message: 'Only the host can kick players' });
      return;
    }

    // Find target by slot
    const targetSlot = msg.slot;
    let targetClientId: string | undefined;
    for (const p of this.session.getPlayers()) {
      if (p.slot === targetSlot) {
        if (p.client.id === client.id) return; // Can't kick yourself
        targetClientId = p.client.id;
        break;
      }
    }
    if (!targetClientId) return;

    const target = this.session.getPlayer(targetClientId)!;
    const targetClient = target.client;

    // Notify kicked player
    this.socket.send(targetClient, {
      type: MessageType.SESSION_CLOSED,
      reason: 'Kicked by host',
    } as SessionClosedMessage);

    // Remove and broadcast
    this.finalizePlayerRemoval(targetClientId, target.displayName, false, target.slot, target.playerId);
    console.log(`[Session] ${target.displayName} was kicked by ${kicker.displayName}`);

    // Close their connection
    targetClient.ws.close();
  }

  /** Get the completed buff achievements for a client. */
  private getCompletedBuffs(clientId: string): { displayName: string; reward: string; medalColor: string }[] {
    const playerId = this.clientPlayerIds.get(clientId);
    if (!playerId) return [];
    const meta = this.metaStats.get(playerId);
    if (!meta) return [];
    return computeCompletedBuffs(meta);
  }

  /** Get the list of advanced classes a client has unlocked. */
  private getUnlockedClasses(clientId: string): string[] {
    const playerId = this.clientPlayerIds.get(clientId);
    if (!playerId) return [];
    const meta = this.metaStats.get(playerId);
    if (!meta) return [];
    return meta.unlockedClasses ?? computeUnlockedClasses(meta);
  }

  private validatePlayerClass(raw: unknown, unlockedClasses?: string[]): PlayerClass {
    if (typeof raw === 'string' && (PLAYER_CLASSES as readonly string[]).includes(raw)) {
      const cls = raw as PlayerClass;
      // Advanced classes require milestone unlocks
      if (!(BASE_CLASSES as readonly string[]).includes(cls)) {
        if (!unlockedClasses?.includes(cls)) return 'warrior';
      }
      return cls;
    }
    return 'warrior';
  }

  private onPauseVote(client: ConnectedClient): void {
    this.session?.handlePauseVote(client.id, (c, m) => this.socket.send(c, m));
  }

  private onSleepVote(client: ConnectedClient, msg: import('@shared/protocol').SleepVoteMessage): void {
    this.session?.handleSleepVote(client.id, msg.vote, (c, m) => this.socket.send(c, m));
  }

  private onChat(client: ConnectedClient, msg: ChatSendMessage): void {
    if (!this.session?.getPlayer(client.id)) return;

    const player = this.session.getPlayer(client.id)!;
    const text = (msg.text ?? '').trim().slice(0, 200);
    if (!text) return;

    const broadcast: ChatMessage = {
      type: MessageType.CHAT,
      displayName: player.displayName,
      slot: player.slot,
      text,
    };
    this.broadcastToSession(broadcast);
  }

  private onSaveSlotsRequest(client: ConnectedClient): void {
    const playerId = this.clientPlayerIds.get(client.id);
    if (!playerId) {
      this.socket.send(client, { type: MessageType.SAVE_SLOTS_RESPONSE, slots: [] });
      return;
    }
    const hostSaves = this.saves.get(playerId);
    const slots: import('@shared/SaveFormat').SaveSlotInfo[] = [];
    for (let i = 1; i <= 3; i++) {
      const save = hostSaves?.get(i);
      if (save) {
        slots.push({
          slot: i,
          exists: true,
          wave: save.currentWave,
          elapsedTime: save.elapsedTime,
          enemiesKilled: save.enemiesKilled,
          playerCount: save.players.length,
          timestamp: save.timestamp,
        });
      } else {
        slots.push({ slot: i, exists: false });
      }
    }
    this.socket.send(client, { type: MessageType.SAVE_SLOTS_RESPONSE, slots });
  }

  private onMetaStatsRequest(client: ConnectedClient): void {
    const playerId = this.clientPlayerIds.get(client.id);
    const stats = playerId ? (this.metaStats.get(playerId) ?? emptyMetaStats()) : emptyMetaStats();
    this.socket.send(client, {
      type: MessageType.META_STATS_RESPONSE,
      stats,
    });
  }

  private onSaveDelete(client: ConnectedClient, msg: import('@shared/protocol').SaveDeleteMessage): void {
    const playerId = this.clientPlayerIds.get(client.id);
    if (!playerId) return;
    const slot = msg.slot;
    if (!Number.isInteger(slot) || slot < 1 || slot > 3) return;
    const hostSaves = this.saves.get(playerId);
    if (hostSaves) hostSaves.delete(slot);
    // Delete from disk
    const filePath = path.join(SAVES_DIR, `${playerId}_slot${slot}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Save] Deleted slot ${slot} for ${playerId}`);
    }
    // Re-send updated slot info
    this.onSaveSlotsRequest(client);
  }

  private onDisconnect(client: ConnectedClient): void {
    this.displayNames.delete(client.id);
    this.clientPlayerIds.delete(client.id);
    this.lastSessionAction.delete(client.id);
    this.handlePlayerLeave(client, /* isDisconnect */ true);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Returns false and sends an error if the client is on cooldown. */
  private checkSessionCooldown(client: ConnectedClient): boolean {
    const now = Date.now();
    const last = this.lastSessionAction.get(client.id) ?? 0;
    if (now - last < SESSION_ACTION_COOLDOWN_MS) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'RATE_LIMITED',
        message: 'Please wait before trying again.',
      });
      return false;
    }
    this.lastSessionAction.set(client.id, now);
    return true;
  }

  private handlePlayerLeave(client: ConnectedClient, isDisconnect: boolean): void {
    if (!this.session) return;

    const player = this.session.getPlayer(client.id);
    if (!player) return;

    // ── Reconnection grace period ──────────────────────────────────────────
    // If the game is in progress and the player disconnected (not a voluntary leave),
    // hold their slot for RECONNECT_GRACE_MS to allow the same IP to rejoin.
    if (isDisconnect && this.session.isPlaying && !player.isHost) {
      this.session.suspendPlayer(client.id);
      console.log(`[Session] ${player.displayName} disconnected - holding slot ${player.slot} for ${RECONNECT_GRACE_MS / 1000}s`);

      const timer = setTimeout(() => {
        this.pendingReconnects.delete(client.ip);
        this.finalizePlayerRemoval(client.id, player.displayName, player.isHost, player.slot, player.playerId);
      }, RECONNECT_GRACE_MS);

      this.pendingReconnects.set(client.ip, {
        ip: client.ip,
        oldClientId: client.id,
        displayName: player.displayName,
        slot: player.slot,
        isHost: player.isHost,
        timer,
      });
      return;
    }

    this.finalizePlayerRemoval(client.id, player.displayName, player.isHost, player.slot, player.playerId);
  }

  private finalizePlayerRemoval(
    clientId: string,
    displayName: string,
    isHost: boolean,
    slot: number,
    playerId: string,
  ): void {
    if (!this.session) return;

    // Save before removing the host (needs player entities intact for serialization)
    if (isHost && this.session.isPlaying) {
      this.session.saveNow((c, m) => this.socket.send(c, m));
    }

    this.session.removePlayer(clientId);
    console.log(`[Session] ${displayName} left (slot ${slot})`);

    if (isHost) {
      // Host left - close the session for everyone immediately
      console.log('[Session] Host left - closing session for all remaining players');
      // Also clean up any pending reconnects
      for (const [, pending] of this.pendingReconnects) {
        clearTimeout(pending.timer);
      }
      this.pendingReconnects.clear();

      const closed: SessionClosedMessage = {
        type: MessageType.SESSION_CLOSED,
        reason: 'Host left the session',
      };
      this.broadcastToSession(closed);
      this.session = null;
      this.beacon.update({ code: '', playerCount: 0 });
      return;
    }

    const left: PlayerLeftMessage = {
      type: MessageType.PLAYER_LEFT,
      playerId,
      slot,
    };
    this.broadcastToSession(left);

    // Re-evaluate pause votes now that a player left
    if (this.session.isPlaying) {
      this.session.recheckPauseVotes((c, m) => this.socket.send(c, m));
    }

    // Destroy the session when it's empty (and no pending reconnects)
    if (this.session.playerCount === 0 && this.pendingReconnects.size === 0) {
      console.log('[Session] Session empty - destroying');
      this.session = null;
      this.beacon.update({ code: '', playerCount: 0 });
    } else {
      this.beacon.update({ playerCount: this.session.playerCount });
    }
  }

  /**
   * Send a message to all players in the current session.
   * @param excludeClientId  Optional client to skip (e.g. the sender).
   */
  private broadcastToSession(msg: object, excludeClientId?: string): void {
    if (!this.session) return;
    for (const p of this.session.getPlayers()) {
      if (p.client.id !== excludeClientId) {
        this.socket.send(p.client, msg);
      }
    }
  }

  // ── Tick entry point ────────────────────────────────────────────────────────

  /** Called by the game loop each tick while a session is active. */
  tick(dt: number): void {
    this.session?.tick_(dt, (c, msg) => this.socket.send(c, msg));
  }
}
