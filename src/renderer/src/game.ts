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
  DODGE_ROLL_DURATION,
  DODGE_ROLL_COOLDOWN,
  DODGE_ROLL_STAMINA_COST,
  HOMING_TURN_RATE,
  HOMING_DETECT_RANGE,
} from '@shared/constants';
import type { LobbySlot } from '@shared/protocol';
import type { SaveSlotInfo } from '@shared/SaveFormat';
import { registerMessageHandlers, type GameplayState } from './net/NetworkHandler';
import { createBuildController } from './systems/BuildController';

import { World } from '@shared/ecs/World';
import { C, PositionComponent, FactionComponent, BuildingComponent, DodgeRollComponent, StaminaComponent, PlayerInputComponent, FacingComponent, GhostStateComponent } from '@shared/components';

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
import { HitParticleSystem } from './systems/HitParticleSystem';
import { AbilityVFXSystem } from './systems/AbilityVFXSystem';
import { Minimap, MAP_SIZE, MAP_PADDING } from './ui/Minimap';
import { StatsOverlay } from './ui/StatsOverlay';
import { CardPickerOverlay } from './ui/CardPickerOverlay';
import { SkillTreeOverlay } from './ui/SkillTreeOverlay';
import { CLASS_STATS, DEFAULT_CLASS } from '@shared/ClassDefinitions';
import { getActiveAbilities, type SkillActiveAbility, type AbilityParams } from '@shared/SkillDefinitions';
import type { PlayerClass } from '@shared/ClassDefinitions';
import { Graphics } from 'pixi.js';

