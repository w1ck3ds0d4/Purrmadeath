import { CHUNK_SIZE, TILE_SIZE, VIEW_RADIUS_CHUNKS } from '@shared/constants';
import { Chunk } from '@shared/world/Chunk';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import { TileId } from '@shared/world/TileRegistry';
import type { ChunkCoord } from '@shared/types';

/**
 * ChunkManager is the client-side chunk cache and load/unload controller.
 *
 * Phase 1: generates chunks locally using WorldGenerator.
 * Phase 3: will request chunks from the server and merge received data here.
 *          Local generation stays as a fallback for chunk-ahead prefetching.
 */
export class ChunkManager {
  private cache = new Map<string, Chunk>();

  constructor(private readonly generator: WorldGenerator) {}

  // ── Chunk access ────────────────────────────────────────────────────────────

  /** Return a cached chunk or generate it synchronously. */
  getOrGenerate(cx: number, cy: number): Chunk {
    const key = chunkKey(cx, cy);
    if (!this.cache.has(key)) {
      this.cache.set(key, this.generator.generateChunk(cx, cy));
    }
    return this.cache.get(key)!;
  }

  /** True if the chunk is already in the cache. */
  has(cx: number, cy: number): boolean {
    return this.cache.has(chunkKey(cx, cy));
  }

  /**
   * Returns the tile ID at world tile coordinates (tx, ty).
   * Loads the chunk on demand - needed for collision queries near unloaded chunk edges.
   */
  getTile(tx: number, ty: number): TileId {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    const chunk = this.getOrGenerate(cx, cy);
    // Handle negative tile coords: JS % can produce negative values
    const ltx = ((tx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lty = ((ty % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.getTile(ltx, lty) as TileId;
  }

  // ── Visibility ──────────────────────────────────────────────────────────────

  /**
   * Returns all chunk coordinates that fall within the visible screen rect.
   *
   * @param worldX   Camera center X in world pixels.
   * @param worldY   Camera center Y in world pixels.
   * @param screenW  Screen width in CSS pixels.
   * @param screenH  Screen height in CSS pixels.
   * @param zoom     Current zoom level (world pixels per screen pixel inverse).
   */
  getVisibleCoords(
    worldX: number,
    worldY: number,
    screenW: number,
    screenH: number,
    zoom: number,
  ): ChunkCoord[] {
    const chunkPixels = CHUNK_SIZE * TILE_SIZE;
    // Half of the visible world rect in world pixels
    const halfW = screenW / zoom / 2;
    const halfH = screenH / zoom / 2;

    const minCx = Math.floor((worldX - halfW) / chunkPixels) - 1;
    const maxCx = Math.ceil((worldX + halfW) / chunkPixels) + 1;
    const minCy = Math.floor((worldY - halfH) / chunkPixels) - 1;
    const maxCy = Math.ceil((worldY + halfH) / chunkPixels) + 1;

    const coords: ChunkCoord[] = [];
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        coords.push({ cx, cy });
      }
    }
    return coords;
  }

  // ── Eviction ────────────────────────────────────────────────────────────────

  /**
   * Remove chunks that are too far from the camera.
   * Returns the coordinates of evicted chunks so the renderer can clean up.
   *
   * The eviction radius is larger than VIEW_RADIUS_CHUNKS to provide a buffer
   * that prevents constant load/unload churn at the edges.
   */
  evictDistant(worldX: number, worldY: number): ChunkCoord[] {
    const chunkPixels = CHUNK_SIZE * TILE_SIZE;
    const centerCx = Math.floor(worldX / chunkPixels);
    const centerCy = Math.floor(worldY / chunkPixels);
    const limit = VIEW_RADIUS_CHUNKS + 3;

    const evicted: ChunkCoord[] = [];
    for (const [key, chunk] of this.cache) {
      if (
        Math.abs(chunk.cx - centerCx) > limit ||
        Math.abs(chunk.cy - centerCy) > limit
      ) {
        evicted.push({ cx: chunk.cx, cy: chunk.cy });
        this.cache.delete(key);
      }
    }
    return evicted;
  }

  get loadedCount(): number {
    return this.cache.size;
  }
}

function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}
