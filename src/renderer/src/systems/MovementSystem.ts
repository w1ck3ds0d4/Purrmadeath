import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  VelocityComponent,
  SpeedComponent,
  PlayerInputComponent,
  FactionComponent,
  BuildingComponent,
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
import { ChunkManager } from '../world/ChunkManager';

// How quickly velocity ramps toward the target (higher = snappier feel)
const ACCEL   = 20;
// How quickly velocity drops to zero when no input (higher = shorter slide)
const FRICTION = 16;

function getEntityRadius(factionType: string): number {
  switch (factionType) {
    case 'player':   return PLAYER_RADIUS;
    case 'enemy':    return ENEMY_RADIUS;
    case 'portal':   return PORTAL_RADIUS;
    case 'resource': return RESOURCE_NODE_RADIUS;
    default:         return 0;
  }
}

function isSquareEntity(factionType: string): boolean {
  return factionType === 'resource';
}

/** Circle-vs-AABB push: returns vector to push circle OUT of box, or null. */
function circleAABBPush(
  cx: number, cy: number, cr: number,
  bx: number, by: number, bHalf: number,
): { px: number; py: number } | null {
  const closestX = Math.max(bx - bHalf, Math.min(cx, bx + bHalf));
  const closestY = Math.max(by - bHalf, Math.min(cy, by + bHalf));
  const dx = cx - closestX;
  const dy = cy - closestY;
  const distSq = dx * dx + dy * dy;
  if (distSq >= cr * cr) return null;
  if (distSq < 0.0001) {
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
 * Applies WASD input to velocity, then moves entities with tile collision.
 *
 * Wall-slide: if the full diagonal move is blocked, try each axis independently
 * so the player glides along walls instead of getting stuck at corners.
 *
 * When localEntityId is provided (main prediction frame only), runs entity
 * separation for the local player to match the server-side separation pass.
 * NOT called during reconciler replay to avoid stale-position divergence.
 */
export class MovementSystem {
  /** Cached resource node positions - refreshed each update for solid-block collision. */
  private resourceCache: PositionComponent[] = [];
  /** Cached building positions - refreshed each update for solid-block collision. */
  private buildingCache: { x: number; y: number; halfExtent: number }[] = [];
  /** Bridge tile keys ("tileX,tileY") that override unwalkable terrain. Populated by game.ts. */
  bridgeTiles = new Set<string>();

  constructor(private readonly chunks: ChunkManager) {}

  update(world: World, dt: number, localEntityId?: number | null): void {
    // Cache solid entities so overlapsAny can treat them as solid blocks
    this.cacheResources(world);
    this.cacheBuildings(world);

    for (const id of world.query(C.Position, C.Velocity, C.Speed, C.PlayerInput)) {
      const pos   = world.getComponent<PositionComponent>(id, C.Position)!;
      const vel   = world.getComponent<VelocityComponent>(id, C.Velocity)!;
      const speed = world.getComponent<SpeedComponent>(id, C.Speed)!;
      const inp   = world.getComponent<PlayerInputComponent>(id, C.PlayerInput)!;

      const maxSpeed = speed.base * speed.multiplier * (inp.sprint ? PLAYER_SPRINT_MULTIPLIER : 1);

      // Normalize diagonal so 45° doesn't move faster than cardinal
      let dx = inp.dx;
      let dy = inp.dy;
      if (dx !== 0 && dy !== 0) {
        const inv = 1 / Math.SQRT2;
        dx *= inv;
        dy *= inv;
      }

      // Smooth acceleration toward target velocity; friction when coasting
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

      // Wall-slide collision: try full move → X-only → Y-only
      const nx = pos.x + vel.vx * dt;
      const ny = pos.y + vel.vy * dt;

      if (!this.overlapsAny(nx, ny)) {
        pos.x = nx;
        pos.y = ny;
      } else if (!this.overlapsAny(nx, pos.y)) {
        pos.x = nx;
        vel.vy = 0;
      } else if (!this.overlapsAny(pos.x, ny)) {
        pos.y = ny;
        vel.vx = 0;
      } else {
        vel.vx = 0;
        vel.vy = 0;
      }
    }

    // Entity separation for local player - matches server-side pass
    if (localEntityId != null) {
      this.separateLocalPlayer(world, localEntityId);
    }
  }

  /**
   * Push the local player away from overlapping entities.
   * Only the local player is moved - other entities are positioned by the server.
   */
  private separateLocalPlayer(world: World, localId: number): void {
    const pos = world.getComponent<PositionComponent>(localId, C.Position);
    if (!pos) return;

    for (let iter = 0; iter < ENTITY_SEPARATION_ITERATIONS; iter++) {
      for (const otherId of world.query(C.Position, C.Faction)) {
        if (otherId === localId) continue;
        if (world.hasComponent(otherId, C.Projectile)) continue; // projectiles aren't solid bodies
        const faction = world.getComponent<FactionComponent>(otherId, C.Faction)!;
        // Resource nodes and buildings are handled as solid blocks in overlapsAny - skip here
        if (faction.type === 'resource' || faction.type === 'building') continue;
        // Use per-variant radius for enemies (e.g. giants have radius=20)
        const otherR = (faction.type === 'enemy')
          ? (world.getComponent<EnemyStatsComponent>(otherId, C.EnemyStats)?.radius ?? ENEMY_RADIUS)
          : getEntityRadius(faction.type);
        if (otherR <= 0) continue;

        const otherPos = world.getComponent<PositionComponent>(otherId, C.Position)!;

        let pushX: number, pushY: number;

        if (isSquareEntity(faction.type)) {
          const push = circleAABBPush(pos.x, pos.y, PLAYER_RADIUS, otherPos.x, otherPos.y, otherR);
          if (!push) continue;
          pushX = push.px;
          pushY = push.py;
        } else {
          // Circle vs circle
          const dx = pos.x - otherPos.x;
          const dy = pos.y - otherPos.y;
          const distSq = dx * dx + dy * dy;
          const minDist = PLAYER_RADIUS + otherR;
          if (distSq >= minDist * minDist || distSq === 0) continue;
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          pushX = (dx / dist) * overlap;
          pushY = (dy / dist) * overlap;
        }

        // If the other entity is also movable (player/enemy), the server splits
        // the push evenly - we only move our half. Static entities push us fully.
        const otherMovable = faction.type === 'player' || faction.type === 'enemy';
        const scale = otherMovable ? 0.5 : 1;

        this.pushIfValid(pos, pushX * scale, pushY * scale);
      }
    }
  }

  /** Push an entity by (dx, dy) but only if the new position is on walkable tiles. */
  private pushIfValid(pos: PositionComponent, dx: number, dy: number): void {
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    if (!this.overlapsAny(nx, ny)) {
      pos.x = nx;
      pos.y = ny;
    } else if (!this.overlapsAny(nx, pos.y)) {
      pos.x = nx;
    } else if (!this.overlapsAny(pos.x, ny)) {
      pos.y = ny;
    }
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

  /**
   * Returns true if the player circle centered at (px, py) overlaps any
   * impassable tile OR any resource node AABB (treated as solid blocks).
   */
  private overlapsAny(px: number, py: number): boolean {
    const r = PLAYER_RADIUS - 1;
    if (
      this.tileBlocksMovement(px - r, py - r) ||
      this.tileBlocksMovement(px + r, py - r) ||
      this.tileBlocksMovement(px - r, py + r) ||
      this.tileBlocksMovement(px + r, py + r)
    ) return true;

    // Resource nodes act as solid blocks (circle-vs-AABB)
    for (const node of this.resourceCache) {
      if (circleAABBPush(px, py, PLAYER_RADIUS, node.x, node.y, RESOURCE_NODE_RADIUS)) {
        return true;
      }
    }
    // Buildings act as solid blocks (circle-vs-AABB)
    for (const bldg of this.buildingCache) {
      if (circleAABBPush(px, py, PLAYER_RADIUS, bldg.x, bldg.y, bldg.halfExtent)) {
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
    const tileId = this.chunks.getTile(tx, ty);
    return !(TILE_DEFS[tileId]?.walkable ?? false);
  }
}
