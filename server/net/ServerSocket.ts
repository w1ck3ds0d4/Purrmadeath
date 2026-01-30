import { WebSocketServer, WebSocket } from 'ws';
import { MessageType } from '@shared/protocol';
import type { BaseMessage } from '@shared/protocol';
import {
  HEARTBEAT_TIMEOUT_MS,
  MAX_PLAYERS,
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES_PER_SECOND,
} from '@shared/constants';

/** Represents one connected client from the server's perspective. */
export interface ConnectedClient {
  id: string;
  ws: WebSocket;
  /** Timestamp of the last received PING (used to detect stale connections). */
  lastPing: number;
  /** Rate-limit state: messages received in the current 1-second window. */
  rateCount: number;
  /** Start of the current rate-limit window (ms). */
  rateWindowStart: number;
}

type ClientHandler = (client: ConnectedClient, msg: BaseMessage) => void;

/**
 * ServerSocket wraps the `ws` WebSocketServer with:
 *   - Hard connection cap at MAX_PLAYERS
 *   - 64 KB payload size limit (prevents memory exhaustion)
 *   - Per-client message rate limiting (disconnects flood attackers)
 *   - Message type validation before dispatch
 *   - Automatic PING/PONG heartbeat
 *   - Stale-client cleanup on a periodic timer
 *   - Safe send / broadcast helpers that check socket state first
 *
 * Phase 3+ will add session and room management on top of this layer.
 */
export class ServerSocket {
  private wss: WebSocketServer;
  private clients = new Map<string, ConnectedClient>();
  private handlers = new Map<string, Set<ClientHandler>>();
  private nextId = 1;

  constructor(port: number) {
    this.wss = new WebSocketServer({
      port,
      // Reject any message larger than MAX_MESSAGE_BYTES at the transport level.
      // This prevents a single client from allocating unbounded server memory.
      maxPayload: MAX_MESSAGE_BYTES,
    });
    this.setupServer();
    // Sweep for dead connections every 30 s
    setInterval(() => this.sweepDeadClients(), 30_000);
  }

  // ── Server setup ────────────────────────────────────────────────────────────

  private setupServer(): void {
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.wss.on('error', (err) => console.error('[ServerSocket] WSS error:', err.message));
  }

  private onConnection(ws: WebSocket): void {
    // Enforce the player cap before doing anything else.
    // Close code 1013 = "Try Again Later" (RFC 6455).
    if (this.clients.size >= MAX_PLAYERS) {
      ws.close(1013, 'Server full');
      return;
    }

    const id = String(this.nextId++);
    const now = Date.now();
    const client: ConnectedClient = {
      id,
      ws,
      lastPing: now,
      rateCount: 0,
      rateWindowStart: now,
    };
    this.clients.set(id, client);
    console.log(`[Server] Client ${id} connected (${this.clients.size}/${MAX_PLAYERS})`);

    // Acknowledge the connection with the server's current tick
    this.send(client, {
      type: MessageType.HANDSHAKE_ACK,
      clientId: id,
      serverTick: 0, // game loop tick counter wired in Phase 3
    });

    ws.on('message', (data) => {
      // Rate-limit check: slide the window if needed, then count this message.
      // Exceeding the limit disconnects the client immediately.
      if (!this.checkRateLimit(client)) {
        console.warn(`[Server] Client ${id} exceeded rate limit — disconnecting`);
        ws.close(1008, 'Rate limit exceeded'); // 1008 = Policy Violation
        this.clients.delete(id);
        return;
      }

      try {
        const msg = JSON.parse(data.toString()) as BaseMessage;

        // Validate the `type` field before touching the dispatch table.
        // An absent, non-string, empty, or oversized type is silently dropped.
        if (!this.isValidType(msg.type)) {
          console.warn(`[Server] Client ${id} sent invalid message type`);
          return;
        }

        this.dispatch(client, msg);
      } catch {
        console.warn(`[Server] Unparseable message from client ${id}`);
      }
    });

    ws.on('close', () => {
      this.clients.delete(id);
      console.log(`[Server] Client ${id} disconnected (${this.clients.size}/${MAX_PLAYERS})`);
    });

    ws.on('error', (err) => {
      console.error(`[Server] Client ${id} error: ${err.message}`);
      this.clients.delete(id);
    });
  }

  // ── Rate limiting ───────────────────────────────────────────────────────────

  /**
   * Sliding-window rate limiter: allows MAX_MESSAGES_PER_SECOND per client.
   * Returns false if the client has exceeded the limit.
   */
  private checkRateLimit(client: ConnectedClient): boolean {
    const now = Date.now();
    if (now - client.rateWindowStart >= 1_000) {
      // Reset window
      client.rateWindowStart = now;
      client.rateCount = 0;
    }
    client.rateCount++;
    return client.rateCount <= MAX_MESSAGES_PER_SECOND;
  }

  // ── Message validation ──────────────────────────────────────────────────────

  /**
   * Ensure the message type is a non-empty string of reasonable length.
   * We don't restrict to known MessageType values here so that future
   * message types added by phases can be handled by registered handlers
   * without touching this file. The handler registry itself is the gate.
   */
  private isValidType(type: unknown): type is string {
    return typeof type === 'string' && type.length > 0 && type.length <= 64;
  }

  // ── Message routing ─────────────────────────────────────────────────────────

  private dispatch(client: ConnectedClient, msg: BaseMessage): void {
    // Built-in PING handler — keeps the connection alive without reaching user code
    if (msg.type === MessageType.PING) {
      client.lastPing = Date.now();
      this.send(client, { type: MessageType.PONG });
      return;
    }

    const handlers = this.handlers.get(msg.type);
    if (handlers) {
      for (const fn of handlers) fn(client, msg);
    }
  }

  /** Register a handler for a specific message type. */
  on(type: MessageType, handler: ClientHandler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
  }

  // ── Send helpers ────────────────────────────────────────────────────────────

  /** Send a message to a single client. No-op if the socket is not open. */
  send(client: ConnectedClient, msg: object): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg));
    }
  }

  /** Send a message to all connected clients, optionally excluding one. */
  broadcast(msg: object, excludeId?: string): void {
    const data = JSON.stringify(msg);
    for (const [id, client] of this.clients) {
      if (id !== excludeId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────────

  private sweepDeadClients(): void {
    const now = Date.now();
    for (const [id, client] of this.clients) {
      if (now - client.lastPing > HEARTBEAT_TIMEOUT_MS) {
        console.warn(`[Server] Client ${id} timed out — terminating`);
        client.ws.terminate();
        this.clients.delete(id);
      }
    }
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  get clientCount(): number {
    return this.clients.size;
  }

  getClient(id: string): ConnectedClient | undefined {
    return this.clients.get(id);
  }

  getAllClients(): IterableIterator<ConnectedClient> {
    return this.clients.values();
  }
}
