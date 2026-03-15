import { distance } from '@shared/math/utils';
import { Renderer } from './render/Renderer';
import { Camera } from './render/Camera';
import { TileRenderer } from './render/TileRenderer';
import { NightOverlay } from './render/NightOverlay';
import { ChunkManager } from './world/ChunkManager';
import { DebugOverlay } from './ui/debug/DebugOverlay';
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
  TORCH_RADIUS,
  TORCH_COLOR,
  PORTAL_LIGHT_RADIUS,
} from '@shared/constants';
import type { LobbySlot } from '@shared/protocol';
import type { SaveSlotInfo } from '@shared/SaveFormat';
import { registerMessageHandlers, type GameplayState } from './net/NetworkHandler';
import { createBuildController } from './systems/BuildController';

import { World } from '@shared/ecs/World';
import { C, PositionComponent, FactionComponent, BuildingComponent, DodgeRollComponent, StaminaComponent, PlayerInputComponent, FacingComponent, GhostStateComponent, HealthComponent } from '@shared/components';
import { FACTION_COLORS, type EnemyFaction } from '@shared/definitions/EnemyVariants';

import { InputManager, Action } from './input/InputManager';
import { GameStateManager, GameState } from './state/GameStateManager';
import { InputSystem } from './systems/InputSystem';
import { MovementSystem } from './systems/MovementSystem';
import { StaminaSystem } from './systems/StaminaSystem';
import { PlayerRendererSystem } from './systems/PlayerRendererSystem';
import { RemotePlayerSystem } from './systems/RemotePlayerSystem';
import { Reconciler } from './net/Reconciler';
import { HUD } from './ui/hud/HUD';
import { MenuOverlay } from './ui/overlays/MenuOverlay';
import { LobbyOverlay } from './ui/overlays/LobbyOverlay';
import { PauseBanner } from './ui/banners/PauseBanner';
import { WeaponHotbar } from './ui/hud/WeaponHotbar';
import { ProjectileRendererSystem } from './systems/ProjectileRendererSystem';
import { WaveHUD } from './ui/hud/WaveHUD';
import { ResourceHUD } from './ui/hud/ResourceHUD';
import { DeathOverlay } from './ui/overlays/DeathOverlay';
import { GameOverOverlay } from './ui/overlays/GameOverOverlay';
import { UpdateBanner } from './ui/banners/UpdateBanner';
import { ChatOverlay } from './ui/overlays/ChatOverlay';
import { BuildModeOverlay } from './ui/overlays/BuildModeOverlay';
import { BuildMenuOverlay } from './ui/overlays/BuildMenuOverlay';
import { BuildGhostRenderer } from './render/BuildGhostRenderer';
import { WarehouseHUD } from './ui/hud/WarehouseHUD';
import { EventRoulette } from './ui/hud/EventRoulette';
import { createCardToast } from './ui/hud/CardToast';
import { createNotificationToast } from './ui/hud/NotificationToast';
import { DamageNumberSystem } from './systems/DamageNumberSystem';
import { HitParticleSystem } from './systems/HitParticleSystem';
import { AbilityVFXSystem } from './systems/AbilityVFXSystem';
import { Minimap, MAP_SIZE, MAP_PADDING } from './ui/hud/Minimap';
import { StatsOverlay } from './ui/overlays/StatsOverlay';
import { CardPickerOverlay } from './ui/overlays/CardPickerOverlay';
import { SkillTreeOverlay } from './ui/overlays/SkillTreeOverlay';
import { PotionShopOverlay } from './ui/overlays/PotionShopOverlay';
import { TrainingCenterOverlay } from './ui/overlays/TrainingCenterOverlay';
import { TavernOverlay } from './ui/overlays/TavernOverlay';
import { CivilianPanelOverlay } from './ui/overlays/CivilianPanelOverlay';
import { CLASS_STATS, DEFAULT_CLASS } from '@shared/definitions/ClassDefinitions';
import { getActiveAbilities, type SkillActiveAbility, type AbilityParams } from '@shared/definitions/SkillDefinitions';
import type { PlayerClass } from '@shared/definitions/ClassDefinitions';
import { Graphics } from 'pixi.js';

// Slow world pan behind menus (world pixels per millisecond)
const BG_PAN_X = 0.05;
const BG_PAN_Y = 0.025;

