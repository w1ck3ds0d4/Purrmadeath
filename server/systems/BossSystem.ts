// ---------------------------------------------------------------------------
// BossSystem - spawns boss enemies and handles their special abilities
// ---------------------------------------------------------------------------

import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  HealthComponent,
  VelocityComponent,
  BossComponent,
} from '@shared/components';
import type { EnemyStatsComponent } from '@shared/components';
import { getBossForWave, type BossDefinition } from '@shared/definitions/BossDefinitions';
import {
  ENEMY_HP_SCALE_PER_WAVE,
  ENEMY_DAMAGE_SCALE_PER_WAVE,
  PORTAL_MIN_DIST,
  PORTAL_MAX_DIST,
  BOSS_SPAWN_INTERVAL,
  BOSS_FIRST_WAVE,
} from '@shared/constants';
import { MessageType } from '@shared/protocol';
import type { BossIntroMessage, AoeExplosionMessage } from '@shared/protocol';
import type { ConnectedClient } from '../net/ServerSocket';
import type { SessionPlayer, SendFn } from '../core/GameSession';

// ── Dependencies ────────────────────────────────────────────────────────────

export interface BossSystemDeps {
  world: World;
  players: Map<string, SessionPlayer>;
  isWalkable: (wx: number, wy: number) => boolean;
  overlapsBuilding: (wx: number, wy: number, radius?: number) => boolean;
  /** Spawn a regular enemy at position (for Necromancer summons). */
  spawnEnemy: (x: number, y: number) => number | null;
  /** Card debuff multipliers. */
  cards: {
    debuffs: { enemyDamageMult: number; enemySpeedMult: number; enemyKnockbackMult: number };
  };
  /** Track enemy count in wave state. */
  incrementEnemyCount: () => void;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createBossSystem(deps: BossSystemDeps) {
  const { world, players, isWalkable, overlapsBuilding, cards } = deps;

  /** Currently alive boss entity IDs. */
  const activeBosses = new Set<number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getPlayerCenter(): { x: number; y: number } | null {
    let cx = 0, cy = 0, count = 0;
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (pos) { cx += pos.x; cy += pos.y; count++; }
    }
    if (count === 0) return null;
    return { x: cx / count, y: cy / count };
  }

