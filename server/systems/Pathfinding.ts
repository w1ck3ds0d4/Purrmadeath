import { WorldGenerator } from '@shared/world/WorldGenerator';
import { TILE_SIZE } from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';

/** A waypoint in world-pixel coordinates. */
export interface Waypoint {
  x: number;
  y: number;
}

/** Cached path for an enemy entity. */
export interface CachedPath {
  waypoints: Waypoint[];
  /** Index of the next waypoint to follow. */
  nextIndex: number;
  /** Time (seconds) since last replan. */
  age: number;
  /** Target position when this path was computed. */
  targetX: number;
  targetY: number;
}

/** Maximum tiles to search in any direction from the start. */
const MAX_SEARCH_TILES = 40;
/** Maximum nodes in the open set before giving up. */
const MAX_OPEN_SET = 2000;

/**
 * Tile walkability cache - avoids repeated perlin noise computation.
 * Key: tileKey(tx, ty), Value: true if walkable.
 * Cleared periodically (every 60 seconds) to handle world changes.
 */
const walkabilityCache = new Map<number, boolean>();
let walkabilityCacheAge = 0;
const WALKABILITY_CACHE_MAX_AGE = 60; // seconds

/** Increment cache age by dt. Clears cache when stale. */
export function tickWalkabilityCache(dt: number): void {
  walkabilityCacheAge += dt;
  if (walkabilityCacheAge >= WALKABILITY_CACHE_MAX_AGE) {
    walkabilityCache.clear();
    walkabilityCacheAge = 0;
  }
}

/**
 * Drop every cached walkability result. Tests use this to isolate
 * runs that swap in different mock generators - without it the
 * module-level cache stores results from the first generator and
 * every later test sees the same answer regardless of what its
 * generator returns. Not needed in production: the 60-second TTL
 * tick handles world-level invalidation.
 */
export function clearWalkabilityCache(): void {
  walkabilityCache.clear();
  walkabilityCacheAge = 0;
}

/** Get cached walkability for a tile, computing from generator if not cached. */
function getCachedWalkable(generator: WorldGenerator, tx: number, ty: number): boolean {
  const key = tileKey(tx, ty);
  let cached = walkabilityCache.get(key);
  if (cached !== undefined) return cached;
  cached = TILE_DEFS[generator.getTile(tx, ty)]?.walkable ?? false;
  walkabilityCache.set(key, cached);
  return cached;
}

