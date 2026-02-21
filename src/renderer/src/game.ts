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
  MELEE_COOLDOWN,
  MELEE_RANGE,
  MELEE_ARC,
  RANGED_COOLDOWN,
  ENEMY_RADIUS,
  PROJECTILE_RADIUS,
  RESOURCE_NODE_RADIUS,
  GAME_VERSION,
  TICK_MS,
} from '@shared/constants';
import type { LobbySlot } from '@shared/protocol';
import type { SaveSlotInfo } from '@shared/SaveFormat';
import { registerMessageHandlers, type GameplayState } from './net/NetworkHandler';
import { createBuildController } from './systems/BuildController';

import { World } from '@shared/ecs/World';
import { C, PositionComponent, FactionComponent, BuildingComponent } from '@shared/components';

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
import { PauseBanner } from './ui/PauseBanner';
import { WeaponHotbar } from './ui/WeaponHotbar';
import { ProjectileRendererSystem } from './systems/ProjectileRendererSystem';
import { WaveHUD } from './ui/WaveHUD';
import { ResourceHUD } from './ui/ResourceHUD';
import { DeathOverlay } from './ui/DeathOverlay';
import { GameOverOverlay } from './ui/GameOverOverlay';
import { UpdateBanner } from './ui/UpdateBanner';
import { ChatOverlay } from './ui/ChatOverlay';
import { BuildModeOverlay } from './ui/BuildModeOverlay';
import { BuildGhostRenderer } from './render/BuildGhostRenderer';
import { WarehouseHUD } from './ui/WarehouseHUD';
import { DamageNumberSystem } from './systems/DamageNumberSystem';
import { Minimap, MAP_SIZE, MAP_PADDING } from './ui/Minimap';
import { StatsOverlay } from './ui/StatsOverlay';
import { CardPickerOverlay } from './ui/CardPickerOverlay';

// Slow world pan behind menus (world pixels per millisecond)
const BG_PAN_X = 0.05;
const BG_PAN_Y = 0.025;

// Weapon slot tables - indexed by selectedWeapon (0 = melee, 1 = ranged)
const WEAPON_TYPES: readonly ('melee' | 'ranged')[] = ['melee', 'ranged'];
const WEAPON_COOLDOWNS = [MELEE_COOLDOWN, RANGED_COOLDOWN] as const;

// ── Environment: production uses VITE_SERVER_IP, dev defaults to localhost ───
const serverIp = import.meta.env.VITE_SERVER_IP ?? 'localhost';
const isDev = !import.meta.env.VITE_SERVER_IP;

// ── Version label ────────────────────────────────────────────────────────────
const versionEl = document.getElementById('version-label');
if (versionEl) versionEl.textContent = `v${GAME_VERSION}`;

// ── Persistent player identity (localStorage) ──────────────────────────────
function getOrCreatePlayerId(): string {
  let id = localStorage.getItem('playerId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('playerId', id);
  }
  return id;
}
const localPlayerId = getOrCreatePlayerId();

function loadSavedDisplayName(): string {
  return localStorage.getItem('displayName') ?? '';
}

