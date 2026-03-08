import { Container, Graphics } from 'pixi.js';
import { snapBuildingPosition, buildingExtent, buildingExclusionExtent, ARROW_TURRET_RANGE, CANNON_TURRET_RANGE, BALLISTA_RANGE, UPGRADE_LASER_RANGE, UPGRADE_LIGHT_RANGE, UPGRADE_HEAL_RANGE, TESLA_COIL_RANGE, UPGRADE_FLAME_RANGE, CATAPULT_RANGE } from '@shared/constants';
import { POTION_SHOP_INTERACT_RANGE } from '@shared/definitions/PotionDefinitions';

const VALID_COLOR   = 0x44cc66;
const INVALID_COLOR = 0xcc4444;

/** Building type -> base range in pixels (level 1). */
const BUILDING_RANGES: Record<string, number> = {
  arrow_turret: ARROW_TURRET_RANGE,
  cannon_turret: CANNON_TURRET_RANGE,
  ballista: BALLISTA_RANGE,
  laser_tower: UPGRADE_LASER_RANGE[0],
  light_tower: UPGRADE_LIGHT_RANGE[0],
  healing_shrine: UPGRADE_HEAL_RANGE[0],
  potion_shop: POTION_SHOP_INTERACT_RANGE,
  tesla_coil: TESLA_COIL_RANGE,
  flame_tower: UPGRADE_FLAME_RANGE[0],
  catapult: CATAPULT_RANGE,
};

/** Per-type range circle color. */
const RANGE_COLORS: Record<string, number> = {
  arrow_turret: 0x44aaff,
  cannon_turret: 0x44aaff,
  ballista: 0x44aaff,
  laser_tower: 0xff4444,
  light_tower: 0xffdd44,
  healing_shrine: 0x44ff88,
  potion_shop: 0xaa66ff,
  tesla_coil: 0x66ddff,
  flame_tower: 0xff6622,
  catapult: 0xcc8844,
};

/**
 * Semi-transparent building ghost that follows the mouse in build mode.
 * Snaps to tile grid. Green if placement is valid, red if blocked.
 * Shows range circle for turret buildings.
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

  update(worldMouseX: number, worldMouseY: number, canPlace: boolean, buildingType: string, rotation: number = 0): void {
    if (!this.visible) return;

    const { x, y } = snapBuildingPosition(worldMouseX, worldMouseY, buildingType, rotation);
    this.snapX = x;
    this.snapY = y;

    const color = canPlace ? VALID_COLOR : INVALID_COLOR;
    const ext = buildingExtent(buildingType, rotation);

    this.gfx.clear();

    // Range circle for turrets, light tower, healing shrine
    const range = BUILDING_RANGES[buildingType];
    if (range) {
      const rangeColor = RANGE_COLORS[buildingType] ?? 0x44aaff;
      this.gfx.circle(this.snapX, this.snapY, range);
      this.gfx.fill({ color: rangeColor, alpha: 0.06 });
      this.gfx.circle(this.snapX, this.snapY, range);
      this.gfx.stroke({ color: rangeColor, alpha: 0.25, width: 1 });
    }

    // Building ghost
    this.gfx.rect(this.snapX - ext.hx, this.snapY - ext.hy, ext.hx * 2, ext.hy * 2);
    this.gfx.fill({ color, alpha: 0.35 });
    this.gfx.rect(this.snapX - ext.hx, this.snapY - ext.hy, ext.hx * 2, ext.hy * 2);
    this.gfx.stroke({ color, alpha: 0.7, width: 2 });

    // Exclusion zone outline (only if larger than footprint)
    const excl = buildingExclusionExtent(buildingType, rotation);
    if (excl.hx > ext.hx || excl.hy > ext.hy) {
      this.gfx.rect(this.snapX - excl.hx, this.snapY - excl.hy, excl.hx * 2, excl.hy * 2);
      this.gfx.stroke({ color: 0xffaa44, alpha: 0.4, width: 1 });
    }
  }

  destroy(): void {
    this.gfx.destroy();
  }
}
