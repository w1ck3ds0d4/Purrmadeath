import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  VelocityComponent,
  HealthComponent,
  DefenseComponent,
  FactionComponent,
  KnockbackReceiverComponent,
  ActiveBuffsComponent,
  SpeedComponent,
  BurnDotComponent,
  SlowEffectComponent,
} from '@shared/components';
import type { AbilityParams, SkillActiveAbility } from '@shared/SkillDefinitions';
import type { AbilityEffectMessage } from '@shared/protocol';
import { MessageType } from '@shared/protocol';
import {
  PLAYER_RADIUS,
  ENEMY_RADIUS,
  TILE_SIZE,
  RANGED_SPEED,
  PROJECTILE_RADIUS,
  RANGED_LIFETIME,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import type { WorldGenerator } from '@shared/world/WorldGenerator';
import type { SessionPlayer } from '../GameSession';
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
    case 'whirlwind': {
      // 360° damage to all enemies in radius
      baseEffect.radius = params.radius;
      const r2 = params.radius * params.radius;
      for (const eid of world.query(C.Position, C.Health, C.Faction)) {
        const ef = world.getComponent<FactionComponent>(eid, C.Faction);
        if (ef?.type !== 'enemy') continue;
        const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = ep.x - pos.x, dy = ep.y - pos.y;
        if (dx * dx + dy * dy > r2) continue;
        const hp = world.getComponent<HealthComponent>(eid, C.Health)!;
        const def = world.getComponent<DefenseComponent>(eid, C.Defense);
        let dmg = Math.round(params.damage * 18); // 3× warrior base damage
        if (def) dmg = Math.max(0, Math.round((dmg - def.flat) * (1 - def.percent)));
        hp.current = Math.max(0, hp.current - dmg);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const kbx = (dx / dist) * 200, kby = (dy / dist) * 200;
        const kb = world.getComponent<KnockbackReceiverComponent>(eid, C.KnockbackReceiver);
        if (kb) { kb.vx += kbx; kb.vy += kby; }
        hits.push({ sourceId: entityId, targetId: eid, damage: dmg, knockbackVx: kbx, knockbackVy: kby });
        if (hp.current <= 0) deaths.push(eid);
      }
      break;
    }

    case 'shield_wall': {
      // Add timed defense buff to player
      baseEffect.duration = params.duration;
      let ab = world.getComponent<ActiveBuffsComponent>(entityId, C.ActiveBuffs);
      if (!ab) {
        ab = { buffs: [] };
        world.addComponent(entityId, C.ActiveBuffs, ab);
      }
      ab.buffs.push({
        id: 'shield_wall',
        remaining: params.duration,
        effect: { defensePercent: params.damageReduction },
      });
      break;
    }

    case 'war_cry': {
      // Buff all friendly players in radius
      baseEffect.radius = params.radius;
      baseEffect.duration = params.duration;
      const r2 = params.radius * params.radius;
      for (const pid of world.query(C.Position, C.Faction)) {
        const pf = world.getComponent<FactionComponent>(pid, C.Faction);
        if (pf?.type !== 'player') continue;
        const pp = world.getComponent<PositionComponent>(pid, C.Position)!;
        const dx = pp.x - pos.x, dy = pp.y - pos.y;
        if (dx * dx + dy * dy > r2) continue;
        let ab = world.getComponent<ActiveBuffsComponent>(pid, C.ActiveBuffs);
        if (!ab) { ab = { buffs: [] }; world.addComponent(pid, C.ActiveBuffs, ab); }
        ab.buffs.push({
          id: 'war_cry',
          remaining: params.duration,
          effect: { damageMultiplier: params.damageBonus },
        });
      }
      break;
    }

    case 'rain_of_arrows': {
      // Spawn projectiles at random positions within target area
      const tx = msg.targetX ?? pos.x;
      const ty = msg.targetY ?? pos.y;
      baseEffect.targetX = tx;
      baseEffect.targetY = ty;
      baseEffect.radius = params.radius;
      for (let i = 0; i < params.arrowCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * params.radius;
        const ax = tx + Math.cos(angle) * dist;
        const ay = ty + Math.sin(angle) * dist;
        // Deal damage to enemies near each arrow landing
        for (const eid of world.query(C.Position, C.Health, C.Faction)) {
          const ef = world.getComponent<FactionComponent>(eid, C.Faction);
          if (ef?.type !== 'enemy') continue;
          const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
          const dx = ep.x - ax, dy = ep.y - ay;
          if (dx * dx + dy * dy > 20 * 20) continue; // 20px hit radius per arrow
          const hp = world.getComponent<HealthComponent>(eid, C.Health)!;
          const def = world.getComponent<DefenseComponent>(eid, C.Defense);
          let dmg = params.damage;
          if (def) dmg = Math.max(0, Math.round((dmg - def.flat) * (1 - def.percent)));
          hp.current = Math.max(0, hp.current - dmg);
          hits.push({ sourceId: entityId, targetId: eid, damage: dmg, knockbackVx: 0, knockbackVy: 0 });
          if (hp.current <= 0) deaths.push(eid);
        }
      }
      break;
    }

    case 'explosive_trap': {
      // Create a trap entity at target position
      const tx = msg.targetX ?? pos.x;
      const ty = msg.targetY ?? pos.y;
      baseEffect.targetX = tx;
      baseEffect.targetY = ty;
      baseEffect.radius = params.radius;
      // Immediate AOE explosion at target
      const r2 = params.radius * params.radius;
      for (const eid of world.query(C.Position, C.Health, C.Faction)) {
        const ef = world.getComponent<FactionComponent>(eid, C.Faction);
        if (ef?.type !== 'enemy') continue;
        const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = ep.x - tx, dy = ep.y - ty;
        if (dx * dx + dy * dy > r2) continue;
        const hp = world.getComponent<HealthComponent>(eid, C.Health)!;
        const def = world.getComponent<DefenseComponent>(eid, C.Defense);
        let dmg = params.damage;
        if (def) dmg = Math.max(0, Math.round((dmg - def.flat) * (1 - def.percent)));
        hp.current = Math.max(0, hp.current - dmg);
        hits.push({ sourceId: entityId, targetId: eid, damage: dmg, knockbackVx: 0, knockbackVy: 0 });
        if (hp.current <= 0) deaths.push(eid);
      }
      break;
    }

    case 'shadow_step': {
      // Teleport forward in facing direction
      const dirX = Math.cos(msg.facing);
      const dirY = Math.sin(msg.facing);
      let destX = pos.x + dirX * params.distance;
      let destY = pos.y + dirY * params.distance;
      // Walk back toward player until we find a walkable tile
      for (let d = params.distance; d >= 0; d -= 10) {
        const cx = pos.x + dirX * d;
        const cy = pos.y + dirY * d;
        if (isWalkable(generator, cx, cy)) {
          destX = cx;
          destY = cy;
          break;
        }
      }
      baseEffect.targetX = destX;
      baseEffect.targetY = destY;
      pos.x = destX;
      pos.y = destY;
      break;
    }

    case 'meteor': {
      // Massive AOE damage at target — hits enemies, resources, and portals
      const tx = msg.targetX ?? pos.x;
      const ty = msg.targetY ?? pos.y;
      baseEffect.targetX = tx;
      baseEffect.targetY = ty;
      baseEffect.radius = params.radius;
      const r2 = params.radius * params.radius;
      for (const eid of world.query(C.Position, C.Health, C.Faction)) {
        if (eid === entityId) continue;
        const ef = world.getComponent<FactionComponent>(eid, C.Faction);
        if (!ef || ef.type === 'player' || ef.type === 'building' || ef.type === 'item' || ef.type === 'guard') continue;
        const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = ep.x - tx, dy = ep.y - ty;
        if (dx * dx + dy * dy > r2) continue;
        const hp = world.getComponent<HealthComponent>(eid, C.Health)!;
        const def = world.getComponent<DefenseComponent>(eid, C.Defense);
        // 3x damage to resources and portals
        const isObject = ef.type === 'resource' || ef.type === 'portal';
        let dmg = isObject ? params.damage * 3 : params.damage;
        if (def) dmg = Math.max(0, Math.round((dmg - def.flat) * (1 - def.percent)));
        hp.current = Math.max(0, hp.current - dmg);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const kbx = (dx / dist) * 300, kby = (dy / dist) * 300;
        const kb = world.getComponent<KnockbackReceiverComponent>(eid, C.KnockbackReceiver);
        if (kb) { kb.vx += kbx; kb.vy += kby; }
        hits.push({ sourceId: entityId, targetId: eid, damage: dmg, knockbackVx: kbx, knockbackVy: kby });
        if (hp.current <= 0) deaths.push(eid);
      }
      break;
    }

    case 'blizzard': {
      // Create a slow zone — for simplicity, do immediate AOE damage + slow
      const tx = msg.targetX ?? pos.x;
      const ty = msg.targetY ?? pos.y;
      baseEffect.targetX = tx;
      baseEffect.targetY = ty;
      baseEffect.radius = params.radius;
      baseEffect.duration = params.duration;
      const r2 = params.radius * params.radius;
      for (const eid of world.query(C.Position, C.Faction)) {
        const ef = world.getComponent<FactionComponent>(eid, C.Faction);
        if (ef?.type !== 'enemy') continue;
        const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = ep.x - tx, dy = ep.y - ty;
        if (dx * dx + dy * dy > r2) continue;
        // Apply slow effect
        let slow = world.getComponent<SlowEffectComponent>(eid, C.SlowEffect);
        if (!slow) {
          slow = { factor: params.slowFactor, remaining: params.duration };
          world.addComponent(eid, C.SlowEffect, slow);
        } else {
          slow.factor = Math.max(slow.factor, params.slowFactor);
          slow.remaining = Math.max(slow.remaining, params.duration);
        }
      }
      break;
    }

    case 'teleport': {
      // Blink to cursor position (clamped to max distance)
      const tx = msg.targetX ?? pos.x;
      const ty = msg.targetY ?? pos.y;
      const dx = tx - pos.x, dy = ty - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let destX: number, destY: number;
      if (dist <= params.maxDistance) {
        destX = tx;
        destY = ty;
      } else {
        destX = pos.x + (dx / dist) * params.maxDistance;
        destY = pos.y + (dy / dist) * params.maxDistance;
      }
      // Validate destination is walkable
      if (!isWalkable(generator, destX, destY)) {
        // Try halfway
        destX = pos.x + (destX - pos.x) * 0.5;
        destY = pos.y + (destY - pos.y) * 0.5;
        if (!isWalkable(generator, destX, destY)) break; // Abort if nowhere walkable
      }
      baseEffect.targetX = destX;
      baseEffect.targetY = destY;
      pos.x = destX;
      pos.y = destY;
      break;
    }
  }

  return { effect: baseEffect, hits, deaths };
}
