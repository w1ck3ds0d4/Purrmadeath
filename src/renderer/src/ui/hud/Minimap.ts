import { Container, Graphics } from 'pixi.js';
import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  FactionComponent,
  PlayerIndexComponent,
  ResourceNodeComponent,
  GhostStateComponent,
} from '@shared/components';
import { PLAYER_COLORS, TILE_SIZE } from '@shared/constants';
import { TILE_DEFS } from '@shared/world/TileRegistry';
import type { LightSource } from '../../render/NightOverlay';

export const MAP_SIZE = 220;
export const MAP_PADDING = 12;

/** World pixels visible on the minimap in each direction from center. */
const MAP_RANGE = 900;

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
  civilian: 0xf5c06a,
  guard: 0x4488cc,
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
  civilian: 2,
  guard: 2,
};

/** Function that returns a tile ID for a given tile coordinate. */
export type TileGetter = (tx: number, ty: number) => number;

/**
 * Top-right minimap showing biome terrain and nearby entities as colored dots.
 *
 * Performance: biome terrain is cached in a separate Graphics object and only
 * redrawn when the camera moves more than one cell (~55 world pixels). Entity
 * dots are drawn every frame on a lightweight overlay.
 */
export class Minimap {
  private container: Container;
  /** Static background - never shifts. */
  private bgGfx: Graphics;
  /** Cached biome terrain layer - redrawn only on significant camera movement. */
  private terrainGfx: Graphics;
  /** Entity dots + border + crosshair - redrawn every frame. */
  private dotGfx: Graphics;
  private maskGfx: Graphics;
  private visible = true;
  private tileGetter: TileGetter | null = null;
  /** @deprecated Minimap fog removed - kept for API compat. */
  private darkness = 0;

  /** Last camera cell used for terrain cache invalidation. */
  private lastCellX = NaN;
  private lastCellY = NaN;
  /** Fractional offsets baked into the cached terrain geometry. */
  private bakedFracX = 0;
  private bakedFracY = 0;

