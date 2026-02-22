import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { MessageType } from '@shared/protocol';
import type { BaseMessage } from '@shared/protocol';
import {
  HEARTBEAT_TIMEOUT_MS,
  MAX_CONNECTIONS,
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES_PER_SECOND,
  GAME_VERSION,
} from '@shared/constants';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** Represents one connected client from the server's perspective. */
export interface ConnectedClient {
  id: string;
  ws: WebSocket;
  /** Remote IP address of the client. */
  ip: string;
  /** Timestamp of the last received PING (used to detect stale connections). */
  lastPing: number;
  /** Rate-limit state: messages received in the current 1-second window. */
  rateCount: number;
  /** Start of the current rate-limit window (ms). */
  rateWindowStart: number;
}

type ClientHandler = (client: ConnectedClient, msg: BaseMessage) => void;
type DisconnectHandler = (client: ConnectedClient) => void;
type NameLookup = (ip: string) => string | undefined;

/**
 * ServerSocket wraps the `ws` WebSocketServer with:
 *   - Hard connection cap at MAX_CONNECTIONS
 *   - Per-IP connection limit (1 in production, unlimited in dev)
 *   - 64 KB payload size limit (prevents memory exhaustion)
 *   - Per-client message rate limiting (disconnects flood attackers)
 *   - Message type validation before dispatch
 *   - Automatic PING/PONG heartbeat
 *   - Stale-client cleanup on a periodic timer
 *   - Safe send / broadcast helpers that check socket state first
 *   - onDisconnect callback for session cleanup
 */
export class ServerSocket {
  private wss: WebSocketServer;
  private clients = new Map<string, ConnectedClient>();
  private handlers = new Map<string, Set<ClientHandler>>();
  private disconnectHandlers = new Set<DisconnectHandler>();
  private nextId = 1;

  /** Tracks IP → set of active client IDs for per-IP enforcement. */
  private ipConnections = new Map<string, Set<string>>();

  /** Optional callback to look up a returning player's name by IP. */
  private nameLookup: NameLookup | null = null;

  /** Resolves when the WSS is listening; rejects on bind error (e.g. EADDRINUSE). */
  readonly ready: Promise<void>;

  constructor(port: number) {
    this.wss = new WebSocketServer({
      port,
      maxPayload: MAX_MESSAGE_BYTES,
    });

    this.ready = new Promise<void>((resolve, reject) => {
      this.wss.once('listening', resolve);
      this.wss.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} already in use — is another server running?`));
        } else {
          reject(err);
        }
      });
    });

    this.setupServer();
    // Sweep for dead connections every 30 s
    setInterval(() => this.sweepDeadClients(), 30_000);
  }

  /**
   * Register a function that returns a last-known display name for an IP.
   * Called during connection setup to populate HANDSHAKE_ACK.lastDisplayName.
   */
  setNameLookup(fn: NameLookup): void {
    this.nameLookup = fn;
  }

  // ── Server setup ────────────────────────────────────────────────────────────

  private setupServer(): void {
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    this.wss.on('error', (err) => console.error('[ServerSocket] WSS error:', err.message));
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    // ── Hard cap ────────────────────────────────────────────────────────────
    if (this.clients.size >= MAX_CONNECTIONS) {
      ws.close(1013, 'Server full');
      return;
    }

    // ── Extract IP ──────────────────────────────────────────────────────────
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim()
      ?? req.socket.remoteAddress
      ?? 'unknown';

    // ── Per-IP limit (production: max 4 connections per IP) ─────────────────
    if (IS_PRODUCTION) {
      const existing = this.ipConnections.get(ip);
      if (existing && existing.size >= 4) {
        ws.close(1008, 'Too many connections from this IP');
        return;
      }
    }

    const id = String(this.nextId++);
    const now = Date.now();
    const client: ConnectedClient = {
      id,
      ip,
      ws,
      lastPing: now,
      rateCount: 0,
      rateWindowStart: now,
    };
    this.clients.set(id, client);

    // Track IP → client
    if (!this.ipConnections.has(ip)) this.ipConnections.set(ip, new Set());
    this.ipConnections.get(ip)!.add(id);

    const knownName = this.nameLookup?.(ip);
    const whoConnect = knownName ? `"${knownName}"` : 'New player';
    console.log(`[Server] ${whoConnect} connected from ${ip} (${this.clients.size}/${MAX_CONNECTIONS})`);

    const lastDisplayName = this.nameLookup?.(ip);
    this.send(client, {
      type: MessageType.HANDSHAKE_ACK,
      clientId: id,
      serverTick: 0,
      serverVersion: GAME_VERSION,
      ...(lastDisplayName ? { lastDisplayName } : {}),
    });

    ws.on('message', (data) => {
      if (!this.checkRateLimit(client)) {
        console.warn(`[Server] ${this.nameLookup?.(ip) ?? `Client ${id}`} exceeded rate limit - disconnecting`);
        ws.close(1008, 'Rate limit exceeded');
        this.removeClient(id, client);
        return;
      }

      try {
        const msg = JSON.parse(data.toString()) as BaseMessage;
        if (!this.isValidType(msg.type)) {
          console.warn(`[Server] ${this.nameLookup?.(ip) ?? `Client ${id}`} sent invalid message type`);
          return;
        }
        this.dispatch(client, msg);
      } catch {
        console.warn(`[Server] Unparseable message from ${this.nameLookup?.(ip) ?? `Client ${id}`}`);
      }
    });

    ws.on('close', () => {
      const whoDisconnect = this.nameLookup?.(ip);
      this.removeClient(id, client);
      const tag = whoDisconnect ? `"${whoDisconnect}"` : `Client ${id}`;
      console.log(`[Server] ${tag} disconnected (${this.clients.size}/${MAX_CONNECTIONS})`);
    });

    ws.on('error', (err) => {
      console.error(`[Server] ${this.nameLookup?.(ip) ?? `Client ${id}`} error: ${err.message}`);
      this.removeClient(id, client);
    });
  }

  /** Internal: remove client and fire disconnect handlers. */
  private removeClient(id: string, client: ConnectedClient): void {
    if (!this.clients.has(id)) return; // already removed
    this.clients.delete(id);

    // Clean up IP tracking
    const ipSet = this.ipConnections.get(client.ip);
    if (ipSet) {
      ipSet.delete(id);
      if (ipSet.size === 0) this.ipConnections.delete(client.ip);
    }

    for (const fn of this.disconnectHandlers) fn(client);
  }

  // ── Rate limiting ───────────────────────────────────────────────────────────

  private checkRateLimit(client: ConnectedClient): boolean {
    const now = Date.now();
    if (now - client.rateWindowStart >= 1_000) {
      client.rateWindowStart = now;
      client.rateCount = 0;
    }
    client.rateCount++;
    return client.rateCount <= MAX_MESSAGES_PER_SECOND;
  }

  // ── Message validation ──────────────────────────────────────────────────────

  private isValidType(type: unknown): type is string {
    return typeof type === 'string' && type.length > 0 && type.length <= 64;
  }

  // ── Message routing ─────────────────────────────────────────────────────────

  private dispatch(client: ConnectedClient, msg: BaseMessage): void {
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

  /** Register a handler called whenever any client disconnects. */
  onDisconnect(handler: DisconnectHandler): void {
    this.disconnectHandlers.add(handler);
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
        console.warn(`[Server] Client ${id} timed out - terminating`);
        client.ws.terminate();
        this.removeClient(id, client);
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
