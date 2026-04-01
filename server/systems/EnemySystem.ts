/**
 * EnemySystem - server-side enemy and guard AI.
 *
 * Each tick, for every enemy/guard entity:
 *   1. Targeting: determines what to chase based on variant and priority rules
 *   2. Combat: melee attack if in range, ranged attack if applicable
 *   3. Navigation: A* pathfinding around buildings/resources, with obstacle avoidance
 *   4. Stuck detection: applies perpendicular wiggle if enemy hasn't moved
 *
 * Targeting priority (standard enemies): campfire > nearby players > walls > other buildings
 * Variant overrides: ghosts beeline to players, giants target buildings, assassins dash-lunge,
 * titans beeline to campfire. Guards target nearest enemy within detection range.
 */
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
  GATHERING_DAMAGE,
  buildingHalfExtent,
} from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import { CombatSystem, HitResult } from './CombatSystem';
import { findPath, CachedPath, tileKey } from './Pathfinding';
import { createSpatialHash, type SpatialHash } from './SpatialHash';

export interface EnemyAttackResult {
  hits: HitResult[];
  deaths: number[];
  /** Enemies that swung (for ATTACK_PERFORMED broadcast - fires even on miss). */
  attackPerformed: { sourceId: number; facing: number }[];
  /** Rangers that want to fire a projectile (spawned by GameSession). */
  rangedAttacks: { sourceId: number; x: number; y: number; facing: number; projectileSpeed: number; damage: number; radius: number }[];
  /** Resource nodes that stuck enemies are trying to break through. */
  resourceDamage: { entityId: number; damage: number }[];
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
  /** Maps building entity ID to half-extent for spatial hash lookups. */
  private buildingHalfMap = new Map<number, number>();
  /** Bridge tiles that override unwalkable terrain for pathfinding. */
  private bridgeTiles = new Set<number>();
  /**
   * Shared path cache: enemies targeting the same destination from nearby positions
   * can reuse a computed A* path instead of each computing their own.
   * Key: `${targetEntityId}_${regionX}_${regionY}` (64px grid regions)
   * Cleared each tick since buildingBlockedTiles change.
   */
  private sharedPathCache = new Map<string, { waypoints: { x: number; y: number }[]; targetX: number; targetY: number }>();
  private static readonly SHARED_PATH_REGION_SIZE = 64;
  /** Cached resource node positions for collision checks. */
  private resourcePositions: { x: number; y: number }[] = [];
  /** Spatial hash for resource node O(1) range queries (avoids iterating all 1500+ nodes). */
  private resourceHash: SpatialHash = createSpatialHash(128);
  /** Cached portal positions for collision checks. */
  private portalPositions: { x: number; y: number }[] = [];
  /** Spatial hash for portal O(1) range queries. */
  private portalHash: SpatialHash = createSpatialHash(128);
  /** Stuck detection: tracks last-known positions and time since last significant move. */
  private stuckTimers = new Map<number, { x: number; y: number; timer: number }>();

  // -- Spatial hashes for O(1) neighbor queries (rebuilt each tick) --
  /** All player entities (for enemy targeting). */
  private playerHash: SpatialHash = createSpatialHash(256);
  /** All enemy entities (for guard targeting). */
  private enemyHash: SpatialHash = createSpatialHash(256);
  /** All building entities by type (for enemy building targeting). */
  private buildingHash: SpatialHash = createSpatialHash(256);

  /** Base pathfinding budget per tick (adjusted dynamically based on tick time). */
  private static readonly BASE_PATHFINDS_PER_TICK = 15;
  /** Counter for A* calls this tick. */
  private pathfindsThisTick = 0;
  /** Dynamic pathfinding budget for this tick (adjusted by last tick performance). */
  private pathfindBudget = 15;
  /** Last tick duration in ms (used for dynamic budget). */
  private lastTickMs = 0;
  /** Distance threshold for LOD AI (enemies farther than this use simplified AI). */
  private static readonly LOD_DISTANCE = 500;
  /** Reduced replan interval for distant enemies (seconds). */
  private static readonly LOD_REPLAN_INTERVAL = 1.5;
  /** Tick counter for periodic debug logging. */
  private tickCount = 0;
  /** Rolling perf stats for debug logging. */
  private perfStats = { setupMs: 0, aiMs: 0, enemyCount: 0, resourceCount: 0, pathfinds: 0 };

