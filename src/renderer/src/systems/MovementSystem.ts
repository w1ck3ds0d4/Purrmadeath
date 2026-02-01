import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  VelocityComponent,
  SpeedComponent,
  PlayerInputComponent,
} from '@shared/components';
import { TILE_SIZE, PLAYER_RADIUS } from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import { ChunkManager } from '../world/ChunkManager';

// How quickly velocity ramps toward the target (higher = snappier feel)
const ACCEL   = 20;
// How quickly velocity drops to zero when no input (higher = shorter slide)
const FRICTION = 16;

/**
 * Applies WASD input to velocity, then moves entities with tile collision.
 *
 * Wall-slide: if the full diagonal move is blocked, try each axis independently
 * so the player glides along walls instead of getting stuck at corners.
 */
export class MovementSystem {
  constructor(private readonly chunks: ChunkManager) {}

  update(world: World, dt: number): void {
    for (const id of world.query(C.Position, C.Velocity, C.Speed, C.PlayerInput)) {
      const pos   = world.getComponent<PositionComponent>(id, C.Position)!;
      const vel   = world.getComponent<VelocityComponent>(id, C.Velocity)!;
      const speed = world.getComponent<SpeedComponent>(id, C.Speed)!;
      const inp   = world.getComponent<PlayerInputComponent>(id, C.PlayerInput)!;

      const maxSpeed = speed.base * speed.multiplier;

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
  }

  /**
   * Returns true if the player circle centered at (px, py) overlaps any solid tile.
   * Checks the four corners of the AABB with a 1px inset to avoid edge-hugging.
   */
  private overlapsAny(px: number, py: number): boolean {
    const r = PLAYER_RADIUS - 1;
    return (
      this.tileIsSolid(px - r, py - r) ||
      this.tileIsSolid(px + r, py - r) ||
      this.tileIsSolid(px - r, py + r) ||
      this.tileIsSolid(px + r, py + r)
    );
  }

  private tileIsSolid(wx: number, wy: number): boolean {
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    const tileId = this.chunks.getTile(tx, ty);
    return TILE_DEFS[tileId]?.solid ?? true;
  }
}