// Slow world pan behind menus (world pixels per millisecond)
const BG_PAN_X = 0.05;
const BG_PAN_Y = 0.025;

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
  const hitParticles  = new HitParticleSystem(tileRenderer.worldContainer);
  const abilityVFX    = new AbilityVFXSystem(tileRenderer.worldContainer);
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
  let selectedClass: PlayerClass = DEFAULT_CLASS;

  // ── Skill tree state ────────────────────────────────────────────────────────
  let skillAllocated = new Set<string>();
  let skillPoints = 0;
  /** Cached active abilities from skill allocation. */
  let activeAbilities: SkillActiveAbility[] = [];
  /** Client-side ability cooldowns [Q, E, R] — ticked down locally, synced from server. */
  let abilityCooldowns = [0, 0, 0];
  let abilityCooldownMaxes = [0, 0, 0];

  // ── Ability targeting ──────────────────────────────────────────────────────
  let targetingSlot = -1; // 0-2 ability index, or -1
  let targetingGfx: Graphics | null = null;

  const TARGETING_COLORS: Record<string, { fill: number; stroke: number }> = {
    rain_of_arrows: { fill: 0x44dd66, stroke: 0x66ff88 },
    explosive_trap: { fill: 0xff6600, stroke: 0xff9933 },
    meteor:         { fill: 0xff4400, stroke: 0xff7722 },
    blizzard:       { fill: 0x66aaff, stroke: 0x99ccff },
    shadow_step:    { fill: 0x6644cc, stroke: 0x8866ff },
    teleport:       { fill: 0xaa66ff, stroke: 0xcc99ff },
  };

  type TargetMode = 'self' | 'ground' | 'direction';
  function getTargetMode(params: AbilityParams): TargetMode {
    switch (params.type) {
      case 'whirlwind': case 'shield_wall': case 'war_cry': return 'self';
      case 'shadow_step': case 'teleport': return 'direction';
      default: return 'ground';
    }
  }
  function getAbilityRadius(params: AbilityParams): number {
    if ('radius' in params) return (params as any).radius;
    return 60;
  }
  function getAbilityMaxDist(params: AbilityParams): number {
    if (params.type === 'shadow_step') return params.distance;
    if (params.type === 'teleport') return params.maxDistance;
    return 150;
  }
  function cancelTargeting(): void {
    targetingSlot = -1;
    if (targetingGfx) targetingGfx.visible = false;
    document.getElementById('game')!.style.cursor = '';
  }

  // ── Card abilities (synced from server on card pick) ────────────────────────
  let cardAbilities: string[] = [];
  let pickedCardIds: string[] = [];

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
  const skillTree = new SkillTreeOverlay();
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
      case '/card':
        if (args[0]) net.send({ type: MessageType.DEBUG_GIVE_CARD, cardId: args[0] });
        break;
      case '/sp':
        net.send({ type: MessageType.DEBUG_GIVE_SKILL_POINTS, count: parseInt(args[0]) || 1 });
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
    cancelTargeting();
    menuOverlay.showMenu();
    lobbyOverlay.hide();
    pauseBanner.hide();
    waveHUD.hide();
    hud.setVisible(false);
    weaponHotbar.setVisible(false);
    skillTree.hide();
    world.clear();
    playerRenderer.destroy();
    projectileRenderer.destroy();
    abilityVFX.destroy();
    remotePlayerSys.destroy();
    localEntityId = null;
    reconciler.localEntityId = null;
    isMultiplayer = false;
    selectedClass = DEFAULT_CLASS;
    localDowned = false;
    localDead   = false;
    respawnTimer = 0;
    localGameOver = false;
    gameStartTime = 0;
    serverElapsedTime = 0;
    waveActive = false;
    skillAllocated = new Set();
    skillPoints = 0;
    activeAbilities = [];
    abilityCooldowns = [0, 0, 0];
    abilityCooldownMaxes = [0, 0, 0];
    cardAbilities = [];
    pickedCardIds = [];
    waveHUD.setPaused(false);
    coordsEl.style.display = 'none';
    deathOverlay.hide();
    gameOverOverlay.hide();
    chatOverlay.setActive(false);
    minimap.setVisible(false);
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
    minimap.setVisible(true);
    chatOverlay.setActive(true);

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
    get selectedClass() { return selectedClass; }, set selectedClass(v) { selectedClass = v; },
    get lastServerStats() { return lastServerStats; }, set lastServerStats(v) { lastServerStats = v; },
    get handshakeSent() { return handshakeSent; }, set handshakeSent(v) { handshakeSent = v; },
    get seed() { return seed; }, set seed(v) { seed = v; },
    get skillAllocated() { return skillAllocated; }, set skillAllocated(v) { skillAllocated = v; },
    get skillPoints() { return skillPoints; }, set skillPoints(v) { skillPoints = v; },
    onSkillStateUpdate: () => {
      // Rebuild active abilities from updated allocation
      activeAbilities = getActiveAbilities({ allocated: skillAllocated, skillPoints });
    },
    get cardAbilities() { return cardAbilities; }, set cardAbilities(v) { cardAbilities = v; },
    get pickedCardIds() { return pickedCardIds; }, set pickedCardIds(v) { pickedCardIds = v; },
  };

  registerMessageHandlers(net, handlerState, {
    world, camera, playerRenderer, projectileRenderer, damageNumbers, hitParticles, reconciler, remotePlayerSys,
    getMovementSystem: () => movementSystem,
    initGameWorld: (newSeed: number) => {
      generator = new WorldGenerator(newSeed);
      chunks = new ChunkManager(generator);
      movementSystem = new MovementSystem(chunks);
      minimap.setTileGetter((tx, ty) => generator!.getTile(tx, ty));
    },
    stateMgr, menuOverlay, lobbyOverlay, pauseBanner, waveHUD, resourceHUD,
    deathOverlay, gameOverOverlay, chatOverlay, debug, buildOverlay, buildGhost,
    warehouseHUD, cardPicker, skillTree, statsOverlay, abilityVFX, combinedResources, electronAPI,
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
      net.send({ type: MessageType.SESSION_CREATE, saveSlot, playerClass: selectedClass });
    } else {
      net.send({ type: MessageType.SESSION_JOIN, code: code ?? '', playerClass: selectedClass });
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
    onClassSelect: (playerClass) => {
      selectedClass = playerClass;
      net.send({ type: MessageType.CLASS_SELECT, playerClass });
    },
    onKick: (slot) => net.send({ type: MessageType.PLAYER_KICK, slot }),
  });

  // ── Start transport + show menu ────────────────────────────────────────────
  net.connect();
  stateMgr.transition(GameState.Menu);

  // ── Game loop ──────────────────────────────────────────────────────────────
  renderer.ticker.add((ticker) => {
    const dt    = Math.min(ticker.deltaMS / 1000, 0.05); // cap at 50ms to reduce prediction divergence
    const state = stateMgr.current;

    // ESC: close build mode first, then check targeting/skill tree (in Playing block), otherwise pause
    if (input.isJustPressed(Action.Pause)) {
      if (buildCtrl.active && state === GameState.Playing) {
        buildCtrl.exitBuildMode();
      } else if (state === GameState.Playing && (targetingSlot >= 0 || skillTree.isVisible)) {
        // Handled in the Playing block below (targeting cancel / skill tree close)
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
      // K key: toggle skill tree overlay (works even when canAct is false)
      if (input.isJustPressed(Action.SkillTree)) {
        if (skillTree.isVisible) skillTree.hide();
        else if (!localDowned && !localDead && !localGameOver && !cardPicker.isVisible) {
          skillTree.show(selectedClass, skillAllocated, skillPoints, (nodeId) => {
            net.send({ type: MessageType.SKILL_ALLOCATE, nodeId });
          }, pickedCardIds);
        }
      }
      // ESC: cancel targeting first, then close skill tree, then pause
      if (input.isJustPressed(Action.Pause)) {
        if (targetingSlot >= 0) cancelTargeting();
        else if (skillTree.isVisible) skillTree.hide();
      }

      const canAct = !localDowned && !localDead && !localGameOver && !chatOverlay.isOpen && !cardPicker.isPicking;

      // Auto-cancel targeting when player can't act
      if (!canAct && targetingSlot >= 0) cancelTargeting();

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

      // Tick local dodge roll timer
      if (localEntityId !== null) {
        const dr = world.getComponent<DodgeRollComponent>(localEntityId, C.DodgeRoll);
        if (dr) {
          if (dr.timer > 0) dr.timer = Math.max(0, dr.timer - dt);
          if (dr.cooldown > 0) dr.cooldown = Math.max(0, dr.cooldown - dt);
        }
      }

      // 5. Render players - compute mouse-facing angle for local player
      const pos = world.getComponent<PositionComponent>(localEntityId, C.Position);
      let localFacing: number | null = null;
      const { width: sw2, height: sh2 } = renderer.screen;
      const worldMouseX = camera.viewX + (mouseX - sw2  / 2) / camera.zoom;
      const worldMouseY = camera.viewY + (mouseY - sh2 / 2) / camera.zoom;
      if (pos) {
        localFacing = Math.atan2(worldMouseY - pos.y, worldMouseX - pos.x);
      }

      // Weapon slot 1 (number key) — exit build mode when selecting weapon
      if (input.isJustPressed(Action.WeaponSlot1)) { if (buildCtrl.active) buildCtrl.exitBuildMode(); }

      // B key: toggle build mode
      if (canAct && input.isJustPressed(Action.BuildMode)) {
        if (targetingSlot >= 0) cancelTargeting();
        buildCtrl.toggle();
      }

      // Scroll wheel cycles building type
      buildCtrl.handleScroll(input.scrollDelta);

      // Build ghost update + placement + selection + demolish + upgrade + repair
      if (buildCtrl.active && pos) buildCtrl.update();

      // Attack: client-side cooldown mirrors server AttackCooldown. Allow a small
      // tolerance (one server tick) so the client doesn't silently miss an attack
      // due to floating-point drift between variable-rate client and fixed-rate server.
      if (attackCooldown > 0) attackCooldown = Math.max(0, attackCooldown - dt);
      const classAttackType = CLASS_STATS[selectedClass].attackType;
      const classCooldown = classAttackType === 'melee' ? MELEE_COOLDOWN : RANGED_COOLDOWN;
      const hasHoldAttack = cardAbilities.includes('hold_attack');
      const holdAttackCooldown = 0.1; // 10 attacks per second when holding
      const attackInput = hasHoldAttack ? input.isHeld(Action.Attack) : input.isJustPressed(Action.Attack);
      if (canAct && !buildCtrl.active && targetingSlot < 0 && attackInput && localFacing !== null && pos && attackCooldown <= TICK_MS / 1000) {
        attackCooldown = hasHoldAttack ? Math.max(classCooldown, holdAttackCooldown) : classCooldown;
        net.send({ type: MessageType.ATTACK, attackType: classAttackType, facing: localFacing, x: pos.x, y: pos.y, t: performance.now() });
        if (classAttackType === 'melee') {
          playerRenderer.notifyAttack(localEntityId!, localFacing);
          // Client-side melee hit prediction — flash targets in arc immediately
          const halfArc = MELEE_ARC / 2;
          for (const targetId of world.query(C.Position, C.Health, C.Faction)) {
            if (targetId === localEntityId) continue;
            const tf = world.getComponent<FactionComponent>(targetId, C.Faction);
            if (tf?.type === 'player' || tf?.type === 'resource') continue;
            const gs = world.getComponent<GhostStateComponent>(targetId, C.GhostState);
            if (gs?.hidden) continue;
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

      // Space: dodge roll
      if (input.isJustPressed(Action.DodgeRoll) && localEntityId !== null) {
        const stamina = world.getComponent<StaminaComponent>(localEntityId, C.Stamina);
        const existingDodge = world.getComponent<DodgeRollComponent>(localEntityId, C.DodgeRoll);
        if (stamina && stamina.current >= DODGE_ROLL_STAMINA_COST &&
            (!existingDodge || (existingDodge.timer <= 0 && existingDodge.cooldown <= 0))) {
          stamina.current -= DODGE_ROLL_STAMINA_COST;
          const dinp = world.getComponent<PlayerInputComponent>(localEntityId, C.PlayerInput);
          let dvx = dinp?.dx ?? 0, dvy = dinp?.dy ?? 0;
          const len = Math.sqrt(dvx * dvx + dvy * dvy);
          if (len > 0) { dvx /= len; dvy /= len; }
          else {
            const facing = world.getComponent<FacingComponent>(localEntityId, C.Facing);
            dvx = Math.cos(facing?.angle ?? 0);
            dvy = Math.sin(facing?.angle ?? 0);
          }
          world.addComponent(localEntityId, C.DodgeRoll, {
            timer: DODGE_ROLL_DURATION, duration: DODGE_ROLL_DURATION,
            dashVx: dvx, dashVy: dvy, cooldown: DODGE_ROLL_COOLDOWN,
          });
          // Send dodge immediately (not throttled to tick rate)
          net.send({ type: MessageType.INPUT, seq: 0, dx: dinp?.dx ?? 0, dy: dinp?.dy ?? 0, sprint: dinp?.sprint ?? false, t: performance.now(), dodge: true });
        }
      }

      // ── Ability targeting system ──────────────────────────────────────────────

      // Cancel targeting: right-click
      if (targetingSlot >= 0 && input.isJustPressed(Action.Cancel)) {
        cancelTargeting();
      }

      // Q/E/R: enter targeting or instant-cast
      if (canAct && !buildCtrl.active && localFacing !== null && pos) {
        const abilityKeys = [Action.SkillQ, Action.SkillE, Action.SkillR] as const;
        for (let ai = 0; ai < 3; ai++) {
          if (input.isJustPressed(abilityKeys[ai]) && activeAbilities[ai] && abilityCooldowns[ai] <= 0.05) {
            const ab = activeAbilities[ai];
            const mode = getTargetMode(ab.params);

            if (mode === 'self') {
              // Self-cast: fire immediately
              abilityCooldowns[ai] = ab.cooldown;
              abilityCooldownMaxes[ai] = ab.cooldown;
              net.send({
                type: MessageType.ABILITY_USE,
                abilityId: ab.abilityId,
                facing: localFacing,
                x: pos.x, y: pos.y,
              });
            } else if (targetingSlot === ai) {
              // Same key again: cancel targeting
              cancelTargeting();
            } else {
              // Enter targeting mode
              targetingSlot = ai;
              if (!targetingGfx) {
                targetingGfx = new Graphics();
                targetingGfx.zIndex = 14;
                tileRenderer.worldContainer.addChild(targetingGfx);
              }
              targetingGfx.visible = true;
              document.getElementById('game')!.style.cursor = 'crosshair';
            }
          }
        }
      }

      // Confirm targeting: left click
      if (targetingSlot >= 0 && input.isJustPressed(Action.Attack) && pos && localFacing !== null) {
        const ai = targetingSlot;
        const ab = activeAbilities[ai];
        if (ab && abilityCooldowns[ai] <= 0.05) {
          abilityCooldowns[ai] = ab.cooldown;
          abilityCooldownMaxes[ai] = ab.cooldown;
          net.send({
            type: MessageType.ABILITY_USE,
            abilityId: ab.abilityId,
            facing: localFacing,
            x: pos.x, y: pos.y,
            targetX: worldMouseX,
            targetY: worldMouseY,
          });
        }
        cancelTargeting();
      }

      // Render targeting indicator
      if (targetingSlot >= 0 && targetingGfx && pos) {
        targetingGfx.clear();
        const ab = activeAbilities[targetingSlot];
        if (ab) {
          const mode = getTargetMode(ab.params);
          const colors = TARGETING_COLORS[ab.abilityId] ?? { fill: 0xffffff, stroke: 0xffffff };

          if (mode === 'ground') {
            const radius = getAbilityRadius(ab.params);
            targetingGfx.circle(worldMouseX, worldMouseY, radius);
            targetingGfx.fill({ color: colors.fill, alpha: 0.12 });
            targetingGfx.circle(worldMouseX, worldMouseY, radius);
            targetingGfx.stroke({ color: colors.stroke, alpha: 0.5, width: 2 });
            // Crosshair at center
            const ch = 6;
            targetingGfx.moveTo(worldMouseX - ch, worldMouseY);
            targetingGfx.lineTo(worldMouseX + ch, worldMouseY);
            targetingGfx.stroke({ color: colors.stroke, alpha: 0.7, width: 1 });
            targetingGfx.moveTo(worldMouseX, worldMouseY - ch);
            targetingGfx.lineTo(worldMouseX, worldMouseY + ch);
            targetingGfx.stroke({ color: colors.stroke, alpha: 0.7, width: 1 });
          } else {
            // Direction: line from player to clamped destination
            const dx = worldMouseX - pos.x, dy = worldMouseY - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = getAbilityMaxDist(ab.params);
            const clampedDist = Math.min(dist, maxDist);
            const angle = Math.atan2(dy, dx);
            const endX = pos.x + Math.cos(angle) * clampedDist;
            const endY = pos.y + Math.sin(angle) * clampedDist;
            targetingGfx.moveTo(pos.x, pos.y);
            targetingGfx.lineTo(endX, endY);
            targetingGfx.stroke({ color: colors.stroke, alpha: 0.5, width: 2 });
            targetingGfx.circle(endX, endY, 8);
            targetingGfx.fill({ color: colors.fill, alpha: 0.3 });
            targetingGfx.circle(endX, endY, 8);
            targetingGfx.stroke({ color: colors.stroke, alpha: 0.6, width: 1 });
          }
        }
      } else if (targetingGfx) {
        targetingGfx.clear();
      }

      // Tick ability cooldowns
      for (let ai = 0; ai < 3; ai++) {
        if (abilityCooldowns[ai] > 0) abilityCooldowns[ai] = Math.max(0, abilityCooldowns[ai] - dt);
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
      // Client-side homing: steer homing projectiles toward nearest enemy
      for (const [, proj] of projectileRenderer.getProjectiles()) {
        if (!proj.homing) continue;
        const speed = Math.sqrt(proj.vx * proj.vx + proj.vy * proj.vy);
        if (speed === 0) continue;
        let bestD2 = HOMING_DETECT_RANGE * HOMING_DETECT_RANGE;
        let bestX = 0, bestY = 0, found = false;
        for (const eid of world.query(C.Position, C.Faction)) {
          const ef = world.getComponent<FactionComponent>(eid, C.Faction);
          if (ef?.type !== 'enemy') continue;
          const hgs = world.getComponent<GhostStateComponent>(eid, C.GhostState);
          if (hgs?.hidden) continue;
          const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
          const hdx = ep.x - proj.x, hdy = ep.y - proj.y;
          const d2 = hdx * hdx + hdy * hdy;
          if (d2 < bestD2 && d2 > 0) { bestD2 = d2; bestX = ep.x; bestY = ep.y; found = true; }
        }
        if (found) {
          const desired = Math.atan2(bestY - proj.y, bestX - proj.x);
          const current = Math.atan2(proj.vy, proj.vx);
          let diff = desired - current;
          if (diff > Math.PI) diff -= 2 * Math.PI;
          if (diff < -Math.PI) diff += 2 * Math.PI;
          const maxTurn = HOMING_TURN_RATE * dt;
          const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
          const angle = current + turn;
          proj.vx = Math.cos(angle) * speed;
          proj.vy = Math.sin(angle) * speed;
        }
      }
      projectileRenderer.update(dt);
      damageNumbers.update(dt);
      hitParticles.update(dt);
      abilityVFX.update(dt);

      // Client-side projectile hit prediction — swept collision along path
      const projHits: number[] = [];
      for (const [projId, proj] of projectileRenderer.getProjectiles()) {
        const old = projOldPos.get(projId);
        const ox = old?.x ?? proj.x, oy = old?.y ?? proj.y;
        for (const targetId of world.query(C.Position, C.Health, C.Faction)) {
          const tf = world.getComponent<FactionComponent>(targetId, C.Faction);
          if (!tf || tf.type === 'player' || tf.type === 'item' || tf.type === 'building') continue;
          const pgs = world.getComponent<GhostStateComponent>(targetId, C.GhostState);
          if (pgs?.hidden) continue;
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
            if (!proj.pierce) {
              projHits.push(projId);
              break;
            }
          }
        }
      }
      for (const id of projHits) projectileRenderer.remove(id);

      projectileRenderer.render(camera.viewX, camera.viewY, camera.zoom, sw, sh);
      abilityVFX.render(camera.viewX, camera.viewY, camera.zoom, sw, sh);

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
      const hotbarCooldown = CLASS_STATS[selectedClass].attackType === 'melee' ? MELEE_COOLDOWN : RANGED_COOLDOWN;
      // Build unlocked slots set from active abilities (slots 1-3 for Q/E/R)
      const unlockedSlots = new Set([0, 5]); // weapon + build always
      const abilityNames: string[] = [];
      for (let ai = 0; ai < 3; ai++) {
        if (activeAbilities[ai]) {
          unlockedSlots.add(1 + ai);
          abilityNames.push(activeAbilities[ai].name);
        } else {
          abilityNames.push('');
        }
      }
      weaponHotbar.update(
        selectedClass, attackCooldown, hotbarCooldown, width, height, buildCtrl.active,
        unlockedSlots, abilityNames, abilityCooldowns, abilityCooldownMaxes, targetingSlot,
      );
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
