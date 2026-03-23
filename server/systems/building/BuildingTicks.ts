/**
 * BuildingTicks - extracted tick functions for all building types.
 *
 * Each function takes a BuildingContext (shared deps) plus dt/send as needed.
 * The context replaces the closure variables from the original monolithic factory.
 */
import { World } from '@shared/ecs/World';
import { distance } from '@shared/math/utils';
import {
  C,
  PositionComponent,
  HealthComponent,
  FactionComponent,
  BuildingComponent,
  ProductionComponent,
  TurretComponent,
  SpikeTrapComponent,
} from '@shared/components';
import type {
  GhostStateComponent, LightRevealComponent,
  HealAuraComponent, BarracksSpawnerComponent, GuardComponent,
  WorkerSlotComponent, LaserBeamComponent,
  TeslaCoilComponent, FlameAuraComponent, MoatComponent,
  RepairAuraComponent, RuinsComponent,
} from '@shared/components';
import {
  TILE_SIZE, PLAYER_RADIUS, ENEMY_RADIUS,
  PROJECTILE_RADIUS, RANGED_LIFETIME,
  buildingHalfExtent,
  WAREHOUSE_DEPOSIT_RADIUS,
  UPGRADE_ARROW_CD, UPGRADE_ARROW_DMG, UPGRADE_CANNON_CD, UPGRADE_CANNON_DMG,
  UPGRADE_CANNON_AOE, CANNON_AOE_BASE_RADIUS,
  UPGRADE_BALLISTA_AOE, UPGRADE_BALLISTA_CD, UPGRADE_BALLISTA_DMG,
  UPGRADE_CATAPULT_DMG, UPGRADE_CATAPULT_CD, UPGRADE_CATAPULT_AOE, CATAPULT_AOE_RADIUS,
  BARRACKS_SPAWN_INTERVAL,
  BARRACKS_GUARD_HP, BARRACKS_GUARD_DAMAGE, BARRACKS_GUARD_SPEED, BARRACKS_GUARD_PATROL_RADIUS,
  GUARD_ATTACK_COOLDOWN, GUARD_MELEE_RANGE, GUARD_MELEE_KNOCKBACK, GUARD_RADIUS,
  REPAIR_STATION_COST_WOOD, REPAIR_STATION_COST_STONE,
  MOAT_SLOW_FACTOR,
  CIVILIAN_SPECIALTY_BONUS,
  TC_WARRIOR_HP, TC_WARRIOR_DAMAGE, TC_WARRIOR_SPEED,
  TC_RANGER_HP, TC_RANGER_DAMAGE, TC_RANGER_RANGE, TC_RANGER_SPEED,
  TC_MAGE_HP, TC_MAGE_DAMAGE, TC_MAGE_RANGE, TC_MAGE_SPEED,
  WORKSHOP_PROD_INTERVAL,
} from '@shared/constants';
import { MessageType } from '@shared/protocol';
import type { HitMessage, ProjectileSpawnMessage } from '@shared/protocol';
import type { SendFn } from '../../core/GameSession';
import type { BuildingContext } from './BuildingContext';

// ── Warehouse deposit ─────────────────────────────────────────────────────

export function tickWarehouseDeposit(ctx: BuildingContext, send: SendFn): void {
  const { world, warehouseIds, players, warehousePool, broadcastWarehouseUpdate } = ctx;
  if (warehouseIds.size === 0) return;

  const whPositions: PositionComponent[] = [];
  for (const wid of warehouseIds) {
    const pos = world.getComponent<PositionComponent>(wid, C.Position);
    if (pos) whPositions.push(pos);
  }
  if (whPositions.length === 0) return;

  const r2 = WAREHOUSE_DEPOSIT_RADIUS * WAREHOUSE_DEPOSIT_RADIUS;
  for (const p of players.values()) {
    if (p.entityId === null) continue;
    const pPos = world.getComponent<PositionComponent>(p.entityId, C.Position);
    if (!pPos) continue;

    let near = false;
    for (const wPos of whPositions) {
      const dx = pPos.x - wPos.x, dy = pPos.y - wPos.y;
      if (dx * dx + dy * dy <= r2) { near = true; break; }
    }
    if (!near) continue;

    const res = world.getComponent<import('@shared/components').ResourcesComponent>(p.entityId, C.Resources);
    if (!res) continue;

    let transferred = false;
    for (const key of ['wood', 'stone', 'iron', 'diamond', 'gold', 'food'] as const) {
      if (res[key] > 0) {
        warehousePool()[key] += res[key];
        res[key] = 0;
        transferred = true;
      }
    }
    if (transferred) {
      send(p.client, {
        type: MessageType.RESOURCE_UPDATE,
        wood: res.wood, stone: res.stone, iron: res.iron, diamond: res.diamond, gold: res.gold, food: res.food, weapons: res.weapons,
      });
      broadcastWarehouseUpdate(send);
    }
  }
}

// ── Production tick ───────────────────────────────────────────────────────

