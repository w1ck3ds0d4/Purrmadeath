import { World } from '@shared/ecs/World';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import { C } from '@shared/components';
import {
  TILE_SIZE,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_STAMINA,
  PLAYER_STAMINA_REGEN,
  PLAYER_BASE_SPEED,
} from '@shared/constants';

/**
 * Creates a player entity in the ECS world at a walkable spawn point near the origin.
 *
 * @param world       The ECS world to add the entity to.
 * @param generator   Used to look up tile walkability when finding the spawn point.
 * @param playerIndex Slot 0–3 — determines player color and HUD position.
 * @returns The new entity ID.
 */
export function spawnPlayer(
  world: World,
  generator: WorldGenerator,
  playerIndex: number,
): number {
  const { x, y } = findSpawnPoint(generator);
  const id = world.createEntity();

  world.addComponent(id, C.Position,    { x, y });
  world.addComponent(id, C.Velocity,    { vx: 0, vy: 0 });
  world.addComponent(id, C.Health,      { current: PLAYER_MAX_HEALTH,  max: PLAYER_MAX_HEALTH });
  world.addComponent(id, C.Stamina,     { current: PLAYER_MAX_STAMINA, max: PLAYER_MAX_STAMINA, regenRate: PLAYER_STAMINA_REGEN });
  world.addComponent(id, C.Defense,     { flat: 0, percent: 0 });
  world.addComponent(id, C.Speed,       { base: PLAYER_BASE_SPEED, multiplier: 1 });
  world.addComponent(id, C.PlayerIndex, { index: playerIndex });
  world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0 });

  return id;
}

/**
 * Spiral outward from tile (0, 0) until a walkable, non-solid tile is found.
 * Returns the world-pixel center of that tile.
 *
 * The spiral visits every tile exactly once in order of Chebyshev distance,
 * so the spawn point is always as close to the origin as the world allows.
 */
function findSpawnPoint(generator: WorldGenerator): { x: number; y: number } {
  for (let radius = 0; radius < 500; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        // Skip interior tiles already checked at a smaller radius
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

        const tileId = generator.getTile(dx, dy);
        if (TILE_DEFS[tileId]?.walkable) {
          return {
            x: dx * TILE_SIZE + TILE_SIZE / 2,
            y: dy * TILE_SIZE + TILE_SIZE / 2,
          };
        }
      }
    }
  }

  // Fallback — should never happen in a valid world
  console.warn('[PlayerSpawner] No walkable spawn found within radius 500, using origin');
  return { x: 0, y: 0 };
}
