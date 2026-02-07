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
  private dropHandler: (() => void) | null = null;
  private connectHandler: (() => void) | null = null;

  // ── Network metrics ──────────────────────────────────────────────────────────
  private pingTime = 0;
  private rtt = 0;
  /** Circular window of the last 20 pings: true = pong received, false = lost. */
  private pingWindow = new Array<boolean>(20).fill(true);
  private pingWindowIdx = 0;
  private msgCount = 0;
  private msgCountStart = 0;
  private msgsPerSec = 0;

  constructor(private url: string) {
    // Internal PONG handler for latency / packet-loss tracking.
    // Registered once so reconnects don't stack up duplicate handlers.
    this.on(MessageType.PONG, () => {
      this.rtt = Math.round(performance.now() - this.pingTime);
      this.pingWindow[this.pingWindowIdx] = true;
    });
  }

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[Net] Connected to server');
      this.reconnectDelay = 1_000; // reset backoff on success
      this.startPing();
      this.connectHandler?.();
    };

    this.ws.onmessage = (event: MessageEvent<string>) => {
      // Track incoming message rate
      this.msgCount++;
      const now = performance.now();
      const elapsed = now - this.msgCountStart;
      if (elapsed >= 1_000) {
        this.msgsPerSec = Math.round(this.msgCount / elapsed * 1_000);
        this.msgCount = 0;
        this.msgCountStart = now;
      }

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
        // Unexpected drop — notify the game before attempting reconnect
        this.dropHandler?.();
        // Only reconnect if the handler didn't call disconnect()
        if (this.shouldReconnect) {
          console.log(`[Net] Reconnecting in ${this.reconnectDelay}ms…`);
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
          setTimeout(() => { if (this.shouldReconnect) this.connect(); }, this.reconnectDelay);
        }
      }
    };

    this.ws.onerror = () => {
      // onerror fires before onclose — the reconnect happens in onclose
      console.warn('[Net] WebSocket error');
    };
  }

  /** Called when the WebSocket opens (fires on initial connect AND reconnects). */
  onConnect(handler: () => void): void {
    this.connectHandler = handler;
  }

  /** Called when the connection drops unexpectedly (not via disconnect()). */
  onDrop(handler: () => void): void {
    this.dropHandler = handler;
  }

  /** Close current connection and reconnect to a different URL (dev-mode IP switching). */
  reconnectTo(newUrl: string): void {
    this.url = newUrl;
    this.stopPing();
    // Detach handlers from old socket so its onclose doesn't trigger drop/reconnect
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }
    this.reconnectDelay = 1_000;
    this.connect();
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
    this.msgCountStart = performance.now();
    this.pingInterval = setInterval(() => {
      // Advance circular window and mark this slot as pending (no pong yet)
      this.pingWindowIdx = (this.pingWindowIdx + 1) % this.pingWindow.length;
      this.pingWindow[this.pingWindowIdx] = false;
      this.pingTime = performance.now();
      this.send({ type: MessageType.PING });
    }, 2_000);
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

  /** Live network metrics for the debug overlay. */
  get stats(): { rtt: number; packetLoss: number; msgsPerSec: number } {
    const lost = this.pingWindow.filter((v) => !v).length;
    return {
      rtt: this.rtt,
      packetLoss: Math.round(lost / this.pingWindow.length * 100),
      msgsPerSec: this.msgsPerSec,
    };
  }
}