export function tickProduction(ctx: BuildingContext, dt: number): void {
  const { world, cards, getEventProductionMult } = ctx;
  const eventMult = getEventProductionMult();
  const intervalMult = cards.debuffs.productionIntervalMult / eventMult;
  for (const id of world.query(C.Production, C.Position)) {
    const ws = world.getComponent<WorkerSlotComponent>(id, C.WorkerSlot);
    if (ws && ws.workerId === null) continue;
    if (ws && ws.workerId !== null && !world.hasEntity(ws.workerId)) { ws.workerId = null; continue; }

    const prod = world.getComponent<ProductionComponent>(id, C.Production)!;
    prod.timer += dt;
    let effectiveInterval = prod.interval * intervalMult;

    // Civilian specialty bonus
    if (ws && ws.workerId !== null) {
      const civComp = world.getComponent<import('@shared/components').CivilianComponent>(ws.workerId, C.Civilian);
      if (civComp?.specialty) {
        const bldg = world.getComponent<BuildingComponent>(id, C.Building);
        if (bldg && civComp.specialty === bldg.buildingType) {
          effectiveInterval *= CIVILIAN_SPECIALTY_BONUS;
        }
      }
    }

    if (prod.timer < effectiveInterval) continue;
    prod.timer -= effectiveInterval;
    prod.stored = Math.min(prod.stored + prod.amount, prod.maxStored);
  }
}

// ── Catapult targeting helper ─────────────────────────────────────────────

function findCatapultTarget(
  ctx: BuildingContext,
  tpos: PositionComponent,
  range: number,
  aoeRadius: number,
): { x: number; y: number } | null {
  const { world, enemyHash } = ctx;
  const rangeSq = range * range;

  // 1. Prioritize portals and enemy buildings
  let bestStructId = -1;
  let bestStructDist = rangeSq;
  for (const eid of world.query(C.Position, C.Faction, C.Health)) {
    const f = world.getComponent<FactionComponent>(eid, C.Faction)!;
    if (f.type !== 'portal') continue;
    const hp = world.getComponent<HealthComponent>(eid, C.Health)!;
    if (hp.current <= 0) continue;
    const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
    const dx = ep.x - tpos.x, dy = ep.y - tpos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestStructDist) { bestStructDist = d2; bestStructId = eid; }
  }
  if (bestStructId >= 0) {
    const ep = world.getComponent<PositionComponent>(bestStructId, C.Position)!;
    return { x: ep.x, y: ep.y };
  }

  // 2. Find densest cluster of enemies within range
  const enemiesInRange: Array<{ x: number; y: number }> = [];
  enemyHash.queryRange(tpos.x, tpos.y, range, (entry) => {
    const ghostSt = world.getComponent<GhostStateComponent>(entry.id, C.GhostState);
    if (ghostSt?.hidden) return;
    enemiesInRange.push({ x: entry.x, y: entry.y });
  });
  if (enemiesInRange.length === 0) return null;
  if (enemiesInRange.length === 1) return enemiesInRange[0];

  let bestClusterIdx = 0;
  let bestClusterCount = 0;
  const aoeSq = aoeRadius * aoeRadius;
  for (let i = 0; i < enemiesInRange.length; i++) {
    let count = 0;
    for (let j = 0; j < enemiesInRange.length; j++) {
      if (i === j) continue;
      const cdx = enemiesInRange[i].x - enemiesInRange[j].x;
      const cdy = enemiesInRange[i].y - enemiesInRange[j].y;
      if (cdx * cdx + cdy * cdy <= aoeSq) count++;
    }
    if (count > bestClusterCount) { bestClusterCount = count; bestClusterIdx = i; }
  }
  return enemiesInRange[bestClusterIdx];
}

// ── Turret tick ───────────────────────────────────────────────────────────