function saveDisplayName(name: string): void {
  localStorage.setItem('displayName', name);
}

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
  const projectileRenderer = new ProjectileRendererSystem(tileRenderer.worldContainer);
  const damageNumbers = new DamageNumberSystem(tileRenderer.worldContainer);
  const hud          = new HUD(renderer.stage);
  const weaponHotbar = new WeaponHotbar(renderer.stage);
  const minimap      = new Minimap(renderer.stage);

  // Coords display between minimap and wave HUD
  const coordsEl = document.createElement('div');
  coordsEl.id = 'coords-hud';
  coordsEl.style.cssText = [
    'position: absolute',
    `top: ${MAP_SIZE + MAP_PADDING + 2}px`,
    'right: 12px',
    `width: ${MAP_SIZE}px`,
    'z-index: 20',
    "font-family: monospace",
    'font-size: 11px',
    'color: #c0d0e0',
    'text-shadow: 0 1px 3px rgba(0,0,0,0.8)',
    'text-align: center',
    'pointer-events: none',
    'display: none',
  ].join('; ');
  document.getElementById('overlay')!.appendChild(coordsEl);

  const debug        = new DebugOverlay();

  // ── ECS world ───────────────────────────────────────────────────────────────
  const world = new World();

  // ── Input ───────────────────────────────────────────────────────────────────
  const input = new InputManager();

  // ── World generation - deferred until server seed arrives ──────────────────
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
  // MovementSystem depends on chunks - created when game starts
  let movementSystem: MovementSystem | null = null;

  // ── Multiplayer state ───────────────────────────────────────────────────────
  const reconciler      = new Reconciler();
  const remotePlayerSys = new RemotePlayerSystem(() => localEntityId);

  let localSlot        = 0;
  let localEntityId: number | null = null;
  let isHost           = false;
  let currentSessionId   = '';
  let currentSessionCode = '';
  let lobbyPlayers: LobbySlot[] = [];
  let isMultiplayer = false;
  /** True when transport is connected AND HANDSHAKE_ACK received. */
  let transportReady = false;
  /** Pending save slot info from SAVE_SLOTS_RESPONSE. */
  let pendingSaveSlots: SaveSlotInfo[] = [];
  /** Counter to discard stale SAVE_SLOTS_RESPONSE messages. */
  let saveSlotRequestId = 0;
  /** Timestamp when game started playing (for elapsed time display). */
  let gameStartTime = 0;
  let serverElapsedTime = 0;
  /** True when a wave is actively spawning enemies (portals alive). */
  let waveActive = false;
  /** Reusable Map for projectile old positions (avoids per-frame allocation). */
  const projOldPos = new Map<number, { x: number; y: number }>();

  // ── Mouse tracking (for player facing direction) ─────────────────────────────
  let mouseX = 0;
  let mouseY = 0;

  // ── Attack cooldown (client-side mirror of server AttackCooldown) ────────────
  let attackCooldown = 0;
  let selectedWeapon: 0 | 1 = 0; // 0 = melee (Sword), 1 = ranged (Bow)

  // ── Death / respawn state ──────────────────────────────────────────────────
  let localDowned   = false;
  let localDead     = false;
  let respawnTimer  = 0;
  let localGameOver = false;
  let inputTickAccum = 0;
  let lastServerStats: { wave: number; enemyCount: number; portalCount: number; playerCount: number } | undefined;

  // ── Build / resource state ──────────────────────────────────────────────
  let localResources: Record<string, number> = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
  let warehouseResources = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
  let warehouseExists = false;
  let handshakeSent = false;

  /** Warehouse + player inventory combined (for build cost checks). */
  function combinedResources(): Record<string, number> {
    if (!warehouseExists) return localResources;
    const wRes = warehouseResources as Record<string, number>;
    const combined: Record<string, number> = {};
    for (const key of Object.keys(localResources)) {
      combined[key] = (wRes[key] ?? 0) + (localResources[key] ?? 0);
    }
    return combined;
  }

  document.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });

  // ── State machine ───────────────────────────────────────────────────────────
  const stateMgr = new GameStateManager();

  // ── Overlays ─────────────────────────────────────────────────────────────────
  const menuOverlay  = new MenuOverlay();
  // Pre-fill display name from localStorage (before server's lastDisplayName arrives)
  const savedName = loadSavedDisplayName();
  if (savedName) menuOverlay.displayName = savedName;

  const statsOverlay = new StatsOverlay();
  const cardPicker = new CardPickerOverlay();
  const lobbyOverlay = new LobbyOverlay();
  const pauseBanner  = new PauseBanner();
  const waveHUD      = new WaveHUD();
  const resourceHUD  = new ResourceHUD();
  const deathOverlay   = new DeathOverlay();
  const gameOverOverlay = new GameOverOverlay();
  gameOverOverlay.setOnMenu(() => {
    net.send({ type: MessageType.SESSION_LEAVE });
    stateMgr.transition(GameState.Menu);
  });

  const chatOverlay = new ChatOverlay();
  const buildOverlay = new BuildModeOverlay();
  const buildGhost   = new BuildGhostRenderer(tileRenderer.worldContainer);
  const warehouseHUD = new WarehouseHUD();

  const updateBanner = new UpdateBanner();
  window.electronAPI?.onUpdateAvailable(() => updateBanner.showDownloading());
  window.electronAPI?.onUpdateDownloaded(() => updateBanner.showReady());

  // Wire in-game chat
  chatOverlay.onSend((text) => net.send({ type: MessageType.CHAT, text }));

  // Enter key opens chat during gameplay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && stateMgr.current === GameState.Playing
        && !chatOverlay.isOpen && !debug.isOpen
        && !localDowned && !localDead && !localGameOver) {
      e.preventDefault();
      chatOverlay.show();
    }
  });

  // Wire debug console cheat commands
  debug.onCheat((cmd, args) => {
    switch (cmd) {
      case '/spawn':
        net.send({ type: MessageType.DEBUG_SPAWN_ENEMIES, count: parseInt(args[0]) || 5 });
        break;
      case '/skipwave':
        net.send({ type: MessageType.DEBUG_WAVE_SKIP });
        break;
      case '/pausewave':
        net.send({ type: MessageType.DEBUG_WAVE_PAUSE });
        break;
      case '/give':
        net.send({ type: MessageType.DEBUG_GIVE_RESOURCES });
        break;
    }
  });

  // Configure dev/prod UI
  menuOverlay.setDevMode(isDev);
  menuOverlay.setButtonsEnabled(false);
  menuOverlay.setConnectionStatus('connecting');

  // ── electronAPI (injected by preload in Electron) ───────────────────────────
  const electronAPI = (window as unknown as { electronAPI?: {
    platform: string;
    discoverSessions: () => Promise<unknown[]>;
    resolveSessionCode: (code: string) => Promise<{ ip: string; port: number } | null>;
    checkForUpdates?: () => void;
  } }).electronAPI;

  // ── State: Menu ─────────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Menu, () => {
    menuOverlay.showMenu();
    lobbyOverlay.hide();
    pauseBanner.hide();
    waveHUD.hide();
    hud.setVisible(false);
    weaponHotbar.setVisible(false);
    world.clear();
    playerRenderer.destroy();
    projectileRenderer.destroy();
    remotePlayerSys.destroy();
    localEntityId = null;
    reconciler.localEntityId = null;
    isMultiplayer = false;
    selectedWeapon = 0;
    localDowned = false;
    localDead   = false;
    respawnTimer = 0;
    localGameOver = false;
    gameStartTime = 0;
    serverElapsedTime = 0;
    waveActive = false;
    waveHUD.setPaused(false);
    coordsEl.style.display = 'none';
    deathOverlay.hide();
    gameOverOverlay.hide();
    chatOverlay.hide();
    debug.hide();
    resourceHUD.setResources(0, 0, 0, 0, 0, 0);
    resourceHUD.hide();
    buildCtrl.reset();
    localResources = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
    warehouseResources = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
    warehouseExists = false;
    warehouseHUD.hide();
    // Transport stays alive - don't disconnect
    menuOverlay.setButtonsEnabled(transportReady);
    menuOverlay.setConnectionStatus(transportReady ? 'connected' : 'connecting');
  });

  // ── State: Lobby ────────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Lobby, () => {
    menuOverlay.hide();
    lobbyOverlay.show(currentSessionId, currentSessionCode, isHost);
    lobbyOverlay.updatePlayers(lobbyPlayers);
    hud.setVisible(false);
    weaponHotbar.setVisible(false);
  });

  // ── State: Playing ──────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Playing, () => {
    if (gameStartTime === 0) gameStartTime = Date.now();
    menuOverlay.hide();
    lobbyOverlay.hide();
    coordsEl.style.display = 'block';
    hud.setVisible(true);
    weaponHotbar.setVisible(true);
    waveHUD.setVisible(true);
    resourceHUD.setVisible(true);

    // Clear menu background chunks from the tile renderer
    for (const key of menuStreamedKeys) {
      const [cx, cy] = key.split(',').map(Number);
      tileRenderer.removeChunk(cx, cy);
    }
    menuStreamedKeys.clear();
  });

  // ── State: Paused ───────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Paused, () => {
    pauseBanner.hide();
    const elapsed = serverElapsedTime > 0 ? serverElapsedTime : (gameStartTime > 0 ? (Date.now() - gameStartTime) / 1000 : 0);
    menuOverlay.showPause(
      isMultiplayer ? 'All players must press ESC to resume' : undefined,
      elapsed,
    );
  });

  // ─── Persistent Transport Connection ──────────────────────────────────────────
  // Created once at startup and persists across sessions. The transport handles
  // WebSocket lifecycle (connect, reconnect, heartbeat). Session actions (host,
  // join, leave) are sent over this existing connection.

  const net = new NetworkClient(`ws://${serverIp}:${SERVER_PORT}`);

  // ── Build controller ──────────────────────────────────────────────────────
  const buildCtrl = createBuildController({
    world, input, buildOverlay, buildGhost, combinedResources,
    getChunks: () => chunks,
    getMouseWorld: () => {
      const { width, height } = renderer.screen;
      return {
        x: camera.viewX + (mouseX - width / 2) / camera.zoom,
        y: camera.viewY + (mouseY - height / 2) / camera.zoom,
      };
    },
    getLocalResources: () => localResources,
    getWarehouseResources: () => warehouseResources as Record<string, number>,
    getWarehouseExists: () => warehouseExists,
    send: (msg) => net.send(msg),
  });

  // ── Handler state bridge (maps handler reads/writes to local variables) ────
  const handlerState: GameplayState = {
    get localSlot() { return localSlot; }, set localSlot(v) { localSlot = v; },
    get localEntityId() { return localEntityId; }, set localEntityId(v) { localEntityId = v; },
    get isHost() { return isHost; }, set isHost(v) { isHost = v; },
    get currentSessionId() { return currentSessionId; }, set currentSessionId(v) { currentSessionId = v; },
    get currentSessionCode() { return currentSessionCode; }, set currentSessionCode(v) { currentSessionCode = v; },
    get lobbyPlayers() { return lobbyPlayers; }, set lobbyPlayers(v) { lobbyPlayers = v; },
    get isMultiplayer() { return isMultiplayer; }, set isMultiplayer(v) { isMultiplayer = v; },
    get transportReady() { return transportReady; }, set transportReady(v) { transportReady = v; },
    get pendingSaveSlots() { return pendingSaveSlots; }, set pendingSaveSlots(v) { pendingSaveSlots = v; },
    get saveSlotRequestId() { return saveSlotRequestId; }, set saveSlotRequestId(v) { saveSlotRequestId = v; },
    get gameStartTime() { return gameStartTime; }, set gameStartTime(v) { gameStartTime = v; },
    get serverElapsedTime() { return serverElapsedTime; }, set serverElapsedTime(v) { serverElapsedTime = v; },
    get waveActive() { return waveActive; }, set waveActive(v) { waveActive = v; },
    get localDowned() { return localDowned; }, set localDowned(v) { localDowned = v; },
    get localDead() { return localDead; }, set localDead(v) { localDead = v; },
    get respawnTimer() { return respawnTimer; }, set respawnTimer(v) { respawnTimer = v; },
    get localGameOver() { return localGameOver; }, set localGameOver(v) { localGameOver = v; },
    get buildModeActive() { return buildCtrl.active; }, set buildModeActive(v) { buildCtrl.active = v; },
    get selectedBuildingIdx() { return buildCtrl.selectedIdx; }, set selectedBuildingIdx(v) { buildCtrl.selectedIdx = v; },
    get selectedBuildingId() { return buildCtrl.selectedId; }, set selectedBuildingId(v) { buildCtrl.selectedId = v; },
    get localResources() { return localResources; }, set localResources(v) { localResources = v; },
    get warehouseResources() { return warehouseResources; }, set warehouseResources(v) { warehouseResources = v; },
    get warehouseExists() { return warehouseExists; }, set warehouseExists(v) { warehouseExists = v; },
    get selectedWeapon() { return selectedWeapon; }, set selectedWeapon(v) { selectedWeapon = v; },
    get lastServerStats() { return lastServerStats; }, set lastServerStats(v) { lastServerStats = v; },
    get handshakeSent() { return handshakeSent; }, set handshakeSent(v) { handshakeSent = v; },
    get seed() { return seed; }, set seed(v) { seed = v; },
  };

  registerMessageHandlers(net, handlerState, {
    world, camera, playerRenderer, projectileRenderer, damageNumbers, reconciler, remotePlayerSys,
    getMovementSystem: () => movementSystem,
    initGameWorld: (newSeed: number) => {
      generator = new WorldGenerator(newSeed);
      chunks = new ChunkManager(generator);
      movementSystem = new MovementSystem(chunks);
      minimap.setTileGetter((tx, ty) => generator!.getTile(tx, ty));
    },
    stateMgr, menuOverlay, lobbyOverlay, pauseBanner, waveHUD, resourceHUD,
    deathOverlay, gameOverOverlay, chatOverlay, debug, buildOverlay, buildGhost,
    warehouseHUD, cardPicker, statsOverlay, combinedResources, electronAPI,
  });

  // ── Session action helper ─────────────────────────────────────────────────

  function sendHandshakeIfNeeded(displayName: string): void {
    if (handshakeSent) return;
    net.send({ type: MessageType.HANDSHAKE, displayName, version: GAME_VERSION, playerId: localPlayerId });
    handshakeSent = true;
  }

  function joinSession(role: 'host' | 'join', displayName: string, code?: string, saveSlot?: number): void {
    if (!transportReady) {
      console.warn('[Game] Not connected to server');
      return;
    }
    // Persist display name for next launch
    saveDisplayName(displayName);
    sendHandshakeIfNeeded(displayName);
    if (role === 'host') {
      net.send({ type: MessageType.SESSION_CREATE, saveSlot });
    } else {
      net.send({ type: MessageType.SESSION_JOIN, code: code ?? '' });
    }
  }

  // ── Menu callbacks ────────────────────────────────────────────────────────
  menuOverlay.setCallbacks({
    onHost: () => {
      if (!transportReady) { console.warn('[Game] Not connected'); return; }
      // Send handshake (if not yet sent) + request save slots before showing slot picker
      sendHandshakeIfNeeded(menuOverlay.displayName);
      saveSlotRequestId++;
      net.send({ type: MessageType.SAVE_SLOTS_REQUEST });
      menuOverlay.showSaveSlotPicker(
        (slot) => {
          joinSession('host', menuOverlay.displayName, undefined, slot);
        },
        (slot) => {
          // Delete save and refresh slot list
          net.send({ type: MessageType.SAVE_DELETE, slot });
        },
      );
    },
    onJoin: (value) => {
      if (!value) { console.warn('[Game] Enter an invite code first'); return; }

      // Dev-mode: if the input looks like an IP, reconnect transport to that IP
      if (isDev && /[\d.].*:|\d+\.\d+/.test(value)) {
        const ip = value.includes(':') ? value.split(':')[0] : value;
        net.reconnectTo(`ws://${ip}:${SERVER_PORT}`);
        return;
      }

      // LAN code resolution via Electron IPC (dev only)
      const isLanCode = isDev && electronAPI && /^[A-Za-z]{4}$/.test(value);
      if (isLanCode) {
        void (async () => {
          const resolved = await electronAPI!.resolveSessionCode(value.toUpperCase());
          if (!resolved) {
            console.warn(`[Game] Session code "${value.toUpperCase()}" not found on LAN`);
            return;
          }
          net.reconnectTo(`ws://${resolved.ip}:${SERVER_PORT}`);
        })();
      } else {
        // Production (or non-LAN): send invite code directly to the server
        joinSession('join', menuOverlay.displayName, value.toUpperCase());
      }
    },
    onResume:     () => net.send({ type: MessageType.PAUSE_VOTE }),
    onQuitToMenu: () => {
      net.send({ type: MessageType.SESSION_LEAVE });
      stateMgr.transition(GameState.Menu);
    },
    onStats: () => {
      net.send({ type: MessageType.META_STATS_REQUEST });
      menuOverlay.hide();
    },
  });

  // ── Lobby callbacks ──────────────────────────────────────────────────────────
  lobbyOverlay.setCallbacks({
    onStart: () => net.send({ type: MessageType.SESSION_START }),
    onLeave: () => {
      net.send({ type: MessageType.SESSION_LEAVE });
      stateMgr.transition(GameState.Menu);
    },
    onChat: (text) => net.send({ type: MessageType.CHAT, text }),
  });

  // ── Start transport + show menu ────────────────────────────────────────────
  net.connect();
  stateMgr.transition(GameState.Menu);

  // ── Game loop ──────────────────────────────────────────────────────────────
  renderer.ticker.add((ticker) => {
    const dt    = Math.min(ticker.deltaMS / 1000, 0.05); // cap at 50ms to reduce prediction divergence
    const state = stateMgr.current;

    // ESC: close build mode first, otherwise send pause vote
    if (input.isJustPressed(Action.Pause)) {
      if (buildCtrl.active && state === GameState.Playing) {
        buildCtrl.exitBuildMode();
      } else if (!localGameOver && !chatOverlay.isOpen && (state === GameState.Playing || state === GameState.Paused)) {
        net.send({ type: MessageType.PAUSE_VOTE });
      }
    }

    // Menu + Lobby: animate world in background (menu generator)
    if (state === GameState.Menu || state === GameState.Lobby) {
      camera.targetX += BG_PAN_X * ticker.deltaMS;
      camera.targetY += BG_PAN_Y * ticker.deltaMS;
    }

    // Playing: local prediction + send input
    if (state === GameState.Playing && localEntityId !== null) {
      const canAct = !localDowned && !localDead && !localGameOver && !chatOverlay.isOpen && !cardPicker.isVisible;

      // 1. Map keyboard → PlayerInput component (only local entity has it)
      if (canAct) inputSystem.update(world);

      // 2. Read current input (zero when incapacitated)
      const inp = world.getComponent<{ dx: number; dy: number; sprint: boolean }>(localEntityId, C.PlayerInput)!;
      if (!canAct) { inp.dx = 0; inp.dy = 0; inp.sprint = false; }

      // 3. Record input every frame for accurate reconciler replay
      const seq = reconciler.recordInput(inp.dx, inp.dy, inp.sprint, dt);

      // 4. Throttle network sends to match server tick rate (~30 Hz)
      inputTickAccum += dt;
      if (inputTickAccum >= TICK_MS / 1000) {
        inputTickAccum -= TICK_MS / 1000;
        if (inputTickAccum > TICK_MS / 1000) inputTickAccum = 0; // clamp after tab-away
        net.send({ type: MessageType.INPUT, seq, dx: inp.dx, dy: inp.dy, sprint: inp.sprint, t: performance.now() });
      }

      // 4. Predict locally + interpolate remote entities
      // Populate bridge tiles from world entities for movement walkability
      if (movementSystem) {
        movementSystem.bridgeTiles.clear();
        for (const bid of world.query(C.Position, C.Building)) {
          const bldg = world.getComponent<BuildingComponent>(bid, C.Building);
          if (bldg?.buildingType === 'bridge') {
            const bpos = world.getComponent<PositionComponent>(bid, C.Position)!;
            const tx = Math.floor(bpos.x / TILE_SIZE);
            const ty = Math.floor(bpos.y / TILE_SIZE);
            movementSystem.bridgeTiles.add(`${tx},${ty}`);
          }
        }
      }
      movementSystem?.update(world, dt, localEntityId);
      staminaSystem.update(world, dt);
      remotePlayerSys.interpolate(world, dt);
      waveHUD.update(dt);

      // 5. Render players - compute mouse-facing angle for local player
      const pos = world.getComponent<PositionComponent>(localEntityId, C.Position);
      let localFacing: number | null = null;
      if (pos) {
        const { width, height } = renderer.screen;
        const worldMouseX = camera.viewX + (mouseX - width  / 2) / camera.zoom;
        const worldMouseY = camera.viewY + (mouseY - height / 2) / camera.zoom;
        localFacing = Math.atan2(worldMouseY - pos.y, worldMouseX - pos.x);
      }

      // Weapon switching (number keys) — exit build mode when selecting a weapon
      if (input.isJustPressed(Action.WeaponSlot1)) { selectedWeapon = 0; if (buildCtrl.active) buildCtrl.exitBuildMode(); }
      if (input.isJustPressed(Action.WeaponSlot2)) { selectedWeapon = 1; if (buildCtrl.active) buildCtrl.exitBuildMode(); }

      // M key: toggle minimap
      if (input.isJustPressed(Action.ToggleMinimap)) minimap.toggle();

      // B key: toggle build mode
      if (canAct && input.isJustPressed(Action.BuildMode)) buildCtrl.toggle();

      // Scroll wheel cycles building type
      buildCtrl.handleScroll(input.scrollDelta);

      // Build ghost update + placement + selection + demolish + upgrade + repair
      if (buildCtrl.active && pos) buildCtrl.update();

      // Attack: client-side cooldown mirrors server AttackCooldown. Allow a small
      // tolerance (one server tick) so the client doesn't silently miss an attack
      // due to floating-point drift between variable-rate client and fixed-rate server.
      if (attackCooldown > 0) attackCooldown = Math.max(0, attackCooldown - dt);
      if (canAct && !buildCtrl.active && input.isJustPressed(Action.Attack) && localFacing !== null && pos && attackCooldown <= TICK_MS / 1000) {
        const attackType = WEAPON_TYPES[selectedWeapon];
        attackCooldown = WEAPON_COOLDOWNS[selectedWeapon];
        net.send({ type: MessageType.ATTACK, attackType, facing: localFacing, x: pos.x, y: pos.y, t: performance.now() });
        if (attackType === 'melee') {
          playerRenderer.notifyAttack(localEntityId!, localFacing);
          // Client-side melee hit prediction — flash targets in arc immediately
          const halfArc = MELEE_ARC / 2;
          for (const targetId of world.query(C.Position, C.Health, C.Faction)) {
            if (targetId === localEntityId) continue;
            const tf = world.getComponent<FactionComponent>(targetId, C.Faction);
            if (tf?.type === 'player' || tf?.type === 'resource') continue;
            const tp = world.getComponent<PositionComponent>(targetId, C.Position)!;
            const tdx = tp.x - pos.x;
            const tdy = tp.y - pos.y;
            const dist = Math.sqrt(tdx * tdx + tdy * tdy);
            if (dist > MELEE_RANGE || dist === 0) continue;
            let diff = Math.abs(Math.atan2(tdy, tdx) - localFacing);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            if (diff <= halfArc) playerRenderer.notifyHit(targetId);
          }
        }
      }

      // E-interact: pick up nearby non-auto-pickup items (also initiates revive)
      if (input.isJustPressed(Action.Interact) && pos) {
        net.send({ type: MessageType.INTERACT, x: pos.x, y: pos.y, t: performance.now() });
      }

      playerRenderer.selectedBuildingId = buildCtrl.selectedId;
      playerRenderer.update(world, localEntityId, localFacing, dt, reconciler.smoothX, reconciler.smoothY);
      deathOverlay.update(dt);

      // 6. Update and render projectiles
      const { width: sw, height: sh } = renderer.screen;
      // Snapshot old positions before moving for swept collision
      projOldPos.clear();
      for (const [pid, p] of projectileRenderer.getProjectiles()) {
        projOldPos.set(pid, { x: p.x, y: p.y });
      }
      projectileRenderer.update(dt);
      damageNumbers.update(dt);

      // Client-side projectile hit prediction — swept collision along path
      const projHits: number[] = [];
      for (const [projId, proj] of projectileRenderer.getProjectiles()) {
        const old = projOldPos.get(projId);
        const ox = old?.x ?? proj.x, oy = old?.y ?? proj.y;
        for (const targetId of world.query(C.Position, C.Health, C.Faction)) {
          const tf = world.getComponent<FactionComponent>(targetId, C.Faction);
          if (!tf || tf.type === 'player' || tf.type === 'item' || tf.type === 'building') continue;
          const tp = world.getComponent<PositionComponent>(targetId, C.Position)!;
          const tgtRadius = tf.type === 'resource' ? RESOURCE_NODE_RADIUS : ENEMY_RADIUS;
          // Shrink radius slightly so client prediction only fires when server would definitely agree
          const minDist = (PROJECTILE_RADIUS + tgtRadius) * 0.85;
          // Swept: closest point on segment (old→new) to target
          const sdx = proj.x - ox, sdy = proj.y - oy;
          const lenSq = sdx * sdx + sdy * sdy;
          let cx: number, cy: number;
          if (lenSq === 0) { cx = proj.x; cy = proj.y; }
          else {
            const t = Math.max(0, Math.min(1, ((tp.x - ox) * sdx + (tp.y - oy) * sdy) / lenSq));
            cx = ox + t * sdx; cy = oy + t * sdy;
          }
          const ex = tp.x - cx, ey = tp.y - cy;
          if (ex * ex + ey * ey <= minDist * minDist) {
            playerRenderer.notifyHit(targetId);
            projHits.push(projId);
            break;
          }
        }
      }
      for (const id of projHits) projectileRenderer.remove(id);

      projectileRenderer.render(camera.viewX, camera.viewY, camera.zoom, sw, sh);

      // 7. Camera follows local player (with smooth correction offset)
      reconciler.decaySmooth(dt);
      if (pos) {
        camera.targetX = pos.x + reconciler.smoothX;
        camera.targetY = pos.y + reconciler.smoothY;
      }
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
        const chunk = activeChunks.getOrGenerate(cx, cy);
        tileRenderer.addChunk(chunk);
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
      weaponHotbar.update(selectedWeapon, attackCooldown, WEAPON_COOLDOWNS[selectedWeapon], width, height, buildCtrl.active);
      minimap.update(world, localEntityId, camera.x, camera.y, width, height);
      coordsEl.textContent = `X: ${Math.round(camera.x)}  Y: ${Math.round(camera.y)}`;
    }

    const tileX = Math.floor(camera.x / TILE_SIZE);
    const tileY = Math.floor(camera.y / TILE_SIZE);
    const ag    = (isPlaying ? generator : menuGenerator) ?? menuGenerator;
    const biome = BIOME_DEFS[ag.getBiome(tileX, tileY)].name;
    debug.update(dt, { camera, loadedChunks: tileRenderer.loadedChunkCount, entityCount: world.allEntities.size, biome, seed, net: net.stats, server: lastServerStats });

    input.flush();
  });

  console.log(`[Game] Ready - auto-connecting to ${serverIp}:${SERVER_PORT}. Press F4 for debug overlay.`);
}

main().catch((err) => {
  console.error('[Game] Fatal startup error:', err);
});
