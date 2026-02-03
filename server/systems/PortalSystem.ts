import { World } from '@shared/ecs/World';
import { C, PositionComponent, PortalComponent, HealthComponent } from '@shared/components';

export interface PortalSpawnRequest {
  /** World-pixel position to spawn the enemy. */
  x: number;
  y: number;
}

/**
 * Ticks portal spawn timers and emits spawn requests.
 * Does NOT create enemy entities itself — GameSession handles that
 * so it can reuse spawnEnemy() and broadcast correctly.
 */
export class PortalSystem {
  update(world: World, dt: number): PortalSpawnRequest[] {
    const requests: PortalSpawnRequest[] = [];

    for (const id of world.query(C.Portal, C.Position, C.Health)) {
      const portal = world.getComponent<PortalComponent>(id, C.Portal)!;
      const hp     = world.getComponent<HealthComponent>(id, C.Health)!;

      // Dead portals don't spawn
      if (hp.current <= 0) continue;

      portal.spawnTimer -= dt;
      if (portal.spawnTimer <= 0) {
        portal.spawnTimer += portal.spawnInterval;

        const pos = world.getComponent<PositionComponent>(id, C.Position)!;
        // Spawn enemy in a ring around the portal (30-50px offset)
        const angle = Math.random() * Math.PI * 2;
        const dist  = 30 + Math.random() * 20;
        requests.push({
          x: pos.x + Math.cos(angle) * dist,
          y: pos.y + Math.sin(angle) * dist,
        });
      }
    }

    return requests;
  }
}
