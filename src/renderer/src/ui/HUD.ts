import { Container, Graphics } from 'pixi.js';
import type { World } from '@shared/ecs/World';
import { C, HealthComponent, StaminaComponent } from '@shared/components';
import { HOTBAR_TOTAL_W, HOTBAR_PAD } from './WeaponHotbar';

const BAR_H       = 10;
const BAR_GAP     = 4;
const BAR_INSET   = 4;   // gap between hotbar bottom and first bar

/**
 * In-game HUD rendered in Pixi.js (screen space, not affected by the world camera).
 *
 * Shows P1's health bar and stamina bar centered below the weapon hotbar.
 * Resource counters are displayed by the separate DOM-based ResourceHUD.
 */
export class HUD {
  private container: Container;
  private healthGfx:  Graphics;
  private staminaGfx: Graphics;

  constructor(stage: Container) {
    this.container  = new Container();
    this.healthGfx  = new Graphics();
    this.staminaGfx = new Graphics();

    this.container.addChild(this.healthGfx);
    this.container.addChild(this.staminaGfx);
    stage.addChild(this.container);
  }

  update(world: World, screenW: number, screenH: number): void {
    const players = world.query(C.Health, C.Stamina);
    if (players.length === 0) return;

    const id = players[0];
    const hp = world.getComponent<HealthComponent>(id, C.Health)!;
    const st = world.getComponent<StaminaComponent>(id, C.Stamina)!;

    // Bars span the full hotbar width, centered
    const barW = HOTBAR_TOTAL_W;
    const x  = (screenW - barW) / 2;
    const hy = screenH - HOTBAR_PAD + BAR_INSET;
    const sy = hy + BAR_H + BAR_GAP;

    // ── Health bar ─────────────────────────────────────────────────────────────
    this.healthGfx.clear();
    this.healthGfx.rect(x, hy, barW, BAR_H);
    this.healthGfx.fill({ color: 0x3a0a0a });
    const hFill = Math.max(0, (hp.current / hp.max) * barW);
    this.healthGfx.rect(x, hy, hFill, BAR_H);
    this.healthGfx.fill({ color: 0xd94040 });
    this.healthGfx.rect(x, hy, barW, BAR_H);
    this.healthGfx.stroke({ color: 0xffffff, alpha: 0.25, width: 1 });

    // ── Stamina bar ────────────────────────────────────────────────────────────
    this.staminaGfx.clear();
    this.staminaGfx.rect(x, sy, barW, BAR_H);
    this.staminaGfx.fill({ color: 0x071a30 });
    const sFill = Math.max(0, (st.current / st.max) * barW);
    this.staminaGfx.rect(x, sy, sFill, BAR_H);
    this.staminaGfx.fill({ color: 0x3a80cc });
    this.staminaGfx.rect(x, sy, barW, BAR_H);
    this.staminaGfx.stroke({ color: 0xffffff, alpha: 0.25, width: 1 });
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }
}
