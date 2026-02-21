import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  VelocityComponent,
  HealthComponent,
  DefenseComponent,
  FactionComponent,
  KnockbackReceiverComponent,
  ProjectileComponent,
  BuildingComponent,
  EnemyStatsComponent,
  GhostStateComponent,
  EnemyVariantComponent,
} from '@shared/components';
import {
  TILE_SIZE,
  RANGED_KNOCKBACK,
  PROJECTILE_RADIUS,
  PLAYER_RADIUS,
  ENEMY_RADIUS,
  RESOURCE_NODE_RADIUS,
  buildingHalfExtent,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import type { HitResult } from './CombatSystem';

export interface AoeEvent {
  x: number;
  y: number;
  radius: number;
}

export interface ProjectileTickResult {
  hits: HitResult[];
  deaths: number[];
  /** Projectile entity IDs to destroy (hit something, expired, or hit a wall). */
  destroyed: number[];
  /** AOE explosions to broadcast to clients. */
  aoeExplosions: AoeEvent[];
}

/**
 * Server-authoritative projectile system.
 *
 * Runs each tick: moves projectiles, checks wall and entity collisions,
 * applies damage + knockback on hit.
 */
/** Squared distance from point (px,py) to the closest point on segment (ax,ay)→(bx,by). */
function segPointDist2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) { const ex = px - ax, ey = py - ay; return ex * ex + ey * ey; }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx, cy = ay + t * dy;
  const ex = px - cx, ey = py - cy;
  return ex * ex + ey * ey;
}

export class ProjectileSystem {
  constructor(private readonly generator: WorldGenerator) {}

