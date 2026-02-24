import { World } from '@shared/ecs/World';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import { spawnPlayer, findSpawnPoint } from '@shared/world/PlayerSpawner';
import { CLASS_STATS, DEFAULT_CLASS } from '@shared/ClassDefinitions';
import { CARD_POOL } from '@shared/CardDefinitions';
import type { PlayerClass } from '@shared/ClassDefinitions';
import {
  C,
  PositionComponent,
  VelocityComponent,
  HealthComponent,
  PlayerInputComponent,
  AttackCooldownComponent,
  FactionComponent,
  ResourceNodeComponent,
  ResourcesComponent,
  ItemDropComponent,
  DownedComponent,
  BuildingComponent,
  ProductionComponent,
  TurretComponent,
  SpikeTrapComponent,
  BridgeComponent,
  EnemyVariantComponent,
  DodgeRollComponent,
  ProjectileComponent,
} from '@shared/components';
import type {
  ResourceType, BuildingType, EnemyVariantType, EnemyStatsComponent, GhostStateComponent,
  LightRevealComponent, HealAuraComponent, BarracksSpawnerComponent, FacingComponent,
  BurnDotComponent, SlowEffectComponent, SpeedComponent,
} from '@shared/components';
import {
  TILE_SIZE,
  PLAYER_RADIUS,
  PLAYER_MAX_HEALTH,
  ENEMY_BASE_SPEED,
  ENEMY_MAX_HEALTH,
  ENEMY_MELEE_COOLDOWN,
  RANGED_COOLDOWN,
  RANGED_SPEED,
  RANGED_LIFETIME,
  PROJECTILE_RADIUS,
  WAVE_PREP_INITIAL,
  WAVE_PREP_BETWEEN,
  CHUNK_SIZE,
  MAX_RESOURCE_NODES,
  ITEM_DROP_LIFETIME,
  ITEM_DROP_SCATTER_SPEED,
  ITEM_DROP_INTERACT_RADIUS,
  REVIVE_RANGE,
  MAX_ATTACK_POSITION_TOLERANCE,
  TICK_MS,
  CAMPFIRE_MAX_HEALTH,
  WALL_MAX_HEALTH,
  RESOURCE_NODE_RADIUS,
  PORTAL_RADIUS,
  WAREHOUSE_MAX_HEALTH,
  LUMBERMILL_MAX_HEALTH,
  QUARRY_MAX_HEALTH,
  MINE_MAX_HEALTH,
  FARM_MAX_HEALTH,
  buildingHalfExtent,
  ENEMY_RADIUS,
  ENEMY_RANGER_SPAWN_CHANCE,
  ENEMY_RANGER_RANGE,
  ENEMY_RANGER_COOLDOWN,
  ENEMY_RANGER_DAMAGE,
  ENEMY_RANGER_PROJECTILE_SPEED,
  ENEMY_RANGER_SPEED,
  ENEMY_RANGER_HEALTH,
  DODGE_ROLL_DURATION,
  DODGE_ROLL_COOLDOWN,
} from '@shared/constants';
import { RESOURCE_STATS, RESOURCE_SPAWN_TABLE, TILE_SPAWN_CHANCE } from '@shared/data/ResourceSpawnTable';
import { LOOT_TABLES } from '@shared/data/LootTables';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import { MessageType } from '@shared/protocol';
import type {
  LobbySlot,
  EntitySnapshot,
  SnapshotMessage,
  DeltaMessage,
  InputMessage,
  AttackMessage,
  AttackPerformedMessage,
  HitMessage,
  ProjectileSpawnMessage,
  ProjectileRemoveMessage,
  SessionStartingMessage,
  PauseVoteUpdateMessage,
  PauseStateMessage,
  WaveStartMessage,
  ResourceUpdateMessage,
  InteractMessage,
  BuildPlaceMessage,
  BuildDemolishMessage,
  BuildUpgradeMessage,
  BuildRepairMessage,
  AoeExplosionMessage,
  CardPickMessage,
  SkillAllocateMessage,
  AbilityUseMessage,
} from '@shared/protocol';
import { ItemDropSystem, PickupResult } from './systems/ItemDropSystem';
import type { ConnectedClient } from './net/ServerSocket';
import { MovementSystem } from './systems/MovementSystem';
import { EnemySystem } from './systems/EnemySystem';
import { CombatSystem } from './systems/CombatSystem';
import { ProjectileSystem } from './systems/ProjectileSystem';
import { PortalSystem } from './systems/PortalSystem';
import { CardSystem } from './CardSystem';
import { createSkillSystem, type SkillSystem } from './SkillSystem';
import { createBuildingSystem, type BuildingSystem } from './systems/BuildingSystem';
import { createWaveController, type WaveController, type WaveState } from './systems/WaveController';
import { createCardDispenser, type CardDispenser, type CardState } from './systems/CardDispenser';
import { createSaveManager, type SaveManager, type LoadedSaveState } from './systems/SaveManager';
import { createRespawnManager, type RespawnManager } from './systems/RespawnManager';
import { createStatsCollector, type StatsCollector } from './systems/StatsCollector';
import { createPotionSystem, type PotionSystem } from './systems/PotionSystem';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionPlayer {
  client: ConnectedClient;
  playerId: string;
  displayName: string;
  slot: number;
  isHost: boolean;
  entityId: number | null; // null while in lobby, set on game start
  /** Last input sequence number received from this client. */
  lastSeq: number;
  /** Player class (warrior/ranger/mage). Defaults to 'warrior'. */
  playerClass: PlayerClass;
  /** True if class is locked from a loaded save. */
  classLocked: boolean;
}

export type SessionPhase = 'lobby' | 'playing';

/** Shorthand for the send callback used throughout GameSession. */
export type SendFn = (client: ConnectedClient, msg: object) => void;

// ─── GameSession ──────────────────────────────────────────────────────────────

/**
 * Owns the authoritative ECS world for one game session.
 *
 * Responsibilities:
 *   - Tracks lobby players and their slots
 *   - Starts the game: assigns spawn positions, broadcasts SESSION_STARTING + SNAPSHOT
 *   - Applies client input messages to PlayerInput components
 *   - Runs the server-side MovementSystem each tick
 *   - Broadcasts DELTA to all players each tick (only changed entities)
 */
