import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { CHUNK_SIZE, TILE_SIZE } from '@shared/constants';
import { TILE_DEFS, TileId } from '@shared/world/TileRegistry';
import type { Chunk } from '@shared/world/Chunk';

/**
 * TileRenderer draws chunks as Pixi.js Graphics objects.
 *
 * Each chunk is rendered once into one Graphics node on load - tiles of the
 * same color are batched into a single fill call to minimise draw calls.
 *
 * Phase 1: flat solid colors.
 * Phase 9: swap Graphics for RenderTexture + Sprite (GPU-cached) and add tile sprites.
 */
// ── Tile texture URLs ─────────────────────────────────────────────────────────
const TILE_TEXTURE_URLS: Partial<Record<TileId, string>> = {
  [TileId.Grass]: new URL('../assets/landscape/grass.png', import.meta.url).href,
  [TileId.Mountain]:  new URL('../assets/landscape/mountain.png', import.meta.url).href,
  [TileId.Stone]:  new URL('../assets/landscape/mountain.png', import.meta.url).href,
  [TileId.ShallowWater]: new URL('../assets/landscape/water.png', import.meta.url).href,
  [TileId.Sand]: new URL('../assets/landscape/sand.png', import.meta.url).href,
};

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

  /** Map from chunk key → Container of tile sprites. */
  private chunkSprites = new Map<string, Container>();

  /** Loaded tile textures (TileId → Texture). */
  private tileTextures = new Map<TileId, Texture>();
  /** Chunks waiting for textures to load. */
  private pendingChunks: Chunk[] = [];
  private texturesLoaded = false;

  constructor(stage: Container) {
    // Load tile textures
    let remaining = Object.keys(TILE_TEXTURE_URLS).length;
    for (const [idStr, url] of Object.entries(TILE_TEXTURE_URLS)) {
      const tileId = Number(idStr) as TileId;
      const img = new Image();
      img.src = url;
      img.onload = () => {
        this.tileTextures.set(tileId, Texture.from(img));
        remaining--;
        if (remaining <= 0) {
          this.texturesLoaded = true;
          // Render any chunks that were added before textures loaded
          for (const chunk of this.pendingChunks) {
            this.addChunkSprites(chunk);
          }
          this.pendingChunks = [];
        }
      };
    }
    this.worldContainer = new Container();
    this.worldContainer.sortableChildren = true;
    // Insert at index 0 so the world is always below the HUD
    stage.addChildAt(this.worldContainer, 0);

    // Tile sub-container sits below entities/buildings in the z-order.
    this.tilesContainer = new Container();
    this.tilesContainer.sortableChildren = true;
    this.tilesContainer.zIndex = -10;
    this.worldContainer.addChild(this.tilesContainer);
  }

  // ── Chunk management ─────────────────────────────────────────────────────────

  /**
   * Draw a chunk and add it to the world container.
   * Idempotent - calling this for an already-rendered chunk is a no-op.
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
    // A typical chunk has 2-4 distinct tile types -> 2-4 fill calls total.
    // All tiles get flat color as base; textured tiles get sprites overlaid on top.
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

    g.zIndex = 0;
    this.tilesContainer.addChild(g);
    this.chunkGraphics.set(key, g);

    // Add tile sprites for textured tiles
    if (this.texturesLoaded) {
      this.addChunkSprites(chunk);
    } else {
      this.pendingChunks.push(chunk);
    }
  }

  /** Add texture sprites for a chunk (grass, cave, etc). */
  private addChunkSprites(chunk: Chunk): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    if (this.chunkSprites.has(key)) return;

    const container = new Container();
    container.zIndex = 1; // above flat color Graphics
    container.position.set(
      chunk.cx * CHUNK_SIZE * TILE_SIZE,
      chunk.cy * CHUNK_SIZE * TILE_SIZE,
    );

    let hasSprites = false;
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        const tileId = chunk.getTile(tx, ty);
        const tex = this.tileTextures.get(tileId);
        if (!tex) continue;
        const spr = new Sprite(tex);
        spr.position.set(tx * TILE_SIZE, ty * TILE_SIZE);
        spr.width = TILE_SIZE;
        spr.height = TILE_SIZE;
        container.addChild(spr);
        hasSprites = true;
      }
    }

    if (hasSprites) {
      this.tilesContainer.addChild(container);
      this.chunkSprites.set(key, container);
    }
  }

  /** Destroy the Graphics and sprites for a chunk and remove it from the scene. */
  removeChunk(cx: number, cy: number): void {
    const key = chunkKey(cx, cy);
    const g = this.chunkGraphics.get(key);
    if (g) {
      g.destroy();
      this.chunkGraphics.delete(key);
    }
    const sc = this.chunkSprites.get(key);
    if (sc) {
      sc.destroy({ children: true });
      this.chunkSprites.delete(key);
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