  update(world: World, dt: number): ProjectileTickResult {
    const hits: HitResult[] = [];
    const deaths: number[] = [];
    const destroyed: number[] = [];
    const aoeExplosions: AoeEvent[] = [];

    const projectiles = world.query(C.Projectile, C.Position, C.Velocity);
    // Query potential targets once (not per-projectile) - O(P+E) instead of O(P*E)
    const targets = world.query(C.Position, C.Health);

    for (const projId of projectiles) {
      const proj = world.getComponent<ProjectileComponent>(projId, C.Projectile)!;
      const pos  = world.getComponent<PositionComponent>(projId, C.Position)!;
      const vel  = world.getComponent<VelocityComponent>(projId, C.Velocity)!;

      // Tick down lifetime
      proj.lifetime -= dt;
      if (proj.lifetime <= 0) {
        destroyed.push(projId);
        continue;
      }

      // ── Mortar projectile (cannon turret) ──
      // Flies to target position bypassing all collision, detonates AOE on arrival.
      if (proj.flightTime != null && proj.targetX != null && proj.targetY != null) {
        proj.flightTime -= dt;
        // Move position toward target
        pos.x += vel.vx * dt;
        pos.y += vel.vy * dt;

        if (proj.flightTime <= 0) {
          // Snap to target and detonate
          pos.x = proj.targetX;
          pos.y = proj.targetY;
          const aoeR = proj.aoeRadius ?? 40;
          aoeExplosions.push({ x: pos.x, y: pos.y, radius: aoeR });
          const aoeR2 = aoeR * aoeR;

          for (const aoeTarget of targets) {
            if (aoeTarget === projId) continue;
            if (world.getComponent(aoeTarget, C.Projectile)) continue;
            const aoeFaction = world.getComponent<FactionComponent>(aoeTarget, C.Faction);
            // AOE hits enemies, portals, and resource nodes
            if (aoeFaction?.type !== 'enemy' && aoeFaction?.type !== 'resource' && aoeFaction?.type !== 'portal') continue;
            if (world.hasComponent(aoeTarget, C.Downed)) continue;
            const aoePos = world.getComponent<PositionComponent>(aoeTarget, C.Position)!;
            const adx = aoePos.x - pos.x, ady = aoePos.y - pos.y;
            if (adx * adx + ady * ady > aoeR2) continue;
            const aoeHp = world.getComponent<HealthComponent>(aoeTarget, C.Health)!;
            let aoeDmg: number;
            if (aoeFaction?.type === 'resource') {
              aoeDmg = proj.damage;
            } else {
              const aoeDef = world.getComponent<DefenseComponent>(aoeTarget, C.Defense);
              aoeDmg = proj.damage;
              if (aoeDef) aoeDmg = Math.max(0, Math.round((aoeDmg - aoeDef.flat) * (1 - aoeDef.percent)));
            }
            aoeHp.current = Math.max(0, aoeHp.current - aoeDmg);
            hits.push({ sourceId: proj.ownerId, targetId: aoeTarget, damage: aoeDmg, knockbackVx: 0, knockbackVy: 0 });
            if (aoeHp.current <= 0) deaths.push(aoeTarget);
          }

          destroyed.push(projId);
        }
        continue; // Skip normal collision logic for mortar projectiles
      }

      // Remember old position for swept collision
      const oldX = pos.x, oldY = pos.y;

      // Move
      pos.x += vel.vx * dt;
      pos.y += vel.vy * dt;

      const projFaction = world.getComponent<FactionComponent>(projId, C.Faction);
      const isPlayerProj = projFaction?.type === 'player';

      // Wall collision — player projectiles pass through walls, enemy projectiles don't
      if (!isPlayerProj && this.isSolidTile(pos.x, pos.y)) {
        destroyed.push(projId);
        continue;
      }

      // Building collision — enemy projectiles are blocked by buildings (player/turret projectiles pass through)
      if (!isPlayerProj && this.hitsBuilding(world, oldX, oldY, pos.x, pos.y, proj.ownerId)) {
        destroyed.push(projId);
        continue;
      }

      // Entity collision (swept: check along old→new segment)
      let hitSomething = false;

      for (const targetId of targets) {
        // Skip self and other projectiles
        if (targetId === projId) continue;
        if (world.getComponent(targetId, C.Projectile)) continue;

        // Skip same faction (no friendly fire), but allow cross-faction enemy combat
        const tgtFaction = world.getComponent<FactionComponent>(targetId, C.Faction);
        if (projFaction && tgtFaction && projFaction.type === tgtFaction.type) {
          if (!(projFaction.type === 'enemy' && projFaction.enemyFaction && tgtFaction.enemyFaction
                && projFaction.enemyFaction !== tgtFaction.enemyFaction)) continue;
        }

        // Enemy projectiles don't hit portals
        if (projFaction?.type === 'enemy' && tgtFaction?.type === 'portal') continue;

        // Item drops are not damageable
        if (tgtFaction?.type === 'item') continue;
        // Enemy projectiles can't damage resource nodes (only players can harvest them)
        if (projFaction?.type === 'enemy' && tgtFaction?.type === 'resource') continue;

        // Bridges and spike traps are invulnerable to enemy projectiles
        if (projFaction?.type === 'enemy' && tgtFaction?.type === 'building') {
          const bldg = world.getComponent<BuildingComponent>(targetId, C.Building);
          if (bldg?.buildingType === 'bridge' || bldg?.buildingType === 'spike_trap') continue;
        }

        // Player projectiles don't damage own buildings (no friendly fire on structures)
        if (projFaction?.type === 'player' && tgtFaction?.type === 'building') continue;

        // Skip the owner entity (can't shoot yourself)
        if (targetId === proj.ownerId) continue;

        // Skip downed players - they're already at 0 HP
        if (world.hasComponent(targetId, C.Downed)) continue;

        // Hidden ghosts are untargetable by player/guard projectiles
        if (projFaction?.type !== 'enemy') {
          const ghostSt = world.getComponent<GhostStateComponent>(targetId, C.GhostState);
          if (ghostSt?.hidden) continue;
        }

        const tgtPos = world.getComponent<PositionComponent>(targetId, C.Position)!;

        // Target radius varies by entity type
        const isResource = tgtFaction?.type === 'resource';
        const tgtRadius = isResource
          ? RESOURCE_NODE_RADIUS
          : world.getComponent(targetId, C.PlayerIndex)
            ? PLAYER_RADIUS
            : (world.getComponent<EnemyStatsComponent>(targetId, C.EnemyStats)?.radius ?? ENEMY_RADIUS);
        const collisionDist = PROJECTILE_RADIUS + tgtRadius;

        // Swept collision: closest point on path segment to target center
        const d2 = segPointDist2(oldX, oldY, pos.x, pos.y, tgtPos.x, tgtPos.y);
        if (d2 > collisionDist * collisionDist) continue;

        // Apply damage with defense reduction
        // Resource nodes: cannon AOE deals full damage, normal projectiles deal 1
        const hp  = world.getComponent<HealthComponent>(targetId, C.Health)!;
        let damage: number;
        if (isResource) {
          damage = (proj.aoeRadius && proj.aoeRadius > 0) ? proj.damage : 1;
        } else {
          const def = world.getComponent<DefenseComponent>(targetId, C.Defense);
          damage = proj.damage;
          if (def) damage = Math.max(0, Math.round((damage - def.flat) * (1 - def.percent)));
        }
        hp.current = Math.max(0, hp.current - damage);

        // Knockback - direction from projectile to target (giants are immune)
        let knockbackVx = 0;
        let knockbackVy = 0;
        const dx = tgtPos.x - pos.x;
        const dy = tgtPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const tgtVariant = world.getComponent<EnemyVariantComponent>(targetId, C.EnemyVariant);
        if (RANGED_KNOCKBACK > 0 && dist > 0 && tgtVariant?.variant !== 'giant') {
          knockbackVx = (dx / dist) * RANGED_KNOCKBACK;
          knockbackVy = (dy / dist) * RANGED_KNOCKBACK;
          const kb = world.getComponent<KnockbackReceiverComponent>(targetId, C.KnockbackReceiver);
          if (kb) {
            kb.vx += knockbackVx;
            kb.vy += knockbackVy;
          }
        }

        hits.push({ sourceId: proj.ownerId, targetId, damage, knockbackVx, knockbackVy });
        if (hp.current <= 0) deaths.push(targetId);

        // AOE explosion: damage all enemies within radius (cannon turret)
        if (proj.aoeRadius && proj.aoeRadius > 0) {
          aoeExplosions.push({ x: pos.x, y: pos.y, radius: proj.aoeRadius });
          const aoeR2 = proj.aoeRadius * proj.aoeRadius;
          for (const aoeTarget of targets) {
            if (aoeTarget === projId || aoeTarget === targetId) continue;
            if (world.getComponent(aoeTarget, C.Projectile)) continue;
            const aoeFaction = world.getComponent<FactionComponent>(aoeTarget, C.Faction);
            // AOE hits enemies and resource nodes
            if (aoeFaction?.type !== 'enemy' && aoeFaction?.type !== 'resource') continue;
            if (world.hasComponent(aoeTarget, C.Downed)) continue;
            const aoePos = world.getComponent<PositionComponent>(aoeTarget, C.Position)!;
            const adx = aoePos.x - pos.x, ady = aoePos.y - pos.y;
            if (adx * adx + ady * ady > aoeR2) continue;
            const aoeHp = world.getComponent<HealthComponent>(aoeTarget, C.Health)!;
            let aoeDmg: number;
            if (aoeFaction?.type === 'resource') {
              aoeDmg = proj.damage;
            } else {
              const aoeDef = world.getComponent<DefenseComponent>(aoeTarget, C.Defense);
              aoeDmg = proj.damage;
              if (aoeDef) aoeDmg = Math.max(0, Math.round((aoeDmg - aoeDef.flat) * (1 - aoeDef.percent)));
            }
            aoeHp.current = Math.max(0, aoeHp.current - aoeDmg);
            hits.push({ sourceId: proj.ownerId, targetId: aoeTarget, damage: aoeDmg, knockbackVx: 0, knockbackVy: 0 });
            if (aoeHp.current <= 0) deaths.push(aoeTarget);
          }
        }

        hitSomething = true;
        break; // No piercing - first hit destroys the projectile
      }

      if (hitSomething) {
        destroyed.push(projId);
      }
    }

    return { hits, deaths, destroyed, aoeExplosions };
  }

