import { World } from '@shared/ecs/World';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import { spawnPlayer, findSpawnPoint } from '@shared/world/PlayerSpawner';
import {
  C,
  PositionComponent,
  VelocityComponent,
  HealthComponent,
  PlayerInputComponent,
  AttackCooldownComponent,
  FactionComponent,
  PortalComponent,
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
} from '@shared/components';
import type { ResourceType, BuildingType, EnemyVariantType } from '@shared/components';
import {
  TILE_SIZE,
  PLAYER_RADIUS,
  PLAYER_MAX_HEALTH,
  ENEMY_BASE_SPEED,
  ENEMY_MAX_HEALTH,
  ENEMY_MELEE_COOLDOWN,
  RANGED_DAMAGE,
  RANGED_COOLDOWN,
  RANGED_SPEED,
  RANGED_LIFETIME,
  PROJECTILE_RADIUS,
  WAVE_PREP_INITIAL,
  WAVE_PREP_BETWEEN,
  PORTAL_BASE_HP,
  PORTAL_HP_PER_WAVE,
  PORTAL_BASE_SPAWN_INTERVAL,
  PORTAL_SPAWN_INTERVAL_DECAY,
  PORTALS_PER_WAVE_BASE,
  PORTALS_PER_WAVE_GROWTH,
  PORTAL_MIN_DIST,
  PORTAL_MAX_DIST,
  PORTAL_MIN_SPACING,
  CHUNK_SIZE,
  MAX_RESOURCE_NODES,
  ITEM_DROP_LIFETIME,
  ITEM_DROP_SCATTER_SPEED,
  ITEM_DROP_INTERACT_RADIUS,
  DOWNED_BLEED_TIME,
  REVIVE_DURATION,
  REVIVE_HP_PERCENT,
  RESPAWN_DELAY,
  REVIVE_RANGE,
  WIPE_1_RESOURCE_LOSS_PERCENT,
  MAX_ATTACK_POSITION_TOLERANCE,
  TICK_MS,
  CAMPFIRE_MAX_HEALTH,
  WALL_MAX_HEALTH,
  WALL_COST_WOOD,
  RESOURCE_NODE_RADIUS,
  WAREHOUSE_MAX_HEALTH,
  LUMBERMILL_MAX_HEALTH,
  QUARRY_MAX_HEALTH,
  MINE_MAX_HEALTH,
  FARM_MAX_HEALTH,
  WAREHOUSE_DEPOSIT_RADIUS,
  DEMOLISH_REFUND_PERCENT,
  BUILDING_COSTS,
  BUILDING_SIZES,
  buildingHalfExtent,
  snapBuildingPosition,
  ARROW_TURRET_MAX_HEALTH,
  CANNON_TURRET_MAX_HEALTH,
  SPIKE_TRAP_MAX_HEALTH,
  BRIDGE_MAX_HEALTH,
  LUMBERMILL_PRODUCTION_INTERVAL,
  QUARRY_PRODUCTION_INTERVAL,
  MINE_PRODUCTION_INTERVAL,
  FARM_PRODUCTION_INTERVAL,
  PRODUCTION_AMOUNT,
  PRODUCTION_MAX_STORED,
  ARROW_TURRET_RANGE,
  ARROW_TURRET_COOLDOWN,
  ARROW_TURRET_DAMAGE,
  ARROW_TURRET_PROJ_SPEED,
  CANNON_TURRET_RANGE,
  CANNON_TURRET_COOLDOWN,
  CANNON_TURRET_DAMAGE,
  CANNON_TURRET_PROJ_SPEED,
  SPIKE_TRAP_DAMAGE,
  SPIKE_TRAP_COOLDOWN,
  SPIKE_TRAP_SELF_DAMAGE,
  ENEMY_RADIUS,
  ENEMY_RANGER_SPAWN_CHANCE,
  ENEMY_RANGER_RANGE,
  ENEMY_RANGER_COOLDOWN,
  ENEMY_RANGER_DAMAGE,
  ENEMY_RANGER_PROJECTILE_SPEED,
  ENEMY_RANGER_SPEED,
  ENEMY_RANGER_HEALTH,
  BUILDING_MAX_LEVEL,
  UPGRADE_HP_MULT,
  UPGRADE_PROD_INTERVAL,
  UPGRADE_PROD_MAX,
  UPGRADE_ARROW_CD,
  UPGRADE_ARROW_DMG,
  UPGRADE_CANNON_CD,
  UPGRADE_CANNON_DMG,
  UPGRADE_CANNON_AOE,
  UPGRADE_TRAP_DMG,
  CANNON_AOE_BASE_RADIUS,
  getUpgradeCost,
  getRepairCost,
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
  WaveEndMessage,
  WaveTimerSyncMessage,
  ResourceUpdateMessage,
  InteractMessage,
  PlayerDownedMessage,
  ReviveProgressMessage,
  PlayerRevivedMessage,
  PlayerDiedMessage,
  PlayerRespawnedMessage,
  PartyWipeMessage,
  GameOverMessage,
  BuildPlaceMessage,
  BuildConfirmMessage,
  BuildDestroyedMessage,
  CampfireDestroyedMessage,
  BuildDemolishMessage,
  BuildUpgradeMessage,
  BuildUpgradeConfirmMessage,
  BuildRepairMessage,
  BuildRepairConfirmMessage,
  AoeExplosionMessage,
  WarehouseUpdateMessage,
} from '@shared/protocol';
import { ItemDropSystem, PickupResult } from './systems/ItemDropSystem';
import type { ConnectedClient } from './net/ServerSocket';
import { MovementSystem } from './systems/MovementSystem';
import { EnemySystem } from './systems/EnemySystem';
import { CombatSystem } from './systems/CombatSystem';
import { ProjectileSystem } from './systems/ProjectileSystem';
import { PortalSystem } from './systems/PortalSystem';

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
}

export type SessionPhase = 'lobby' | 'playing';

