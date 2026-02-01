import { Renderer } from './render/Renderer';
import { Camera } from './render/Camera';
import { TileRenderer } from './render/TileRenderer';
import { ChunkManager } from './world/ChunkManager';
import { DebugOverlay } from './ui/DebugOverlay';
import { NetworkClient } from './net/NetworkClient';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import { BIOME_DEFS } from '@shared/world/BiomeRegistry';
import { MessageType } from '@shared/protocol';
import {
  SERVER_PORT,
  TILE_SIZE,
  PLAYER_MAX_STAMINA,
  PLAYER_STAMINA_REGEN,
  PLAYER_BASE_SPEED,
} from '@shared/constants';
import type {
  HandshakeAckMessage,
  SessionAckMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  SnapshotMessage,
  DeltaMessage,
  ChatMessage,
  LobbySlot,
} from '@shared/protocol';

import { World } from '@shared/ecs/World';
import { C, PositionComponent } from '@shared/components';

import { InputManager, Action } from './input/InputManager';
import { GameStateManager, GameState } from './state/GameStateManager';
import { InputSystem } from './systems/InputSystem';
import { MovementSystem } from './systems/MovementSystem';
import { StaminaSystem } from './systems/StaminaSystem';
import { PlayerRendererSystem } from './systems/PlayerRendererSystem';
import { RemotePlayerSystem } from './systems/RemotePlayerSystem';
import { Reconciler } from './net/Reconciler';
import { HUD } from './ui/HUD';
import { MenuOverlay } from './ui/MenuOverlay';
import { LobbyOverlay } from './ui/LobbyOverlay';

// Slow world pan behind menus (world pixels per millisecond)
const BG_PAN_X = 0.05;
const BG_PAN_Y = 0.025;

