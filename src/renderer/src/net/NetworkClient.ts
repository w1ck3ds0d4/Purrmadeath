import { MessageType } from '@shared/protocol';
import type { BaseMessage } from '@shared/protocol';

type MessageHandler = (msg: BaseMessage) => void;

/**
 * NetworkClient manages the WebSocket connection to the authoritative game server.
 *
 * Features:
 *   - Automatic reconnect with exponential backoff
 *   - Typed message dispatch via on() / off()
 *   - Heartbeat PING sent every PING_INTERVAL_MS to keep the connection alive
 *
 * Phase 3+ will add:
 *   - Input buffering and sequence numbering for client-side prediction
 *   - Message queue drain for burst sends
 */
export class NetworkClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectDelay = 1_000; // ms, doubles on each failed attempt (max 30 s)
  private shouldReconnect = true;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly url: string) {}

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[Net] Connected to server');
      this.reconnectDelay = 1_000; // reset backoff on success
      this.startPing();
    };

    this.ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as BaseMessage;
        this.dispatch(msg);
      } catch {
        console.warn('[Net] Received unparseable message');
      }
    };

    this.ws.onclose = () => {
      console.log('[Net] Disconnected');
      this.stopPing();
      if (this.shouldReconnect) {
        console.log(`[Net] Reconnecting in ${this.reconnectDelay}ms…`);
        setTimeout(() => this.connect(), this.reconnectDelay);
        // Exponential backoff, capped at 30 s
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      }
    };

    this.ws.onerror = () => {
      // onerror fires before onclose — the reconnect happens in onclose
      console.warn('[Net] WebSocket error');
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopPing();
    this.ws?.close();
  }

  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Register a handler for a specific message type. */
  on(type: MessageType, handler: MessageHandler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
  }

  /** Remove a previously registered handler. */
  off(type: MessageType, handler: MessageHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  private dispatch(msg: BaseMessage): void {
    const handlers = this.handlers.get(msg.type);
    if (handlers) {
      for (const fn of handlers) fn(msg);
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(
      () => this.send({ type: MessageType.PING }),
      15_000
    );
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}