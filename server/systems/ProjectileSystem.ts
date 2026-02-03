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
} from '@shared/components';
import {
  TILE_SIZE,
  RANGED_KNOCKBACK,
  PROJECTILE_RADIUS,
  PLAYER_RADIUS,
  ENEMY_RADIUS,
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
export class ProjectileSystem {
  constructor(private readonly generator: WorldGenerator) {}

  update(world: World, dt: number): ProjectileTickResult {
    const hits: HitResult[] = [];
    const deaths: number[] = [];
    const destroyed: number[] = [];

    const projectiles = world.query(C.Projectile, C.Position, C.Velocity);
    // Query potential targets once (not per-projectile) — O(P+E) instead of O(P*E)
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

      // Move
      pos.x += vel.vx * dt;
      pos.y += vel.vy * dt;

      // Wall collision (solid tiles only — projectiles fly over water)
      if (this.isSolidTile(pos.x, pos.y)) {
        destroyed.push(projId);
        continue;
      }

      // Entity collision
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

        // Skip the owner entity (can't shoot yourself)
        if (targetId === proj.ownerId) continue;

        const tgtPos = world.getComponent<PositionComponent>(targetId, C.Position)!;
        const dx = tgtPos.x - pos.x;
        const dy = tgtPos.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Target radius: players are bigger than enemies
        const tgtRadius = world.getComponent(targetId, C.PlayerIndex)
          ? PLAYER_RADIUS
          : ENEMY_RADIUS;
        const collisionDist = PROJECTILE_RADIUS + tgtRadius;

        if (dist > collisionDist) continue;

        // Apply damage with defense reduction
        const hp  = world.getComponent<HealthComponent>(targetId, C.Health)!;
        const def = world.getComponent<DefenseComponent>(targetId, C.Defense);
        let damage = proj.damage;
        if (def) damage = Math.max(0, Math.round((damage - def.flat) * (1 - def.percent)));
        hp.current = Math.max(0, hp.current - damage);

        // Knockback — direction from projectile to target
        let knockbackVx = 0;
        let knockbackVy = 0;
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
        break; // No piercing — first hit destroys the projectile
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
