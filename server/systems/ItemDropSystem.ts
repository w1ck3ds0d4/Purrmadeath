import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  VelocityComponent,
  ItemDropComponent,
} from '@shared/components';
import { ITEM_DROP_PICKUP_RADIUS, ITEM_DROP_FRICTION } from '@shared/constants';

export interface PickupResult {
  /** Entity ID of the item drop that was collected. */
  dropId: number;
  /** Entity ID of the player who picked it up. */
  playerId: number;
  itemType: string;
  quantity: number;
}

/**
 * Server-authoritative item drop system.
 *
 * Per tick:
 *   1. Countdown lifetime - mark expired drops for removal.
 *   2. Apply scatter velocity with friction decay.
 *   3. Auto-pickup: check overlap with player entities.
 */
export class ItemDropSystem {
  update(
    world: World,
    dt: number,
    playerEntityIds: ReadonlySet<number>,
  ): { pickups: PickupResult[]; expired: number[] } {
    const pickups: PickupResult[] = [];
    const expired: number[] = [];

    // Cache player positions once (O(P) not O(D*P))
    const playerPositions: { id: number; x: number; y: number }[] = [];
    for (const pid of playerEntityIds) {
      const pos = world.getComponent<PositionComponent>(pid, C.Position);
      if (pos) playerPositions.push({ id: pid, x: pos.x, y: pos.y });
    }

    const pickupR2 = ITEM_DROP_PICKUP_RADIUS * ITEM_DROP_PICKUP_RADIUS;

    for (const id of world.query(C.ItemDrop, C.Position)) {
      const drop = world.getComponent<ItemDropComponent>(id, C.ItemDrop)!;
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const vel = world.getComponent<VelocityComponent>(id, C.Velocity);

      // 1. Lifetime countdown
      drop.lifetime -= dt;
      if (drop.lifetime <= 0) {
        expired.push(id);
        continue;
      }

      // 2. Scatter velocity decay (simple friction)
      if (vel) {
        const speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
        if (speed > 1) {
          pos.x += vel.vx * dt;
          pos.y += vel.vy * dt;
          const decay = Math.max(0, 1 - ITEM_DROP_FRICTION * dt);
          vel.vx *= decay;
          vel.vy *= decay;
        } else {
          vel.vx = 0;
          vel.vy = 0;
        }
      }

      // 3. Auto-pickup check
      if (drop.autoPickup) {
        for (const pp of playerPositions) {
          const dx = pos.x - pp.x;
          const dy = pos.y - pp.y;
          if (dx * dx + dy * dy <= pickupR2) {
            pickups.push({
              dropId: id,
              playerId: pp.id,
              itemType: drop.itemType,
              quantity: drop.quantity,
            });
            break; // Only one player picks up each drop
          }
        }
      }
    }

    return { pickups, expired };
  }
}
