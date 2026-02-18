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
  MELEE_COOLDOWN,
  MELEE_RANGE,
  MELEE_ARC,
  RANGED_COOLDOWN,
  ENEMY_RADIUS,
  PROJECTILE_RADIUS,
  RESOURCE_NODE_RADIUS,
  GAME_VERSION,
  TICK_MS,
  BUILDING_COSTS,
  BUILDING_SIZES,
  PLACEABLE_BUILDINGS,
  buildingHalfExtent,
  snapBuildingPosition,
} from '@shared/constants';
import type {
  HandshakeAckMessage,
  SessionAckMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  SnapshotMessage,
  DeltaMessage,
  AttackPerformedMessage,
  HitMessage,
  ProjectileSpawnMessage,
  ProjectileRemoveMessage,
  PauseVoteUpdateMessage,
  PauseStateMessage,
  ChatMessage,
  WaveStartMessage,
  WaveEndMessage,
  WaveTimerSyncMessage,
  ResourceUpdateMessage,
  PlayerDownedMessage,
  ReviveProgressMessage,
  PlayerRevivedMessage,
  PlayerDiedMessage,
  PlayerRespawnedMessage,
  PartyWipeMessage,
  GameOverMessage,
  BuildConfirmMessage,
  WarehouseUpdateMessage,
  LobbySlot,
} from '@shared/protocol';

