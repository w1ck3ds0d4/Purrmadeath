import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  FactionComponent,
  PlayerInputComponent,
  AttackCooldownComponent,
  FacingComponent,
  BuildingComponent,
  EnemyVariantComponent,
  EnemyStatsComponent,
  AssassinDashComponent,
  VelocityComponent,
  SpeedComponent,
} from '@shared/components';
import {
  TILE_SIZE,
  ENEMY_AGGRO_RANGE,
  ENEMY_MELEE_RANGE,
  ENEMY_MELEE_DAMAGE,
  ENEMY_MELEE_KNOCKBACK,
  ENEMY_RANGER_RANGE,
  RESOURCE_NODE_RADIUS,
  PORTAL_RADIUS,
  ENEMY_RADIUS,
  buildingHalfExtent,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import { CombatSystem, HitResult } from './CombatSystem';
import { findPath, CachedPath, tileKey } from './Pathfinding';

export interface EnemyAttackResult {
  hits: HitResult[];
  deaths: number[];
  /** Enemies that swung (for ATTACK_PERFORMED broadcast - fires even on miss). */
  attackPerformed: { sourceId: number; facing: number }[];
  /** Rangers that want to fire a projectile (spawned by GameSession). */
  rangedAttacks: { sourceId: number; x: number; y: number; facing: number; projectileSpeed: number; damage: number; radius: number }[];
}

const ENEMY_OVERRIDES_DEFAULT = {
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
 * Server-side enemy AI - runs each tick.
 *
 * For each enemy entity:
 *   - If a player is within ENEMY_MELEE_RANGE → stop, face target, melee attack.
 *   - Else if a player is within ENEMY_AGGRO_RANGE → navigate toward them via A*.
 *   - Otherwise stand still.
 *
 * Movement is executed by MovementSystem (runs after this), so enemies
 * share the same physics and tile-collision as players.
 */
/** Stuck detection: if enemy hasn't moved more than this distance in STUCK_TIME, apply wiggle. */
const STUCK_DIST = 4;
const STUCK_TIME = 2;

export class EnemySystem {
  private paths = new Map<number, CachedPath>();
  /** Tiles occupied by building entities — used to block pathfinding. */
  private buildingBlockedTiles = new Set<number>();
  /** Per-building tile keys (for excluding target building from blocked set). */
  private buildingTilesMap = new Map<number, number[]>();
  /** Cached building positions for break-through checks. */
  private buildingEntities: { x: number; y: number; half: number }[] = [];
  /** Bridge tiles that override unwalkable terrain for pathfinding. */
  private bridgeTiles = new Set<number>();
  /** Stuck detection: tracks last-known positions and time since last significant move. */
  private stuckTimers = new Map<number, { x: number; y: number; timer: number }>();

  constructor(
    private readonly combat: CombatSystem,
    private readonly generator: WorldGenerator,
  ) {}

  update(world: World, dt: number): EnemyAttackResult {
    const result: EnemyAttackResult = { hits: [], deaths: [], attackPerformed: [], rangedAttacks: [] };
    const playerIds = world.query(C.Position, C.PlayerIndex);

    // Categorize buildings by priority: campfire > walls > other buildings
    const campfireIds: number[] = [];
    const wallIds: number[] = [];
    const otherBuildingIds: number[] = [];
    for (const bid of world.query(C.Position, C.Faction)) {
      const f = world.getComponent<FactionComponent>(bid, C.Faction)!;
      if (f.type !== 'building') continue;
      const bldg = world.getComponent<BuildingComponent>(bid, C.Building);
      if (!bldg) continue;
      // Skip bridges and spike traps — enemies don't target them
      if (bldg.buildingType === 'bridge' || bldg.buildingType === 'spike_trap') continue;
      if (bldg.buildingType === 'campfire') campfireIds.push(bid);
      else if (bldg.buildingType === 'wall') wallIds.push(bid);
      else otherBuildingIds.push(bid);
    }

    // Compute building-blocked tiles for pathfinding (so enemies navigate around buildings)
    this.buildingBlockedTiles.clear();
    this.buildingTilesMap.clear();
    this.buildingEntities = [];
    this.bridgeTiles.clear();
    for (const bid of world.query(C.Position, C.Building)) {
      const bpos = world.getComponent<PositionComponent>(bid, C.Position)!;
      const bldg = world.getComponent<BuildingComponent>(bid, C.Building)!;
      const half = buildingHalfExtent(bldg.buildingType);

      // Bridges are walkable, not blocked — track them separately
      if (bldg.buildingType === 'bridge') {
        const tx = Math.floor(bpos.x / TILE_SIZE);
        const ty = Math.floor(bpos.y / TILE_SIZE);
        this.bridgeTiles.add(tileKey(tx, ty));
        continue;
      }
      // Spike traps are not solid obstacles for pathfinding
      if (bldg.buildingType === 'spike_trap') continue;

      this.buildingEntities.push({ x: bpos.x, y: bpos.y, half });
      const tiles: number[] = [];
      const minTx = Math.floor((bpos.x - half) / TILE_SIZE);
      const maxTx = Math.floor((bpos.x + half - 1) / TILE_SIZE);
      const minTy = Math.floor((bpos.y - half) / TILE_SIZE);
      const maxTy = Math.floor((bpos.y + half - 1) / TILE_SIZE);
      for (let tx = minTx; tx <= maxTx; tx++) {
        for (let ty = minTy; ty <= maxTy; ty++) {
          const tk = tileKey(tx, ty);
          tiles.push(tk);
          this.buildingBlockedTiles.add(tk);
        }
      }
      this.buildingTilesMap.set(bid, tiles);
    }

    // Block tiles occupied by resource nodes and portals so enemies path around them
    for (const rid of world.query(C.Position, C.Faction)) {
      const rf = world.getComponent<FactionComponent>(rid, C.Faction)!;
      let rHalf: number;
      if (rf.type === 'resource') {
        rHalf = RESOURCE_NODE_RADIUS + ENEMY_RADIUS;
      } else if (rf.type === 'portal') {
        rHalf = PORTAL_RADIUS + ENEMY_RADIUS;
      } else {
        continue;
      }
      const rpos = world.getComponent<PositionComponent>(rid, C.Position)!;
      const rMinTx = Math.floor((rpos.x - rHalf) / TILE_SIZE);
      const rMaxTx = Math.floor((rpos.x + rHalf - 1) / TILE_SIZE);
      const rMinTy = Math.floor((rpos.y - rHalf) / TILE_SIZE);
      const rMaxTy = Math.floor((rpos.y + rHalf - 1) / TILE_SIZE);
      for (let tx = rMinTx; tx <= rMaxTx; tx++) {
        for (let ty = rMinTy; ty <= rMaxTy; ty++) {
          this.buildingBlockedTiles.add(tileKey(tx, ty));
        }
      }
    }

    // Clean stale paths and stuck timers for entities that no longer exist
    for (const id of this.paths.keys()) {
      if (!world.hasEntity(id)) this.paths.delete(id);
    }
    for (const id of this.stuckTimers.keys()) {
      if (!world.hasEntity(id)) this.stuckTimers.delete(id);
    }

    for (const id of world.query(C.Position, C.Faction, C.PlayerInput)) {
      const faction = world.getComponent<FactionComponent>(id, C.Faction)!;
      if (faction.type !== 'enemy') continue;

      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const inp = world.getComponent<PlayerInputComponent>(id, C.PlayerInput)!;
      const ev = world.getComponent<EnemyVariantComponent>(id, C.EnemyVariant);
      const variant = ev?.variant ?? 'melee';

      // ── Assassin dash tick ─────────────────────────────────────────────────
      const dash = world.getComponent<AssassinDashComponent>(id, C.AssassinDash);
      if (dash) {
        if (dash.dashing) {
          dash.dashTimer -= dt;
          if (dash.dashTimer <= 0) {
            dash.dashing = false;
            // Restore normal speed
            const spd = world.getComponent<SpeedComponent>(id, C.Speed);
            if (spd) spd.multiplier = 1;
          }
        } else if (dash.cooldown > 0) {
          dash.cooldown -= dt;
        }
      }

      // Priority targeting: campfire > players > walls > other buildings
      let targetPos: { x: number; y: number } | null = null;
      let navPos: { x: number; y: number } | null = null;
      let targetDist = Infinity;
      let targetHalfExtent = 0; // >0 for buildings (used for edge-based melee check)
      let targetEntityId: number | null = null; // building entity to exclude from pathfinding
      /** If true, skip pathfinding and beeline directly (ghosts phase through everything). */
      let directBeeline = false;

      // Margin to push nav point outside building collision so pathfinder can reach it
      const NAV_MARGIN = 14; // ~ENEMY_RADIUS + buffer

      // Helper: find nearest player (alive, not downed)
      const findNearestPlayer = (maxRange: number) => {
        let best: { pos: PositionComponent; dist: number } | null = null;
        for (const pid of playerIds) {
          if (world.hasComponent(pid, C.Downed)) continue;
          const ppos = world.getComponent<PositionComponent>(pid, C.Position)!;
          const ddx = ppos.x - pos.x;
          const ddy = ppos.y - pos.y;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dist < maxRange && (!best || dist < best.dist)) {
            best = { pos: ppos, dist };
          }
        }
        return best;
      };

      const tryBuildings = (ids: number[], maxRange: number) => {
        let best: { id: number; pos: PositionComponent; nav: { x: number; y: number }; dist: number; half: number } | null = null;
        for (const bid of ids) {
          const bpos = world.getComponent<PositionComponent>(bid, C.Position)!;
          const bldg = world.getComponent<BuildingComponent>(bid, C.Building);
          const bHalf = bldg ? buildingHalfExtent(bldg.buildingType) : 16;
          const edx = Math.max(0, Math.abs(bpos.x - pos.x) - bHalf);
          const edy = Math.max(0, Math.abs(bpos.y - pos.y) - bHalf);
          const edgeDist = Math.sqrt(edx * edx + edy * edy);
          if (edgeDist < maxRange && (!best || edgeDist < best.dist)) {
            // Closest point on AABB edge, then push outward so it's on a walkable tile
            const cx = Math.max(bpos.x - bHalf, Math.min(bpos.x + bHalf, pos.x));
            const cy = Math.max(bpos.y - bHalf, Math.min(bpos.y + bHalf, pos.y));
            const pdx = cx - bpos.x, pdy = cy - bpos.y;
            const pLen = Math.sqrt(pdx * pdx + pdy * pdy);
            const nx = pLen > 0 ? cx + (pdx / pLen) * NAV_MARGIN : cx + NAV_MARGIN;
            const ny = pLen > 0 ? cy + (pdy / pLen) * NAV_MARGIN : cy;
            best = { id: bid, pos: bpos, nav: { x: nx, y: ny }, dist: edgeDist, half: bHalf };
          }
        }
        return best;
      };

      // ── Variant-specific targeting ────────────────────────────────────────
      if (variant === 'ghost') {
        // Ghosts: only target players, phase through everything (no pathfinding)
        const nearest = findNearestPlayer(Infinity);
        if (nearest) {
          targetPos = nearest.pos;
          navPos = nearest.pos;
          targetDist = nearest.dist;
          directBeeline = true;
        }
      } else if (variant === 'assassin') {
        // Assassins: only target players (use pathfinding, not beeline)
        const nearest = findNearestPlayer(Infinity);
        if (nearest) {
          targetPos = nearest.pos;
          navPos = nearest.pos;
          targetDist = nearest.dist;
        }
      } else if (variant === 'giant') {
        // Giants: target nearest building (any type), skip player distraction entirely
        const allBuildingIds = [...campfireIds, ...wallIds, ...otherBuildingIds];
        const nearest = tryBuildings(allBuildingIds, Infinity);
        if (nearest) {
          targetPos = nearest.pos;
          navPos = nearest.nav;
          targetDist = nearest.dist;
          targetHalfExtent = nearest.half;
          targetEntityId = nearest.id;
        }
      } else {
        // Standard targeting: campfire > players > walls > other buildings
        // (melee, ranger all use this)

        // 1. Campfire (always the global objective — no range limit)
        const campfire = tryBuildings(campfireIds, Infinity);
        if (campfire) {
          targetPos = campfire.pos;
          navPos = campfire.nav;
          targetDist = campfire.dist;
          targetHalfExtent = campfire.half;
          targetEntityId = campfire.id;
        }

        // 2. Nearby players override campfire (distraction — only if very close)
        const PLAYER_DISTRACT_RANGE = ENEMY_MELEE_RANGE * 2;
        const closestPlayer = findNearestPlayer(ENEMY_AGGRO_RANGE);
        if (closestPlayer && (closestPlayer.dist < PLAYER_DISTRACT_RANGE || !targetPos)) {
          if (!targetPos || this.isDirectPathClear(pos.x, pos.y, closestPlayer.pos.x, closestPlayer.pos.y)) {
            targetPos = closestPlayer.pos;
            navPos = closestPlayer.pos;
            targetDist = closestPlayer.dist;
            targetHalfExtent = 0;
            targetEntityId = null;
          }
        }

        // 3. Walls (only if nothing else found)
        if (!targetPos) {
          const wall = tryBuildings(wallIds, ENEMY_AGGRO_RANGE);
          if (wall) { targetPos = wall.pos; navPos = wall.nav; targetDist = wall.dist; targetHalfExtent = wall.half; targetEntityId = wall.id; }
        }

        // 4. Other buildings (lowest priority)
        if (!targetPos) {
          const other = tryBuildings(otherBuildingIds, ENEMY_AGGRO_RANGE);
          if (other) { targetPos = other.pos; navPos = other.nav; targetDist = other.dist; targetHalfExtent = other.half; targetEntityId = other.id; }
        }
      }

      if (targetPos && navPos) {
        const stats = world.getComponent<EnemyStatsComponent>(id, C.EnemyStats);

        // Per-entity stats (fallback to global defaults for legacy entities without EnemyStats)
        const meleeRange = stats?.range ?? ENEMY_MELEE_RANGE;
        const rangedRange = stats?.rangedRange ?? (variant === 'ranger' ? ENEMY_RANGER_RANGE : 0);
        const hasRanged = rangedRange > 0;
        const enemyOverrides = stats
          ? { damage: stats.damage, range: stats.range, knockback: stats.knockback }
          : ENEMY_OVERRIDES_DEFAULT;

        // For buildings: use edge distance for melee check (not center distance)
        let meleeCheckDist: number;
        if (targetHalfExtent > 0) {
          const edx = Math.max(0, Math.abs(targetPos.x - pos.x) - targetHalfExtent);
          const edy = Math.max(0, Math.abs(targetPos.y - pos.y) - targetHalfExtent);
          meleeCheckDist = Math.sqrt(edx * edx + edy * edy);
        } else {
          const ddx = targetPos.x - pos.x, ddy = targetPos.y - pos.y;
          meleeCheckDist = Math.sqrt(ddx * ddx + ddy * ddy);
        }

        // Ranged attack: fire at non-building targets within range
        const canShootRanged = hasRanged && targetHalfExtent === 0 && meleeCheckDist <= rangedRange && meleeCheckDist > meleeRange;

        if (canShootRanged) {
          // Stop and fire
          inp.dx = 0;
          inp.dy = 0;
          this.paths.delete(id);

          const facing = Math.atan2(targetPos.y - pos.y, targetPos.x - pos.x);
          const facingComp = world.getComponent<FacingComponent>(id, C.Facing);
          if (facingComp) facingComp.angle = facing;

          const cd = world.getComponent<AttackCooldownComponent>(id, C.AttackCooldown);
          if (cd && cd.remaining <= 0) {
            cd.remaining = cd.max;
            result.rangedAttacks.push({
              sourceId: id, x: pos.x, y: pos.y, facing,
              projectileSpeed: stats?.projectileSpeed ?? 300,
              damage: stats?.rangedDamage ?? 8,
              radius: stats?.radius ?? 10,
            });
          }
        } else if (meleeCheckDist <= meleeRange) {
          // In melee range: face target center, attack
          if (targetHalfExtent > 0) {
            // Buildings: keep closing distance — building collision stops naturally at surface
            const tdx = targetPos.x - pos.x;
            const tdy = targetPos.y - pos.y;
            const tlen = Math.sqrt(tdx * tdx + tdy * tdy);
            inp.dx = tlen > 0 ? tdx / tlen : 0;
            inp.dy = tlen > 0 ? tdy / tlen : 0;
          } else {
            // Players: stop at melee range
            inp.dx = 0;
            inp.dy = 0;
          }
          this.paths.delete(id);

          const facing = Math.atan2(targetPos.y - pos.y, targetPos.x - pos.x);
          const facingComp = world.getComponent<FacingComponent>(id, C.Facing);
          if (facingComp) facingComp.angle = facing;

          const cd = world.getComponent<AttackCooldownComponent>(id, C.AttackCooldown);
          const cdBefore = cd?.remaining ?? 0;

          const { hits, deaths } = this.combat.processMeleeAttack(
            world, id, facing, undefined, enemyOverrides,
          );

          const didSwing = cd && cdBefore <= 0 && cd.remaining > 0;
          if (didSwing) {
            result.attackPerformed.push({ sourceId: id, facing });
          }

          result.hits.push(...hits);
          result.deaths.push(...deaths);
        } else {
          // ── Movement toward target ────────────────────────────────────────
          const ddx = navPos.x - pos.x, ddy = navPos.y - pos.y;
          const len = Math.sqrt(ddx * ddx + ddy * ddy);

          // Assassin dash: instant lunge when target is a player within 200px
          if (variant === 'assassin' && dash && !dash.dashing && dash.cooldown <= 0
              && targetHalfExtent === 0 && meleeCheckDist <= 200) {
            dash.dashing = true;
            dash.dashTimer = dash.dashDuration;
            dash.cooldown = dash.maxCooldown;
            // Override speed multiplier for the dash
            const spd = world.getComponent<SpeedComponent>(id, C.Speed);
            if (spd) spd.multiplier = dash.dashSpeed / spd.base;
          }

          if (directBeeline) {
            // Ghost: beeline directly, ignore pathfinding and terrain
            inp.dx = len > 0 ? ddx / len : 0;
            inp.dy = len > 0 ? ddy / len : 0;
            this.paths.delete(id);
          } else {
            // Normal navigation: A* pathfinding with building awareness
            // Temporarily exclude target building tiles
            const excludedTiles = targetEntityId !== null ? this.buildingTilesMap.get(targetEntityId) : undefined;
            if (excludedTiles) for (const tk of excludedTiles) this.buildingBlockedTiles.delete(tk);

            this.navigateToward(id, pos, navPos as PositionComponent, inp, dt, len, ddx, ddy);

            // Stuck detection: if enemy hasn't moved, apply perpendicular wiggle
            let stuck = this.stuckTimers.get(id);
            if (!stuck) {
              stuck = { x: pos.x, y: pos.y, timer: 0 };
              this.stuckTimers.set(id, stuck);
            }
            const movedDx = pos.x - stuck.x, movedDy = pos.y - stuck.y;
            if (movedDx * movedDx + movedDy * movedDy > STUCK_DIST * STUCK_DIST) {
              stuck.x = pos.x; stuck.y = pos.y; stuck.timer = 0;
            } else {
              stuck.timer += dt;
              if (stuck.timer > STUCK_TIME) {
                const perp = (Math.random() < 0.5 ? 1 : -1);
                inp.dx += -inp.dy * 0.7 * perp;
                inp.dy += inp.dx * 0.7 * perp;
                const wLen = Math.sqrt(inp.dx * inp.dx + inp.dy * inp.dy);
                if (wLen > 0) { inp.dx /= wLen; inp.dy /= wLen; }
                stuck.timer = 0;
              }
            }

            // Restore excluded tiles
            if (excludedTiles) for (const tk of excludedTiles) this.buildingBlockedTiles.add(tk);

            // Attack any building within melee range while navigating (break through obstacles)
            // Ghosts don't attack buildings
            if (variant !== 'ghost') {
              const blocking = this.findBlockingBuilding(pos);
              if (blocking) {
                const facing = Math.atan2(blocking.y - pos.y, blocking.x - pos.x);
                const facingComp = world.getComponent<FacingComponent>(id, C.Facing);
                if (facingComp) facingComp.angle = facing;

                const cd = world.getComponent<AttackCooldownComponent>(id, C.AttackCooldown);
                const cdBefore = cd?.remaining ?? 0;

                const { hits, deaths } = this.combat.processMeleeAttack(
                  world, id, facing, undefined, enemyOverrides,
                );

                const didSwing = cd && cdBefore <= 0 && cd.remaining > 0;
                if (didSwing) {
                  result.attackPerformed.push({ sourceId: id, facing });
                }

                result.hits.push(...hits);
                result.deaths.push(...deaths);
              }
            }
          }
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

  /**
   * Set dx/dy to navigate toward the target, using A* if line of sight is blocked.
   * Returns true if a valid path was found, false if falling back to direct chase.
   */
  private navigateToward(
    id: number,
    pos: PositionComponent,
    target: PositionComponent,
    inp: PlayerInputComponent,
    dt: number,
    directLen: number,
    directDx: number,
    directDy: number,
  ): boolean {
    // If direct line is clear (tiles + buildings), chase directly
    if (this.isDirectPathClear(pos.x, pos.y, target.x, target.y)) {
      inp.dx = directLen > 0 ? directDx / directLen : 0;
      inp.dy = directLen > 0 ? directDy / directLen : 0;
      this.paths.delete(id);
      return true;
    }

    // Use cached path or compute a new one (building-aware)
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
          // All waypoints consumed - chase directly
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
      return true;
    }

    // No path found - fallback to direct chase
    inp.dx = directLen > 0 ? directDx / directLen : 0;
    inp.dy = directLen > 0 ? directDy / directLen : 0;
    return false;
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

    // Compute new path (with building-blocked tiles)
    const waypoints = findPath(this.generator, pos.x, pos.y, target.x, target.y, this.buildingBlockedTiles, this.bridgeTiles);
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

  /** Simple ray-march check: are all tiles between start and end walkable and not blocked by buildings? */
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
      const tk = tileKey(tx, ty);
      // Bridge tiles override unwalkable terrain
      if (!this.bridgeTiles.has(tk) && !(TILE_DEFS[this.generator.getTile(tx, ty)]?.walkable ?? false)) return false;
      if (this.buildingBlockedTiles.has(tk)) return false;
    }
    return true;
  }

  /** Find the nearest building within melee range to break through. */
  private findBlockingBuilding(pos: PositionComponent): { x: number; y: number } | null {
    let closest: { x: number; y: number; dist: number } | null = null;
    for (const b of this.buildingEntities) {
      const edx = Math.max(0, Math.abs(b.x - pos.x) - b.half);
      const edy = Math.max(0, Math.abs(b.y - pos.y) - b.half);
      const edgeDist = Math.sqrt(edx * edx + edy * edy);
      if (edgeDist <= ENEMY_MELEE_RANGE && (!closest || edgeDist < closest.dist)) {
        closest = { x: b.x, y: b.y, dist: edgeDist };
      }
    }
    return closest;
  }
}
