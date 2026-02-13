import type { World } from './World';

/**
 * A System processes entities that have specific components each tick or frame.
 * Systems must be stateless - all mutable state lives in components.
 *
 * Example implementation:
 *   class MovementSystem implements System {
 *     readonly name = 'Movement';
 *     update(world: World, dt: number): void {
 *       for (const id of world.query('Position', 'Velocity')) {
 *         const pos = world.getComponent<PositionComponent>(id, 'Position')!;
 *         const vel = world.getComponent<VelocityComponent>(id, 'Velocity')!;
 *         pos.x += vel.vx * dt;
 *         pos.y += vel.vy * dt;
 *       }
 *     }
 *   }
 */
export interface System {
  /** Unique name - used for registration, ordering, and removal by name. */
  readonly name: string;

  /**
   * Called every server tick (fixed 20 TPS) or every render frame (rAF on client).
   * @param world  The ECS world to query and mutate.
   * @param dt     Elapsed time in seconds since the last update.
   */
  update(world: World, dt: number): void;
}