export function tickTurrets(ctx: BuildingContext, dt: number, send: SendFn): void {
  const { world, players, cards, enemyHash } = ctx;
  for (const id of world.query(C.Turret, C.Position)) {
    const turret = world.getComponent<TurretComponent>(id, C.Turret)!;
    turret.cooldownTimer -= dt;
    if (turret.cooldownTimer > 0) continue;

    const tpos = world.getComponent<PositionComponent>(id, C.Position)!;
    const bldg = world.getComponent<BuildingComponent>(id, C.Building);
    const halfExt = buildingHalfExtent(bldg?.buildingType ?? 'arrow_turret');
    const isCannon = bldg?.buildingType === 'cannon_turret';
    const isBallista = bldg?.buildingType === 'ballista';
    const isCatapult = bldg?.buildingType === 'catapult';

    let targetX: number;
    let targetY: number;
    if (isCatapult) {
      const lvlIdx = (bldg!.upgradeLevel ?? 1) - 1;
      const aoeR = UPGRADE_CATAPULT_AOE[lvlIdx] ?? CATAPULT_AOE_RADIUS;
      const target = findCatapultTarget(ctx, tpos, turret.range, aoeR);
      if (!target) continue;
      targetX = target.x;
      targetY = target.y;
    } else {
      let bestId = -1;
      let bestDist = turret.range * turret.range;
      enemyHash.queryRange(tpos.x, tpos.y, turret.range, (entry, dSq) => {
        const ghostSt = world.getComponent<GhostStateComponent>(entry.id, C.GhostState);
        if (ghostSt?.hidden) return;
        if (dSq < bestDist) { bestDist = dSq; bestId = entry.id; }
      });
      if (bestId < 0) continue;
      const epos = world.getComponent<PositionComponent>(bestId, C.Position)!;
      targetX = epos.x;
      targetY = epos.y;
    }

    turret.cooldownTimer = turret.cooldown * cards.debuffs.turretCooldownMult;

    const dx = targetX - tpos.x, dy = targetY - tpos.y;
    const dist = distance(dx, dy);
    if (dist < 0.01) continue;
    const nx = dx / dist, ny = dy / dist;

    const spawnOffset = halfExt + PROJECTILE_RADIUS + 2;
    const px = tpos.x + nx * spawnOffset, py = tpos.y + ny * spawnOffset;

    const projId = world.createEntity();
    world.addComponent(projId, C.Position, { x: px, y: py });
    const siegeMultiplier = 1 + (turret.siegeBonus ?? 0);
    const finalDamage = Math.round(turret.damage * siegeMultiplier);
    turret.siegeBonus = 0;
    const projComp: any = { ownerId: id, damage: finalDamage, lifetime: RANGED_LIFETIME };

    if (isCannon) {
      const lvlIdx = (bldg!.upgradeLevel ?? 1) - 1;
      projComp.aoeRadius = UPGRADE_CANNON_AOE[lvlIdx] ?? CANNON_AOE_BASE_RADIUS;
      projComp.targetX = targetX;
      projComp.targetY = targetY;
      const flightTime = dist / turret.projectileSpeed;
      projComp.flightTime = flightTime;
      projComp.totalFlightTime = flightTime;
    } else if (isBallista) {
      projComp.pierce = true;
      projComp.hitEntities = [];
      const lvlIdx = (bldg!.upgradeLevel ?? 1) - 1;
      projComp.aoeRadius = UPGRADE_BALLISTA_AOE[lvlIdx] ?? UPGRADE_BALLISTA_AOE[0];
    } else if (isCatapult) {
      const lvlIdx = (bldg!.upgradeLevel ?? 1) - 1;
      projComp.aoeRadius = UPGRADE_CATAPULT_AOE[lvlIdx] ?? CATAPULT_AOE_RADIUS;
      projComp.targetX = targetX;
      projComp.targetY = targetY;
      const flightTime = dist / turret.projectileSpeed;
      projComp.flightTime = flightTime;
      projComp.totalFlightTime = flightTime;
    }
    world.addComponent(projId, C.Velocity, { vx: nx * turret.projectileSpeed, vy: ny * turret.projectileSpeed });
    world.addComponent(projId, C.Projectile, projComp);
    world.addComponent(projId, C.Faction, { type: 'player' });

    const isMortar = isCannon || isCatapult;
    const spawnMsg: ProjectileSpawnMessage = {
      type: MessageType.PROJECTILE_SPAWN,
      projectileId: projId, x: px, y: py,
      vx: nx * turret.projectileSpeed, vy: ny * turret.projectileSpeed,
      ownerSlot: -1,
      ...(isMortar ? { targetX, targetY, totalFlightTime: dist / turret.projectileSpeed } : {}),
      ...(isBallista ? { pierce: true, ballista: true } : {}),
    };
    for (const p of players.values()) send(p.client, spawnMsg);
  }
}

// ── Laser beam tick ───────────────────────────────────────────────────────