import { World } from '@shared/ecs/World';
import { C, PositionComponent, FactionComponent, HealthComponent, BuildingComponent } from '@shared/components';
import { TILE_DEFS } from '@shared/world/TileRegistry';

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
  const hud          = new HUD(renderer.stage);
  const weaponHotbar = new WeaponHotbar(renderer.stage);
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

  // ── Build mode state ─────────────────────────────────────────────────────
  let buildModeActive = false;
  let selectedBuildingIdx = 0;
  let localResources: Record<string, number> = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
  let warehouseResources = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
  let warehouseExists = false;

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
    deathOverlay.hide();
    gameOverOverlay.hide();
    chatOverlay.hide();
    debug.hide();
    resourceHUD.setResources(0, 0, 0, 0, 0, 0);
    resourceHUD.hide();
    buildModeActive = false;
    selectedBuildingIdx = 0;
    localResources = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
    warehouseResources = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
    warehouseExists = false;
    buildOverlay.hide();
    buildGhost.hide();
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
    menuOverlay.hide();
    lobbyOverlay.hide();
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
    menuOverlay.showPause(
      isMultiplayer ? 'All players must press ESC to resume' : undefined,
    );
  });

  // ─── Persistent Transport Connection ──────────────────────────────────────────
  // Created once at startup and persists across sessions. The transport handles
  // WebSocket lifecycle (connect, reconnect, heartbeat). Session actions (host,
  // join, leave) are sent over this existing connection.

  const net = new NetworkClient(`ws://${serverIp}:${SERVER_PORT}`);

  // ── Transport: HANDSHAKE_ACK (fires on each connect / reconnect) ──────────
  net.on(MessageType.HANDSHAKE_ACK, (msg) => {
    const ack = msg as HandshakeAckMessage;
    console.log(`[Net] Connected - clientId: ${ack.clientId}, server v${ack.serverVersion}`);

    transportReady = true;
    menuOverlay.setConnectionStatus('connected');
    menuOverlay.setButtonsEnabled(true);

    // Version gate
    if (ack.serverVersion !== GAME_VERSION) {
      console.warn(`[Net] Version mismatch: client ${GAME_VERSION}, server ${ack.serverVersion}`);
      menuOverlay.setConnectionStatus('disconnected');
      menuOverlay.setButtonsEnabled(false);
      electronAPI?.checkForUpdates?.();
      return;
    }

    // Pre-fill name from server's IP memory
    if (ack.lastDisplayName) {
      menuOverlay.displayName = ack.lastDisplayName;
    }
  });

  // ── Transport: connection status callbacks ────────────────────────────────
  net.onConnect(() => {
    menuOverlay.setConnectionStatus('connecting');
  });

  net.onDrop(() => {
    transportReady = false;
    menuOverlay.setConnectionStatus('disconnected');
    menuOverlay.setButtonsEnabled(false);
    debug.log('Connection lost');

    // If in a game session, return to menu (session state is lost)
    if (stateMgr.current !== GameState.Menu) {
      console.warn('[Net] Connection lost - returning to menu');
      stateMgr.transition(GameState.Menu);
    }
  });

  // ── Register all game message handlers (called once) ──────────────────────
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
    debug.log(`Player joined: ${pj.player.displayName} (slot ${pj.player.slot})`);
  });

  net.on(MessageType.PLAYER_LEFT, (msg) => {
    const pl = msg as PlayerLeftMessage;
    lobbyPlayers = lobbyPlayers.filter((p) => p.playerId !== pl.playerId);
    lobbyOverlay.updatePlayers(lobbyPlayers);
    lobbyOverlay.addChatMessage('←', `Player ${pl.slot + 1} left`);
    debug.log(`Player left: slot ${pl.slot + 1}`);
  });

  net.on(MessageType.SNAPSHOT, (msg) => {
    const snap = msg as SnapshotMessage;

    world.clear();
    playerRenderer.destroy();

    // Track multiplayer status for pause voting
    isMultiplayer = lobbyPlayers.length > 1;

    // Create all remote player entities from server snapshot
    remotePlayerSys.applySnapshot(world, snap);

    // Find and configure the local player entity
    const localSnap = snap.entities.find((e) => e.slot === localSlot);
    if (localSnap) {
      localEntityId = localSnap.entityId;
      reconciler.localEntityId = localEntityId;

      // Add prediction-only components (not sent by server)
      world.addComponent(localEntityId, C.Speed,       { base: PLAYER_BASE_SPEED, multiplier: 1 });
      world.addComponent(localEntityId, C.Stamina,     { current: PLAYER_MAX_STAMINA, max: PLAYER_MAX_STAMINA, regenRate: PLAYER_STAMINA_REGEN, exhausted: false });
      world.addComponent(localEntityId, C.PlayerInput, { dx: 0, dy: 0, sprint: false });

      // Snap camera - no lerp pop on first frame
      const pos = world.getComponent<PositionComponent>(localEntityId, C.Position)!;
      camera.x = pos.x; camera.y = pos.y;
      camera.targetX = pos.x; camera.targetY = pos.y;
    }

    stateMgr.transition(GameState.Playing);
  });

  net.on(MessageType.DELTA, (msg) => {
    if (stateMgr.current !== GameState.Playing) return;
    const delta = msg as DeltaMessage;

    // Capture server stats for debug console
    if (delta.serverStats) lastServerStats = delta.serverStats;

    // Reconcile local player (snap-to-server + replay pending inputs).
    // Pass localEntityId so entity separation runs during replay - prevents
    // walking through resource nodes when the reconciler replays movement.
    reconciler.applyDelta(world, delta, (replayDt) => {
      movementSystem?.update(world, replayDt, localEntityId ?? undefined);
    });

    // Apply remote entity updates
    remotePlayerSys.applyDelta(world, delta);
  });

  net.on(MessageType.ATTACK_PERFORMED, (msg) => {
    const ap = msg as AttackPerformedMessage;
    // Skip local player - their arc is triggered immediately on input
    if (ap.sourceId !== localEntityId) {
      playerRenderer.notifyAttack(ap.sourceId, ap.facing);
    }
  });

  net.on(MessageType.HIT, (msg) => {
    const hit = msg as HitMessage;
    playerRenderer.notifyHit(hit.targetId);
  });

  net.on(MessageType.PROJECTILE_SPAWN, (msg) => {
    const ps = msg as ProjectileSpawnMessage;
    projectileRenderer.spawn(ps.projectileId, ps.x, ps.y, ps.vx, ps.vy, ps.ownerSlot);
  });

  net.on(MessageType.PROJECTILE_REMOVE, (msg) => {
    const pr = msg as ProjectileRemoveMessage;
    projectileRenderer.remove(pr.projectileId);
  });

  net.on(MessageType.PAUSE_VOTE_UPDATE, (msg) => {
    const update = msg as PauseVoteUpdateMessage;
    pauseBanner.show(update.direction, update.voters, update.required);
  });

  net.on(MessageType.PAUSE_STATE, (msg) => {
    const ps = msg as PauseStateMessage;
    pauseBanner.hide();
    if (ps.paused) {
      // Send zero-input so the server zeros our velocity
      const seq = reconciler.recordInput(0, 0, false, 0);
      net.send({ type: MessageType.INPUT, seq, dx: 0, dy: 0, sprint: false, t: performance.now() });
      stateMgr.transition(GameState.Paused);
    } else {
      stateMgr.transition(GameState.Playing);
    }
  });

  net.on(MessageType.CHAT, (msg) => {
    const chat = msg as ChatMessage;
    lobbyOverlay.addChatMessage(chat.displayName, chat.text);
    chatOverlay.addMessage(chat.displayName, chat.slot, chat.text);
    debug.log(`[Chat] ${chat.displayName}: ${chat.text}`);
  });

  net.on(MessageType.WAVE_START, (msg) => {
    const ws = msg as WaveStartMessage;
    waveHUD.onWaveStart(ws.waveNumber, ws.prepDuration);
    debug.log(`Wave ${ws.waveNumber} started (prep: ${ws.prepDuration}s)`);
  });

  net.on(MessageType.WAVE_END, (msg) => {
    const we = msg as WaveEndMessage;
    waveHUD.onWaveEnd(we.waveNumber);
    debug.log(`Wave ${we.waveNumber} cleared`);
  });

  net.on(MessageType.WAVE_TIMER_SYNC, (msg) => {
    const sync = msg as WaveTimerSyncMessage;
    waveHUD.onTimerSync(sync.waveNumber, sync.remaining, sync.paused);
  });

  net.on(MessageType.RESOURCE_UPDATE, (msg) => {
    const ru = msg as ResourceUpdateMessage;
    resourceHUD.setResources(ru.wood, ru.stone, ru.iron, ru.diamond, ru.gold, ru.food);
    localResources = { wood: ru.wood, stone: ru.stone, iron: ru.iron, diamond: ru.diamond, gold: ru.gold, food: ru.food };
    if (buildModeActive) {
      const currentBuilding = PLACEABLE_BUILDINGS[selectedBuildingIdx];
      buildOverlay.update(currentBuilding, combinedResources());
    }
  });

  net.on(MessageType.WAREHOUSE_UPDATE, (msg) => {
    const wu = msg as WarehouseUpdateMessage;
    warehouseResources = { wood: wu.wood, stone: wu.stone, iron: wu.iron, diamond: wu.diamond, gold: wu.gold, food: wu.food };
    warehouseExists = wu.exists;
    if (warehouseExists) {
      warehouseHUD.update(warehouseResources);
      warehouseHUD.show();
    } else {
      warehouseHUD.hide();
    }
    // Refresh build overlay with new available resources
    if (buildModeActive) {
      const currentBuilding = PLACEABLE_BUILDINGS[selectedBuildingIdx];
      buildOverlay.update(currentBuilding, combinedResources());
    }
  });

  // ── Death / respawn handlers ──────────────────────────────────────────────
  net.on(MessageType.PLAYER_DOWNED, (msg) => {
    if (localGameOver) return;
    const pd = msg as PlayerDownedMessage;
    playerRenderer.notifyDowned(pd.entityId);
    debug.log(`Player downed (entity ${pd.entityId})`);
    if (pd.entityId === localEntityId) {
      localDowned = true;
      buildModeActive = false;
      buildOverlay.hide();
      buildGhost.hide();
      deathOverlay.showDowned(pd.bleedTimer, !isMultiplayer);
    }
  });

  net.on(MessageType.REVIVE_PROGRESS, (msg) => {
    if (localGameOver) return;
    const rp = msg as ReviveProgressMessage;
    playerRenderer.notifyReviveProgress(rp.targetId, rp.progress);
    if (rp.targetId === localEntityId) {
      deathOverlay.showReviving(rp.progress);
    }
  });

  net.on(MessageType.PLAYER_REVIVED, (msg) => {
    if (localGameOver) return;
    const pr = msg as PlayerRevivedMessage;
    playerRenderer.notifyRevived(pr.entityId);
    debug.log(`Player revived (entity ${pr.entityId})`);
    if (pr.entityId === localEntityId) {
      localDowned = false;
      localDead   = false;
      deathOverlay.hide();
    }
  });

  net.on(MessageType.PLAYER_DIED, (msg) => {
    if (localGameOver) return;
    const pd = msg as PlayerDiedMessage;
    playerRenderer.notifyDeath(pd.entityId);
    debug.log(`Player died (entity ${pd.entityId})`);
    if (pd.entityId === localEntityId) {
      localDowned = false;
      localDead   = true;
      respawnTimer = pd.respawnTimer;
      deathOverlay.showDead(pd.respawnTimer);
    }
  });

  net.on(MessageType.PLAYER_RESPAWNED, (msg) => {
    if (localGameOver) return;
    const pr = msg as PlayerRespawnedMessage;
    playerRenderer.notifyRespawned(pr.entityId);
    if (pr.entityId === localEntityId) {
      localDowned = false;
      localDead   = false;
      respawnTimer = 0;
      deathOverlay.hide();
      // Snap camera to respawn position
      camera.x = pr.x; camera.y = pr.y;
      camera.targetX = pr.x; camera.targetY = pr.y;
    }
  });

  net.on(MessageType.PARTY_WIPE, (msg) => {
    if (localGameOver) return;
    const pw = msg as PartyWipeMessage;
    debug.log(`Party wipe #${pw.wipeCount} - ${pw.outcome}`);
    if (pw.outcome === 'penalty') {
      console.log(`[Game] Party wipe #${pw.wipeCount} - 25% resource penalty`);
    }
  });

  net.on(MessageType.GAME_OVER, (msg) => {
    const go = msg as GameOverMessage;
    console.log(`[Game] Game Over - reached wave ${go.waveReached}, reason: ${go.reason}`);
    debug.log(`Game Over - wave ${go.waveReached}, reason: ${go.reason}`);
    localGameOver = true;
    localDowned = false;
    localDead   = false;
    buildModeActive = false;
    buildOverlay.hide();
    buildGhost.hide();
    deathOverlay.hide();
    gameOverOverlay.show({
      waveReached: go.waveReached,
      enemiesKilled: go.enemiesKilled,
      timePlayed: go.timePlayed,
      reason: go.reason,
    });
  });

  // ── Building handlers ───────────────────────────────────────────────────
  net.on(MessageType.BUILD_CONFIRM, (msg) => {
    const bc = msg as BuildConfirmMessage;
    if (!bc.success) {
      debug.log(`Build failed: ${bc.reason ?? 'unknown'}`);
    }
  });

  net.on(MessageType.CAMPFIRE_DESTROYED, () => {
    debug.log('Campfire destroyed!');
  });

  net.on(MessageType.ERROR, (msg) => {
    const err = msg as unknown as { code: string; message: string };
    console.error(`[Net] Server error ${err.code}: ${err.message}`);
    debug.log(`Error: ${err.code} - ${err.message}`);
    if (err.code === 'VERSION_MISMATCH') {
      menuOverlay.setConnectionStatus('disconnected');
      menuOverlay.setButtonsEnabled(false);
      electronAPI?.checkForUpdates?.();
    }
  });

  // Session closed by host departure (clean message path)
  net.on(MessageType.SESSION_CLOSED, (msg) => {
    const closed = msg as unknown as { reason: string };
    console.warn(`[Net] Session closed: ${closed.reason}`);
    debug.log(`Session closed: ${closed.reason}`);
    stateMgr.transition(GameState.Menu);
  });

  // ── Session action helper ─────────────────────────────────────────────────
  function joinSession(role: 'host' | 'join', displayName: string, code?: string): void {
    if (!transportReady) {
      console.warn('[Game] Not connected to server');
      return;
    }
    // Send HANDSHAKE (identifies player + version), then session action
    net.send({ type: MessageType.HANDSHAKE, displayName, version: GAME_VERSION });
    if (role === 'host') {
      net.send({ type: MessageType.SESSION_CREATE });
    } else {
      net.send({ type: MessageType.SESSION_JOIN, code: code ?? '' });
    }
  }

  // ── Menu callbacks ────────────────────────────────────────────────────────
  menuOverlay.setCallbacks({
    onHost: () => joinSession('host', menuOverlay.displayName),
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
      // Send SESSION_LEAVE so the server frees the slot, but keep transport alive
      net.send({ type: MessageType.SESSION_LEAVE });
      stateMgr.transition(GameState.Menu);
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
      if (buildModeActive && state === GameState.Playing) {
        buildModeActive = false;
        buildOverlay.hide();
        buildGhost.hide();
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
      const canAct = !localDowned && !localDead && !localGameOver && !chatOverlay.isOpen;

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
      if (input.isJustPressed(Action.WeaponSlot1)) { selectedWeapon = 0; if (buildModeActive) { buildModeActive = false; buildOverlay.hide(); buildGhost.hide(); } }
      if (input.isJustPressed(Action.WeaponSlot2)) { selectedWeapon = 1; if (buildModeActive) { buildModeActive = false; buildOverlay.hide(); buildGhost.hide(); } }

      // B key: toggle build mode
      if (canAct && input.isJustPressed(Action.BuildMode)) {
        buildModeActive = !buildModeActive;
        if (buildModeActive) {
          const currentBuilding = PLACEABLE_BUILDINGS[selectedBuildingIdx];
          buildOverlay.show();
          buildOverlay.update(currentBuilding, combinedResources());
          buildGhost.show();
        } else {
          buildOverlay.hide();
          buildGhost.hide();
        }
      }

      // Scroll wheel cycles building type in build mode
      if (buildModeActive && input.scrollDelta !== 0) {
        const dir = input.scrollDelta > 0 ? 1 : -1;
        selectedBuildingIdx = (selectedBuildingIdx + dir + PLACEABLE_BUILDINGS.length) % PLACEABLE_BUILDINGS.length;
        const currentBuilding = PLACEABLE_BUILDINGS[selectedBuildingIdx];
        buildOverlay.update(currentBuilding, combinedResources());
      }

      // Build ghost update + placement + demolish
      if (buildModeActive && pos) {
        const { width: gw, height: gh } = renderer.screen;
        const wmx = camera.viewX + (mouseX - gw / 2) / camera.zoom;
        const wmy = camera.viewY + (mouseY - gh / 2) / camera.zoom;
        const currentBuilding = PLACEABLE_BUILDINGS[selectedBuildingIdx];

        // Snap to grid using variable-size snapping
        const { x: snapX, y: snapY } = snapBuildingPosition(wmx, wmy, currentBuilding);
        const newHalf = buildingHalfExtent(currentBuilding);
        const tiles = BUILDING_SIZES[currentBuilding] ?? 1;

        // Check cost affordability (warehouse + player inventory combined)
        const costs = BUILDING_COSTS[currentBuilding] ?? {};
        const wRes = warehouseExists ? warehouseResources as unknown as Record<string, number> : {} as Record<string, number>;
        let ghostValid = true;
        for (const [res, amount] of Object.entries(costs)) {
          const total = (wRes[res] ?? 0) + (localResources[res] ?? 0);
          if (total < amount!) { ghostValid = false; break; }
        }

        // Multi-tile walkability check (bridges: inverted — must be on water)
        const isBridgeGhost = currentBuilding === 'bridge';
        if (ghostValid && chunks) {
          const startTX = Math.floor((snapX - newHalf) / TILE_SIZE);
          const startTY = Math.floor((snapY - newHalf) / TILE_SIZE);
          for (let ty = 0; ty < tiles && ghostValid; ty++) {
            for (let tx = 0; tx < tiles && ghostValid; tx++) {
              const tileId = chunks.getTile(startTX + tx, startTY + ty);
              const walkable = TILE_DEFS[tileId]?.walkable ?? false;
              if (isBridgeGhost) {
                // Bridge must be placed on non-walkable (water) tiles
                if (walkable) ghostValid = false;
              } else {
                if (!walkable) ghostValid = false;
              }
            }
          }
        }

        // Variable-size overlap check against existing buildings and resources
        if (ghostValid) {
          for (const eid of world.query(C.Position, C.Faction)) {
            const ef = world.getComponent<FactionComponent>(eid, C.Faction);
            if (ef?.type === 'building') {
              const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
              const bComp = world.getComponent<BuildingComponent>(eid, C.Building);
              const existHalf = bComp ? buildingHalfExtent(bComp.buildingType) : 16;
              if (Math.abs(ep.x - snapX) < newHalf + existHalf && Math.abs(ep.y - snapY) < newHalf + existHalf) {
                ghostValid = false;
                break;
              }
            } else if (ef?.type === 'resource') {
              const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
              if (Math.abs(ep.x - snapX) < newHalf + RESOURCE_NODE_RADIUS && Math.abs(ep.y - snapY) < newHalf + RESOURCE_NODE_RADIUS) {
                ghostValid = false;
                break;
              }
            }
          }
        }

        buildGhost.update(wmx, wmy, ghostValid, currentBuilding);

        // Left-click places building (stays in build mode for rapid placement)
        if (input.isJustPressed(Action.Attack) && ghostValid) {
          net.send({ type: MessageType.BUILD_PLACE, buildingType: currentBuilding, x: wmx, y: wmy });
        }

        // Right-click demolishes building at cursor
        if (input.isJustPressed(Action.Demolish)) {
          net.send({ type: MessageType.BUILD_DEMOLISH, x: wmx, y: wmy });
        }
      }

      // Attack: client-side cooldown mirrors server AttackCooldown. Allow a small
      // tolerance (one server tick) so the client doesn't silently miss an attack
      // due to floating-point drift between variable-rate client and fixed-rate server.
      if (attackCooldown > 0) attackCooldown = Math.max(0, attackCooldown - dt);
      if (canAct && !buildModeActive && input.isJustPressed(Action.Attack) && localFacing !== null && pos && attackCooldown <= TICK_MS / 1000) {
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

      playerRenderer.update(world, localEntityId, localFacing, dt, reconciler.smoothX, reconciler.smoothY);
      deathOverlay.update(dt);

      // 6. Update and render projectiles
      const { width: sw, height: sh } = renderer.screen;
      // Snapshot old positions before moving for swept collision
      const projOldPos = new Map<number, { x: number; y: number }>();
      for (const [pid, p] of projectileRenderer.getProjectiles()) {
        projOldPos.set(pid, { x: p.x, y: p.y });
      }
      projectileRenderer.update(dt);

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
      weaponHotbar.update(selectedWeapon, attackCooldown, WEAPON_COOLDOWNS[selectedWeapon], width, height, buildModeActive);
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
