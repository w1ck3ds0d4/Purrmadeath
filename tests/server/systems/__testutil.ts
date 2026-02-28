import { World } from '@shared/ecs/World';
import { C } from '@shared/components';
import type { WorldGenerator } from '@shared/world/WorldGenerator';

/** Create a fresh ECS World for testing. */
export function createTestWorld(): World {
  return new World();
}

/**
 * Create an entity with the given components in one call.
 * Keys should be component type strings from C (e.g. C.Position).
 */
export function spawnTestEntity(
  world: World,
  components: Record<string, unknown>,
): number {
  const id = world.createEntity();
  for (const [key, data] of Object.entries(components)) {
    world.addComponent(id, key, data as object);
  }
  return id;
}

/**
 * Create a minimal mock WorldGenerator that only satisfies `getTile(tx, ty)`.
 * Pass a function that returns a TileId (number) for any tile coordinate.
 * Default: returns 4 (Grass, walkable) for all tiles.
 */
export function mockGenerator(
  tileFn: (tx: number, ty: number) => number = () => 4,
): WorldGenerator {
  return { getTile: tileFn } as unknown as WorldGenerator;
}
