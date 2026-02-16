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
} from '@shared/components';
import {
  TILE_SIZE,
  RANGED_KNOCKBACK,
  PROJECTILE_RADIUS,
  PLAYER_RADIUS,
  ENEMY_RADIUS,
  RESOURCE_NODE_RADIUS,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import type { HitResult } from './CombatSystem';

export interface ProjectileTickResult {
  hits: HitResult[];
  deaths: number[];
  /** Projectile entity IDs to destroy (hit something, expired, or hit a wall). */
  destroyed: number[];
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

      // Remember old position for swept collision
      const oldX = pos.x, oldY = pos.y;

      // Move
      pos.x += vel.vx * dt;
      pos.y += vel.vy * dt;

      // Wall collision (solid tiles only - projectiles fly over water)
      if (this.isSolidTile(pos.x, pos.y)) {
        destroyed.push(projId);
        continue;
      }

      // Entity collision (swept: check along old→new segment)
      const projFaction = world.getComponent<FactionComponent>(projId, C.Faction);
      let hitSomething = false;

      for (const targetId of targets) {
        // Skip self and other projectiles
        if (targetId === projId) continue;
        if (world.getComponent(targetId, C.Projectile)) continue;

        // Skip same faction (no friendly fire)
        const tgtFaction = world.getComponent<FactionComponent>(targetId, C.Faction);
        if (projFaction && tgtFaction && projFaction.type === tgtFaction.type) continue;

        // Enemy projectiles don't hit portals
        if (projFaction?.type === 'enemy' && tgtFaction?.type === 'portal') continue;

        // Item drops are not damageable
        if (tgtFaction?.type === 'item') continue;
        // Enemy projectiles can't damage resource nodes (only players can harvest them)
        if (projFaction?.type === 'enemy' && tgtFaction?.type === 'resource') continue;

        // Bridges are invulnerable to enemy projectiles
        if (projFaction?.type === 'enemy' && tgtFaction?.type === 'building') {
          const bldg = world.getComponent<BuildingComponent>(targetId, C.Building);
          if (bldg?.buildingType === 'bridge') continue;
        }

        // Player projectiles don't damage own buildings (no friendly fire on structures)
        if (projFaction?.type === 'player' && tgtFaction?.type === 'building') continue;

        // Skip the owner entity (can't shoot yourself)
        if (targetId === proj.ownerId) continue;

        // Skip downed players - they're already at 0 HP
        if (world.hasComponent(targetId, C.Downed)) continue;

        const tgtPos = world.getComponent<PositionComponent>(targetId, C.Position)!;

        // Target radius varies by entity type
        const isResource = tgtFaction?.type === 'resource';
        const tgtRadius = isResource
          ? RESOURCE_NODE_RADIUS
          : world.getComponent(targetId, C.PlayerIndex)
            ? PLAYER_RADIUS
            : ENEMY_RADIUS;
        const collisionDist = PROJECTILE_RADIUS + tgtRadius;

        // Swept collision: closest point on path segment to target center
        const d2 = segPointDist2(oldX, oldY, pos.x, pos.y, tgtPos.x, tgtPos.y);
        if (d2 > collisionDist * collisionDist) continue;

        // Apply damage with defense reduction (resource nodes always take 1 damage)
        const hp  = world.getComponent<HealthComponent>(targetId, C.Health)!;
        let damage: number;
        if (isResource) {
          damage = 1;
        } else {
          const def = world.getComponent<DefenseComponent>(targetId, C.Defense);
          damage = proj.damage;
          if (def) damage = Math.max(0, Math.round((damage - def.flat) * (1 - def.percent)));
        }
        hp.current = Math.max(0, hp.current - damage);

        // Knockback - direction from projectile to target
        let knockbackVx = 0;
        let knockbackVy = 0;
        const dx = tgtPos.x - pos.x;
        const dy = tgtPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (RANGED_KNOCKBACK > 0 && dist > 0) {
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

        hitSomething = true;
        break; // No piercing - first hit destroys the projectile
      }

      if (hitSomething) {
        destroyed.push(projId);
      }
    }

    return { hits, deaths, destroyed };
  }

  /** Returns true if the world-pixel position is on a solid tile (walls, mountains). */
  private isSolidTile(wx: number, wy: number): boolean {
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    const tileId = this.generator.getTile(tx, ty);
    return TILE_DEFS[tileId]?.solid ?? false;
  }
}