export function tickLaserBeams(ctx: BuildingContext, dt: number, send: SendFn): void {
  const { world, players, enemyHash, destroyDeadEntities } = ctx;
  const deaths: number[] = [];
  for (const id of world.query(C.LaserBeam, C.Position)) {
    const laser = world.getComponent<LaserBeamComponent>(id, C.LaserBeam)!;
    const tpos = world.getComponent<PositionComponent>(id, C.Position)!;

    // Validate current target
    if (laser.targetId !== null) {
      let valid = false;
      if (world.hasEntity(laser.targetId)) {
        const tgtPos = world.getComponent<PositionComponent>(laser.targetId, C.Position);
        const tgtHp = world.getComponent<HealthComponent>(laser.targetId, C.Health);
        if (tgtPos && tgtHp && tgtHp.current > 0) {
          const dx = tgtPos.x - tpos.x, dy = tgtPos.y - tpos.y;
          if (dx * dx + dy * dy <= laser.range * laser.range) valid = true;
        }
      }
      if (!valid) laser.targetId = null;
    }

    // Acquire new target
    if (laser.targetId === null) {
      const nearest = enemyHash.queryNearest(tpos.x, tpos.y, laser.range);
      if (nearest) {
        const ghostSt = world.getComponent<GhostStateComponent>(nearest.id, C.GhostState);
        const ehp = world.getComponent<HealthComponent>(nearest.id, C.Health);
        if ((!ghostSt || !ghostSt.hidden) && ehp && ehp.current > 0) {
          laser.targetId = nearest.id;
        }
      }
    }

    // Apply continuous damage
    if (laser.targetId !== null) {
      const ehp = world.getComponent<HealthComponent>(laser.targetId, C.Health);
      if (ehp && ehp.current > 0) {
        const dmg = Math.max(1, Math.round(laser.damagePerSecond * dt));
        ehp.current = Math.max(0, ehp.current - dmg);

        laser.broadcastTimer = (laser.broadcastTimer ?? 0) + 1;
        if (laser.broadcastTimer >= 3) {
          laser.broadcastTimer = 0;
          const tgtPos = world.getComponent<PositionComponent>(laser.targetId, C.Position);
          if (tgtPos) {
            const beamMsg = {
              type: MessageType.LASER_BEAM,
              sourceX: tpos.x, sourceY: tpos.y,
              targetX: tgtPos.x, targetY: tgtPos.y,
            };
            for (const p of players.values()) send(p.client, beamMsg);
          }
        }

        laser.hitTimer = (laser.hitTimer ?? 0) + 1;
        if (laser.hitTimer >= 10) {
          laser.hitTimer = 0;
          const hitMsg: HitMessage = {
            type: MessageType.HIT,
            sourceId: id, targetId: laser.targetId,
            damage: Math.round(laser.damagePerSecond / 3),
            knockbackVx: 0, knockbackVy: 0,
          };
          for (const p of players.values()) send(p.client, hitMsg);
        }

        if (ehp.current <= 0) {
          deaths.push(laser.targetId);
          laser.targetId = null;
        }
      }
    }
  }
  if (deaths.length > 0) destroyDeadEntities(deaths, undefined, send);
}

// ── Ghost visibility tick ─────────────────────────────────────────────────

export function tickGhostVisibility(ctx: BuildingContext): void {
  const { world, players, cards } = ctx;

  const cachedLightReveals: Array<{ x: number; y: number; rangeSq: number }> = [];
  for (const lid of world.query(C.LightReveal, C.Position)) {
    const lpos = world.getComponent<PositionComponent>(lid, C.Position)!;
    const lr = world.getComponent<LightRevealComponent>(lid, C.LightReveal)!;
    cachedLightReveals.push({ x: lpos.x, y: lpos.y, rangeSq: lr.range * lr.range });
  }

  const cachedRevealPlayers: Array<{ x: number; y: number }> = [];
  for (const p of players.values()) {
    if (!p.entityId) continue;
    const pBuffs = cards.playerBuffs.get(p.client.id);
    if (!pBuffs?.abilities.includes('reveal_ghosts')) continue;
    const ppos = world.getComponent<PositionComponent>(p.entityId, C.Position);
    if (ppos) cachedRevealPlayers.push({ x: ppos.x, y: ppos.y });
  }

  for (const eid of world.query(C.GhostState, C.Position)) {
    const ghost = world.getComponent<GhostStateComponent>(eid, C.GhostState)!;
    if (!ghost.hidden) continue;

    const epos = world.getComponent<PositionComponent>(eid, C.Position)!;
    let revealed = false;

    for (const lr of cachedLightReveals) {
      const dx = epos.x - lr.x, dy = epos.y - lr.y;
      if (dx * dx + dy * dy <= lr.rangeSq) { revealed = true; break; }
    }

    if (!revealed) {
      for (const rp of cachedRevealPlayers) {
        const dx2 = epos.x - rp.x, dy2 = epos.y - rp.y;
        if (dx2 * dx2 + dy2 * dy2 <= 90000) { revealed = true; break; }
      }
    }

    if (revealed) ghost.hidden = false;
  }
}

// ── Heal auras tick ───────────────────────────────────────────────────────

// Pre-cached ally list (module-level state, shared across ticks)
let cachedAllies: Array<{ id: number; x: number; y: number }> = [];
let alliesCacheFrame = -1;

export function tickHealAuras(ctx: BuildingContext, dt: number): void {
  const { world } = ctx;

  const currentFrame = (alliesCacheFrame + 1);
  if (alliesCacheFrame !== currentFrame) {
    alliesCacheFrame = currentFrame;
    cachedAllies = [];
    for (const pid of world.query(C.Position, C.Health, C.Faction)) {
      const f = world.getComponent<FactionComponent>(pid, C.Faction)!;
      if (f.type !== 'player' && f.type !== 'civilian' && f.type !== 'guard') continue;
      if (world.hasComponent(pid, C.Downed)) continue;
      const ppos = world.getComponent<PositionComponent>(pid, C.Position)!;
      cachedAllies.push({ id: pid, x: ppos.x, y: ppos.y });
    }
  }

  for (const sid of world.query(C.HealAura, C.Position)) {
    const aura = world.getComponent<HealAuraComponent>(sid, C.HealAura)!;
    const spos = world.getComponent<PositionComponent>(sid, C.Position)!;
    const rangeSq = aura.range * aura.range;
    const healAmount = aura.healPerSecond * dt;

    for (const ally of cachedAllies) {
      const dx = ally.x - spos.x, dy = ally.y - spos.y;
      if (dx * dx + dy * dy > rangeSq) continue;
      const php = world.getComponent<HealthComponent>(ally.id, C.Health);
      if (!php || php.current >= php.max) continue;
      php.current = Math.min(php.max, php.current + healAmount);
    }
  }
}

