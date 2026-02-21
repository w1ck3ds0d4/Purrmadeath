import { World } from '@shared/ecs/World';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import {
  C,
  PositionComponent,
  HealthComponent,
  FactionComponent,
  EnemyVariantComponent,
} from '@shared/components';
import type { EnemyVariantType, EnemyStatsComponent } from '@shared/components';
import { ENEMY_VARIANT_STATS, pickEnemyVariant, ENEMY_VARIANT_NAMES } from '@shared/EnemyVariants';
import {
  TILE_SIZE,
  PORTAL_BASE_HP,
  PORTAL_HP_PER_WAVE,
  PORTAL_BASE_SPAWN_INTERVAL,
  PORTAL_SPAWN_INTERVAL_DECAY,
  PORTALS_PER_WAVE_BASE,
  PORTALS_PER_WAVE_GROWTH,
  PORTAL_MIN_DIST,
  PORTAL_MAX_DIST,
  PORTAL_MIN_SPACING,
  PORTAL_RADIUS,
  WAVE_PREP_BETWEEN,
  ENEMY_RADIUS,
  ENEMY_HP_SCALE_PER_WAVE,
  ENEMY_DAMAGE_SCALE_PER_WAVE,
  PORTAL_EXTRA_SPAWN_EVERY_N_WAVES,
} from '@shared/constants';
import { MessageType } from '@shared/protocol';
import type { WaveStartMessage, WaveEndMessage, WaveTimerSyncMessage } from '@shared/protocol';
import type { ConnectedClient } from '../net/ServerSocket';
import type { SessionPlayer, SendFn } from '../GameSession';
import type { PortalSystem } from './PortalSystem';

// ── Mutable state shared with GameSession ───────────────────────────────────

export interface WaveState {
  phase: 'idle' | 'prep' | 'active';
  currentWave: number;
  prepTimer: number;
  paused: boolean;
  syncTimer: number;
  enemyCount: number;
  wipeCount: number;
  introducedTypes: Set<EnemyVariantType>;
  pendingIntros: { variant: string; displayName: string }[];
}

// ── Dependencies ────────────────────────────────────────────────────────────

