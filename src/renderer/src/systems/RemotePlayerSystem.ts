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
  DodgeRollComponent,
  DownedComponent,
  CivilianComponent,
  BossComponent,
  RuinsComponent,
  LaserBeamComponent,
  GuardComponent,
} from '@shared/components';
import type { SnapshotMessage, DeltaMessage, EntitySnapshot } from '@shared/protocol';
import {
  REMOTE_PLAYER_INTERP_SPEED,
  REMOTE_PLAYER_SNAP_DIST,
  REMOTE_PLAYER_MAX_EXTRAP,
} from '@shared/constants';

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
    const t = Math.min(REMOTE_PLAYER_INTERP_SPEED * dt, 1);

    for (const [id, target] of this.targets) {
      if (id === localId) continue; // local player uses prediction, not interpolation
      const pos = world.getComponent<PositionComponent>(id, C.Position);
      if (!pos) continue;

      // Advance age (time since last server update) for extrapolation
      target.age += dt;

      // Extrapolated position: predict where entity IS right now using velocity
      const extrapTime = Math.min(target.age, REMOTE_PLAYER_MAX_EXTRAP);
      const extX = target.x + target.vx * extrapTime;
      const extY = target.y + target.vy * extrapTime;

      const dx = extX - pos.x;
      const dy = extY - pos.y;
      const dist = dx * dx + dy * dy;

      if (dist < 0.25) {
        pos.x = extX;
        pos.y = extY;
      } else if (dist > REMOTE_PLAYER_SNAP_DIST * REMOTE_PLAYER_SNAP_DIST) {
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
          cardId: snap.itemType.startsWith('card:') ? snap.itemType.slice(5) : undefined,
          cardRarity: snap.cardRarity,
        } as ItemDropComponent);
      }
      // Building metadata (for renderer type/color selection)
      if (snap.buildingType) {
        world.addComponent(snap.entityId, C.Building, {
          buildingType: snap.buildingType,
          permanent: snap.buildingType === 'campfire',
          upgradeLevel: snap.upgradeLevel ?? 1,
          rotation: snap.buildingRotation ?? 0,
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
      // Civilian metadata (for name tag rendering)
      if (snap.civilianName) {
        world.addComponent(snap.entityId, C.Civilian, {
          name: snap.civilianName,
          state: snap.civilianState ?? 'idle',
          assignedBuildingId: null,
          hunger: snap.civilianHunger ?? 0,
          hungerTimer: 0,
          speechBubble: null,
          speechTimer: 0,
          carryResource: null,
          carryAmount: 0,
        } as CivilianComponent);
      }
      // Boss metadata (for special boss rendering)
      if (snap.bossId) {
        world.addComponent(snap.entityId, C.Boss, {
          bossId: snap.bossId,
          enraged: false,
          specialCooldown: 0,
        } as BossComponent);
      }
      // Laser tower beam target (for beam rendering)
      if (snap.laserTargetId !== undefined) {
        world.addComponent(snap.entityId, C.LaserBeam, {
          range: 0, damagePerSecond: 0, targetId: snap.laserTargetId,
        } as LaserBeamComponent);
      }
      // Guard role/wolf name (for renderer color-coding and name tags)
      if (snap.guardRole || snap.guardName) {
        world.addComponent(snap.entityId, C.Guard, {
          guardRole: snap.guardRole,
          variant: snap.guardName ? 'wolf' : undefined,
          displayName: snap.guardName,
          barracksId: 0, patrolRadius: 0,
        } as GuardComponent);
      }
      // Ruins state (for renderer darkening + fire effect)
      if (snap.isRuins) {
        world.addComponent(snap.entityId, C.Ruins, {
          originalType: snap.buildingType ?? 'wall',
          originalLevel: snap.upgradeLevel ?? 1,
          burnTimer: snap.ruinsBurning ? 1 : 0,
          decayTimer: 0,
        } as RuinsComponent);
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

      // Update civilian state
      if (snap.civilianState !== undefined) {
        const civ = world.getComponent<CivilianComponent>(snap.entityId, C.Civilian);
        if (civ) {
          civ.state = snap.civilianState as CivilianComponent['state'];
          if (snap.civilianHunger !== undefined) civ.hunger = snap.civilianHunger;
        }
      }

      // Dodge roll state
      if (snap.dodging) {
        if (!world.hasComponent(snap.entityId, C.DodgeRoll)) {
          world.addComponent(snap.entityId, C.DodgeRoll, {
            timer: 1, duration: 1, dashVx: 0, dashVy: 0, cooldown: 0,
          } as DodgeRollComponent);
        }
      } else if (world.hasComponent(snap.entityId, C.DodgeRoll)) {
        world.removeComponent(snap.entityId, C.DodgeRoll);
      }

      // Ruins state update
      if (snap.isRuins !== undefined) {
        if (snap.isRuins) {
          let ruins = world.getComponent<RuinsComponent>(snap.entityId, C.Ruins);
          if (!ruins) {
            world.addComponent(snap.entityId, C.Ruins, {
              originalType: snap.buildingType ?? 'wall',
              originalLevel: snap.upgradeLevel ?? 1,
              burnTimer: snap.ruinsBurning ? 1 : 0,
              decayTimer: 0,
            } as RuinsComponent);
          } else {
            ruins.burnTimer = snap.ruinsBurning ? 1 : 0;
          }
        } else if (world.hasComponent(snap.entityId, C.Ruins)) {
          world.removeComponent(snap.entityId, C.Ruins);
        }
      }

      // Laser tower target update
      if (snap.laserTargetId !== undefined) {
        const lb = world.getComponent<LaserBeamComponent>(snap.entityId, C.LaserBeam);
        if (lb) lb.targetId = snap.laserTargetId;
        else world.addComponent(snap.entityId, C.LaserBeam, { range: 0, damagePerSecond: 0, targetId: snap.laserTargetId } as LaserBeamComponent);
      } else if (world.hasComponent(snap.entityId, C.LaserBeam)) {
        const lb = world.getComponent<LaserBeamComponent>(snap.entityId, C.LaserBeam);
        if (lb) lb.targetId = null;
      }

      // Downed state (synced from snapshot for civilians and late-joining clients)
      if (snap.downed) {
        if (!world.hasComponent(snap.entityId, C.Downed)) {
          world.addComponent(snap.entityId, C.Downed, {
            bleedTimer: 30, reviveProgress: 0, reviverId: -1,
          } as DownedComponent);
        }
      } else if (world.hasComponent(snap.entityId, C.Downed)) {
        world.removeComponent(snap.entityId, C.Downed);
      }

      // Status effects bitmask (for visual debuff rendering)
      if (snap.statusEffects !== undefined) {
        const se = world.getComponent<import('@shared/components').StatusEffectsComponent>(snap.entityId, C.StatusEffects);
        if (se) se.bitmask = snap.statusEffects;
        else world.addComponent(snap.entityId, C.StatusEffects, { bitmask: snap.statusEffects });
      } else if (world.hasComponent(snap.entityId, C.StatusEffects)) {
        const se = world.getComponent<import('@shared/components').StatusEffectsComponent>(snap.entityId, C.StatusEffects);
        if (se) se.bitmask = 0;
      }

      // On full snapshot (rejoin), hard-snap position
      if (hardSnap) {
        const pos = world.getComponent<PositionComponent>(snap.entityId, C.Position);
        if (pos) { pos.x = snap.x; pos.y = snap.y; }
      }
    }
  }
}