async function main(): Promise<void> {
  const container = document.getElementById('game');
  if (!container) throw new Error('Missing #game element in index.html');

  // ── Renderer ────────────────────────────────────────────────────────────────
  const renderer = new Renderer();
  await renderer.init(container);

  // ── Camera / render layers ──────────────────────────────────────────────────
  const camera = new Camera();
  const tileRenderer = new TileRenderer(renderer.stage);
  const playerRenderer = new PlayerRendererSystem(tileRenderer.worldContainer);
  const hud   = new HUD(renderer.stage);
  const debug = new DebugOverlay(renderer.stage);

  // ── ECS world ───────────────────────────────────────────────────────────────
  const world = new World();

  // ── Input ───────────────────────────────────────────────────────────────────
  const input = new InputManager();

  // ── World generation — deferred until server seed arrives ──────────────────
  // Menu/lobby use a seed-0 generator for the animated background pan.
  const menuGenerator = new WorldGenerator(0);
  const menuChunks    = new ChunkManager(menuGenerator);

  let generator: WorldGenerator | null = null;
  let chunks: ChunkManager | null = null;
  let seed = 0;
  // Track streamed menu chunks so we can remove them when the game starts
  const menuStreamedKeys = new Set<string>();

  // ── Game systems ────────────────────────────────────────────────────────────
  const inputSystem   = new InputSystem(input);
  const staminaSystem = new StaminaSystem();
  // MovementSystem depends on chunks — created when game starts
  let movementSystem: MovementSystem | null = null;

  // ── Multiplayer state ───────────────────────────────────────────────────────
  const reconciler      = new Reconciler();
  const remotePlayerSys = new RemotePlayerSystem(() => localEntityId);

  let net: NetworkClient | null = null;
  let localSlot        = 0;
  let localEntityId: number | null = null;
  let isHost           = false;
  let currentSessionId   = '';
  let currentSessionCode = '';
  let lobbyPlayers: LobbySlot[] = [];

  // ── State machine ───────────────────────────────────────────────────────────
  const stateMgr = new GameStateManager();

  // ── Overlays ─────────────────────────────────────────────────────────────────
  const menuOverlay  = new MenuOverlay();
  const lobbyOverlay = new LobbyOverlay();

  // ── State: Menu ─────────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Menu, () => {
    menuOverlay.showMenu();
    lobbyOverlay.hide();
    hud.setVisible(false);
    world.clear();
    playerRenderer.destroy();
    localEntityId = null;
    reconciler.localEntityId = null;
    if (net) { net.disconnect(); net = null; }
  });

  // ── State: Lobby ────────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Lobby, () => {
    menuOverlay.hide();
    lobbyOverlay.show(currentSessionId, currentSessionCode, isHost);
    lobbyOverlay.updatePlayers(lobbyPlayers);
    hud.setVisible(false);
  });

  // ── State: Playing ──────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Playing, () => {
    menuOverlay.hide();
    lobbyOverlay.hide();
    hud.setVisible(true);

    // Clear menu background chunks from the tile renderer
    for (const key of menuStreamedKeys) {
      const [cx, cy] = key.split(',').map(Number);
      tileRenderer.removeChunk(cx, cy);
    }
    menuStreamedKeys.clear();
  });

  // ── State: Paused ───────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Paused, () => {
    menuOverlay.showPause();
  });

  // ── Menu callbacks ───────────────────────────────────────────────────────────
  // electronAPI is injected by the preload script in Electron. Outside Electron
  // (plain browser) it won't be present, so we fall back gracefully.
  const electronAPI = (window as unknown as { electronAPI?: {
    platform: string;
    discoverSessions: () => Promise<unknown[]>;
    resolveSessionCode: (code: string) => Promise<{ ip: string; port: number } | null>;
  } }).electronAPI;

  menuOverlay.setCallbacks({
    onHost: () => connectToServer('localhost', menuOverlay.displayName, 'host'),
    onJoin: (value) => {
      if (!value) { console.warn('[Game] Enter a session code or host IP first'); return; }
      const isCode = electronAPI && /^[A-Za-z]{4}$/.test(value);
      if (isCode) {
        // Electron: resolve 4-letter code → IP via LAN UDP beacon
        void (async () => {
          const resolved = await electronAPI!.resolveSessionCode(value.toUpperCase());
          if (!resolved) {
            console.warn(`[Game] Session code "${value.toUpperCase()}" not found on LAN`);
            return;
          }
          connectToServer(resolved.ip, menuOverlay.displayName, 'join');
        })();
      } else {
        // Browser / direct IP: treat the value as a hostname or IP address
        connectToServer(value, menuOverlay.displayName, 'join');
      }
    },
    onResume:     () => stateMgr.transition(GameState.Playing),
    onQuitToMenu: () => stateMgr.transition(GameState.Menu),
  });

  // ── Lobby callbacks ──────────────────────────────────────────────────────────
  lobbyOverlay.setCallbacks({
    onStart: () => net?.send({ type: MessageType.SESSION_START }),
    onLeave: () => {
      net?.send({ type: MessageType.SESSION_LEAVE });
      stateMgr.transition(GameState.Menu);
    },
    onChat: (text) => net?.send({ type: MessageType.CHAT, text }),
  });

  // ── Network connection ───────────────────────────────────────────────────────
  function connectToServer(ip: string, displayName: string, role: 'host' | 'join'): void {
    if (net) { net.disconnect(); }

    net = new NetworkClient(`ws://${ip}:${SERVER_PORT}`);

    net.on(MessageType.HANDSHAKE_ACK, (msg) => {
      const ack = msg as HandshakeAckMessage;
      console.log(`[Net] Connected — clientId: ${ack.clientId}`);
      // Identify self, then immediately request session
      net!.send({ type: MessageType.HANDSHAKE, displayName });
      if (role === 'host') {
        net!.send({ type: MessageType.SESSION_CREATE });
      } else {
        // Single-session server: sessionId is ignored, send empty string
        net!.send({ type: MessageType.SESSION_JOIN, sessionId: '' });
      }
    });

    net.on(MessageType.SESSION_ACK, (msg) => {
      const ack = msg as SessionAckMessage;
      localSlot          = ack.slot;
      isHost             = ack.isHost;
      currentSessionId   = ack.sessionId;
      currentSessionCode = ack.code ?? '';
      lobbyPlayers       = ack.players;
      seed               = ack.seed;
      generator      = new WorldGenerator(ack.seed);
      chunks         = new ChunkManager(generator);
      movementSystem = new MovementSystem(chunks);

      stateMgr.transition(GameState.Lobby);

    });

    net.on(MessageType.PLAYER_JOINED, (msg) => {
      const pj = msg as PlayerJoinedMessage;
      lobbyPlayers = lobbyPlayers.filter((p) => p.playerId !== pj.player.playerId);
      lobbyPlayers.push(pj.player);
      lobbyOverlay.updatePlayers(lobbyPlayers);
      lobbyOverlay.addChatMessage('→', `${pj.player.displayName} joined`);
    });

    net.on(MessageType.PLAYER_LEFT, (msg) => {
      const pl = msg as PlayerLeftMessage;
      lobbyPlayers = lobbyPlayers.filter((p) => p.playerId !== pl.playerId);
      lobbyOverlay.updatePlayers(lobbyPlayers);
      lobbyOverlay.addChatMessage('←', `Player ${pl.slot + 1} left`);
    });

    net.on(MessageType.SNAPSHOT, (msg) => {
      const snap = msg as SnapshotMessage;

      world.clear();
      playerRenderer.destroy();

      // Create all remote player entities from server snapshot
      remotePlayerSys.applySnapshot(world, snap);

      // Find and configure the local player entity
      const localSnap = snap.entities.find((e) => e.slot === localSlot);
      if (localSnap) {
        localEntityId = localSnap.entityId;
        reconciler.localEntityId = localEntityId;

        // Add prediction-only components (not sent by server)
        world.addComponent(localEntityId, C.Speed,       { base: PLAYER_BASE_SPEED, multiplier: 1 });
        world.addComponent(localEntityId, C.Stamina,     { current: PLAYER_MAX_STAMINA, max: PLAYER_MAX_STAMINA, regenRate: PLAYER_STAMINA_REGEN });
        world.addComponent(localEntityId, C.PlayerInput, { dx: 0, dy: 0 });

        // Snap camera — no lerp pop on first frame
        const pos = world.getComponent<PositionComponent>(localEntityId, C.Position)!;
        camera.x = pos.x; camera.y = pos.y;
        camera.targetX = pos.x; camera.targetY = pos.y;
      }

      stateMgr.transition(GameState.Playing);
    });

    net.on(MessageType.DELTA, (msg) => {
      if (stateMgr.current !== GameState.Playing) return;
      const delta = msg as DeltaMessage;

      // Reconcile local player (snap-to-server + replay pending inputs)
      reconciler.applyDelta(world, delta, (replayDt) => {
        movementSystem?.update(world, replayDt);
      });

      // Apply remote entity updates
      remotePlayerSys.applyDelta(world, delta);
    });

    net.on(MessageType.CHAT, (msg) => {
      const chat = msg as ChatMessage;
      lobbyOverlay.addChatMessage(chat.displayName, chat.text);
    });

    net.on(MessageType.ERROR, (msg) => {
      const err = msg as unknown as { code: string; message: string };
      console.error(`[Net] Server error ${err.code}: ${err.message}`);
    });

    // Session closed by host departure (clean message path)
    net.on(MessageType.SESSION_CLOSED, (msg) => {
      const closed = msg as unknown as { reason: string };
      console.warn(`[Net] Session closed: ${closed.reason}`);
      stateMgr.transition(GameState.Menu);
    });

    // WebSocket dropped unexpectedly (server crash, network loss, etc.)
    net.onDrop(() => {
      if (stateMgr.current !== GameState.Menu) {
        console.warn('[Net] Connection lost — returning to menu');
        stateMgr.transition(GameState.Menu);
      }
    });

    net.connect();
  }

  // ── Start in Menu ────────────────────────────────────────────────────────────
  stateMgr.transition(GameState.Menu);

  // ── Game loop ────────────────────────────────────────────────────────────────
  renderer.ticker.add((ticker) => {
    const dt    = ticker.deltaMS / 1000;
    const state = stateMgr.current;

    // ESC toggles pause
    if (input.isJustPressed(Action.Pause)) {
      if (state === GameState.Playing)     stateMgr.transition(GameState.Paused);
      else if (state === GameState.Paused) stateMgr.transition(GameState.Playing);
    }

    // Menu + Lobby: animate world in background (menu generator)
    if (state === GameState.Menu || state === GameState.Lobby) {
      camera.targetX += BG_PAN_X * ticker.deltaMS;
      camera.targetY += BG_PAN_Y * ticker.deltaMS;
    }

    // Playing: local prediction + send input
    if (state === GameState.Playing && localEntityId !== null) {
      // 1. Map keyboard → PlayerInput component (only local entity has it)
      inputSystem.update(world);

      // 2. Read current input
      const inp = world.getComponent<{ dx: number; dy: number }>(localEntityId, C.PlayerInput)!;

      // 3. Record for reconciliation + send to server
      const seq = reconciler.recordInput(inp.dx, inp.dy, dt);
      net?.send({ type: MessageType.INPUT, seq, dx: inp.dx, dy: inp.dy, t: performance.now() });

      // 4. Predict locally
      movementSystem?.update(world, dt);
      staminaSystem.update(world, dt);

      // 5. Render players
      playerRenderer.update(world);

      // 6. Camera follows local player
      const pos = world.getComponent<PositionComponent>(localEntityId, C.Position);
      if (pos) { camera.targetX = pos.x; camera.targetY = pos.y; }
    }

    camera.update(dt);

    // Chunk streaming: menu generator during menu/lobby, game generator while playing
    const { width, height } = renderer.screen;
    const isPlaying      = state === GameState.Playing;
    const activeChunks   = isPlaying ? chunks    : menuChunks;
    const activeGen      = isPlaying ? generator : menuGenerator;

    if (activeChunks && activeGen) {
      const visible = activeChunks.getVisibleCoords(camera.viewX, camera.viewY, width, height, camera.zoom);
      for (const { cx, cy } of visible) {
        tileRenderer.addChunk(activeChunks.getOrGenerate(cx, cy));
        if (!isPlaying) menuStreamedKeys.add(`${cx},${cy}`);
      }
      const evicted = activeChunks.evictDistant(camera.viewX, camera.viewY);
      for (const { cx, cy } of evicted) {
        tileRenderer.removeChunk(cx, cy);
        if (!isPlaying) menuStreamedKeys.delete(`${cx},${cy}`);
      }
    }

    tileRenderer.applyCamera(camera.viewX, camera.viewY, camera.zoom, width, height);

    if (state === GameState.Playing) {
      hud.update(world, width, height);
    }

    const tileX = Math.floor(camera.x / TILE_SIZE);
    const tileY = Math.floor(camera.y / TILE_SIZE);
    const ag    = (isPlaying ? generator : menuGenerator) ?? menuGenerator;
    const biome = BIOME_DEFS[ag.getBiome(tileX, tileY)].name;
    debug.update(dt, { camera, loadedChunks: tileRenderer.loadedChunkCount, biome, seed });

    input.flush();
  });

  console.log('[Game] Phase 3 ready — Host or Join a game to begin');
}

main().catch((err) => {
  console.error('[Game] Fatal startup error:', err);
});
