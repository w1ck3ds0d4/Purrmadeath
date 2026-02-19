import { Container, Graphics } from 'pixi.js';
import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  FactionComponent,
  PlayerIndexComponent,
  ResourceNodeComponent,
} from '@shared/components';
import { PLAYER_COLORS, TILE_SIZE } from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';

export const MAP_SIZE = 220;
export const MAP_PADDING = 12;
const MAP_BORDER_ALPHA = 0.2;

/** World pixels visible on the minimap in each direction from center. */
const MAP_RANGE = 1200;

/** Biome grid cell size in minimap pixels. */
const BIOME_CELL = 5;

/** World-pixel distance that maps to one BIOME_CELL on the minimap. */
const WORLD_PER_CELL = (BIOME_CELL / (MAP_SIZE / 2)) * MAP_RANGE;

const DOT_COLORS: Record<string, number> = {
  player: 0x4a90d9,
  enemy: 0xcc3333,
  portal: 0xaa44ff,
  building: 0xe8c96a,
  resource: 0x66aa66, // fallback
};

const RESOURCE_DOT_COLORS: Record<string, number> = {
  wood:    0x8b5e3c, // brown
  stone:   0x9a9a9a, // gray
  iron:    0x7a8a9a, // blue-gray metallic
  diamond: 0x44ddee, // cyan
};

const DOT_SIZES: Record<string, number> = {
  player: 3,
  enemy: 2,
  portal: 3,
  building: 2.5,
  resource: 1.5,
};

/** Function that returns a tile ID for a given tile coordinate. */
export type TileGetter = (tx: number, ty: number) => number;

/**
 * Top-right minimap showing biome terrain and nearby entities as colored dots.
 *
 * Smooth scrolling: biome grid cells are drawn with a sub-cell pixel offset
 * derived from the camera position, so the minimap pans continuously instead
 * of jumping in BIOME_CELL-sized steps.
 */
export class Minimap {
  private container: Container;
  private gfx: Graphics;
  private maskGfx: Graphics;
  private visible = true;
  private tileGetter: TileGetter | null = null;

  constructor(stage: Container) {
    this.container = new Container();
    this.gfx = new Graphics();
    this.maskGfx = new Graphics();
    this.container.addChild(this.gfx);
    this.container.addChild(this.maskGfx);
    this.gfx.mask = this.maskGfx;
    stage.addChild(this.container);
  }

  /** Set the tile lookup function (from ChunkManager or WorldGenerator). */
  setTileGetter(getter: TileGetter): void {
    this.tileGetter = getter;
  }

  update(
    world: World,
    localEntityId: number | null,
    centerX: number,
    centerY: number,
    screenW: number,
    _screenH: number,
  ): void {
    if (!this.visible) return;

    const mapX = screenW - MAP_SIZE - MAP_PADDING;
    const mapY = MAP_PADDING;
    const halfMap = MAP_SIZE / 2;

    // Sub-cell fractional offset for smooth scrolling
    // As the camera moves within one cell's worth of world pixels,
    // shift all drawing by the fractional minimap-pixel remainder.
    const fracX = ((centerX % WORLD_PER_CELL) + WORLD_PER_CELL) % WORLD_PER_CELL / WORLD_PER_CELL * BIOME_CELL;
    const fracY = ((centerY % WORLD_PER_CELL) + WORLD_PER_CELL) % WORLD_PER_CELL / WORLD_PER_CELL * BIOME_CELL;

    this.gfx.clear();

    // Update clip mask (prevents shifted rects from overflowing the border)
    this.maskGfx.clear();
    this.maskGfx.rect(mapX, mapY, MAP_SIZE, MAP_SIZE);
    this.maskGfx.fill({ color: 0xffffff });

    // ── Background ──
    this.gfx.rect(mapX, mapY, MAP_SIZE, MAP_SIZE);
    this.gfx.fill({ color: 0x0a0a14, alpha: 0.55 });

    // ── Biome terrain grid (with sub-cell offset for smooth scrolling) ──
    if (this.tileGetter) {
      // Draw one extra cell on each edge to fill gaps from the fractional shift
      const cells = Math.ceil(MAP_SIZE / BIOME_CELL) + 1;
      for (let gx = 0; gx < cells; gx++) {
        for (let gy = 0; gy < cells; gy++) {
          // Minimap pixel at cell center (before offset)
          const mapPx = gx * BIOME_CELL + BIOME_CELL / 2 - fracX;
          const mapPy = gy * BIOME_CELL + BIOME_CELL / 2 - fracY;
          const worldOffX = ((mapPx - halfMap) / halfMap) * MAP_RANGE;
          const worldOffY = ((mapPy - halfMap) / halfMap) * MAP_RANGE;
          const wx = centerX + worldOffX;
          const wy = centerY + worldOffY;
          const tx = Math.floor(wx / TILE_SIZE);
          const ty = Math.floor(wy / TILE_SIZE);
          const tileId = this.tileGetter(tx, ty);
          const def = TILE_DEFS[tileId];
          if (def) {
            this.gfx.rect(
              mapX + gx * BIOME_CELL - fracX,
              mapY + gy * BIOME_CELL - fracY,
              BIOME_CELL, BIOME_CELL,
            );
            this.gfx.fill({ color: def.color, alpha: 0.6 });
          }
        }
      }
    }

    // ── Entity dots (exact positions, smooth) ──
    for (const id of world.query(C.Position, C.Faction)) {
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const faction = world.getComponent<FactionComponent>(id, C.Faction)!;

      if (faction.type === 'item') continue;

      const relX = pos.x - centerX;
      const relY = pos.y - centerY;

      if (Math.abs(relX) > MAP_RANGE || Math.abs(relY) > MAP_RANGE) continue;

      const dotX = mapX + halfMap + (relX / MAP_RANGE) * halfMap;
      const dotY = mapY + halfMap + (relY / MAP_RANGE) * halfMap;

      let color = DOT_COLORS[faction.type] ?? 0xcccccc;
      if (faction.type === 'player') {
        const pidx = world.getComponent<PlayerIndexComponent>(id, C.PlayerIndex);
        if (pidx) color = PLAYER_COLORS[pidx.index] ?? color;
        if (id === localEntityId) color = 0xffffff;
      } else if (faction.type === 'resource') {
        const rn = world.getComponent<ResourceNodeComponent>(id, C.ResourceNode);
        if (rn) color = RESOURCE_DOT_COLORS[rn.resourceType] ?? color;
      }

      const size = DOT_SIZES[faction.type] ?? 2;
      this.gfx.circle(dotX, dotY, size);
      this.gfx.fill({ color, alpha: 0.9 });
    }

    // ── Border (drawn on top, outside mask) ──
    this.gfx.rect(mapX, mapY, MAP_SIZE, MAP_SIZE);
    this.gfx.stroke({ color: 0x000000, alpha: 0.6, width: 2 });

    // ── Local player crosshair (always centered) ──
    const cx = mapX + halfMap;
    const cy = mapY + halfMap;
    this.gfx.moveTo(cx - 4, cy);
    this.gfx.lineTo(cx + 4, cy);
    this.gfx.moveTo(cx, cy - 4);
    this.gfx.lineTo(cx, cy + 4);
    this.gfx.stroke({ color: 0xffffff, alpha: 0.5, width: 1 });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container.visible = visible;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }
}