// ── Barracks tick ─────────────────────────────────────────────────────────

function spawnGuard(world: World, x: number, y: number, barracksId: number): number | null {
  const id = world.createEntity();
  world.addComponent(id, C.Position, { x, y });
  world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
  world.addComponent(id, C.Health, { current: BARRACKS_GUARD_HP, max: BARRACKS_GUARD_HP });
  world.addComponent(id, C.Speed, { base: BARRACKS_GUARD_SPEED, multiplier: 1 });
  world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
  world.addComponent(id, C.Faction, { type: 'guard' });
  world.addComponent(id, C.Facing, { angle: 0 });
  world.addComponent(id, C.AttackCooldown, { remaining: 0, max: GUARD_ATTACK_COOLDOWN });
  world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
  world.addComponent(id, C.Guard, { barracksId, patrolRadius: BARRACKS_GUARD_PATROL_RADIUS } as GuardComponent);
  world.addComponent(id, C.EnemyStats, {
    damage: BARRACKS_GUARD_DAMAGE, range: GUARD_MELEE_RANGE, knockback: GUARD_MELEE_KNOCKBACK, radius: GUARD_RADIUS,
    rangedRange: 0, projectileSpeed: 0, rangedDamage: 0, rangedCooldown: 0,
  });
  return id;
}

export function spawnTrainedGuard(world: World, x: number, y: number, buildingId: number, role: 'warrior' | 'ranger' | 'mage'): number | null {
  const roleStats = {
    warrior: { hp: TC_WARRIOR_HP, dmg: TC_WARRIOR_DAMAGE, speed: TC_WARRIOR_SPEED, range: GUARD_MELEE_RANGE, rangedRange: 0, projSpeed: 0, rangedDmg: 0, rangedCd: 0 },
    ranger:  { hp: TC_RANGER_HP,  dmg: TC_RANGER_DAMAGE,  speed: TC_RANGER_SPEED,  range: GUARD_MELEE_RANGE, rangedRange: TC_RANGER_RANGE, projSpeed: 300, rangedDmg: TC_RANGER_DAMAGE, rangedCd: 1.5 },
    mage:    { hp: TC_MAGE_HP,    dmg: TC_MAGE_DAMAGE,    speed: TC_MAGE_SPEED,    range: GUARD_MELEE_RANGE, rangedRange: TC_MAGE_RANGE, projSpeed: 250, rangedDmg: TC_MAGE_DAMAGE, rangedCd: 2.0 },
  };
  const s = roleStats[role];
  const id = world.createEntity();
  world.addComponent(id, C.Position, { x, y });
  world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
  world.addComponent(id, C.Health, { current: s.hp, max: s.hp });
  world.addComponent(id, C.Speed, { base: s.speed, multiplier: 1 });
  world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
  world.addComponent(id, C.Faction, { type: 'guard' });
  world.addComponent(id, C.Facing, { angle: 0 });
  world.addComponent(id, C.AttackCooldown, { remaining: 0, max: GUARD_ATTACK_COOLDOWN });
  world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
  world.addComponent(id, C.Guard, { barracksId: buildingId, patrolRadius: BARRACKS_GUARD_PATROL_RADIUS, guardRole: role } as GuardComponent);
  world.addComponent(id, C.EnemyStats, {
    damage: s.dmg, range: s.range, knockback: GUARD_MELEE_KNOCKBACK, radius: GUARD_RADIUS,
    rangedRange: s.rangedRange, projectileSpeed: s.projSpeed, rangedDamage: s.rangedDmg, rangedCooldown: s.rangedCd,
  });
  return id;
}

export function tickBarracks(ctx: BuildingContext, dt: number): void {
  const { world, isWalkable } = ctx;
  for (const bid of world.query(C.BarracksSpawner, C.Position)) {
    const spawner = world.getComponent<BarracksSpawnerComponent>(bid, C.BarracksSpawner)!;
    const bpos = world.getComponent<PositionComponent>(bid, C.Position)!;

    spawner.guardIds = spawner.guardIds.filter(gid => world.hasEntity(gid));

    if (spawner.guardIds.length < spawner.maxGuards) {
      spawner.spawnTimer -= dt;
      if (spawner.spawnTimer <= 0) {
        spawner.spawnTimer = spawner.spawnInterval;
        const bHalf = buildingHalfExtent('barracks');
        const spawnDist = bHalf + 16 + Math.random() * 20;
        const angle = Math.random() * Math.PI * 2;
        const gx = bpos.x + Math.cos(angle) * spawnDist;
        const gy = bpos.y + Math.sin(angle) * spawnDist;
        if (!isWalkable(gx, gy)) continue;
        const gid = spawnGuard(world, gx, gy, bid);
        if (gid !== null) spawner.guardIds.push(gid);
      }
    }
  }
}

