import { World } from '@shared/ecs/World';
import { distance } from '@shared/math/utils';
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
  TitanRallyComponent,
  VelocityComponent,
  SpeedComponent,
  GuardComponent,
  HealthComponent,
  GhostStateComponent,
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
  ENEMY_REPLAN_INTERVAL,
  ENEMY_REPLAN_DIST_THRESHOLD,
  ENEMY_WAYPOINT_REACH,
  ENEMY_STUCK_DIST,
  ENEMY_STUCK_TIME,
  ENEMY_AVOIDANCE_LOOK_AHEAD,
  ENEMY_AVOIDANCE_MARGIN,
  ENEMY_AVOIDANCE_STRENGTH,
  GUARD_DETECT_RANGE,
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

/** Circle-vs-AABB overlap test (no push vector needed). */
function circleAABBOverlap(cx: number, cy: number, cr: number, bx: number, by: number, bHalf: number): boolean {
  const closestX = Math.max(bx - bHalf, Math.min(cx, bx + bHalf));
  const closestY = Math.max(by - bHalf, Math.min(cy, by + bHalf));
  const dx = cx - closestX, dy = cy - closestY;
  return dx * dx + dy * dy < cr * cr;
}

export class EnemySystem {
  private paths = new Map<number, CachedPath>();
  /** Tiles occupied by building entities - used to block pathfinding. */
  private buildingBlockedTiles = new Set<number>();
  /** Per-building tile keys (for excluding target building from blocked set). */
  private buildingTilesMap = new Map<number, number[]>();
  /** Cached building positions for break-through checks. */
  private buildingEntities: { x: number; y: number; half: number }[] = [];
  /** Bridge tiles that override unwalkable terrain for pathfinding. */
  private bridgeTiles = new Set<number>();
  /** Cached resource node positions for line-of-sight collision checks. */
  private resourcePositions: { x: number; y: number }[] = [];
  /** Cached portal positions for line-of-sight collision checks. */
  private portalPositions: { x: number; y: number }[] = [];
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
      // Skip bridges and spike traps - enemies don't target them
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

      // Bridges are walkable, not blocked - track them separately
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
    this.resourcePositions.length = 0;
    this.portalPositions.length = 0;
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
      // Cache positions for line-of-sight collision checks
      if (rf.type === 'resource') this.resourcePositions.push(rpos);
      else this.portalPositions.push(rpos);
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
      if (faction.type !== 'enemy' && faction.type !== 'guard') continue;
      const isGuard = faction.type === 'guard';

      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const inp = world.getComponent<PlayerInputComponent>(id, C.PlayerInput)!;

      // Stunned enemies cannot move or attack
      if (world.hasComponent(id, C.StunEffect)) {
        inp.dx = 0;
        inp.dy = 0;
        continue;
      }

      const ev = world.getComponent<EnemyVariantComponent>(id, C.EnemyVariant);
      const variant = ev?.variant ?? 'melee';

      // Get stats early so rangedRange is available for targeting decisions
      const stats = world.getComponent<EnemyStatsComponent>(id, C.EnemyStats);
      const meleeRange = stats?.range ?? ENEMY_MELEE_RANGE;
      const rangedRange = stats?.rangedRange ?? (variant === 'ranger' ? ENEMY_RANGER_RANGE : 0);
      const hasRanged = rangedRange > 0;
      const eRadius = stats?.radius ?? ENEMY_RADIUS;
      const enemyOverrides = stats
        ? { damage: stats.damage, range: stats.range, knockback: stats.knockback, aoe: variant === 'titan' }
        : ENEMY_OVERRIDES_DEFAULT;

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

