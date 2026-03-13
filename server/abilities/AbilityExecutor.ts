import { World } from '@shared/ecs/World';
import { distance } from '@shared/math/utils';
import {
  C,
  PositionComponent,
  HealthComponent,
  DefenseComponent,
  FactionComponent,
  KnockbackReceiverComponent,
  ActiveBuffsComponent,
  SpeedComponent,
  BurnDotComponent,
  SlowEffectComponent,
  StunEffectComponent,
  FreezeComponent,
  RootComponent,
  TauntComponent,
  FearComponent,
  DamageMarkComponent,
  ShieldAbsorbComponent,
  StealthComponent,
  ChannelComponent,
  TransformComponent,
  PersistentZoneComponent,
  SummonOwnerComponent,
  SoulMarkComponent,
  GuardComponent,
} from '@shared/components';
import type { AbilityParams, SkillActiveAbility } from '@shared/definitions/SkillDefinitions';
import type { AbilityEffectMessage } from '@shared/protocol';
import { MessageType } from '@shared/protocol';
import {
  TILE_SIZE,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import type { WorldGenerator } from '@shared/world/WorldGenerator';
import type { SessionPlayer } from '../core/GameSession';
import type { HitResult } from '../systems/CombatSystem';

export interface AbilityResult {
  effect: AbilityEffectMessage;
  hits: HitResult[];
  deaths: number[];
}

/** Check if a world position is walkable. */
function isWalkable(gen: WorldGenerator, wx: number, wy: number): boolean {
  const tx = Math.floor(wx / TILE_SIZE);
  const ty = Math.floor(wy / TILE_SIZE);
  const tileId = gen.getTile(tx, ty);
  const def = TILE_DEFS[tileId];
  return def ? def.walkable : false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find all enemies within radius^2 of (cx, cy). */
function enemiesInRadius(
  world: World, cx: number, cy: number, radius: number,
): { eid: number; dx: number; dy: number; dist2: number }[] {
  const r2 = radius * radius;
  const results: { eid: number; dx: number; dy: number; dist2: number }[] = [];
  for (const eid of world.query(C.Position, C.Health, C.Faction)) {
    const ef = world.getComponent<FactionComponent>(eid, C.Faction);
    if (ef?.type !== 'enemy') continue;
    const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
    const dx = ep.x - cx, dy = ep.y - cy;
    const dist2 = dx * dx + dy * dy;
    if (dist2 <= r2) results.push({ eid, dx, dy, dist2 });
  }
  return results;
}

/** Find all friendly entities (players + guards) within radius of (cx, cy). */
function alliesInRadius(
  world: World, cx: number, cy: number, radius: number,
): number[] {
  const r2 = radius * radius;
  const results: number[] = [];
  for (const eid of world.query(C.Position, C.Faction)) {
    const ef = world.getComponent<FactionComponent>(eid, C.Faction);
    if (ef?.type !== 'player' && ef?.type !== 'guard') continue;
    const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
    const dx = ep.x - cx, dy = ep.y - cy;
    if (dx * dx + dy * dy <= r2) results.push(eid);
  }
  return results;
}

/** Apply damage to an entity, respecting defense. Returns actual damage dealt. */
function applyDamage(
  world: World, eid: number, rawDamage: number,
): number {
  const hp = world.getComponent<HealthComponent>(eid, C.Health)!;
  const def = world.getComponent<DefenseComponent>(eid, C.Defense);
  let dmg = rawDamage;
  if (def) dmg = Math.max(0, Math.round((dmg - def.flat) * (1 - def.percent)));
  hp.current = Math.max(0, hp.current - dmg);
  return dmg;
}

/** AOE damage to all enemies in radius. Returns hits/deaths arrays. */
function aoeDamageEnemies(
  world: World, sourceId: number, cx: number, cy: number,
  radius: number, rawDamage: number, knockbackStrength: number,
  hits: HitResult[], deaths: number[],
): void {
  for (const e of enemiesInRadius(world, cx, cy, radius)) {
    const dmg = applyDamage(world, e.eid, rawDamage);
    let kbx = 0, kby = 0;
    if (knockbackStrength > 0) {
      const dist = Math.sqrt(e.dist2) || 1;
      kbx = (e.dx / dist) * knockbackStrength;
      kby = (e.dy / dist) * knockbackStrength;
      const kb = world.getComponent<KnockbackReceiverComponent>(e.eid, C.KnockbackReceiver);
      if (kb) { kb.vx += kbx; kb.vy += kby; }
    }
    hits.push({ sourceId, targetId: e.eid, damage: dmg, knockbackVx: kbx, knockbackVy: kby });
    const hp = world.getComponent<HealthComponent>(e.eid, C.Health)!;
    if (hp.current <= 0) deaths.push(e.eid);
  }
}

/** Find the nearest enemy within range of (cx, cy). */
function nearestEnemy(
  world: World, cx: number, cy: number, range: number,
): number | null {
  let best: number | null = null;
  let bestDist2 = range * range;
  for (const eid of world.query(C.Position, C.Health, C.Faction)) {
    const ef = world.getComponent<FactionComponent>(eid, C.Faction);
    if (ef?.type !== 'enemy') continue;
    const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
    const dx = ep.x - cx, dy = ep.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) { bestDist2 = d2; best = eid; }
  }
  return best;
}

/** Ensure an entity has ActiveBuffs component and push a buff. */
function pushBuff(
  world: World, eid: number, id: string, remaining: number, effect: Record<string, number>,
): void {
  let ab = world.getComponent<ActiveBuffsComponent>(eid, C.ActiveBuffs);
  if (!ab) { ab = { buffs: [] }; world.addComponent(eid, C.ActiveBuffs, ab); }
  ab.buffs.push({ id, remaining, effect });
}

/** Dash player in facing direction, damaging enemies along the path.
 *  Returns the destination (x, y). */
function dashThroughEnemies(
  world: World, entityId: number, pos: PositionComponent,
  facing: number, maxDistance: number, rawDamage: number,
  knockbackStrength: number, generator: WorldGenerator,
  hits: HitResult[], deaths: number[],
): { destX: number; destY: number } {
  const dirX = Math.cos(facing);
  const dirY = Math.sin(facing);
  // Find a walkable destination
  let destX = pos.x, destY = pos.y;
  for (let d = maxDistance; d >= 0; d -= 10) {
    const cx = pos.x + dirX * d;
    const cy = pos.y + dirY * d;
    if (isWalkable(generator, cx, cy)) { destX = cx; destY = cy; break; }
  }
  // Damage enemies along the path (within 30px of the line)
  const pathLen = distance(destX - pos.x, destY - pos.y);
  if (pathLen > 0) {
    const nx = (destX - pos.x) / pathLen;
    const ny = (destY - pos.y) / pathLen;
    for (const eid of world.query(C.Position, C.Health, C.Faction)) {
      const ef = world.getComponent<FactionComponent>(eid, C.Faction);
      if (ef?.type !== 'enemy') continue;
      const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
      const rx = ep.x - pos.x, ry = ep.y - pos.y;
      const proj = rx * nx + ry * ny;
      if (proj < 0 || proj > pathLen) continue;
      const perpX = rx - proj * nx, perpY = ry - proj * ny;
      if (perpX * perpX + perpY * perpY > 30 * 30) continue;
      const dmg = applyDamage(world, eid, rawDamage);
      let kbx = 0, kby = 0;
      if (knockbackStrength > 0) {
        kbx = nx * knockbackStrength; kby = ny * knockbackStrength;
        const kb = world.getComponent<KnockbackReceiverComponent>(eid, C.KnockbackReceiver);
        if (kb) { kb.vx += kbx; kb.vy += kby; }
      }
      hits.push({ sourceId: entityId, targetId: eid, damage: dmg, knockbackVx: kbx, knockbackVy: kby });
      const hp = world.getComponent<HealthComponent>(eid, C.Health)!;
      if (hp.current <= 0) deaths.push(eid);
    }
  }
  pos.x = destX; pos.y = destY;
  return { destX, destY };
}

/** Teleport player toward cursor, clamped to maxDistance, with walkability check. */
function teleportToCursor(
  pos: PositionComponent, msg: { targetX?: number; targetY?: number; x: number; y: number },
  maxDistance: number, generator: WorldGenerator,
): { destX: number; destY: number } {
  const tx = msg.targetX ?? pos.x;
  const ty = msg.targetY ?? pos.y;
  const dx = tx - pos.x, dy = ty - pos.y;
  const dist = distance(dx, dy);
  let destX: number, destY: number;
  if (dist <= maxDistance) { destX = tx; destY = ty; }
  else { destX = pos.x + (dx / dist) * maxDistance; destY = pos.y + (dy / dist) * maxDistance; }
  if (!isWalkable(generator, destX, destY)) {
    destX = pos.x + (destX - pos.x) * 0.5;
    destY = pos.y + (destY - pos.y) * 0.5;
    if (!isWalkable(generator, destX, destY)) return { destX: pos.x, destY: pos.y };
  }
  pos.x = destX; pos.y = destY;
  return { destX, destY };
}

/** Spawn a summoned entity (skeleton, wolf). */
function spawnSummon(
  world: World, ownerId: number, cx: number, cy: number,
  hp: number, duration: number, index: number,
): number {
  const angle = (Math.PI * 2 * index) / 8;
  const spawnX = cx + Math.cos(angle) * 40;
  const spawnY = cy + Math.sin(angle) * 40;
  const eid = world.createEntity();
  world.addComponent(eid, C.Position, { x: spawnX, y: spawnY });
  world.addComponent(eid, C.Health, { current: hp, max: hp });
  world.addComponent(eid, C.Faction, { type: 'guard' as const });
  world.addComponent(eid, C.Speed, { base: 80, multiplier: 1 });
  world.addComponent(eid, C.SummonOwner, { ownerId, expireTime: duration } as SummonOwnerComponent);
  world.addComponent(eid, C.KnockbackReceiver, { vx: 0, vy: 0 });
  return eid;
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export function executeAbility(
  world: World,
  player: SessionPlayer,
  ability: SkillActiveAbility,
  msg: { facing: number; x: number; y: number; targetX?: number; targetY?: number },
  generator: WorldGenerator,
): AbilityResult {
  const entityId = player.entityId!;
  const pos = world.getComponent<PositionComponent>(entityId, C.Position)!;
  const hits: HitResult[] = [];
  const deaths: number[] = [];

  const baseEffect: AbilityEffectMessage = {
    type: MessageType.ABILITY_EFFECT,
    abilityId: ability.abilityId,
    sourceId: entityId,
    x: pos.x,
    y: pos.y,
  };

  const params = ability.params;

  switch (params.type) {
    // =====================================================================
    // WARRIOR
    // =====================================================================

    case 'warcry_rage': {
      baseEffect.duration = params.duration;
      // Check for warcry extension combat mod
      let duration = params.duration;
      // Extension will be handled by SkillSystem checking combat mods
      let ab = world.getComponent<ActiveBuffsComponent>(entityId, C.ActiveBuffs);
      if (!ab) { ab = { buffs: [] }; world.addComponent(entityId, C.ActiveBuffs, ab); }
      ab.buffs.push({
        id: 'warcry_rage',
        remaining: duration,
        effect: { speedFlat: params.speedBoost, defensePercent: params.damageResistance, hpRegen: params.hpRegen },
      });
      break;
    }

    case 'unbreakable_charge': {
      baseEffect.radius = params.tauntRadius;
      baseEffect.duration = params.chargeDuration;
      // Root the player
      world.addComponent(entityId, C.Root, { remaining: params.chargeDuration });
      // Apply damage reduction buff
      let ab = world.getComponent<ActiveBuffsComponent>(entityId, C.ActiveBuffs);
      if (!ab) { ab = { buffs: [] }; world.addComponent(entityId, C.ActiveBuffs, ab); }
      ab.buffs.push({
        id: 'unbreakable_charge',
        remaining: params.chargeDuration,
        effect: { defensePercent: params.damageReduction, damageStorage: 0, damageMultiplier: params.damageMultiplier, totalDuration: params.chargeDuration },
      });
      // Taunt all enemies in radius
      const r2 = params.tauntRadius * params.tauntRadius;
      for (const eid of world.query(C.Position, C.Faction)) {
        const ef = world.getComponent<FactionComponent>(eid, C.Faction);
        if (ef?.type !== 'enemy') continue;
        const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = ep.x - pos.x, dy = ep.y - pos.y;
        if (dx * dx + dy * dy > r2) continue;
        // Apply taunt - enemy must attack this player
        world.addComponent(eid, C.Taunt, { sourceId: entityId, remaining: params.chargeDuration });
      }
      break;
    }

    case 'blood_drain': {
      baseEffect.radius = params.radius;
      baseEffect.duration = params.duration;
      // Add as ActiveBuff so it follows the player (drains nearby enemies, heals player)
      let abDrain = world.getComponent<ActiveBuffsComponent>(entityId, C.ActiveBuffs);
      if (!abDrain) { abDrain = { buffs: [] }; world.addComponent(entityId, C.ActiveBuffs, abDrain); }
      // Remove existing blood_drain buff if any
      const existIdx = abDrain.buffs.findIndex(b => b.id === 'blood_drain');
      if (existIdx >= 0) abDrain.buffs.splice(existIdx, 1);
      abDrain.buffs.push({
        id: 'blood_drain',
        remaining: params.duration,
        effect: { drainRadius: params.radius, drainDps: 15, drainHealPerSec: 10 },
      });
      break;
    }

    // =====================================================================
    // RANGER
    // =====================================================================

    case 'sniper_shot': {
      // Charge for chargeTime seconds, then fire a massive arrow
      const chargeTime = params.chargeTime;
      // Root player during charge
      world.addComponent(entityId, C.Root, { remaining: chargeTime } as RootComponent);
      // After charge, fire a projectile with multiplied damage in the facing direction
      // The actual projectile is spawned by a buff expiry handler
      pushBuff(world, entityId, 'sniper_shot', chargeTime, {
        damageMultiplier: params.damageMultiplier,
        facing: msg.facing,
      });
      baseEffect.duration = chargeTime;
      break;
    }

    case 'pack_call': {
      // Spawn temporary wolves near the player
      for (let i = 0; i < params.wolfCount; i++) {
        const angle = (i / params.wolfCount) * Math.PI * 2;
        const spawnDist = 40 + Math.random() * 30;
        const wx = pos.x + Math.cos(angle) * spawnDist;
        const wy = pos.y + Math.sin(angle) * spawnDist;
        const wolfId = world.createEntity();
        world.addComponent(wolfId, C.Position, { x: wx, y: wy });
        world.addComponent(wolfId, C.Velocity, { vx: 0, vy: 0 });
        world.addComponent(wolfId, C.Health, { current: params.wolfHp, max: params.wolfHp });
        world.addComponent(wolfId, C.Faction, { type: 'guard' });
        world.addComponent(wolfId, C.Speed, { base: 160, multiplier: 1 });
        world.addComponent(wolfId, C.EnemyStats, { damage: params.wolfDamage, attackCooldown: 1.0, attackTimer: 0, range: 25, xpValue: 0, variant: 'wolf' } as any);
        world.addComponent(wolfId, C.Guard, {
          barracksId: entityId, // Owner player entity
          patrolRadius: 200,
          followEntityId: entityId, // Follow the player
          lifetime: params.duration, // Temporary wolf
          variant: 'wolf',
        } as GuardComponent);
      }
      baseEffect.radius = 100;
      break;
    }

    case 'explosive_barrage': {
      // Fire multiple explosive arrows in a spread arc
      const spreadAngle = Math.PI / 4; // 45 degree total spread
      const halfSpread = spreadAngle / 2;
      for (let i = 0; i < params.arrowCount; i++) {
        const angle = msg.facing - halfSpread + (i / (params.arrowCount - 1)) * spreadAngle;
        const speed = 350;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        const spawnDist = 20;
        const sx = pos.x + Math.cos(angle) * spawnDist;
        const sy = pos.y + Math.sin(angle) * spawnDist;
        const projId = world.createEntity();
        world.addComponent(projId, C.Position, { x: sx, y: sy });
        world.addComponent(projId, C.Velocity, { vx, vy });
        world.addComponent(projId, C.Projectile, {
          ownerId: entityId,
          damage: params.damagePerArrow,
          lifetime: 2.0,
          explosionRadius: params.explosionRadius,
        } as any);
        world.addComponent(projId, C.Faction, { type: 'player' });
      }
      break;
    }

    // =====================================================================
    // MAGE
    // =====================================================================

    case 'meteor_shower': {
      const tx = msg.targetX ?? pos.x;
      const ty = msg.targetY ?? pos.y;
      baseEffect.targetX = tx;
      baseEffect.targetY = ty;
      baseEffect.radius = params.radius;
      baseEffect.duration = params.duration;
      // Create a meteor shower entity that spawns individual meteor impacts over time
      const zoneId = world.createEntity();
      world.addComponent(zoneId, C.Position, { x: tx, y: ty });
      const meteorInterval = params.duration / params.meteorCount;
      world.addComponent(zoneId, C.MeteorShower, {
        x: tx, y: ty,
        radius: params.radius,
        remaining: params.duration,
        meteorTimer: meteorInterval, // Start ready to fire first meteor immediately
        meteorInterval,
        damagePerMeteor: params.damagePerMeteor,
        impactRadius: 100,
        ownerId: entityId,
      } as any);
      break;
    }

    case 'blizzard_freeze': {
      const tx = msg.targetX ?? pos.x;
      const ty = msg.targetY ?? pos.y;
      baseEffect.targetX = tx;
      baseEffect.targetY = ty;
      baseEffect.radius = params.radius;
      baseEffect.duration = params.freezeDuration;
      const r2 = params.radius * params.radius;
      for (const eid of world.query(C.Position, C.Faction)) {
        const ef = world.getComponent<FactionComponent>(eid, C.Faction);
        if (ef?.type !== 'enemy') continue;
        const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = ep.x - tx, dy = ep.y - ty;
        if (dx * dx + dy * dy > r2) continue;
        // Apply freeze
        let freeze = world.getComponent<FreezeComponent>(eid, C.Freeze);
        if (!freeze) {
          world.addComponent(eid, C.Freeze, { remaining: params.freezeDuration, breaksOnDamage: false });
          freeze = world.getComponent<FreezeComponent>(eid, C.Freeze)!;
        } else {
          freeze.remaining = Math.max(freeze.remaining, params.freezeDuration);
        }
        // Apply damage amplification via SoulMark component (reuse for damage amp)
        let mark = world.getComponent<SoulMarkComponent>(eid, C.SoulMark);
        if (!mark) {
          world.addComponent(eid, C.SoulMark, { damageAmp: params.damageAmp, remaining: params.freezeDuration, sourceId: entityId });
          mark = world.getComponent<SoulMarkComponent>(eid, C.SoulMark)!;
        } else {
          mark.damageAmp = Math.max(mark.damageAmp, params.damageAmp);
          mark.remaining = Math.max(mark.remaining, params.freezeDuration);
        }
      }
      break;
    }

    case 'thunderwave': {
      baseEffect.radius = params.radius;
      const r2 = params.radius * params.radius;
      for (const eid of world.query(C.Position, C.Health, C.Faction)) {
        const ef = world.getComponent<FactionComponent>(eid, C.Faction);
        if (ef?.type !== 'enemy') continue;
        const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = ep.x - pos.x, dy = ep.y - pos.y;
        if (dx * dx + dy * dy > r2) continue;
        // Knockback
        const d = distance(dx, dy) || 1;
        const kbx = (dx / d) * params.knockback;
        const kby = (dy / d) * params.knockback;
        const kb = world.getComponent<KnockbackReceiverComponent>(eid, C.KnockbackReceiver);
        if (kb) { kb.vx += kbx; kb.vy += kby; }
        // Stun
        let stun = world.getComponent<StunEffectComponent>(eid, C.StunEffect);
        if (!stun) {
          world.addComponent(eid, C.StunEffect, { remaining: params.stunDuration, sourceId: entityId });
        } else {
          stun.remaining = Math.max(stun.remaining, params.stunDuration);
        }
        hits.push({ sourceId: entityId, targetId: eid, damage: 0, knockbackVx: kbx, knockbackVy: kby });
      }
      break;
    }

  }

  return { effect: baseEffect, hits, deaths };
}