// ── Building regen tick ───────────────────────────────────────────────────

export function tickBuildingRegen(ctx: BuildingContext, dt: number): void {
  const { world, cards } = ctx;
  const rate = cards.debuffs.buildingRegenRate;
  if (rate <= 0) return;
  for (const id of world.query(C.Building, C.Health)) {
    const hp = world.getComponent<HealthComponent>(id, C.Health)!;
    if (hp.current >= hp.max || hp.current <= 0) continue;
    hp.current = Math.min(hp.max, hp.current + rate * dt);
  }
}

// ── Spike trap tick ───────────────────────────────────────────────────────

export function tickSpikeTraps(ctx: BuildingContext, dt: number, send: SendFn): void {
  const { world, players, enemyHash, destroyDeadEntities } = ctx;
  const trapDeaths: number[] = [];
  const entityDeaths: number[] = [];
  const attackerMap = new Map<number, number>();
  const spikeHits: Array<{ sourceId: number; targetId: number; damage: number; knockbackVx: number; knockbackVy: number }> = [];

  for (const id of world.query(C.SpikeTrap, C.Position, C.Health)) {
    const trap = world.getComponent<SpikeTrapComponent>(id, C.SpikeTrap)!;
    const tpos = world.getComponent<PositionComponent>(id, C.Position)!;
    const thp = world.getComponent<HealthComponent>(id, C.Health)!;
    const trapHalf = buildingHalfExtent('spike_trap');
    let trapDestroyed = false;

    for (const [eid, remaining] of trap.enemyCooldowns) {
      if (remaining > 0) trap.enemyCooldowns.set(eid, remaining - dt);
    }

    const searchRadius = trapHalf + ENEMY_RADIUS + 5;
    enemyHash.queryRange(tpos.x, tpos.y, searchRadius, (entry) => {
      if (trapDestroyed) return true;
      if (world.hasComponent(entry.id, C.Downed)) return;

      const edx = Math.abs(entry.x - tpos.x);
      const edy = Math.abs(entry.y - tpos.y);
      if (edx > trapHalf + ENEMY_RADIUS || edy > trapHalf + ENEMY_RADIUS) return;

      const cd = trap.enemyCooldowns.get(entry.id) ?? 0;
      if (cd > 0) return;

      const ehp = world.getComponent<HealthComponent>(entry.id, C.Health);
      if (!ehp) return;
      ehp.current = Math.max(0, ehp.current - trap.damage);
      trap.enemyCooldowns.set(entry.id, trap.cooldown);

      spikeHits.push({ sourceId: id, targetId: entry.id, damage: trap.damage, knockbackVx: 0, knockbackVy: 0 });

      if (ehp.current <= 0) {
        entityDeaths.push(entry.id);
        attackerMap.set(entry.id, id);
      }

      thp.current -= trap.selfDamage;
      if (thp.current <= 0) {
        trapDeaths.push(id);
        trapDestroyed = true;
        return true;
      }
    });

    if (!trapDestroyed) {
      for (const p of players.values()) {
        if (p.entityId === null) continue;
        if (world.hasComponent(p.entityId, C.Downed)) continue;
        const ppos = world.getComponent<PositionComponent>(p.entityId, C.Position);
        if (!ppos) continue;
        const edx = Math.abs(ppos.x - tpos.x);
        const edy = Math.abs(ppos.y - tpos.y);
        if (edx > trapHalf + PLAYER_RADIUS || edy > trapHalf + PLAYER_RADIUS) continue;
        const cd = trap.enemyCooldowns.get(p.entityId) ?? 0;
        if (cd > 0) continue;
        const php = world.getComponent<HealthComponent>(p.entityId, C.Health);
        if (!php) continue;
        php.current = Math.max(0, php.current - trap.damage);
        trap.enemyCooldowns.set(p.entityId, trap.cooldown);
        spikeHits.push({ sourceId: id, targetId: p.entityId, damage: trap.damage, knockbackVx: 0, knockbackVy: 0 });
      }
    }

    if (!trapDestroyed) {
      for (const eid of trap.enemyCooldowns.keys()) {
        if (!world.hasEntity(eid)) trap.enemyCooldowns.delete(eid);
      }
    }
  }

  if (spikeHits.length > 0) {
    for (const hit of spikeHits) {
      const hitMsg: HitMessage = { type: MessageType.HIT, ...hit };
      for (const p of players.values()) send(p.client, hitMsg);
    }
  }

  if (entityDeaths.length > 0) destroyDeadEntities(entityDeaths, attackerMap, send);
  if (trapDeaths.length > 0) destroyDeadEntities(trapDeaths, undefined, send);
}

// ── Ruins tick ────────────────────────────────────────────────────────────

