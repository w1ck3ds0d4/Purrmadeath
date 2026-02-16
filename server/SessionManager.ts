import type { ConnectedClient } from './net/ServerSocket';
import type { ServerSocket } from './net/ServerSocket';
import { GameSession } from './GameSession';
import type { DiscoveryBeacon } from './discovery';
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
} from '@shared/protocol';
import { GAME_VERSION, RECONNECT_GRACE_MS } from '@shared/constants';

/** Minimum interval (ms) between SESSION_CREATE or SESSION_JOIN per client. */
const SESSION_ACTION_COOLDOWN_MS = 2_000;

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

  /** IP → last-known display name (persists while server runs). */
  private knownPlayers = new Map<string, string>();

  /** Per-client session action cooldown (clientId → last action timestamp). */
  private lastSessionAction = new Map<string, number>();

  /** Players disconnected mid-game waiting for reconnection (keyed by IP). */
  private pendingReconnects = new Map<string, PendingReconnect>();

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
    socket.on(MessageType.DEBUG_SPAWN_ENEMIES,  (c, m) => this.onDebugAction(c, () => this.onDebugSpawnEnemies(c, m as DebugSpawnEnemiesMessage)));
    socket.on(MessageType.DEBUG_WAVE_SKIP,     (c) => this.onDebugAction(c, () => this.session?.debugWaveSkip((cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.DEBUG_WAVE_PAUSE,    (c) => this.onDebugAction(c, () => this.session?.debugWavePause((cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.DEBUG_GIVE_RESOURCES, (c) => this.onDebugAction(c, () => this.session?.debugGiveResources(c.id, (cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.CHAT,                 (c, m) => this.onChat(c, m as ChatSendMessage));
    socket.on(MessageType.PAUSE_VOTE,            (c) => this.onPauseVote(c));
    socket.onDisconnect((c) => this.onDisconnect(c));
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
        };
        this.socket.send(client, ack);
        return;
      }
    }
  }

  private onSessionCreate(client: ConnectedClient, _msg: SessionCreateMessage): void {
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

    const seed = Math.floor(Math.random() * 2 ** 31);
    const sessionId = `session-${Date.now()}`;
    this.session = new GameSession(sessionId, seed);

    const displayName = this.displayNames.get(client.id) ?? `Player${client.id}`;
    const player = this.session.addPlayer(client, displayName, /* isHost */ true);

    const ack: SessionAckMessage = {
      type: MessageType.SESSION_ACK,
      sessionId,
      code: this.session.code,
      seed,
      slot: player.slot,
      playerId: player.playerId,
      isHost: true,
      players: this.session.getLobbySlots(),
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
    const player = this.session.addPlayer(client, displayName, /* isHost */ false);

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
    };
    this.socket.send(client, ack);

    // Notify all other players in the session
    const joined: PlayerJoinedMessage = {
      type: MessageType.PLAYER_JOINED,
      player: { playerId: player.playerId, displayName, slot: player.slot, isHost: false },
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

  /** Host-only guard for debug commands. */
  private onDebugAction(client: ConnectedClient, action: () => void): void {
    if (!this.session?.getPlayer(client.id)?.isHost) return;
    action();
  }

  private onDebugSpawnEnemies(client: ConnectedClient, msg: DebugSpawnEnemiesMessage): void {
    this.session?.debugSpawnEnemies(client.id, msg.count);
  }

  private onPauseVote(client: ConnectedClient): void {
    this.session?.handlePauseVote(client.id, (c, m) => this.socket.send(c, m));
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

  private onDisconnect(client: ConnectedClient): void {
    this.displayNames.delete(client.id);
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
