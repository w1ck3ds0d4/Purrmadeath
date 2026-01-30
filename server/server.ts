import { World } from '@shared/ecs/World';
import { SystemRunner } from '@shared/ecs/SystemRunner';
import { SERVER_PORT, TICK_RATE } from '@shared/constants';
import { GameLoop } from './GameLoop';
import { ServerSocket } from './net/ServerSocket';

// ─── World & systems ──────────────────────────────────────────────────────────

/** The canonical ECS world. All game state lives here. */
const world = new World();

/**
 * Server system runner.
 * Phase 1+: register systems here in update order, e.g.:
 *   systems.add(new AiSystem()).add(new MovementSystem()).add(new CombatSystem());
 */
const systems = new SystemRunner();

// ─── Network ──────────────────────────────────────────────────────────────────

const socket = new ServerSocket(SERVER_PORT);

// Phase 3: register message handlers here, e.g.:
//   socket.on(MessageType.INPUT, (client, msg) => { ... });

// ─── Game loop ────────────────────────────────────────────────────────────────

const loop = new GameLoop((dt) => tick(dt));

function tick(dt: number): void {
  // Run all server systems (AI, movement, combat, spawning, etc.)
  systems.update(world, dt);

  // Phase 3+: compute delta and broadcast to all clients
  // socket.broadcast({ type: MessageType.DELTA, ... });
}

loop.start();

// ─── Startup log ──────────────────────────────────────────────────────────────

console.log(`[Server] Purrmadeath server started`);
console.log(`[Server]   Port: ${SERVER_PORT}`);
console.log(`[Server]   Tick rate: ${TICK_RATE} TPS`);
console.log(`[Server]   Systems: ${systems.count}`);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('[Server] Shutting down…');
  loop.stop();
  process.exit(0);
});