  /** Returns true if the world-pixel position is on a solid tile (walls, mountains). */
  private isSolidTile(wx: number, wy: number): boolean {
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    const tileId = this.generator.getTile(tx, ty);
    return TILE_DEFS[tileId]?.solid ?? false;
  }

  /** Returns true if the projectile path intersects any building AABB (spike traps and bridges excluded). */
  private hitsBuilding(world: World, x1: number, y1: number, x2: number, y2: number, ownerId: number): boolean {
    for (const id of world.query(C.Building, C.Position)) {
      if (id === ownerId) continue; // Turret projectiles skip their own building
      const bldg = world.getComponent<BuildingComponent>(id, C.Building)!;
      // Spike traps and bridges don't block projectiles
      if (bldg.buildingType === 'spike_trap' || bldg.buildingType === 'bridge') continue;
      // Damageable buildings (campfire, barracks, etc.) should take damage via entity
      // collision, not silently block the projectile
      if (world.hasComponent(id, C.Health)) continue;
      const bPos = world.getComponent<PositionComponent>(id, C.Position)!;
      const half = buildingHalfExtent(bldg.buildingType);
      // Expand AABB by projectile radius for swept check
      const minX = bPos.x - half - PROJECTILE_RADIUS;
      const maxX = bPos.x + half + PROJECTILE_RADIUS;
      const minY = bPos.y - half - PROJECTILE_RADIUS;
      const maxY = bPos.y + half + PROJECTILE_RADIUS;
      // Check if endpoint is inside expanded AABB
      if (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY) return true;
      // Segment-AABB intersection for fast projectiles
      if (this.segIntersectsAABB(x1, y1, x2, y2, minX, minY, maxX, maxY)) return true;
    }
    return false;
  }

  /** Simple segment vs AABB intersection using parametric clipping. */
  private segIntersectsAABB(
    x1: number, y1: number, x2: number, y2: number,
    minX: number, minY: number, maxX: number, maxY: number,
  ): boolean {
    const dx = x2 - x1, dy = y2 - y1;
    let tmin = 0, tmax = 1;
    if (dx !== 0) {
      const tx1 = (minX - x1) / dx, tx2 = (maxX - x1) / dx;
      tmin = Math.max(tmin, Math.min(tx1, tx2));
      tmax = Math.min(tmax, Math.max(tx1, tx2));
    } else if (x1 < minX || x1 > maxX) return false;
    if (dy !== 0) {
      const ty1 = (minY - y1) / dy, ty2 = (maxY - y1) / dy;
      tmin = Math.max(tmin, Math.min(ty1, ty2));
      tmax = Math.min(tmax, Math.max(ty1, ty2));
    } else if (y1 < minY || y1 > maxY) return false;
    return tmin <= tmax;
  }
}
