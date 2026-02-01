import { SERVER_PORT, TICK_RATE } from '@shared/constants';
import { GameLoop } from './GameLoop';
import { ServerSocket } from './net/ServerSocket';
import { SessionManager } from './SessionManager';
import { DiscoveryBeacon } from './discovery';

// ─── Network ──────────────────────────────────────────────────────────────────

const socket   = new ServerSocket(SERVER_PORT);
const beacon   = new DiscoveryBeacon(SERVER_PORT);
const sessions = new SessionManager(socket, beacon);

// ─── Game loop ────────────────────────────────────────────────────────────────

const loop = new GameLoop((dt) => sessions.tick(dt));

loop.start();
beacon.start();

// ─── Startup log ──────────────────────────────────────────────────────────────

console.log(`[Server] Purrmadeath server started`);
console.log(`[Server]   Port:      ${SERVER_PORT}`);
console.log(`[Server]   Tick rate: ${TICK_RATE} TPS`);
console.log(`[Server]   Discovery: UDP broadcast on port 7778`);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('[Server] Shutting down…');
  loop.stop();
  beacon.stop();
  process.exit(0);
});
