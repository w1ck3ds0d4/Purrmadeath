import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  VelocityComponent,
  HealthComponent,
  ResourceNodeComponent,
  ItemDropComponent,
  BuildingComponent,
  ProductionComponent,
  EnemyVariantComponent,
  GhostStateComponent,
  EnemyStatsComponent,
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
 * The local player entity is skipped here - Reconciler handles it.
 */

/** Speed of the lerp toward the extrapolated target. Higher = snappier, lower = smoother. */
const INTERP_SPEED = 25;

/** Hard-snap if entity is farther than this from its target (teleport / first spawn). */
const SNAP_DIST = 200;

/** Max seconds of velocity extrapolation - caps prediction to avoid overshooting on lag spikes. */
const MAX_EXTRAP = 0.15;

export class RemotePlayerSystem {
  /** Server-reported target positions + velocities keyed by entity ID. */
  private targets = new Map<number, { x: number; y: number; vx: number; vy: number; age: number }>();

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

      // Advance age (time since last server update) for extrapolation
      target.age += dt;

      // Extrapolated position: predict where entity IS right now using velocity
      const extrapTime = Math.min(target.age, MAX_EXTRAP);
      const extX = target.x + target.vx * extrapTime;
      const extY = target.y + target.vy * extrapTime;

      const dx = extX - pos.x;
      const dy = extY - pos.y;
      const dist = dx * dx + dy * dy;

      if (dist < 0.25) {
        pos.x = extX;
        pos.y = extY;
      } else if (dist > SNAP_DIST * SNAP_DIST) {
        pos.x = extX;
        pos.y = extY;
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
    // Store target position + velocity for extrapolation
    this.targets.set(snap.entityId, { x: snap.x, y: snap.y, vx: snap.vx, vy: snap.vy, age: 0 });

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
        world.addComponent(snap.entityId, C.Faction, { type: snap.faction, enemyFaction: snap.enemyFaction });
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
      // Building metadata (for renderer type/color selection)
      if (snap.buildingType) {
        world.addComponent(snap.entityId, C.Building, {
          buildingType: snap.buildingType,
          permanent: snap.buildingType === 'campfire',
          upgradeLevel: snap.upgradeLevel ?? 1,
        } as BuildingComponent);
      }
      // Enemy variant (for renderer color differentiation)
      if (snap.enemyVariant) {
        world.addComponent(snap.entityId, C.EnemyVariant, { variant: snap.enemyVariant } as EnemyVariantComponent);
      }
      // Player class (for renderer differentiation)
      if (snap.playerClass) {
        world.addComponent(snap.entityId, C.Class, { classType: snap.playerClass });
      }
      // Ghost visibility state
      if (snap.ghostHidden !== undefined) {
        world.addComponent(snap.entityId, C.GhostState, { hidden: snap.ghostHidden } as GhostStateComponent);
      }
      // Non-default enemy radius (for rendering)
      if (snap.enemyRadius !== undefined) {
        world.addComponent(snap.entityId, C.EnemyStats, {
          damage: 0, range: 0, knockback: 0, radius: snap.enemyRadius,
          rangedRange: 0, projectileSpeed: 0, rangedDamage: 0, rangedCooldown: 0,
        } as EnemyStatsComponent);
      }
      // Production building stored resources (for renderer tag display)
      if (snap.productionStored !== undefined && snap.productionResource) {
        world.addComponent(snap.entityId, C.Production, {
          resourceType: snap.productionResource,
          interval: 0, timer: 0, amount: 0,
          stored: snap.productionStored,
          maxStored: snap.productionMax ?? 0,
        } as ProductionComponent);
      }
    } else {
      // Update velocity + health immediately; position is interpolated in interpolate()
      const vel = world.getComponent<VelocityComponent>(snap.entityId, C.Velocity);
      const hp  = world.getComponent<HealthComponent>(snap.entityId, C.Health);
      if (vel) { vel.vx = snap.vx; vel.vy = snap.vy; }
      if (hp)  { hp.current = snap.hp; hp.max = snap.maxHp; }

      // Update ghost visibility
      if (snap.ghostHidden !== undefined) {
        const ghost = world.getComponent<GhostStateComponent>(snap.entityId, C.GhostState);
        if (ghost) ghost.hidden = snap.ghostHidden;
        else world.addComponent(snap.entityId, C.GhostState, { hidden: snap.ghostHidden } as GhostStateComponent);
      }

      // Update building upgrade level
      if (snap.upgradeLevel !== undefined) {
        const bldg = world.getComponent<BuildingComponent>(snap.entityId, C.Building);
        if (bldg) bldg.upgradeLevel = snap.upgradeLevel;
      }

      // Update production stored amount
      if (snap.productionStored !== undefined) {
        let prod = world.getComponent<ProductionComponent>(snap.entityId, C.Production);
        if (!prod && snap.productionResource) {
          // Component wasn't created yet (entity existed before production was added)
          world.addComponent(snap.entityId, C.Production, {
            resourceType: snap.productionResource,
            interval: 0, timer: 0, amount: 0,
            stored: snap.productionStored,
            maxStored: snap.productionMax ?? 0,
          } as ProductionComponent);
        } else if (prod) {
          prod.stored = snap.productionStored;
          if (snap.productionMax !== undefined) prod.maxStored = snap.productionMax;
        }
      }

      // On full snapshot (rejoin), hard-snap position
      if (hardSnap) {
        const pos = world.getComponent<PositionComponent>(snap.entityId, C.Position);
        if (pos) { pos.x = snap.x; pos.y = snap.y; }
      }
    }
  }
}