export function tickRuins(ctx: BuildingContext, dt: number, send: SendFn): void {
  const { world, players } = ctx;
  for (const id of world.query(C.Ruins, C.Position)) {
    const ruins = world.getComponent<RuinsComponent>(id, C.Ruins)!;

    if (ruins.burnTimer > 0) {
      ruins.burnTimer = Math.max(0, ruins.burnTimer - dt);
    }

    ruins.decayTimer -= dt;
    if (ruins.decayTimer <= 0) {
      const destroyedMsg = {
        type: MessageType.BUILD_DESTROYED,
        entityId: id,
      };
      for (const p of players.values()) send(p.client, destroyedMsg);
      world.destroyEntity(id);
    }
  }
}

// ── Tesla coil tick ───────────────────────────────────────────────────────

export function tickTeslaCoils(ctx: BuildingContext, dt: number, send: SendFn): void {
  const { world, players, cards, enemyHash, destroyDeadEntities } = ctx;
  const deaths: number[] = [];
  for (const id of world.query(C.TeslaCoil, C.Position)) {
    const tc = world.getComponent<TeslaCoilComponent>(id, C.TeslaCoil)!;
    const pos = world.getComponent<PositionComponent>(id, C.Position)!;

    tc.cooldownTimer -= dt;
    if (tc.cooldownTimer > 0) continue;

    const chain: Array<{ x: number; y: number }> = [];
    const hitIds = new Set<number>();
    enemyHash.queryRange(pos.x, pos.y, tc.range, (entry) => {
      hitIds.add(entry.id);
      const hp = world.getComponent<HealthComponent>(entry.id, C.Health);
      if (hp) {
        hp.current = Math.max(0, hp.current - tc.damage);
        if (hp.current <= 0) deaths.push(entry.id);
      }
      chain.push({ x: entry.x, y: entry.y });
    });

    if (chain.length === 0) continue;
    tc.cooldownTimer = tc.cooldown * (cards.debuffs.turretCooldownMult ?? 1);

    for (let c = 0; c < tc.chainCount; c++) {
      const newHits: Array<{ id: number; x: number; y: number }> = [];
      for (const pt of chain) {
        enemyHash.queryRange(pt.x, pt.y, tc.chainRange, (entry) => {
          if (hitIds.has(entry.id)) return;
          hitIds.add(entry.id);
          newHits.push({ id: entry.id, x: entry.x, y: entry.y });
        });
      }
      if (newHits.length === 0) break;
      for (const nh of newHits) {
        const hp = world.getComponent<HealthComponent>(nh.id, C.Health);
        if (hp) {
          const chainDmg = Math.round(tc.damage * 0.5);
          hp.current = Math.max(0, hp.current - chainDmg);
          if (hp.current <= 0) deaths.push(nh.id);
        }
        chain.push({ x: nh.x, y: nh.y });
      }
    }

    const chainMsg = { type: MessageType.TESLA_CHAIN, sourceX: pos.x, sourceY: pos.y, chain };
    for (const p of players.values()) send(p.client, chainMsg);
  }
  if (deaths.length > 0) destroyDeadEntities(deaths, undefined, send);
}

// ── Flame tower tick ──────────────────────────────────────────────────────

export function tickFlameTowers(ctx: BuildingContext, dt: number, send: SendFn): void {
  const { world, players, enemyHash, destroyDeadEntities } = ctx;
  const deaths: number[] = [];
  for (const id of world.query(C.FlameAura, C.Position)) {
    const fl = world.getComponent<FlameAuraComponent>(id, C.FlameAura)!;
    const pos = world.getComponent<PositionComponent>(id, C.Position)!;

    const nearest = enemyHash.queryNearest(pos.x, pos.y, fl.range);
    if (!nearest) continue;
    fl.facing = Math.atan2(nearest.y - pos.y, nearest.x - pos.x);

    const flameMsg = { type: MessageType.FLAME_CONE, sourceX: pos.x, sourceY: pos.y, facing: fl.facing, range: fl.range, arcRadians: fl.arcRadians };
    for (const p of players.values()) send(p.client, flameMsg);

    const halfArc = fl.arcRadians / 2;
    enemyHash.queryRange(pos.x, pos.y, fl.range, (entry) => {
      const angle = Math.atan2(entry.y - pos.y, entry.x - pos.x);
      let diff = angle - fl.facing;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      if (Math.abs(diff) > halfArc) return;
      const hp = world.getComponent<HealthComponent>(entry.id, C.Health);
      if (hp) {
        const dmg = Math.max(1, Math.round(fl.dps * dt));
        hp.current = Math.max(0, hp.current - dmg);
        if (hp.current <= 0) deaths.push(entry.id);
      }
    });
  }
  if (deaths.length > 0) destroyDeadEntities(deaths, undefined, send);
}

// ── Repair station tick ───────────────────────────────────────────────────