  function findSpawnPos(): { x: number; y: number } | null {
    const center = getPlayerCenter();
    if (!center) return null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = PORTAL_MIN_DIST + Math.random() * (PORTAL_MAX_DIST - PORTAL_MIN_DIST);
      const x = center.x + Math.cos(angle) * dist;
      const y = center.y + Math.sin(angle) * dist;
      if (isWalkable(x, y) && !overlapsBuilding(x, y, 40)) return { x, y };
    }
    return null;
  }

  // ── Boss spawning ───────────────────────────────────────────────────────

  function spawnBoss(wave: number, send: SendFn): number | null {
    const def = getBossForWave(wave);
    if (!def) return null;

    const pos = findSpawnPos();
    if (!pos) return null;

    const hpMult = Math.pow(1 + ENEMY_HP_SCALE_PER_WAVE, wave - 1);
    const dmgMult = Math.pow(1 + ENEMY_DAMAGE_SCALE_PER_WAVE, wave - 1);
    const scaledHp = Math.round(def.hp * hpMult);
    const scaledDmg = Math.round(def.damage * dmgMult * cards.debuffs.enemyDamageMult);

    const id = world.createEntity();
    world.addComponent(id, C.Position, { x: pos.x, y: pos.y });
    world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
    world.addComponent(id, C.Health, { current: scaledHp, max: scaledHp });
    world.addComponent(id, C.Speed, { base: def.speed, multiplier: cards.debuffs.enemySpeedMult });
    world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
    world.addComponent(id, C.Faction, { type: 'enemy', enemyFaction: 'bandits' });
    world.addComponent(id, C.Facing, { angle: 0 });
    world.addComponent(id, C.AttackCooldown, { remaining: 0, max: def.cooldown });
    world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    world.addComponent(id, C.EnemyVariant, { variant: 'titan' }); // bosses use titan variant for AI targeting
    world.addComponent(id, C.EnemyStats, {
      damage: scaledDmg,
      range: def.range,
      knockback: Math.round(def.knockback * cards.debuffs.enemyKnockbackMult),
      radius: def.radius,
      rangedRange: 0,
      projectileSpeed: 0,
      rangedDamage: 0,
      rangedCooldown: def.cooldown,
    });
    world.addComponent(id, C.Boss, {
      bossId: def.id,
      enraged: false,
      specialCooldown: def.specialCooldown,
    } as BossComponent);

    activeBosses.add(id);
    deps.incrementEnemyCount();

    // Broadcast intro
    const intro: BossIntroMessage = {
      type: MessageType.BOSS_INTRO,
      bossId: def.id,
      bossName: def.name,
      entityId: id,
    };
    for (const p of players.values()) send(p.client, intro);
    console.log(`[Boss] Spawned ${def.name} (id=${id}) for wave ${wave}`);

    return id;
  }

  // ── Special abilities ─────────────────────────────────────────────────

  function tickRavager(id: number, boss: BossComponent, dt: number, send: SendFn): void {
    boss.specialCooldown -= dt;
    if (boss.specialCooldown > 0) return;

    const def = getBossForWave(BOSS_FIRST_WAVE)!; // base cooldown
    boss.specialCooldown = boss.enraged ? 5 : 8;

    // Charge: dash toward nearest player
    const pos = world.getComponent<PositionComponent>(id, C.Position);
    const vel = world.getComponent<VelocityComponent>(id, C.Velocity);
    if (!pos || !vel) return;

    const target = findNearestPlayer(pos.x, pos.y);
    if (!target) return;

    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;

    const chargeSpeed = boss.enraged ? 500 : 350;
    vel.vx = (dx / dist) * chargeSpeed;
    vel.vy = (dy / dist) * chargeSpeed;

    // AOE slam at endpoint (broadcast after short delay handled by explosion)
    const aoe: AoeExplosionMessage = {
      type: MessageType.AOE_EXPLOSION,
      x: pos.x,
      y: pos.y,
      radius: boss.enraged ? 80 : 60,
    };
    for (const p of players.values()) send(p.client, aoe);
  }

  function tickNecromancer(id: number, boss: BossComponent, dt: number, send: SendFn): void {
    boss.specialCooldown -= dt;
    if (boss.specialCooldown > 0) return;

    boss.specialCooldown = boss.enraged ? 6 : 10;

    const pos = world.getComponent<PositionComponent>(id, C.Position);
    if (!pos) return;

    // Summon minions around self
    const count = boss.enraged ? 6 : 3;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const sx = pos.x + Math.cos(angle) * 60;
      const sy = pos.y + Math.sin(angle) * 60;
      const eid = deps.spawnEnemy(sx, sy);
      if (eid !== null) deps.incrementEnemyCount();
    }
  }

  function tickShadowLord(id: number, boss: BossComponent, dt: number, send: SendFn): void {
    boss.specialCooldown -= dt;
    if (boss.specialCooldown > 0) return;

    boss.specialCooldown = boss.enraged ? 8 : 12;

    const pos = world.getComponent<PositionComponent>(id, C.Position);
    if (!pos) return;

    // Teleport to random player
    const target = findRandomPlayer();
    if (!target) return;

    // Visual effect at old position
    const aoe: AoeExplosionMessage = {
      type: MessageType.AOE_EXPLOSION,
      x: pos.x,
      y: pos.y,
      radius: 50,
    };
    for (const p of players.values()) send(p.client, aoe);

    // Teleport
    pos.x = target.x + (Math.random() - 0.5) * 80;
    pos.y = target.y + (Math.random() - 0.5) * 80;
  }

  function findNearestPlayer(x: number, y: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (!pos) continue;
      const dx = pos.x - x;
      const dy = pos.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = { x: pos.x, y: pos.y }; }
    }
    return best;
  }

  function findRandomPlayer(): { x: number; y: number } | null {
    const alive: { x: number; y: number }[] = [];
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (pos) alive.push({ x: pos.x, y: pos.y });
    }
    if (alive.length === 0) return null;
    return alive[Math.floor(Math.random() * alive.length)];
  }

  // ── Enrage check ──────────────────────────────────────────────────────

  function checkEnrage(id: number, boss: BossComponent): void {
    if (boss.enraged) return;
    const hp = world.getComponent<HealthComponent>(id, C.Health);
    if (!hp) return;

    // Find the definition for enrage threshold
    const def = BOSS_DEFINITIONS_MAP[boss.bossId];
    if (!def) return;

    if (hp.current / hp.max <= def.enrageThreshold) {
      boss.enraged = true;
      // Boost speed on enrage
      const spd = world.getComponent<{ base: number; multiplier: number }>(id, C.Speed);
      if (spd) spd.multiplier *= 1.3;
      // Boost damage on enrage
      const stats = world.getComponent<EnemyStatsComponent>(id, C.EnemyStats);
      if (stats) stats.damage = Math.round(stats.damage * 1.2);
      console.log(`[Boss] ${def.name} enraged!`);
    }
  }

  // ── Main tick ─────────────────────────────────────────────────────────

  function tick(dt: number, send: SendFn): void {
    const toRemove: number[] = [];

    for (const id of activeBosses) {
      // Check if boss entity still exists
      const hp = world.getComponent<HealthComponent>(id, C.Health);
      if (!hp || hp.current <= 0) {
        toRemove.push(id);
        continue;
      }

      const boss = world.getComponent<BossComponent>(id, C.Boss);
      if (!boss) { toRemove.push(id); continue; }

      checkEnrage(id, boss);

      // Tick special ability based on boss type
      switch (boss.bossId) {
        case 'ravager': tickRavager(id, boss, dt, send); break;
        case 'necromancer': tickNecromancer(id, boss, dt, send); break;
        case 'shadow_lord': tickShadowLord(id, boss, dt, send); break;
      }
    }

    for (const id of toRemove) activeBosses.delete(id);
  }

  // ── Queries ───────────────────────────────────────────────────────────

  function isBoss(entityId: number): boolean {
    return activeBosses.has(entityId);
  }

  function onBossDeath(entityId: number): void {
    activeBosses.delete(entityId);
  }

  function getActiveBossCount(): number {
    return activeBosses.size;
  }

  function reset(): void {
    activeBosses.clear();
  }

  return {
    tick,
    spawnBoss,
    isBoss,
    onBossDeath,
    getActiveBossCount,
    reset,
  };
}

export type BossSystem = ReturnType<typeof createBossSystem>;

// ── Helper lookup ───────────────────────────────────────────────────────────

import { BOSS_DEFINITIONS } from '@shared/definitions/BossDefinitions';

const BOSS_DEFINITIONS_MAP: Record<string, typeof BOSS_DEFINITIONS[number]> = {};
for (const def of BOSS_DEFINITIONS) BOSS_DEFINITIONS_MAP[def.id] = def;
