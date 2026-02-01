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
import { WorldGenerator } from '@shared/world/WorldGenerator';

const ACCEL   = 20;
const FRICTION = 16;

/**
 * Authoritative server-side movement system.
 *
 * Mirrors the client MovementSystem exactly so that client prediction stays
 * in sync with the server simulation. Uses WorldGenerator.getTile() directly
 * (no ChunkManager cache needed — server generates tiles on demand).
 */
export class MovementSystem {
  constructor(private readonly generator: WorldGenerator) {}

  update(world: World, dt: number): void {
    for (const id of world.query(C.Position, C.Velocity, C.Speed, C.PlayerInput)) {
      const pos   = world.getComponent<PositionComponent>(id, C.Position)!;
      const vel   = world.getComponent<VelocityComponent>(id, C.Velocity)!;
      const speed = world.getComponent<SpeedComponent>(id, C.Speed)!;
      const inp   = world.getComponent<PlayerInputComponent>(id, C.PlayerInput)!;

      const maxSpeed = speed.base * speed.multiplier;

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

      // Wall-slide collision
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
    const tileId = this.generator.getTile(tx, ty);
    return TILE_DEFS[tileId]?.solid ?? true;
  }
}
