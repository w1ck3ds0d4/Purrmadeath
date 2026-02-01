import { Container, Graphics } from 'pixi.js';
import { CHUNK_SIZE, TILE_SIZE } from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import type { Chunk } from '@shared/world/Chunk';

/**
 * TileRenderer draws chunks as Pixi.js Graphics objects.
 *
 * Each chunk is rendered once into one Graphics node on load — tiles of the
 * same color are batched into a single fill call to minimise draw calls.
 *
 * Phase 1: flat solid colors.
 * Phase 9: swap Graphics for RenderTexture + Sprite (GPU-cached) and add tile sprites.
 */
export class TileRenderer {
  /**
   * Root container transformed by the camera every frame.
   * Entities (players, enemies) should be added directly to this container
   * so they are always drawn on top of the tile layer below.
   */
  readonly worldContainer: Container;

  /** Internal sub-container for tile Graphics. Always index 0 in worldContainer
   *  so that any entity Graphics added later are guaranteed to render on top. */
  private tilesContainer: Container;

  /** Map from chunk key → Graphics node. Used for dedup and cleanup. */
  private chunkGraphics = new Map<string, Graphics>();

  constructor(stage: Container) {
    this.worldContainer = new Container();
    // Insert at index 0 so the world is always below the HUD
    stage.addChildAt(this.worldContainer, 0);

    // Tile sub-container sits at index 0 inside worldContainer.
    // Entity Graphics added by other systems go at index 1+ and are drawn on top.
    this.tilesContainer = new Container();
    this.worldContainer.addChild(this.tilesContainer);
  }

  // ── Chunk management ─────────────────────────────────────────────────────────

  /**
   * Draw a chunk and add it to the world container.
   * Idempotent — calling this for an already-rendered chunk is a no-op.
   */
  addChunk(chunk: Chunk): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    if (this.chunkGraphics.has(key)) return;

    const g = new Graphics();
    // Position the Graphics at the chunk's world-pixel origin.
    // Tiles are drawn relative to this origin (0…CHUNK_SIZE*TILE_SIZE).
    g.position.set(
      chunk.cx * CHUNK_SIZE * TILE_SIZE,
      chunk.cy * CHUNK_SIZE * TILE_SIZE,
    );

    // Group tile positions by color so we make one fill call per unique color.
    // A typical chunk has 2–4 distinct tile types → 2–4 fill calls total.
    const colorBuckets = new Map<number, Array<{ tx: number; ty: number }>>();
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        const color = TILE_DEFS[chunk.getTile(tx, ty)].color;
        let bucket = colorBuckets.get(color);
        if (!bucket) { bucket = []; colorBuckets.set(color, bucket); }
        bucket.push({ tx, ty });
      }
    }

    for (const [color, tiles] of colorBuckets) {
      for (const { tx, ty } of tiles) {
        g.rect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
      g.fill({ color });
    }

    this.tilesContainer.addChild(g);
    this.chunkGraphics.set(key, g);
  }

  /** Destroy the Graphics for a chunk and remove it from the scene. */
  removeChunk(cx: number, cy: number): void {
    const key = chunkKey(cx, cy);
    const g = this.chunkGraphics.get(key);
    if (g) {
      g.destroy();
      this.chunkGraphics.delete(key);
    }
  }

  // ── Camera transform ─────────────────────────────────────────────────────────

  /**
   * Apply the camera transform to the world container every frame.
   * Translates and scales so (viewX, viewY) appears at the screen center.
   */
  applyCamera(
    viewX: number,
    viewY: number,
    zoom: number,
    screenW: number,
    screenH: number,
  ): void {
    this.worldContainer.scale.set(zoom);
    this.worldContainer.position.set(
      screenW / 2 - viewX * zoom,
      screenH / 2 - viewY * zoom,
    );
  }

  get loadedChunkCount(): number {
    return this.chunkGraphics.size;
  }
}

function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}