// 8-directional neighbors: cardinal + diagonal
const DIRS: readonly [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const SQRT2 = Math.SQRT2;

/**
 * Pack tile coords into a single integer key for Map lookups.
 * Supports ±10000 tile range (well beyond any practical gameplay area).
 */
export function tileKey(tx: number, ty: number): number {
  return (tx + 10000) * 20001 + (ty + 10000);
}

/** Unpack tile-X from a packed key. */
function keyToTx(key: number): number {
  return Math.floor(key / 20001) - 10000;
}

/** Unpack tile-Y from a packed key. */
function keyToTy(key: number): number {
  return (key % 20001) - 10000;
}

/** Chebyshev distance - exact heuristic for 8-directional movement with diagonal cost √2. */
function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

/** Check if any tile within inflation distance is blocked (Minkowski sum for large entities). */
function isTileInflatedBlocked(tx: number, ty: number, blocked: Set<number>, inflation: number): boolean {
  for (let dx = -inflation; dx <= inflation; dx++) {
    for (let dy = -inflation; dy <= inflation; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (blocked.has(tileKey(tx + dx, ty + dy))) return true;
    }
  }
  return false;
}

/**
 * Find a path from world-pixel (sx, sy) to world-pixel (gx, gy) using A*.
 * Returns an array of world-pixel waypoints, or null if no path found.
 *
 * Uses Chebyshev distance heuristic for 8-directional movement.
 * Diagonal cost = √2, cardinal cost = 1 (in tile units).
 */
export function findPath(
  generator: WorldGenerator,
  sx: number, sy: number,
  gx: number, gy: number,
  blockedTiles?: Set<number>,
  bridgeTiles?: Set<number>,
  inflation = 0,
): Waypoint[] | null {
  const startTx = Math.floor(sx / TILE_SIZE);
  const startTy = Math.floor(sy / TILE_SIZE);
  const goalTx  = Math.floor(gx / TILE_SIZE);
  const goalTy  = Math.floor(gy / TILE_SIZE);

  /** Check if a tile is walkable (cached terrain lookup + bridge override). */
  const isWalkable = (tx: number, ty: number): boolean => {
    if (bridgeTiles?.has(tileKey(tx, ty))) return true;
    return getCachedWalkable(generator, tx, ty);
  };

  // Trivial case: same tile
  if (startTx === goalTx && startTy === goalTy) return [{ x: gx, y: gy }];

  // If goal tile is unwalkable or blocked by a building, bail (no partial paths)
  if (!isWalkable(goalTx, goalTy)) return null;
  if (blockedTiles?.has(tileKey(goalTx, goalTy))) return null;

  // Distance too large for efficient search
  if (Math.max(Math.abs(goalTx - startTx), Math.abs(goalTy - startTy)) > MAX_SEARCH_TILES) {
    return null;
  }

  // A* open/closed sets
  const gScore = new Map<number, number>();
  const fScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();

  const startKey = tileKey(startTx, startTy);
  gScore.set(startKey, 0);
  fScore.set(startKey, chebyshev(startTx, startTy, goalTx, goalTy));

  // Simple array-based open set (sufficient for MAX_SEARCH_TILES=20)
  const open: number[] = [startKey];
  const inOpen = new Set<number>([startKey]);
  const closed = new Set<number>();

  while (open.length > 0) {
    // Find node with lowest fScore
    let bestIdx = 0;
    let bestF = fScore.get(open[0])!;
    for (let i = 1; i < open.length; i++) {
      const f = fScore.get(open[i])!;
      if (f < bestF) { bestF = f; bestIdx = i; }
    }
    const currentKey = open[bestIdx];
    open.splice(bestIdx, 1);
    inOpen.delete(currentKey);

    const cx = keyToTx(currentKey);
    const cy = keyToTy(currentKey);

    if (cx === goalTx && cy === goalTy) {
      return reconstructPath(cameFrom, currentKey, gx, gy);
    }

    closed.add(currentKey);

    for (const [ddx, ddy] of DIRS) {
      const nx = cx + ddx;
      const ny = cy + ddy;
      const nKey = tileKey(nx, ny);

      if (closed.has(nKey)) continue;

      // Walkability check (tiles + building entities + bridge overrides)
      if (!isWalkable(nx, ny)) continue;
      if (blockedTiles?.has(nKey)) continue;

      // Large-entity inflation: reject tiles near blocked tiles (prevents squeezing through gaps)
      if (inflation > 0 && blockedTiles &&
          (nx !== startTx || ny !== startTy) && (nx !== goalTx || ny !== goalTy)) {
        if (isTileInflatedBlocked(nx, ny, blockedTiles, inflation)) continue;
      }

      // For diagonal moves, both adjacent cardinal tiles must be walkable
      // (prevents corner-cutting through walls)
      if (ddx !== 0 && ddy !== 0) {
        if (!isWalkable(cx + ddx, cy)) continue;
        if (!isWalkable(cx, cy + ddy)) continue;
      }

      const moveCost = (ddx !== 0 && ddy !== 0) ? SQRT2 : 1;
      const tentativeG = gScore.get(currentKey)! + moveCost;

      const existingG = gScore.get(nKey);
      if (existingG !== undefined && tentativeG >= existingG) continue;

      cameFrom.set(nKey, currentKey);
      gScore.set(nKey, tentativeG);
      fScore.set(nKey, tentativeG + chebyshev(nx, ny, goalTx, goalTy));

      if (!inOpen.has(nKey)) {
        open.push(nKey);
        inOpen.add(nKey);
        if (open.length > MAX_OPEN_SET) return null; // Search space too large
      }
    }
  }

  return null; // No path found
}

function reconstructPath(
  cameFrom: Map<number, number>,
  endKey: number,
  finalX: number,
  finalY: number,
): Waypoint[] {
  const keys: number[] = [];
  let current = endKey;
  while (cameFrom.has(current)) {
    keys.push(current);
    current = cameFrom.get(current)!;
  }
  keys.reverse();

  // Convert tile keys to world-pixel waypoints (center of each tile)
  const waypoints: Waypoint[] = keys.map((key) => ({
    x: keyToTx(key) * TILE_SIZE + TILE_SIZE / 2,
    y: keyToTy(key) * TILE_SIZE + TILE_SIZE / 2,
  }));

  // Replace last waypoint with exact target position for precision
  if (waypoints.length > 0) {
    waypoints[waypoints.length - 1] = { x: finalX, y: finalY };
  }

  return waypoints;
}
