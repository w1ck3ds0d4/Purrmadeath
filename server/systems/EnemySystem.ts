import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  FactionComponent,
  PlayerInputComponent,
  AttackCooldownComponent,
  FacingComponent,
} from '@shared/components';
import {
  TILE_SIZE,
  ENEMY_AGGRO_RANGE,
  ENEMY_MELEE_RANGE,
  ENEMY_MELEE_DAMAGE,
  ENEMY_MELEE_KNOCKBACK,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import { CombatSystem, HitResult } from './CombatSystem';
import { findPath, CachedPath } from './Pathfinding';

export interface EnemyAttackResult {
  hits: HitResult[];
  deaths: number[];
  /** Enemies that swung (for ATTACK_PERFORMED broadcast — fires even on miss). */
  attackPerformed: { sourceId: number; facing: number }[];
}

const ENEMY_OVERRIDES = {
  damage: ENEMY_MELEE_DAMAGE,
  range: ENEMY_MELEE_RANGE,
  knockback: ENEMY_MELEE_KNOCKBACK,
};

/** How often (seconds) to recompute a path. */
const REPLAN_INTERVAL = 0.5;
/** If target moved more than this many pixels, force a replan. */
const REPLAN_DIST_THRESHOLD = 64; // 2 tiles
/** Distance (px) at which a waypoint is considered reached. */
const WAYPOINT_REACH = 16; // half a tile

/**
 * Server-side enemy AI — runs each tick.
 *
 * For each enemy entity:
 *   - If a player is within ENEMY_MELEE_RANGE → stop, face target, melee attack.
 *   - Else if a player is within ENEMY_AGGRO_RANGE → navigate toward them via A*.
 *   - Otherwise stand still.
 *
 * Movement is executed by MovementSystem (runs after this), so enemies
 * share the same physics and tile-collision as players.
 */
export class EnemySystem {
  private paths = new Map<number, CachedPath>();

  constructor(
    private readonly combat: CombatSystem,
    private readonly generator: WorldGenerator,
  ) {}

  update(world: World, dt: number): EnemyAttackResult {
    const result: EnemyAttackResult = { hits: [], deaths: [], attackPerformed: [] };
    const playerIds = world.query(C.Position, C.PlayerIndex);

    // Clean stale paths for entities that no longer exist
    for (const id of this.paths.keys()) {
      if (!world.hasEntity(id)) this.paths.delete(id);
    }

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

        if (len <= ENEMY_MELEE_RANGE) {
          // In melee range: stop moving, face target, attack
          inp.dx = 0;
          inp.dy = 0;
          this.paths.delete(id);

          const facing = Math.atan2(ddy, ddx);
          const facingComp = world.getComponent<FacingComponent>(id, C.Facing);
          if (facingComp) facingComp.angle = facing;

          // Check cooldown before attack to detect swings
          const cd = world.getComponent<AttackCooldownComponent>(id, C.AttackCooldown);
          const cdBefore = cd?.remaining ?? 0;

          const { hits, deaths } = this.combat.processMeleeAttack(
            world, id, facing, undefined, ENEMY_OVERRIDES,
          );

          // Detect if a swing occurred (cooldown went from 0 → max)
          const didSwing = cd && cdBefore <= 0 && cd.remaining > 0;
          if (didSwing) {
            result.attackPerformed.push({ sourceId: id, facing });
          }

          result.hits.push(...hits);
          result.deaths.push(...deaths);
        } else {
          // Out of melee range: navigate toward player
          this.navigateToward(id, pos, nearestPos, inp, dt, len, ddx, ddy);
        }
      } else {
        inp.dx = 0;
        inp.dy = 0;
        this.paths.delete(id);
      }
      inp.sprint = false;
    }

    return result;
  }

  /** Set dx/dy to navigate toward the target, using A* if line of sight is blocked. */
  private navigateToward(
    id: number,
    pos: PositionComponent,
    target: PositionComponent,
    inp: PlayerInputComponent,
    dt: number,
    directLen: number,
    directDx: number,
    directDy: number,
  ): void {
    // If direct line is clear, chase directly (faster than pathfinding)
    if (this.isDirectPathClear(pos.x, pos.y, target.x, target.y)) {
      inp.dx = directLen > 0 ? directDx / directLen : 0;
      inp.dy = directLen > 0 ? directDy / directLen : 0;
      this.paths.delete(id);
      return;
    }

    // Use cached path or compute a new one
    const path = this.getOrComputePath(id, pos, target, dt);

    if (path && path.nextIndex < path.waypoints.length) {
      const wp = path.waypoints[path.nextIndex];
      const wpDx = wp.x - pos.x;
      const wpDy = wp.y - pos.y;
      const wpLen = Math.sqrt(wpDx * wpDx + wpDy * wpDy);

      if (wpLen < WAYPOINT_REACH) {
        // Reached waypoint, advance to next
        path.nextIndex++;
        if (path.nextIndex >= path.waypoints.length) {
          // All waypoints consumed — chase directly
          inp.dx = directLen > 0 ? directDx / directLen : 0;
          inp.dy = directLen > 0 ? directDy / directLen : 0;
        } else {
          // Move toward next waypoint
          const next = path.waypoints[path.nextIndex];
          const nDx = next.x - pos.x;
          const nDy = next.y - pos.y;
          const nLen = Math.sqrt(nDx * nDx + nDy * nDy);
          inp.dx = nLen > 0 ? nDx / nLen : 0;
          inp.dy = nLen > 0 ? nDy / nLen : 0;
        }
      } else {
        inp.dx = wpDx / wpLen;
        inp.dy = wpDy / wpLen;
      }
    } else {
      // No path found — fallback to direct chase
      inp.dx = directLen > 0 ? directDx / directLen : 0;
      inp.dy = directLen > 0 ? directDy / directLen : 0;
    }
  }

  private getOrComputePath(
    enemyId: number,
    pos: PositionComponent,
    target: PositionComponent,
    dt: number,
  ): CachedPath | null {
    const existing = this.paths.get(enemyId);

    if (existing) {
      existing.age += dt;

      // Check if replan is needed
      const tdx = target.x - existing.targetX;
      const tdy = target.y - existing.targetY;
      if (existing.age < REPLAN_INTERVAL && (tdx * tdx + tdy * tdy) < REPLAN_DIST_THRESHOLD * REPLAN_DIST_THRESHOLD) {
        return existing;
      }
    }

    // Compute new path
    const waypoints = findPath(this.generator, pos.x, pos.y, target.x, target.y);
    if (!waypoints || waypoints.length === 0) {
      this.paths.delete(enemyId);
      return null;
    }

    const cached: CachedPath = {
      waypoints,
      nextIndex: 0,
      // Jitter initial age so enemies don't all replan on the same tick
      age: existing ? 0 : Math.random() * REPLAN_INTERVAL,
      targetX: target.x,
      targetY: target.y,
    };
    this.paths.set(enemyId, cached);
    return cached;
  }

  /** Simple ray-march check: are all tiles between start and end walkable? */
  private isDirectPathClear(sx: number, sy: number, ex: number, ey: number): boolean {
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(dist / TILE_SIZE);

    for (let i = 0; i <= steps; i++) {
      const t = steps > 0 ? i / steps : 0;
      const wx = sx + dx * t;
      const wy = sy + dy * t;
      const tx = Math.floor(wx / TILE_SIZE);
      const ty = Math.floor(wy / TILE_SIZE);
      if (!(TILE_DEFS[this.generator.getTile(tx, ty)]?.walkable ?? false)) return false;
    }
    return true;
  }
}