/** Shorthand for the send callback used throughout GameSession. */
type SendFn = (client: ConnectedClient, msg: object) => void;

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

  private players = new Map<string, SessionPlayer>(); // keyed by clientId
  /** Fast lookup: entity IDs that belong to players (updated on spawn/despawn). */
  private playerEntityIds = new Set<number>();
  private phase: SessionPhase = 'lobby';
  private tick = 0;

  /** Current wave number (0 = no wave yet). */
  private currentWave = 0;
  /** Wave phase: idle (lobby), prep (countdown), active (portals spawning). */
  private wavePhase: 'idle' | 'prep' | 'active' = 'idle';
  /** Seconds remaining in the prep countdown. */
  private prepTimer = 0;
  /** Debug flag: when true, wave timers (prep + portal spawns) don't tick. */
  private wavePaused = false;
  /** Accumulator for periodic wave timer sync (drift correction). */
  private waveSyncTimer = 0;
  private static readonly WAVE_SYNC_INTERVAL = 5; // seconds
  /** Current count of enemy entities for cap enforcement. */
  private enemyCount = 0;
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
  /** Per-wave wipe count. Reset when a new wave begins. */
  private wipeCount = 0;
  /** True after GAME_OVER is sent - stops all death/respawn/wave processing. */
  private gameOver = false;

  /** Entity ID of the campfire (set on game start). -1 = no campfire. */
  private campfireEntityId = -1;

  private warehouseIds = new Set<number>();
  private warehousePool = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
  /** Bridge tile positions: "tileX,tileY" → entityId. */
  private bridgePositions = new Map<string, number>();

  // ── Run stats ──────────────────────────────────────────────────────────────
  private enemiesKilled = 0;
  private startTime = 0;

  /** Snapshot of entity positions from the previous tick, for delta diffing. */
  private prevSnapshot = new Map<number, EntitySnapshot>();

  /** Whether the game simulation is paused (server-authoritative). */
  private paused = false;
  /** Set of clientIds that have voted for the current pending action. */
  private pauseVotes = new Set<string>();

  // ── Save system ──────────────────────────────────────────────────────────
  /** Called by SessionManager when save triggers. */
  onSave?: (data: import('@shared/SaveFormat').SaveData) => void;
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
  ): SessionPlayer {
    const slot = this.nextFreeSlot();
    const player: SessionPlayer = {
      client,
      playerId: persistentId ?? client.id,
      displayName,
      slot,
      isHost,
      entityId: null,
      lastSeq: 0,
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
    return player;
  }

  getLobbySlots(): LobbySlot[] {
    return [...this.players.values()].map((p) => ({
      playerId: p.playerId,
      displayName: p.displayName,
      slot: p.slot,
      isHost: p.isHost,
    }));
  }

  /** Iterate all session player records (for broadcasting). */
  getPlayers(): IterableIterator<SessionPlayer> {
    return this.players.values();
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
    this.startTime = Date.now() - this.savedElapsedTime * 1000;
    this.enemiesKilled = this.savedBuildings.length > 0 ? this.enemiesKilled : 0;

    // For resumed saves, use saved spawn origin; otherwise find a new one
    const hasSave = this.savedBuildings.length > 0;
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

      player.entityId = spawnPlayer(
        this.world,
        this.generator,
        player.slot,
        { x: sx, y: sy },
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

    // Pre-generate resources for immediate spawn area (rest fills in via generateResourcesNearPlayers)
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
    if (hasSave) {
      console.log(`[GameSession] Restoring ${this.savedBuildings.length} buildings from save (wave ${this.currentWave})`);
      // Restore saved buildings (campfire was already placed above)
      for (const sb of this.savedBuildings) {
        if (sb.buildingType === 'campfire') continue; // already spawned
        const eid = this.spawnBuilding(sb.x, sb.y, sb.buildingType as BuildingType, sb.maxHp, sb.permanent);
        const hp = this.world.getComponent<HealthComponent>(eid, C.Health);
        if (hp) { hp.current = sb.currentHp; hp.max = sb.maxHp; }
        const bld = this.world.getComponent<BuildingComponent>(eid, C.Building);
        if (bld) bld.upgradeLevel = sb.upgradeLevel;
        // Restore production state
        if (sb.production) {
          const prod = this.world.getComponent<ProductionComponent>(eid, C.Production);
          if (prod) {
            prod.timer = sb.production.timer;
            prod.stored = sb.production.stored;
            if (sb.production.secondaryResourceType) {
              prod.secondaryResourceType = sb.production.secondaryResourceType as typeof prod.secondaryResourceType;
              prod.secondaryChance = sb.production.secondaryChance;
            }
          }
        }
        // Restore turret stats
        if (sb.turret) {
          const t = this.world.getComponent<TurretComponent>(eid, C.Turret);
          if (t) {
            t.range = sb.turret.range;
            t.cooldown = sb.turret.cooldown;
            t.damage = sb.turret.damage;
            t.projectileSpeed = sb.turret.projectileSpeed;
          }
        }
        // Restore spike trap stats
        if (sb.spikeTrap) {
          const s = this.world.getComponent<SpikeTrapComponent>(eid, C.SpikeTrap);
          if (s) {
            s.damage = sb.spikeTrap.damage;
            s.cooldown = sb.spikeTrap.cooldown;
            s.selfDamage = sb.spikeTrap.selfDamage;
          }
        }
      }

      // Restore player resources from save (match by playerId)
      for (const p of this.players.values()) {
        if (p.entityId === null) continue;
        const savedP = this.savedPlayers.find(sp => sp.playerId === p.playerId);
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
        }
      }

      // Clear saved data after restoration
      this.savedBuildings = [];
      this.savedPlayers = [];
    }

    // Begin wave prep countdown
    if (!hasSave) this.currentWave = 1;
    this.wavePhase = 'prep';
    this.prepTimer = hasSave ? WAVE_PREP_BETWEEN : WAVE_PREP_INITIAL;

    // Broadcast SESSION_STARTING
    const starting: SessionStartingMessage = {
      type: MessageType.SESSION_STARTING,
      seed: this.seed,
      spawnPositions,
    };
    for (const p of this.players.values()) send(p.client, starting);

    // Broadcast full SNAPSHOT
    const snapshot = this.buildFullSnapshot();
    for (const p of this.players.values()) send(p.client, snapshot);

    // Broadcast wave prep start
    const waveStart: WaveStartMessage = {
      type: MessageType.WAVE_START,
      waveNumber: this.currentWave,
      prepDuration: hasSave ? WAVE_PREP_BETWEEN : WAVE_PREP_INITIAL,
    };
    for (const p of this.players.values()) send(p.client, waveStart);

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
      if (dx < PLAYER_RADIUS + RESOURCE_NODE_RADIUS && dy < PLAYER_RADIUS + RESOURCE_NODE_RADIUS) return false;
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

  /** Create a portal entity at (x, y) for the given wave. */
  private spawnPortal(x: number, y: number, wave: number): number {
    const hp = PORTAL_BASE_HP + PORTAL_HP_PER_WAVE * wave;
    const interval = PORTAL_BASE_SPAWN_INTERVAL * Math.pow(PORTAL_SPAWN_INTERVAL_DECAY, wave - 1);

    const id = this.world.createEntity();
    this.world.addComponent(id, C.Position,          { x, y });
    this.world.addComponent(id, C.Velocity,          { vx: 0, vy: 0 });
    this.world.addComponent(id, C.Health,            { current: hp, max: hp });
    this.world.addComponent(id, C.Faction,           { type: 'portal' });
    this.world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    this.world.addComponent(id, C.Portal,            { waveNumber: wave, spawnTimer: interval, spawnInterval: interval });
    return id;
  }

  /** Spawn N portals at walkable positions around the player centroid. */
  private spawnPortals(wave: number): void {
    // Compute player centroid
    let cx = 0, cy = 0, count = 0;
    for (const p of this.players.values()) {
      if (p.entityId === null) continue;
      const pos = this.world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (pos) { cx += pos.x; cy += pos.y; count++; }
    }
    if (count === 0) return;
    cx /= count;
    cy /= count;

    const numPortals = PORTALS_PER_WAVE_BASE + PORTALS_PER_WAVE_GROWTH * (wave - 1);
    const placed: { x: number; y: number }[] = [];

    // Try up to 100 random positions per portal to find valid placements
    for (let i = 0; i < numPortals; i++) {
      let bestX = 0, bestY = 0, found = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = PORTAL_MIN_DIST + Math.random() * (PORTAL_MAX_DIST - PORTAL_MIN_DIST);
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;

        if (!this.isWalkable(px, py)) continue;

        // Check spacing from already-placed portals
        let tooClose = false;
        for (const prev of placed) {
          const ddx = px - prev.x;
          const ddy = py - prev.y;
          if (ddx * ddx + ddy * ddy < PORTAL_MIN_SPACING * PORTAL_MIN_SPACING) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        bestX = px;
        bestY = py;
        found = true;
        break;
      }

      if (found) {
        this.spawnPortal(bestX, bestY, wave);
        placed.push({ x: bestX, y: bestY });
      }
    }

    console.log(`[Wave] Spawned ${placed.length}/${numPortals} portals for wave ${wave}`);
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
    const drops = this.rollLootTable('basic_enemy');
    for (const drop of drops) {
      this.spawnItemDrop(pos.x, pos.y, drop.itemType, drop.quantity, drop.autoPickup);
    }
  }

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

  private spawnEnemy(x: number, y: number): number | null {
    if (this.enemyCount >= GameSession.MAX_ENEMIES) return null;

    const isRanger = Math.random() < ENEMY_RANGER_SPAWN_CHANCE;
    const variant: EnemyVariantType = isRanger ? 'ranger' : 'melee';

    const id = this.world.createEntity();
    this.world.addComponent(id, C.Position,          { x, y });
    this.world.addComponent(id, C.Velocity,          { vx: 0, vy: 0 });
    this.world.addComponent(id, C.Health, {
      current: isRanger ? ENEMY_RANGER_HEALTH : ENEMY_MAX_HEALTH,
      max: isRanger ? ENEMY_RANGER_HEALTH : ENEMY_MAX_HEALTH,
    });
    this.world.addComponent(id, C.Speed, {
      base: isRanger ? ENEMY_RANGER_SPEED : ENEMY_BASE_SPEED,
      multiplier: 1,
    });
    this.world.addComponent(id, C.PlayerInput,       { dx: 0, dy: 0, sprint: false });
    this.world.addComponent(id, C.Faction,           { type: 'enemy' });
    this.world.addComponent(id, C.Facing,            { angle: 0 });
    this.world.addComponent(id, C.AttackCooldown, {
      remaining: 0,
      max: isRanger ? ENEMY_RANGER_COOLDOWN : ENEMY_MELEE_COOLDOWN,
    });
    this.world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    this.world.addComponent(id, C.EnemyVariant,      { variant });
    this.enemyCount++;
    return id;
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

    if (msg.attackType === 'ranged') {
      this.handleRangedAttack(player, msg.facing, send);
    } else {
      this.handleMeleeAttack(player, msg, send);
    }
  }

  // ── Building Placement (Phase 5) ───────────────────────────────────────────

  /**
   * Called when a client sends BUILD_PLACE to place a building.
   */
  handleBuildPlace(
    clientId: string,
    msg: BuildPlaceMessage,
    send: SendFn,
  ): void {
    if (this.phase !== 'playing' || this.paused || this.gameOver) return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;
    if (this.world.hasComponent(player.entityId, C.Downed)) return;
    if (this.respawnTimers.has(clientId)) return;
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;

    // Validate building type
    if (!BUILDING_COSTS[msg.buildingType]) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'unknown_type' } as BuildConfirmMessage);
      return;
    }

    // Grid-snap to correct position for building size
    const { x: snapX, y: snapY } = snapBuildingPosition(msg.x, msg.y, msg.buildingType);

    // Tile validation: bridges require non-walkable tiles (water); all others require walkable tiles
    const tileCount = BUILDING_SIZES[msg.buildingType] ?? 1;
    const half = buildingHalfExtent(msg.buildingType);
    const startTX = Math.floor((snapX - half) / TILE_SIZE);
    const startTY = Math.floor((snapY - half) / TILE_SIZE);
    const isBridge = msg.buildingType === 'bridge';
    for (let dy = 0; dy < tileCount; dy++) {
      for (let dx = 0; dx < tileCount; dx++) {
        const tx = startTX + dx;
        const ty = startTY + dy;
        const tileId = this.generator.getTile(tx, ty);
        const walkable = TILE_DEFS[tileId]?.walkable ?? false;
        if (isBridge) {
          // Bridge must be placed on non-walkable (water) tiles, and not on existing bridges
          if (walkable || this.bridgePositions.has(`${tx},${ty}`)) {
            send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'not_water' } as BuildConfirmMessage);
            return;
          }
        } else if (!walkable) {
          send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'not_walkable' } as BuildConfirmMessage);
          return;
        }
      }
    }

    // Must not collide with existing buildings or resources
    if (this.footprintCollides(snapX, snapY, msg.buildingType)) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'blocked' } as BuildConfirmMessage);
      return;
    }

    // Validate and deduct resources
    if (!this.deductBuildingCost(msg.buildingType, player, send)) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'insufficient_resources' } as BuildConfirmMessage);
      return;
    }

    // Spawn the building
    const HP_MAP: Record<string, number> = {
      campfire: CAMPFIRE_MAX_HEALTH, wall: WALL_MAX_HEALTH, warehouse: WAREHOUSE_MAX_HEALTH,
      lumbermill: LUMBERMILL_MAX_HEALTH, quarry: QUARRY_MAX_HEALTH, mine: MINE_MAX_HEALTH, farm: FARM_MAX_HEALTH,
      arrow_turret: ARROW_TURRET_MAX_HEALTH, cannon_turret: CANNON_TURRET_MAX_HEALTH,
      spike_trap: SPIKE_TRAP_MAX_HEALTH, bridge: BRIDGE_MAX_HEALTH,
    };
    const maxHp = HP_MAP[msg.buildingType] ?? WALL_MAX_HEALTH;
    const id = this.spawnBuilding(snapX, snapY, msg.buildingType, maxHp, false);

    if (msg.buildingType === 'warehouse') {
      this.warehouseIds.add(id);
      this.broadcastWarehouseUpdate(send);
    }

    // Attach special components for new building types
    if (msg.buildingType === 'lumbermill') {
      this.world.addComponent(id, C.Production, {
        resourceType: 'wood', interval: LUMBERMILL_PRODUCTION_INTERVAL,
        timer: 0, amount: PRODUCTION_AMOUNT, stored: 0, maxStored: PRODUCTION_MAX_STORED,
      } as ProductionComponent);
    } else if (msg.buildingType === 'quarry') {
      this.world.addComponent(id, C.Production, {
        resourceType: 'stone', interval: QUARRY_PRODUCTION_INTERVAL,
        timer: 0, amount: PRODUCTION_AMOUNT, stored: 0, maxStored: PRODUCTION_MAX_STORED,
      } as ProductionComponent);
    } else if (msg.buildingType === 'mine') {
      this.world.addComponent(id, C.Production, {
        resourceType: 'iron', interval: MINE_PRODUCTION_INTERVAL,
        timer: 0, amount: PRODUCTION_AMOUNT, stored: 0, maxStored: PRODUCTION_MAX_STORED,
        secondaryResourceType: 'diamond', secondaryChance: 0.2,
      } as ProductionComponent);
    } else if (msg.buildingType === 'farm') {
      this.world.addComponent(id, C.Production, {
        resourceType: 'food', interval: FARM_PRODUCTION_INTERVAL,
        timer: 0, amount: PRODUCTION_AMOUNT, stored: 0, maxStored: PRODUCTION_MAX_STORED,
      } as ProductionComponent);
    } else if (msg.buildingType === 'arrow_turret') {
      this.world.addComponent(id, C.Turret, {
        range: ARROW_TURRET_RANGE, cooldown: ARROW_TURRET_COOLDOWN,
        cooldownTimer: 0, damage: ARROW_TURRET_DAMAGE, projectileSpeed: ARROW_TURRET_PROJ_SPEED,
      } as TurretComponent);
    } else if (msg.buildingType === 'cannon_turret') {
      this.world.addComponent(id, C.Turret, {
        range: CANNON_TURRET_RANGE, cooldown: CANNON_TURRET_COOLDOWN,
        cooldownTimer: 0, damage: CANNON_TURRET_DAMAGE, projectileSpeed: CANNON_TURRET_PROJ_SPEED,
      } as TurretComponent);
    } else if (msg.buildingType === 'spike_trap') {
      this.world.addComponent(id, C.SpikeTrap, {
        damage: SPIKE_TRAP_DAMAGE, cooldown: SPIKE_TRAP_COOLDOWN,
        selfDamage: SPIKE_TRAP_SELF_DAMAGE, enemyCooldowns: new Map(),
      } as SpikeTrapComponent);
    } else if (msg.buildingType === 'bridge') {
      const tileX = Math.floor(snapX / TILE_SIZE);
      const tileY = Math.floor(snapY / TILE_SIZE);
      this.world.addComponent(id, C.Bridge, { tileX, tileY } as BridgeComponent);
      this.bridgePositions.set(`${tileX},${tileY}`, id);
      // Update movement system bridge tiles
      this.movement.bridgeTiles.add(`${tileX},${tileY}`);
    }

    send(player.client, { type: MessageType.BUILD_CONFIRM, success: true } as BuildConfirmMessage);
  }

  private deductBuildingCost(buildingType: string, player: any, send: SendFn, costOverride?: Partial<Record<string, number>>): boolean {
    const costs = costOverride ?? BUILDING_COSTS[buildingType] ?? {};
    const playerRes = this.world.getComponent<any>(player.entityId, C.Resources);
    if (!playerRes) return false;

    const hasWarehouse = this.warehouseIds.size > 0;
    const wPool = this.warehousePool as Record<string, number>;
    const pPool = playerRes as Record<string, number>;

    // Check combined availability (warehouse + player inventory)
    for (const [res, amount] of Object.entries(costs)) {
      const total = (hasWarehouse ? (wPool[res] ?? 0) : 0) + (pPool[res] ?? 0);
      if (total < amount!) return false;
    }

    // Deduct: warehouse first, then player inventory for the remainder
    let drewFromWarehouse = false;
    let drewFromPlayer = false;
    for (const [res, amount] of Object.entries(costs)) {
      let remaining = amount!;
      if (hasWarehouse) {
        const fromW = Math.min(remaining, wPool[res] ?? 0);
        if (fromW > 0) { wPool[res] -= fromW; remaining -= fromW; drewFromWarehouse = true; }
      }
      if (remaining > 0) { pPool[res] -= remaining; drewFromPlayer = true; }
    }

    if (drewFromWarehouse) this.broadcastWarehouseUpdate(send);
    if (drewFromPlayer) {
      send(player.client, {
        type: MessageType.RESOURCE_UPDATE,
        wood: playerRes.wood, stone: playerRes.stone, iron: playerRes.iron, diamond: playerRes.diamond, gold: playerRes.gold, food: playerRes.food,
      });
    }
    return true;
  }

  private broadcastWarehouseUpdate(send: SendFn): void {
    const msg = {
      type: MessageType.WAREHOUSE_UPDATE,
      ...this.warehousePool,
      exists: this.warehouseIds.size > 0,
    };
    for (const p of this.players.values()) send(p.client, msg);
  }

  handleBuildDemolish(clientId: string, msg: BuildDemolishMessage, send: SendFn): void {
    if (this.phase !== 'playing' || this.paused || this.gameOver) return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;
    if (this.world.hasComponent(player.entityId, C.Downed)) return;
    if (this.respawnTimers.has(clientId)) return;

    const targetId = msg.entityId;
    if (!Number.isFinite(targetId)) return;
    if (!this.world.hasEntity(targetId)) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'no_building' } as BuildConfirmMessage);
      return;
    }
    const bldg = this.world.getComponent<BuildingComponent>(targetId, C.Building);
    if (!bldg) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'no_building' } as BuildConfirmMessage);
      return;
    }
    if (bldg.permanent) {
      send(player.client, { type: MessageType.BUILD_CONFIRM, success: false, reason: 'permanent' } as BuildConfirmMessage);
      return;
    }

    // Calculate total invested cost (base + all upgrade costs) for refund
    const baseCosts = BUILDING_COSTS[bldg.buildingType] ?? {};
    const totalCosts: Record<string, number> = {};
    for (const [res, amount] of Object.entries(baseCosts)) {
      totalCosts[res] = amount!;
    }
    // Add upgrade costs for each level above 1
    for (let lvl = 1; lvl < bldg.upgradeLevel; lvl++) {
      const upgCost = getUpgradeCost(bldg.buildingType, lvl);
      if (upgCost) {
        for (const [res, amount] of Object.entries(upgCost)) {
          totalCosts[res] = (totalCosts[res] ?? 0) + (amount as number);
        }
      }
    }

    const isDemolingWarehouse = this.warehouseIds.has(targetId);

    if (this.warehouseIds.size > 0 && !(isDemolingWarehouse && this.warehouseIds.size === 1)) {
      for (const [res, amount] of Object.entries(totalCosts)) {
        const refund = Math.floor(amount * DEMOLISH_REFUND_PERCENT);
        (this.warehousePool as Record<string, number>)[res] += refund;
      }
      this.broadcastWarehouseUpdate(send);
    } else {
      const res = this.world.getComponent<any>(player.entityId, C.Resources);
      if (res) {
        for (const [key, amount] of Object.entries(totalCosts)) {
          const refund = Math.floor(amount * DEMOLISH_REFUND_PERCENT);
          (res as unknown as Record<string, number>)[key] += refund;
        }
        send(player.client, {
          type: MessageType.RESOURCE_UPDATE,
          wood: res.wood, stone: res.stone, iron: res.iron, diamond: res.diamond, gold: res.gold, food: res.food,
        });
      }
    }

    if (isDemolingWarehouse) {
      this.warehouseIds.delete(targetId);
      if (this.warehouseIds.size === 0) {
        this.warehousePool = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
      }
      this.broadcastWarehouseUpdate(send);
    }

    // Clean up bridge tile when demolished
    this.cleanupBridge(targetId);

    this.world.destroyEntity(targetId);
    for (const p of this.players.values()) {
      send(p.client, { type: MessageType.BUILD_DESTROYED, entityId: targetId } as any);
    }
    send(player.client, { type: MessageType.BUILD_CONFIRM, success: true } as BuildConfirmMessage);
  }

  handleBuildUpgrade(clientId: string, msg: BuildUpgradeMessage, send: SendFn): void {
    if (this.phase !== 'playing' || this.paused || this.gameOver) return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;
    if (this.world.hasComponent(player.entityId, C.Downed)) return;
    if (this.respawnTimers.has(clientId)) return;

    const targetId = msg.entityId;
    if (!Number.isFinite(targetId)) return;
    if (!this.world.hasEntity(targetId)) {
      send(player.client, { type: MessageType.BUILD_UPGRADE_CONFIRM, success: false, reason: 'no_building' } as BuildUpgradeConfirmMessage);
      return;
    }
    const bldg = this.world.getComponent<BuildingComponent>(targetId, C.Building);
    if (!bldg) {
      send(player.client, { type: MessageType.BUILD_UPGRADE_CONFIRM, success: false, reason: 'no_building' } as BuildUpgradeConfirmMessage);
      return;
    }

    const maxLevel = BUILDING_MAX_LEVEL[bldg.buildingType] ?? 1;
    if (bldg.upgradeLevel >= maxLevel) {
      send(player.client, { type: MessageType.BUILD_UPGRADE_CONFIRM, success: false, reason: 'max_level' } as BuildUpgradeConfirmMessage);
      return;
    }

    const cost = getUpgradeCost(bldg.buildingType, bldg.upgradeLevel);
    if (!cost) {
      send(player.client, { type: MessageType.BUILD_UPGRADE_CONFIRM, success: false, reason: 'max_level' } as BuildUpgradeConfirmMessage);
      return;
    }

    if (!this.deductBuildingCost(bldg.buildingType, player, send, cost as Partial<Record<string, number>>)) {
      send(player.client, { type: MessageType.BUILD_UPGRADE_CONFIRM, success: false, reason: 'insufficient_resources' } as BuildUpgradeConfirmMessage);
      return;
    }

    // Upgrade the building
    const oldLevel = bldg.upgradeLevel;
    bldg.upgradeLevel = oldLevel + 1;
    const newLevel = bldg.upgradeLevel;
    const lvlIdx = newLevel - 1; // 0-based index into multiplier arrays

    // Scale HP: increase max and heal the gained amount
    const hp = this.world.getComponent<HealthComponent>(targetId, C.Health)!;
    const baseMaxHp = hp.max / UPGRADE_HP_MULT[oldLevel - 1];
    const newMaxHp = Math.round(baseMaxHp * UPGRADE_HP_MULT[lvlIdx]);
    const hpGain = newMaxHp - hp.max;
    hp.max = newMaxHp;
    hp.current = Math.min(hp.max, hp.current + hpGain);

    // Scale production buildings
    const prod = this.world.getComponent<ProductionComponent>(targetId, C.Production);
    if (prod && lvlIdx < UPGRADE_PROD_INTERVAL.length) {
      const baseInterval = prod.interval / UPGRADE_PROD_INTERVAL[oldLevel - 1];
      prod.interval = baseInterval * UPGRADE_PROD_INTERVAL[lvlIdx];
      const baseMax = prod.maxStored / UPGRADE_PROD_MAX[oldLevel - 1];
      prod.maxStored = Math.round(baseMax * UPGRADE_PROD_MAX[lvlIdx]);
    }

    // Scale turrets
    const turret = this.world.getComponent<TurretComponent>(targetId, C.Turret);
    if (turret && lvlIdx < UPGRADE_ARROW_CD.length) {
      if (bldg.buildingType === 'arrow_turret') {
        const baseCd = turret.cooldown / UPGRADE_ARROW_CD[oldLevel - 1];
        turret.cooldown = baseCd * UPGRADE_ARROW_CD[lvlIdx];
        const baseDmg = turret.damage / UPGRADE_ARROW_DMG[oldLevel - 1];
        turret.damage = Math.round(baseDmg * UPGRADE_ARROW_DMG[lvlIdx]);
      } else if (bldg.buildingType === 'cannon_turret') {
        const baseCd = turret.cooldown / UPGRADE_CANNON_CD[oldLevel - 1];
        turret.cooldown = baseCd * UPGRADE_CANNON_CD[lvlIdx];
        const baseDmg = turret.damage / UPGRADE_CANNON_DMG[oldLevel - 1];
        turret.damage = Math.round(baseDmg * UPGRADE_CANNON_DMG[lvlIdx]);
      }
      turret.cooldownTimer = 0; // reset cooldown so upgraded turret fires immediately
    }

    // Scale spike trap damage
    const trap = this.world.getComponent<SpikeTrapComponent>(targetId, C.SpikeTrap);
    if (trap && lvlIdx < UPGRADE_TRAP_DMG.length) {
      const baseDmg = trap.damage / UPGRADE_TRAP_DMG[oldLevel - 1];
      trap.damage = Math.round(baseDmg * UPGRADE_TRAP_DMG[lvlIdx]);
    }

    send(player.client, {
      type: MessageType.BUILD_UPGRADE_CONFIRM,
      success: true,
      entityId: targetId,
      newLevel,
    } as BuildUpgradeConfirmMessage);
  }

  handleBuildRepair(clientId: string, msg: BuildRepairMessage, send: SendFn): void {
    if (this.phase !== 'playing' || this.paused || this.gameOver) return;
    const player = this.players.get(clientId);
    if (!player || player.entityId === null) return;
    if (this.world.hasComponent(player.entityId, C.Downed)) return;
    if (this.respawnTimers.has(clientId)) return;

    const targetId = msg.entityId;
    if (!Number.isFinite(targetId)) return;
    if (!this.world.hasEntity(targetId)) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'no_building' } as BuildRepairConfirmMessage);
      return;
    }
    const bldg = this.world.getComponent<BuildingComponent>(targetId, C.Building);
    if (!bldg) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'no_building' } as BuildRepairConfirmMessage);
      return;
    }
    const hp = this.world.getComponent<HealthComponent>(targetId, C.Health);
    if (!hp || hp.current >= hp.max) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'full_hp' } as BuildRepairConfirmMessage);
      return;
    }

    const missingHp = hp.max - hp.current;
    const cost = getRepairCost(bldg.buildingType, missingHp, hp.max);
    if (!cost) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'full_hp' } as BuildRepairConfirmMessage);
      return;
    }

    if (!this.deductBuildingCost(bldg.buildingType, player, send, cost as Partial<Record<string, number>>)) {
      send(player.client, { type: MessageType.BUILD_REPAIR_CONFIRM, success: false, reason: 'insufficient_resources' } as BuildRepairConfirmMessage);
      return;
    }

    hp.current = hp.max;

    send(player.client, {
      type: MessageType.BUILD_REPAIR_CONFIRM,
      success: true,
      entityId: targetId,
    } as BuildRepairConfirmMessage);
  }

  /** Remove bridge from bridgePositions and movement bridgeTiles when destroyed/demolished. */
  private cleanupBridge(entityId: number): void {
    const bridge = this.world.getComponent<BridgeComponent>(entityId, C.Bridge);
    if (bridge) {
      const key = `${bridge.tileX},${bridge.tileY}`;
      this.bridgePositions.delete(key);
      this.movement.bridgeTiles.delete(key);
    }
  }

  /** Each tick, auto-deposit personal resources into the warehouse pool for players near any warehouse. */
  private tickWarehouseDeposit(send: SendFn): void {
    if (this.warehouseIds.size === 0) return;

    // Collect warehouse positions
    const whPositions: PositionComponent[] = [];
    for (const wid of this.warehouseIds) {
      const pos = this.world.getComponent<PositionComponent>(wid, C.Position);
      if (pos) whPositions.push(pos);
    }
    if (whPositions.length === 0) return;

    const r2 = WAREHOUSE_DEPOSIT_RADIUS * WAREHOUSE_DEPOSIT_RADIUS;

    for (const p of this.players.values()) {
      if (p.entityId === null) continue;
      const pPos = this.world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (!pPos) continue;

      // Check proximity to any warehouse
      let near = false;
      for (const wPos of whPositions) {
        const dx = pPos.x - wPos.x;
        const dy = pPos.y - wPos.y;
        if (dx * dx + dy * dy <= r2) { near = true; break; }
      }
      if (!near) continue;

      const res = this.world.getComponent<ResourcesComponent>(p.entityId, C.Resources);
      if (!res) continue;

      let transferred = false;
      for (const key of ['wood', 'stone', 'iron', 'diamond', 'gold', 'food'] as const) {
        if (res[key] > 0) {
          (this.warehousePool as Record<string, number>)[key] += res[key];
          res[key] = 0;
          transferred = true;
        }
      }
      if (transferred) {
        send(p.client, {
          type: MessageType.RESOURCE_UPDATE,
          wood: res.wood, stone: res.stone, iron: res.iron, diamond: res.diamond, gold: res.gold, food: res.food,
        });
        this.broadcastWarehouseUpdate(send);
      }
    }
  }

  /** Tick production buildings: accumulate resources and deposit to warehouse or store locally. */
  private tickProduction(_dt: number, _send: SendFn): void {
    for (const id of this.world.query(C.Production, C.Position)) {
      const prod = this.world.getComponent<ProductionComponent>(id, C.Production)!;
      prod.timer += _dt;
      if (prod.timer < prod.interval) continue;
      prod.timer -= prod.interval;

      // Secondary resource chance (e.g. mine → diamond instead of iron)
      if (prod.secondaryResourceType && prod.secondaryChance && Math.random() < prod.secondaryChance) {
        // Deposit secondary resource directly to warehouse pool
        const key = prod.secondaryResourceType as keyof typeof this.warehousePool;
        if (key in this.warehousePool) {
          this.warehousePool[key] += prod.amount;
        }
      } else {
        // Primary resource: accumulate locally for F-key collection
        prod.stored = Math.min(prod.stored + prod.amount, prod.maxStored);
      }
    }
  }

  /** Tick turrets: find nearest enemy in range and fire projectiles. */
  private tickTurrets(dt: number, send: SendFn): void {
    for (const id of this.world.query(C.Turret, C.Position)) {
      const turret = this.world.getComponent<TurretComponent>(id, C.Turret)!;
      turret.cooldownTimer -= dt;
      if (turret.cooldownTimer > 0) continue;

      const tpos = this.world.getComponent<PositionComponent>(id, C.Position)!;
      const bldg = this.world.getComponent<BuildingComponent>(id, C.Building);
      const halfExt = buildingHalfExtent(bldg?.buildingType ?? 'arrow_turret');

      // Find nearest enemy or portal in range
      let bestId = -1;
      let bestDist = turret.range * turret.range;
      for (const eid of this.world.query(C.Position, C.Faction)) {
        const ef = this.world.getComponent<FactionComponent>(eid, C.Faction)!;
        if (ef.type !== 'enemy' && ef.type !== 'portal') continue;
        const epos = this.world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = epos.x - tpos.x;
        const dy = epos.y - tpos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) { bestDist = d2; bestId = eid; }
      }

      if (bestId < 0) continue;
      turret.cooldownTimer = turret.cooldown;

      // Spawn projectile aimed at target
      const epos = this.world.getComponent<PositionComponent>(bestId, C.Position)!;
      const dx = epos.x - tpos.x;
      const dy = epos.y - tpos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.01) continue;
      const nx = dx / dist;
      const ny = dy / dist;

      // Offset spawn outside building AABB
      const spawnOffset = halfExt + PROJECTILE_RADIUS + 2;
      const px = tpos.x + nx * spawnOffset;
      const py = tpos.y + ny * spawnOffset;

      const projId = this.world.createEntity();
      this.world.addComponent(projId, C.Position,   { x: px, y: py });
      const projComp: any = { ownerId: id, damage: turret.damage, lifetime: RANGED_LIFETIME };

      const isCannon = bldg?.buildingType === 'cannon_turret';
      if (isCannon) {
        // Mortar-style: fly to target position, then detonate AOE
        const lvlIdx = (bldg!.upgradeLevel ?? 1) - 1;
        projComp.aoeRadius = UPGRADE_CANNON_AOE[lvlIdx] ?? CANNON_AOE_BASE_RADIUS;
        projComp.targetX = epos.x;
        projComp.targetY = epos.y;
        const flightTime = dist / turret.projectileSpeed;
        projComp.flightTime = flightTime;
        projComp.totalFlightTime = flightTime;
        // Velocity toward target (for visual direction)
        this.world.addComponent(projId, C.Velocity, { vx: nx * turret.projectileSpeed, vy: ny * turret.projectileSpeed });
      } else {
        // Arrow turret: straight-line projectile
        this.world.addComponent(projId, C.Velocity, { vx: nx * turret.projectileSpeed, vy: ny * turret.projectileSpeed });
      }

      this.world.addComponent(projId, C.Projectile, projComp);
      this.world.addComponent(projId, C.Faction,     { type: 'player' });

      const spawnMsg: ProjectileSpawnMessage = {
        type: MessageType.PROJECTILE_SPAWN,
        projectileId: projId,
        x: px, y: py,
        vx: nx * turret.projectileSpeed, vy: ny * turret.projectileSpeed,
        ownerSlot: -1, // turret indicator
        ...(isCannon ? { targetX: epos.x, targetY: epos.y, totalFlightTime: dist / turret.projectileSpeed } : {}),
      };
      for (const p of this.players.values()) send(p.client, spawnMsg);
    }
  }

  /** Tick spike traps: damage enemies walking over them and take self-damage. */
  private tickSpikeTraps(dt: number, send: SendFn): void {
    const trapDeaths: number[] = [];
    const entityDeaths: number[] = [];
    const attackerMap = new Map<number, number>();

    for (const id of this.world.query(C.SpikeTrap, C.Position, C.Health)) {
      const trap = this.world.getComponent<SpikeTrapComponent>(id, C.SpikeTrap)!;
      const tpos = this.world.getComponent<PositionComponent>(id, C.Position)!;
      const thp = this.world.getComponent<HealthComponent>(id, C.Health)!;
      const trapHalf = buildingHalfExtent('spike_trap');
      let trapDestroyed = false;

      // Tick per-entity cooldowns
      for (const [eid, remaining] of trap.enemyCooldowns) {
        if (remaining > 0) trap.enemyCooldowns.set(eid, remaining - dt);
      }

      // Check all enemies and players for overlap
      for (const eid of this.world.query(C.Position, C.Health, C.Faction)) {
        const ef = this.world.getComponent<FactionComponent>(eid, C.Faction)!;
        if (ef.type !== 'enemy' && ef.type !== 'player') continue;
        // Skip downed players
        if (this.world.hasComponent(eid, C.Downed)) continue;

        const epos = this.world.getComponent<PositionComponent>(eid, C.Position)!;
        const entityRadius = ef.type === 'player' ? PLAYER_RADIUS : ENEMY_RADIUS;

        // AABB overlap: trapHalf + entity radius
        const edx = Math.abs(epos.x - tpos.x);
        const edy = Math.abs(epos.y - tpos.y);
        if (edx > trapHalf + entityRadius || edy > trapHalf + entityRadius) continue;

        // Check cooldown
        const cd = trap.enemyCooldowns.get(eid) ?? 0;
        if (cd > 0) continue;

        // Deal damage
        const ehp = this.world.getComponent<HealthComponent>(eid, C.Health);
        if (!ehp) continue;
        ehp.current = Math.max(0, ehp.current - trap.damage);
        trap.enemyCooldowns.set(eid, trap.cooldown);

        // Broadcast hit
        const hitMsg: HitMessage = {
          type: MessageType.HIT,
          sourceId: id, targetId: eid,
          damage: trap.damage, knockbackVx: 0, knockbackVy: 0,
        };
        for (const p of this.players.values()) send(p.client, hitMsg);

        if (ehp.current <= 0) {
          entityDeaths.push(eid);
          attackerMap.set(eid, id);
        }

        // Self-damage
        thp.current -= trap.selfDamage;
        if (thp.current <= 0) {
          trapDeaths.push(id);
          trapDestroyed = true;
          break;
        }
      }

      if (trapDestroyed) continue;

      // Clean stale entity cooldowns
      for (const eid of trap.enemyCooldowns.keys()) {
        if (!this.world.hasEntity(eid)) trap.enemyCooldowns.delete(eid);
      }
    }

    if (entityDeaths.length > 0) this.destroyDeadEntities(entityDeaths, attackerMap, send);
    if (trapDeaths.length > 0) this.destroyDeadEntities(trapDeaths, undefined, send);
  }

  /** Returns true if a building footprint at (cx, cy) overlaps an existing entity (buildings, resources, players, enemies). */
  private footprintCollides(cx: number, cy: number, buildingType: string): boolean {
    const newHalf = buildingHalfExtent(buildingType);
    for (const id of this.world.query(C.Position, C.Faction)) {
      const f = this.world.getComponent<FactionComponent>(id, C.Faction)!;
      const pos = this.world.getComponent<PositionComponent>(id, C.Position)!;
      let existingHalf: number;
      if (f.type === 'building') {
        const b = this.world.getComponent<BuildingComponent>(id, C.Building);
        existingHalf = buildingHalfExtent(b?.buildingType ?? 'wall');
      } else if (f.type === 'resource') {
        existingHalf = RESOURCE_NODE_RADIUS;
      } else if (f.type === 'player') {
        if (this.world.hasComponent(id, C.Downed)) continue; // ignore downed players
        existingHalf = PLAYER_RADIUS;
      } else if (f.type === 'enemy') {
        existingHalf = ENEMY_RADIUS;
      } else {
        continue; // skip portals, items, etc.
      }
      if (Math.abs(pos.x - cx) < newHalf + existingHalf && Math.abs(pos.y - cy) < newHalf + existingHalf) return true;
    }
    return false;
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
        this.creditResources(player.entityId, prod.resourceType, prod.stored, send);
        prod.stored = 0;
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

    const { hits, deaths } = this.combat.processMeleeAttack(
      this.world,
      entityId,
      msg.facing,
      { x: msg.x, y: msg.y },
    );

    // Broadcast attack animation to all players (fires even on miss)
    const performed: AttackPerformedMessage = {
      type: MessageType.ATTACK_PERFORMED,
      sourceId: entityId,
      facing: msg.facing,
    };
    for (const p of this.players.values()) send(p.client, performed);

    // Broadcast each hit to all players
    for (const hit of hits) {
      const hitMsg: HitMessage = { type: MessageType.HIT, ...hit };
      for (const p of this.players.values()) send(p.client, hitMsg);
    }

    // Build attacker map so destroyDeadEntities can credit resource harvesting
    const attackerMap = new Map<number, number>();
    for (const hit of hits) {
      if (!attackerMap.has(hit.targetId)) attackerMap.set(hit.targetId, hit.sourceId);
    }
    // Remove dead non-player entities; player death handled in 4.11
    this.destroyDeadEntities(deaths, attackerMap, send);
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
    this.world.addComponent(projId, C.Projectile, { ownerId: entityId, damage: RANGED_DAMAGE, lifetime: RANGED_LIFETIME });
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
    };
    for (const p of this.players.values()) send(p.client, spawn);
  }

  /**
   * Destroy dead non-player entities from the world.
   * @param deaths     Entity IDs whose HP reached 0.
   * @param attackerMap Optional map of deadId → sourceId for resource crediting.
   * @param send       Required when attackerMap is provided (to send RESOURCE_UPDATE).
   */
  private destroyDeadEntities(
    deaths: number[],
    attackerMap?: Map<number, number>,
    send?: SendFn,
  ): void {
    const processed = new Set<number>();
    for (const deadId of deaths) {
      if (processed.has(deadId)) continue;
      processed.add(deadId);
      // Player death → downed state (don't destroy the entity)
      if (this.playerEntityIds.has(deadId)) {
        if (send) this.checkPlayerDowned(deadId, send);
        continue;
      }
      const faction = this.world.getComponent<FactionComponent>(deadId, C.Faction);

      // Resource node → credit attacker
      if (faction?.type === 'resource' && attackerMap && send) {
        const rn = this.world.getComponent<ResourceNodeComponent>(deadId, C.ResourceNode);
        const attackerId = attackerMap.get(deadId);
        if (rn && attackerId !== undefined) {
          this.creditResources(attackerId, rn.resourceType, rn.yield, send);
        }
        this.resourceNodeCount--;
      }

      // Enemy → spawn loot drops
      if (faction?.type === 'enemy') {
        this.spawnLootDrops(deadId);
        this.enemyCount--;
        this.enemiesKilled++;
      }

      // Building → broadcast destruction, clean up warehouse, check campfire game-over
      if (faction?.type === 'building' && send) {
        const destroyedMsg: BuildDestroyedMessage = {
          type: MessageType.BUILD_DESTROYED,
          entityId: deadId,
        };
        for (const p of this.players.values()) send(p.client, destroyedMsg);

        // Warehouse destroyed → drop 50% of supplies, then clean up
        if (this.warehouseIds.has(deadId)) {
          const wPos = this.world.getComponent<PositionComponent>(deadId, C.Position);
          if (wPos) {
            const DROP_FRACTION = 0.5;
            const MAX_PER_DROP = 50;
            for (const [res, amount] of Object.entries(this.warehousePool)) {
              const dropAmount = Math.floor(amount * DROP_FRACTION);
              if (dropAmount <= 0) continue;
              // Deduct from pool
              (this.warehousePool as Record<string, number>)[res] -= dropAmount;
              // Spawn batched item drops
              let remaining = dropAmount;
              while (remaining > 0) {
                const qty = Math.min(remaining, MAX_PER_DROP);
                this.spawnItemDrop(wPos.x, wPos.y, res, qty, true);
                remaining -= qty;
              }
            }
          }
          this.warehouseIds.delete(deadId);
          if (this.warehouseIds.size === 0) {
            this.warehousePool = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };
          }
          this.broadcastWarehouseUpdate(send);
        }

        // Bridge destroyed → remove from bridge tiles
        this.cleanupBridge(deadId);

        if (deadId === this.campfireEntityId && !this.gameOver) {
          this.gameOver = true;
          const campfireMsg: CampfireDestroyedMessage = {
            type: MessageType.CAMPFIRE_DESTROYED,
          };
          for (const p of this.players.values()) send(p.client, campfireMsg);

          const timePlayed = Math.floor((Date.now() - this.startTime) / 1000);
          const gameOverMsg: GameOverMessage = {
            type: MessageType.GAME_OVER,
            waveReached: this.currentWave,
            reason: 'campfire_destroyed',
            enemiesKilled: this.enemiesKilled,
            timePlayed,
          };
          for (const p of this.players.values()) send(p.client, gameOverMsg);
        }
      }

      this.world.destroyEntity(deadId);
    }
  }

  // ── Wave logic ──────────────────────────────────────────────────────────────

  private tickWave(dt: number, send: (client: ConnectedClient, msg: object) => void): void {
    if (this.wavePaused) return;

    if (this.wavePhase === 'prep') {
      this.prepTimer -= dt;

      // Periodic drift correction - sync clients every WAVE_SYNC_INTERVAL
      this.waveSyncTimer += dt;
      if (this.waveSyncTimer >= GameSession.WAVE_SYNC_INTERVAL) {
        this.waveSyncTimer = 0;
        this.broadcastWaveTimerSync(send);
      }

      if (this.prepTimer <= 0) {
        // Prep ended - spawn portals and go active
        this.spawnPortals(this.currentWave);
        this.wavePhase = 'active';

        // Broadcast that portals are now live (prepDuration=0 signals "active now")
        const waveActive: WaveStartMessage = {
          type: MessageType.WAVE_START,
          waveNumber: this.currentWave,
          prepDuration: 0,
        };
        for (const p of this.players.values()) send(p.client, waveActive);
      }
    } else if (this.wavePhase === 'active') {
      // Run portal spawn timers
      const spawnRequests = this.portal.update(this.world, dt);
      for (const req of spawnRequests) {
        if (this.isWalkable(req.x, req.y)) {
          this.spawnEnemy(req.x, req.y);
        }
      }

      // Check if all portals are dead
      let anyAlive = false;
      for (const id of this.world.query(C.Portal, C.Health)) {
        const hp = this.world.getComponent<HealthComponent>(id, C.Health)!;
        if (hp.current > 0) {
          anyAlive = true;
        } else {
          // Destroy dead portals
          this.world.destroyEntity(id);
        }
      }

      if (!anyAlive) {
        // Wave cleared - broadcast WAVE_END, start next wave prep
        const waveEnd: WaveEndMessage = {
          type: MessageType.WAVE_END,
          waveNumber: this.currentWave,
          outcome: 'cleared',
        };
        for (const p of this.players.values()) send(p.client, waveEnd);

        this.currentWave++;
        this.wipeCount = 0; // Reset wipe count for new wave
        this.wavePhase = 'prep';
        this.prepTimer = WAVE_PREP_BETWEEN;

        const waveStart: WaveStartMessage = {
          type: MessageType.WAVE_START,
          waveNumber: this.currentWave,
          prepDuration: WAVE_PREP_BETWEEN,
        };
        for (const p of this.players.values()) send(p.client, waveStart);

        console.log(`[Wave] Wave ${this.currentWave - 1} cleared! Next wave in ${WAVE_PREP_BETWEEN}s`);

        // Auto-save after wave clear
        if (this.onSave) {
          const saveData = this.serializeSave();
          this.onSave(saveData);
          // Notify all players
          const savedMsg: import('@shared/protocol').GameSavedMessage = {
            type: MessageType.GAME_SAVED,
            wave: saveData.currentWave,
            slot: this.saveSlot,
          };
          for (const p of this.players.values()) send(p.client, savedMsg);
        }
      }
    }
  }

  // ── Save system ──────────────────────────────────────────────────────────────

  /** Trigger an immediate save (called on host leave, pause, etc.). */
  saveNow(send?: SendFn): void {
    if (this.phase !== 'playing' || !this.onSave) return;
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

  /** Snapshot the entire world state into a SaveData object. */
  serializeSave(): import('@shared/SaveFormat').SaveData {
    const buildings: import('@shared/SaveFormat').SavedBuilding[] = [];
    for (const id of this.world.query(C.Building, C.Position, C.Health)) {
      const bld = this.world.getComponent<BuildingComponent>(id, C.Building)!;
      const pos = this.world.getComponent<PositionComponent>(id, C.Position)!;
      const hp = this.world.getComponent<HealthComponent>(id, C.Health)!;

      const saved: import('@shared/SaveFormat').SavedBuilding = {
        x: pos.x,
        y: pos.y,
        buildingType: bld.buildingType,
        permanent: bld.permanent,
        upgradeLevel: bld.upgradeLevel,
        currentHp: hp.current,
        maxHp: hp.max,
      };

      const prod = this.world.getComponent<ProductionComponent>(id, C.Production);
      if (prod) {
        saved.production = {
          resourceType: prod.resourceType,
          interval: prod.interval,
          timer: prod.timer,
          amount: prod.amount,
          stored: prod.stored,
          maxStored: prod.maxStored,
          secondaryResourceType: prod.secondaryResourceType,
          secondaryChance: prod.secondaryChance,
        };
      }

      const turret = this.world.getComponent<TurretComponent>(id, C.Turret);
      if (turret) {
        saved.turret = {
          range: turret.range,
          cooldown: turret.cooldown,
          damage: turret.damage,
          projectileSpeed: turret.projectileSpeed,
        };
      }

      const spike = this.world.getComponent<SpikeTrapComponent>(id, C.SpikeTrap);
      if (spike) {
        saved.spikeTrap = {
          damage: spike.damage,
          cooldown: spike.cooldown,
          selfDamage: spike.selfDamage,
        };
      }

      const bridge = this.world.getComponent<BridgeComponent>(id, C.Bridge);
      if (bridge) {
        saved.bridge = {
          tileX: bridge.tileX,
          tileY: bridge.tileY,
        };
      }

      buildings.push(saved);
    }

    const players: import('@shared/SaveFormat').SavedPlayer[] = [];
    for (const p of this.players.values()) {
      if (p.entityId === null) continue;
      const pos = this.world.getComponent<PositionComponent>(p.entityId, C.Position);
      const hp = this.world.getComponent<HealthComponent>(p.entityId, C.Health);
      const res = this.world.getComponent<ResourcesComponent>(p.entityId, C.Resources);
      if (!pos || !hp || !res) continue;

      players.push({
        playerId: p.playerId,
        displayName: p.displayName,
        slot: p.slot,
        resources: { wood: res.wood, stone: res.stone, iron: res.iron, diamond: res.diamond, gold: res.gold, food: res.food },
        hp: hp.current,
        maxHp: hp.max,
        x: pos.x,
        y: pos.y,
      });
    }

    return {
      formatVersion: 1,
      seed: this.seed,
      currentWave: this.currentWave,
      warehousePool: { ...this.warehousePool },
      spawnOrigin: { ...this.spawnOrigin },
      processedChunks: [...this.processedChunks],
      enemiesKilled: this.enemiesKilled,
      elapsedTime: this.startTime > 0 ? (Date.now() - this.startTime) / 1000 : 0,
      buildings,
      players,
      hostPlayerId: this.hostPlayerId,
      timestamp: Date.now(),
    };
  }

  /** Validate save data before loading. Returns true if valid. */
  private static validateSaveData(save: unknown): save is import('@shared/SaveFormat').SaveData {
    if (!save || typeof save !== 'object') return false;
    const s = save as Record<string, unknown>;
    if (s.formatVersion !== 1) return false;
    if (!Number.isFinite(s.currentWave) || !Number.isInteger(s.currentWave) || (s.currentWave as number) < 1) return false;
    if (!Number.isFinite(s.seed) || !Number.isInteger(s.seed)) return false;
    if (!Number.isFinite(s.enemiesKilled) || (s.enemiesKilled as number) < 0) return false;
    if (!Number.isFinite(s.elapsedTime) || (s.elapsedTime as number) < 0) return false;
    const wp = s.warehousePool;
    if (!wp || typeof wp !== 'object') return false;
    const pool = wp as Record<string, unknown>;
    for (const key of ['wood', 'stone', 'iron', 'diamond', 'gold', 'food']) {
      if (!Number.isFinite(pool[key]) || (pool[key] as number) < 0) return false;
    }
    const origin = s.spawnOrigin as Record<string, unknown> | undefined;
    if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return false;
    if (!Array.isArray(s.buildings)) return false;
    const validBuildings = new Set(['campfire', 'wall', 'warehouse', 'lumbermill', 'quarry', 'mine', 'farm', 'arrow_turret', 'cannon_turret', 'spike_trap', 'bridge']);
    for (const b of s.buildings as Record<string, unknown>[]) {
      if (!b || typeof b !== 'object') return false;
      if (!validBuildings.has(b.buildingType as string)) return false;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return false;
      if (!Number.isFinite(b.currentHp) || (b.currentHp as number) <= 0) return false;
      if (!Number.isFinite(b.maxHp) || (b.maxHp as number) <= 0) return false;
      if (!Number.isInteger(b.upgradeLevel) || (b.upgradeLevel as number) < 1 || (b.upgradeLevel as number) > 5) return false;
    }
    if (!Array.isArray(s.players)) return false;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const p of s.players as Record<string, unknown>[]) {
      if (!p || typeof p !== 'object') return false;
      if (typeof p.playerId !== 'string' || !uuidRe.test(p.playerId)) return false;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    }
    return true;
  }

  /** Load a save into the session. Called after construction but before start(). */
  loadSave(save: import('@shared/SaveFormat').SaveData, _send: SendFn): boolean {
    if (!GameSession.validateSaveData(save)) {
      console.warn('[GameSession] Invalid save data — starting fresh');
      return false;
    }
    console.log(`[GameSession] Loading save: wave ${save.currentWave}, ${save.buildings.length} buildings, ${save.players.length} players`);
    this.currentWave = save.currentWave;
    this.warehousePool = { ...save.warehousePool };
    this.spawnOrigin = { ...save.spawnOrigin };
    this.processedChunks = new Set(save.processedChunks);
    this.enemiesKilled = save.enemiesKilled;
    // elapsedTime is tracked via startTime offset
    this.savedElapsedTime = save.elapsedTime;
    // Migrate old 'mine' (stone) → 'quarry' for save compatibility
    this.savedBuildings = save.buildings.map(b => {
      if (b.buildingType === 'mine' && b.production?.resourceType === 'stone') {
        return { ...b, buildingType: 'quarry' as const };
      }
      return b;
    });
    this.savedPlayers = save.players;
    return true;
  }

  /** Stored save data for deferred restoration (applied during start()). */
  private savedElapsedTime = 0;
  private savedBuildings: import('@shared/SaveFormat').SavedBuilding[] = [];
  private savedPlayers: import('@shared/SaveFormat').SavedPlayer[] = [];

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
      if (!this.isWalkable(ex, ey)) continue;

      this.spawnEnemy(ex, ey);
      spawned++;
    }
    console.log(`[Debug] Spawned ${spawned}/${n} enemies around player ${player.slot}`);
  }

  /** Skip the wave prep timer - immediately spawn portals and go active. */
  debugWaveSkip(send: (client: ConnectedClient, msg: object) => void): void {
    if (this.phase !== 'playing') return;
    if (this.wavePhase !== 'prep') return;

    this.prepTimer = 0; // tickWave will handle the transition on next tick
    this.wavePaused = false; // un-pause if paused so the skip takes effect
    this.broadcastWaveTimerSync(send);
    console.log(`[Debug] Skipping wave ${this.currentWave} prep timer`);
  }

  /** Toggle pause/resume on the wave timer (prep countdown + portal spawns). */
  debugWavePause(send: (client: ConnectedClient, msg: object) => void): void {
    if (this.phase !== 'playing') return;

    this.wavePaused = !this.wavePaused;
    this.broadcastWaveTimerSync(send);
    console.log(`[Debug] Wave timer ${this.wavePaused ? 'PAUSED' : 'RESUMED'}`);
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

  /** Send authoritative wave timer state to all clients. */
  private broadcastWaveTimerSync(send: (client: ConnectedClient, msg: object) => void): void {
    const sync: WaveTimerSyncMessage = {
      type: MessageType.WAVE_TIMER_SYNC,
      waveNumber: this.currentWave,
      remaining: this.wavePhase === 'prep' ? this.prepTimer : -1,
      paused: this.wavePaused,
    };
    for (const p of this.players.values()) send(p.client, sync);
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
      this.paused = !this.paused;
      this.pauseVotes.clear();
      const stateMsg: PauseStateMessage = {
        type: MessageType.PAUSE_STATE,
        paused: this.paused,
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
      this.paused = !this.paused;
      this.pauseVotes.clear();
      const stateMsg: PauseStateMessage = {
        type: MessageType.PAUSE_STATE,
        paused: this.paused,
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
      this.paused = false;
      this.pauseVotes.clear();
      const stateMsg: PauseStateMessage = {
        type: MessageType.PAUSE_STATE,
        paused: false,
      };
      for (const p of this.players.values()) send(p.client, stateMsg);
      return;
    }

    // If pending votes now satisfy threshold (removed player was the holdout)
    if (this.pauseVotes.size > 0 && this.pauseVotes.size >= this.players.size) {
      this.paused = !this.paused;
      this.pauseVotes.clear();
      const stateMsg: PauseStateMessage = {
        type: MessageType.PAUSE_STATE,
        paused: this.paused,
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
    if (this.phase !== 'playing' || this.paused) return;
    this.tick++;

    // Spawn resources near players (chunk-based, processed chunks are skipped)
    this.generateResourcesNearPlayers();

    this.combat.update(this.world, dt);
    const enemyResult = this.enemy.update(this.world, dt);
    this.movement.update(this.world, dt);

    // Broadcast enemy attack animations
    for (const ap of enemyResult.attackPerformed) {
      const performed: AttackPerformedMessage = {
        type: MessageType.ATTACK_PERFORMED,
        sourceId: ap.sourceId,
        facing: ap.facing,
      };
      for (const p of this.players.values()) send(p.client, performed);
    }

    // Broadcast enemy hit results
    for (const hit of enemyResult.hits) {
      const hitMsg: HitMessage = { type: MessageType.HIT, ...hit };
      for (const p of this.players.values()) send(p.client, hitMsg);
    }

    // Spawn ranger projectiles
    for (const ra of enemyResult.rangedAttacks) {
      const dirX = Math.cos(ra.facing);
      const dirY = Math.sin(ra.facing);
      const offset = ENEMY_RADIUS + PROJECTILE_RADIUS + 2;
      const spawnX = ra.x + dirX * offset;
      const spawnY = ra.y + dirY * offset;
      const vx = dirX * ENEMY_RANGER_PROJECTILE_SPEED;
      const vy = dirY * ENEMY_RANGER_PROJECTILE_SPEED;

      const projId = this.world.createEntity();
      this.world.addComponent(projId, C.Position,   { x: spawnX, y: spawnY });
      this.world.addComponent(projId, C.Velocity,   { vx, vy });
      this.world.addComponent(projId, C.Projectile, { ownerId: ra.sourceId, damage: ENEMY_RANGER_DAMAGE, lifetime: RANGED_LIFETIME });
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
    this.destroyDeadEntities(enemyResult.deaths, undefined, send);

    // Projectile movement, collision, and cleanup
    const projResult = this.projectile.update(this.world, dt);

    for (const hit of projResult.hits) {
      const hitMsg: HitMessage = { type: MessageType.HIT, ...hit };
      for (const p of this.players.values()) send(p.client, hitMsg);
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
    this.destroyDeadEntities(projResult.deaths, projAttackerMap, send);

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
      this.tickDownedPlayers(dt, send);
      this.tickRespawnTimers(dt, send);
    }

    // ── Warehouse auto-deposit ─────────────────────────────────────────────
    this.tickWarehouseDeposit(send);

    // ── Production, turrets, spike traps ────────────────────────────────────
    this.tickProduction(dt, send);
    if (!this.gameOver) this.tickTurrets(dt, send);
    if (!this.gameOver) this.tickSpikeTraps(dt, send);

    // ── Wave state machine ────────────────────────────────────────────────────
    if (!this.gameOver) this.tickWave(dt, send);

    const delta = this.buildDelta();
    for (const p of this.players.values()) {
      const playerDelta: DeltaMessage = {
        ...delta,
        lastSeq: p.lastSeq,
      };
      send(p.client, playerDelta);
    }

    // prevSnapshot is now updated inline by buildDelta()
  }

  // ── Snapshot / Delta builders ────────────────────────────────────────────────

  private buildFullSnapshot(): SnapshotMessage {
    const entities = this.gatherEntitySnapshots();
    return { type: MessageType.SNAPSHOT, tick: this.tick, entities };
  }

  private buildDelta(): Omit<DeltaMessage, 'lastSeq'> {
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
      serverStats: {
        wave: this.currentWave,
        enemyCount: this.enemyCount,
        portalCount,
        playerCount: this.players.size,
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

      // Enemy variant
      const ev = this.world.getComponent<EnemyVariantComponent>(id, C.EnemyVariant);
      if (ev) snap.enemyVariant = ev.variant;

      // Downed state
      if (this.world.hasComponent(id, C.Downed)) snap.downed = true;

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
      prev.resourceType !== curr.resourceType ||
      prev.itemType !== curr.itemType ||
      prev.buildingType !== curr.buildingType ||
      prev.upgradeLevel !== curr.upgradeLevel ||
      prev.productionStored !== curr.productionStored
    );
  }

  // ── Death & Respawn (4.11) ───────────────────────────────────────────────

  /** Check if a player entity should enter downed state after taking lethal damage. */
  private checkPlayerDowned(entityId: number, send: SendFn): void {
    if (this.gameOver) return;
    if (!this.playerEntityIds.has(entityId)) return;
    if (this.world.hasComponent(entityId, C.Downed)) return; // already downed

    // Skip if already dead and awaiting respawn
    const spCheck = this.findSessionPlayerByEntity(entityId);
    if (spCheck && this.respawnTimers.has(spCheck.client.id)) return;

    const hp = this.world.getComponent<HealthComponent>(entityId, C.Health);
    if (!hp || hp.current > 0) return;

    const isSolo = this.players.size <= 1;

    // Solo 2nd death: immediate game over (no timer)
    if (isSolo && this.wipeCount >= 1) {
      this.world.addComponent(entityId, C.Downed, {
        bleedTimer: 0, reviveProgress: 0, reviverId: -1,
      });
      this.handlePartyWipe(send);
      return;
    }

    // Solo 1st death: 15s respawn timer
    // Co-op: 30s bleed-out, teammates can revive
    const bleedTime = isSolo ? 15 : DOWNED_BLEED_TIME;

    this.world.addComponent(entityId, C.Downed, {
      bleedTimer: bleedTime,
      reviveProgress: 0,
      reviverId: -1,
    });

    // Zero out their input so they stop moving
    const inp = this.world.getComponent<PlayerInputComponent>(entityId, C.PlayerInput);
    if (inp) { inp.dx = 0; inp.dy = 0; inp.sprint = false; }

    const sp = this.findSessionPlayerByEntity(entityId);
    const msg: PlayerDownedMessage = {
      type: MessageType.PLAYER_DOWNED,
      entityId,
      slot: sp?.slot ?? -1,
      bleedTimer: bleedTime,
    };
    for (const p of this.players.values()) send(p.client, msg);
    console.log(`[Death] Player ${sp?.slot ?? '?'} downed (${bleedTime}s ${isSolo ? 'respawn' : 'bleed-out'})`);

    // Co-op: check if ALL players are now downed/dead → party wipe
    if (!isSolo && this.countAlivePlayers() === 0) {
      this.handlePartyWipe(send);
    }
  }

  /** Tick bleed timers and revive progress for all downed players. */
  private tickDownedPlayers(dt: number, send: SendFn): void {
    for (const id of this.world.query(C.Downed, C.Position)) {
      // Skip dead players awaiting respawn - they keep Downed but don't tick
      const spDown = this.findSessionPlayerByEntity(id);
      if (spDown && this.respawnTimers.has(spDown.client.id)) continue;

      const downed = this.world.getComponent<DownedComponent>(id, C.Downed)!;

      // Tick bleed-out timer
      downed.bleedTimer -= dt;
      if (downed.bleedTimer <= 0) {
        // Solo: party wipe handles penalty + instant respawn
        if (this.players.size <= 1) {
          this.handlePartyWipe(send);
        } else {
          this.handlePlayerDeath(id, send);
        }
        continue;
      }

      // Check revive progress
      if (downed.reviverId >= 0) {
        const reviverPos = this.world.getComponent<PositionComponent>(downed.reviverId, C.Position);
        const myPos = this.world.getComponent<PositionComponent>(id, C.Position);
        const reviverDowned = this.world.hasComponent(downed.reviverId, C.Downed);

        if (!reviverPos || !myPos || reviverDowned) {
          // Reviver invalid - cancel
          downed.reviverId = -1;
          downed.reviveProgress = 0;
          this.broadcastReviveProgress(id, 0, -1, send);
        } else {
          const rdx = reviverPos.x - myPos.x;
          const rdy = reviverPos.y - myPos.y;
          if (rdx * rdx + rdy * rdy > REVIVE_RANGE * REVIVE_RANGE) {
            // Reviver moved out of range - cancel
            downed.reviverId = -1;
            downed.reviveProgress = 0;
            this.broadcastReviveProgress(id, 0, -1, send);
          } else {
            // Revive in progress
            downed.reviveProgress += dt;
            this.broadcastReviveProgress(id, downed.reviveProgress / REVIVE_DURATION, downed.reviverId, send);

            if (downed.reviveProgress >= REVIVE_DURATION) {
              this.revivePlayer(id, send);
            }
          }
        }
      }
    }
  }

  /** Broadcast revive progress to all clients. */
  private broadcastReviveProgress(targetId: number, progress: number, reviverId: number, send: SendFn): void {
    const msg: ReviveProgressMessage = {
      type: MessageType.REVIVE_PROGRESS,
      targetId,
      progress: Math.min(1, progress),
      reviverId,
    };
    for (const p of this.players.values()) send(p.client, msg);
  }

  /** Revive a downed player (restore HP, remove Downed component). */
  private revivePlayer(entityId: number, send: SendFn): void {
    const hp = this.world.getComponent<HealthComponent>(entityId, C.Health);
    if (hp) {
      hp.current = Math.round(hp.max * REVIVE_HP_PERCENT);
    }
    this.world.removeComponent(entityId, C.Downed);

    const sp = this.findSessionPlayerByEntity(entityId);
    const msg: PlayerRevivedMessage = {
      type: MessageType.PLAYER_REVIVED,
      entityId,
      slot: sp?.slot ?? -1,
      hp: hp?.current ?? 0,
    };
    for (const p of this.players.values()) send(p.client, msg);
    console.log(`[Death] Player ${sp?.slot ?? '?'} revived at ${hp?.current ?? 0} HP`);
  }

  /** Handle full player death (bleed-out expired). Start respawn timer. */
  private handlePlayerDeath(entityId: number, send: SendFn): void {
    const sp = this.findSessionPlayerByEntity(entityId);
    if (!sp) return;

    // Keep Downed component so enemies ignore this entity until respawn.
    // respawnPlayer() removes it when the player actually respawns.

    // Zero velocity
    const vel = this.world.getComponent<VelocityComponent>(entityId, C.Velocity);
    if (vel) { vel.vx = 0; vel.vy = 0; }

    // Start respawn timer
    this.respawnTimers.set(sp.client.id, RESPAWN_DELAY);

    const msg: PlayerDiedMessage = {
      type: MessageType.PLAYER_DIED,
      entityId,
      slot: sp.slot,
      respawnTimer: RESPAWN_DELAY,
    };
    for (const p of this.players.values()) send(p.client, msg);
    console.log(`[Death] Player ${sp.slot} died - respawn in ${RESPAWN_DELAY}s`);
  }

  /** Tick respawn timers and respawn players when ready. */
  private tickRespawnTimers(dt: number, send: SendFn): void {
    for (const [clientId, timer] of this.respawnTimers) {
      const remaining = timer - dt;
      if (remaining <= 0) {
        this.respawnTimers.delete(clientId);
        this.respawnPlayer(clientId, send);
      } else {
        this.respawnTimers.set(clientId, remaining);
      }
    }
  }

  /** Respawn a player at the spawn origin with full HP. */
  private respawnPlayer(clientId: string, send: SendFn): void {
    const sp = this.players.get(clientId);
    if (!sp || sp.entityId === null) return;

    const hp = this.world.getComponent<HealthComponent>(sp.entityId, C.Health);
    if (hp) { hp.current = hp.max; }

    const pos = this.world.getComponent<PositionComponent>(sp.entityId, C.Position);
    const OFFSET = 72;
    const offsets = [
      { dx: -OFFSET, dy: -OFFSET }, { dx:  OFFSET, dy: -OFFSET },
      { dx: -OFFSET, dy:  OFFSET }, { dx:  OFFSET, dy:  OFFSET },
    ];
    const off = offsets[sp.slot] ?? { dx: -OFFSET, dy: -OFFSET };
    if (pos) {
      pos.x = this.spawnOrigin.x + off.dx;
      pos.y = this.spawnOrigin.y + off.dy;
    }

    // Clear any lingering Downed component
    this.world.removeComponent(sp.entityId, C.Downed);

    const msg: PlayerRespawnedMessage = {
      type: MessageType.PLAYER_RESPAWNED,
      entityId: sp.entityId,
      slot: sp.slot,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      hp: hp?.max ?? PLAYER_MAX_HEALTH,
    };
    for (const p of this.players.values()) send(p.client, msg);
    console.log(`[Death] Player ${sp.slot} respawned at (${pos?.x ?? 0}, ${pos?.y ?? 0})`);
  }

  /** Count players that are alive (not downed, not waiting to respawn). */
  private countAlivePlayers(): number {
    let count = 0;
    for (const p of this.players.values()) {
      if (p.entityId === null) continue;
      if (this.world.hasComponent(p.entityId, C.Downed)) continue;
      if (this.respawnTimers.has(p.client.id)) continue;
      const hp = this.world.getComponent<HealthComponent>(p.entityId, C.Health);
      if (hp && hp.current > 0) count++;
    }
    return count;
  }

  /** Reverse lookup: entity ID → SessionPlayer. */
  private findSessionPlayerByEntity(entityId: number): SessionPlayer | undefined {
    for (const p of this.players.values()) {
      if (p.entityId === entityId) return p;
    }
    return undefined;
  }

  // ── Wave Wipe (4.12) ─────────────────────────────────────────────────────

  /** Handle a full party wipe (all players downed/dead simultaneously). */
  private handlePartyWipe(send: SendFn): void {
    this.wipeCount++;
    console.log(`[Wipe] Party wipe #${this.wipeCount} on wave ${this.currentWave}`);

    if (this.wipeCount >= 2) {
      // 2nd wipe: game over - halt all death/respawn processing
      this.gameOver = true;
      this.respawnTimers.clear();
      for (const sp of this.players.values()) {
        if (sp.entityId !== null) this.world.removeComponent(sp.entityId, C.Downed);
      }

      const msg: GameOverMessage = {
        type: MessageType.GAME_OVER,
        waveReached: this.currentWave,
        reason: '2nd party wipe - run over',
        enemiesKilled: this.enemiesKilled,
        timePlayed: Math.round((Date.now() - this.startTime) / 1000),
      };
      for (const p of this.players.values()) send(p.client, msg);
      return;
    }

    // 1st wipe: resource penalty + scatter drops + respawn all
    const wipeMsg: PartyWipeMessage = {
      type: MessageType.PARTY_WIPE,
      wipeCount: this.wipeCount,
      outcome: 'penalty',
    };
    for (const p of this.players.values()) send(p.client, wipeMsg);

    // Deduct 25% of each resource and scatter as item drops near spawn
    for (const sp of this.players.values()) {
      if (sp.entityId === null) continue;
      const res = this.world.getComponent<ResourcesComponent>(sp.entityId, C.Resources);
      if (!res) continue;

      for (const key of ['wood', 'stone', 'iron', 'diamond', 'gold', 'food'] as const) {
        const loss = Math.floor(res[key] * WIPE_1_RESOURCE_LOSS_PERCENT);
        if (loss > 0) {
          res[key] -= loss;
          const angle = Math.random() * Math.PI * 2;
          const dist = 50 + Math.random() * 100;
          this.spawnItemDrop(
            this.spawnOrigin.x + Math.cos(angle) * dist,
            this.spawnOrigin.y + Math.sin(angle) * dist,
            key, loss, true,
          );
        }
      }

      // Send updated resource counts
      const update: ResourceUpdateMessage = {
        type: MessageType.RESOURCE_UPDATE,
        wood: res.wood, stone: res.stone, iron: res.iron,
        diamond: res.diamond, gold: res.gold, food: res.food,
      };
      send(sp.client, update);
    }

    // Respawn all players immediately
    for (const [clientId, sp] of this.players) {
      if (sp.entityId === null) continue;
      this.world.removeComponent(sp.entityId, C.Downed);
      this.respawnTimers.delete(clientId);
      this.respawnPlayer(clientId, send);
    }
  }
}
