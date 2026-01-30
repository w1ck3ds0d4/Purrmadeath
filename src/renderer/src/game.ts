import { Renderer } from './render/Renderer';
import { NetworkClient } from './net/NetworkClient';
import { MessageType } from '@shared/protocol';
import { SERVER_PORT } from '@shared/constants';
import type { HandshakeAckMessage } from '@shared/protocol';

/**
 * game.ts — client entry point.
 *
 * Bootstraps the renderer and network client, then hands off to the game loop.
 * Phase 0: proves Pixi.js renders and the WS connection is established.
 * Phase 2+: will create the ECS World, register client systems, and start rAF loop.
 */
async function main(): Promise<void> {
  const container = document.getElementById('game');
  if (!container) throw new Error('Missing #game element in index.html');

  // ── Renderer ───────────────────────────────────────────────────────────────
  const renderer = new Renderer();
  await renderer.init(container);
  console.log('[Game] Renderer initialized');

  // ── Network ────────────────────────────────────────────────────────────────
  const net = new NetworkClient(`ws://localhost:${SERVER_PORT}`);

  net.on(MessageType.HANDSHAKE_ACK, (msg) => {
    const ack = msg as HandshakeAckMessage;
    console.log(`[Game] Connected! clientId=${ack.clientId} serverTick=${ack.serverTick}`);
  });

  net.connect();

  console.log('[Game] Purrmadeath Phase 0 running');
}

main().catch((err) => {
  console.error('[Game] Fatal startup error:', err);
});