// ── Environment ─────────────────────────────────────────────────────────────
const remoteServerIp = import.meta.env.VITE_SERVER_IP ?? '';
const isDev = !import.meta.env.VITE_SERVER_IP;
const hasRemoteServer = !!remoteServerIp;

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
  const damageNumbers = new DamageNumberSystem(renderer.stage);
  const hitParticles  = new HitParticleSystem(tileRenderer.worldContainer);
  const abilityVFX    = new AbilityVFXSystem(tileRenderer.worldContainer);
  const nightOverlay  = new NightOverlay(renderer.stage);
  const hud          = new HUD(renderer.stage);
  const weaponHotbar = new WeaponHotbar(renderer.stage);
  const minimap      = new Minimap(renderer.stage);
  const campfireIndicator = new Graphics();
  campfireIndicator.zIndex = 199;
  renderer.stage.addChild(campfireIndicator);

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
  let localActiveBuffIds: string[] = [];
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
  let slotAssignments: [string | null, string | null, string | null] = [null, null, null];
  /** Cached active abilities from skill allocation (null = empty slot). */
  let activeAbilities: (SkillActiveAbility | null)[] = [null, null, null];
  /** Client-side ability cooldowns [Q, E, R] - ticked down locally, synced from server. */
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
    meteor_shower:      { fill: 0xff4400, stroke: 0xff7722 },
    blizzard_freeze:    { fill: 0x66aaff, stroke: 0x99ccff },
  };

  type TargetMode = 'self' | 'ground' | 'direction';
  function getTargetMode(params: AbilityParams): TargetMode {
    // Self-cast: buffs, transforms, AOE centered on player
    const selfTypes = ['warcry_rage', 'unbreakable_charge', 'blood_drain',
      'fan_of_knives', 'smoke_bomb', 'vanish', 'aegis', 'guardian_angel',
      'wild_transformation', 'primal_roar', 'multishot',
      'arrow_volley', 'thunderwave'];
    if (selfTypes.includes(params.type)) return 'self';
    // Direction: dashes
    const dirTypes = ['phantom_strike', 'stampede', 'grapple_hook'];
    if (dirTypes.includes(params.type)) return 'direction';
    // Ground: everything else (targeted AOE, projectiles, zones)
    return 'ground';
  }
  function getAbilityRadius(params: AbilityParams): number {
    if ('radius' in params) return (params as any).radius;
    if ('range' in params) return (params as any).range;
    return 60;
  }
  function getAbilityMaxDist(params: AbilityParams): number {
    if ('distance' in params) return (params as any).distance;
    if ('range' in params) return (params as any).range;
    if ('radius' in params) return (params as any).radius;
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

  // ── Potion state (synced from server) ──────────────────────────────────────
  let potionEquipped: string | null = null;
  let potionUnlocked: string[] = [];
  let potionCharges = 0;
  let potionMaxCharges = 0;
  let potionCooldown = 0;
  let potionCooldownMax = 0;
  let completedBuffs: { displayName: string; reward: string; medalColor: string }[] = [];
  let eventVisionMult = 1.0;

  // ── Death / respawn state ──────────────────────────────────────────────────
  let localDowned   = false;
  let localDead     = false;
  let respawnTimer  = 0;
  let localGameOver = false;
  let inputTickAccum = 0;
  let lastServerStats: { wave: number; enemyCount: number; portalCount: number; playerCount: number } | undefined;

  // ── Build / resource state ──────────────────────────────────────────────
  let localResources: Record<string, number> = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0, weapons: 0 };
  let warehouseResources = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0, weapons: 0 };
  let warehouseExists = false;
  let keybindVisible = true;
  let handshakeSent = false;
  let civilianPanelRefreshTimer = 0;
  let pendingSingleplayerAutoStart = false;
  let pendingSingleplayerRetry = false; // Set when SP button clicked but not connected yet
  let localActiveBuffIdsArr: string[] = [];
  let chargeProgress = 0;
  let chargeDamage = 0;
  let selfRootTimer = 0; // Client-side root timer for immediate movement block
  let localChargeElapsed = 0; // Client-side charge timer for smooth progress interpolation
  let localChargeDuration = 0;
  let pendingAbilityCooldowns: Record<string, number> | null = null;

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
  const civilianPanel = new CivilianPanelOverlay();
  const lobbyOverlay = new LobbyOverlay();
  const pauseBanner  = new PauseBanner();
  const waveHUD      = new WaveHUD();
  const resourceHUD  = new ResourceHUD();
  const warehouseHUD = new WarehouseHUD();

  // Left-side sliding inventory drawer (above chat)
  const inventoryPanel = document.createElement('div');
  inventoryPanel.id = 'inventory-panel';
  inventoryPanel.style.cssText = [
    'position: absolute',
    'bottom: 310px',
    'left: 0',
    'z-index: 20',
    'display: none',
  ].join('; ');
  inventoryPanel.appendChild(resourceHUD.el);
  document.getElementById('overlay')!.appendChild(inventoryPanel);

  // Warehouse HUD kept for state tracking but not added to DOM
  // Warehouse resources are shown in the build menu sidebar instead

  const deathOverlay   = new DeathOverlay();
  const gameOverOverlay = new GameOverOverlay();
  gameOverOverlay.setOnMenu(() => {
    net.send({ type: MessageType.SESSION_LEAVE });
    stateMgr.transition(GameState.Menu);
  });

  const chatOverlay = new ChatOverlay();

  // Low HP vignette overlay
  const lowHpVignette = document.createElement('div');
  lowHpVignette.style.cssText = [
    'position: absolute',
    'inset: 0',
    'z-index: 15',
    'pointer-events: none',
    'opacity: 0',
    'transition: opacity 0.3s',
    'box-shadow: inset 0 0 80px 30px rgba(200, 0, 0, 0.5)',
  ].join('; ');
  document.getElementById('overlay')!.appendChild(lowHpVignette);

  // Interaction prompt (floating above player near interactive buildings)
  const interactPrompt = document.createElement('div');
  interactPrompt.style.cssText = [
    'position: absolute',
    'z-index: 25',
    'display: none',
    'font-family: monospace',
    'font-size: 13px',
    'color: #fff',
    'background: rgba(0,0,0,0.7)',
    'padding: 4px 10px',
    'border-radius: 4px',
    'pointer-events: none',
    'white-space: nowrap',
    'text-align: center',
  ].join('; ');
  document.getElementById('overlay')!.appendChild(interactPrompt);

  // Keybind tutorial panel (below wave timer/sleep button, right side)
  const keybindPanel = document.createElement('div');
  keybindPanel.style.cssText = [
    'position: absolute',
    'top: 400px',
    'right: 12px',
    'z-index: 5',
    'display: none',
    'font-family: monospace',
    'font-size: 10px',
    'color: #aab',
    'background: rgba(0,0,0,0.5)',
    'padding: 6px 12px',
    'border-radius: 4px',
    'pointer-events: none',
    'line-height: 1.5',
    'width: 220px',
    'box-sizing: border-box',
  ].join('; ');
  keybindPanel.innerHTML = '<div style="text-align:center;margin-bottom:2px"><b style="color:#ccd;font-size:11px;letter-spacing:2px">CONTROLS</b></div>' +
    [
      'WASD - Move',
      'Q - Build Mode',
      'E - Interact / Upgrade',
      'R - Repair',
      'X - Demolish',
      'K - Skills',
      'C - Civilians',
      'Space - Dodge',
      'Shift - Sprint',
      'Enter - Chat',
      'ESC - Pause / Close',
      'RMB - Select Building',
      '1-3 - Abilities',
      '4 - Potion',
      'F1 - Toggle Controls',
    ].join('<br>');
  document.getElementById('overlay')!.appendChild(keybindPanel);

  const buildOverlay = new BuildModeOverlay();
  const buildGhost   = new BuildGhostRenderer(tileRenderer.worldContainer);
  const buildMenu    = new BuildMenuOverlay();
  const eventRoulette = new EventRoulette();
  eventRoulette.onLand = (eventId) => {
    if (eventId === null) waveHUD.onSafeDay();
  };
  const cardToast = createCardToast();
  const notificationToast = createNotificationToast();
  const potionShopOverlay = new PotionShopOverlay();

  const updateBanner = new UpdateBanner();
  window.electronAPI?.onUpdateAvailable(() => updateBanner.showDownloading());
  window.electronAPI?.onUpdateDownloaded(() => updateBanner.showReady());

  // Wire in-game chat
  chatOverlay.onSend((text) => net.send({ type: MessageType.CHAT, text }));

  // Wire potion shop overlay
  potionShopOverlay.setCallbacks({
    onUnlock: (potionType, shopEntityId) => {
      net.send({ type: MessageType.POTION_UNLOCK, potionType, shopEntityId });
    },
    onEquip: (potionType) => {
      net.send({ type: MessageType.POTION_EQUIP, potionType });
    },
    onRestock: (shopEntityId) => {
      net.send({ type: MessageType.POTION_RESTOCK, shopEntityId });
    },
    onClose: () => {
      potionShopOverlay.hide();
    },
  });

  // Wire training center overlay
  const trainingOverlay = new TrainingCenterOverlay();
  trainingOverlay.setCallbacks({
    onTrain: (buildingId, role) => {
      net.send({ type: MessageType.TRAIN_GUARD, buildingId, role });
      trainingOverlay.hide();
    },
    onClose: () => {
      trainingOverlay.hide();
    },
  });

  // Wire tavern overlay
  const tavernOverlay = new TavernOverlay();
  tavernOverlay.setCallbacks({
    onHire: (tavernId, heroId) => {
      net.send({ type: MessageType.HIRE_HERO, tavernId, heroId });
    },
    onClose: () => {
      tavernOverlay.hide();
    },
  });

  // Wire build menu overlay
  buildMenu.setCallbacks({
    onSelect: (type) => {
      buildMenu.hide();
      buildCtrl.selectBuilding(type);
      buildOverlay.update(type, combinedResources());
      buildOverlay.show();
      buildGhost.show();
    },
    onClose: () => {
      exitBuildModeAndCollapse();
    },
  });

  // Enter key opens chat during gameplay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && stateMgr.current === GameState.Playing
        && !chatOverlay.isOpen && !debug.isOpen
        && !localDowned && !localDead && !localGameOver) {
      e.preventDefault();
      chatOverlay.show();
    }
    // F1 toggles controls panel
    if (e.key === 'F1' && stateMgr.current === GameState.Playing) {
      e.preventDefault();
      keybindVisible = !keybindVisible;
      keybindPanel.style.display = keybindVisible ? 'block' : 'none';
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
      case '/skipnight':
        net.send({ type: MessageType.DEBUG_SKIP_NIGHT });
        break;
      case '/skipday':
        net.send({ type: MessageType.DEBUG_SKIP_DAY });
        break;
      case '/settime':
        net.send({ type: MessageType.DEBUG_SET_TIME, seconds: parseInt(args[0]) || 60 });
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
      case '/modifier':
        if (args[0]) net.send({ type: MessageType.DEBUG_FORCE_MODIFIER, modifierId: args[0] });
        break;
      case '/event':
        if (args[0]) net.send({ type: MessageType.DEBUG_FORCE_EVENT, eventId: args[0] });
        break;
      case '/ability':
        if (args[0]) net.send({ type: MessageType.ABILITY_USE, abilityId: args[0], targetX: 0, targetY: 0, facing: 0 });
        break;
      case '/pause':
        net.send({ type: MessageType.DEBUG_WAVE_PAUSE });
        break;
    }
  });

  // Wire debug buffs/stats providers
  debug.setBuffsProvider(() => {
    if (localEntityId == null) return [];
    const ab = world.getComponent<import('@shared/components').ActiveBuffsComponent>(localEntityId, C.ActiveBuffs);
    return ab?.buffs ?? [];
  });

  debug.setStatsProvider(() => {
    const result: Record<string, string> = {};
    if (localEntityId == null) return result;
    const hp = world.getComponent<import('@shared/components').HealthComponent>(localEntityId, C.Health);
    const spd = world.getComponent<import('@shared/components').SpeedComponent>(localEntityId, C.Speed);
    const def = world.getComponent<import('@shared/components').DefenseComponent>(localEntityId, C.Defense);
    if (hp) result['HP'] = `${Math.round(hp.current)}/${hp.max}`;
    if (spd) result['Speed'] = `base=${spd.base} mult=${spd.multiplier.toFixed(2)}`;
    if (def) result['Defense'] = `${def.flat}`;

    const abilities = activeAbilities;
    for (let i = 0; i < 3; i++) {
      const ab = abilities[i];
      if (ab) {
        result[`Slot ${i + 1}`] = `${ab.abilityId} (cd: ${abilityCooldowns[i].toFixed(1)}s / ${abilityCooldownMaxes[i].toFixed(1)}s)`;
      }
    }

    // Skill buffs summary
    result['Skill Pts'] = String(skillPoints);
    result['Allocated'] = String(Object.values(skillAllocated).filter(v => v > 0).length);
    result['Active Buffs'] = String(localActiveBuffIdsArr.length);
    if (localActiveBuffIdsArr.length > 0) result['Buff IDs'] = localActiveBuffIdsArr.join(', ');
    return result;
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
    isLocalServerReady: () => Promise<boolean>;
    onLocalServerReady: (cb: () => void) => void;
  } }).electronAPI;

  // ── State: Menu ─────────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Menu, () => {
    // Hide night overlay FIRST - before any cleanup that could throw
    nightOverlay.hide();
    cancelTargeting();
    menuOverlay.showMenu();
    // Restore saved display name so the input is pre-filled when returning to menu
    const restored = loadSavedDisplayName();
    if (restored) menuOverlay.displayName = restored;
    pendingSingleplayerAutoStart = false;
    // Update button states based on connection
    // Singleplayer is always available if we have a local server (electron or dev mode)
    // Only disable if we're connected to a REMOTE server (can't run local + remote simultaneously)
    const localServerAvailable = !electronAPI || true; // In electron, embedded server always runs
    menuOverlay.setSingleplayerEnabled(!connectedToRemote && (transportReady || localServerAvailable));
    menuOverlay.setButtonsEnabled(transportReady);
    lobbyOverlay.hide();
    pauseBanner.hide();
    waveHUD.hide();
    eventRoulette.hide();
    cardToast.hide();
    notificationToast.hide();
    hud.setVisible(false);
    weaponHotbar.setVisible(false);
    skillTree.hide();
    civilianPanel.hide();
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
    activeAbilities = [null, null, null];
    slotAssignments = [null, null, null];
    abilityCooldowns = [0, 0, 0];
    abilityCooldownMaxes = [0, 0, 0];
    selfRootTimer = 0;
    localChargeDuration = 0;
    localChargeElapsed = 0;
    chargeProgress = 0;
    chargeDamage = 0;
    localActiveBuffIdsArr = [];
    pendingAbilityCooldowns = null;
    lowHpVignette.style.opacity = '0';
    cardAbilities = [];
    pickedCardIds = [];
    potionEquipped = null;
    potionUnlocked = [];
    potionCharges = 0;
    potionMaxCharges = 0;
    potionCooldown = 0;
    potionCooldownMax = 0;
    eventVisionMult = 1.0;
    nightOverlay.resetTint();
    waveHUD.onWorldEventEnd();
    eventRoulette.hide();
    potionShopOverlay.hide();
    trainingOverlay.hide();
    buildMenu.hide();
    waveHUD.setPaused(false);
    coordsEl.style.display = 'none';
    deathOverlay.hide();
    gameOverOverlay.hide();
    chatOverlay.setActive(false);
    minimap.setVisible(false);
    keybindPanel.style.display = 'none';
    debug.hide();
    resourceHUD.setResources(0, 0, 0, 0, 0, 0);
    resourceHUD.hide();
    buildCtrl.reset();
    localResources = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0, weapons: 0 };
    warehouseResources = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0, weapons: 0 };
    warehouseExists = false;
    warehouseHUD.hide();
    inventoryPanel.style.display = 'none';
    // warehouse container removed
    // Transport stays alive - don't disconnect
    menuOverlay.setButtonsEnabled(transportReady);
    menuOverlay.setConnectionStatus(transportReady ? 'connected' : 'connecting');
  });

  // ── State: Lobby ────────────────────────────────────────────────────────────
  stateMgr.onEnter(GameState.Lobby, () => {
    menuOverlay.hide();
    lobbyOverlay.setSingleplayer(!connectedToRemote);
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
    inventoryPanel.style.display = 'block';
    minimap.setVisible(true);
    keybindPanel.style.display = 'block';
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
    // Hide HUD elements during pause (keep chat for multiplayer communication)
    resourceHUD.setVisible(false);
    keybindPanel.style.display = 'none';
    waveHUD.setVisible(false);
    coordsEl.style.display = 'none';
    minimap.setVisible(false);
  });

  // Note: pause resume HUD restore is handled in the main onEnter(Playing) callback above

  // ─── Persistent Transport Connection ──────────────────────────────────────────
  // Created once at startup and persists across sessions. The transport handles
  // WebSocket lifecycle (connect, reconnect, heartbeat). Session actions (host,
  // join, leave) are sent over this existing connection.

  // Default to localhost (embedded local server) - switches to remote for multiplayer
  const net = new NetworkClient(`ws://localhost:${SERVER_PORT}`);
  let connectedToRemote = false;

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

  // Wire resource accordion: auto-expand/collapse with build mode
  function exitBuildModeAndCollapse(): void {
    buildMenu.hide();
    buildCtrl.exitBuildMode();
    // Warehouse collapses when leaving build mode, but inventory stays as-is
    warehouseHUD.collapse();
    warehouseHUD.hide();
  }

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
    get buildModeActive() { return buildCtrl.phase !== 'inactive'; }, set buildModeActive(v) { if (!v) exitBuildModeAndCollapse(); },
    get placingType() { return buildCtrl.placingType; }, set placingType(_v) { /* read-only from handler side */ },
    get selectedBuildingId() { return buildCtrl.selectedId; }, set selectedBuildingId(v) { buildCtrl.selectedId = v; },
    get localResources() { return localResources; }, set localResources(v) { localResources = v; },
    get warehouseResources() { return warehouseResources; }, set warehouseResources(v) { warehouseResources = v; },
    get warehouseExists() { return warehouseExists; }, set warehouseExists(v) { warehouseExists = v; },
    get selectedClass() { return selectedClass; }, set selectedClass(v) { selectedClass = v; },
    get lastServerStats() { return lastServerStats; }, set lastServerStats(v) { lastServerStats = v; },
    get handshakeSent() { return handshakeSent; }, set handshakeSent(v) { handshakeSent = v; },
    get localPlayerId() { return localPlayerId; }, set localPlayerId(_v) { /* read-only */ },
    get seed() { return seed; }, set seed(v) { seed = v; },
    get skillAllocated() { return skillAllocated; }, set skillAllocated(v) { skillAllocated = v; },
    get skillPoints() { return skillPoints; }, set skillPoints(v) { skillPoints = v; },
    get slotAssignments() { return slotAssignments; }, set slotAssignments(v) { slotAssignments = v; },
    onSkillStateUpdate: () => {
      // Rebuild active abilities from updated allocation with slot assignments
      activeAbilities = getActiveAbilities({ allocated: skillAllocated, skillPoints, slotAssignments });
      // Apply any pending ability cooldowns from server (delayed until abilities are available)
      if (pendingAbilityCooldowns) {
        for (let i = 0; i < 3; i++) {
          const ab = activeAbilities[i];
          if (ab && pendingAbilityCooldowns[ab.abilityId] != null) {
            abilityCooldowns[i] = pendingAbilityCooldowns[ab.abilityId];
            abilityCooldownMaxes[i] = Math.max(abilityCooldownMaxes[i], abilityCooldowns[i]);
          }
        }
        pendingAbilityCooldowns = null;
      }
    },
    get cardAbilities() { return cardAbilities; }, set cardAbilities(v) { cardAbilities = v; },
    get pickedCardIds() { return pickedCardIds; }, set pickedCardIds(v) { pickedCardIds = v; },
    get potionEquipped() { return potionEquipped; }, set potionEquipped(v) { potionEquipped = v; },
    get potionUnlocked() { return potionUnlocked; }, set potionUnlocked(v) { potionUnlocked = v; },
    get potionCharges() { return potionCharges; }, set potionCharges(v) { potionCharges = v; },
    get potionMaxCharges() { return potionMaxCharges; }, set potionMaxCharges(v) { potionMaxCharges = v; },
    get potionCooldown() { return potionCooldown; }, set potionCooldown(v) { potionCooldown = v; },
    get potionCooldownMax() { return potionCooldownMax; }, set potionCooldownMax(v) { potionCooldownMax = v; },
    get completedBuffs() { return completedBuffs; }, set completedBuffs(v) { completedBuffs = v; },
    get eventVisionMult() { return eventVisionMult; }, set eventVisionMult(v) { eventVisionMult = v; },
    get pendingSingleplayerAutoStart() { return pendingSingleplayerAutoStart; }, set pendingSingleplayerAutoStart(v) { pendingSingleplayerAutoStart = v; },
    get localActiveBuffIds() { return localActiveBuffIdsArr; }, set localActiveBuffIds(v) { localActiveBuffIdsArr = v; },
    get chargeProgress() { return chargeProgress; }, set chargeProgress(v) { chargeProgress = v; },
    get chargeDamage() { return chargeDamage; }, set chargeDamage(v) { chargeDamage = v; },
    get pendingAbilityCooldowns() { return pendingAbilityCooldowns; }, set pendingAbilityCooldowns(v) { pendingAbilityCooldowns = v; },
    get pendingSingleplayerRetry() { return pendingSingleplayerRetry; }, set pendingSingleplayerRetry(v) { pendingSingleplayerRetry = v; },
    // Called by NetworkHandler after localhost reconnect succeeds - retriggers the singleplayer flow
    onSingleplayerRetry: null as (() => void) | null,
  };

  // Wire up singleplayer retry: when NetworkHandler detects localhost connected after a
  // pending singleplayer request, it calls this to re-invoke the singleplayer flow
  handlerState.onSingleplayerRetry = () => {
    menuOverlay.triggerSingleplayer?.();
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
    warehouseHUD, cardPicker, skillTree, statsOverlay, abilityVFX, potionShopOverlay, trainingOverlay, tavernOverlay, buildMenu, civilianPanel, nightOverlay, eventRoulette, cardToast, notificationToast, combinedResources, electronAPI,
    getActiveAbilities: () => activeAbilities,
    setAbilityCooldown: (slotIdx: number, remaining: number) => {
      if (slotIdx >= 0 && slotIdx < 3) {
        abilityCooldowns[slotIdx] = remaining;
        abilityCooldownMaxes[slotIdx] = Math.max(abilityCooldownMaxes[slotIdx], remaining);
      }
    },
  });

  // ── Session action helper ─────────────────────────────────────────────────

  function sendHandshakeIfNeeded(displayName: string): void {
    // Always re-send: the eager connect handshake may have used 'Player' before the user typed their name
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
    onSingleplayer: () => {
      // Singleplayer always uses the local embedded server.
      // If not connected or connected to remote, switch to localhost first.
      if (connectedToRemote || !transportReady) {
        connectedToRemote = false;
        menuOverlay.setConnectionStatus('connecting');
        net.reconnectTo(`ws://localhost:${SERVER_PORT}`);
        // Retry singleplayer after reconnect completes
        pendingSingleplayerRetry = true;
        return;
      }
      sendHandshakeIfNeeded(menuOverlay.displayName);
      saveDisplayName(menuOverlay.displayName);
      saveSlotRequestId++;
      net.send({ type: MessageType.SAVE_SLOTS_REQUEST });
      menuOverlay.showSaveSlotPicker(
        (slot) => {
          pendingSingleplayerAutoStart = true;
          joinSession('host', menuOverlay.displayName, undefined, slot);
        },
        (slot) => {
          net.send({ type: MessageType.SAVE_DELETE, slot });
        },
      );
    },
    onHost: () => {
      // Switch to remote server for online hosting (if available)
      if (hasRemoteServer && !connectedToRemote) {
        menuOverlay.setConnectionStatus('connecting');
        menuOverlay.setButtonsEnabled(false);
        net.reconnectTo(`ws://${remoteServerIp}:${SERVER_PORT}`);
        connectedToRemote = true;
        // User will need to click Host again after reconnect
        return;
      }
      if (!transportReady) { console.warn('[Game] Not connected'); return; }
      sendHandshakeIfNeeded(menuOverlay.displayName);
      saveSlotRequestId++;
      net.send({ type: MessageType.SAVE_SLOTS_REQUEST });
      menuOverlay.showSaveSlotPicker(
        (slot) => {
          joinSession('host', menuOverlay.displayName, undefined, slot);
        },
        (slot) => {
          net.send({ type: MessageType.SAVE_DELETE, slot });
        },
      );
    },
    onJoin: (value) => {
      if (!value) { console.warn('[Game] Enter an invite code first'); return; }

      // If input looks like an IP, reconnect transport to that IP
      if (/[\d.].*:|\d+\.\d+/.test(value)) {
        const ip = value.includes(':') ? value.split(':')[0] : value;
        net.reconnectTo(`ws://${ip}:${SERVER_PORT}`);
        connectedToRemote = true;
        return;
      }

      // LAN code resolution via Electron IPC
      const isLanCode = electronAPI && /^[A-Za-z]{4}$/.test(value);
      if (isLanCode) {
        void (async () => {
          const resolved = await electronAPI!.resolveSessionCode(value.toUpperCase());
          if (!resolved) {
            console.warn(`[Game] Session code "${value.toUpperCase()}" not found on LAN`);
            return;
          }
          net.reconnectTo(`ws://${resolved.ip}:${SERVER_PORT}`);
          connectedToRemote = true;
        })();
      } else {
        // Switch to remote server for joining if needed
        if (hasRemoteServer && !connectedToRemote) {
          menuOverlay.setConnectionStatus('connecting');
          net.reconnectTo(`ws://${remoteServerIp}:${SERVER_PORT}`);
          connectedToRemote = true;
          // After reconnect, user retries join
          return;
        }
        joinSession('join', menuOverlay.displayName, value.toUpperCase());
      }
    },
    onResume:     () => net.send({ type: MessageType.PAUSE_VOTE }),
    onQuitToMenu: () => {
      net.send({ type: MessageType.SESSION_LEAVE });
      stateMgr.transition(GameState.Menu);
      // Switch back to localhost after leaving multiplayer
      if (connectedToRemote) {
        connectedToRemote = false;
        net.reconnectTo(`ws://localhost:${SERVER_PORT}`);
      }
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
  // Singleplayer starts disabled until local server is ready
  menuOverlay.setSingleplayerEnabled(false);
  // Host/Join start disabled (need remote connection, which happens on-demand)
  menuOverlay.setButtonsEnabled(false);
  // Check if local server is already ready
  if (electronAPI) {
    // Production: wait for embedded server to signal readiness via IPC
    electronAPI.isLocalServerReady().then((ready: boolean) => {
      if (ready) menuOverlay.setSingleplayerEnabled(true);
    });
    electronAPI.onLocalServerReady(() => {
      menuOverlay.setSingleplayerEnabled(true);
    });
  } else {
    // Dev mode: enable singleplayer immediately (dev server assumed running via npm run server:dev)
    menuOverlay.setSingleplayerEnabled(true);
  }
  stateMgr.transition(GameState.Menu);

  // ── Game loop ──────────────────────────────────────────────────────────────
  renderer.ticker.add((ticker) => {
    const dt    = Math.min(ticker.deltaMS / 1000, 0.05); // cap at 50ms to reduce prediction divergence
    const state = stateMgr.current;

    // ESC: close chat/overlays first, then build mode, then pause
    if (input.isJustPressed(Action.Pause)) {
      if (chatOverlay.isOpen && state === GameState.Playing) {
        chatOverlay.hide();
      } else if (trainingOverlay.isVisible && state === GameState.Playing) {
        trainingOverlay.hide();
      } else if (potionShopOverlay.isVisible && state === GameState.Playing) {
        potionShopOverlay.hide();
      } else if (buildCtrl.phase !== 'inactive' && state === GameState.Playing) {
        exitBuildModeAndCollapse();
      } else if (state === GameState.Playing && (targetingSlot >= 0 || skillTree.isVisible || civilianPanel.isVisible)) {
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
        if (skillTree.isVisible) {
          skillTree.hide();
        } else if (!localDowned && !localDead && !localGameOver && !cardPicker.isVisible) {
          // Close build menu if open
          if (buildMenu.isVisible || buildCtrl.phase !== 'inactive') {
            if (buildCtrl.phase === 'placing') { buildOverlay.hide(); buildGhost.hide(); }
            exitBuildModeAndCollapse();
          }
          // Hide all in-game HUD while skill tree is open
          hud.setVisible(false);
          waveHUD.setVisible(false);
          minimap.setVisible(false);
          inventoryPanel.style.display = 'none';
          // warehouse container removed
          coordsEl.style.display = 'none';
          skillTree.show(selectedClass, skillAllocated, skillPoints, (nodeId) => {
            net.send({ type: MessageType.SKILL_ALLOCATE, nodeId });
          }, pickedCardIds, completedBuffs, () => {
            // Restore in-game HUD when skill tree closes (K, ESC, or X button)
            hud.setVisible(true);
            waveHUD.setVisible(true);
            minimap.setVisible(true);
            inventoryPanel.style.display = 'block';
            coordsEl.style.display = 'block';
          }, slotAssignments, (slot, abilityId) => {
            net.send({ type: MessageType.ABILITY_SLOT_ASSIGN, slot: slot as 0 | 1 | 2, abilityId });
          });
        }
      }
      // C key: toggle civilian management panel
      if (input.isJustPressed(Action.CivilianPanel)) {
        if (civilianPanel.isVisible) civilianPanel.hide();
        else if (!localDowned && !localDead && !localGameOver && !cardPicker.isVisible) {
          net.send({ type: MessageType.CIVILIAN_PANEL_REQUEST });
          civilianPanelRefreshTimer = 0;
        }
      }
      // Periodic refresh for civilian panel while visible
      if (civilianPanel.isVisible) {
        civilianPanelRefreshTimer += dt;
        if (civilianPanelRefreshTimer >= 1.0) {
          civilianPanelRefreshTimer = 0;
          net.send({ type: MessageType.CIVILIAN_PANEL_REQUEST });
        }
      }
      // ESC: close chat first, then cancel targeting, then close overlays, then pause
      if (input.isJustPressed(Action.Pause)) {
        if (chatOverlay.isOpen) { chatOverlay.hide(); }
        else if (targetingSlot >= 0) cancelTargeting();
        else if (skillTree.isVisible) skillTree.hide();
        else if (buildMenu.isVisible || buildCtrl.phase !== 'inactive') {
          if (buildCtrl.phase === 'placing') { buildOverlay.hide(); buildGhost.hide(); }
          exitBuildModeAndCollapse();
        }
        else if (civilianPanel.isVisible) civilianPanel.hide();
      }

      const canAct = !localDowned && !localDead && !localGameOver && !chatOverlay.isOpen && !cardPicker.isPicking && !potionShopOverlay.isVisible && !trainingOverlay.isVisible && !buildMenu.isVisible && !civilianPanel.isVisible;

      // Auto-cancel targeting when player can't act
      if (!canAct && targetingSlot >= 0) cancelTargeting();

      // 1. Map keyboard → PlayerInput component (only local entity has it)
      if (canAct) inputSystem.update(world);

      // Clear charge state if player died during charge
      if ((localDowned || localDead) && localChargeDuration > 0) {
        localChargeDuration = 0;
        localChargeElapsed = 0;
        chargeProgress = 0;
        chargeDamage = 0;
        selfRootTimer = 0;
        const cidx = localActiveBuffIdsArr.indexOf('unbreakable_charge');
        if (cidx >= 0) localActiveBuffIdsArr.splice(cidx, 1);
      }

      // 2. Read current input (zero when incapacitated or rooted)
      if (selfRootTimer > 0) selfRootTimer -= dt;
      if (localChargeDuration > 0 && localChargeElapsed < localChargeDuration) {
        localChargeElapsed += dt;
        chargeProgress = localChargeElapsed / localChargeDuration;
        if (localChargeElapsed >= localChargeDuration) {
          // Charge complete - trigger shockwave VFX and release
          const chargePos = localEntityId != null ? world.getComponent<PositionComponent>(localEntityId, C.Position) : null;
          if (chargePos) abilityVFX.trigger('thunderwave', chargePos.x, chargePos.y, 500, 0.8);
          localChargeDuration = 0;
          localChargeElapsed = 0;
          chargeProgress = 0;
          selfRootTimer = 0; // Immediately unroot
          // Force-clear stale buff ID so movement unblocks immediately
          const idx = localActiveBuffIdsArr.indexOf('unbreakable_charge');
          if (idx >= 0) localActiveBuffIdsArr.splice(idx, 1);
          // Reset reconciler smooth offset to prevent teleport-back
          reconciler.smoothX = 0;
          reconciler.smoothY = 0;
        }
      }
      const inp = world.getComponent<{ dx: number; dy: number; sprint: boolean }>(localEntityId, C.PlayerInput)!;
      const isRooted = selfRootTimer > 0 || localActiveBuffIdsArr.includes('unbreakable_charge');
      if (!canAct || isRooted) { inp.dx = 0; inp.dy = 0; inp.sprint = false; }

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
      // Update boss HP bar from ECS world
      const bossEid = waveHUD.getActiveBossEntityId();
      if (bossEid !== null) {
        const bossHp = world.getComponent<import('@shared/components').HealthComponent>(bossEid, C.Health);
        if (bossHp) waveHUD.updateBossHp(bossEid, bossHp.current, bossHp.max);
        else waveHUD.hideBossBar();
      }
      eventRoulette.update(dt);
      cardToast.update(dt);
      chatOverlay.update(dt);

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

      // B key: build mode state machine (closing works even when canAct is false)
      if (input.isJustPressed(Action.BuildMode)) {
        const phase = buildCtrl.phase;
        if (phase !== 'inactive') {
          // Close build menu / exit build mode
          if (phase === 'placing') {
            buildOverlay.hide();
            buildGhost.hide();
          }
          exitBuildModeAndCollapse();
        } else if (canAct) {
          if (targetingSlot >= 0) cancelTargeting();
          buildCtrl.openPicker();
          buildMenu.show(combinedResources());
          // Show warehouse HUD when entering build mode
          if (warehouseExists) {
            // warehouse container removed
            warehouseHUD.show();
          }
        }
      }

      // RMB: select building from world (works in any build phase or even outside build mode)
      // RMB: select a building, or exit build mode if clicking empty ground
      if (input.isJustPressed(Action.Cancel) && pos && canAct) {
        const { width, height } = renderer.screen;
        const wmx = camera.viewX + (mouseX - width / 2) / camera.zoom;
        const wmy = camera.viewY + (mouseY - height / 2) / camera.zoom;
        const clickedBuilding = buildCtrl.findBuildingAt(wmx, wmy);

        if (buildCtrl.phase === 'picker') {
          // In picker phase: if clicking a building, select it. Otherwise exit build mode.
          buildMenu.hide();
          if (clickedBuilding !== null) {
            buildCtrl.enterSelectMode();
          } else {
            exitBuildModeAndCollapse();
          }
        } else if (buildCtrl.phase === 'placing' && buildCtrl.isSelectMode) {
          // In select mode: if clicking empty ground, exit build mode entirely
          if (clickedBuilding === null) {
            exitBuildModeAndCollapse();
          }
          // If clicking a building, the update() call below handles the selection
        } else if (buildCtrl.phase === 'inactive') {
          // Outside build mode: only enter select mode if clicking ON a building
          if (clickedBuilding !== null) {
            buildCtrl.enterSelectMode();
            buildOverlay.show();
          }
        }
      }

      // Build ghost update + placement + selection + demolish + upgrade + repair
      if (buildCtrl.phase === 'placing' && pos) buildCtrl.update();

      // Attack: client-side cooldown mirrors server AttackCooldown. Allow a small
      // tolerance (one server tick) so the client doesn't silently miss an attack
      // due to floating-point drift between variable-rate client and fixed-rate server.
      if (attackCooldown > 0) attackCooldown = Math.max(0, attackCooldown - dt);
      const classAttackType = CLASS_STATS[selectedClass].attackType;
      const classCooldown = classAttackType === 'melee' ? MELEE_COOLDOWN : RANGED_COOLDOWN;
      const hasHoldAttack = cardAbilities.includes('hold_attack');
      const holdAttackCooldown = 0.1; // 10 attacks per second when holding
      const attackInput = hasHoldAttack ? input.isHeld(Action.Attack) : input.isJustPressed(Action.Attack);
      if (canAct && (buildCtrl.phase === 'inactive' || buildCtrl.isSelectMode) && targetingSlot < 0 && attackInput && localFacing !== null && pos && attackCooldown <= TICK_MS / 1000) {
        attackCooldown = hasHoldAttack ? Math.max(classCooldown, holdAttackCooldown) : classCooldown;
        net.send({ type: MessageType.ATTACK, attackType: classAttackType, facing: localFacing, x: pos.x, y: pos.y, t: performance.now() });
        if (classAttackType === 'melee') {
          const hasTitansReach = skillAllocated.has('berserker_t10');
          playerRenderer.notifyAttack(localEntityId!, localFacing, hasTitansReach ? MELEE_RANGE * 2 : undefined);
          // Client-side melee hit prediction - flash targets in arc immediately
          const halfArc = MELEE_ARC / 2;
          for (const targetId of world.query(C.Position, C.Health, C.Faction)) {
            if (targetId === localEntityId) continue;
            const tf = world.getComponent<FactionComponent>(targetId, C.Faction);
            if (tf?.type === 'player' || tf?.type === 'resource' || tf?.type === 'civilian') continue;
            const gs = world.getComponent<GhostStateComponent>(targetId, C.GhostState);
            if (gs?.hidden) continue;
            const tp = world.getComponent<PositionComponent>(targetId, C.Position)!;
            const tdx = tp.x - pos.x;
            const tdy = tp.y - pos.y;
            const dist = distance(tdx, tdy);
            const effectiveMeleeRange = hasTitansReach ? MELEE_RANGE * 2 : MELEE_RANGE;
            if (dist > effectiveMeleeRange || dist === 0) continue;
            let diff = Math.abs(Math.atan2(tdy, tdx) - localFacing);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            if (diff <= halfArc) playerRenderer.notifyHit(targetId);
          }
        }
      }

      // F-interact: pick up nearby non-auto-pickup items (also initiates revive)
      if (input.isJustPressed(Action.Interact) && pos) {
        // Close overlays if open, otherwise check for interactive buildings / send interact
        if (trainingOverlay.isVisible) {
          trainingOverlay.hide();
        } else if (potionShopOverlay.isVisible) {
          potionShopOverlay.hide();
        } else if (tavernOverlay.isVisible) {
          tavernOverlay.hide();
        } else {
          // Check for nearby interactive buildings (client-side proximity)
          let openedBuilding = false;
          for (const bid of world.query(C.Building, C.Position)) {
            const b = world.getComponent<BuildingComponent>(bid, C.Building);
            if (!b) continue;
            const bp = world.getComponent<PositionComponent>(bid, C.Position)!;
            const dx = bp.x - pos.x, dy = bp.y - pos.y;
            if (dx * dx + dy * dy > 80 * 80) continue;

            if (b.buildingType === 'training_center') {
              trainingOverlay.show(bid);
              openedBuilding = true;
              break;
            }
            if (b.buildingType === 'tavern') {
              // Request tavern state from server - server sends TAVERN_STATE
              net.send({ type: MessageType.INTERACT, x: pos.x, y: pos.y, t: performance.now() });
              openedBuilding = true;
              break;
            }
          }
          if (!openedBuilding) {
            net.send({ type: MessageType.INTERACT, x: pos.x, y: pos.y, t: performance.now() });
          }
        }
      }

      // Key '3': use potion
      if (canAct && input.isJustPressed(Action.UsePotion) && potionEquipped && potionCharges > 0 && potionCooldown <= 0) {
        net.send({ type: MessageType.POTION_USE });
      }

      // Space: dodge roll
      if (canAct && !isRooted && input.isJustPressed(Action.DodgeRoll) && localEntityId !== null) {
        const stamina = world.getComponent<StaminaComponent>(localEntityId, C.Stamina);
        const existingDodge = world.getComponent<DodgeRollComponent>(localEntityId, C.DodgeRoll);
        if (stamina && stamina.current >= DODGE_ROLL_STAMINA_COST &&
            (!existingDodge || (existingDodge.timer <= 0 && existingDodge.cooldown <= 0))) {
          stamina.current -= DODGE_ROLL_STAMINA_COST;
          const dinp = world.getComponent<PlayerInputComponent>(localEntityId, C.PlayerInput);
          let dvx = dinp?.dx ?? 0, dvy = dinp?.dy ?? 0;
          const len = distance(dvx, dvy);
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

      // 1/2/3: enter targeting or instant-cast
      if (canAct && (buildCtrl.phase === 'inactive' || buildCtrl.isSelectMode) && localFacing !== null && pos) {
        const abilityKeys = [Action.Skill1, Action.Skill2, Action.Skill3] as const;
        for (let ai = 0; ai < 3; ai++) {
          if (input.isJustPressed(abilityKeys[ai]) && activeAbilities[ai] && abilityCooldowns[ai] <= 0.05) {
            const ab = activeAbilities[ai]!;
            const mode = getTargetMode(ab.params);

            if (mode === 'self') {
              // Self-cast: fire immediately
              abilityCooldowns[ai] = ab.cooldown;
              abilityCooldownMaxes[ai] = ab.cooldown;
              // Immediate client-side root for abilities that root the player
              if (ab.abilityId === 'unbreakable_charge') {
                const dur = (ab.params as any)?.chargeDuration ?? 30;
                selfRootTimer = dur;
                localChargeElapsed = 0;
                localChargeDuration = dur;
              }
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
            const dist = distance(dx, dy);
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
      if (potionCooldown > 0) potionCooldown = Math.max(0, potionCooldown - dt);
      for (let ai = 0; ai < 3; ai++) {
        if (abilityCooldowns[ai] > 0) abilityCooldowns[ai] = Math.max(0, abilityCooldowns[ai] - dt);
      }

      playerRenderer.selectedBuildingId = buildCtrl.selectedId;
      playerRenderer.civilianSpawn = handlerState.civilianSpawn;
      const { width: _vw, height: _vh } = renderer.screen;
      playerRenderer.update(world, localEntityId, localFacing, dt, reconciler.smoothX, reconciler.smoothY, camera.viewX, camera.viewY, camera.zoom, _vw, _vh);
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
      damageNumbers.update(dt, camera.viewX, camera.viewY, camera.zoom, sw, sh);
      hitParticles.update(dt);
      abilityVFX.update(dt);

      // Client-side projectile hit prediction - swept collision along path
      const projHits: number[] = [];
      for (const [projId, proj] of projectileRenderer.getProjectiles()) {
        const old = projOldPos.get(projId);
        const ox = old?.x ?? proj.x, oy = old?.y ?? proj.y;
        for (const targetId of world.query(C.Position, C.Health, C.Faction)) {
          const tf = world.getComponent<FactionComponent>(targetId, C.Faction);
          if (!tf || tf.type === 'player' || tf.type === 'item' || tf.type === 'building' || tf.type === 'civilian') continue;
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

      // Persistent aura effects (warcry, aegis, charge, etc.) - check snapshot buff IDs
      if (localEntityId != null && pos) {
        const hasWarcry = localActiveBuffIdsArr.includes('warcry_rage');
        const hasAegis = localActiveBuffIdsArr.includes('aegis_shield');
        const hasCharge = localActiveBuffIdsArr.includes('unbreakable_charge');

        const hasBloodDrain = localActiveBuffIdsArr.includes('blood_drain');

        abilityVFX.setPersistentAura('warcry_rage', hasWarcry, 0xcc2222, 0xff4444);
        abilityVFX.setPersistentAura('aegis_shield', hasAegis, 0x2255cc, 0x44aaff);
        abilityVFX.setPersistentAura('unbreakable_charge', hasCharge, 0x3355aa, 0x6699dd);
        abilityVFX.setPersistentAura('blood_drain', hasBloodDrain, 0x881111, 0xcc2222);
      }

      // Use raw entity position for auras so they stay perfectly on the player
      abilityVFX.render(camera.viewX, camera.viewY, camera.zoom, sw, sh, pos ? { x: pos.x, y: pos.y, dt, chargeProgress, chargeDamage } : undefined);

      // 7. Camera follows local player (with smooth correction offset)
      reconciler.decaySmooth(dt);
      if (pos) {
        camera.targetX = pos.x + reconciler.smoothX;
        camera.targetY = pos.y + reconciler.smoothY;
      }
    }

    // Look-around only when actively playing with no overlays open
    camera.lookEnabled = state === GameState.Playing
      && !localDowned && !localDead && !localGameOver
      && !chatOverlay.isOpen && !cardPicker.isPicking
      && !potionShopOverlay.isVisible && !buildMenu.isVisible
      && !skillTree.isVisible;
    // If look was disabled mid-look, release it so the camera eases back
    if (!camera.lookEnabled) camera.releaseLook();

    // Hide controls panel and chat when any full-screen overlay is open
    const anyOverlayOpen = skillTree.isVisible || buildMenu.isVisible || civilianPanel.isVisible
      || potionShopOverlay.isVisible || cardPicker.isPicking;
    if (keybindPanel.style.display !== 'none') {
      if (anyOverlayOpen) keybindPanel.style.display = 'none';
    } else if (state === GameState.Playing && !anyOverlayOpen && keybindVisible) {
      keybindPanel.style.display = 'block';
    }
    chatOverlay.setOverlayHidden(anyOverlayOpen);

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
      hud.update(world, width, height, localEntityId);
      // Low HP vignette
      if (localEntityId !== null) {
        const lhp = world.getComponent<HealthComponent>(localEntityId, C.Health);
        if (lhp && lhp.max > 0) {
          const ratio = lhp.current / lhp.max;
          lowHpVignette.style.opacity = ratio < 0.25 ? String(1 - ratio / 0.25) : '0';
        } else {
          lowHpVignette.style.opacity = '0';
        }
      }
      // Build unlocked slots set from active abilities (slots 0-2 for 1/2/3)
      const unlockedSlots = new Set([4]); // build always
      if (potionEquipped) unlockedSlots.add(3); // potion slot
      const abilityNames: string[] = [];
      for (let ai = 0; ai < 3; ai++) {
        if (activeAbilities[ai]) {
          unlockedSlots.add(ai);
          abilityNames.push(activeAbilities[ai]!.name);
        } else {
          abilityNames.push('');
        }
      }
      weaponHotbar.update(
        width, height, buildCtrl.phase !== 'inactive' && !buildCtrl.isSelectMode,
        unlockedSlots, abilityNames, abilityCooldowns, abilityCooldownMaxes, targetingSlot,
        potionEquipped, potionCharges, potionMaxCharges, potionCooldown, potionCooldownMax,
      );
      coordsEl.textContent = `X: ${Math.round(camera.x)}  Y: ${Math.round(camera.y)}`;

      // Interaction prompt: show "Press E to store resources" near warehouse
      {
        let showPrompt = false;
        let promptText = '';
        let promptWorldX = 0, promptWorldY = 0;
        if (localEntityId !== null && !localDowned && !localDead && !localGameOver) {
          const pPos = world.getComponent<PositionComponent>(localEntityId, C.Position);
          if (pPos) {
            for (const bid of world.query(C.Building, C.Position)) {
              const b = world.getComponent<BuildingComponent>(bid, C.Building);
              if (!b) continue;
              const bp = world.getComponent<PositionComponent>(bid, C.Position)!;
              const dx = bp.x - pPos.x, dy = bp.y - pPos.y;
              if (dx * dx + dy * dy > 80 * 80) continue;
              if (b.buildingType === 'warehouse') {
                showPrompt = true;
                promptText = 'Press E to store resources';
                promptWorldX = bp.x;
                promptWorldY = bp.y - 40;
                break;
              }
            }
          }
        }
        if (showPrompt) {
          const sx = (promptWorldX - camera.viewX) * camera.zoom + width / 2;
          const sy = (promptWorldY - camera.viewY) * camera.zoom + height / 2;
          interactPrompt.style.display = 'block';
          interactPrompt.style.left = `${sx}px`;
          interactPrompt.style.top = `${sy}px`;
          interactPrompt.style.transform = 'translate(-50%, -100%)';
          interactPrompt.textContent = promptText;
        } else {
          interactPrompt.style.display = 'none';
        }
      }

      // Night overlay: gather light sources from players + buildings + portals
      const playerLights: { x: number; y: number; radius: number; color?: number }[] = [];
      const lightSources: { x: number; y: number; radius: number; color?: number }[] = [];
      let campfirePos: { x: number; y: number } | null = null;
      const vMult = eventVisionMult; // fog modifier or solar eclipse
      for (const eid of world.query(C.Position, C.Faction)) {
        const f = world.getComponent<FactionComponent>(eid, C.Faction);
        if (f?.type === 'player') {
          const p = world.getComponent<PositionComponent>(eid, C.Position)!;
          const light = { x: p.x, y: p.y, radius: TORCH_RADIUS * vMult, color: TORCH_COLOR };
          playerLights.push(light);
          lightSources.push(light);
        } else if (f?.type === 'portal') {
          const p = world.getComponent<PositionComponent>(eid, C.Position)!;
          const portalFaction = f.enemyFaction as EnemyFaction | undefined;
          const portalColor = portalFaction ? FACTION_COLORS[portalFaction] : undefined;
          lightSources.push({ x: p.x, y: p.y, radius: PORTAL_LIGHT_RADIUS, color: portalColor });
        }
      }
      for (const eid of world.query(C.Position, C.Building)) {
        const b = world.getComponent<BuildingComponent>(eid, C.Building);
        if (!b) continue;
        if (b.buildingType === 'light_tower') {
          const p = world.getComponent<PositionComponent>(eid, C.Position)!;
          lightSources.push({ x: p.x, y: p.y, radius: TORCH_RADIUS * (1 + b.upgradeLevel * 0.5) * vMult });
        } else if (b.buildingType === 'campfire') {
          const p = world.getComponent<PositionComponent>(eid, C.Position)!;
          lightSources.push({ x: p.x, y: p.y, radius: TORCH_RADIUS * 1.5 * vMult });
          campfirePos = { x: p.x, y: p.y };
        }
      }
      nightOverlay.update(camera.viewX, camera.viewY, camera.zoom, width, height, lightSources);
      minimap.setDarkness(nightOverlay.getDarkness());
      minimap.update(world, localEntityId, camera.x, camera.y, width, height, playerLights, campfirePos);

      // Campfire off-screen edge indicator
      campfireIndicator.clear();
      if (campfirePos) {
        const sx = (campfirePos.x - camera.viewX) * camera.zoom + width / 2;
        const sy = (campfirePos.y - camera.viewY) * camera.zoom + height / 2;
        const margin = 60;
        if (sx < -margin || sx > width + margin || sy < -margin || sy > height + margin) {
          const angle = Math.atan2(campfirePos.y - camera.viewY, campfirePos.x - camera.viewX);
          const pad = 40;
          const ex = Math.max(pad, Math.min(width - pad, width / 2 + Math.cos(angle) * (width / 2 - pad)));
          const ey = Math.max(pad, Math.min(height - pad, height / 2 + Math.sin(angle) * (height / 2 - pad)));
          const as = 8;
          // Dark border outline
          campfireIndicator.moveTo(ex + Math.cos(angle) * (as + 2), ey + Math.sin(angle) * (as + 2));
          campfireIndicator.lineTo(ex + Math.cos(angle + 2.4) * (as + 2), ey + Math.sin(angle + 2.4) * (as + 2));
          campfireIndicator.lineTo(ex + Math.cos(angle - 2.4) * (as + 2), ey + Math.sin(angle - 2.4) * (as + 2));
          campfireIndicator.closePath();
          campfireIndicator.fill({ color: 0x1a0a0e, alpha: 0.9 });
          // Arrow fill
          campfireIndicator.moveTo(ex + Math.cos(angle) * as, ey + Math.sin(angle) * as);
          campfireIndicator.lineTo(ex + Math.cos(angle + 2.4) * as, ey + Math.sin(angle + 2.4) * as);
          campfireIndicator.lineTo(ex + Math.cos(angle - 2.4) * as, ey + Math.sin(angle - 2.4) * as);
          campfireIndicator.closePath();
          campfireIndicator.fill({ color: 0xff8844, alpha: 0.7 });
          campfireIndicator.circle(ex, ey, 3);
          campfireIndicator.fill({ color: 0xffcc66, alpha: 0.5 });
        }
      }
    } else {
      // Safety: ensure night overlay never renders outside gameplay
      nightOverlay.hide();
      campfireIndicator.clear();
    }

    const tileX = Math.floor(camera.x / TILE_SIZE);
    const tileY = Math.floor(camera.y / TILE_SIZE);
    const ag    = (isPlaying ? generator : menuGenerator) ?? menuGenerator;
    const biome = BIOME_DEFS[ag.getBiome(tileX, tileY)].name;
    // Build game stats for debug overlay
    let gameStats: import('./ui/debug/DebugOverlay').GameStats | undefined;
    if (localEntityId !== null) {
      const dhp = world.getComponent<HealthComponent>(localEntityId, C.Health);
      const dst = world.getComponent<import('@shared/components').StaminaComponent>(localEntityId, C.Stamina);
      let civCount = 0;
      let bldgCount = 0;
      for (const eid of world.query(C.Faction)) {
        const f = world.getComponent<FactionComponent>(eid, C.Faction);
        if (f?.type === 'civilian') civCount++;
        else if (f?.type === 'building') bldgCount++;
      }
      gameStats = {
        class: selectedClass,
        hp: dhp?.current ?? 0, maxHp: dhp?.max ?? 0,
        stamina: dst?.current ?? 0, maxStamina: dst?.max ?? 0,
        kills: 0, // not tracked client-side yet
        skillPoints,
        cards: pickedCardIds.length,
        civilians: civCount,
        buildings: bldgCount,
        dayPhase: waveHUD.currentPhase,
        darkness: nightOverlay.getDarkness(),
      };
    }
    debug.update(dt, { camera, loadedChunks: tileRenderer.loadedChunkCount, entityCount: world.allEntities.size, biome, seed, net: net.stats, server: lastServerStats, game: gameStats });

    // Notification toast ticks in all states (so save toasts fade out on menu)
    notificationToast.update(dt);

    input.flush();
  });

  console.log(`[Game] Ready - connecting to localhost:${SERVER_PORT} (local server). Remote: ${remoteServerIp || 'none'}. Press F4 for debug overlay.`);
}

main().catch((err) => {
  console.error('[Game] Fatal startup error:', err);
});
