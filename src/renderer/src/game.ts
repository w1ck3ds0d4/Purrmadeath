import { Renderer } from './render/Renderer';
import { Camera } from './render/Camera';
import { TileRenderer } from './render/TileRenderer';
import { ChunkManager } from './world/ChunkManager';
import { DebugOverlay } from './ui/DebugOverlay';
import { NetworkClient } from './net/NetworkClient';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import { BIOME_DEFS } from '@shared/world/BiomeRegistry';
import { MessageType } from '@shared/protocol';
import { SERVER_PORT, TILE_SIZE } from '@shared/constants';
import type { HandshakeAckMessage } from '@shared/protocol';

// ─── Phase 1 constants ────────────────────────────────────────────────────────

/** How fast WASD moves the camera target in world pixels per second (Phase 1 only). */
const CAMERA_MOVE_SPEED = 400;

async function main(): Promise<void> {
  const container = document.getElementById('game');
  if (!container) throw new Error('Missing #game element in index.html');

  // ── Renderer ───────────────────────────────────────────────────────────────
  const renderer = new Renderer();
  await renderer.init(container);

  // ── World ──────────────────────────────────────────────────────────────────
  // Random seed for now — Phase 6 adds seeded runs and seed selection UI.
  const seed = Math.floor(Math.random() * 2 ** 31);
  const generator = new WorldGenerator(seed);
  const chunks = new ChunkManager(generator);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const camera = new Camera();

  // ── Render layers ──────────────────────────────────────────────────────────
  const tileRenderer = new TileRenderer(renderer.stage);
  const debug = new DebugOverlay(renderer.stage);

  // ── Network ────────────────────────────────────────────────────────────────
  const net = new NetworkClient(`ws://localhost:${SERVER_PORT}`);
  net.on(MessageType.HANDSHAKE_ACK, (msg) => {
    const ack = msg as HandshakeAckMessage;
    console.log(`[Game] Server connected — clientId: ${ack.clientId}`);
  });
  net.connect();

  // ── Phase 1 WASD input ─────────────────────────────────────────────────────
  // Temporary keyboard movement of the camera target.
  // Replaced in Phase 2 by the player entity's position.
  const keys = new Set<string>();
  document.addEventListener('keydown', (e) => keys.add(e.key));
  document.addEventListener('keyup', (e) => keys.delete(e.key));

  // ── Game loop ──────────────────────────────────────────────────────────────
  renderer.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000; // seconds

    // — Phase 1: WASD moves the camera target directly —
    if (keys.has('w') || keys.has('ArrowUp'))    camera.targetY -= CAMERA_MOVE_SPEED * dt;
    if (keys.has('s') || keys.has('ArrowDown'))  camera.targetY += CAMERA_MOVE_SPEED * dt;
    if (keys.has('a') || keys.has('ArrowLeft'))  camera.targetX -= CAMERA_MOVE_SPEED * dt;
    if (keys.has('d') || keys.has('ArrowRight')) camera.targetX += CAMERA_MOVE_SPEED * dt;

    // — Camera update (lerp + look-around offset) —
    camera.update(dt);

    // — Chunk streaming —
    const { width, height } = renderer.screen;
    const visible = chunks.getVisibleCoords(camera.viewX, camera.viewY, width, height, camera.zoom);

    for (const { cx, cy } of visible) {
      const chunk = chunks.getOrGenerate(cx, cy);
      tileRenderer.addChunk(chunk); // idempotent — skips already-rendered chunks
    }

    const evicted = chunks.evictDistant(camera.viewX, camera.viewY);
    for (const { cx, cy } of evicted) {
      tileRenderer.removeChunk(cx, cy);
    }

    // — Apply camera to world —
    tileRenderer.applyCamera(camera.viewX, camera.viewY, camera.zoom, width, height);

    // — Debug overlay —
    const tileX = Math.floor(camera.x / TILE_SIZE);
    const tileY = Math.floor(camera.y / TILE_SIZE);
    const biome = BIOME_DEFS[generator.getBiome(tileX, tileY)].name;
    debug.update(dt, { camera, loadedChunks: tileRenderer.loadedChunkCount, biome, seed });
  });

  console.log(`[Game] Phase 1 running | seed: ${seed}`);
}

main().catch((err) => {
  console.error('[Game] Fatal startup error:', err);
});
