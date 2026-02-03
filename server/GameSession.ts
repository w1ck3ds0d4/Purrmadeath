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
} from '@shared/components';
import {
  TILE_SIZE,
  PLAYER_RADIUS,
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
} from '@shared/constants';
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
} from '@shared/protocol';
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
  /** 4-letter code shown in the lobby — used by joiners to find this session. */
  readonly code: string;

  private world = new World();
  private generator: WorldGenerator;
  private movement: MovementSystem;
  private enemy: EnemySystem;
  private combat: CombatSystem;
  private projectile: ProjectileSystem;
  private portal: PortalSystem;

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

    // Find a single walkable origin and spread players around it
    const origin = findSpawnPoint(this.generator);
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
    if (!Number.isFinite(msg.facing)) return;
    if (msg.attackType !== 'melee' && msg.attackType !== 'ranged') return;
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;

    if (msg.attackType === 'ranged') {
      this.handleRangedAttack(player, msg.facing, send);
    } else {
      this.handleMeleeAttack(player, msg, send);
    }
  }

  private handleMeleeAttack(
    player: SessionPlayer,
    msg: AttackMessage,
    send: (client: ConnectedClient, m: object) => void,
  ): void {
    const { hits, deaths } = this.combat.processMeleeAttack(
      this.world,
      player.entityId!,
      msg.facing,
      { x: msg.x, y: msg.y },
    );

    // Broadcast attack animation to all players (fires even on miss)
    const performed: AttackPerformedMessage = {
      type: MessageType.ATTACK_PERFORMED,
      sourceId: player.entityId!,
      facing: msg.facing,
    };
    for (const p of this.players.values()) send(p.client, performed);

    // Broadcast each hit to all players
    for (const hit of hits) {
      const hitMsg: HitMessage = { type: MessageType.HIT, ...hit };
      for (const p of this.players.values()) send(p.client, hitMsg);
    }

    // Remove dead non-player entities; player death handled in 4.11
    this.destroyDeadEntities(deaths);
  }

  private handleRangedAttack(
    player: SessionPlayer,
    facing: number,
    send: (client: ConnectedClient, m: object) => void,
  ): void {
    const entityId = player.entityId!;

    // Enforce cooldown
    const cd = this.world.getComponent<AttackCooldownComponent>(entityId, C.AttackCooldown);
    if (cd && cd.remaining > 0) return;
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

  /** Destroy dead non-player entities (enemies and portals) from the world. */
  private destroyDeadEntities(deaths: number[]): void {
    for (const deadId of deaths) {
      if (this.playerEntityIds.has(deadId)) continue;
      const faction = this.world.getComponent<FactionComponent>(deadId, C.Faction);
      if (faction?.type === 'enemy') this.enemyCount--;
      this.world.destroyEntity(deadId);
    }
  }

  // ── Wave logic ──────────────────────────────────────────────────────────────

  private tickWave(dt: number, send: (client: ConnectedClient, msg: object) => void): void {
    if (this.wavePaused) return;

    if (this.wavePhase === 'prep') {
      this.prepTimer -= dt;

      // Periodic drift correction — sync clients every WAVE_SYNC_INTERVAL
      this.waveSyncTimer += dt;
      if (this.waveSyncTimer >= GameSession.WAVE_SYNC_INTERVAL) {
        this.waveSyncTimer = 0;
        this.broadcastWaveTimerSync(send);
      }

      if (this.prepTimer <= 0) {
        // Prep ended — spawn portals and go active
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
        // Wave cleared — broadcast WAVE_END, start next wave prep
        const waveEnd: WaveEndMessage = {
          type: MessageType.WAVE_END,
          waveNumber: this.currentWave,
          outcome: 'cleared',
        };
        for (const p of this.players.values()) send(p.client, waveEnd);

        this.currentWave++;
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

  /** Skip the wave prep timer — immediately spawn portals and go active. */
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

    // Destroy non-player entities killed by enemy attacks (player death deferred to 4.11)
    this.destroyDeadEntities(enemyResult.deaths);

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

    // Destroy dead non-player entities hit by projectiles
    this.destroyDeadEntities(projResult.deaths);

    // ── Wave state machine ────────────────────────────────────────────────────
    this.tickWave(dt, send);

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

    return { type: MessageType.DELTA, tick: this.tick, entities: changed, removed };
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

      snaps.push({
        entityId: id,
        slot: playerEntry?.slot,
        faction,
        x: pos.x,
        y: pos.y,
        vx: vel.vx,
        vy: vel.vy,
        hp: hp.current,
        maxHp: hp.max,
      });
    }
    return snaps;
  }

  private entityChanged(prev: EntitySnapshot, curr: EntitySnapshot): boolean {
    return (
      prev.x !== curr.x || prev.y !== curr.y ||
      prev.vx !== curr.vx || prev.vy !== curr.vy ||
      prev.hp !== curr.hp
    );
  }
}
