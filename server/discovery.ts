import * as dgram from 'node:dgram';

/** UDP port used for LAN session discovery beacons. */
export const DISCOVERY_PORT = 7778;

const BEACON_INTERVAL_MS = 2_000;

export interface DiscoveryBeaconPayload {
  /** 4-letter session code. */
  code: string;
  /** WebSocket game server port. */
  port: number;
  /** Current lobby player count. */
  playerCount: number;
  /** Maximum players per session. */
  maxPlayers: number;
  /** Protocol version - receivers should ignore beacons with mismatched versions. */
  v: number;
}

/**
 * Broadcasts a UDP LAN discovery beacon every 2 seconds.
 *
 * The Electron main process listens for these packets on DISCOVERY_PORT
 * to build a list of available sessions. The joiner types a 4-letter code;
 * the main process resolves it to the host's IP without the joiner needing
 * to know the IP address.
 */
export class DiscoveryBeacon {
  private socket: dgram.Socket | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private payload: DiscoveryBeaconPayload;

  constructor(private readonly gamePort: number) {
    this.payload = { code: '', port: gamePort, playerCount: 0, maxPlayers: 4, v: 1 };
  }

  update(patch: Partial<Omit<DiscoveryBeaconPayload, 'port' | 'v'>>): void {
    Object.assign(this.payload, patch);
  }

  start(): void {
    const sock = dgram.createSocket('udp4');
    this.socket = sock;

    sock.bind(0, () => {
      try {
        sock.setBroadcast(true);
      } catch (e) {
        console.warn('[Discovery] Could not set broadcast:', (e as Error).message);
      }
      // Start broadcasting immediately after bind
      this.interval = setInterval(() => this.broadcast(), BEACON_INTERVAL_MS);
      this.broadcast(); // send one right away
    });

    sock.on('error', (err) => {
      console.warn('[Discovery] UDP error:', err.message);
    });
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.socket?.close();
    this.socket = null;
  }

  private broadcast(): void {
    if (!this.socket || !this.payload.code) return;
    const buf = Buffer.from(JSON.stringify(this.payload));
    this.socket.send(buf, 0, buf.length, DISCOVERY_PORT, '255.255.255.255', (err) => {
      if (err) console.warn('[Discovery] Send error:', err.message);
    });
  }
}
