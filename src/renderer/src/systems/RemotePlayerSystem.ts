import { World } from '@shared/ecs/World';
import { C, PositionComponent, VelocityComponent, HealthComponent } from '@shared/components';
import type { SnapshotMessage, DeltaMessage, EntitySnapshot } from '@shared/protocol';

/**
 * Manages remote player entities on the client.
 *
 * On SNAPSHOT: creates or updates all non-local entities.
 * On DELTA:    applies position updates for non-local entities and destroys removed ones.
 *
 * The local player entity is skipped here — Reconciler handles it.
 */
export class RemotePlayerSystem {
  constructor(private readonly localEntityId: () => number | null) {}

  // ── Snapshot (full world sync on game start / rejoin) ──────────────────────

  applySnapshot(world: World, msg: SnapshotMessage): void {
    for (const snap of msg.entities) {
      if (snap.entityId === this.localEntityId()) continue;
      this.upsertEntity(world, snap);
    }
  }

  // ── Delta (per-tick incremental update) ────────────────────────────────────

  applyDelta(world: World, msg: DeltaMessage): void {
    for (const id of msg.removed) {
      if (world.hasEntity(id)) world.destroyEntity(id);
    }
    for (const snap of msg.entities) {
      if (snap.entityId === this.localEntityId()) continue;
      this.upsertEntity(world, snap);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private upsertEntity(world: World, snap: EntitySnapshot): void {
    if (!world.hasEntity(snap.entityId)) {
      world.createEntityWithId(snap.entityId);
      world.addComponent(snap.entityId, C.Position,    { x: snap.x, y: snap.y });
      world.addComponent(snap.entityId, C.Velocity,    { vx: snap.vx, vy: snap.vy });
      world.addComponent(snap.entityId, C.Health,      { current: snap.hp, max: snap.maxHp });
      if (snap.slot !== undefined) {
        world.addComponent(snap.entityId, C.PlayerIndex, { index: snap.slot });
      }
    } else {
      const pos = world.getComponent<PositionComponent>(snap.entityId, C.Position);
      const vel = world.getComponent<VelocityComponent>(snap.entityId, C.Velocity);
      const hp  = world.getComponent<HealthComponent>(snap.entityId, C.Health);
      if (pos) { pos.x = snap.x; pos.y = snap.y; }
      if (vel) { vel.vx = snap.vx; vel.vy = snap.vy; }
      if (hp)  { hp.current = snap.hp; hp.max = snap.maxHp; }
    }
  }
}
