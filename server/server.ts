import { SERVER_PORT, TICK_RATE } from '@shared/constants';
import { GameLoop } from './core/GameLoop';
import { ServerSocket } from './net/ServerSocket';
import { SessionManager } from './core/SessionManager';
import { DiscoveryBeacon } from './discovery';

// ─── Network ──────────────────────────────────────────────────────────────────

// Allow PORT env var override for cloud deployments (e.g. AWS, Railway).
const port     = process.env.PORT ? parseInt(process.env.PORT, 10) : SERVER_PORT;
const socket   = new ServerSocket(port);
const beacon   = new DiscoveryBeacon(port);
const sessions = new SessionManager(socket, beacon);

// ─── Game loop ────────────────────────────────────────────────────────────────

const loop = new GameLoop((dt) => sessions.tick(dt));

// ─── Start ───────────────────────────────────────────────────────────────────

socket.ready
  .then(() => {
    loop.start();
    beacon.start();
    console.log(`[Server] Purrmadeath server started`);
    console.log(`[Server]   Port:      ${port}`);
    console.log(`[Server]   Tick rate: ${TICK_RATE} TPS`);
    console.log(`[Server]   Discovery: UDP broadcast on port 7778`);
  })
  .catch((err: Error) => {
    console.error(`[Server] Failed to start: ${err.message}`);
    process.exit(1);
  });

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('[Server] Shutting down…');
  loop.stop();
  beacon.stop();
  process.exit(0);
});