  constructor(stage: Container) {
    this.container = new Container();
    this.container.zIndex = 200; // above night overlay
    this.bgGfx = new Graphics();
    this.terrainGfx = new Graphics();
    this.dotGfx = new Graphics();
    this.maskGfx = new Graphics();
    this.container.addChild(this.bgGfx);
    this.container.addChild(this.terrainGfx);
    this.container.addChild(this.dotGfx);
    this.container.addChild(this.maskGfx);
    this.bgGfx.mask = this.maskGfx;
    this.terrainGfx.mask = this.maskGfx;
    this.dotGfx.mask = this.maskGfx;
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
    lightSources?: LightSource[],
    campfirePos?: { x: number; y: number } | null,
  ): void {
    if (!this.visible) return;

    const mapX = screenW - MAP_SIZE - MAP_PADDING;
    const mapY = MAP_PADDING;
    const halfMap = MAP_SIZE / 2;

    // Sub-cell fractional offset for smooth scrolling
    const fracX = ((centerX % WORLD_PER_CELL) + WORLD_PER_CELL) % WORLD_PER_CELL / WORLD_PER_CELL * BIOME_CELL;
    const fracY = ((centerY % WORLD_PER_CELL) + WORLD_PER_CELL) % WORLD_PER_CELL / WORLD_PER_CELL * BIOME_CELL;

    // ── Terrain layer (cached, redrawn only when camera moves ≥ 1 cell) ──
    const cellX = Math.floor(centerX / WORLD_PER_CELL);
    const cellY = Math.floor(centerY / WORLD_PER_CELL);
    if (cellX !== this.lastCellX || cellY !== this.lastCellY) {
      this.lastCellX = cellX;
      this.lastCellY = cellY;
      this.bakedFracX = fracX;
      this.bakedFracY = fracY;
      this.rebuildTerrain(mapX, mapY, halfMap, centerX, centerY, fracX, fracY);
    }

    // Smooth sub-cell scrolling: shift cached terrain by delta from baked frac
    this.terrainGfx.position.set(
      -(fracX - this.bakedFracX),
      -(fracY - this.bakedFracY),
    );

    // Update clip mask
    this.maskGfx.clear();
    this.maskGfx.rect(mapX, mapY, MAP_SIZE, MAP_SIZE);
    this.maskGfx.fill({ color: 0xffffff });

    // ── Static background (doesn't shift with terrain) ──
    this.bgGfx.clear();
    this.bgGfx.rect(mapX, mapY, MAP_SIZE, MAP_SIZE);
    this.bgGfx.fill({ color: 0x0a0a14, alpha: 0.55 });

    // ── Entity dots (redrawn every frame - lightweight) ──
    this.dotGfx.clear();

    for (const id of world.query(C.Position, C.Faction)) {
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const faction = world.getComponent<FactionComponent>(id, C.Faction)!;

      if (faction.type === 'item') continue;
      // Skip hidden ghosts on minimap
      const gs = world.getComponent<GhostStateComponent>(id, C.GhostState);
      if (gs?.hidden) continue;

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
      this.dotGfx.circle(dotX, dotY, size);
      this.dotGfx.fill({ color, alpha: 0.9 });
    }

    // ── Border (drawn on dot layer, above terrain) ──
    this.dotGfx.rect(mapX, mapY, MAP_SIZE, MAP_SIZE);
    this.dotGfx.stroke({ color: 0x1a0a0e, alpha: 0.85, width: 3 });

    // ── Local player crosshair (always centered) ──
    const cx = mapX + halfMap;
    const cy = mapY + halfMap;
    this.dotGfx.moveTo(cx - 4, cy);
    this.dotGfx.lineTo(cx + 4, cy);
    this.dotGfx.moveTo(cx, cy - 4);
    this.dotGfx.lineTo(cx, cy + 4);
    this.dotGfx.stroke({ color: 0xffffff, alpha: 0.5, width: 1 });

    // ── Campfire waypoint marker ──
    if (campfirePos) {
      const rx = campfirePos.x - centerX;
      const ry = campfirePos.y - centerY;

      if (Math.abs(rx) <= MAP_RANGE && Math.abs(ry) <= MAP_RANGE) {
        // Campfire is on minimap - draw a diamond marker
        const fx = mapX + halfMap + (rx / MAP_RANGE) * halfMap;
        const fy = mapY + halfMap + (ry / MAP_RANGE) * halfMap;
        const s = 5;
        this.dotGfx.moveTo(fx, fy - s);
        this.dotGfx.lineTo(fx + s, fy);
        this.dotGfx.lineTo(fx, fy + s);
        this.dotGfx.lineTo(fx - s, fy);
        this.dotGfx.closePath();
        this.dotGfx.fill({ color: 0xff8844, alpha: 0.9 });
        this.dotGfx.stroke({ color: 0xffcc66, alpha: 0.8, width: 1 });
      } else {
        // Campfire is off minimap - draw arrow at edge pointing toward it
        const angle = Math.atan2(ry, rx);
        const edgeR = halfMap - 6;
        const ax = mapX + halfMap + Math.cos(angle) * edgeR;
        const ay = mapY + halfMap + Math.sin(angle) * edgeR;
        const arrowSize = 5;
        const tipX = ax + Math.cos(angle) * arrowSize;
        const tipY = ay + Math.sin(angle) * arrowSize;
        const lx = ax + Math.cos(angle + 2.5) * arrowSize;
        const ly = ay + Math.sin(angle + 2.5) * arrowSize;
        const rrx = ax + Math.cos(angle - 2.5) * arrowSize;
        const rry = ay + Math.sin(angle - 2.5) * arrowSize;
        this.dotGfx.moveTo(tipX, tipY);
        this.dotGfx.lineTo(lx, ly);
        this.dotGfx.lineTo(rrx, rry);
        this.dotGfx.closePath();
        this.dotGfx.fill({ color: 0xff8844, alpha: 0.8 });
      }
    }

    // Minimap fog removed - full visibility at all times
  }

  private rebuildTerrain(
    mapX: number, mapY: number, halfMap: number,
    centerX: number, centerY: number,
    fracX: number, fracY: number,
  ): void {
    this.terrainGfx.clear();
    // Reset position since we're baking fresh frac values
    this.terrainGfx.position.set(0, 0);

    if (!this.tileGetter) return;

    const cells = Math.ceil(MAP_SIZE / BIOME_CELL) + 1;
    for (let gx = 0; gx < cells; gx++) {
      for (let gy = 0; gy < cells; gy++) {
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
          this.terrainGfx.rect(
            mapX + gx * BIOME_CELL - fracX,
            mapY + gy * BIOME_CELL - fracY,
            BIOME_CELL, BIOME_CELL,
          );
          this.terrainGfx.fill({ color: def.color, alpha: 0.6 });
        }
      }
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container.visible = visible;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  /** Update the darkness level for night vision reduction. */
  setDarkness(value: number): void {
    this.darkness = Math.max(0, Math.min(1, value));
  }
}