  constructor(
    private readonly combat: CombatSystem,
    private readonly generator: WorldGenerator,
  ) {}

  update(world: World, dt: number): EnemyAttackResult {
    const result: EnemyAttackResult = { hits: [], deaths: [], attackPerformed: [], rangedAttacks: [], resourceDamage: [] };
    const playerIds = world.query(C.Position, C.PlayerIndex);

    const _setupStart = performance.now();

    // -- Rebuild spatial hashes + categorize entities in a single pass --
    // Combines 3 separate world.query() calls into 1 (saves ~3000 lookups with 1500 entities)
    this.playerHash.clear();
    this.enemyHash.clear();
    this.buildingHash.clear();
    this.pathfindsThisTick = 0;
    this.sharedPathCache.clear();
    // Dynamic pathfinding budget based on last tick performance
    if (this.lastTickMs < 20) this.pathfindBudget = 30;
    else if (this.lastTickMs < 50) this.pathfindBudget = EnemySystem.BASE_PATHFINDS_PER_TICK;
    else this.pathfindBudget = 5; // degraded mode

    const campfireIds: number[] = [];
    const wallIds: number[] = [];
    const otherBuildingIds: number[] = [];

    // Populate player hash
    for (const pid of playerIds) {
      if (world.hasComponent(pid, C.Downed)) continue;
      const ppos = world.getComponent<PositionComponent>(pid, C.Position)!;
      this.playerHash.insert(pid, ppos.x, ppos.y);
    }

    // Single pass: populate enemy hash + categorize buildings
    for (const eid of world.query(C.Position, C.Faction)) {
      const ef = world.getComponent<FactionComponent>(eid, C.Faction)!;
      if (ef.type === 'enemy') {
        if (!world.hasComponent(eid, C.Downed)) {
          const epos = world.getComponent<PositionComponent>(eid, C.Position)!;
          this.enemyHash.insert(eid, epos.x, epos.y);
        }
      } else if (ef.type === 'building') {
        const bldg = world.getComponent<BuildingComponent>(eid, C.Building);
        if (!bldg) continue;
        if (bldg.buildingType === 'bridge' || bldg.buildingType === 'spike_trap') continue;
        if (bldg.buildingType === 'campfire') campfireIds.push(eid);
        else if (bldg.buildingType === 'wall') wallIds.push(eid);
        else otherBuildingIds.push(eid);
        const bpos = world.getComponent<PositionComponent>(eid, C.Position)!;
        this.buildingHash.insert(eid, bpos.x, bpos.y);
      }
    }

    // Compute building-blocked tiles for pathfinding (so enemies navigate around buildings)
    this.buildingBlockedTiles.clear();
    this.buildingTilesMap.clear();
    this.buildingEntities = [];
    this.buildingHalfMap.clear();
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
      this.buildingHalfMap.set(bid, half);
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

    // Cache resource/portal/POI positions for collision checks and pathfinding.
    // Resources and portals block pathfinding tiles so enemies path around them.
    // Only resources within a limited radius of the campfire/players are added to
    // the pathfinding blocked set to prevent A* explosion with 1600+ resources.
    this.resourcePositions.length = 0;
    this.resourceHash.clear();
    this.portalPositions.length = 0;
    this.portalHash.clear();

    // Compute pathfinding relevance center (player centroid)
    let pfCenterX = 0, pfCenterY = 0, pfCenterCount = 0;
    for (const pid of playerIds) {
      const pp = world.getComponent<PositionComponent>(pid, C.Position);
      if (pp) { pfCenterX += pp.x; pfCenterY += pp.y; pfCenterCount++; }
    }
    if (pfCenterCount > 0) { pfCenterX /= pfCenterCount; pfCenterY /= pfCenterCount; }
    // Only block resources within this radius for pathfinding (keeps A* search area bounded)
    const PF_RESOURCE_RADIUS = 800; // ~25 tiles - covers the active combat zone
    const pfR2 = PF_RESOURCE_RADIUS * PF_RESOURCE_RADIUS;

    for (const rid of world.query(C.Position, C.Faction)) {
      const rf = world.getComponent<FactionComponent>(rid, C.Faction)!;
      if (rf.type === 'resource') {
        const rpos = world.getComponent<PositionComponent>(rid, C.Position)!;
        this.resourcePositions.push(rpos);
        this.resourceHash.insert(rid, rpos.x, rpos.y);
        // Only add nearby resources to pathfinding blocked tiles
        const rdx = rpos.x - pfCenterX, rdy = rpos.y - pfCenterY;
        if (rdx * rdx + rdy * rdy < pfR2) {
          const rHalf = RESOURCE_NODE_RADIUS + ENEMY_RADIUS;
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
      } else if (rf.type === 'portal') {
        const rpos = world.getComponent<PositionComponent>(rid, C.Position)!;
        this.portalPositions.push(rpos);
        this.portalHash.insert(rid, rpos.x, rpos.y);
        const rHalf = PORTAL_RADIUS + ENEMY_RADIUS;
        const rMinTx = Math.floor((rpos.x - rHalf) / TILE_SIZE);
        const rMaxTx = Math.floor((rpos.x + rHalf - 1) / TILE_SIZE);
        const rMinTy = Math.floor((rpos.y - rHalf) / TILE_SIZE);
        const rMaxTy = Math.floor((rpos.y + rHalf - 1) / TILE_SIZE);
        for (let tx = rMinTx; tx <= rMaxTx; tx++) {
          for (let ty = rMinTy; ty <= rMaxTy; ty++) {
            this.buildingBlockedTiles.add(tileKey(tx, ty));
          }
        }
      } else if (rf.type === 'poi') {
        const rpos = world.getComponent<PositionComponent>(rid, C.Position)!;
        this.resourceHash.insert(rid, rpos.x, rpos.y);
      }
    }

    // Clean stale paths and stuck timers for entities that no longer exist
    for (const id of this.paths.keys()) {
      if (!world.hasEntity(id)) this.paths.delete(id);
    }
    for (const id of this.stuckTimers.keys()) {
      if (!world.hasEntity(id)) this.stuckTimers.delete(id);
    }

    const _aiStart = performance.now();
    let _enemyCount = 0;
    // Pre-cache all building IDs for giant/titan targeting (avoid per-entity array spread)
    const allBuildingIdsCache = [...campfireIds, ...wallIds, ...otherBuildingIds];

    for (const id of world.query(C.Position, C.Faction, C.PlayerInput)) {
      const faction = world.getComponent<FactionComponent>(id, C.Faction)!;
      if (faction.type !== 'enemy' && faction.type !== 'guard') continue;
      _enemyCount++;
      const isGuard = faction.type === 'guard';

      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const inp = world.getComponent<PlayerInputComponent>(id, C.PlayerInput)!;

      // LOD check: compute distance to nearest player for AI simplification
      let nearestPlayerDist2 = Infinity;
      for (const pid of playerIds) {
        const pp = world.getComponent<PositionComponent>(pid, C.Position);
        if (!pp) continue;
        const pdx = pos.x - pp.x, pdy = pos.y - pp.y;
        const pd2 = pdx * pdx + pdy * pdy;
        if (pd2 < nearestPlayerDist2) nearestPlayerDist2 = pd2;
      }
      const isDistant = nearestPlayerDist2 > EnemySystem.LOD_DISTANCE * EnemySystem.LOD_DISTANCE;

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

      // -- Assassin Dash Tick --
      // Dashing state: count down timer, restore speed when done. Cooldown state: tick down.
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

      // Helper: find nearest player using spatial hash (O(K) instead of O(N))
      const findNearestPlayer = (maxRange: number) => {
        const nearest = this.playerHash.queryNearest(pos.x, pos.y, maxRange);
        if (!nearest) return null;
        const ppos = world.getComponent<PositionComponent>(nearest.id, C.Position);
        if (!ppos) return null;
        const ddx = ppos.x - pos.x, ddy = ppos.y - pos.y;
        return { pos: ppos, dist: distance(ddx, ddy) };
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

      // Helper: find nearest hostile enemy using spatial hash (guards only)
      const findNearestHostileEnemy = (maxRange: number): { pos: PositionComponent; dist: number } | null => {
        if (!isGuard) return null;
        // Use enemy hash for O(K) lookup instead of O(N) world query
        let best: { pos: PositionComponent; dist: number } | null = null;
        let bestD2 = maxRange * maxRange;
        this.enemyHash.queryRange(pos.x, pos.y, maxRange, (entry, dSq) => {
          if (entry.id === id) return;
          // Guards can't see hidden ghosts
          const egs = world.getComponent<GhostStateComponent>(entry.id, C.GhostState);
          if (egs?.hidden) return;
          if (dSq < bestD2) {
            bestD2 = dSq;
            const epos = world.getComponent<PositionComponent>(entry.id, C.Position);
            if (epos) best = { pos: epos, dist: Math.sqrt(dSq) };
          }
        });
        return best;
      };

      // -- Guard AI --
      // Priority: attack nearest enemy > follow owner (wolves) > patrol near barracks
      if (isGuard) {
        const guard = world.getComponent<GuardComponent>(id, C.Guard);

        // Wolf lifetime tick - destroy when expired
        if (guard?.lifetime != null && guard.lifetime > 0) {
          guard.lifetime -= dt;
          if (guard.lifetime <= 0) {
            const hp = world.getComponent<HealthComponent>(id, C.Health);
            if (hp) hp.current = 0; // Will be cleaned up by death sweep
            continue;
          }
        }

        const hostileEnemy = findNearestHostileEnemy(GUARD_DETECT_RANGE);
        if (hostileEnemy) {
          targetPos = hostileEnemy.pos;
          navPos = hostileEnemy.pos;
          targetDist = hostileEnemy.dist;
        } else if (guard) {
          // Determine patrol center: follow player or return to barracks
          let centerPos: PositionComponent | undefined;
          if (guard.followEntityId != null) {
            centerPos = world.getComponent<PositionComponent>(guard.followEntityId, C.Position);
          }
          if (!centerPos) {
            centerPos = world.getComponent<PositionComponent>(guard.barracksId, C.Position);
          }
          if (centerPos) {
            const dx = centerPos.x - pos.x, dy = centerPos.y - pos.y;
            const dist = distance(dx, dy);
            if (dist > guard.patrolRadius) {
              targetPos = centerPos;
              navPos = centerPos;
              targetDist = dist;
            }
          }
        }
      }
      // -- Variant-Specific Targeting (enemies only) --
      else if (variant === 'ghost') {
        // Ghosts: only target players, phase through everything (no pathfinding)
        const nearest = findNearestPlayer(1500);
        if (nearest) {
          targetPos = nearest.pos;
          navPos = nearest.pos;
          targetDist = nearest.dist;
          directBeeline = true;
        }
      } else if (variant === 'assassin') {
        // Assassins: only target players (use pathfinding, not beeline)
        const nearest = findNearestPlayer(1500);
        if (nearest) {
          targetPos = nearest.pos;
          navPos = nearest.pos;
          targetDist = nearest.dist;
        }
      } else if (variant === 'giant') {
        // Giants: target nearest building (any type), skip player distraction entirely
        const nearest = tryBuildings(allBuildingIdsCache, Infinity);
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
          const nearest = tryBuildings(allBuildingIdsCache, Infinity);
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
        const aggroMode = stats?.aggroMode ?? 'campfire';

        if (aggroMode === 'campfire') {
          // Portal enemies: campfire > players > walls > other buildings
          // 1. Campfire (always the global objective - no range limit)
          const campfire = tryBuildings(campfireIds, Infinity);
          if (campfire) {
            targetPos = campfire.pos;
            navPos = campfire.nav;
            targetDist = campfire.dist;
            targetHalfExtent = campfire.half;
            targetEntityId = campfire.id;
          }

          // 2. Nearby players override campfire
          const PLAYER_DISTRACT_RANGE = rangedRange > 0 ? rangedRange : ENEMY_MELEE_RANGE * 2;
          const closestPlayer = findNearestPlayer(ENEMY_AGGRO_RANGE);
          if (closestPlayer && (closestPlayer.dist < PLAYER_DISTRACT_RANGE || !targetPos)) {
            if (!targetPos || (isDistant ? true : this.isDirectPathClear(pos.x, pos.y, closestPlayer.pos.x, closestPlayer.pos.y, eRadius))) {
              targetPos = closestPlayer.pos;
              navPos = closestPlayer.pos;
              targetDist = closestPlayer.dist;
              targetHalfExtent = 0;
              targetEntityId = null;
            }
          }
        } else {
          // Proximity enemies (POI nests, boss summons): only engage targets within aggro range
          // 1. Nearest player in range
          const closestPlayer = findNearestPlayer(ENEMY_AGGRO_RANGE);
          if (closestPlayer) {
            targetPos = closestPlayer.pos;
            navPos = closestPlayer.pos;
            targetDist = closestPlayer.dist;
            targetHalfExtent = 0;
            targetEntityId = null;
          }
          // 2. Nearest building in range (if no player found)
          if (!targetPos) {
            const nearBldg = tryBuildings(allBuildingIdsCache, ENEMY_AGGRO_RANGE);
            if (nearBldg) {
              targetPos = nearBldg.pos; navPos = nearBldg.nav; targetDist = nearBldg.dist;
              targetHalfExtent = nearBldg.half; targetEntityId = nearBldg.id;
            }
          }
        }

        // 3. Walls (only if nothing else found - campfire mode only)
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
          // -- Movement Toward Target (pathfinding + obstacle avoidance) --
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

            this.navigateToward(id, pos, navPos as PositionComponent, inp, dt, len, ddx, ddy, eRadius, isDistant);

            // Local obstacle avoidance: skip for distant enemies (LOD optimization)
            if (!isDistant) {
              this.applyObstacleAvoidance(pos, inp, navPos as { x: number; y: number }, eRadius);
            }

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
                // If stuck for 2+ seconds, try to break nearby resource nodes blocking the path
                if (stuck.timer > 2.0) {
                  const blockingResource = this.resourceHash.queryNearest(pos.x, pos.y, RESOURCE_NODE_RADIUS + ENEMY_RADIUS + 8);
                  if (blockingResource) {
                    result.resourceDamage.push({ entityId: blockingResource.id, damage: GATHERING_DAMAGE });
                  }
                }

                // Find nearest obstacle to push away from (resources, portals, and buildings)
                let nearOX = 0, nearOY = 0, nearOD = Infinity;
                let hasNear = false;
                // Use spatial hash for nearby resources (not all 1500+)
                const nearestResource = this.resourceHash.queryNearest(pos.x, pos.y, 200);
                if (nearestResource) {
                  const ox = nearestResource.x - pos.x, oy = nearestResource.y - pos.y;
                  const od = ox * ox + oy * oy;
                  if (od < nearOD) { nearOD = od; nearOX = ox; nearOY = oy; hasNear = true; }
                }
                const nearestPortal = this.portalHash.queryNearest(pos.x, pos.y, 200);
                if (nearestPortal) {
                  const ox = nearestPortal.x - pos.x, oy = nearestPortal.y - pos.y;
                  const od = ox * ox + oy * oy;
                  if (od < nearOD) { nearOD = od; nearOX = ox; nearOY = oy; hasNear = true; }
                }
                const nearestBuilding = this.buildingHash.queryNearest(pos.x, pos.y, 200);
                if (nearestBuilding) {
                  const ox = nearestBuilding.x - pos.x, oy = nearestBuilding.y - pos.y;
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

    // -- Titan Rally Mechanic --
    // At 50% HP, titans activate a speed aura that buffs all nearby non-titan enemies.
    this.tickTitanRally(world);

    // -- Debug perf logging (every 300 ticks / 10s) --
    const _aiEnd = performance.now();
    const a = 0.1;
    this.perfStats.setupMs = this.perfStats.setupMs * (1 - a) + (_aiStart - _setupStart) * a;
    this.perfStats.aiMs = this.perfStats.aiMs * (1 - a) + (_aiEnd - _aiStart) * a;
    this.perfStats.enemyCount = _enemyCount;
    this.perfStats.resourceCount = this.resourcePositions.length;
    this.perfStats.pathfinds = this.pathfindsThisTick;
    this.tickCount++;
    // Track tick time for dynamic pathfinding budget
    this.lastTickMs = _aiEnd - _setupStart;

    if (this.tickCount % 300 === 0 || this.lastTickMs > 500) {
      console.log(`[EnemySystem] setup=${((_aiStart - _setupStart)).toFixed(1)}ms ai=${((_aiEnd - _aiStart)).toFixed(1)}ms enemies=${_enemyCount} resources=${this.resourcePositions.length} pathfinds=${this.pathfindsThisTick} budget=${this.pathfindBudget} total=${this.lastTickMs.toFixed(1)}ms`);
    }

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
    isDistant = false,
  ): boolean {
    // If direct line is clear (tiles + buildings), chase directly
    // Distant enemies skip this expensive check (LOD optimization)
    if (!isDistant && this.isDirectPathClear(pos.x, pos.y, target.x, target.y, enemyRadius)) {
      inp.dx = directLen > 0 ? directDx / directLen : 0;
      inp.dy = directLen > 0 ? directDy / directLen : 0;
      this.paths.delete(id);
      return true;
    }

    // Use cached path or compute a new one (distant enemies replan less frequently)
    const replanInterval = isDistant ? EnemySystem.LOD_REPLAN_INTERVAL : ENEMY_REPLAN_INTERVAL;
    const path = this.getOrComputePath(id, pos, target, dt, enemyRadius, replanInterval);

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

  // Reuses cached A* path if target hasn't moved much. Replans when age exceeds
  // ENEMY_REPLAN_INTERVAL or target moved beyond ENEMY_REPLAN_DIST_THRESHOLD.
  // Large enemies inflate blocked tiles to avoid squeezing through narrow gaps.
  private getOrComputePath(
    enemyId: number,
    pos: PositionComponent,
    target: PositionComponent,
    dt: number,
    enemyRadius = ENEMY_RADIUS,
    replanInterval = ENEMY_REPLAN_INTERVAL,
  ): CachedPath | null {
    const existing = this.paths.get(enemyId);

    if (existing) {
      existing.age += dt;

      // Check if replan is needed (distant enemies replan less frequently)
      const tdx = target.x - existing.targetX;
      const tdy = target.y - existing.targetY;
      if (existing.age < replanInterval && (tdx * tdx + tdy * tdy) < ENEMY_REPLAN_DIST_THRESHOLD * ENEMY_REPLAN_DIST_THRESHOLD) {
        return existing;
      }
    }

    // Throttle A* calls to prevent frame spikes
    if (this.pathfindsThisTick >= this.pathfindBudget) {
      // Over budget - reuse existing path or beeline
      if (existing) return existing;
      return null;
    }

    // Check shared path cache: nearby enemies targeting the same destination can reuse paths
    const regionSize = EnemySystem.SHARED_PATH_REGION_SIZE;
    const regionX = Math.floor(pos.x / regionSize);
    const regionY = Math.floor(pos.y / regionSize);
    const targetRegionKey = `${Math.floor(target.x / regionSize)}_${Math.floor(target.y / regionSize)}_${regionX}_${regionY}`;
    const shared = this.sharedPathCache.get(targetRegionKey);
    if (shared && shared.waypoints.length > 0) {
      // Reuse shared path (don't consume pathfinding budget)
      const cached: CachedPath = {
        waypoints: shared.waypoints,
        nextIndex: 0,
        age: 0,
        targetX: shared.targetX,
        targetY: shared.targetY,
      };
      this.paths.set(enemyId, cached);
      return cached;
    }

    this.pathfindsThisTick++;

    // Compute new path (with building-blocked tiles)
    // Inflate blocked tiles for large enemies so they don't try to squeeze through narrow gaps
    const inflation = enemyRadius > TILE_SIZE * 0.5 ? 1 : 0;
    const waypoints = findPath(this.generator, pos.x, pos.y, target.x, target.y, this.buildingBlockedTiles, this.bridgeTiles, inflation);
    if (!waypoints || waypoints.length === 0) {
      this.paths.delete(enemyId);
      return null;
    }

    // Store in shared cache so nearby enemies can reuse this path
    this.sharedPathCache.set(targetRegionKey, { waypoints: [...waypoints], targetX: target.x, targetY: target.y });

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

    // Pre-query resources and portals along the path using spatial hash
    // Use the bounding box of the path + radius to get candidates once
    const minX = Math.min(sx, ex) - r - RESOURCE_NODE_RADIUS;
    const maxX = Math.max(sx, ex) + r + RESOURCE_NODE_RADIUS;
    const minY = Math.min(sy, ey) - r - RESOURCE_NODE_RADIUS;
    const maxY = Math.max(sy, ey) + r + RESOURCE_NODE_RADIUS;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const queryRadius = distance(maxX - cx, maxY - cy);

    // Collect nearby resources and portals once (O(K) where K is nearby, not all 1500+)
    const nearbyResources = this.resourceHash.queryAll(cx, cy, queryRadius);
    const nearbyPortals = this.portalHash.queryAll(cx, cy, queryRadius);

    for (let i = 0; i <= steps; i++) {
      const t = steps > 0 ? i / steps : 0;
      const wx = sx + dx * t;
      const wy = sy + dy * t;

      // Check 4 corners (like overlapsAny tile check) to catch obstacles at edges
      if (this.tileOrBlockedAt(wx - r, wy - r)) return false;
      if (this.tileOrBlockedAt(wx + r, wy - r)) return false;
      if (this.tileOrBlockedAt(wx - r, wy + r)) return false;
      if (this.tileOrBlockedAt(wx + r, wy + r)) return false;

      // Check only nearby entity collision volumes (not all resources/portals)
      for (const node of nearbyResources) {
        if (circleAABBOverlap(wx, wy, r, node.x, node.y, RESOURCE_NODE_RADIUS)) return false;
      }
      for (const portal of nearbyPortals) {
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
    // Use spatial hash for O(K) lookup instead of iterating all buildings
    const searchRange = range + 48; // 48 = max building half-extent
    this.buildingHash.queryRange(pos.x, pos.y, searchRange, (entry) => {
      const half = this.buildingHalfMap.get(entry.id) ?? 16;
      const edx = Math.max(0, Math.abs(entry.x - pos.x) - half);
      const edy = Math.max(0, Math.abs(entry.y - pos.y) - half);
      const edgeDist = distance(edx, edy);
      if (edgeDist <= range && (!closest || edgeDist < closest.dist)) {
        closest = { x: entry.x, y: entry.y, dist: edgeDist };
      }
    });
    return closest;
  }

  // -- Obstacle Avoidance --
  // Accumulates perpendicular push forces from ALL nearby obstacles (resources, portals,
  // buildings). Picks the direction toward the target to steer around rather than into.
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

    // Scan nearby resources (spatial hash query instead of iterating all 1500+)
    const avoidRange = ENEMY_AVOIDANCE_LOOK_AHEAD + enemyRadius + RESOURCE_NODE_RADIUS + ENEMY_AVOIDANCE_MARGIN;
    this.resourceHash.queryRange(pos.x, pos.y, avoidRange, (entry) => {
      addObstacle(entry.x - pos.x, entry.y - pos.y, RESOURCE_NODE_RADIUS);
    });

    // Scan nearby portals
    const portalAvoidRange = ENEMY_AVOIDANCE_LOOK_AHEAD + enemyRadius + PORTAL_RADIUS + ENEMY_AVOIDANCE_MARGIN;
    this.portalHash.queryRange(pos.x, pos.y, portalAvoidRange, (entry) => {
      addObstacle(entry.x - pos.x, entry.y - pos.y, PORTAL_RADIUS);
    });

    // Scan nearby buildings (spatial hash query instead of iterating all 200+)
    const bldgAvoidRange = ENEMY_AVOIDANCE_LOOK_AHEAD + enemyRadius + 48 + ENEMY_AVOIDANCE_MARGIN; // 48 = max building half-extent
    this.buildingHash.queryRange(pos.x, pos.y, bldgAvoidRange, (entry) => {
      const half = this.buildingHalfMap.get(entry.id) ?? 16;
      addObstacle(entry.x - pos.x, entry.y - pos.y, half);
    });

    if (totalPushX === 0 && totalPushY === 0) return;

    inp.dx += totalPushX * ENEMY_AVOIDANCE_STRENGTH;
    inp.dy += totalPushY * ENEMY_AVOIDANCE_STRENGTH;
    const len = Math.sqrt(inp.dx * inp.dx + inp.dy * inp.dy);
    if (len > 0) { inp.dx /= len; inp.dy /= len; }
  }
}
