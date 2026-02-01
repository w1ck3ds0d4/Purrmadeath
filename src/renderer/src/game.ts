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

import { World } from '@shared/ecs/World';
import { C, PositionComponent } from '@shared/components';

import { InputManager, Action } from './input/InputManager';
import { GameStateManager, GameState } from './state/GameStateManager';
import { InputSystem } from './systems/InputSystem';
import { MovementSystem } from './systems/MovementSystem';
import { StaminaSystem } from './systems/StaminaSystem';
import { PlayerRendererSystem } from './systems/PlayerRendererSystem';
import { spawnPlayer } from './world/PlayerSpawner';
import { HUD } from './ui/HUD';
import { MenuOverlay } from './ui/MenuOverlay';

// Slow world pan behind the main menu (world pixels per millisecond)
const BG_PAN_X = 0.05;
const BG_PAN_Y = 0.025;

async function main(): Promise<void> {
  const container = document.getElementById('game');
  if (!container) throw new Error('Missing #game element in index.html');

  // ── Renderer ─────────────────────────────────────────────────────────────────
  const renderer = new Renderer();
  await renderer.init(container);

  // ── World generator + chunk cache ─────────────────────────────────────────────
  const seed      = Math.floor(Math.random() * 2 ** 31);
  const generator = new WorldGenerator(seed);
  const chunks    = new ChunkManager(generator);

  // ── Camera ───────────────────────────────────────────────────────────────────
  const camera = new Camera();

  // ── Render layers ─────────────────────────────────────────────────────────────
  const tileRenderer = new TileRenderer(renderer.stage);

  // Player graphics live inside worldContainer so they share the camera transform
  const playerRenderer = new PlayerRendererSystem(tileRenderer.worldContainer);

  const hud   = new HUD(renderer.stage);
  const debug = new DebugOverlay(renderer.stage);

  // ── ECS world ─────────────────────────────────────────────────────────────────
  const world = new World();

  // ── Input ─────────────────────────────────────────────────────────────────────
  const input = new InputManager();

  // ── Game systems ──────────────────────────────────────────────────────────────
  const inputSystem    = new InputSystem(input);
  const movementSystem = new MovementSystem(chunks);
  const staminaSystem  = new StaminaSystem();

  // ── State machine ─────────────────────────────────────────────────────────────
  const stateMgr = new GameStateManager();

  // ── HTML menu overlay ─────────────────────────────────────────────────────────
  const menu = new MenuOverlay();

  // ── State: Menu ───────────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Menu, () => {
    menu.showMenu();
    hud.setVisible(false);
  });

  // ── State: Loading → finds spawn point then transitions to Playing ────────────
  stateMgr.onEnter(GameState.Loading, () => {
    menu.hide();
    world.clear();
    playerRenderer.destroy();

    // Spawn P1 at a walkable tile near the world origin
    const playerId = spawnPlayer(world, generator, 0);

    // Snap the camera to the player instantly so there's no initial lerp jump
    const pos = world.getComponent<PositionComponent>(playerId, C.Position)!;
    camera.x       = pos.x;
    camera.y       = pos.y;
    camera.targetX = pos.x;
    camera.targetY = pos.y;

    hud.setVisible(true);
    stateMgr.transition(GameState.Playing);
  });

  // ── State: Playing ────────────────────────────────────────────────────────────
  // Systems run automatically in the ticker — no extra setup on enter.
  stateMgr.onEnter(GameState.Playing, () => {
    menu.hide();
  });

  // ── State: Paused ─────────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Paused, () => {
    menu.showPause();
  });

  // ── Menu button callbacks ──────────────────────────────────────────────────────
  menu.setCallbacks({
    onNewGame:    () => stateMgr.transition(GameState.Loading),
    onResume:     () => stateMgr.transition(GameState.Playing),
    onQuitToMenu: () => {
      world.clear();
      playerRenderer.destroy();
      stateMgr.transition(GameState.Menu);
    },
  });

  // ── Network ───────────────────────────────────────────────────────────────────
  const net = new NetworkClient(`ws://localhost:${SERVER_PORT}`);
  net.on(MessageType.HANDSHAKE_ACK, (msg) => {
    const ack = msg as HandshakeAckMessage;
    console.log(`[Game] Server connected — clientId: ${ack.clientId}`);
  });
  net.connect();

  // ── Start in Menu ─────────────────────────────────────────────────────────────
  stateMgr.transition(GameState.Menu);

  // ── Game loop ─────────────────────────────────────────────────────────────────
  renderer.ticker.add((ticker) => {
    const dt    = ticker.deltaMS / 1000;
    const state = stateMgr.current;

    // — ESC toggles pause (works in both Playing and Paused) —
    if (input.isJustPressed(Action.Pause)) {
      if (state === GameState.Playing) {
        stateMgr.transition(GameState.Paused);
      } else if (state === GameState.Paused) {
        stateMgr.transition(GameState.Playing);
      }
    }

    // — Menu: slowly pan the world as an animated background —
    if (state === GameState.Menu) {
      camera.targetX += BG_PAN_X * ticker.deltaMS;
      camera.targetY += BG_PAN_Y * ticker.deltaMS;
    }

    // — Playing: tick all game systems —
    if (state === GameState.Playing) {
      inputSystem.update(world);
      movementSystem.update(world, dt);
      staminaSystem.update(world, dt);
      playerRenderer.update(world);

      // Camera follows the first player entity
      const players = world.query(C.Position, C.PlayerIndex);
      if (players.length > 0) {
        const pos = world.getComponent<PositionComponent>(players[0], C.Position)!;
        camera.targetX = pos.x;
        camera.targetY = pos.y;
      }
    }

    // — Camera update (lerp toward target + look-around ease) —
    camera.update(dt);

    // — Chunk streaming —
    const { width, height } = renderer.screen;
    const visible = chunks.getVisibleCoords(camera.viewX, camera.viewY, width, height, camera.zoom);
    for (const { cx, cy } of visible) {
      tileRenderer.addChunk(chunks.getOrGenerate(cx, cy));
    }
    const evicted = chunks.evictDistant(camera.viewX, camera.viewY);
    for (const { cx, cy } of evicted) {
      tileRenderer.removeChunk(cx, cy);
    }

    // — Apply camera transform to world layer —
    tileRenderer.applyCamera(camera.viewX, camera.viewY, camera.zoom, width, height);

    // — HUD (screen-space, visible only while playing) —
    if (state === GameState.Playing) {
      hud.update(world, width, height);
    }

    // — Debug overlay —
    const tileX = Math.floor(camera.x / TILE_SIZE);
    const tileY = Math.floor(camera.y / TILE_SIZE);
    const biome = BIOME_DEFS[generator.getBiome(tileX, tileY)].name;
    debug.update(dt, { camera, loadedChunks: tileRenderer.loadedChunkCount, biome, seed });

    // — Flush just-pressed key state —
    input.flush();
  });

  console.log(`[Game] Phase 2 running | seed: ${seed}`);
}

main().catch((err) => {
  console.error('[Game] Fatal startup error:', err);
});
