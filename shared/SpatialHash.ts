/**
 * Spatial hash grid for O(1) proximity queries.
 *
 * Divides the world into fixed-size cells. Each entity is stored in the cell
 * that contains its position. Proximity queries only check cells within the
 * requested radius, turning O(n²) pairwise checks into O(n·k) where k is
 * the number of entities in nearby cells.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly invCellSize: number;
  /** cell key → set of entity IDs in that cell */
  private readonly cells = new Map<number, Set<number>>();
  /** entity ID → { cell key, x, y } */
  private readonly entities = new Map<number, { key: number; x: number; y: number }>();

  constructor(cellSize = 128) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
  }

  private cellKey(cx: number, cy: number): number {
    // Cantor-like pairing that handles negatives: shift to unsigned range
    const a = cx + 0x7FFF;
    const b = cy + 0x7FFF;
    return (a << 16) | (b & 0xFFFF);
  }

  private cellCoord(wx: number, wy: number): { cx: number; cy: number } {
    return {
      cx: Math.floor(wx * this.invCellSize),
      cy: Math.floor(wy * this.invCellSize),
    };
  }

  /** Insert or update an entity's position. */
  insert(entityId: number, x: number, y: number): void {
    const { cx, cy } = this.cellCoord(x, y);
    const newKey = this.cellKey(cx, cy);

    const existing = this.entities.get(entityId);
    if (existing) {
      if (existing.key === newKey) {
        // Same cell, just update position
        existing.x = x;
        existing.y = y;
        return;
      }
      // Remove from old cell
      const oldCell = this.cells.get(existing.key);
      if (oldCell) {
        oldCell.delete(entityId);
        if (oldCell.size === 0) this.cells.delete(existing.key);
      }
    }

    // Add to new cell
    let cell = this.cells.get(newKey);
    if (!cell) {
      cell = new Set();
      this.cells.set(newKey, cell);
    }
    cell.add(entityId);
    this.entities.set(entityId, { key: newKey, x, y });
  }

  /** Remove an entity from the grid. */
  remove(entityId: number): void {
    const existing = this.entities.get(entityId);
    if (!existing) return;
    const cell = this.cells.get(existing.key);
    if (cell) {
      cell.delete(entityId);
      if (cell.size === 0) this.cells.delete(existing.key);
    }
    this.entities.delete(entityId);
  }

  /** Get the stored position of an entity, or undefined if not tracked. */
  getPosition(entityId: number): { x: number; y: number } | undefined {
    return this.entities.get(entityId);
  }

  /**
   * Query all entity IDs within a radius of (x, y).
   * Returns results in the provided array (or allocates one) to reduce GC.
   */
  queryRadius(x: number, y: number, radius: number, out?: number[]): number[] {
    const result = out ?? [];
    if (out) result.length = 0;

    const r2 = radius * radius;
    const { cx: minCx, cy: minCy } = this.cellCoord(x - radius, y - radius);
    const { cx: maxCx, cy: maxCy } = this.cellCoord(x + radius, y + radius);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const cell = this.cells.get(this.cellKey(cx, cy));
        if (!cell) continue;
        for (const eid of cell) {
          const e = this.entities.get(eid)!;
          const dx = e.x - x;
          const dy = e.y - y;
          if (dx * dx + dy * dy <= r2) {
            result.push(eid);
          }
        }
      }
    }

    return result;
  }

  /** Remove all entities. */
  clear(): void {
    this.cells.clear();
    this.entities.clear();
  }
}
