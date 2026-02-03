import { Container, Graphics, Text } from 'pixi.js';

const SLOT_SIZE = 48;
const SLOT_GAP  = 6;
const PAD       = 14;
const SLOT_COUNT = 2;

const SELECTED_BORDER = 0xe8c96a;  // gold accent (matches game title)
const UNSELECTED_BORDER = 0xffffff;
const SLOT_BG = 0x1a1a2a;
const SLOT_BG_SELECTED = 0x2a2a3a;
const COOLDOWN_OVERLAY = 0x000000;

const WEAPON_LABELS = ['Sword', 'Bow'];

/**
 * Pixi.js weapon hotbar — shows selectable weapon slots at bottom-center.
 *
 * Rendering pattern matches HUD: screen-space Container on renderer.stage,
 * redrawn every frame via update().
 */
export class WeaponHotbar {
  private container: Container;
  private gfx: Graphics;
  private keyTexts: Text[] = [];
  private labelTexts: Text[] = [];

  constructor(stage: Container) {
    this.container = new Container();
    this.gfx = new Graphics();
    this.container.addChild(this.gfx);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const keyText = new Text({
        text: `${i + 1}`,
        style: { fontSize: 11, fill: 0x8a9ab0, fontFamily: 'monospace' },
      });
      const labelText = new Text({
        text: WEAPON_LABELS[i],
        style: { fontSize: 12, fill: 0xd8e2ef, fontFamily: 'monospace' },
      });
      this.keyTexts.push(keyText);
      this.labelTexts.push(labelText);
      this.container.addChild(keyText);
      this.container.addChild(labelText);
    }

    stage.addChild(this.container);
  }

  update(
    selected: number,
    cooldown: number,
    cooldownMax: number,
    screenW: number,
    screenH: number,
  ): void {
    this.gfx.clear();

    const totalW = SLOT_COUNT * SLOT_SIZE + (SLOT_COUNT - 1) * SLOT_GAP;
    const startX = (screenW - totalW) / 2;
    const startY = screenH - PAD - SLOT_SIZE;

    for (let i = 0; i < SLOT_COUNT; i++) {
      const x = startX + i * (SLOT_SIZE + SLOT_GAP);
      const y = startY;
      const isSelected = i === selected;

      // Background
      this.gfx.rect(x, y, SLOT_SIZE, SLOT_SIZE);
      this.gfx.fill({ color: isSelected ? SLOT_BG_SELECTED : SLOT_BG, alpha: 0.85 });

      // Cooldown overlay (only on selected slot, fills from top down)
      if (isSelected && cooldown > 0 && cooldownMax > 0) {
        const ratio = cooldown / cooldownMax;
        const fillH = SLOT_SIZE * ratio;
        this.gfx.rect(x, y, SLOT_SIZE, fillH);
        this.gfx.fill({ color: COOLDOWN_OVERLAY, alpha: 0.45 });
      }

      // Border
      this.gfx.rect(x, y, SLOT_SIZE, SLOT_SIZE);
      this.gfx.stroke({
        color: isSelected ? SELECTED_BORDER : UNSELECTED_BORDER,
        alpha: isSelected ? 0.9 : 0.15,
        width: isSelected ? 2 : 1,
      });

      // Key number (top-left corner of slot)
      const kt = this.keyTexts[i];
      kt.position.set(x + 4, y + 2);
      kt.style.fill = isSelected ? SELECTED_BORDER : 0x8a9ab0;

      // Weapon label (centered in slot)
      const lt = this.labelTexts[i];
      lt.position.set(
        x + (SLOT_SIZE - lt.width) / 2,
        y + (SLOT_SIZE - lt.height) / 2 + 4,
      );
      lt.style.fill = isSelected ? 0xffffff : 0x8a9ab0;
    }
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }
}
