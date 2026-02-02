import { World } from '@shared/ecs/World';
import { C, PositionComponent, FactionComponent, PlayerInputComponent } from '@shared/components';
import { ENEMY_AGGRO_RANGE } from '@shared/constants';

/**
 * Simple enemy chase AI — runs on the server each tick.
 *
 * For each enemy entity:
 *   - If a player is within ENEMY_AGGRO_RANGE, set dx/dy toward them.
 *   - Otherwise stand still.
 *
 * Movement is executed by MovementSystem (which runs after this), so enemies
 * share the same physics and tile-collision as players.
 *
 * Phase 4.6: upgrade to A* pathfinding.
 * Phase 4.7: replace initial spawn with portal-driven spawning.
 */
export class EnemySystem {
  update(world: World, _dt: number): void {
    const playerIds = world.query(C.Position, C.PlayerIndex);

    for (const id of world.query(C.Position, C.Faction, C.PlayerInput)) {
      const faction = world.getComponent<FactionComponent>(id, C.Faction)!;
      if (faction.type !== 'enemy') continue;

      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const inp = world.getComponent<PlayerInputComponent>(id, C.PlayerInput)!;

      // Find the nearest player within aggro range
      let nearestDist = ENEMY_AGGRO_RANGE;
      let nearestPos: PositionComponent | null = null;

      for (const pid of playerIds) {
        const ppos = world.getComponent<PositionComponent>(pid, C.Position)!;
        const ddx = ppos.x - pos.x;
        const ddy = ppos.y - pos.y;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPos = ppos;
        }
      }

      if (nearestPos) {
        const ddx = nearestPos.x - pos.x;
        const ddy = nearestPos.y - pos.y;
        const len = Math.sqrt(ddx * ddx + ddy * ddy);
        inp.dx = len > 0 ? ddx / len : 0;
        inp.dy = len > 0 ? ddy / len : 0;
      } else {
        inp.dx = 0;
        inp.dy = 0;
      }
      inp.sprint = false;
    }
  }
}