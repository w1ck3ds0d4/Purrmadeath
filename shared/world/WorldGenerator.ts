import { createNoise2D } from 'simplex-noise';
import { CHUNK_SIZE } from '@shared/constants';
import { TileId } from './TileRegistry';
import { BiomeId } from './BiomeRegistry';
import { Chunk } from './Chunk';

// ─── Seeded PRNG ──────────────────────────────────────────────────────────────
// Mulberry32 — fast, good distribution, seed-deterministic.

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── WorldGenerator ───────────────────────────────────────────────────────────

/**
 * Generates tile chunks using domain-warped, fractal simplex noise.
 *
 * ## Why it looks natural
 *
 * ### Domain warping (primary fix)
 * Before sampling elevation/moisture, the tile coordinates are offset by a
 * medium-scale warp noise. This "twists" the smooth gradients into irregular,
 * coastline-like shapes — the standard technique for organic procedural terrain.
 * Reference: Inigo Quilez, "Warping" (iquilezles.org).
 *
 * ### Fractal Brownian Motion (fBm) on elevation
 * Elevation is the sum of two octaves at different scales.
 * The coarse layer (scale 500) shapes continents; the fine layer (scale 180)
 * adds ridges and hills within those continents. Together they produce richer
 * variation than a single frequency can.
 *
 * ### Five independent noise layers
 *   elevNoise   — base elevation (two-octave fBm)
 *   moistNoise  — moisture / vegetation density
 *   detailNoise — intra-biome tile accent variation
 *   warpXNoise  — x-axis domain warp displacement
 *   warpYNoise  — y-axis domain warp displacement
 */
export class WorldGenerator {
  private readonly elevNoise:   ReturnType<typeof createNoise2D>;
  private readonly moistNoise:  ReturnType<typeof createNoise2D>;
  private readonly detailNoise: ReturnType<typeof createNoise2D>;
  // Warp layers — displace sampling coords to break up straight gradients
  private readonly warpXNoise:  ReturnType<typeof createNoise2D>;
  private readonly warpYNoise:  ReturnType<typeof createNoise2D>;

  constructor(public readonly seed: number) {
    // Large prime offsets keep all five layers uncorrelated with each other
    this.elevNoise   = createNoise2D(mulberry32(seed));
    this.moistNoise  = createNoise2D(mulberry32(seed + 9_973));
    this.detailNoise = createNoise2D(mulberry32(seed + 19_937));
    this.warpXNoise  = createNoise2D(mulberry32(seed + 31_337));
    this.warpYNoise  = createNoise2D(mulberry32(seed + 49_297));
  }

  // ── Chunk generation ────────────────────────────────────────────────────────

  generateChunk(cx: number, cy: number): Chunk {
    const chunk = new Chunk(cx, cy);
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        const wx = cx * CHUNK_SIZE + tx;
        const wy = cy * CHUNK_SIZE + ty;
        chunk.setTile(tx, ty, this.getTile(wx, wy));
      }
    }
    return chunk;
  }

  // ── Biome selection ─────────────────────────────────────────────────────────

  /**
   * Returns the biome at a world tile coordinate.
   *
   * Biome matrix (post-warp elevation × moisture):
   *
   *              | Dry m<0.35 | Medium 0.35-0.60 | Wet m>0.60
   *  ----------- | ---------- | ---------------- | ----------
   *  Ocean  <.20 | Ocean      | Ocean            | Ocean
   *  Shore  <.32 | Shore      | Shore            | Shore
   *  Plains <.55 | Desert     | Grassland        | Forest
   *  Upland <.76 | Highland   | Cave             | Cave
   *  Peak   >.76 | Mountain   | Mountain         | Mountain
   */
  getBiome(wx: number, wy: number): BiomeId {
    // ── Step 1: domain warp ─────────────────────────────────────────────────
    // Sample a medium-scale noise at the raw coords to get an offset vector.
    // Multiplying by 2-1 converts [0,1] → [-1,1] so displacement is bidirectional.
    // WARP_SCALE controls how wide the warp features are (larger = smoother twists).
    // WARP_STRENGTH controls max tile displacement (larger = more distorted borders).
    const WARP_SCALE    = 200; // tiles — medium-scale warping features
    const WARP_STRENGTH = 130; // tiles — aggressive enough to fully break linearity

    const dx = (this.sample(this.warpXNoise, wx, wy, WARP_SCALE) * 2 - 1) * WARP_STRENGTH;
    const dy = (this.sample(this.warpYNoise, wx, wy, WARP_SCALE) * 2 - 1) * WARP_STRENGTH;

    const wx2 = wx + dx;
    const wy2 = wy + dy;

    // ── Step 2: elevation (two-octave fBm) ─────────────────────────────────
    // Octave 1 (weight 0.70): coarse continent shape at scale 500 tiles.
    // Octave 2 (weight 0.30): medium ridges/hills at scale 180 tiles.
    // Weights sum to 1.0 so the result stays in [0, 1].
    const e = this.sample(this.elevNoise, wx2, wy2, 500) * 0.70
            + this.sample(this.elevNoise, wx2, wy2, 180) * 0.30;

    // ── Step 3: moisture ────────────────────────────────────────────────────
    // Single octave at a larger scale than elevation — moisture changes slowly
    // across continents, giving wide climate bands rather than rapid switching.
    const m = this.sample(this.moistNoise, wx2, wy2, 700);

    // ── Step 4: biome lookup ────────────────────────────────────────────────
    if (e < 0.20) return BiomeId.Ocean;
    if (e < 0.32) return BiomeId.Shore;
    if (e < 0.55) {
      if (m < 0.35) return BiomeId.Desert;
      if (m < 0.60) return BiomeId.Grassland;
      return BiomeId.Forest;
    }
    if (e < 0.76) {
      if (m < 0.45) return BiomeId.Highland;
      return BiomeId.Cave;
    }
    return BiomeId.Mountain;
  }

  // ── Tile selection ──────────────────────────────────────────────────────────

  getTile(wx: number, wy: number): TileId {
    const biome = this.getBiome(wx, wy);
    // Scale 80: accent patches are large organic blobs, not scattered pixel dots.
    // Thresholds at 5-7%: accents are rare landmarks, not dominant coverage.
    const d = this.sample(this.detailNoise, wx, wy, 80);

    switch (biome) {
      case BiomeId.Ocean:     return TileId.DeepWater;
      case BiomeId.Shore:     return d < 0.55 ? TileId.ShallowWater : TileId.Sand;
      case BiomeId.Desert:    return d < 0.94 ? TileId.Sand    : TileId.Stone;
      case BiomeId.Grassland: return d < 0.93 ? TileId.Grass   : TileId.Dirt;
      case BiomeId.Forest:    return d < 0.94 ? TileId.Forest  : TileId.Grass;
      case BiomeId.Highland:  return d < 0.93 ? TileId.Tundra  : TileId.Stone;
      case BiomeId.Cave:      return d < 0.94 ? TileId.Cave    : TileId.Stone;
      case BiomeId.Mountain:  return TileId.Mountain;
      default:                return TileId.Void;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Sample noise and normalize from [-1, 1] to [0, 1]. */
  private sample(
    noise: ReturnType<typeof createNoise2D>,
    wx: number,
    wy: number,
    scale: number,
  ): number {
    return (noise(wx / scale, wy / scale) + 1) / 2;
  }
}