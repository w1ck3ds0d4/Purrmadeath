import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  VelocityComponent,
  SpeedComponent,
  PlayerInputComponent,
  KnockbackReceiverComponent,
  FactionComponent,
  BuildingComponent,
  EnemyVariantComponent,
  EnemyStatsComponent,
} from '@shared/components';
import {
  TILE_SIZE,
  PLAYER_RADIUS,
  PLAYER_SPRINT_MULTIPLIER,
  ENEMY_RADIUS,
  PORTAL_RADIUS,
  RESOURCE_NODE_RADIUS,
  ENTITY_SEPARATION_ITERATIONS,
  buildingHalfExtent,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import { WorldGenerator } from '@shared/world/WorldGenerator';

const ACCEL   = 20;
const FRICTION = 16;

function getEntityRadius(factionType: string): number {
  switch (factionType) {
    case 'player':   return PLAYER_RADIUS;
    case 'enemy':    return ENEMY_RADIUS;
    case 'guard':    return ENEMY_RADIUS;
    case 'portal':   return PORTAL_RADIUS;
    case 'resource': return RESOURCE_NODE_RADIUS;
    default:         return 0;
  }
}

/** True for entity types that use AABB (square) collision instead of circle. */
function isSquareEntity(factionType: string): boolean {
  return factionType === 'resource';
}

/**
 * Circle-vs-AABB overlap resolution.
 * Returns the push vector to move the circle OUT of the box, or null if no overlap.
 */
function circleAABBPush(
  cx: number, cy: number, cr: number,        // circle center + radius
  bx: number, by: number, bHalf: number,     // box center + half-extent
): { px: number; py: number } | null {
  const closestX = Math.max(bx - bHalf, Math.min(cx, bx + bHalf));
  const closestY = Math.max(by - bHalf, Math.min(cy, by + bHalf));

  const dx = cx - closestX;
  const dy = cy - closestY;
  const distSq = dx * dx + dy * dy;

  if (distSq >= cr * cr) return null;

  if (distSq < 0.0001) {
    // Circle center is inside the box - push along shortest axis
    const overlapL = (cx - (bx - bHalf)) + cr;
    const overlapR = ((bx + bHalf) - cx) + cr;
    const overlapT = (cy - (by - bHalf)) + cr;
    const overlapB = ((by + bHalf) - cy) + cr;
    const min = Math.min(overlapL, overlapR, overlapT, overlapB);
    if (min === overlapL) return { px: -min, py: 0 };
    if (min === overlapR) return { px: min, py: 0 };
    if (min === overlapT) return { px: 0, py: -min };
    return { px: 0, py: min };
  }

  const dist = Math.sqrt(distSq);
  const overlap = cr - dist;
  return { px: (dx / dist) * overlap, py: (dy / dist) * overlap };
}

/**
 * Authoritative server-side movement system.
 *
 * Mirrors the client MovementSystem exactly so that client prediction stays
 * in sync with the server simulation. Uses WorldGenerator.getTile() directly
 * (no ChunkManager cache needed - server generates tiles on demand).
 */
export class MovementSystem {
  /** Cached resource node positions - refreshed each update for solid-block collision. */
  private resourceCache: PositionComponent[] = [];
  /** Cached portal positions - refreshed each update for solid-circle collision. */
  private portalCache: PositionComponent[] = [];
  /** Cached building positions - refreshed each update for solid-block collision. */
  private buildingCache: { x: number; y: number; halfExtent: number }[] = [];
  /** Bridge tile keys ("tileX,tileY") that override unwalkable terrain. Populated by GameSession. */
  bridgeTiles = new Set<string>();

  constructor(private readonly generator: WorldGenerator) {}

  update(world: World, dt: number): void {
    // Cache solid entities so overlapsAny can treat them as solid blocks
    this.cacheResources(world);
    this.cachePortals(world);
    this.cacheBuildings(world);
    for (const id of world.query(C.Position, C.Velocity, C.Speed, C.PlayerInput)) {
      // Skip downed entities - they cannot move
      if (world.hasComponent(id, C.Downed)) continue;

      const pos   = world.getComponent<PositionComponent>(id, C.Position)!;
      const vel   = world.getComponent<VelocityComponent>(id, C.Velocity)!;
      const speed = world.getComponent<SpeedComponent>(id, C.Speed)!;
      const inp   = world.getComponent<PlayerInputComponent>(id, C.PlayerInput)!;

      // Determine collision radius: enemies/guards use their per-variant radius
      const faction = world.getComponent<FactionComponent>(id, C.Faction);
      const entityRadius = (faction?.type === 'enemy' || faction?.type === 'guard')
        ? (world.getComponent<EnemyStatsComponent>(id, C.EnemyStats)?.radius ?? ENEMY_RADIUS)
        : PLAYER_RADIUS;

      const maxSpeed = speed.base * speed.multiplier * (inp.sprint ? PLAYER_SPRINT_MULTIPLIER : 1);

      let dx = inp.dx;
      let dy = inp.dy;
      if (dx !== 0 && dy !== 0) {
        const inv = 1 / Math.SQRT2;
        dx *= inv;
        dy *= inv;
      }

      if (inp.dx !== 0) {
        vel.vx += (dx * maxSpeed - vel.vx) * Math.min(ACCEL * dt, 1);
      } else {
        vel.vx *= Math.max(0, 1 - FRICTION * dt);
      }
      if (inp.dy !== 0) {
        vel.vy += (dy * maxSpeed - vel.vy) * Math.min(ACCEL * dt, 1);
      } else {
        vel.vy *= Math.max(0, 1 - FRICTION * dt);
      }

      // Wall-slide collision (ghosts phase through everything)
      const nx = pos.x + vel.vx * dt;
      const ny = pos.y + vel.vy * dt;

      const ev = world.getComponent<EnemyVariantComponent>(id, C.EnemyVariant);
      const isGhost = ev?.variant === 'ghost';

      if (isGhost || !this.overlapsAny(nx, ny, entityRadius)) {
        pos.x = nx;
        pos.y = ny;
      } else if (!this.overlapsAny(nx, pos.y, entityRadius)) {
        pos.x = nx;
        vel.vy = 0;
      } else if (!this.overlapsAny(pos.x, ny, entityRadius)) {
        pos.y = ny;
        vel.vx = 0;
      } else {
        vel.vx = 0;
        vel.vy = 0;
      }

      // Apply and decay knockback impulse (separate from movement velocity)
      const kb = world.getComponent<KnockbackReceiverComponent>(id, C.KnockbackReceiver);
      if (kb && (kb.vx !== 0 || kb.vy !== 0)) {
        const kx = pos.x + kb.vx * dt;
        const ky = pos.y + kb.vy * dt;
        if (!this.overlapsAny(kx, ky, entityRadius)) {
          pos.x = kx; pos.y = ky;
        } else if (!this.overlapsAny(kx, pos.y, entityRadius)) {
          pos.x = kx;
        } else if (!this.overlapsAny(pos.x, ky, entityRadius)) {
          pos.y = ky;
        }
        const decay = Math.max(0, 1 - 8 * dt);
        kb.vx *= decay;
        kb.vy *= decay;
        if (Math.abs(kb.vx) < 1) kb.vx = 0;
        if (Math.abs(kb.vy) < 1) kb.vy = 0;
      }
    }

    // Entity-entity separation - prevents stacking/overlapping
    this.separateEntities(world);
  }

  /** Push overlapping entities apart so they can't stack. */
  private separateEntities(world: World): void {
    // Collect all solid entities
    const bodies: { id: number; pos: PositionComponent; r: number; movable: boolean; square: boolean }[] = [];
    for (const id of world.query(C.Position, C.Faction)) {
      if (world.hasComponent(id, C.Projectile)) continue; // projectiles aren't solid bodies
      const faction = world.getComponent<FactionComponent>(id, C.Faction)!;
      // Buildings are handled as solid blocks in overlapsAny - skip here
      if (faction.type === 'building') continue;
      // Ghosts phase through everything — skip separation
      const evSep = world.getComponent<EnemyVariantComponent>(id, C.EnemyVariant);
      if (evSep?.variant === 'ghost') continue;
      // Use per-variant radius for enemies/guards (e.g. giants have radius=20)
      const r = (faction.type === 'enemy' || faction.type === 'guard')
        ? (world.getComponent<EnemyStatsComponent>(id, C.EnemyStats)?.radius ?? ENEMY_RADIUS)
        : getEntityRadius(faction.type);
      if (r <= 0) continue;
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const movable = faction.type === 'player' || faction.type === 'enemy' || faction.type === 'guard';
      bodies.push({ id, pos, r, movable, square: isSquareEntity(faction.type) });
    }

    for (let iter = 0; iter < ENTITY_SEPARATION_ITERATIONS; iter++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          if (!a.movable && !b.movable) continue; // both static

          // Determine push vector based on collision shapes
          let pushX: number, pushY: number;

          if (a.square || b.square) {
            // Circle-vs-AABB: the square entity is the box, the other is the circle
            const circle = a.square ? b : a;
            const box    = a.square ? a : b;
            const push   = circleAABBPush(circle.pos.x, circle.pos.y, circle.r, box.pos.x, box.pos.y, box.r);
            if (!push) continue;
            // push points FROM box TO circle - apply to the circle entity
            if (circle === a) {
              pushX = push.px;  pushY = push.py;   // push A away
            } else {
              pushX = -push.px; pushY = -push.py;  // push B away (invert for A)
            }
          } else {
            // Circle-vs-circle (original logic)
            const dx = b.pos.x - a.pos.x;
            const dy = b.pos.y - a.pos.y;
            const distSq = dx * dx + dy * dy;
            const minDist = a.r + b.r;
            if (distSq >= minDist * minDist || distSq === 0) continue;
            const dist = Math.sqrt(distSq);
            const overlap = minDist - dist;
            pushX = (dx / dist) * overlap;
            pushY = (dy / dist) * overlap;
          }

          if (a.movable && b.movable) {
            this.pushIfValid(a.pos, -pushX * 0.5, -pushY * 0.5, a.r);
            this.pushIfValid(b.pos, pushX * 0.5, pushY * 0.5, b.r);
          } else if (a.movable) {
            this.pushIfValid(a.pos, -pushX, -pushY, a.r);
          } else {
            this.pushIfValid(b.pos, pushX, pushY, b.r);
          }
        }
      }
    }
  }

  /** Push an entity by (dx, dy) but only if the new position is on walkable tiles. */
  private pushIfValid(pos: PositionComponent, dx: number, dy: number, entityRadius: number = PLAYER_RADIUS): void {
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    if (!this.overlapsAny(nx, ny, entityRadius)) {
      pos.x = nx;
      pos.y = ny;
    } else if (!this.overlapsAny(nx, pos.y, entityRadius)) {
      pos.x = nx;
    } else if (!this.overlapsAny(pos.x, ny, entityRadius)) {
      pos.y = ny;
    }
    // If all blocked, don't push (entity stays overlapping rather than going into a wall)
  }

  /** Cache resource node positions for solid-block collision checks. */
  private cacheResources(world: World): void {
    this.resourceCache.length = 0;
    for (const id of world.query(C.Position, C.Faction)) {
      const f = world.getComponent<FactionComponent>(id, C.Faction)!;
      if (f.type === 'resource') {
        this.resourceCache.push(world.getComponent<PositionComponent>(id, C.Position)!);
      }
    }
  }

  /** Cache portal positions for solid-circle collision checks. */
  private cachePortals(world: World): void {
    this.portalCache.length = 0;
    for (const id of world.query(C.Position, C.Faction)) {
      const f = world.getComponent<FactionComponent>(id, C.Faction)!;
      if (f.type === 'portal') {
        this.portalCache.push(world.getComponent<PositionComponent>(id, C.Position)!);
      }
    }
  }

  /** Cache building positions for solid-block collision checks. */
  private cacheBuildings(world: World): void {
    this.buildingCache.length = 0;
    for (const id of world.query(C.Position, C.Faction)) {
      const f = world.getComponent<FactionComponent>(id, C.Faction)!;
      if (f.type === 'building') {
        const bldg = world.getComponent<BuildingComponent>(id, C.Building);
        const type = bldg?.buildingType ?? 'wall';
        // Bridges and spike traps are not solid collision obstacles
        if (type === 'bridge' || type === 'spike_trap') continue;
        const pos = world.getComponent<PositionComponent>(id, C.Position)!;
        this.buildingCache.push({ x: pos.x, y: pos.y, halfExtent: buildingHalfExtent(type) });
      }
    }
  }

  private overlapsAny(px: number, py: number, entityRadius: number = PLAYER_RADIUS): boolean {
    const r = entityRadius - 1;
    if (
      this.tileBlocksMovement(px - r, py - r) ||
      this.tileBlocksMovement(px + r, py - r) ||
      this.tileBlocksMovement(px - r, py + r) ||
      this.tileBlocksMovement(px + r, py + r)
    ) return true;

    // Resource nodes act as solid blocks (circle-vs-AABB)
    for (const node of this.resourceCache) {
      if (circleAABBPush(px, py, entityRadius, node.x, node.y, RESOURCE_NODE_RADIUS)) {
        return true;
      }
    }
    // Portals act as solid circles
    for (const portal of this.portalCache) {
      const dx = px - portal.x, dy = py - portal.y;
      const minDist = entityRadius + PORTAL_RADIUS;
      if (dx * dx + dy * dy < minDist * minDist) return true;
    }
    // Buildings act as solid blocks (circle-vs-AABB)
    for (const bldg of this.buildingCache) {
      if (circleAABBPush(px, py, entityRadius, bldg.x, bldg.y, bldg.halfExtent)) {
        return true;
      }
    }
    return false;
  }

  /** Blocks entity movement if a tile is not walkable (water, mountains, etc.).
   *  Projectiles use a separate solid-only check so they fly over water.
   *  Bridge tiles override unwalkable terrain. */
  private tileBlocksMovement(wx: number, wy: number): boolean {
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    // Bridge overrides unwalkable terrain
    if (this.bridgeTiles.has(`${tx},${ty}`)) return false;
    const tileId = this.generator.getTile(tx, ty);
    return !(TILE_DEFS[tileId]?.walkable ?? false);
  }
}