export function tickRepairStations(ctx: BuildingContext, dt: number): void {
  const { world, warehousePool } = ctx;
  for (const id of world.query(C.RepairAura, C.Position)) {
    const ws = world.getComponent<WorkerSlotComponent>(id, C.WorkerSlot);
    if (!ws || ws.workerId === null) continue;
    if (!world.hasEntity(ws.workerId)) { ws.workerId = null; continue; }

    const ra = world.getComponent<RepairAuraComponent>(id, C.RepairAura)!;
    ra.timer += dt;
    if (ra.timer < ra.interval) continue;
    ra.timer -= ra.interval;

    let worstId = -1;
    let worstRatio = 1;
    for (const bid of world.query(C.Building, C.Health)) {
      if (bid === id) continue;
      const bhp = world.getComponent<HealthComponent>(bid, C.Health)!;
      if (bhp.current >= bhp.max) continue;
      const ratio = bhp.current / bhp.max;
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worstId = bid;
      }
    }

    if (worstId < 0) continue;

    const pool = warehousePool();
    if (pool.wood < REPAIR_STATION_COST_WOOD || pool.stone < REPAIR_STATION_COST_STONE) continue;
    pool.wood -= REPAIR_STATION_COST_WOOD;
    pool.stone -= REPAIR_STATION_COST_STONE;

    const bhp = world.getComponent<HealthComponent>(worstId, C.Health)!;
    bhp.current = Math.min(bhp.max, bhp.current + ra.repairPerTick);
  }
}

// ── Moat tick ─────────────────────────────────────────────────────────────

export function tickMoats(ctx: BuildingContext): void {
  const { world, enemyHash } = ctx;
  for (const id of world.query(C.Moat, C.Position)) {
    const moatPos = world.getComponent<PositionComponent>(id, C.Position)!;
    const moatComp = world.getComponent<MoatComponent>(id, C.Moat)!;
    const mhx = TILE_SIZE / 2;

    enemyHash.queryRange(moatPos.x, moatPos.y, mhx * 1.5, (entry) => {
      const dx = Math.abs(entry.x - moatPos.x);
      const dy = Math.abs(entry.y - moatPos.y);
      if (dx < mhx && dy < mhx) {
        const speed = world.getComponent<import('@shared/components').SpeedComponent>(entry.id, C.Speed);
        if (speed) speed.multiplier = Math.min(speed.multiplier, moatComp.slowFactor);
      }
    });
  }
}

// ── Siege workshop tick ───────────────────────────────────────────────────

export function tickSiegeWorkshops(ctx: BuildingContext): void {
  const { world } = ctx;
  for (const sid of world.query(C.SiegeAura, C.Position)) {
    const aura = world.getComponent<import('@shared/components').SiegeAuraComponent>(sid, C.SiegeAura)!;
    const spos = world.getComponent<PositionComponent>(sid, C.Position)!;
    const r2 = aura.range * aura.range;

    for (const tid of world.query(C.Turret, C.Position)) {
      const tpos = world.getComponent<PositionComponent>(tid, C.Position)!;
      const dx = tpos.x - spos.x, dy = tpos.y - spos.y;
      if (dx * dx + dy * dy <= r2) {
        const turret = world.getComponent<TurretComponent>(tid, C.Turret)!;
        turret.siegeBonus = Math.max(turret.siegeBonus ?? 0, aura.damageBonus);
      }
    }
  }
}

// ── Kennel tick ───────────────────────────────────────────────────────────

export function tickKennels(ctx: BuildingContext, dt: number): void {
  const { world } = ctx;
  for (const kid of world.query(C.Kennel, C.Position)) {
    const kennel = world.getComponent<import('@shared/components').KennelComponent>(kid, C.Kennel)!;
    const kpos = world.getComponent<PositionComponent>(kid, C.Position)!;

    kennel.wolfIds = kennel.wolfIds.filter(wid => world.hasEntity(wid));

    if (kennel.wolfIds.length >= kennel.maxWolves) continue;
    kennel.spawnTimer -= dt;
    if (kennel.spawnTimer > 0) continue;
    kennel.spawnTimer = kennel.spawnInterval;

    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 20;
    const wx = kpos.x + Math.cos(angle) * dist;
    const wy = kpos.y + Math.sin(angle) * dist;
    const wolfId = world.createEntity();
    world.addComponent(wolfId, C.Position, { x: wx, y: wy });
    world.addComponent(wolfId, C.Velocity, { vx: 0, vy: 0 });
    world.addComponent(wolfId, C.Health, { current: 80, max: 80 });
    world.addComponent(wolfId, C.Faction, { type: 'guard' });
    world.addComponent(wolfId, C.Speed, { base: 140, multiplier: 1 });
    world.addComponent(wolfId, C.EnemyStats, { damage: 10, attackCooldown: 1.2, attackTimer: 0, range: 25, xpValue: 0 } as any);
    world.addComponent(wolfId, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
    world.addComponent(wolfId, C.Facing, { angle: 0 });
    world.addComponent(wolfId, C.AttackCooldown, { remaining: 0, duration: 1.2, active: false });
    world.addComponent(wolfId, C.Guard, { barracksId: kid, patrolRadius: 150, variant: 'wolf' } as any);
    kennel.wolfIds.push(wolfId);
  }
}