/** Generate a random 4-uppercase-letter session code. */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // omit I and O (confuse with 1/0)
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export class GameSession {
  readonly id: string;
  readonly seed: number;
  /** 4-letter code shown in the lobby - used by joiners to find this session. */
  readonly code: string;

  private world = new World();
  private generator: WorldGenerator;
  private movement: MovementSystem;
  private enemy: EnemySystem;
  private combat: CombatSystem;
  private projectile: ProjectileSystem;
  private portal: PortalSystem;
  private itemDrop: ItemDropSystem;
  private cards: CardSystem;
  private skills!: SkillSystem;
  private buildings!: BuildingSystem;
  private potions!: PotionSystem;
  private saveManager!: SaveManager;
  private respawn!: RespawnManager;
  private stats!: StatsCollector;

  private players = new Map<string, SessionPlayer>(); // keyed by clientId
  /** Fast lookup: entity IDs that belong to players (updated on spawn/despawn). */
  private playerEntityIds = new Set<number>();
  private phase: SessionPhase = 'lobby';
  private tick = 0;

  /** Mutable wave state — shared with WaveController. */
  private waveState: WaveState = {
    phase: 'idle', currentWave: 0, prepTimer: 0,
    paused: false, syncTimer: 0, enemyCount: 0, wipeCount: 0,
    introducedTypes: new Set(), introducedFactions: new Set(), pendingIntros: [],
  };
  private waves!: WaveController;
  /** Rolling average of per-system tick times (ms) for debug profiling. */
  private tickProfile = { combat: 0, enemy: 0, movement: 0, projectile: 0, buildings: 0, waves: 0, total: 0 };
  private static readonly WAVE_SYNC_INTERVAL = 5; // seconds
  private static readonly MAX_ENEMIES = 200;
  /** Current count of resource node entities. */
  private resourceNodeCount = 0;
  /** Chunks already processed for resource generation (never re-generated). */
  private processedChunks = new Set<string>();
  /** How many chunks around each player to generate (in chunk units). */
  private static readonly RESOURCE_GEN_RADIUS = 2;

  /** Spawn origin (set during start()) - downed players respawn here. */
  private spawnOrigin: { x: number; y: number } = { x: 0, y: 0 };
  /** Players waiting to respawn: clientId → seconds remaining. */
  private respawnTimers = new Map<string, number>();
  /** True after GAME_OVER is sent - stops all death/respawn/wave processing. */
  private gameOver = false;

  /** Entity ID of the campfire (set on game start). -1 = no campfire. */
  private campfireEntityId = -1;

  private warehouseIds = new Set<number>();
  private warehousePool = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
  /** Bridge tile positions: "tileX,tileY" → entityId. */
  private bridgePositions = new Map<string, number>();


  /** Mutable card state — shared with CardDispenser. */
  private cardState: CardState = { offerTimer: -1 };
  private cardDispenser!: CardDispenser;
  private static readonly CARD_OFFER_TIMEOUT = 35; // 5s pre-reveal + 30s pick window

  // ── Run stats ──────────────────────────────────────────────────────────────
  private enemiesKilled = 0;
  private startTime = 0;
  /** Accumulated paused time in ms (excluded from elapsed time). */
  private pausedAccum = 0;
  /** Timestamp when current pause started (0 = not paused). */
  private pauseStart = 0;

  /** Get elapsed play time in seconds (excludes paused time). */
  private getElapsedSeconds(): number {
    if (this.startTime <= 0) return 0;
    let totalPaused = this.pausedAccum;
    if (this.paused && this.pauseStart > 0) totalPaused += Date.now() - this.pauseStart;
    return (Date.now() - this.startTime - totalPaused) / 1000;
  }

  /** Call when paused state changes to track accumulated pause time. */
  private setPaused(value: boolean): void {
    if (value === this.paused) return;
    if (value) {
      this.pauseStart = Date.now();
    } else if (this.pauseStart > 0) {
      this.pausedAccum += Date.now() - this.pauseStart;
      this.pauseStart = 0;
    }
    this.paused = value;
  }
  /** Per-player buildings built (keyed by playerId/UUID). */
  private buildingsByPlayer = new Map<string, number>();
  /** Called at game over with per-player run stats. */
  onRunEnd?: (playerStats: Map<string, import('@shared/MetaStats').RunStats>) => void;

  /** Snapshot of entity positions from the previous tick, for delta diffing. */
  private prevSnapshot = new Map<number, EntitySnapshot>();

  /** Whether the game simulation is paused (server-authoritative). */
  private paused = false;
  /** Set of clientIds that have voted for the current pending action. */
  private pauseVotes = new Set<string>();

  // ── Save system ──────────────────────────────────────────────────────────
  /** Called by SessionManager when save triggers. */
  onSave?: (data: import('@shared/SaveFormat').SaveData) => void;
  /** Called on game over to delete the active save. */
  onSaveDelete?: () => void;
  /** Which save slot this session is using (1-3). */
  saveSlot = 1;
  /** Host's persistent player UUID. */
  hostPlayerId = '';

  constructor(id: string, seed: number) {
    this.id = id;
    this.seed = seed;
    this.code = generateCode();
    this.generator = new WorldGenerator(seed);
    this.movement = new MovementSystem(this.generator);
    this.combat = new CombatSystem();
    this.enemy = new EnemySystem(this.combat, this.generator);
    this.projectile = new ProjectileSystem(this.generator);
    this.portal = new PortalSystem();
    this.itemDrop = new ItemDropSystem();
    this.cards = new CardSystem();
    this.skills = createSkillSystem({
      world: this.world,
      players: this.players,
      generator: this.generator,
    });

    this.buildings = createBuildingSystem({
      world: this.world,
      generator: this.generator,
      combat: this.combat,
      warehousePool: this.warehousePool,
      warehouseIds: this.warehouseIds,
      bridgePositions: this.bridgePositions,
      movementBridgeTiles: this.movement.bridgeTiles,
      players: this.players,
      playerEntityIds: this.playerEntityIds,
      respawnTimers: this.respawnTimers,
      buildingsByPlayer: this.buildingsByPlayer,
      cards: this.cards,
      isActive: () => this.phase === 'playing' && !this.paused && !this.gameOver,
      isWalkable: (wx, wy) => this.isWalkable(wx, wy),
      spawnBuilding: (x, y, type, maxHp, permanent) => this.spawnBuilding(x, y, type as any, maxHp, permanent),
      destroyDeadEntities: (deaths, attackerMap, send) => this.respawn.destroyDeadEntities(deaths, attackerMap, send),
    });

    this.potions = createPotionSystem({
      world: this.world,
      players: this.players as any,
      warehousePool: this.warehousePool,
      warehouseIds: this.warehouseIds,
      cards: this.cards,
      broadcastWarehouseUpdate: (send) => this.buildings.broadcastWarehouseUpdate(send),
      isActive: () => this.phase === 'playing' && !this.paused && !this.gameOver,
    });

    this.waves = createWaveController({
      world: this.world,
      generator: this.generator,
      portal: this.portal,
      state: this.waveState,
      players: this.players,
      cards: this.cards,
      maxEnemies: GameSession.MAX_ENEMIES,
      waveSyncInterval: GameSession.WAVE_SYNC_INTERVAL,
      isWalkable: (wx, wy) => this.isWalkable(wx, wy),
      overlapsBuilding: (wx, wy, r) => this.overlapsBuilding(wx, wy, r),
      onWaveCleared: (wave, send) => this.onWaveCleared(wave, send),
    });

    this.cardDispenser = createCardDispenser({
      world: this.world,
      cards: this.cards,
      state: this.cardState,
      players: this.players,
      offerTimeout: GameSession.CARD_OFFER_TIMEOUT,
      setPaused: (v) => this.setPaused(v),
      creditResources: (eid, res, amt, send) => this.creditResources(eid, res, amt, send),
    });

    this.saveManager = createSaveManager({
      world: this.world,
      seed: this.seed,
      waveState: this.waveState,
      warehousePool: this.warehousePool,
      spawnOrigin: this.spawnOrigin,
      processedChunks: this.processedChunks,
      players: this.players,
      getEnemiesKilled: () => this.enemiesKilled,
      getElapsedSeconds: () => this.getElapsedSeconds(),
      getHostPlayerId: () => this.hostPlayerId,
    });

    this.respawn = createRespawnManager({
      world: this.world,
      players: this.players,
      playerEntityIds: this.playerEntityIds,
      respawnTimers: this.respawnTimers,
      spawnOrigin: this.spawnOrigin,
      waveState: this.waveState,
      warehousePool: this.warehousePool as Record<string, number>,
      warehouseIds: this.warehouseIds,
      getGameOver: () => this.gameOver,
      setGameOver: (v) => { this.gameOver = v; },
      getEnemiesKilled: () => this.enemiesKilled,
      incrementEnemiesKilled: () => { this.enemiesKilled++; },
      decrementResourceNodeCount: () => { this.resourceNodeCount--; },
      getCampfireEntityId: () => this.campfireEntityId,
      getElapsedSeconds: () => this.getElapsedSeconds(),
      getBuildings: () => this.buildings,
      creditResources: (eid, res, amt, send) => this.creditResources(eid, res, amt, send),
      spawnLootDrops: (deadId) => this.spawnLootDrops(deadId),
      spawnItemDrop: (x, y, item, qty, auto) => this.spawnItemDrop(x, y, item, qty, auto),
      findSafeSpawnNear: (wx, wy) => this.findSafeSpawnNear(wx, wy),
      trackKill: (eid, variant) => this.stats.trackKill(eid, variant),
      fireRunEnd: () => this.fireRunEnd(),
    });

    this.stats = createStatsCollector({
      players: this.players,
      waveState: this.waveState,
      buildingsByPlayer: this.buildingsByPlayer,
      getElapsedSeconds: () => this.getElapsedSeconds(),
    });
  }

  // ── Lobby management ────────────────────────────────────────────────────────

  get playerCount(): number {
    return this.players.size;
  }

  get isFull(): boolean {
    return this.players.size >= 4;
  }

  get isPlaying(): boolean {
    return this.phase === 'playing';
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Assign the next free slot (0–3) to a joining player. */
  private nextFreeSlot(): number {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let i = 0; i < 4; i++) if (!used.has(i)) return i;
    return -1; // should never happen if isFull is checked first
  }

  addPlayer(
    client: ConnectedClient,
    displayName: string,
    isHost: boolean,
    persistentId?: string,
    playerClass?: PlayerClass,
  ): SessionPlayer {
    const slot = this.nextFreeSlot();
    const pid = persistentId ?? client.id;

    // Check if this player exists in the loaded save — lock their class
    let lockedClass: PlayerClass | null = null;
    if (this.loadedSave) {
      const savedP = this.loadedSave.players.find(sp => sp.playerId === pid);
      if (savedP?.playerClass && CLASS_STATS[savedP.playerClass as PlayerClass]) {
        lockedClass = savedP.playerClass as PlayerClass;
      }
    }

    const player: SessionPlayer = {
      client,
      playerId: pid,
      displayName,
      slot,
      isHost,
      entityId: null,
      lastSeq: 0,
      playerClass: lockedClass ?? playerClass ?? DEFAULT_CLASS,
      classLocked: lockedClass !== null,
    };
    this.players.set(client.id, player);
    return player;
  }

  removePlayer(clientId: string): SessionPlayer | undefined {
    const player = this.players.get(clientId);
    if (player) {
      this.players.delete(clientId);
      this.pauseVotes.delete(clientId);
      if (player.entityId !== null) {
        this.playerEntityIds.delete(player.entityId);
        this.world.destroyEntity(player.entityId);
      }
    }
    return player;
  }

  getPlayer(clientId: string): SessionPlayer | undefined {
    return this.players.get(clientId);
  }

  /**
   * Suspend a player during an active game (for reconnection grace period).
   * Zeros their input so the entity stands still, but keeps entity + slot intact.
   */
  suspendPlayer(clientId: string): SessionPlayer | undefined {
    const player = this.players.get(clientId);
    if (!player) return undefined;
    // Zero input so the entity freezes in place
    if (player.entityId !== null) {
      const inp = this.world.getComponent<PlayerInputComponent>(player.entityId, C.PlayerInput);
      if (inp) { inp.dx = 0; inp.dy = 0; inp.sprint = false; }
    }
    return player;
  }

  /**
   * Rebind a suspended player to a new WebSocket client (after reconnection).
   * The player keeps their slot, entity, and game state.
   */
  rebindPlayer(oldClientId: string, newClient: ConnectedClient): SessionPlayer | undefined {
    const player = this.players.get(oldClientId);
    if (!player) return undefined;
    this.players.delete(oldClientId);
    player.client = newClient;
    // Keep persistent playerId (UUID) — only update the map key to new client ID
    this.players.set(newClient.id, player);
    // Remap potion state to new client ID
    this.potions.remapClient(oldClientId, newClient.id);
    return player;
  }

  getLobbySlots(): LobbySlot[] {
    return [...this.players.values()].map((p) => ({
      playerId: p.playerId,
      displayName: p.displayName,
      slot: p.slot,
      isHost: p.isHost,
      playerClass: p.playerClass,
      classLocked: p.classLocked || undefined,
    }));
  }

  /** Iterate all session player records (for broadcasting). */
  getPlayers(): IterableIterator<SessionPlayer> {
    return this.players.values();
  }

  /** Handle a CLASS_SELECT message from a lobby player. */
  handleClassSelect(clientId: string, playerClass: PlayerClass, send: SendFn): void {
    if (this.phase !== 'lobby') return;
    const player = this.players.get(clientId);
    if (!player) return;
    if (player.classLocked) return; // class locked from save
    if (!CLASS_STATS[playerClass]) return; // invalid class
    player.playerClass = playerClass;
    // Broadcast updated lobby state to all players
    const state = { type: MessageType.SESSION_STATE, players: this.getLobbySlots() };
    for (const p of this.players.values()) send(p.client, state);
  }

  // ── Game start ──────────────────────────────────────────────────────────────

  /**
   * Transition from lobby → playing.
   * - Finds one canonical spawn point and places all players offset from it.
   * - Broadcasts SESSION_STARTING then SNAPSHOT to all clients.
   */
  start(send: (client: ConnectedClient, msg: object) => void): void {
    if (this.phase !== 'lobby') return;
    this.phase = 'playing';
    const save = this.loadedSave;
    const hasSave = save !== null;
    this.startTime = Date.now() - (save?.elapsedTime ?? 0) * 1000;
    this.enemiesKilled = hasSave ? this.enemiesKilled : 0;

    // For resumed saves, use saved spawn origin; otherwise find a new one
    const origin = hasSave ? this.spawnOrigin : findSpawnPoint(this.generator);
    this.spawnOrigin = origin;
    const OFFSET = 72; // pixels from centre — clears campfire AABB + player radius
    const offsets = [
      { dx: -OFFSET, dy: -OFFSET },
      { dx:  OFFSET, dy: -OFFSET },
      { dx: -OFFSET, dy:  OFFSET },
      { dx:  OFFSET, dy:  OFFSET },
    ];

    const spawnPositions: Record<number, [number, number]> = {};

    for (const player of this.players.values()) {
      const off = offsets[player.slot] ?? { dx: 0, dy: 0 };
      const sx = origin.x + off.dx;
      const sy = origin.y + off.dy;
      spawnPositions[player.slot] = [sx, sy];

      const cs = CLASS_STATS[player.playerClass];
      player.entityId = spawnPlayer(
        this.world,
        this.generator,
        player.slot,
        { x: sx, y: sy },
        { hp: cs.hp, speed: cs.speed, defense: cs.defense, stamina: cs.stamina, classType: player.playerClass },
      );
      this.playerEntityIds.add(player.entityId);
    }

    // Spawn campfire at the centre of the spawn area
    this.campfireEntityId = this.spawnBuilding(
      origin.x, origin.y,
      'campfire',
      CAMPFIRE_MAX_HEALTH,
      true,
    );

    // Pre-generate resources for immediate spawn area (skip for saves — resources restored later)
    if (!hasSave) {
      const pcx = Math.floor(origin.x / (TILE_SIZE * CHUNK_SIZE));
      const pcy = Math.floor(origin.y / (TILE_SIZE * CHUNK_SIZE));
      const startupR = 1; // 3×3 chunks — just enough for first SNAPSHOT
      for (let cx = pcx - startupR; cx <= pcx + startupR; cx++) {
        for (let cy = pcy - startupR; cy <= pcy + startupR; cy++) {
          const key = `${cx},${cy}`;
          this.processedChunks.add(key);
          this.generateResourcesForChunk(cx, cy);
        }
      }
    }

    // Nudge any player whose offset landed on an invalid position
    for (const player of this.players.values()) {
      if (!player.entityId) continue;
      const pos = this.world.getComponent<PositionComponent>(player.entityId, C.Position);
      if (!pos) continue;
      const safe = this.findSafeSpawnNear(pos.x, pos.y);
      pos.x = safe.x;
      pos.y = safe.y;
      spawnPositions[player.slot] = [safe.x, safe.y];
    }

    // ── Restore saved state ─────────────────────────────────────────────────
    if (hasSave && save) {
      console.log(`[GameSession] Restoring ${save.buildings.length} buildings from save (wave ${this.waveState.currentWave})`);
      // Restore saved buildings (campfire was already placed above — just restore its state)
      for (const sb of save.buildings) {
        if (sb.buildingType === 'campfire') {
          // Restore campfire HP, upgrade level, and position from save
          if (this.campfireEntityId !== null) {
            const pos = this.world.getComponent<PositionComponent>(this.campfireEntityId, C.Position);
            if (pos) { pos.x = sb.x; pos.y = sb.y; }
            const hp = this.world.getComponent<HealthComponent>(this.campfireEntityId, C.Health);
            if (hp) { hp.current = sb.currentHp; hp.max = sb.maxHp; }
            const bld = this.world.getComponent<BuildingComponent>(this.campfireEntityId, C.Building);
            if (bld) bld.upgradeLevel = sb.upgradeLevel;
          }
          continue;
        }
        const eid = this.spawnBuilding(sb.x, sb.y, sb.buildingType as BuildingType, sb.maxHp, sb.permanent);
        // Track warehouse entities
        if (sb.buildingType === 'warehouse') this.warehouseIds.add(eid);
        const hp = this.world.getComponent<HealthComponent>(eid, C.Health);
        if (hp) { hp.current = sb.currentHp; hp.max = sb.maxHp; }
        const bld = this.world.getComponent<BuildingComponent>(eid, C.Building);
        if (bld) bld.upgradeLevel = sb.upgradeLevel;
        // Restore production component (must add — spawnBuilding doesn't)
        if (sb.production) {
          this.world.addComponent(eid, C.Production, {
            resourceType: sb.production.resourceType,
            interval: sb.production.interval,
            timer: sb.production.timer,
            amount: sb.production.amount,
            stored: sb.production.stored,
            maxStored: sb.production.maxStored,
            secondaryResourceType: sb.production.secondaryResourceType,
            secondaryChance: sb.production.secondaryChance,
          } as ProductionComponent);
        }
        // Restore turret component (must add — spawnBuilding doesn't)
        if (sb.turret) {
          this.world.addComponent(eid, C.Turret, {
            range: sb.turret.range,
            cooldown: sb.turret.cooldown,
            cooldownTimer: 0,
            damage: sb.turret.damage,
            projectileSpeed: sb.turret.projectileSpeed,
          } as TurretComponent);
        }
        // Restore spike trap component (must add — spawnBuilding doesn't)
        if (sb.spikeTrap) {
          this.world.addComponent(eid, C.SpikeTrap, {
            damage: sb.spikeTrap.damage,
            cooldown: sb.spikeTrap.cooldown,
            selfDamage: sb.spikeTrap.selfDamage,
            enemyCooldowns: new Map(),
          } as SpikeTrapComponent);
        }
        // Restore bridge
        if (sb.bridge) {
          this.world.addComponent(eid, C.Bridge, { tileX: sb.bridge.tileX, tileY: sb.bridge.tileY } as BridgeComponent);
          this.bridgePositions.set(`${sb.bridge.tileX},${sb.bridge.tileY}`, eid);
          this.movement.bridgeTiles.add(`${sb.bridge.tileX},${sb.bridge.tileY}`);
        }
        // Restore light tower
        if (sb.lightReveal) {
          this.world.addComponent(eid, C.LightReveal, { range: sb.lightReveal.range } as LightRevealComponent);
        }
        // Restore healing shrine
        if (sb.healAura) {
          this.world.addComponent(eid, C.HealAura, {
            range: sb.healAura.range,
            healPerSecond: sb.healAura.healPerSecond,
          } as HealAuraComponent);
        }
        // Restore barracks
        if (sb.barracksSpawner) {
          this.world.addComponent(eid, C.BarracksSpawner, {
            maxGuards: sb.barracksSpawner.maxGuards,
            spawnTimer: sb.barracksSpawner.spawnInterval,
            spawnInterval: sb.barracksSpawner.spawnInterval,
            guardIds: [],
          } as BarracksSpawnerComponent);
        }
      }

      // Restore player resources and class from save (match by playerId)
      for (const p of this.players.values()) {
        if (p.entityId === null) continue;
        const savedP = save.players.find(sp => sp.playerId === p.playerId);
        if (savedP) {
          const res = this.world.getComponent<ResourcesComponent>(p.entityId, C.Resources);
          if (res) Object.assign(res, savedP.resources);
          const hp = this.world.getComponent<HealthComponent>(p.entityId, C.Health);
          if (hp) { hp.current = savedP.hp; hp.max = savedP.maxHp; }
          // Restore saved position
          const pos = this.world.getComponent<PositionComponent>(p.entityId, C.Position);
          if (pos && savedP.x != null && savedP.y != null) {
            pos.x = savedP.x;
            pos.y = savedP.y;
            spawnPositions[p.slot] = [savedP.x, savedP.y];
          }
          // Restore saved class (defaults to current selection if absent)
          if (savedP.playerClass && CLASS_STATS[savedP.playerClass as PlayerClass]) {
            p.playerClass = savedP.playerClass as PlayerClass;
          }
          // Restore skill tree allocations
          if (savedP.skillNodes) {
            this.skills.restore(p.client.id, savedP.skillNodes, savedP.skillPoints ?? 0);
            this.skills.applyPassivesToEntity(p.client.id);
          }
          // Restore card buffs
          if (savedP.cardBuffs) {
            this.cards.restore(p.client.id, savedP.cardBuffs, savedP.pickedCards ?? []);
          }
          // Restore potion state
          if (savedP.potionState) {
            this.potions.restore(p.client.id, savedP.potionState);
          }
        }
      }

      // Restore saved enemies
      for (const se of save.enemies) {
        const id = this.world.createEntity();
        this.world.addComponent(id, C.Position,          { x: se.x, y: se.y });
        this.world.addComponent(id, C.Velocity,          { vx: 0, vy: 0 });
        this.world.addComponent(id, C.Health,            { current: se.currentHp, max: se.maxHp });
        this.world.addComponent(id, C.Speed,             { base: se.speedBase, multiplier: se.speedMultiplier });
        this.world.addComponent(id, C.PlayerInput,       { dx: 0, dy: 0, sprint: false });
        this.world.addComponent(id, C.Faction,           { type: 'enemy' });
        this.world.addComponent(id, C.Facing,            { angle: 0 });
        this.world.addComponent(id, C.AttackCooldown,    { remaining: 0, max: se.rangedCooldown });
        this.world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
        this.world.addComponent(id, C.EnemyVariant,      { variant: se.variant });
        this.world.addComponent(id, C.EnemyStats, {
          damage: se.damage, range: se.range, knockback: se.knockback, radius: se.radius,
          rangedRange: se.rangedRange, projectileSpeed: se.projectileSpeed,
          rangedDamage: se.rangedDamage, rangedCooldown: se.rangedCooldown,
        });
        if (se.variant === 'ghost') {
          this.world.addComponent(id, C.GhostState, { hidden: se.ghostHidden ?? true });
        }
        if (se.variant === 'assassin') {
          this.world.addComponent(id, C.AssassinDash, {
            cooldown: 0, maxCooldown: 20, dashSpeed: 500, dashDuration: 0.3, dashing: false, dashTimer: 0,
          });
        }
        this.waveState.enemyCount++;
      }
      console.log(`[GameSession] Restored ${save.enemies.length} enemies from save`);

      // Restore saved portals
      for (const sp of save.portals) {
        const id = this.world.createEntity();
        this.world.addComponent(id, C.Position,          { x: sp.x, y: sp.y });
        this.world.addComponent(id, C.Velocity,          { vx: 0, vy: 0 });
        this.world.addComponent(id, C.Health,            { current: sp.currentHp, max: sp.maxHp });
        this.world.addComponent(id, C.Faction,           { type: 'portal' });
        this.world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
        this.world.addComponent(id, C.Portal,            { waveNumber: sp.waveNumber, spawnTimer: sp.spawnTimer, spawnInterval: sp.spawnInterval });
      }
      if (save.portals.length > 0) {
        console.log(`[GameSession] Restored ${save.portals.length} portals from save`);
      }

      // Restore saved resource nodes
      for (const sr of save.resourceNodes) {
        const id = this.world.createEntity();
        this.world.addComponent(id, C.Position,          { x: sr.x, y: sr.y });
        this.world.addComponent(id, C.Velocity,          { vx: 0, vy: 0 });
        this.world.addComponent(id, C.Health,            { current: sr.currentHp, max: sr.maxHp });
        this.world.addComponent(id, C.Faction,           { type: 'resource' });
        this.world.addComponent(id, C.ResourceNode,      { resourceType: sr.resourceType, yield: sr.yield });
        this.world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
        this.resourceNodeCount++;
      }
      if (save.resourceNodes.length > 0) {
        console.log(`[GameSession] Restored ${save.resourceNodes.length} resource nodes from save`);
      }

      // Restore saved item drops
      for (const si of save.itemDrops) {
        const id = this.world.createEntity();
        this.world.addComponent(id, C.Position, { x: si.x, y: si.y });
        this.world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
        this.world.addComponent(id, C.Health,   { current: 1, max: 1 });
        this.world.addComponent(id, C.Faction,  { type: 'item' });
        this.world.addComponent(id, C.ItemDrop, {
          itemType: si.itemType, quantity: si.quantity,
          autoPickup: si.autoPickup, lifetime: si.lifetime,
        });
      }
      if (save.itemDrops.length > 0) {
        console.log(`[GameSession] Restored ${save.itemDrops.length} item drops from save`);
      }

      // Clear saved data after restoration
      this.loadedSave = null;
    }

    // Begin wave state
    if (!hasSave) {
      this.waveState.currentWave = 1;
      this.waveState.phase = 'prep';
      this.waveState.prepTimer = WAVE_PREP_INITIAL;
    } else if (save?.wavePhase === 'active') {
      // Resume mid-wave — portals and enemies already restored above
      this.waveState.phase = 'active';
    } else {
      // Resume in prep phase
      this.waveState.phase = 'prep';
      if (save?.prepTimeRemaining != null && save.prepTimeRemaining > 0) {
        this.waveState.prepTimer = save.prepTimeRemaining;
      } else {
        this.waveState.prepTimer = WAVE_PREP_BETWEEN;
      }
    }

    // Broadcast SESSION_STARTING
    const starting: SessionStartingMessage = {
      type: MessageType.SESSION_STARTING,
      seed: this.seed,
      spawnPositions,
    };
    for (const p of this.players.values()) send(p.client, starting);

    // Broadcast full SNAPSHOT (includes restored enemies/portals)
    const snapshot = this.buildFullSnapshot();
    for (const p of this.players.values()) send(p.client, snapshot);

    // Send resource sync to each player (resources aren't in SNAPSHOT)
    for (const p of this.players.values()) {
      if (p.entityId === null) continue;
      const res = this.world.getComponent<ResourcesComponent>(p.entityId, C.Resources);
      if (res) {
        send(p.client, {
          type: MessageType.RESOURCE_UPDATE,
          wood: res.wood, stone: res.stone, iron: res.iron,
          diamond: res.diamond, gold: res.gold, food: res.food,
        });
      }
    }

    // Send initial skill state to each player
    for (const p of this.players.values()) {
      this.skills.sendState(p.client.id, send);
    }

    // Send card abilities sync (needed after save restore — no CARD_APPLIED was sent)
    if (hasSave) {
      for (const p of this.players.values()) {
        const buffs = this.cards.playerBuffs.get(p.client.id);
        send(p.client, {
          type: MessageType.CARD_SYNC,
          abilities: buffs?.abilities ?? [],
          pickedCardIds: [...this.cards.pickedCardIds],
        });
      }
    }

    // Send potion state sync (needed after save restore)
    if (hasSave) {
      for (const p of this.players.values()) {
        this.potions.sendPotionState(p.client.id, send);
      }
    }

    // Send warehouse pool sync
    if (hasSave) {
      this.buildings.broadcastWarehouseUpdate(send);
    }

    // Broadcast wave state to clients
    if (this.waveState.phase === 'active') {
      // Signal active wave (prepDuration=0 means "already active")
      const waveActive: WaveStartMessage = {
        type: MessageType.WAVE_START,
        waveNumber: this.waveState.currentWave,
        prepDuration: 0,
      };
      for (const p of this.players.values()) send(p.client, waveActive);
    } else {
      const waveStart: WaveStartMessage = {
        type: MessageType.WAVE_START,
        waveNumber: this.waveState.currentWave,
        prepDuration: this.waveState.prepTimer,
      };
      for (const p of this.players.values()) send(p.client, waveStart);
    }

    // Seed prevSnapshot so first DELTA is accurate
    this.prevSnapshot.clear();
    for (const snap of this.gatherEntitySnapshots()) {
      this.prevSnapshot.set(snap.entityId, snap);
    }
  }

  /** Returns true if the world-pixel position sits on a walkable tile. */
  private isWalkable(wx: number, wy: number): boolean {
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    const tileId = this.generator.getTile(tx, ty);
    return TILE_DEFS[tileId]?.walkable ?? false;
  }

  /** Returns true if (wx, wy) overlaps any building's footprint (with optional radius padding). */
  private overlapsBuilding(wx: number, wy: number, radius = 0): boolean {
    for (const id of this.world.query(C.Building, C.Position)) {
      const bldg = this.world.getComponent<BuildingComponent>(id, C.Building)!;
      if (bldg.buildingType === 'bridge' || bldg.buildingType === 'spike_trap') continue;
      const bpos = this.world.getComponent<PositionComponent>(id, C.Position)!;
      const half = buildingHalfExtent(bldg.buildingType) + radius;
      if (Math.abs(wx - bpos.x) < half && Math.abs(wy - bpos.y) < half) return true;
    }
    return false;
  }

  /**
   * Find a safe spawn position near (wx, wy) that is walkable and doesn't
   * overlap any existing resource node or building. Spirals outward tile-by-tile.
   */
  private findSafeSpawnNear(wx: number, wy: number): { x: number; y: number } {
    if (this.isSpawnClear(wx, wy)) return { x: wx, y: wy };
    const startTx = Math.floor(wx / TILE_SIZE);
    const startTy = Math.floor(wy / TILE_SIZE);
    for (let r = 1; r < 20; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const cx = (startTx + dx) * TILE_SIZE + TILE_SIZE / 2;
          const cy = (startTy + dy) * TILE_SIZE + TILE_SIZE / 2;
          if (this.isSpawnClear(cx, cy)) return { x: cx, y: cy };
        }
      }
    }
    return { x: wx, y: wy }; // fallback
  }

  /** True if position is walkable and doesn't overlap any resource/building entity. */
  private isSpawnClear(wx: number, wy: number): boolean {
    if (!this.isWalkable(wx, wy)) return false;
    for (const id of this.world.query(C.Position, C.Faction)) {
      const f = this.world.getComponent<FactionComponent>(id, C.Faction)!;
      if (f.type !== 'resource' && f.type !== 'building') continue;
      const p = this.world.getComponent<PositionComponent>(id, C.Position)!;
      const dx = Math.abs(p.x - wx);
      const dy = Math.abs(p.y - wy);
      if (f.type === 'building') {
        const bldg = this.world.getComponent<BuildingComponent>(id, C.Building);
        const half = buildingHalfExtent(bldg?.buildingType ?? 'campfire') + PLAYER_RADIUS;
        if (dx < half && dy < half) return false;
      } else {
        if (dx < PLAYER_RADIUS + RESOURCE_NODE_RADIUS && dy < PLAYER_RADIUS + RESOURCE_NODE_RADIUS) return false;
      }
    }
    return true;
  }

  /** Create a building entity at (x, y). Returns the entity ID. */
  private spawnBuilding(
    x: number, y: number,
    buildingType: BuildingType,
    maxHp: number,
    permanent: boolean,
  ): number {
    const id = this.world.createEntity();
    this.world.addComponent(id, C.Position,  { x, y });
    this.world.addComponent(id, C.Velocity,  { vx: 0, vy: 0 });
    this.world.addComponent(id, C.Health,    { current: maxHp, max: maxHp });
    this.world.addComponent(id, C.Faction,   { type: 'building' });
    this.world.addComponent(id, C.Building,  { buildingType, permanent, upgradeLevel: 1 } as BuildingComponent);
    return id;
  }

  // ── Resource & Item spawning ───────────────────────────────────────────────

  /**
   * Populate the area around the spawn origin with biome-appropriate resource nodes.
   * Uses seeded deterministic RNG so all clients see the same world.
   */
  /**
   * Chunk-based resource generation - called each tick.
   * For each player, checks nearby chunks. Unprocessed chunks get resources
   * generated using a deterministic per-chunk PRNG. Already-processed chunks
   * are skipped permanently (resources persist, no re-spawning).
   */
  private generateResourcesNearPlayers(): void {
    const R = GameSession.RESOURCE_GEN_RADIUS;

    for (const player of this.players.values()) {
      if (!player.entityId) continue;
      const pos = this.world.getComponent<PositionComponent>(player.entityId, C.Position);
      if (!pos) continue;

      const pcx = Math.floor(pos.x / (TILE_SIZE * CHUNK_SIZE));
      const pcy = Math.floor(pos.y / (TILE_SIZE * CHUNK_SIZE));

      for (let cx = pcx - R; cx <= pcx + R; cx++) {
        for (let cy = pcy - R; cy <= pcy + R; cy++) {
          const key = `${cx},${cy}`;
          if (this.processedChunks.has(key)) continue;
          this.processedChunks.add(key);
          this.generateResourcesForChunk(cx, cy);
        }
      }
    }
  }

  /**
   * Generate resources for a single chunk using deterministic per-chunk seeding.
   * Same seed + chunk coords = same resources, regardless of when the chunk is visited.
   */
  private generateResourcesForChunk(cx: number, cy: number): void {
    // Deterministic seed per chunk: mix world seed with chunk coordinates
    let s = ((this.seed ^ (cx * 73856093) ^ (cy * 19349663)) >>> 0);
    const rand = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    let spawned = 0;
    const baseTx = cx * CHUNK_SIZE;
    const baseTy = cy * CHUNK_SIZE;

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        if (this.resourceNodeCount >= MAX_RESOURCE_NODES) return;

        const tx = baseTx + lx;
        const ty = baseTy + ly;
        const tileId = this.generator.getTile(tx, ty);

        const chance = TILE_SPAWN_CHANCE[tileId];
        if (!chance || rand() >= chance) continue;

        const entries = RESOURCE_SPAWN_TABLE[tileId];
        if (!entries || entries.length === 0) continue;

        // Weighted random selection
        const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
        let roll = rand() * totalWeight;
        let picked = entries[0].resourceType;
        for (const entry of entries) {
          roll -= entry.weight;
          if (roll <= 0) { picked = entry.resourceType; break; }
        }

        const wx = tx * TILE_SIZE + TILE_SIZE / 2;
        const wy = ty * TILE_SIZE + TILE_SIZE / 2;

        // Don't spawn resource nodes too close to the campfire/spawn origin
        const dxO = wx - this.spawnOrigin.x;
        const dyO = wy - this.spawnOrigin.y;
        if (dxO * dxO + dyO * dyO < 120 * 120) continue;

        this.spawnResourceNode(wx, wy, picked);
        spawned++;
      }
    }

    if (spawned > 0) {
      console.log(`[Resources] Chunk (${cx},${cy}): +${spawned} nodes (total: ${this.resourceNodeCount})`);
    }
  }

  private spawnResourceNode(x: number, y: number, type: ResourceType): number {
    const stats = RESOURCE_STATS[type];
    const id = this.world.createEntity();
    this.world.addComponent(id, C.Position,          { x, y });
    this.world.addComponent(id, C.Velocity,          { vx: 0, vy: 0 });
    this.world.addComponent(id, C.Health,            { current: stats.hp, max: stats.hp });
    this.world.addComponent(id, C.Faction,           { type: 'resource' });
    this.world.addComponent(id, C.ResourceNode,      { resourceType: type, yield: stats.yield });
    this.world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    this.resourceNodeCount++;
    return id;
  }

  private spawnItemDrop(
    x: number, y: number,
    itemType: string, quantity: number, autoPickup: boolean,
  ): number {
    const angle = Math.random() * Math.PI * 2;
    const id = this.world.createEntity();
    this.world.addComponent(id, C.Position, { x, y });
    this.world.addComponent(id, C.Velocity, {
      vx: Math.cos(angle) * ITEM_DROP_SCATTER_SPEED,
      vy: Math.sin(angle) * ITEM_DROP_SCATTER_SPEED,
    });
    this.world.addComponent(id, C.Health,   { current: 1, max: 1 }); // dummy for DELTA sync
    this.world.addComponent(id, C.Faction,  { type: 'item' });
    this.world.addComponent(id, C.ItemDrop, {
      itemType, quantity, autoPickup,
      lifetime: ITEM_DROP_LIFETIME,
    });
    return id;
  }

  private rollLootTable(tableId: string): { itemType: string; quantity: number; autoPickup: boolean }[] {
    const table = LOOT_TABLES[tableId];
    if (!table) return [];
    const drops: { itemType: string; quantity: number; autoPickup: boolean }[] = [];
    for (const entry of table.entries) {
      if (Math.random() < entry.chance) {
        const qty = entry.minQty + Math.floor(Math.random() * (entry.maxQty - entry.minQty + 1));
        drops.push({ itemType: entry.itemType, quantity: qty, autoPickup: entry.autoPickup });
      }
    }
    return drops;
  }

  private spawnLootDrops(deadEntityId: number): void {
    const pos = this.world.getComponent<PositionComponent>(deadEntityId, C.Position);
    if (!pos) return;
    const ev = this.world.getComponent<EnemyVariantComponent>(deadEntityId, C.EnemyVariant);
    const tableKey = ev?.variant && LOOT_TABLES[ev.variant] ? ev.variant : 'basic_enemy';
    const drops = this.rollLootTable(tableKey);
    for (const drop of drops) {
      this.spawnItemDrop(pos.x, pos.y, drop.itemType, drop.quantity, drop.autoPickup);
    }
  }

  /** Find the playerId (UUID) for a given entity ID. */

  /**
   * Credit a player's resource counter and send RESOURCE_UPDATE.
   */
  private creditResources(
    playerEntityId: number,
    itemType: string,
    quantity: number,
    send: (client: ConnectedClient, msg: object) => void,
  ): void {
    // Find the SessionPlayer for this entity
    let target: SessionPlayer | undefined;
    for (const p of this.players.values()) {
      if (p.entityId === playerEntityId) { target = p; break; }
    }
    if (!target) return;

    const res = this.world.getComponent<ResourcesComponent>(playerEntityId, C.Resources);
    if (!res) return;

    // Credit the resource
    if (itemType === 'wood') res.wood += quantity;
    else if (itemType === 'stone') res.stone += quantity;
    else if (itemType === 'iron') res.iron += quantity;
    else if (itemType === 'diamond') res.diamond += quantity;
    else if (itemType === 'gold') res.gold += quantity;
    else if (itemType === 'food') res.food += quantity;

    // Track for meta stats
    this.stats.trackResources(target.playerId, itemType, quantity);

    const update: ResourceUpdateMessage = {
      type: MessageType.RESOURCE_UPDATE,
      wood: res.wood,
      stone: res.stone,
      iron: res.iron,
      diamond: res.diamond,
      gold: res.gold,
      food: res.food,
    };
    send(target.client, update);
  }

  // ── Input handling ──────────────────────────────────────────────────────────

  applyInput(clientId: string, msg: InputMessage): void {
    if (this.paused) return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;

    const inp = this.world.getComponent<PlayerInputComponent>(
      player.entityId,
      C.PlayerInput,
    );
    if (!inp) return;

    // Downed or dead players cannot move - still acknowledge seq for reconciliation
    if (this.world.hasComponent(player.entityId, C.Downed) || this.respawnTimers.has(clientId)) {
      inp.dx = 0;
      inp.dy = 0;
      inp.sprint = false;
      const seq = Number(msg.seq);
      if (Number.isFinite(seq) && seq > player.lastSeq) player.lastSeq = seq;
      return;
    }

    // Validate and clamp movement to [-1, 1]
    const dx = Number(msg.dx);
    const dy = Number(msg.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    inp.dx = Math.max(-1, Math.min(1, dx));
    inp.dy = Math.max(-1, Math.min(1, dy));
    inp.sprint = msg.sprint === true;

    // Dodge roll
    if (msg.dodge) {
      const existingDodge = this.world.getComponent<DodgeRollComponent>(player.entityId!, C.DodgeRoll);
      if (!existingDodge || (existingDodge.timer <= 0 && existingDodge.cooldown <= 0)) {
        const dinp = this.world.getComponent<PlayerInputComponent>(player.entityId!, C.PlayerInput);
        let dvx = dinp?.dx ?? 0;
        let dvy = dinp?.dy ?? 0;
        const len = Math.sqrt(dvx * dvx + dvy * dvy);
        if (len > 0) { dvx /= len; dvy /= len; }
        else {
          const facing = this.world.getComponent<FacingComponent>(player.entityId!, C.Facing);
          dvx = Math.cos(facing?.angle ?? 0);
          dvy = Math.sin(facing?.angle ?? 0);
        }
        this.world.addComponent(player.entityId!, C.DodgeRoll, {
          timer: DODGE_ROLL_DURATION,
          duration: DODGE_ROLL_DURATION,
          dashVx: dvx,
          dashVy: dvy,
          cooldown: DODGE_ROLL_COOLDOWN,
        });
      }
    }

    const seq = Number(msg.seq);
    if (Number.isFinite(seq) && seq > player.lastSeq) player.lastSeq = seq;
  }

  // ── Attack handling ─────────────────────────────────────────────────────────

  /**
   * Called when a client sends an ATTACK message.
   * Dispatches to melee or ranged handler based on attackType.
   */
  handleAttack(
    clientId: string,
    msg: AttackMessage,
    send: (client: ConnectedClient, m: object) => void,
  ): void {
    if (this.phase !== 'playing' || this.paused) return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;
    if (this.world.hasComponent(player.entityId, C.Downed)) return;
    if (this.respawnTimers.has(clientId)) return;
    if (!Number.isFinite(msg.facing)) return;
    if (msg.attackType !== 'melee' && msg.attackType !== 'ranged') return;
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;

    // 4.13 Anti-exploit: validate facing angle
    if (msg.facing < -Math.PI || msg.facing > Math.PI) return;

    // 4.13 Anti-exploit: validate client position vs server position
    const serverPos = this.world.getComponent<PositionComponent>(player.entityId, C.Position);
    if (serverPos) {
      const adx = msg.x - serverPos.x;
      const ady = msg.y - serverPos.y;
      if (adx * adx + ady * ady > MAX_ATTACK_POSITION_TOLERANCE * MAX_ATTACK_POSITION_TOLERANCE) {
        msg = { ...msg, x: serverPos.x, y: serverPos.y };
      }
    }

    // Route by server-authoritative class, not client-sent attackType
    const classStats = CLASS_STATS[player.playerClass];
    if (classStats.attackType === 'ranged') {
      this.handleRangedAttack(player, msg.facing, send);
    } else {
      this.handleMeleeAttack(player, msg, send);
    }
  }

  // ── Building Placement (delegated to BuildingSystem) ─────────────────────────

  handleBuildPlace(clientId: string, msg: BuildPlaceMessage, send: SendFn): void {
    this.buildings.handlePlace(clientId, msg, send);
  }

  handleBuildDemolish(clientId: string, msg: BuildDemolishMessage, send: SendFn): void {
    this.buildings.handleDemolish(clientId, msg, send);
  }

  handleBuildUpgrade(clientId: string, msg: BuildUpgradeMessage, send: SendFn): void {
    this.buildings.handleUpgrade(clientId, msg, send);
  }

  handleBuildRepair(clientId: string, msg: BuildRepairMessage, send: SendFn): void {
    this.buildings.handleRepair(clientId, msg, send);
  }


  /**
   * Called when a client presses E to interact with a nearby non-auto-pickup item.
   */
  handleInteract(
    clientId: string,
    msg: InteractMessage,
    send: (client: ConnectedClient, m: object) => void,
  ): void {
    if (this.phase !== 'playing' || this.paused) return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;
    // Downed or dead players cannot interact
    if (this.world.hasComponent(player.entityId, C.Downed)) return;
    if (this.respawnTimers.has(clientId)) return;
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;

    const playerPos = this.world.getComponent<PositionComponent>(player.entityId, C.Position);
    if (!playerPos) return;

    // Check for nearby downed teammate (revive takes priority over item pickup)
    const revR2 = REVIVE_RANGE * REVIVE_RANGE;
    for (const downedId of this.world.query(C.Downed, C.Position)) {
      if (downedId === player.entityId) continue; // can't revive self
      const dpos = this.world.getComponent<PositionComponent>(downedId, C.Position)!;
      const rdx = dpos.x - playerPos.x;
      const rdy = dpos.y - playerPos.y;
      if (rdx * rdx + rdy * rdy <= revR2) {
        const downed = this.world.getComponent<DownedComponent>(downedId, C.Downed)!;
        if (downed.reviverId === player.entityId) {
          // Already reviving - pressing E again cancels
          downed.reviverId = -1;
          downed.reviveProgress = 0;
        } else {
          downed.reviverId = player.entityId;
          downed.reviveProgress = 0;
        }
        return; // Don't pick up items while initiating revive
      }
    }

    // Check for nearby production buildings with stored resources (F-key collection)
    // Use building half-extent + interact radius so you can collect from the edge
    for (const bid of this.world.query(C.Production, C.Position)) {
      const prod = this.world.getComponent<ProductionComponent>(bid, C.Production)!;
      if (prod.stored <= 0) continue;
      const bldg = this.world.getComponent<BuildingComponent>(bid, C.Building);
      const half = buildingHalfExtent(bldg?.buildingType ?? 'wall');
      const collectDist = half + ITEM_DROP_INTERACT_RADIUS;
      const bpos = this.world.getComponent<PositionComponent>(bid, C.Position)!;
      const bdx = bpos.x - playerPos.x;
      const bdy = bpos.y - playerPos.y;
      if (bdx * bdx + bdy * bdy <= collectDist * collectDist) {
        // Split between primary and secondary resource
        if (prod.secondaryResourceType && prod.secondaryChance) {
          let primary = 0, secondary = 0;
          for (let i = 0; i < prod.stored; i++) {
            if (Math.random() < prod.secondaryChance) secondary++;
            else primary++;
          }
          if (primary > 0) this.creditResources(player.entityId, prod.resourceType, primary, send);
          if (secondary > 0) this.creditResources(player.entityId, prod.secondaryResourceType, secondary, send);
        } else {
          this.creditResources(player.entityId, prod.resourceType, prod.stored, send);
        }
        prod.stored = 0;
        return;
      }
    }

    // Check for nearby potion shop (F-key opens shop overlay)
    for (const bid of this.world.query(C.Building, C.Position)) {
      const bldg = this.world.getComponent<BuildingComponent>(bid, C.Building);
      if (bldg?.buildingType !== 'potion_shop') continue;
      const bpos = this.world.getComponent<PositionComponent>(bid, C.Position)!;
      const half = buildingHalfExtent('potion_shop');
      const shopRange = half + ITEM_DROP_INTERACT_RADIUS;
      const sdx = bpos.x - playerPos.x;
      const sdy = bpos.y - playerPos.y;
      if (sdx * sdx + sdy * sdy <= shopRange * shopRange) {
        this.potions.handleShopOpen(clientId, bid, send);
        return;
      }
    }

    // Find nearest non-auto-pickup ItemDrop within interact radius
    const interactR2 = ITEM_DROP_INTERACT_RADIUS * ITEM_DROP_INTERACT_RADIUS;
    let bestId = -1;
    let bestDist = Infinity;

    for (const id of this.world.query(C.ItemDrop, C.Position)) {
      const drop = this.world.getComponent<ItemDropComponent>(id, C.ItemDrop)!;
      if (drop.autoPickup) continue;

      const dpos = this.world.getComponent<PositionComponent>(id, C.Position)!;
      const dx = dpos.x - playerPos.x;
      const dy = dpos.y - playerPos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= interactR2 && d2 < bestDist) {
        bestDist = d2;
        bestId = id;
      }
    }

    if (bestId < 0) return;

    const drop = this.world.getComponent<ItemDropComponent>(bestId, C.ItemDrop)!;
    this.creditResources(player.entityId, drop.itemType, drop.quantity, send);
    this.world.destroyEntity(bestId);
  }

  private handleMeleeAttack(
    player: SessionPlayer,
    msg: AttackMessage,
    send: (client: ConnectedClient, m: object) => void,
  ): void {
    const entityId = player.entityId!;

    // Pre-check cooldown so we don't broadcast a fake swing animation
    const cd = this.world.getComponent<AttackCooldownComponent>(entityId, C.AttackCooldown);
    if (cd && cd.remaining > TICK_MS / 1000) return;

    // Apply card + skill + potion damage multipliers using class base damage
    const pBuffs = this.cards.playerBuffs.get(player.client.id);
    const sBuffs = this.skills.getSkillBuffs(player.client.id);
    const ab = this.world.getComponent<import('@shared/components').ActiveBuffsComponent>(entityId, C.ActiveBuffs);
    const potionDmgBuff = ab?.buffs.find(b => b.id === 'potion_damage');
    const potionDmgMult = potionDmgBuff ? (1 + (potionDmgBuff.effect.damageMultiplier ?? 0)) : 1;
    const dmgMult = (pBuffs?.damageMultiplier ?? 1) * sBuffs.damageMultiplier * this.cards.debuffs.playerDamageMult * potionDmgMult;
    const classDmg = CLASS_STATS[player.playerClass].baseDamage;
    const meleeOverrides = dmgMult !== 1 ? { damage: Math.round(classDmg * dmgMult) } : { damage: classDmg };

    const { hits, deaths } = this.combat.processMeleeAttack(
      this.world,
      entityId,
      msg.facing,
      { x: msg.x, y: msg.y },
      meleeOverrides,
    );

    // Broadcast attack animation to all players (fires even on miss)
    const performed: AttackPerformedMessage = {
      type: MessageType.ATTACK_PERFORMED,
      sourceId: entityId,
      facing: msg.facing,
    };
    for (const p of this.players.values()) send(p.client, performed);

    // Broadcast each hit to all players + track damage for meta stats
    for (const hit of hits) {
      const hitMsg: HitMessage = { type: MessageType.HIT, ...hit };
      for (const p of this.players.values()) send(p.client, hitMsg);
      this.stats.trackDamage(hit.sourceId, hit.damage);
    }

    // Apply on-hit special effects (lifesteal, burn, slow)
    this.applyOnHitEffects(player.client.id, entityId, hits);

    // Build attacker map so destroyDeadEntities can credit resource harvesting
    const attackerMap = new Map<number, number>();
    for (const hit of hits) {
      if (!attackerMap.has(hit.targetId)) attackerMap.set(hit.targetId, hit.sourceId);
    }
    // Remove dead non-player entities; player death handled in 4.11
    this.respawn.destroyDeadEntities(deaths, attackerMap, send);
  }

  private handleRangedAttack(
    player: SessionPlayer,
    facing: number,
    send: (client: ConnectedClient, m: object) => void,
  ): void {
    const entityId = player.entityId!;

    // Enforce cooldown (one-tick tolerance for client/server timing drift)
    const cd = this.world.getComponent<AttackCooldownComponent>(entityId, C.AttackCooldown);
    if (cd && cd.remaining > TICK_MS / 1000) return;
    if (cd) cd.remaining = RANGED_COOLDOWN;

    const pos = this.world.getComponent<PositionComponent>(entityId, C.Position);
    if (!pos) return;

    const faction = this.world.getComponent<FactionComponent>(entityId, C.Faction);

    // Spawn projectile offset from player to avoid self-collision
    const dirX = Math.cos(facing);
    const dirY = Math.sin(facing);
    const offset = PLAYER_RADIUS + PROJECTILE_RADIUS + 2;
    const spawnX = pos.x + dirX * offset;
    const spawnY = pos.y + dirY * offset;
    const vx = dirX * RANGED_SPEED;
    const vy = dirY * RANGED_SPEED;

    const projId = this.world.createEntity();
    this.world.addComponent(projId, C.Position,   { x: spawnX, y: spawnY });
    this.world.addComponent(projId, C.Velocity,   { vx, vy });
    // Apply card + skill + potion damage multipliers using class base damage
    const rBuffs = this.cards.playerBuffs.get(player.client.id);
    const rSBuffs = this.skills.getSkillBuffs(player.client.id);
    const rAb = this.world.getComponent<import('@shared/components').ActiveBuffsComponent>(entityId, C.ActiveBuffs);
    const rPotionDmg = rAb?.buffs.find(b => b.id === 'potion_damage');
    const rPotionDmgMult = rPotionDmg ? (1 + (rPotionDmg.effect.damageMultiplier ?? 0)) : 1;
    const rDmgMult = (rBuffs?.damageMultiplier ?? 1) * rSBuffs.damageMultiplier * this.cards.debuffs.playerDamageMult * rPotionDmgMult;
    const rangedClassDmg = CLASS_STATS[player.playerClass].baseDamage;
    const projDamage = Math.round(rangedClassDmg * rDmgMult);
    const projData: ProjectileComponent = { ownerId: entityId, damage: projDamage, lifetime: RANGED_LIFETIME };
    if (player.playerClass === 'ranger') projData.pierce = true;
    if (player.playerClass === 'mage') projData.homing = true;
    this.world.addComponent(projId, C.Projectile, projData);
    this.world.addComponent(projId, C.Faction,    { type: faction?.type ?? 'player' });

    // Broadcast spawn to all clients
    const spawn: ProjectileSpawnMessage = {
      type: MessageType.PROJECTILE_SPAWN,
      projectileId: projId,
      x: spawnX,
      y: spawnY,
      vx,
      vy,
      ownerSlot: player.slot,
      pierce: projData.pierce || undefined,
      homing: projData.homing || undefined,
    };
    for (const p of this.players.values()) send(p.client, spawn);
  }


  // ── On-hit special effects (lifesteal, burn, slow) ─────────────────────────

  /**
   * Apply skill-based on-hit effects for a player's hits.
   * Called after melee attacks and projectile hits.
   */
  private applyOnHitEffects(
    clientId: string,
    attackerEntityId: number,
    hits: import('./systems/CombatSystem').HitResult[],
  ): void {
    if (hits.length === 0) return;
    const buffs = this.skills.getSkillBuffs(clientId);

    for (const hit of hits) {
      // Skip resource nodes and buildings — only apply effects to enemies
      const tgtFaction = this.world.getComponent<FactionComponent>(hit.targetId, C.Faction);
      if (!tgtFaction || tgtFaction.type !== 'enemy') continue;

      // Lifesteal: heal attacker by fraction of damage dealt
      if (buffs.lifesteal > 0) {
        const hp = this.world.getComponent<HealthComponent>(attackerEntityId, C.Health);
        if (hp) hp.current = Math.min(hp.max, hp.current + hit.damage * buffs.lifesteal);
      }

      // Burn DOT: attach/refresh BurnDot component on target
      if (buffs.burnDot > 0 && this.world.getComponent<HealthComponent>(hit.targetId, C.Health)) {
        const existing = this.world.getComponent<BurnDotComponent>(hit.targetId, C.BurnDot);
        if (existing) {
          existing.dps = Math.max(existing.dps, buffs.burnDot);
          existing.remaining = 3; // refresh duration
        } else {
          this.world.addComponent<BurnDotComponent>(hit.targetId, C.BurnDot, {
            dps: buffs.burnDot, remaining: 3, sourceId: attackerEntityId,
          });
        }
      }

      // Slow on hit: attach/refresh SlowEffect component on target
      if (buffs.slowOnHit > 0) {
        const existing = this.world.getComponent<SlowEffectComponent>(hit.targetId, C.SlowEffect);
        if (!existing) {
          // Apply slow by reducing speed multiplier
          const speed = this.world.getComponent<SpeedComponent>(hit.targetId, C.Speed);
          if (speed) speed.multiplier *= (1 - buffs.slowOnHit);
          this.world.addComponent<SlowEffectComponent>(hit.targetId, C.SlowEffect, {
            factor: buffs.slowOnHit, remaining: 2,
          });
        }
      }
    }
  }

  /**
   * Apply thorns damage when a player entity takes damage.
   * Called from the enemy attack path.
   */
  private applyThorns(
    targetClientId: string,
    _targetEntityId: number,
    attackerEntityId: number,
  ): void {
    const buffs = this.skills.getSkillBuffs(targetClientId);
    if (buffs.thornsDamage <= 0) return;

    const hp = this.world.getComponent<HealthComponent>(attackerEntityId, C.Health);
    if (hp) {
      hp.current = Math.max(0, hp.current - buffs.thornsDamage);
    }
  }

  /** Fire onRunEnd with per-player RunStats. Called once at game over. */
  private fireRunEnd(): void {
    if (!this.onRunEnd) return;
    this.onRunEnd(this.stats.buildRunStats());
    this.onSaveDelete?.();
  }

  // ── Card system ────────────────────────────────────────────────────────────

  /** Send card offers to all players and start the auto-pick timer. */
  private sendCardOffers(send: SendFn): void {
    this.cardDispenser.sendOffers(send);
  }

  handleCardPick(clientId: string, msg: CardPickMessage, send: SendFn): void {
    this.cardDispenser.handlePick(clientId, msg, send);
  }

  // ── Skill system ────────────────────────────────────────────────────────────

  handleSkillAllocate(clientId: string, msg: SkillAllocateMessage, send: SendFn): void {
    if (this.phase !== 'playing') return;
    this.skills.handleAllocate(clientId, msg.nodeId, send);
  }

  handleAbilityUse(clientId: string, msg: AbilityUseMessage, send: SendFn): void {
    if (this.phase !== 'playing' || this.paused) return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;
    if (this.world.hasComponent(player.entityId, C.Downed)) return;
    if (this.respawnTimers.has(clientId)) return;

    const { hits, deaths } = this.skills.handleAbilityUse(clientId, msg, send);

    // Broadcast hits + handle deaths (same pattern as melee/ranged)
    for (const hit of hits) {
      const hitMsg: HitMessage = { type: MessageType.HIT, ...hit };
      for (const p of this.players.values()) send(p.client, hitMsg);
      this.stats.trackDamage(hit.sourceId, hit.damage);
    }
    const attackerMap = new Map<number, number>();
    for (const hit of hits) {
      if (!attackerMap.has(hit.targetId)) attackerMap.set(hit.targetId, hit.sourceId);
    }
    this.respawn.destroyDeadEntities(deaths, attackerMap, send);
  }

  // ── Potion handlers ──────────────────────────────────────────────────────────

  handlePotionUnlock(clientId: string, msg: import('@shared/protocol').PotionUnlockMessage, send: SendFn): void {
    this.potions.handleUnlock(clientId, msg, send);
  }

  handlePotionEquip(clientId: string, msg: import('@shared/protocol').PotionEquipMessage, send: SendFn): void {
    this.potions.handleEquip(clientId, msg, send);
  }

  handlePotionRestock(clientId: string, msg: import('@shared/protocol').PotionRestockMessage, send: SendFn): void {
    this.potions.handleRestock(clientId, msg, send);
  }

  handlePotionUse(clientId: string, send: SendFn): void {
    if (this.phase !== 'playing' || this.paused) return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;
    if (this.world.hasComponent(player.entityId, C.Downed)) return;
    if (this.respawnTimers.has(clientId)) return;
    this.potions.handleUse(clientId, send);
  }

  /** Called by WaveController when a wave is cleared. */
  private onWaveCleared(wave: number, send: SendFn): void {
    // Grant 1 skill point to every alive player
    for (const p of this.players.values()) {
      if (p.entityId != null) this.skills.grantSkillPoint(p.client.id, send);
    }
    // Card offers every 3 waves (after wave 3, 6, 9...)
    if (wave >= 3 && wave % 3 === 0) {
      this.sendCardOffers(send);
    }
    // Auto-save after wave clear
    if (this.onSave) {
      const saveData = this.serializeSave();
      this.onSave(saveData);
      const savedMsg: import('@shared/protocol').GameSavedMessage = {
        type: MessageType.GAME_SAVED,
        wave: saveData.currentWave,
        slot: this.saveSlot,
      };
      for (const p of this.players.values()) send(p.client, savedMsg);
    }
  }

  // ── Save system ──────────────────────────────────────────────────────────────

  /** Trigger an immediate save (called on host leave, pause, etc.). */
  saveNow(send?: SendFn): void {
    if (this.phase !== 'playing' || this.gameOver || !this.onSave) return;
    // Clear all item drops before saving (they don't persist across sessions)
    for (const id of this.world.query(C.ItemDrop)) {
      this.world.destroyEntity(id);
    }
    const saveData = this.serializeSave();
    this.onSave(saveData);
    console.log(`[GameSession] Manual save: wave ${saveData.currentWave}, ${saveData.buildings.length} buildings`);
    if (send) {
      const savedMsg: import('@shared/protocol').GameSavedMessage = {
        type: MessageType.GAME_SAVED,
        wave: saveData.currentWave,
        slot: this.saveSlot,
      };
      for (const p of this.players.values()) send(p.client, savedMsg);
    }
  }

  serializeSave(): import('@shared/SaveFormat').SaveData {
    const data = this.saveManager.serialize();
    // Inject skill + card data into saved players
    for (const sp of data.players) {
      for (const p of this.players.values()) {
        if (p.playerId === sp.playerId) {
          const sd = this.skills.serialize(p.client.id);
          sp.skillNodes = sd.skillNodes;
          sp.skillPoints = sd.skillPoints;
          const cd = this.cards.serialize(p.client.id);
          sp.cardBuffs = cd.buffs;
          sp.pickedCards = cd.pickedCards;
          sp.potionState = this.potions.serialize(p.client.id);
          break;
        }
      }
    }
    // Save session-wide card debuffs
    data.cardDebuffs = { ...this.cards.debuffs };
    return data;
  }

  /** Load a save into the session. Called after construction but before start(). */
  loadSave(save: import('@shared/SaveFormat').SaveData, _send: SendFn): boolean {
    const loaded = this.saveManager.load(save);
    if (!loaded) {
      console.warn('[GameSession] Invalid save data — starting fresh');
      return false;
    }
    console.log(`[GameSession] Loading save: wave ${save.currentWave}, ${save.buildings.length} buildings, ${save.players.length} players`);
    this.enemiesKilled = save.enemiesKilled;
    // Restore session-wide card debuffs
    if (save.cardDebuffs) {
      this.cards.restoreDebuffs(save.cardDebuffs);
    }
    this.loadedSave = loaded;
    return true;
  }

  /** Stored save data for deferred restoration (applied during start()). */
  private loadedSave: LoadedSaveState | null = null;

  // ── Debug ───────────────────────────────────────────────────────────────────

  /** Spawns `count` enemies (max 20) in a ring around the requesting player. */
  debugSpawnEnemies(clientId: string, count = 5): void {
    if (this.phase !== 'playing') return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;

    const pos = this.world.getComponent<PositionComponent>(player.entityId, C.Position);
    if (!pos) return;

    const n = Math.min(Math.max(1, count), 20);
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const dist  = 150 + Math.random() * 100;
      const ex = pos.x + Math.cos(angle) * dist;
      const ey = pos.y + Math.sin(angle) * dist;
      if (!this.isWalkable(ex, ey) || this.overlapsBuilding(ex, ey, ENEMY_RADIUS)) continue;

      this.waves.spawnEnemy(ex, ey);
      spawned++;
    }
    console.log(`[Debug] Spawned ${spawned}/${n} enemies around player ${player.slot}`);
  }

  debugWaveSkip(send: (client: ConnectedClient, msg: object) => void): void {
    if (this.phase !== 'playing') return;
    this.waves.debugSkip(send);
  }

  debugWavePause(send: (client: ConnectedClient, msg: object) => void): void {
    if (this.phase !== 'playing') return;
    this.waves.debugPause(send);
  }

  debugGiveResources(clientId: string, send: (client: ConnectedClient, msg: object) => void): void {
    if (this.phase !== 'playing') return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;
    const amount = 100;
    for (const res of ['wood', 'stone', 'iron', 'diamond', 'gold', 'food'] as const) {
      this.creditResources(player.entityId, res, amount, send);
    }
    console.log(`[Debug] Gave +${amount} of all resources to ${clientId}`);
  }

  debugGiveCard(clientId: string, cardId: string, send: SendFn): void {
    if (this.phase !== 'playing') return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;

    const card = CARD_POOL.find(c => c.id === cardId);
    if (!card) {
      console.log(`[Debug] Unknown card ID: ${cardId}`);
      return;
    }

    // Directly apply the card effect (bypasses offer/pick flow)
    this.cards.getBuffs(clientId); // ensure buffs exist
    // Manually apply effect
    const effect = card.effect;
    const buffs = this.cards.getBuffs(clientId);
    switch (effect.type) {
      case 'stat_buff':
        switch (effect.stat) {
          case 'damage':  buffs.damageMultiplier *= (1 + effect.value); break;
          case 'speed':   buffs.speedMultiplier *= (1 + effect.value); break;
          case 'maxHp':   buffs.maxHpBonus += effect.value; break;
          case 'hpRegen': buffs.hpRegen += effect.value; break;
        }
        break;
      case 'ability':
        if (!buffs.abilities.includes(effect.ability)) buffs.abilities.push(effect.ability);
        break;
      case 'resource':
        this.creditResources(player.entityId, effect.resource, effect.amount, send);
        break;
    }

    // Sync abilities to client
    send(player.client, {
      type: MessageType.CARD_SYNC,
      abilities: buffs.abilities,
      pickedCardIds: [...this.cards.pickedCardIds, cardId],
    });

    // Broadcast pick to chat
    const applied: import('@shared/protocol').CardAppliedMessage = {
      type: MessageType.CARD_APPLIED,
      displayName: player.displayName,
      cardId: card.id,
      cardName: card.name,
      category: card.category,
      isTrap: false,
      abilities: [...buffs.abilities],
    };
    for (const p of this.players.values()) send(p.client, applied);
    console.log(`[Debug] Gave card "${card.name}" to ${player.displayName}`);
  }

  debugGiveSkillPoints(clientId: string, count: number, send: SendFn): void {
    if (this.phase !== 'playing') return;
    const player = this.players.get(clientId);
    if (!player) return;
    const n = Math.min(Math.max(1, count), 50);
    for (let i = 0; i < n; i++) {
      this.skills.grantSkillPoint(clientId, send);
    }
    console.log(`[Debug] Gave ${n} skill point(s) to ${player.displayName}`);
  }


  // ── Pause voting ──────────────────────────────────────────────────────────

  /**
   * Called when a client sends PAUSE_VOTE.
   * Solo (1 player): instant toggle.
   * Multiplayer: tracks votes, flips state when all players have voted.
   */
  handlePauseVote(
    clientId: string,
    send: (client: ConnectedClient, msg: object) => void,
  ): void {
    if (this.phase !== 'playing') return;
    const player = this.players.get(clientId);
    if (!player) return;

    // Solo: instant toggle
    if (this.players.size === 1) {
      this.setPaused(!this.paused);
      this.pauseVotes.clear();
      const stateMsg: PauseStateMessage = {
        type: MessageType.PAUSE_STATE,
        paused: this.paused,
        elapsedTime: this.getElapsedSeconds(),
      };
      send(player.client, stateMsg);
      return;
    }

    // Toggle vote: pressing ESC again before the vote completes un-votes
    if (this.pauseVotes.has(clientId)) {
      this.pauseVotes.delete(clientId);
    } else {
      this.pauseVotes.add(clientId);
    }

    // Check if all players have voted
    if (this.pauseVotes.size >= this.players.size) {
      this.setPaused(!this.paused);
      this.pauseVotes.clear();
      const stateMsg: PauseStateMessage = {
        type: MessageType.PAUSE_STATE,
        paused: this.paused,
        elapsedTime: this.getElapsedSeconds(),
      };
      for (const p of this.players.values()) send(p.client, stateMsg);
    } else {
      this.broadcastVoteTally(send);
    }
  }

  /**
   * Called after a player is removed to re-evaluate pause vote state.
   * Handles: auto-resume when ≤1 player left, vote completion when holdout leaves.
   */
  recheckPauseVotes(
    send: (client: ConnectedClient, msg: object) => void,
  ): void {
    if (this.phase !== 'playing') return;
    if (this.players.size === 0) return;

    // If only 1 player remains while paused, auto-resume
    if (this.paused && this.players.size <= 1) {
      this.setPaused(false);
      this.pauseVotes.clear();
      const stateMsg: PauseStateMessage = {
        type: MessageType.PAUSE_STATE,
        paused: false,
        elapsedTime: this.getElapsedSeconds(),
      };
      for (const p of this.players.values()) send(p.client, stateMsg);
      return;
    }

    // If pending votes now satisfy threshold (removed player was the holdout)
    if (this.pauseVotes.size > 0 && this.pauseVotes.size >= this.players.size) {
      this.setPaused(!this.paused);
      this.pauseVotes.clear();
      const stateMsg: PauseStateMessage = {
        type: MessageType.PAUSE_STATE,
        paused: this.paused,
        elapsedTime: this.getElapsedSeconds(),
      };
      for (const p of this.players.values()) send(p.client, stateMsg);
      return;
    }

    // If there are still pending votes, broadcast updated tally
    if (this.pauseVotes.size > 0) {
      this.broadcastVoteTally(send);
    }
  }

  private broadcastVoteTally(
    send: (client: ConnectedClient, msg: object) => void,
  ): void {
    const direction = this.paused ? 'resume' : 'pause';
    const voters = [...this.pauseVotes]
      .map((id) => this.players.get(id)?.displayName ?? '???');
    const update: PauseVoteUpdateMessage = {
      type: MessageType.PAUSE_VOTE_UPDATE,
      direction,
      voters,
      required: this.players.size,
    };
    for (const p of this.players.values()) send(p.client, update);
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  /**
   * Called once per server tick while playing.
   * Runs systems and broadcasts DELTA to all clients.
   */
  tick_(dt: number, send: (client: ConnectedClient, msg: object) => void): void {
    if (this.phase !== 'playing') return;

    // Card timer must tick even while paused (card selection pauses the game)
    this.cardDispenser.tickTimer(dt, send);

    if (this.paused) return;
    this.tick++;

    // Spawn resources near players (chunk-based, processed chunks are skipped)
    this.generateResourcesNearPlayers();

    const _t0 = performance.now();
    this.combat.update(this.world, dt);
    const _t1 = performance.now();
    const enemyResult = this.enemy.update(this.world, dt);
    const _t2 = performance.now();
    this.movement.update(this.world, dt);
    const _t3 = performance.now();

    // Tick dodge roll timers
    for (const id of this.world.query(C.DodgeRoll)) {
      const dr = this.world.getComponent<DodgeRollComponent>(id, C.DodgeRoll)!;
      if (dr.timer > 0) dr.timer = Math.max(0, dr.timer - dt);
      if (dr.cooldown > 0) dr.cooldown = Math.max(0, dr.cooldown - dt);
    }

    // Broadcast enemy attack animations
    for (const ap of enemyResult.attackPerformed) {
      const performed: AttackPerformedMessage = {
        type: MessageType.ATTACK_PERFORMED,
        sourceId: ap.sourceId,
        facing: ap.facing,
      };
      for (const p of this.players.values()) send(p.client, performed);
    }

    // Broadcast enemy hit results + apply thorns
    for (const hit of enemyResult.hits) {
      const hitMsg: HitMessage = { type: MessageType.HIT, ...hit };
      for (const p of this.players.values()) send(p.client, hitMsg);
    }
    // Thorns: if an enemy hit a player with thorns, reflect damage back
    for (const hit of enemyResult.hits) {
      for (const p of this.players.values()) {
        if (p.entityId === hit.targetId) {
          this.applyThorns(p.client.id, p.entityId, hit.sourceId);
          break;
        }
      }
    }

    // Spawn ranged enemy projectiles (uses per-entity stats from EnemySystem)
    for (const ra of enemyResult.rangedAttacks) {
      const dirX = Math.cos(ra.facing);
      const dirY = Math.sin(ra.facing);
      const offset = ra.radius + PROJECTILE_RADIUS + 2;
      const spawnX = ra.x + dirX * offset;
      const spawnY = ra.y + dirY * offset;
      const vx = dirX * ra.projectileSpeed;
      const vy = dirY * ra.projectileSpeed;

      const projId = this.world.createEntity();
      this.world.addComponent(projId, C.Position,   { x: spawnX, y: spawnY });
      this.world.addComponent(projId, C.Velocity,   { vx, vy });
      this.world.addComponent(projId, C.Projectile, { ownerId: ra.sourceId, damage: ra.damage, lifetime: RANGED_LIFETIME });
      this.world.addComponent(projId, C.Faction,    { type: 'enemy' });

      const spawn: ProjectileSpawnMessage = {
        type: MessageType.PROJECTILE_SPAWN,
        projectileId: projId,
        x: spawnX, y: spawnY, vx, vy,
        ownerSlot: -2, // ranger enemy indicator for client rendering
      };
      for (const p of this.players.values()) send(p.client, spawn);
    }

    // Destroy dead entities (players enter downed state, others are removed)
    this.respawn.destroyDeadEntities(enemyResult.deaths, undefined, send);

    // Projectile movement, collision, and cleanup
    const _t4 = performance.now();
    const projResult = this.projectile.update(this.world, dt);
    const _t5 = performance.now();

    for (const hit of projResult.hits) {
      const hitMsg: HitMessage = { type: MessageType.HIT, ...hit };
      for (const p of this.players.values()) send(p.client, hitMsg);
      this.stats.trackDamage(hit.sourceId, hit.damage);
    }

    // Apply on-hit effects for player-owned projectile hits
    for (const p of this.players.values()) {
      if (p.entityId === null) continue;
      const playerHits = projResult.hits.filter(h => h.sourceId === p.entityId);
      if (playerHits.length > 0) this.applyOnHitEffects(p.client.id, p.entityId, playerHits);
    }

    for (const projId of projResult.destroyed) {
      const removeMsg: ProjectileRemoveMessage = {
        type: MessageType.PROJECTILE_REMOVE,
        projectileId: projId,
      };
      for (const p of this.players.values()) send(p.client, removeMsg);
      this.world.destroyEntity(projId);
    }

    // Broadcast AOE explosions to clients
    for (const aoe of projResult.aoeExplosions) {
      const aoeMsg: AoeExplosionMessage = { type: MessageType.AOE_EXPLOSION, x: aoe.x, y: aoe.y, radius: aoe.radius };
      for (const p of this.players.values()) send(p.client, aoeMsg);
    }

    // Build attacker map for projectile kills (sourceId = projectile owner)
    const projAttackerMap = new Map<number, number>();
    for (const hit of projResult.hits) {
      if (!projAttackerMap.has(hit.targetId)) projAttackerMap.set(hit.targetId, hit.sourceId);
    }
    // Destroy dead non-player entities hit by projectiles
    this.respawn.destroyDeadEntities(projResult.deaths, projAttackerMap, send);

    // ── Item drop system (lifetime, scatter, auto-pickup) ──────────────────────
    const dropResult = this.itemDrop.update(this.world, dt, this.playerEntityIds);
    for (const pickup of dropResult.pickups) {
      this.creditResources(pickup.playerId, pickup.itemType, pickup.quantity, send);
      this.world.destroyEntity(pickup.dropId);
    }
    for (const expiredId of dropResult.expired) {
      this.world.destroyEntity(expiredId);
    }

    // ── Death & Respawn (4.11) ──────────────────────────────────────────────
    if (!this.gameOver) {
      this.respawn.tickDownedPlayers(dt, send);
      this.respawn.tickRespawnTimers(dt, send);
    }

    // ── Buildings (warehouse, production, turrets, traps, shrines, barracks) ──
    const _t6 = performance.now();
    if (!this.gameOver) this.buildings.tick(dt, send);
    const _t7 = performance.now();

    // ── Card system ──────────────────────────────────────────────────────────
    this.cardDispenser.tickHpRegen(dt);

    // ── Skill system (cooldowns, buffs, DOTs) ────────────────────────────────
    if (!this.gameOver) this.skills.tick(dt);

    // ── Potion system (cooldowns, buff expiry) ──────────────────────────────
    if (!this.gameOver) this.potions.tick(dt, send);

    // ── Wave state machine ────────────────────────────────────────────────────
    const _t8 = performance.now();
    if (!this.gameOver) this.waves.tick(dt, send);
    const _t9 = performance.now();

    // ── Update tick profiling (exponential moving average) ──────────────────
    const _a = 0.1;
    this.tickProfile.combat     = this.tickProfile.combat     * (1 - _a) + (_t1 - _t0) * _a;
    this.tickProfile.enemy      = this.tickProfile.enemy      * (1 - _a) + (_t2 - _t1) * _a;
    this.tickProfile.movement   = this.tickProfile.movement   * (1 - _a) + (_t3 - _t2) * _a;
    this.tickProfile.projectile = this.tickProfile.projectile * (1 - _a) + (_t5 - _t4) * _a;
    this.tickProfile.buildings  = this.tickProfile.buildings  * (1 - _a) + (_t7 - _t6) * _a;
    this.tickProfile.waves      = this.tickProfile.waves      * (1 - _a) + (_t9 - _t8) * _a;
    this.tickProfile.total      = this.tickProfile.total      * (1 - _a) + (_t9 - _t0) * _a;

    // ── Flush pending enemy intro messages ──────────────────────────────────
    for (const intro of this.waveState.pendingIntros) {
      const msg = { type: MessageType.ENEMY_INTRO, variant: intro.variant, displayName: intro.displayName };
      for (const p of this.players.values()) send(p.client, msg);
    }
    this.waveState.pendingIntros.length = 0;

    const delta = this.buildDelta();
    for (const p of this.players.values()) {
      delta.lastSeq = p.lastSeq;
      send(p.client, delta);
    }

    // prevSnapshot is now updated inline by buildDelta()
  }

  // ── Snapshot / Delta builders ────────────────────────────────────────────────

  private buildFullSnapshot(): SnapshotMessage {
    const entities = this.gatherEntitySnapshots();
    return { type: MessageType.SNAPSHOT, tick: this.tick, entities };
  }

  private buildDelta(): DeltaMessage {
    const current = this.gatherEntitySnapshots();
    const changed: EntitySnapshot[] = [];
    const removed: number[] = [];
    const currentIds = new Set<number>();

    for (const snap of current) {
      currentIds.add(snap.entityId);
      const prev = this.prevSnapshot.get(snap.entityId);
      if (!prev || this.entityChanged(prev, snap)) changed.push(snap);
    }

    for (const id of this.prevSnapshot.keys()) {
      if (!currentIds.has(id)) removed.push(id);
    }

    // Reuse `current` for prevSnapshot update (avoids second gatherEntitySnapshots call)
    this.prevSnapshot.clear();
    for (const snap of current) {
      this.prevSnapshot.set(snap.entityId, snap);
    }

    // Count active portals for debug console
    let portalCount = 0;
    for (const _ of this.world.query(C.Portal, C.Health)) portalCount++;

    return {
      type: MessageType.DELTA,
      tick: this.tick,
      entities: changed,
      removed,
      lastSeq: 0,
      serverStats: {
        wave: this.waveState.currentWave,
        enemyCount: this.waveState.enemyCount,
        portalCount,
        playerCount: this.players.size,
        tickProfile: {
          combat:     +this.tickProfile.combat.toFixed(2),
          enemy:      +this.tickProfile.enemy.toFixed(2),
          movement:   +this.tickProfile.movement.toFixed(2),
          projectile: +this.tickProfile.projectile.toFixed(2),
          buildings:  +this.tickProfile.buildings.toFixed(2),
          waves:      +this.tickProfile.waves.toFixed(2),
          total:      +this.tickProfile.total.toFixed(2),
        },
      },
    };
  }

  /** Build a reverse map of entityId → SessionPlayer (O(P), avoids O(N*P) lookups). */
  private buildEntityToPlayerMap(): Map<number, SessionPlayer> {
    const map = new Map<number, SessionPlayer>();
    for (const p of this.players.values()) {
      if (p.entityId !== null) map.set(p.entityId, p);
    }
    return map;
  }

  private gatherEntitySnapshots(): EntitySnapshot[] {
    const entityToPlayer = this.buildEntityToPlayerMap();
    const snaps: EntitySnapshot[] = [];

    for (const id of this.world.query(C.Position, C.Velocity, C.Health)) {
      const pos = this.world.getComponent<PositionComponent>(id, C.Position)!;
      const vel = this.world.getComponent<VelocityComponent>(id, C.Velocity)!;
      const hp  = this.world.getComponent<HealthComponent>(id, C.Health)!;

      const playerEntry = entityToPlayer.get(id);
      const factionComp = this.world.getComponent<FactionComponent>(id, C.Faction);
      const faction = factionComp?.type ?? (playerEntry ? 'player' : 'enemy');

      const snap: EntitySnapshot = {
        entityId: id,
        slot: playerEntry?.slot,
        faction,
        x: pos.x,
        y: pos.y,
        vx: vel.vx,
        vy: vel.vy,
        hp: hp.current,
        maxHp: hp.max,
      };

      // Resource node metadata
      const rn = this.world.getComponent<ResourceNodeComponent>(id, C.ResourceNode);
      if (rn) snap.resourceType = rn.resourceType;

      // Item drop metadata
      const drop = this.world.getComponent<ItemDropComponent>(id, C.ItemDrop);
      if (drop) {
        snap.itemType = drop.itemType;
        snap.itemQuantity = drop.quantity;
      }

      // Building metadata
      const bldg = this.world.getComponent<BuildingComponent>(id, C.Building);
      if (bldg) {
        snap.buildingType = bldg.buildingType;
        snap.upgradeLevel = bldg.upgradeLevel;
      }

      // Production building stored resources
      const prod = this.world.getComponent<ProductionComponent>(id, C.Production);
      if (prod) {
        snap.productionStored = prod.stored;
        snap.productionMax = prod.maxStored;
        snap.productionResource = prod.resourceType;
      }

      // Enemy variant + ghost/radius/faction info
      const ev = this.world.getComponent<EnemyVariantComponent>(id, C.EnemyVariant);
      if (ev) {
        snap.enemyVariant = ev.variant;
        if (factionComp?.enemyFaction) snap.enemyFaction = factionComp.enemyFaction;
        // Ghost visibility
        const ghost = this.world.getComponent<import('@shared/components').GhostStateComponent>(id, C.GhostState);
        if (ghost) snap.ghostHidden = ghost.hidden;
        // Non-default radius (e.g. giant)
        const eStats = this.world.getComponent<import('@shared/components').EnemyStatsComponent>(id, C.EnemyStats);
        if (eStats && eStats.radius !== 10) snap.enemyRadius = eStats.radius;
      }

      // Dodge roll state
      const dodgeRoll = this.world.getComponent<DodgeRollComponent>(id, C.DodgeRoll);
      if (dodgeRoll && dodgeRoll.timer > 0) snap.dodging = true;

      // Downed state
      if (this.world.hasComponent(id, C.Downed)) snap.downed = true;

      // Player class
      if (playerEntry) snap.playerClass = playerEntry.playerClass;

      snaps.push(snap);
    }
    return snaps;
  }

  private entityChanged(prev: EntitySnapshot, curr: EntitySnapshot): boolean {
    return (
      prev.x !== curr.x || prev.y !== curr.y ||
      prev.vx !== curr.vx || prev.vy !== curr.vy ||
      prev.hp !== curr.hp ||
      prev.downed !== curr.downed ||
      prev.dodging !== curr.dodging ||
      prev.resourceType !== curr.resourceType ||
      prev.itemType !== curr.itemType ||
      prev.buildingType !== curr.buildingType ||
      prev.upgradeLevel !== curr.upgradeLevel ||
      prev.productionStored !== curr.productionStored ||
      prev.ghostHidden !== curr.ghostHidden ||
      prev.enemyRadius !== curr.enemyRadius
    );
  }

}
