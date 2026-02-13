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
} from '@shared/components';
import type { ResourceType } from '@shared/components';
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

  // ── Run stats ──────────────────────────────────────────────────────────────
  private enemiesKilled = 0;
  private startTime = 0;

  /** Snapshot of entity positions from the previous tick, for delta diffing. */
  private prevSnapshot = new Map<number, EntitySnapshot>();

  /** Whether the game simulation is paused (server-authoritative). */
  private paused = false;
  /** Set of clientIds that have voted for the current pending action. */
  private pauseVotes = new Set<string>();

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
  ): SessionPlayer {
    const slot = this.nextFreeSlot();
    const player: SessionPlayer = {
      client,
      playerId: client.id,
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
    player.playerId = newClient.id;
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
    this.startTime = Date.now();
    this.enemiesKilled = 0;

    // Find a single walkable origin and spread players around it
    const origin = findSpawnPoint(this.generator);
    this.spawnOrigin = origin;
    const OFFSET = 40; // pixels apart
    const offsets = [
      { dx:  0,      dy:  0 },
      { dx:  OFFSET, dy:  0 },
      { dx:  0,      dy:  OFFSET },
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

    // Begin wave 1 prep countdown
    this.currentWave = 1;
    this.wavePhase = 'prep';
    this.prepTimer = WAVE_PREP_INITIAL;

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

    // Broadcast wave 1 prep start
    const waveStart: WaveStartMessage = {
      type: MessageType.WAVE_START,
      waveNumber: this.currentWave,
      prepDuration: WAVE_PREP_INITIAL,
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

    const update: ResourceUpdateMessage = {
      type: MessageType.RESOURCE_UPDATE,
      wood: res.wood,
      stone: res.stone,
      iron: res.iron,
      diamond: res.diamond,
      gold: res.gold,
    };
    send(target.client, update);
  }

  private spawnEnemy(x: number, y: number): number | null {
    if (this.enemyCount >= GameSession.MAX_ENEMIES) return null;
    const id = this.world.createEntity();
    this.world.addComponent(id, C.Position,          { x, y });
    this.world.addComponent(id, C.Velocity,          { vx: 0, vy: 0 });
    this.world.addComponent(id, C.Health,            { current: ENEMY_MAX_HEALTH, max: ENEMY_MAX_HEALTH });
    this.world.addComponent(id, C.Speed,             { base: ENEMY_BASE_SPEED, multiplier: 1 });
    this.world.addComponent(id, C.PlayerInput,       { dx: 0, dy: 0, sprint: false });
    this.world.addComponent(id, C.Faction,           { type: 'enemy' });
    this.world.addComponent(id, C.Facing,            { angle: 0 });
    this.world.addComponent(id, C.AttackCooldown,    { remaining: 0, max: ENEMY_MELEE_COOLDOWN });
    this.world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
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

    // Find nearest non-auto-pickup ItemDrop within interact radius
    const r2 = ITEM_DROP_INTERACT_RADIUS * ITEM_DROP_INTERACT_RADIUS;
    let bestId = -1;
    let bestDist = Infinity;

    for (const id of this.world.query(C.ItemDrop, C.Position)) {
      const drop = this.world.getComponent<ItemDropComponent>(id, C.ItemDrop)!;
      if (drop.autoPickup) continue;

      const dpos = this.world.getComponent<PositionComponent>(id, C.Position)!;
      const dx = dpos.x - playerPos.x;
      const dy = dpos.y - playerPos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2 && d2 < bestDist) {
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
    for (const deadId of deaths) {
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
      }
    }
  }

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
      prev.itemType !== curr.itemType
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

    // Solo: skip downed state - treat as party wipe (penalty progression)
    if (this.players.size <= 1) {
      this.world.addComponent(entityId, C.Downed, {
        bleedTimer: 0,
        reviveProgress: 0,
        reviverId: -1,
      });
      this.handlePartyWipe(send);
      return;
    }

    // Co-op: enter downed state
    this.world.addComponent(entityId, C.Downed, {
      bleedTimer: DOWNED_BLEED_TIME,
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
      bleedTimer: DOWNED_BLEED_TIME,
    };
    for (const p of this.players.values()) send(p.client, msg);
    console.log(`[Death] Player ${sp?.slot ?? '?'} downed (${DOWNED_BLEED_TIME}s bleed-out)`);

    // Check if ALL players are now downed/dead → party wipe
    if (this.countAlivePlayers() === 0) {
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
        this.handlePlayerDeath(id, send);
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
    const offsets = [
      { dx: 0, dy: 0 }, { dx: 40, dy: 0 },
      { dx: 0, dy: 40 }, { dx: 40, dy: 40 },
    ];
    const off = offsets[sp.slot] ?? { dx: 0, dy: 0 };
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

      for (const key of ['wood', 'stone', 'iron', 'diamond', 'gold'] as const) {
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
        diamond: res.diamond, gold: res.gold,
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
