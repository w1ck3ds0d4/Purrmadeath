import type { System } from './System';
import type { World } from './World';

/**
 * SystemRunner owns an ordered list of Systems and drives them each tick/frame.
 * The server and client each have their own runner with different system sets.
 *
 * Usage (server):
 *   const runner = new SystemRunner()
 *     .add(new AiSystem())
 *     .add(new MovementSystem())
 *     .add(new CombatSystem());
 *
 *   // in game loop:
 *   runner.update(world, dt);
 */
export class SystemRunner {
  private systems: System[] = [];

  /** Append a system to the end of the update order. Chainable. */
  add(system: System): this {
    this.systems.push(system);
    return this;
  }

  /** Remove a system by name. Chainable. No-op if not found. */
  remove(name: string): this {
    this.systems = this.systems.filter((s) => s.name !== name);
    return this;
  }

  /** Run all systems in registration order. dt is in seconds. */
  update(world: World, dt: number): void {
    for (const system of this.systems) {
      system.update(world, dt);
    }
  }

  get count(): number {
    return this.systems.length;
  }
}