import { Container, Graphics } from 'pixi.js';
import { snapBuildingPosition, buildingHalfExtent } from '@shared/constants';

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

  update(worldMouseX: number, worldMouseY: number, canPlace: boolean, buildingType: string): void {
    if (!this.visible) return;

    const { x, y } = snapBuildingPosition(worldMouseX, worldMouseY, buildingType);
    this.snapX = x;
    this.snapY = y;

    const color = canPlace ? VALID_COLOR : INVALID_COLOR;
    const half = buildingHalfExtent(buildingType);

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
