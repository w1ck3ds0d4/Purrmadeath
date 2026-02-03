import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  VelocityComponent,
  HealthComponent,
  ResourceNodeComponent,
  ItemDropComponent,
} from '@shared/components';
import type { SnapshotMessage, DeltaMessage, EntitySnapshot } from '@shared/protocol';

/**
 * Manages remote player entities on the client.
 *
 * On SNAPSHOT: creates or updates all non-local entities.
 * On DELTA:    applies position updates for non-local entities and destroys removed ones.
 *
 * Remote entity positions are **interpolated** toward the server-reported target
 * so movement looks smooth at 60 fps even though the server sends updates at 20 TPS.
 *
 * The local player entity is skipped here — Reconciler handles it.
 */

/** Speed of the lerp toward the server target. Higher = snappier, lower = smoother. */
const INTERP_SPEED = 18;

/** Hard-snap if entity is farther than this from its target (teleport / first spawn). */
const SNAP_DIST = 200;

export class RemotePlayerSystem {
  /** Server-reported target positions keyed by entity ID. */
  private targets = new Map<number, { x: number; y: number }>();

  constructor(private readonly localEntityId: () => number | null) {}

  // ── Snapshot (full world sync on game start / rejoin) ──────────────────────

  applySnapshot(world: World, msg: SnapshotMessage): void {
    this.targets.clear();
    for (const snap of msg.entities) {
      if (snap.entityId === this.localEntityId()) continue;
      this.upsertEntity(world, snap, true);
    }
  }

  // ── Delta (per-tick incremental update) ────────────────────────────────────

  applyDelta(world: World, msg: DeltaMessage): void {
    for (const id of msg.removed) {
      this.targets.delete(id);
      if (world.hasEntity(id)) world.destroyEntity(id);
    }
    for (const snap of msg.entities) {
      if (snap.entityId === this.localEntityId()) continue;
      this.upsertEntity(world, snap, false);
    }
  }

  // ── Interpolation (called every render frame from the game loop) ──────────

  /**
   * Lerp all remote entity positions toward their server targets.
   * Call this once per render frame, AFTER applyDelta, so entities move smoothly.
   */
  interpolate(world: World, dt: number): void {
    const localId = this.localEntityId();
    const t = Math.min(INTERP_SPEED * dt, 1);

    for (const [id, target] of this.targets) {
      if (id === localId) continue; // local player uses prediction, not interpolation
      const pos = world.getComponent<PositionComponent>(id, C.Position);
      if (!pos) continue;

      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dist = dx * dx + dy * dy;

      if (dist < 0.25) {
        // Close enough — snap to avoid perpetual creep
        pos.x = target.x;
        pos.y = target.y;
      } else if (dist > SNAP_DIST * SNAP_DIST) {
        // Too far — hard snap (teleport)
        pos.x = target.x;
        pos.y = target.y;
      } else {
        pos.x += dx * t;
        pos.y += dy * t;
      }
    }
  }

  /** Clear all interpolation state (call on quit to menu or world reset). */
  destroy(): void {
    this.targets.clear();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private upsertEntity(world: World, snap: EntitySnapshot, hardSnap: boolean): void {
    // Store the target position for interpolation
    this.targets.set(snap.entityId, { x: snap.x, y: snap.y });

    if (!world.hasEntity(snap.entityId)) {
      world.createEntityWithId(snap.entityId);
      // First time: set position directly (no lerp from origin)
      world.addComponent(snap.entityId, C.Position,    { x: snap.x, y: snap.y });
      world.addComponent(snap.entityId, C.Velocity,    { vx: snap.vx, vy: snap.vy });
      world.addComponent(snap.entityId, C.Health,      { current: snap.hp, max: snap.maxHp });
      if (snap.slot !== undefined) {
        world.addComponent(snap.entityId, C.PlayerIndex, { index: snap.slot });
      }
      if (snap.faction) {
        world.addComponent(snap.entityId, C.Faction, { type: snap.faction });
      }
      // Resource node metadata (for renderer color selection)
      if (snap.resourceType) {
        world.addComponent(snap.entityId, C.ResourceNode, {
          resourceType: snap.resourceType,
          yield: 0, // yield is server-only; client only needs resourceType for rendering
        } as ResourceNodeComponent);
      }
      // Item drop metadata (for renderer color selection)
      if (snap.itemType) {
        world.addComponent(snap.entityId, C.ItemDrop, {
          itemType: snap.itemType,
          quantity: snap.itemQuantity ?? 1,
          autoPickup: true,
          lifetime: 60,
        } as ItemDropComponent);
      }
    } else {
      // Update velocity + health immediately; position is interpolated in interpolate()
      const vel = world.getComponent<VelocityComponent>(snap.entityId, C.Velocity);
      const hp  = world.getComponent<HealthComponent>(snap.entityId, C.Health);
      if (vel) { vel.vx = snap.vx; vel.vy = snap.vy; }
      if (hp)  { hp.current = snap.hp; hp.max = snap.maxHp; }

      // On full snapshot (rejoin), hard-snap position
      if (hardSnap) {
        const pos = world.getComponent<PositionComponent>(snap.entityId, C.Position);
        if (pos) { pos.x = snap.x; pos.y = snap.y; }
      }
    }
  }
}
