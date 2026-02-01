import { Container, Graphics, Text } from 'pixi.js';
import type { World } from '@shared/ecs/World';
import { C, HealthComponent, StaminaComponent, PositionComponent } from '@shared/components';

const BAR_W   = 160;
const BAR_H   = 12;
const BAR_GAP = 6;
const PAD     = 14;

/**
 * In-game HUD rendered in Pixi.js (screen space, not affected by the world camera).
 *
 * Phase 2: shows P1's health bar, stamina bar, and world-pixel coordinates.
 * Phase 3+: expand to show all 4 player bars.
 */
export class HUD {
  private container: Container;
  private healthGfx:  Graphics;
  private staminaGfx: Graphics;
  private coordsText: Text;

  constructor(stage: Container) {
    this.container  = new Container();
    this.healthGfx  = new Graphics();
    this.staminaGfx = new Graphics();

    this.coordsText = new Text({
      text: '',
      style: {
        fontSize: 11,
        fill: 0xaabbcc,
        fontFamily: 'monospace',
      },
    });

    this.container.addChild(this.healthGfx);
    this.container.addChild(this.staminaGfx);
    this.container.addChild(this.coordsText);
    stage.addChild(this.container);
  }

  update(world: World, screenW: number, screenH: number): void {
    const players = world.query(C.Health, C.Stamina, C.Position);
    if (players.length === 0) return;

    // Phase 2: display P1's stats (bottom-left corner)
    const id  = players[0];
    const hp  = world.getComponent<HealthComponent>(id, C.Health)!;
    const st  = world.getComponent<StaminaComponent>(id, C.Stamina)!;
    const pos = world.getComponent<PositionComponent>(id, C.Position)!;

    const x  = PAD;
    const hy = screenH - PAD - BAR_H * 2 - BAR_GAP - 16;
    const sy = hy + BAR_H + BAR_GAP;

    // ── Health bar ─────────────────────────────────────────────────────────────
    this.healthGfx.clear();
    // Background track
    this.healthGfx.rect(x, hy, BAR_W, BAR_H);
    this.healthGfx.fill({ color: 0x3a0a0a });
    // Fill (proportional to current HP)
    const hFill = Math.max(0, (hp.current / hp.max) * BAR_W);
    this.healthGfx.rect(x, hy, hFill, BAR_H);
    this.healthGfx.fill({ color: 0xd94040 });
    // Outline
    this.healthGfx.rect(x, hy, BAR_W, BAR_H);
    this.healthGfx.stroke({ color: 0xffffff, alpha: 0.25, width: 1 });

    // ── Stamina bar ────────────────────────────────────────────────────────────
    this.staminaGfx.clear();
    this.staminaGfx.rect(x, sy, BAR_W, BAR_H);
    this.staminaGfx.fill({ color: 0x071a30 });
    const sFill = Math.max(0, (st.current / st.max) * BAR_W);
    this.staminaGfx.rect(x, sy, sFill, BAR_H);
    this.staminaGfx.fill({ color: 0x3a80cc });
    this.staminaGfx.rect(x, sy, BAR_W, BAR_H);
    this.staminaGfx.stroke({ color: 0xffffff, alpha: 0.25, width: 1 });

    // ── Coordinates ────────────────────────────────────────────────────────────
    this.coordsText.position.set(x, sy + BAR_H + 4);
    this.coordsText.text = `${Math.round(pos.x)}, ${Math.round(pos.y)}`;
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }
}
