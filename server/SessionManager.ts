import type { ConnectedClient } from './net/ServerSocket';
import type { ServerSocket } from './net/ServerSocket';
import { GameSession } from './GameSession';
import type { DiscoveryBeacon } from './discovery';
import { MessageType } from '@shared/protocol';
import type {
  SessionCreateMessage,
  SessionJoinMessage,
  SessionStartMessage,
  SessionLeaveMessage,
  InputMessage,
  AttackMessage,
  DebugSpawnEnemiesMessage,
  ChatSendMessage,
  SessionAckMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  SessionClosedMessage,
  ChatMessage,
} from '@shared/protocol';

/**
 * SessionManager wires socket message handlers to GameSession lifecycle.
 *
 * Phase 3 supports exactly one session at a time (the single-LAN-server model).
 * Phase 8 will add multi-session lobbies.
 */
export class SessionManager {
  private session: GameSession | null = null;

  /** displayName stored on HANDSHAKE — keyed by clientId. */
  private displayNames = new Map<string, string>();

  constructor(
    private readonly socket: ServerSocket,
    private readonly beacon: DiscoveryBeacon,
  ) {
    socket.on(MessageType.HANDSHAKE,      (c, m) => this.onHandshake(c, m as { displayName?: string }));
    socket.on(MessageType.SESSION_CREATE, (c, m) => this.onSessionCreate(c, m as SessionCreateMessage));
    socket.on(MessageType.SESSION_JOIN,   (c, m) => this.onSessionJoin(c, m as SessionJoinMessage));
    socket.on(MessageType.SESSION_LEAVE,  (c, m) => this.onSessionLeave(c, m as SessionLeaveMessage));
    socket.on(MessageType.SESSION_START,  (c, m) => this.onSessionStart(c, m as SessionStartMessage));
    socket.on(MessageType.INPUT,          (c, m) => this.onInput(c, m as InputMessage));
    socket.on(MessageType.ATTACK,               (c, m) => this.onAttack(c, m as AttackMessage));
    socket.on(MessageType.DEBUG_SPAWN_ENEMIES,  (c, m) => this.onDebugAction(c, () => this.onDebugSpawnEnemies(c, m as DebugSpawnEnemiesMessage)));
    socket.on(MessageType.DEBUG_WAVE_SKIP,     (c) => this.onDebugAction(c, () => this.session?.debugWaveSkip((cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.DEBUG_WAVE_PAUSE,    (c) => this.onDebugAction(c, () => this.session?.debugWavePause((cl, msg) => this.socket.send(cl, msg))));
    socket.on(MessageType.CHAT,                 (c, m) => this.onChat(c, m as ChatSendMessage));
    socket.on(MessageType.PAUSE_VOTE,            (c) => this.onPauseVote(c));
    socket.onDisconnect((c) => this.onDisconnect(c));
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  private onHandshake(client: ConnectedClient, msg: { displayName?: string }): void {
    const name = (msg.displayName ?? '').trim().slice(0, 24) || `Player${client.id}`;
    this.displayNames.set(client.id, name);
  }

  private onSessionCreate(client: ConnectedClient, _msg: SessionCreateMessage): void {
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
    if (!this.session) {
      this.socket.send(client, {
        type: MessageType.ERROR,
        code: 'NO_SESSION',
        message: 'No session exists. Host one first.',
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
    this.handlePlayerLeave(client);
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

    console.log(`[Session] Game starting — ${this.session.playerCount} player(s)`);
    this.session.start((c, msg) => this.socket.send(c, msg));
  }

  private onInput(client: ConnectedClient, msg: InputMessage): void {
    this.session?.applyInput(client.id, msg);
  }

  private onAttack(client: ConnectedClient, msg: AttackMessage): void {
    this.session?.handleAttack(client.id, msg, (c, m) => this.socket.send(c, m));
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
    this.handlePlayerLeave(client);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private handlePlayerLeave(client: ConnectedClient): void {
    if (!this.session) return;

    const player = this.session.removePlayer(client.id);
    if (!player) return;

    console.log(`[Session] ${player.displayName} left (slot ${player.slot})`);

    if (player.isHost) {
      // Host left — close the session for everyone immediately
      console.log('[Session] Host left — closing session for all remaining players');
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
      playerId: player.playerId,
      slot: player.slot,
    };
    this.broadcastToSession(left, client.id);

    // Re-evaluate pause votes now that a player left
    if (this.session.isPlaying) {
      this.session.recheckPauseVotes((c, m) => this.socket.send(c, m));
    }

    // Destroy the session when it's empty
    if (this.session.playerCount === 0) {
      console.log('[Session] Session empty — destroying');
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
