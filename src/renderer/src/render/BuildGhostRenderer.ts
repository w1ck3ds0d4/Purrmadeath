import { Container, Graphics } from 'pixi.js';
import { TILE_SIZE, BUILDING_HALF_EXTENT } from '@shared/constants';

const VALID_COLOR   = 0x44cc66;
const INVALID_COLOR = 0xcc4444;

/**
 * Semi-transparent building ghost that follows the mouse in build mode.
 * Snaps to tile grid. Green if placement is valid, red if blocked.
 */
export class BuildGhostRenderer {
  private gfx: Graphics;
  private visible = false;

  /** Last snapped tile-center position in world coordinates. */
  snapX = 0;
  snapY = 0;

  constructor(worldContainer: Container) {
    this.gfx = new Graphics();
    this.gfx.visible = false;
    worldContainer.addChild(this.gfx);
  }

  show(): void {
    this.visible = true;
    this.gfx.visible = true;
  }

  hide(): void {
    this.visible = false;
    this.gfx.visible = false;
  }

  /**
   * Update ghost position and validity color.
   * @param worldMouseX - Mouse position in world coordinates.
   * @param worldMouseY - Mouse position in world coordinates.
   * @param canPlace - Whether the tile is a valid placement target.
   */
  update(worldMouseX: number, worldMouseY: number, canPlace: boolean): void {
    if (!this.visible) return;

    // Snap to tile center
    const tileX = Math.floor(worldMouseX / TILE_SIZE);
    const tileY = Math.floor(worldMouseY / TILE_SIZE);
    this.snapX = tileX * TILE_SIZE + TILE_SIZE / 2;
    this.snapY = tileY * TILE_SIZE + TILE_SIZE / 2;

    const color = canPlace ? VALID_COLOR : INVALID_COLOR;
    const half = BUILDING_HALF_EXTENT;

    this.gfx.clear();
    this.gfx.rect(this.snapX - half, this.snapY - half, half * 2, half * 2);
    this.gfx.fill({ color, alpha: 0.35 });
    this.gfx.rect(this.snapX - half, this.snapY - half, half * 2, half * 2);
    this.gfx.stroke({ color, alpha: 0.7, width: 2 });
  }

  destroy(): void {
    this.gfx.destroy();
  }
}
