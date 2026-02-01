import { Container, Graphics } from 'pixi.js';
import { World, EntityId } from '@shared/ecs/World';
import { C, PositionComponent, VelocityComponent, PlayerIndexComponent } from '@shared/components';
import { PLAYER_RADIUS, PLAYER_COLORS } from '@shared/constants';

// How far the directional arrow extends past the player radius
const ARROW_LEN = PLAYER_RADIUS + 7;
// Half-width of the arrow triangle base
const ARROW_W   = 4;
// Minimum speed (px/s) before the arrow is drawn
const ARROW_MIN_SPEED = 8;

/**
 * Draws each player entity as a colored filled circle with a directional
 * arrow that points in the direction of movement.
 *
 * Graphics are placed inside the world container so they move with the camera.
 * Phase 9: replace with sprite atlas.
 */
export class PlayerRendererSystem {
  private sprites = new Map<EntityId, Graphics>();

  constructor(private readonly worldContainer: Container) {}

  update(world: World): void {
    const living = new Set(world.query(C.Position, C.PlayerIndex));

    // Remove sprites for entities that no longer exist
    for (const [id, gfx] of this.sprites) {
      if (!living.has(id)) {
        this.worldContainer.removeChild(gfx);
        gfx.destroy();
        this.sprites.delete(id);
      }
    }

    for (const id of living) {
      const pos  = world.getComponent<PositionComponent>(id, C.Position)!;
      const vel  = world.getComponent<VelocityComponent>(id, C.Velocity);
      const pIdx = world.getComponent<PlayerIndexComponent>(id, C.PlayerIndex)!;

      // Create the Graphics object on first encounter
      if (!this.sprites.has(id)) {
        const gfx = new Graphics();
        this.worldContainer.addChild(gfx);
        this.sprites.set(id, gfx);
      }

      const gfx   = this.sprites.get(id)!;
      const color = PLAYER_COLORS[pIdx.index] ?? PLAYER_COLORS[0];
      const r     = PLAYER_RADIUS;

      // Velocity direction (only draw arrow above threshold)
      const speed = vel ? Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy) : 0;
      const angle = speed >= ARROW_MIN_SPEED && vel
        ? Math.atan2(vel.vy, vel.vx)
        : null;

      gfx.clear();

      // Body — filled colored circle
      gfx.circle(0, 0, r);
      gfx.fill({ color, alpha: 1 });

      // Dark outline for contrast against the world
      gfx.circle(0, 0, r);
      gfx.stroke({ color: 0x000000, alpha: 0.45, width: 2 });

      // Direction arrow — white triangle pointing in movement direction
      if (angle !== null) {
        const ax =  Math.cos(angle) * ARROW_LEN;
        const ay =  Math.sin(angle) * ARROW_LEN;
        const px = -Math.sin(angle) * ARROW_W;
        const py =  Math.cos(angle) * ARROW_W;

        gfx.poly([ax, ay, -px, -py, px, py]);
        gfx.fill({ color: 0xffffff, alpha: 0.85 });
      }

      // Move the sprite to the entity's world position
      gfx.position.set(pos.x, pos.y);
    }
  }

  /** Destroy all player graphics (call on quit to menu or world reset). */
  destroy(): void {
    for (const gfx of this.sprites.values()) {
      this.worldContainer.removeChild(gfx);
      gfx.destroy();
    }
    this.sprites.clear();
  }
}
