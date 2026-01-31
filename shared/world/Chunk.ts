import { CHUNK_SIZE } from '@shared/constants';
import { TileId } from './TileRegistry';

/**
 * A Chunk is a CHUNK_SIZE × CHUNK_SIZE tile grid.
 *
 * Tiles are stored in a flat Uint16Array for memory efficiency and fast
 * serialization. Index formula: i = ty * CHUNK_SIZE + tx.
 *
 * The server owns the authoritative chunks; the client caches received/generated
 * chunks locally. In Phase 1, clients generate chunks themselves — in Phase 3,
 * they request chunks from the server.
 */
export class Chunk {
  static readonly SIZE = CHUNK_SIZE;

  /** Flat tile storage: index = ty * CHUNK_SIZE + tx. */
  readonly tiles: Uint16Array;

  constructor(
    /** Chunk X coordinate in chunk-space (not tile-space, not pixel-space). */
    public readonly cx: number,
    /** Chunk Y coordinate in chunk-space. */
    public readonly cy: number,
  ) {
    this.tiles = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE); // zero-filled = TileId.Void
  }

  getTile(tx: number, ty: number): TileId {
    return this.tiles[ty * CHUNK_SIZE + tx] as TileId;
  }

  setTile(tx: number, ty: number, id: TileId): void {
    this.tiles[ty * CHUNK_SIZE + tx] = id;
  }

  /** True if (tx, ty) is within this chunk's bounds. */
  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && tx < CHUNK_SIZE && ty >= 0 && ty < CHUNK_SIZE;
  }
}
