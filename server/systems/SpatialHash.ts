/**
 * Spatial hash grid for fast neighbor queries.
 * Divides the world into cells of `cellSize` pixels.
 * Rebuilt each tick with all entities, then queried by range.
 */

interface SpatialEntry {
  id: number;
  x: number;
  y: number;
}

export function createSpatialHash(cellSize = 128) {
  const cells = new Map<number, SpatialEntry[]>();
  const invCell = 1 / cellSize;

  function key(cx: number, cy: number): number {
    // Pack two 16-bit signed ints into one 32-bit number
    return ((cx & 0xFFFF) << 16) | (cy & 0xFFFF);
  }

  function clear(): void {
    cells.clear();
  }

  function insert(id: number, x: number, y: number): void {
    const cx = Math.floor(x * invCell);
    const cy = Math.floor(y * invCell);
    const k = key(cx, cy);
    let bucket = cells.get(k);
    if (!bucket) {
      bucket = [];
      cells.set(k, bucket);
    }
    bucket.push({ id, x, y });
  }

  /**
   * Query all entries within `range` of (qx, qy).
   * Returns entries within the range (distance check is exact, not just cell-based).
   * Calls `callback` for each match. Stops early if callback returns true.
   */
  function queryRange(
    qx: number,
    qy: number,
    range: number,
    callback: (entry: SpatialEntry, distSq: number) => boolean | void,
  ): void {
    // Handle infinite/very large range: iterate all cells instead of computing a cell range
    // (prevents infinite loop when range is Infinity)
    if (!Number.isFinite(range) || range > 100_000) {
      for (const bucket of cells.values()) {
        for (const entry of bucket) {
          const dx = entry.x - qx;
          const dy = entry.y - qy;
          const dSq = dx * dx + dy * dy;
          if (callback(entry, dSq) === true) return;
        }
      }
      return;
    }

    const rangeSq = range * range;
    const minCx = Math.floor((qx - range) * invCell);
    const maxCx = Math.floor((qx + range) * invCell);
    const minCy = Math.floor((qy - range) * invCell);
    const maxCy = Math.floor((qy + range) * invCell);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = cells.get(key(cx, cy));
        if (!bucket) continue;
        for (const entry of bucket) {
          const dx = entry.x - qx;
          const dy = entry.y - qy;
          const dSq = dx * dx + dy * dy;
          if (dSq <= rangeSq) {
            if (callback(entry, dSq) === true) return;
          }
        }
      }
    }
  }

  /**
   * Find the nearest entry to (qx, qy) within `range`.
   */
  function queryNearest(qx: number, qy: number, range: number): SpatialEntry | null {
    let best: SpatialEntry | null = null;
    let bestDistSq = range * range + 1;
    queryRange(qx, qy, range, (entry, dSq) => {
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = entry;
      }
    });
    return best;
  }

  /**
   * Collect all entries within `range` of (qx, qy).
   */
  function queryAll(qx: number, qy: number, range: number): SpatialEntry[] {
    const results: SpatialEntry[] = [];
    queryRange(qx, qy, range, (entry) => {
      results.push(entry);
    });
    return results;
  }

  return { clear, insert, queryRange, queryNearest, queryAll };
}

export type SpatialHash = ReturnType<typeof createSpatialHash>;
