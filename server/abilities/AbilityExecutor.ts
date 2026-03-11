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
  FearComponent,
  DamageMarkComponent,
  ShieldAbsorbComponent,
  StealthComponent,
  ChannelComponent,
  TransformComponent,
  PersistentZoneComponent,
  SummonOwnerComponent,
  SoulMarkComponent,
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

    case 'ground_slam': {
      // AOE damage + stun
      baseEffect.radius = params.radius;
      aoeDamageEnemies(world, entityId, pos.x, pos.y, params.radius, params.damage * 18, 150, hits, deaths);
      for (const e of enemiesInRadius(world, pos.x, pos.y, params.radius)) {
        let stun = world.getComponent<StunEffectComponent>(e.eid, C.StunEffect);
        if (!stun) {
          stun = { remaining: params.stunDuration, sourceId: entityId };
          world.addComponent(e.eid, C.StunEffect, stun);
        } else {
          stun.remaining = Math.max(stun.remaining, params.stunDuration);
        }
      }
      break;
    }

    case 'shield_charge': {
      // Dash forward, damage + knockback enemies along path
      const { destX, destY } = dashThroughEnemies(
        world, entityId, pos, msg.facing, params.distance,
        params.damage * 18, params.knockback, generator, hits, deaths,
      );
      baseEffect.targetX = destX;
      baseEffect.targetY = destY;
      break;
    }

    case 'battle_fury': {
      // Self buff: damage + attack speed
      baseEffect.duration = params.duration;
      pushBuff(world, entityId, 'battle_fury', params.duration, {
        damageMultiplier: params.damageBonus,
        attackSpeedMultiplier: params.attackSpeedBonus,
      });
      break;
    }

    case 'earthquake': {
      // Large AOE damage + slow
      baseEffect.radius = params.radius;
      aoeDamageEnemies(world, entityId, pos.x, pos.y, params.radius, params.damage * 18, 0, hits, deaths);
      for (const e of enemiesInRadius(world, pos.x, pos.y, params.radius)) {
        let slow = world.getComponent<SlowEffectComponent>(e.eid, C.SlowEffect);
        if (!slow) {
          slow = { factor: params.slowFactor, remaining: params.slowDuration };
          world.addComponent(e.eid, C.SlowEffect, slow);
        } else {
          slow.factor = Math.max(slow.factor, params.slowFactor);
          slow.remaining = Math.max(slow.remaining, params.slowDuration);
        }
      }
      break;
    }

    case 'blade_storm': {
      // Apply channel component - server ticks damage each frame
      baseEffect.radius = params.radius;
      baseEffect.duration = params.duration;
      world.addComponent(entityId, C.Channel, {
        abilityId: 'blade_storm',
        remaining: params.duration,
        tickDamage: params.damage * 18,
        radius: params.radius,
      } as ChannelComponent);
      break;
    }

    // =====================================================================
    // RANGER
    // =====================================================================

    case 'arrow_volley': {
      // Cone-shaped rain of arrows in facing direction
      const halfAngle = params.coneAngle / 2;
      const coneRange = 160; // range of the cone
      baseEffect.radius = coneRange;
      for (let i = 0; i < params.arrowCount; i++) {
        const angle = msg.facing - halfAngle + Math.random() * params.coneAngle;
        const dist = 30 + Math.random() * coneRange;
        const ax = pos.x + Math.cos(angle) * dist;
        const ay = pos.y + Math.sin(angle) * dist;
        for (const eid of world.query(C.Position, C.Health, C.Faction)) {
          const ef = world.getComponent<FactionComponent>(eid, C.Faction);
          if (ef?.type !== 'enemy') continue;
          const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
          const dx = ep.x - ax, dy = ep.y - ay;
          if (dx * dx + dy * dy > 20 * 20) continue;
          const dmg = applyDamage(world, eid, params.damage);
          hits.push({ sourceId: entityId, targetId: eid, damage: dmg, knockbackVx: 0, knockbackVy: 0 });
          const hp = world.getComponent<HealthComponent>(eid, C.Health)!;
          if (hp.current <= 0) deaths.push(eid);
        }
      }
      break;
    }

    case 'snare_net': {
      // Root + slow enemies at target position
      const tx = msg.targetX ?? pos.x;
      const ty = msg.targetY ?? pos.y;
      baseEffect.targetX = tx;
      baseEffect.targetY = ty;
      baseEffect.radius = params.radius;
      for (const e of enemiesInRadius(world, tx, ty, params.radius)) {
        // Apply root
        let root = world.getComponent<RootComponent>(e.eid, C.Root);
        if (!root) {
          root = { remaining: params.rootDuration };
          world.addComponent(e.eid, C.Root, root);
        } else {
          root.remaining = Math.max(root.remaining, params.rootDuration);
        }
        // Apply slow for after root ends
        let slow = world.getComponent<SlowEffectComponent>(e.eid, C.SlowEffect);
        if (!slow) {
          slow = { factor: params.slowFactor, remaining: params.rootDuration + 2 };
          world.addComponent(e.eid, C.SlowEffect, slow);
        } else {
          slow.factor = Math.max(slow.factor, params.slowFactor);
        }
      }
      break;
    }

    case 'grapple_hook': {
      // Teleport to cursor position, clamped to distance
      const { destX, destY } = teleportToCursor(pos, msg, params.distance, generator);
      baseEffect.targetX = destX;
      baseEffect.targetY = destY;
      break;
    }

    case 'marked_for_death': {
      // Apply DamageMark to nearest enemy
      const target = nearestEnemy(world, pos.x, pos.y, 200);
      if (target !== null) {
        world.addComponent(target, C.DamageMark, {
          remaining: params.duration,
          damage: params.damageAmp, // stored as amplification factor
          sourceId: entityId,
        } as DamageMarkComponent);
        const ep = world.getComponent<PositionComponent>(target, C.Position)!;
        baseEffect.targetX = ep.x;
        baseEffect.targetY = ep.y;
      }
      break;
    }

    case 'multishot': {
      // Buff that flags multishot mode
      baseEffect.duration = params.duration;
      pushBuff(world, entityId, 'multishot', params.duration, {
        multishot: params.arrowCount,
      });
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
      const meteorImpactRadius = 60; // Each meteor's splash radius
      const deathSet = new Set<number>();
      // Spread meteors across the full 300px area
      for (let i = 0; i < params.meteorCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * params.radius;
        const mx = tx + Math.cos(angle) * dist;
        const my = ty + Math.sin(angle) * dist;
        for (const eid of world.query(C.Position, C.Health, C.Faction)) {
          if (deathSet.has(eid)) continue; // Already dead from earlier meteor
          const ef = world.getComponent<FactionComponent>(eid, C.Faction);
          if (!ef || ef.type === 'player' || ef.type === 'building' || ef.type === 'item' || ef.type === 'guard' || ef.type === 'civilian') continue;
          const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
          const dx = ep.x - mx, dy = ep.y - my;
          if (dx * dx + dy * dy > meteorImpactRadius * meteorImpactRadius) continue;
          const hp = world.getComponent<HealthComponent>(eid, C.Health)!;
          if (hp.current <= 0) continue; // Already dead
          const def = world.getComponent<DefenseComponent>(eid, C.Defense);
          let dmg = params.damagePerMeteor;
          if (def) dmg = Math.max(1, Math.round((dmg - def.flat) * (1 - def.percent)));
          hp.current = Math.max(0, hp.current - dmg);
          hits.push({ sourceId: entityId, targetId: eid, damage: dmg, knockbackVx: 0, knockbackVy: 0 });
          if (hp.current <= 0) { deaths.push(eid); deathSet.add(eid); }
        }
      }
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