export interface WaveControllerDeps {
  world: World;
  generator: WorldGenerator;
  portal: PortalSystem;
  state: WaveState;
  players: Map<string, SessionPlayer>;
  cards: {
    debuffs: { enemyDamageMult: number; enemySpeedMult: number };
  };
  maxEnemies: number;
  waveSyncInterval: number;
  isWalkable: (wx: number, wy: number) => boolean;
  overlapsBuilding: (wx: number, wy: number, radius?: number) => boolean;
  onWaveCleared: (wave: number, send: SendFn) => void;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createWaveController(deps: WaveControllerDeps) {
  const {
    world, generator, portal,
    players, cards,
    isWalkable, overlapsBuilding, onWaveCleared,
  } = deps;
  const s = deps.state;

  // ── Portal spawning ──────────────────────────────────────────────────────

  function spawnPortal(x: number, y: number, wave: number): number {
    const hp = PORTAL_BASE_HP + PORTAL_HP_PER_WAVE * wave;
    const interval = PORTAL_BASE_SPAWN_INTERVAL * Math.pow(PORTAL_SPAWN_INTERVAL_DECAY, wave - 1);
    const id = world.createEntity();
    world.addComponent(id, C.Position, { x, y });
    world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
    world.addComponent(id, C.Health, { current: hp, max: hp });
    world.addComponent(id, C.Faction, { type: 'portal' });
    world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    world.addComponent(id, C.Portal, { waveNumber: wave, spawnTimer: interval, spawnInterval: interval });
    return id;
  }

  function spawnPortals(wave: number): void {
    let cx = 0, cy = 0, count = 0;
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (pos) { cx += pos.x; cy += pos.y; count++; }
    }
    if (count === 0) return;
    cx /= count; cy /= count;

    const numPortals = PORTALS_PER_WAVE_BASE + PORTALS_PER_WAVE_GROWTH * (wave - 1);
    const placed: { x: number; y: number }[] = [];

    for (let i = 0; i < numPortals; i++) {
      let bestX = 0, bestY = 0, found = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = PORTAL_MIN_DIST + Math.random() * (PORTAL_MAX_DIST - PORTAL_MIN_DIST);
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;

        if (!isWalkable(px, py)) continue;
        if (overlapsBuilding(px, py, PORTAL_RADIUS)) continue;

        let tooClose = false;
        for (const prev of placed) {
          const ddx = px - prev.x, ddy = py - prev.y;
          if (ddx * ddx + ddy * ddy < PORTAL_MIN_SPACING * PORTAL_MIN_SPACING) { tooClose = true; break; }
        }
        if (tooClose) continue;

        bestX = px; bestY = py; found = true; break;
      }
      if (found) { spawnPortal(bestX, bestY, wave); placed.push({ x: bestX, y: bestY }); }
    }
    console.log(`[Wave] Spawned ${placed.length}/${numPortals} portals for wave ${wave}`);
  }

  // ── Enemy spawning ───────────────────────────────────────────────────────

  function spawnEnemy(x: number, y: number): number | null {
    if (s.enemyCount >= deps.maxEnemies) return null;

    const variant = pickEnemyVariant(s.currentWave);
    const base = ENEMY_VARIANT_STATS[variant];
    const wave = Math.max(1, s.currentWave);
    const hpMult = Math.pow(1 + ENEMY_HP_SCALE_PER_WAVE, wave - 1);
    const dmgMult = Math.pow(1 + ENEMY_DAMAGE_SCALE_PER_WAVE, wave - 1);
    const scaledHp = Math.round(base.hp * hpMult);
    const scaledDmg = Math.round(base.damage * dmgMult * cards.debuffs.enemyDamageMult);

    const id = world.createEntity();
    world.addComponent(id, C.Position, { x, y });
    world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
    world.addComponent(id, C.Health, { current: scaledHp, max: scaledHp });
    world.addComponent(id, C.Speed, { base: base.speed, multiplier: cards.debuffs.enemySpeedMult });
    world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
    world.addComponent(id, C.Faction, { type: 'enemy', enemyFaction: 'bandits' });
    world.addComponent(id, C.Facing, { angle: 0 });
    world.addComponent(id, C.AttackCooldown, { remaining: 0, max: base.rangedCooldown ?? base.cooldown });
    world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    world.addComponent(id, C.EnemyVariant, { variant });
    world.addComponent(id, C.EnemyStats, {
      damage: scaledDmg, range: base.range, knockback: base.knockback, radius: base.radius,
      rangedRange: base.rangedRange ?? 0, projectileSpeed: base.projectileSpeed ?? 0,
      rangedDamage: Math.round((base.rangedDamage ?? 0) * dmgMult * cards.debuffs.enemyDamageMult),
      rangedCooldown: base.rangedCooldown ?? base.cooldown,
    });

    if (variant === 'ghost') world.addComponent(id, C.GhostState, { hidden: true });
    if (variant === 'assassin') {
      world.addComponent(id, C.AssassinDash, {
        cooldown: 0, maxCooldown: 20, dashSpeed: 500, dashDuration: 0.3, dashing: false, dashTimer: 0,
      });
    }

    if (!s.introducedTypes.has(variant) && variant !== 'melee' && variant !== 'ranger') {
      s.introducedTypes.add(variant);
      s.pendingIntros.push({ variant, displayName: ENEMY_VARIANT_NAMES[variant] });
    }

    s.enemyCount++;
    return id;
  }

  // ── Wave timer sync ──────────────────────────────────────────────────────

  function broadcastWaveTimerSync(send: SendFn): void {
    const sync: WaveTimerSyncMessage = {
      type: MessageType.WAVE_TIMER_SYNC,
      waveNumber: s.currentWave,
      remaining: s.phase === 'prep' ? s.prepTimer : -1,
      paused: s.paused,
    };
    for (const p of players.values()) send(p.client, sync);
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  function tick(dt: number, send: SendFn): void {
    if (s.paused) return;

    if (s.phase === 'prep') {
      s.prepTimer -= dt;
      s.syncTimer += dt;
      if (s.syncTimer >= deps.waveSyncInterval) {
        s.syncTimer = 0;
        broadcastWaveTimerSync(send);
      }

      if (s.prepTimer <= 0) {
        spawnPortals(s.currentWave);
        s.phase = 'active';
        const waveActive: WaveStartMessage = {
          type: MessageType.WAVE_START, waveNumber: s.currentWave, prepDuration: 0,
        };
        for (const p of players.values()) send(p.client, waveActive);
      }
    } else if (s.phase === 'active') {
      const extraSpawns = Math.floor(s.currentWave / PORTAL_EXTRA_SPAWN_EVERY_N_WAVES);
      const spawnRequests = portal.update(world, dt, extraSpawns);
      for (const req of spawnRequests) {
        if (isWalkable(req.x, req.y) && !overlapsBuilding(req.x, req.y, ENEMY_RADIUS)) {
          spawnEnemy(req.x, req.y);
        }
      }

      let anyAlive = false;
      for (const id of world.query(C.Portal, C.Health)) {
        const hp = world.getComponent<HealthComponent>(id, C.Health)!;
        if (hp.current > 0) { anyAlive = true; } else { world.destroyEntity(id); }
      }

      if (!anyAlive) {
        const waveEnd: WaveEndMessage = {
          type: MessageType.WAVE_END, waveNumber: s.currentWave, outcome: 'cleared',
        };
        for (const p of players.values()) send(p.client, waveEnd);

        s.currentWave++;
        s.wipeCount = 0;
        s.phase = 'prep';
        s.prepTimer = WAVE_PREP_BETWEEN;

        const waveStart: WaveStartMessage = {
          type: MessageType.WAVE_START, waveNumber: s.currentWave, prepDuration: WAVE_PREP_BETWEEN,
        };
        for (const p of players.values()) send(p.client, waveStart);
        console.log(`[Wave] Wave ${s.currentWave - 1} cleared! Next wave in ${WAVE_PREP_BETWEEN}s`);

        onWaveCleared(s.currentWave - 1, send);
      }
    }
  }

  // ── Debug helpers ────────────────────────────────────────────────────────

  function debugSkip(send: SendFn): void {
    if (s.phase !== 'prep') return;
    s.prepTimer = 0;
    s.paused = false;
    broadcastWaveTimerSync(send);
    console.log(`[Debug] Skipping wave ${s.currentWave} prep timer`);
  }

  function debugPause(send: SendFn): void {
    s.paused = !s.paused;
    broadcastWaveTimerSync(send);
    console.log(`[Debug] Wave timer ${s.paused ? 'PAUSED' : 'RESUMED'}`);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    tick,
    spawnEnemy,
    spawnPortal,
    broadcastWaveTimerSync,
    debugSkip,
    debugPause,
  };
}

export type WaveController = ReturnType<typeof createWaveController>;
