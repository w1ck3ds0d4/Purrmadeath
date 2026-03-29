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
import {
  BOSS_MAP,
  getBossForWave,
  getBossPhaseIndex,
  getBossCountForWave,
  type BossDefinition,
} from '@shared/definitions/BossDefinitions';
import {
  ENEMY_HP_SCALE_PER_WAVE,
  ENEMY_DAMAGE_SCALE_PER_WAVE,
  PORTAL_MIN_DIST,
  PORTAL_MAX_DIST,
  BOSS_SPAWN_INTERVAL,
  BOSS_FIRST_WAVE,
} from '@shared/constants';
import { MessageType } from '@shared/protocol';
import type { BossIntroMessage, BossPhaseMessage, AoeExplosionMessage, MeteorWarningMessage } from '@shared/protocol';
import type { SessionPlayer, SendFn } from '../core/GameSession';

// ── Delayed action queue (replaces setTimeout for safe lifecycle) ─────────

interface DelayedAction {
  timer: number;
  action: (send: SendFn) => void;
}

// ── Dependencies ────────────────────────────────────────────────────────────

export interface BossSystemDeps {
  world: World;
  players: Map<string, SessionPlayer>;
  isWalkable: (wx: number, wy: number) => boolean;
  overlapsBuilding: (wx: number, wy: number, radius?: number) => boolean;
  /** Spawn a regular enemy at position (for Necromancer summons, Broodmother spiders, etc). */
  spawnEnemy: (x: number, y: number) => number | null;
  /** Card debuff multipliers. */
  cards: {
    debuffs: { enemyDamageMult: number; enemySpeedMult: number; enemyKnockbackMult: number };
  };
  /** Track enemy count in wave state. */
  incrementEnemyCount: () => void;
  /** Find a safe spawn position near (wx, wy) that doesn't overlap obstacles. */
  findSafeSpawnNear: (wx: number, wy: number) => { x: number; y: number };
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createBossSystem(deps: BossSystemDeps) {
  const { world, players, isWalkable, overlapsBuilding, cards } = deps;

  /** Currently alive boss entity IDs. */
  const activeBosses = new Set<number>();

  /** Tick-based delayed actions (replaces setTimeout - no stale refs, cleaned on reset). */
  const delayedActions: DelayedAction[] = [];

  /** Schedule a delayed action that runs within the tick loop (safe lifecycle). */
  function scheduleDelayed(delay: number, action: (send: SendFn) => void): void {
    delayedActions.push({ timer: delay, action });
  }

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

  function findNearestPlayer(x: number, y: number): { x: number; y: number; entityId: number } | null {
    let best: { x: number; y: number; entityId: number } | null = null;
    let bestDist = Infinity;
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (!pos) continue;
      const dx = pos.x - x;
      const dy = pos.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = { x: pos.x, y: pos.y, entityId: p.entityId }; }
    }
    return best;
  }

  function findFarthestPlayer(x: number, y: number): { x: number; y: number; entityId: number } | null {
    let best: { x: number; y: number; entityId: number } | null = null;
    let bestDist = -1;
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (!pos) continue;
      const dx = pos.x - x;
      const dy = pos.y - y;
      const d = dx * dx + dy * dy;
      if (d > bestDist) { bestDist = d; best = { x: pos.x, y: pos.y, entityId: p.entityId }; }
    }
    return best;
  }

  function findRandomPlayer(): { x: number; y: number; entityId: number } | null {
    const alive: { x: number; y: number; entityId: number }[] = [];
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (pos) alive.push({ x: pos.x, y: pos.y, entityId: p.entityId });
    }
    if (alive.length === 0) return null;
    return alive[Math.floor(Math.random() * alive.length)];
  }

  function broadcastAll(msg: object, send: SendFn): void {
    for (const p of players.values()) send(p.client, msg);
  }

  function broadcastAoe(x: number, y: number, radius: number, send: SendFn, meteor?: boolean): void {
    const aoe: AoeExplosionMessage = { type: MessageType.AOE_EXPLOSION, x, y, radius, meteor };
    broadcastAll(aoe, send);
  }

  function broadcastMeteorWarning(x: number, y: number, radius: number, delay: number, send: SendFn): void {
    const warn: MeteorWarningMessage = { type: MessageType.METEOR_WARNING, x, y, radius, delay };
    broadcastAll(warn, send);
  }

  /** Apply damage to all alive players within radius (squared) of a point. */
  function damagePlayersInRadius(cx: number, cy: number, radiusSq: number, damage: number): void {
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pPos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (!pPos) continue;
      const dx = pPos.x - cx;
      const dy = pPos.y - cy;
      if (dx * dx + dy * dy < radiusSq) {
        const pHp = world.getComponent<HealthComponent>(p.entityId, C.Health);
        if (pHp) pHp.current = Math.max(0, pHp.current - damage);
      }
    }
  }

  /** Apply knockback to all alive players within radius of a point. */
  function knockbackPlayersInRadius(cx: number, cy: number, radius: number, force: number, damage: number): void {
    const radiusSq = radius * radius;
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pPos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (!pPos) continue;
      const dx = pPos.x - cx;
      const dy = pPos.y - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq < radiusSq && distSq > 0) {
        const dist = Math.sqrt(distSq); // sqrt only needed for direction normalization
        const kb = world.getComponent<{ vx: number; vy: number }>(p.entityId, C.KnockbackReceiver);
        if (kb) {
          kb.vx += (dx / dist) * force;
          kb.vy += (dy / dist) * force;
        }
        if (damage > 0) {
          const pHp = world.getComponent<HealthComponent>(p.entityId, C.Health);
          if (pHp) pHp.current = Math.max(0, pHp.current - damage);
        }
      }
    }
  }

  // ── Boss spawning ───────────────────────────────────────────────────────

  function spawnBoss(wave: number, send: SendFn): number | null {
    const def = getBossForWave(wave);
    if (!def) return null;
    return spawnBossFromDef(def, wave, send);
  }

  function spawnBossFromDef(def: BossDefinition, wave: number, send: SendFn): number | null {
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
    world.addComponent(id, C.EnemyVariant, { variant: 'titan' });
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

    // Initialize ability cooldowns from phase 0
    const abilityCooldowns: Record<string, number> = {};
    for (const ability of def.phases[0].abilities) {
      abilityCooldowns[ability.id] = ability.cooldown * (0.5 + Math.random() * 0.5); // stagger initial
    }

    world.addComponent(id, C.Boss, {
      bossId: def.id,
      phaseIndex: 0,
      abilityCooldowns,
      enraged: false,
      specialCooldown: 0,
    } as BossComponent);

    activeBosses.add(id);
    deps.incrementEnemyCount();

    // Broadcast intro
    const intro: BossIntroMessage = {
      type: MessageType.BOSS_INTRO,
      bossId: def.id,
      bossName: def.name,
      entityId: id,
      description: def.description,
      maxHp: scaledHp,
    };
    broadcastAll(intro, send);
    console.log(`[Boss] Spawned ${def.name} (id=${id}) for wave ${wave}`);

    return id;
  }

  function spawnBossesForWave(wave: number, send: SendFn): number[] {
    const count = getBossCountForWave(wave, BOSS_SPAWN_INTERVAL, BOSS_FIRST_WAVE);
    const spawned: number[] = [];
    for (let i = 0; i < count; i++) {
      const id = spawnBoss(wave, send);
      if (id !== null) spawned.push(id);
    }
    return spawned;
  }

  // ── Phase transitions ─────────────────────────────────────────────────

  function checkPhaseTransition(id: number, boss: BossComponent, send: SendFn): void {
    const def = BOSS_MAP[boss.bossId];
    if (!def) return;

    const hp = world.getComponent<HealthComponent>(id, C.Health);
    if (!hp) return;

    const hpFrac = hp.current / hp.max;
    const newPhaseIdx = getBossPhaseIndex(def, hpFrac);

    if (newPhaseIdx > boss.phaseIndex) {
      boss.phaseIndex = newPhaseIdx;
      const phase = def.phases[newPhaseIdx];

      // Apply phase speed change
      if (phase.speed !== undefined) {
        const spd = world.getComponent<{ base: number; multiplier: number }>(id, C.Speed);
        if (spd) spd.base = phase.speed;
      }

      // Apply damage taken modifier
      if (phase.damageTaken !== undefined) {
        (boss as any).damageTaken = phase.damageTaken;
      }

      // Initialize new ability cooldowns
      for (const ability of phase.abilities) {
        if (boss.abilityCooldowns[ability.id] === undefined) {
          boss.abilityCooldowns[ability.id] = ability.cooldown * 0.3; // quick first use
        }
      }

      // Mark enraged for legacy compat
      if (newPhaseIdx > 0 && !boss.enraged) {
        boss.enraged = true;
        const stats = world.getComponent<EnemyStatsComponent>(id, C.EnemyStats);
        if (stats) stats.damage = Math.round(stats.damage * 1.2);
      }

      // Broadcast phase change
      if (phase.bannerText) {
        const phaseMsg: BossPhaseMessage = {
          type: MessageType.BOSS_PHASE,
          entityId: id,
          bossId: boss.bossId,
          phaseIndex: newPhaseIdx,
          bannerText: phase.bannerText,
        };
        broadcastAll(phaseMsg, send);
        console.log(`[Boss] ${def.name} entered phase ${newPhaseIdx + 1}: ${phase.bannerText}`);
      }
    }
  }

  // ── Ability implementations ───────────────────────────────────────────

  function tickAbilityCooldowns(boss: BossComponent, dt: number): void {
    for (const key of Object.keys(boss.abilityCooldowns)) {
      boss.abilityCooldowns[key] -= dt;
    }
  }

  function isAbilityReady(boss: BossComponent, abilityId: string): boolean {
    return (boss.abilityCooldowns[abilityId] ?? 999) <= 0;
  }

  function resetAbilityCooldown(boss: BossComponent, abilityId: string, def: BossDefinition): void {
    const phase = def.phases[boss.phaseIndex];
    const ability = phase.abilities.find(a => a.id === abilityId);
    boss.abilityCooldowns[abilityId] = ability?.cooldown ?? 10;
  }

  // -- Ravager --
  function tickRavager(id: number, boss: BossComponent, dt: number, send: SendFn): void {
    const def = BOSS_MAP['ravager'];
    const pos = world.getComponent<PositionComponent>(id, C.Position);
    const vel = world.getComponent<VelocityComponent>(id, C.Velocity);
    if (!pos || !vel || !def) return;

    // Charge - needs sqrt for direction normalization
    if (isAbilityReady(boss, 'charge')) {
      const target = findNearestPlayer(pos.x, pos.y);
      if (target) {
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > 1) {
          const dist = Math.sqrt(distSq);
          const chargeSpeed = boss.enraged ? 500 : 350;
          vel.vx = (dx / dist) * chargeSpeed;
          vel.vy = (dy / dist) * chargeSpeed;
          broadcastAoe(pos.x, pos.y, boss.enraged ? 80 : 60, send);
          resetAbilityCooldown(boss, 'charge', def);
        }
      }
    }

    // Ground slam (phase 2)
    if (isAbilityReady(boss, 'ground_slam')) {
      broadcastAoe(pos.x, pos.y, 100, send);
      resetAbilityCooldown(boss, 'ground_slam', def);
      knockbackPlayersInRadius(pos.x, pos.y, 100, 400, 30);
    }
  }

  // -- Necromancer --
  function tickNecromancer(id: number, boss: BossComponent, dt: number, send: SendFn): void {
    const def = BOSS_MAP['necromancer'];
    const pos = world.getComponent<PositionComponent>(id, C.Position);
    if (!pos || !def) return;

    // Bone shield regen (phase 2)
    if (boss.boneShieldHp !== undefined && boss.boneShieldHp <= 0 && boss.boneShieldRegen !== undefined) {
      boss.boneShieldRegen -= dt;
      if (boss.boneShieldRegen <= 0) {
        boss.boneShieldHp = 200;
        boss.boneShieldRegen = undefined;
      }
    }

    // Bone shield init (phase 2)
    if (boss.phaseIndex >= 1 && boss.boneShieldHp === undefined) {
      boss.boneShieldHp = 200;
    }

    // Summon minions
    if (isAbilityReady(boss, 'summon')) {
      const count = boss.enraged ? 6 : 3;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count;
        const rawX = pos.x + Math.cos(angle) * 60;
        const rawY = pos.y + Math.sin(angle) * 60;
        const safe = deps.findSafeSpawnNear(rawX, rawY);
        const eid = deps.spawnEnemy(safe.x, safe.y);
        if (eid !== null) deps.incrementEnemyCount();
      }
      resetAbilityCooldown(boss, 'summon', def);
    }

    // Death bolt
    if (isAbilityReady(boss, 'death_bolt')) {
      const target = findNearestPlayer(pos.x, pos.y);
      if (target) {
        broadcastAoe(target.x, target.y, 30, send);
        const pHp = world.getComponent<HealthComponent>(target.entityId, C.Health);
        if (pHp) pHp.current = Math.max(0, pHp.current - 40);
        resetAbilityCooldown(boss, 'death_bolt', def);
      }
    }

    // Bone shield ability trigger
    if (isAbilityReady(boss, 'bone_shield') && boss.boneShieldHp !== undefined && boss.boneShieldHp <= 0) {
      boss.boneShieldHp = 200;
      boss.boneShieldRegen = undefined;
      resetAbilityCooldown(boss, 'bone_shield', def);
    }
  }

  // -- Shadow Lord --
  function tickShadowLord(id: number, boss: BossComponent, dt: number, send: SendFn): void {
    const def = BOSS_MAP['shadow_lord'];
    const pos = world.getComponent<PositionComponent>(id, C.Position);
    if (!pos || !def) return;

    // Teleport
    if (isAbilityReady(boss, 'teleport')) {
      const target = findRandomPlayer();
      if (target) {
        broadcastAoe(pos.x, pos.y, 50, send);

        // In phase 2, leave a shadow clone
        if (boss.phaseIndex >= 1) {
          const safeClone = deps.findSafeSpawnNear(pos.x, pos.y);
          const cloneId = deps.spawnEnemy(safeClone.x, safeClone.y);
          if (cloneId !== null) {
            deps.incrementEnemyCount();
            const cloneHp = world.getComponent<HealthComponent>(cloneId, C.Health);
            const bossHp = world.getComponent<HealthComponent>(id, C.Health);
            if (cloneHp && bossHp) {
              const cloneMaxHp = Math.round(bossHp.max * 0.2);
              cloneHp.current = cloneMaxHp;
              cloneHp.max = cloneMaxHp;
            }
            const cloneStats = world.getComponent<EnemyStatsComponent>(cloneId, C.EnemyStats);
            const bossStats = world.getComponent<EnemyStatsComponent>(id, C.EnemyStats);
            if (cloneStats && bossStats) {
              cloneStats.damage = Math.round(bossStats.damage * 0.5);
            }
          }
        }

        pos.x = target.x + (Math.random() - 0.5) * 80;
        pos.y = target.y + (Math.random() - 0.5) * 80;
        resetAbilityCooldown(boss, 'teleport', def);
      }
    }

    // Shadow wave (cone attack)
    if (isAbilityReady(boss, 'shadow_wave')) {
      const target = findNearestPlayer(pos.x, pos.y);
      if (target) {
        broadcastAoe(pos.x, pos.y, 120, send);
        const facingAngle = Math.atan2(target.y - pos.y, target.x - pos.x);
        for (const p of players.values()) {
          if (p.entityId === null) continue;
          const pPos = world.getComponent<PositionComponent>(p.entityId, C.Position);
          if (!pPos) continue;
          const dx = pPos.x - pos.x;
          const dy = pPos.y - pos.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > 14400 || distSq < 1) continue; // 120^2 = 14400
          const angle = Math.atan2(dy, dx);
          const angleDiff = Math.abs(((angle - facingAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (angleDiff < Math.PI / 2) {
            const pHp = world.getComponent<HealthComponent>(p.entityId, C.Health);
            if (pHp) pHp.current = Math.max(0, pHp.current - 35);
            const spd = world.getComponent<{ base: number; multiplier: number }>(p.entityId, C.Speed);
            if (spd) spd.multiplier *= 0.7;
          }
        }
        resetAbilityCooldown(boss, 'shadow_wave', def);
      }
    }
  }

  // -- Broodmother --
  function tickBroodmother(id: number, boss: BossComponent, dt: number, send: SendFn): void {
    const def = BOSS_MAP['broodmother'];
    const pos = world.getComponent<PositionComponent>(id, C.Position);
    if (!pos || !def) return;

    // Handle burrow state
    if (boss.burrowed) {
      boss.burrowTimer = (boss.burrowTimer ?? 0) - dt;
      if (boss.burrowTimer! <= 0) {
        boss.burrowed = false;
        const target = findRandomPlayer();
        if (target) {
          pos.x = target.x + (Math.random() - 0.5) * 120;
          pos.y = target.y + (Math.random() - 0.5) * 120;
        }
        const spiderCount = boss.enraged ? 6 : 4;
        for (let i = 0; i < spiderCount; i++) {
          const angle = (Math.PI * 2 * i) / spiderCount;
          const rawSX = pos.x + Math.cos(angle) * 50;
          const rawSY = pos.y + Math.sin(angle) * 50;
          const safeSp = deps.findSafeSpawnNear(rawSX, rawSY);
          const eid = deps.spawnEnemy(safeSp.x, safeSp.y);
          if (eid !== null) {
            deps.incrementEnemyCount();
            const spiderHp = world.getComponent<HealthComponent>(eid, C.Health);
            if (spiderHp) { spiderHp.current = 20; spiderHp.max = 20; }
            const spiderSpd = world.getComponent<{ base: number; multiplier: number }>(eid, C.Speed);
            if (spiderSpd) spiderSpd.base = 100;
          }
        }
        broadcastAoe(pos.x, pos.y, 60, send);
      }
      return;
    }

    // Burrow
    if (isAbilityReady(boss, 'burrow')) {
      boss.burrowed = true;
      boss.burrowTimer = 3;
      broadcastAoe(pos.x, pos.y, 40, send);
      resetAbilityCooldown(boss, 'burrow', def);
      return;
    }

    // Web shot (phase 2) - uses delayed action instead of setTimeout
    if (isAbilityReady(boss, 'web_shot')) {
      const target = findNearestPlayer(pos.x, pos.y);
      if (target) {
        broadcastAoe(target.x, target.y, 25, send);
        const targetId = target.entityId;
        // Root player immediately
        const spd = world.getComponent<{ base: number; multiplier: number }>(targetId, C.Speed);
        if (spd) spd.multiplier = 0;
        // Restore speed after 2s via delayed action (safe - validates entity exists)
        scheduleDelayed(2.0, () => {
          const currentSpd = world.getComponent<{ base: number; multiplier: number }>(targetId, C.Speed);
          if (currentSpd && currentSpd.multiplier === 0) currentSpd.multiplier = 1;
        });
        resetAbilityCooldown(boss, 'web_shot', def);
      }
    }
  }

  // -- Infernal --
  function tickInfernal(id: number, boss: BossComponent, dt: number, send: SendFn): void {
    const def = BOSS_MAP['infernal'];
    const pos = world.getComponent<PositionComponent>(id, C.Position);
    if (!pos || !def) return;

    // Fire trail - drop fire AOE along movement path
    const lastX = boss.lastTrailX ?? pos.x;
    const lastY = boss.lastTrailY ?? pos.y;
    const trailDx = pos.x - lastX;
    const trailDy = pos.y - lastY;
    const trailDistSq = trailDx * trailDx + trailDy * trailDy;
    if (trailDistSq > 900) { // 30^2
      const fireDmg = boss.enraged ? 12 : 6;
      damagePlayersInRadius(lastX, lastY, 900, fireDmg * dt);
      boss.lastTrailX = pos.x;
      boss.lastTrailY = pos.y;
      broadcastAoe(lastX, lastY, 20, send);
    }

    // Meteor rain - uses delayed actions instead of setTimeout
    if (isAbilityReady(boss, 'meteor_rain')) {
      for (let i = 0; i < 3; i++) {
        const target = findRandomPlayer();
        if (target) {
          const mx = target.x + (Math.random() - 0.5) * 100;
          const my = target.y + (Math.random() - 0.5) * 100;
          broadcastMeteorWarning(mx, my, 50, 1.5, send);
          // Delayed damage via tick-based queue
          scheduleDelayed(1.5, (s) => {
            broadcastAoe(mx, my, 50, s, true);
            damagePlayersInRadius(mx, my, 2500, 30); // 50^2
          });
        }
      }
      resetAbilityCooldown(boss, 'meteor_rain', def);
    }

    // Inferno burst (phase 2)
    if (isAbilityReady(boss, 'inferno_burst')) {
      broadcastAoe(pos.x, pos.y, 250, send);
      damagePlayersInRadius(pos.x, pos.y, 62500, 40); // 250^2
      resetAbilityCooldown(boss, 'inferno_burst', def);
    }
  }

  // -- Frost Warden --
  function tickFrostWarden(id: number, boss: BossComponent, dt: number, send: SendFn): void {
    const def = BOSS_MAP['frost_warden'];
    const pos = world.getComponent<PositionComponent>(id, C.Position);
    if (!pos || !def) return;

    // Frost aura - slow nearby players (per-frame, uses squared distance)
    const auraRangeSq = 40000; // 200^2
    const auraSlow = boss.enraged ? 0.6 : 0.8;
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pPos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (!pPos) continue;
      const dx = pPos.x - pos.x;
      const dy = pPos.y - pos.y;
      if (dx * dx + dy * dy < auraRangeSq) {
        const spd = world.getComponent<{ base: number; multiplier: number }>(p.entityId, C.Speed);
        if (spd && spd.multiplier > auraSlow) spd.multiplier = auraSlow;
      }
    }

    // Handle blizzard channel
    if (boss.channeling) {
      boss.channelTimer = (boss.channelTimer ?? 0) - dt;
      for (const p of players.values()) {
        if (p.entityId === null) continue;
        const pPos = world.getComponent<PositionComponent>(p.entityId, C.Position);
        if (!pPos) continue;
        const dx = pPos.x - pos.x;
        const dy = pPos.y - pos.y;
        if (dx * dx + dy * dy < 62500) { // 250^2
          const pHp = world.getComponent<HealthComponent>(p.entityId, C.Health);
          if (pHp) pHp.current = Math.max(0, pHp.current - 4 * dt);
          const spd = world.getComponent<{ base: number; multiplier: number }>(p.entityId, C.Speed);
          if (spd) spd.multiplier = Math.min(spd.multiplier, 0.5);
        }
      }
      if (boss.channelTimer! <= 0) {
        boss.channeling = false;
      }
      return;
    }

    // Ice spike - uses delayed action instead of setTimeout
    if (isAbilityReady(boss, 'ice_spike')) {
      const target = findNearestPlayer(pos.x, pos.y);
      if (target) {
        const strikeX = target.x;
        const strikeY = target.y;
        broadcastMeteorWarning(strikeX, strikeY, 40, 2.0, send);
        scheduleDelayed(2.0, (s) => {
          broadcastAoe(strikeX, strikeY, 40, s);
          damagePlayersInRadius(strikeX, strikeY, 1600, 50); // 40^2
        });
        resetAbilityCooldown(boss, 'ice_spike', def);
      }
    }

    // Blizzard (phase 2)
    if (isAbilityReady(boss, 'blizzard')) {
      boss.channeling = true;
      boss.channelTimer = 8;
      broadcastAoe(pos.x, pos.y, 250, send);
      resetAbilityCooldown(boss, 'blizzard', def);
    }
  }

  // -- Plague Bearer --
  function tickPlagueBearer(id: number, boss: BossComponent, dt: number, send: SendFn): void {
    const def = BOSS_MAP['plague_bearer'];
    const pos = world.getComponent<PositionComponent>(id, C.Position);
    if (!pos || !def) return;

    // Plague spit
    if (isAbilityReady(boss, 'plague_spit')) {
      const target = findNearestPlayer(pos.x, pos.y);
      if (target) {
        broadcastAoe(target.x, target.y, 30, send);
        const pHp = world.getComponent<HealthComponent>(target.entityId, C.Health);
        if (pHp) pHp.current = Math.max(0, pHp.current - 20);
        resetAbilityCooldown(boss, 'plague_spit', def);
      }
    }

    // Pandemic (phase 2)
    if (isAbilityReady(boss, 'pandemic')) {
      broadcastAoe(pos.x, pos.y, 150, send);
      for (const p of players.values()) {
        if (p.entityId === null) continue;
        const pHp = world.getComponent<HealthComponent>(p.entityId, C.Health);
        if (pHp) pHp.current = Math.max(0, pHp.current - 25);
      }
      resetAbilityCooldown(boss, 'pandemic', def);
    }
  }

  // -- Ancient Golem --
  function tickAncientGolem(id: number, boss: BossComponent, dt: number, send: SendFn): void {
    const def = BOSS_MAP['ancient_golem'];
    const pos = world.getComponent<PositionComponent>(id, C.Position);
    if (!pos || !def) return;

    // Earthquake stomp
    if (isAbilityReady(boss, 'earthquake_stomp')) {
      broadcastAoe(pos.x, pos.y, 150, send);
      knockbackPlayersInRadius(pos.x, pos.y, 150, 500, 50);
      resetAbilityCooldown(boss, 'earthquake_stomp', def);
    }

    // Rock throw (phase 2+) - uses delayed action instead of setTimeout
    if (isAbilityReady(boss, 'rock_throw')) {
      const target = findFarthestPlayer(pos.x, pos.y);
      if (target) {
        const strikeX = target.x;
        const strikeY = target.y;
        broadcastMeteorWarning(strikeX, strikeY, 80, 1.0, send);
        scheduleDelayed(1.0, (s) => {
          broadcastAoe(strikeX, strikeY, 80, s, true);
          damagePlayersInRadius(strikeX, strikeY, 6400, 60); // 80^2
        });
        resetAbilityCooldown(boss, 'rock_throw', def);
      }
    }

    // Shatter (phase 3)
    if (boss.phaseIndex >= 2) {
      boss.shatterActive = true;
    }
  }

  // ── Main tick ─────────────────────────────────────────────────────────

  function tick(dt: number, send: SendFn): void {
    // Tick delayed actions
    for (let i = delayedActions.length - 1; i >= 0; i--) {
      delayedActions[i].timer -= dt;
      if (delayedActions[i].timer <= 0) {
        delayedActions[i].action(send);
        delayedActions.splice(i, 1);
      }
    }

    const toRemove: number[] = [];

    for (const id of activeBosses) {
      const hp = world.getComponent<HealthComponent>(id, C.Health);
      if (!hp || hp.current <= 0) {
        toRemove.push(id);
        continue;
      }

      const boss = world.getComponent<BossComponent>(id, C.Boss);
      if (!boss) { toRemove.push(id); continue; }

      checkPhaseTransition(id, boss, send);
      tickAbilityCooldowns(boss, dt);

      switch (boss.bossId) {
        case 'ravager':       tickRavager(id, boss, dt, send); break;
        case 'necromancer':   tickNecromancer(id, boss, dt, send); break;
        case 'shadow_lord':   tickShadowLord(id, boss, dt, send); break;
        case 'broodmother':   tickBroodmother(id, boss, dt, send); break;
        case 'infernal':      tickInfernal(id, boss, dt, send); break;
        case 'frost_warden':  tickFrostWarden(id, boss, dt, send); break;
        case 'plague_bearer': tickPlagueBearer(id, boss, dt, send); break;
        case 'ancient_golem': tickAncientGolem(id, boss, dt, send); break;
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

  function getBossComponent(entityId: number): BossComponent | undefined {
    return world.getComponent<BossComponent>(entityId, C.Boss) ?? undefined;
  }

  function reset(): void {
    activeBosses.clear();
    delayedActions.length = 0; // Clear all pending delayed actions
  }

  return {
    tick,
    spawnBoss,
    spawnBossesForWave,
    isBoss,
    onBossDeath,
    getActiveBossCount,
    getBossComponent,
    reset,
  };
}

export type BossSystem = ReturnType<typeof createBossSystem>;