      // Check for Taunt: taunted enemies override all other targeting
      const taunt = world.getComponent<import('@shared/components').TauntComponent>(id, C.Taunt);
      if (taunt) {
        taunt.remaining -= dt;
        if (taunt.remaining <= 0) {
          world.removeComponent(id, C.Taunt);
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
      const navMargin = eRadius + 4;

      // Helper: find nearest player (alive, not downed)
      const findNearestPlayer = (maxRange: number) => {
        let best: { pos: PositionComponent; dist: number } | null = null;
        for (const pid of playerIds) {
          if (world.hasComponent(pid, C.Downed)) continue;
          const ppos = world.getComponent<PositionComponent>(pid, C.Position)!;
          const ddx = ppos.x - pos.x;
          const ddy = ppos.y - pos.y;
          const dist = distance(ddx, ddy);
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
          const edgeDist = distance(edx, edy);
          if (edgeDist < maxRange && (!best || edgeDist < best.dist)) {
            // Closest point on AABB edge, then push outward so it's on a walkable tile
            const cx = Math.max(bpos.x - bHalf, Math.min(bpos.x + bHalf, pos.x));
            const cy = Math.max(bpos.y - bHalf, Math.min(bpos.y + bHalf, pos.y));
            const pdx = cx - bpos.x, pdy = cy - bpos.y;
            const pLen = distance(pdx, pdy);
            let nx = pLen > 0 ? cx + (pdx / pLen) * navMargin : cx + navMargin;
            let ny = pLen > 0 ? cy + (pdy / pLen) * navMargin : cy;
            // If nav point lands on unwalkable terrain (e.g. water), try 4 cardinal sides
            if (!(TILE_DEFS[this.generator.getTile(Math.floor(nx / TILE_SIZE), Math.floor(ny / TILE_SIZE))]?.walkable ?? false)) {
              const sides = [
                { x: bpos.x + bHalf + navMargin, y: bpos.y },
                { x: bpos.x - bHalf - navMargin, y: bpos.y },
                { x: bpos.x, y: bpos.y + bHalf + navMargin },
                { x: bpos.x, y: bpos.y - bHalf - navMargin },
              ];
              let bestDist = Infinity;
              for (const side of sides) {
                if (!(TILE_DEFS[this.generator.getTile(Math.floor(side.x / TILE_SIZE), Math.floor(side.y / TILE_SIZE))]?.walkable ?? false)) continue;
                const sd = (side.x - pos.x) ** 2 + (side.y - pos.y) ** 2;
                if (sd < bestDist) { nx = side.x; ny = side.y; bestDist = sd; }
              }
            }
            best = { id: bid, pos: bpos, nav: { x: nx, y: ny }, dist: edgeDist, half: bHalf };
          }
        }
        return best;
      };

      // Helper: find nearest hostile enemy (guards target all enemies)
      const findNearestHostileEnemy = (maxRange: number) => {
        // Only guards use this - enemies no longer target other enemies
        if (!isGuard) return null;
        let best: { pos: PositionComponent; dist: number } | null = null;
        for (const eid of world.query(C.Position, C.Faction)) {
          if (eid === id) continue;
          const ef = world.getComponent<FactionComponent>(eid, C.Faction)!;
          // Guards target all enemies
          if (ef.type !== 'enemy') continue;
          if (world.hasComponent(eid, C.Downed)) continue;
          // Guards can't see hidden ghosts
          const egs = world.getComponent<GhostStateComponent>(eid, C.GhostState);
          if (egs?.hidden) continue;
          const epos = world.getComponent<PositionComponent>(eid, C.Position)!;
          const ddx = epos.x - pos.x, ddy = epos.y - pos.y;
          const dist = distance(ddx, ddy);
          if (dist < maxRange && (!best || dist < best.dist)) {
            best = { pos: epos, dist };
          }
        }
        return best;
      };

      // ── Guard targeting: nearest enemy > patrol to barracks ────────────────
      if (isGuard) {
        const guard = world.getComponent<GuardComponent>(id, C.Guard);
        const hostileEnemy = findNearestHostileEnemy(GUARD_DETECT_RANGE);
        if (hostileEnemy) {
          targetPos = hostileEnemy.pos;
          navPos = hostileEnemy.pos;
          targetDist = hostileEnemy.dist;
        } else if (guard) {
          // Patrol: return to barracks if too far
          const bpos = world.getComponent<PositionComponent>(guard.barracksId, C.Position);
          if (bpos) {
            const dx = bpos.x - pos.x, dy = bpos.y - pos.y;
            const dist = distance(dx, dy);
            if (dist > guard.patrolRadius) {
              targetPos = bpos;
              navPos = bpos;
              targetDist = dist;
            }
          }
        }
      }
      // ── Variant-specific targeting (enemies only) ──────────────────────────
      else if (variant === 'ghost') {
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
      } else if (variant === 'titan') {
        // Titans: beeline for the campfire, only distracted by very close players
        const campfire = tryBuildings(campfireIds, Infinity);
        if (campfire) {
          targetPos = campfire.pos;
          navPos = campfire.nav;
          targetDist = campfire.dist;
          targetHalfExtent = campfire.half;
          targetEntityId = campfire.id;
        }
        // Players within melee range override campfire target
        const closeThreat = findNearestPlayer((stats?.range ?? 60) * 1.5);
        if (closeThreat) {
          targetPos = closeThreat.pos;
          navPos = closeThreat.pos;
          targetDist = closeThreat.dist;
          targetHalfExtent = 0;
          targetEntityId = null;
        }
        // No campfire and no players - fall back to any building
        if (!targetPos) {
          const allBuildingIds = [...campfireIds, ...wallIds, ...otherBuildingIds];
          const nearest = tryBuildings(allBuildingIds, Infinity);
          if (nearest) {
            targetPos = nearest.pos;
            navPos = nearest.nav;
            targetDist = nearest.dist;
            targetHalfExtent = nearest.half;
            targetEntityId = nearest.id;
          }
        }
      } else if (taunt && taunt.remaining > 0) {
        // Taunted: force target the taunting player, ignore everything else
        const tauntPos = world.getComponent<PositionComponent>(taunt.sourceId, C.Position);
        if (tauntPos) {
          const ddx = tauntPos.x - pos.x, ddy = tauntPos.y - pos.y;
          targetPos = tauntPos;
          navPos = tauntPos;
          targetDist = distance(ddx, ddy);
          directBeeline = true;
        }
      } else {
        // Standard targeting: campfire > players > walls > other buildings
        // (melee, ranger all use this)

        // 1. Campfire (always the global objective - no range limit)
        const campfire = tryBuildings(campfireIds, Infinity);
        if (campfire) {
          targetPos = campfire.pos;
          navPos = campfire.nav;
          targetDist = campfire.dist;
          targetHalfExtent = campfire.half;
          targetEntityId = campfire.id;
        }

        // 2. Nearby players override campfire (distraction range extends to rangedRange for ranged enemies)
        const PLAYER_DISTRACT_RANGE = rangedRange > 0 ? rangedRange : ENEMY_MELEE_RANGE * 2;
        const closestPlayer = findNearestPlayer(ENEMY_AGGRO_RANGE);
        if (closestPlayer && (closestPlayer.dist < PLAYER_DISTRACT_RANGE || !targetPos)) {
          if (!targetPos || this.isDirectPathClear(pos.x, pos.y, closestPlayer.pos.x, closestPlayer.pos.y, eRadius)) {
            targetPos = closestPlayer.pos;
            navPos = closestPlayer.pos;
            targetDist = closestPlayer.dist;
            targetHalfExtent = 0;
            targetEntityId = null;
          }
        }

        // 2b. Enemies no longer target other enemies - removed cross-faction combat

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
        // For buildings: use edge distance for melee check (not center distance)
        let meleeCheckDist: number;
        if (targetHalfExtent > 0) {
          const edx = Math.max(0, Math.abs(targetPos.x - pos.x) - targetHalfExtent);
          const edy = Math.max(0, Math.abs(targetPos.y - pos.y) - targetHalfExtent);
          meleeCheckDist = distance(edx, edy);
        } else {
          const ddx = targetPos.x - pos.x, ddy = targetPos.y - pos.y;
          meleeCheckDist = distance(ddx, ddy);
        }

        // Ranged attack: fire at targets within range (players and buildings)
        const canShootRanged = hasRanged && meleeCheckDist <= rangedRange && meleeCheckDist > meleeRange;

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
            // Buildings: keep closing distance - building collision stops naturally at surface
            const tdx = targetPos.x - pos.x;
            const tdy = targetPos.y - pos.y;
            const tlen = distance(tdx, tdy);
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
          const len = distance(ddx, ddy);

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

            this.navigateToward(id, pos, navPos as PositionComponent, inp, dt, len, ddx, ddy, eRadius);

            // Local obstacle avoidance: steer around resource nodes and portals
            this.applyObstacleAvoidance(pos, inp, navPos as { x: number; y: number }, eRadius);

            // Stuck detection: if enemy hasn't moved, apply perpendicular wiggle
            let stuck = this.stuckTimers.get(id);
            if (!stuck) {
              stuck = { x: pos.x, y: pos.y, timer: 0 };
              this.stuckTimers.set(id, stuck);
            }
            const movedDx = pos.x - stuck.x, movedDy = pos.y - stuck.y;
            if (movedDx * movedDx + movedDy * movedDy > ENEMY_STUCK_DIST * ENEMY_STUCK_DIST) {
              stuck.x = pos.x; stuck.y = pos.y; stuck.timer = 0;
            } else {
              stuck.timer += dt;
              if (stuck.timer > ENEMY_STUCK_TIME) {
                // Find nearest obstacle to push away from (resources, portals, and buildings)
                let nearOX = 0, nearOY = 0, nearOD = Infinity;
                let hasNear = false;
                for (const node of this.resourcePositions) {
                  const ox = node.x - pos.x, oy = node.y - pos.y;
                  const od = ox * ox + oy * oy;
                  if (od < nearOD) { nearOD = od; nearOX = ox; nearOY = oy; hasNear = true; }
                }
                for (const portal of this.portalPositions) {
                  const ox = portal.x - pos.x, oy = portal.y - pos.y;
                  const od = ox * ox + oy * oy;
                  if (od < nearOD) { nearOD = od; nearOX = ox; nearOY = oy; hasNear = true; }
                }
                for (const bldg of this.buildingEntities) {
                  const ox = bldg.x - pos.x, oy = bldg.y - pos.y;
                  const od = ox * ox + oy * oy;
                  if (od < nearOD) { nearOD = od; nearOX = ox; nearOY = oy; hasNear = true; }
                }
                if (hasNear && nearOD < 64 * 64) {
                  // Steer away from nearest obstacle, blended toward target
                  const oDist = Math.sqrt(nearOD);
                  const awayX = -nearOX / oDist, awayY = -nearOY / oDist;
                  const tDx = navPos!.x - pos.x, tDy = navPos!.y - pos.y;
                  const tLen = distance(tDx, tDy);
                  const tNx = tLen > 0 ? tDx / tLen : 0, tNy = tLen > 0 ? tDy / tLen : 0;
                  inp.dx = awayX * 0.6 + tNx * 0.4;
                  inp.dy = awayY * 0.6 + tNy * 0.4;
                  const wLen = Math.sqrt(inp.dx * inp.dx + inp.dy * inp.dy);
                  if (wLen > 0) { inp.dx /= wLen; inp.dy /= wLen; }
                } else {
                  // Fallback: random perpendicular wiggle
                  const perp = (Math.random() < 0.5 ? 1 : -1);
                  const origDx = inp.dx;
                  inp.dx += -inp.dy * 1.0 * perp;
                  inp.dy += origDx * 1.0 * perp;
                  const wLen = Math.sqrt(inp.dx * inp.dx + inp.dy * inp.dy);
                  if (wLen > 0) { inp.dx /= wLen; inp.dy /= wLen; }
                }
                this.paths.delete(id); // Force fresh A* replan on next tick
                stuck.timer = 0;
              }
            }

            // Restore excluded tiles
            if (excludedTiles) for (const tk of excludedTiles) this.buildingBlockedTiles.add(tk);

            // Attack any building within melee range while navigating (break through obstacles)
            // Ghosts don't attack buildings
            if (variant !== 'ghost') {
              const blocking = this.findBlockingBuilding(pos, meleeRange);
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

    // ── Titan rally mechanic ──────────────────────────────────────────────────
    this.tickTitanRally(world);

    return result;
  }

  /** Activate rally aura at 50% HP and buff nearby enemies' speed. */
  private tickTitanRally(world: World): void {
    for (const id of world.query(C.TitanRally, C.Health, C.Position)) {
      const rally = world.getComponent<TitanRallyComponent>(id, C.TitanRally)!;
      const hp = world.getComponent<HealthComponent>(id, C.Health)!;
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;

      // Activate rally when HP drops to 50%
      if (!rally.active && hp.current <= hp.max * 0.5 && hp.current > 0) {
        rally.active = true;
      }

      if (!rally.active) continue;

      // Boost speed of nearby non-titan enemies to at least rally.speedBuff × their base multiplier
      const rangeSq = rally.range * rally.range;
      for (const eid of world.query(C.EnemyVariant, C.Speed, C.Position)) {
        if (eid === id) continue;
        const ev = world.getComponent<EnemyVariantComponent>(eid, C.EnemyVariant)!;
        if (ev.variant === 'titan') continue;
        const epos = world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = epos.x - pos.x, dy = epos.y - pos.y;
        if (dx * dx + dy * dy > rangeSq) continue;
        const spd = world.getComponent<SpeedComponent>(eid, C.Speed)!;
        // Set multiplier to rally level (idempotent - safe to call every tick)
        spd.multiplier = Math.max(spd.multiplier, rally.speedBuff);
      }
    }
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
    enemyRadius = ENEMY_RADIUS,
  ): boolean {
    // If direct line is clear (tiles + buildings), chase directly
    if (this.isDirectPathClear(pos.x, pos.y, target.x, target.y, enemyRadius)) {
      inp.dx = directLen > 0 ? directDx / directLen : 0;
      inp.dy = directLen > 0 ? directDy / directLen : 0;
      this.paths.delete(id);
      return true;
    }

    // Use cached path or compute a new one (building-aware)
    const path = this.getOrComputePath(id, pos, target, dt, enemyRadius);

    if (path && path.nextIndex < path.waypoints.length) {
      const wp = path.waypoints[path.nextIndex];
      const wpDx = wp.x - pos.x;
      const wpDy = wp.y - pos.y;
      const wpLen = distance(wpDx, wpDy);

      // Large enemies consider waypoints reached at greater distance
      const wpReach = Math.max(ENEMY_WAYPOINT_REACH, enemyRadius);
      if (wpLen < wpReach) {
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
          const nLen = distance(nDx, nDy);
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
    enemyRadius = ENEMY_RADIUS,
  ): CachedPath | null {
    const existing = this.paths.get(enemyId);

    if (existing) {
      existing.age += dt;

      // Check if replan is needed
      const tdx = target.x - existing.targetX;
      const tdy = target.y - existing.targetY;
      if (existing.age < ENEMY_REPLAN_INTERVAL && (tdx * tdx + tdy * tdy) < ENEMY_REPLAN_DIST_THRESHOLD * ENEMY_REPLAN_DIST_THRESHOLD) {
        return existing;
      }
    }

    // Compute new path (with building-blocked tiles)
    // Inflate blocked tiles for large enemies so they don't try to squeeze through narrow gaps
    const inflation = enemyRadius > TILE_SIZE * 0.5 ? 1 : 0;
    const waypoints = findPath(this.generator, pos.x, pos.y, target.x, target.y, this.buildingBlockedTiles, this.bridgeTiles, inflation);
    if (!waypoints || waypoints.length === 0) {
      this.paths.delete(enemyId);
      return null;
    }

    const cached: CachedPath = {
      waypoints,
      nextIndex: 0,
      // Jitter initial age so enemies don't all replan on the same tick
      age: existing ? 0 : Math.random() * ENEMY_REPLAN_INTERVAL,
      targetX: target.x,
      targetY: target.y,
    };
    this.paths.set(enemyId, cached);
    return cached;
  }

  /** Ray-march check: is the path clear of unwalkable tiles, buildings, resources, and portals? */
  private isDirectPathClear(sx: number, sy: number, ex: number, ey: number, r = ENEMY_RADIUS): boolean {
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = distance(dx, dy);
    const steps = Math.ceil(dist / (TILE_SIZE / 2)); // 16px resolution

    for (let i = 0; i <= steps; i++) {
      const t = steps > 0 ? i / steps : 0;
      const wx = sx + dx * t;
      const wy = sy + dy * t;

      // Check 4 corners (like overlapsAny tile check) to catch obstacles at edges
      if (this.tileOrBlockedAt(wx - r, wy - r)) return false;
      if (this.tileOrBlockedAt(wx + r, wy - r)) return false;
      if (this.tileOrBlockedAt(wx - r, wy + r)) return false;
      if (this.tileOrBlockedAt(wx + r, wy + r)) return false;

      // Check actual entity collision volumes (not just tile occupancy)
      for (const node of this.resourcePositions) {
        if (circleAABBOverlap(wx, wy, r, node.x, node.y, RESOURCE_NODE_RADIUS)) return false;
      }
      for (const portal of this.portalPositions) {
        const pdx = wx - portal.x, pdy = wy - portal.y;
        const minDist = r + PORTAL_RADIUS;
        if (pdx * pdx + pdy * pdy < minDist * minDist) return false;
      }
    }
    return true;
  }

  /** Returns true if the world-pixel position is unwalkable or on a blocked tile. */
  private tileOrBlockedAt(wx: number, wy: number): boolean {
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    const tk = tileKey(tx, ty);
    if (this.bridgeTiles.has(tk)) return false;
    if (!(TILE_DEFS[this.generator.getTile(tx, ty)]?.walkable ?? false)) return true;
    return this.buildingBlockedTiles.has(tk);
  }

  /** Find the nearest building within melee range to break through. */
  private findBlockingBuilding(pos: PositionComponent, range = ENEMY_MELEE_RANGE): { x: number; y: number } | null {
    let closest: { x: number; y: number; dist: number } | null = null;
    for (const b of this.buildingEntities) {
      const edx = Math.max(0, Math.abs(b.x - pos.x) - b.half);
      const edy = Math.max(0, Math.abs(b.y - pos.y) - b.half);
      const edgeDist = distance(edx, edy);
      if (edgeDist <= range && (!closest || edgeDist < closest.dist)) {
        closest = { x: b.x, y: b.y, dist: edgeDist };
      }
    }
    return closest;
  }

  /** Steer inp.dx/dy around nearby resource nodes, portals, and buildings to prevent jamming. */
  private applyObstacleAvoidance(
    pos: PositionComponent,
    inp: PlayerInputComponent,
    targetPos: { x: number; y: number },
    enemyRadius: number,
  ): void {
    if (inp.dx === 0 && inp.dy === 0) return;

    // Accumulate avoidance forces from ALL nearby obstacles (not just nearest)
    let totalPushX = 0, totalPushY = 0;

    const addObstacle = (toX: number, toY: number, obsRadius: number) => {
      const dot = toX * inp.dx + toY * inp.dy;
      if (dot <= 0) return; // behind
      const distSq = toX * toX + toY * toY;
      const combined = enemyRadius + obsRadius + ENEMY_AVOIDANCE_MARGIN;
      if (distSq > (ENEMY_AVOIDANCE_LOOK_AHEAD + combined) ** 2) return; // too far
      const cross = Math.abs(toX * inp.dy - toY * inp.dx);
      if (cross >= combined) return; // beside path, not in it

      const dist = Math.sqrt(distSq);
      // Two perpendicular directions around obstacle
      const pAx = -toY / dist, pAy = toX / dist;
      const pBx = toY / dist, pBy = -toX / dist;
      // Pick the one toward target
      const ttX = targetPos.x - pos.x, ttY = targetPos.y - pos.y;
      const [perpX, perpY] = (pAx * ttX + pAy * ttY >= pBx * ttX + pBy * ttY)
        ? [pAx, pAy] : [pBx, pBy];
      // Strength: 1.0 when touching, fades at distance
      const strength = Math.max(0, Math.min(1, 1.0 - (dist - combined) / ENEMY_AVOIDANCE_LOOK_AHEAD));
      totalPushX += perpX * strength;
      totalPushY += perpY * strength;
    };

    // Scan resources
    for (const node of this.resourcePositions) {
      addObstacle(node.x - pos.x, node.y - pos.y, RESOURCE_NODE_RADIUS);
    }

    // Scan portals
    for (const portal of this.portalPositions) {
      addObstacle(portal.x - pos.x, portal.y - pos.y, PORTAL_RADIUS);
    }

    // Scan buildings
    for (const bldg of this.buildingEntities) {
      addObstacle(bldg.x - pos.x, bldg.y - pos.y, bldg.half);
    }

    if (totalPushX === 0 && totalPushY === 0) return;

    inp.dx += totalPushX * ENEMY_AVOIDANCE_STRENGTH;
    inp.dy += totalPushY * ENEMY_AVOIDANCE_STRENGTH;
    const len = Math.sqrt(inp.dx * inp.dx + inp.dy * inp.dy);
    if (len > 0) { inp.dx /= len; inp.dy /= len; }
  }
}
