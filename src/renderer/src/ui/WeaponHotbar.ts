import { Container, Graphics, Text } from 'pixi.js';

const SLOT_SIZE = 48;
const SLOT_GAP  = 6;
const PAD       = 40;   // room below for health + stamina bars
const SLOT_COUNT = 7;

const SELECTED_BORDER = 0xe8c96a;  // gold accent (matches game title)
const UNSELECTED_BORDER = 0xffffff;
const SLOT_BG = 0x1a1a2a;
const SLOT_BG_SELECTED = 0x2a2a3a;
const LOCKED_BG = 0x111118;
const COOLDOWN_OVERLAY = 0x000000;

// Slot labels - slots 0-1 are weapons, 2-4 abilities, 5 potion, 6 build hammer
const SLOT_LABELS = ['Sword', 'Bow', 'Skill', 'Skill', 'Skill', 'Potion', 'Build'];
const SLOT_KEYS   = ['1', '2', 'Q', 'E', 'R', '3', 'B'];
const UNLOCKED_SLOTS = new Set([0, 1, 6]); // weapon slots + build hammer

/** Total pixel width of the hotbar (exported so HUD bars can match). */
export const HOTBAR_TOTAL_W = SLOT_COUNT * SLOT_SIZE + (SLOT_COUNT - 1) * SLOT_GAP;
export const HOTBAR_PAD = PAD;

/**
 * Pixi.js weapon hotbar - shows selectable weapon slots at bottom-center.
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
      const locked = !UNLOCKED_SLOTS.has(i);
      const keyText = new Text({
        text: SLOT_KEYS[i],
        style: { fontSize: 11, fill: locked ? 0x3a3a4a : 0x8a9ab0, fontFamily: 'monospace' },
      });
      const labelText = new Text({
        text: SLOT_LABELS[i],
        style: { fontSize: 12, fill: locked ? 0x3a3a4a : 0xd8e2ef, fontFamily: 'monospace' },
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
    buildModeActive = false,
  ): void {
    this.gfx.clear();

    const startX = (screenW - HOTBAR_TOTAL_W) / 2;
    const startY = screenH - PAD - SLOT_SIZE;

    for (let i = 0; i < SLOT_COUNT; i++) {
      const x = startX + i * (SLOT_SIZE + SLOT_GAP);
      const y = startY;
      const locked = !UNLOCKED_SLOTS.has(i);
      const isSelected = !locked && (i === 6 ? buildModeActive : i === selected);

      // Background
      this.gfx.rect(x, y, SLOT_SIZE, SLOT_SIZE);
      if (locked) {
        this.gfx.fill({ color: LOCKED_BG, alpha: 0.7 });
      } else {
        this.gfx.fill({ color: isSelected ? SLOT_BG_SELECTED : SLOT_BG, alpha: 0.85 });
      }

      // Cooldown overlay (only on selected slot, fills from top down)
      if (isSelected && cooldown > 0 && cooldownMax > 0) {
        const ratio = cooldown / cooldownMax;
        const fillH = SLOT_SIZE * ratio;
        this.gfx.rect(x, y, SLOT_SIZE, fillH);
        this.gfx.fill({ color: COOLDOWN_OVERLAY, alpha: 0.45 });
      }

      // Border
      this.gfx.rect(x, y, SLOT_SIZE, SLOT_SIZE);
      if (locked) {
        this.gfx.stroke({ color: UNSELECTED_BORDER, alpha: 0.06, width: 1 });
      } else {
        this.gfx.stroke({
          color: isSelected ? SELECTED_BORDER : UNSELECTED_BORDER,
          alpha: isSelected ? 0.9 : 0.15,
          width: isSelected ? 2 : 1,
        });
      }

      // Key number (top-left corner of slot)
      const kt = this.keyTexts[i];
      kt.position.set(x + 4, y + 2);
      if (!locked) {
        kt.style.fill = isSelected ? SELECTED_BORDER : 0x8a9ab0;
      }

      // Label (centered in slot)
      const lt = this.labelTexts[i];
      lt.position.set(
        x + (SLOT_SIZE - lt.width) / 2,
        y + (SLOT_SIZE - lt.height) / 2 + 4,
      );
      if (!locked) {
        lt.style.fill = isSelected ? 0xffffff : 0x8a9ab0;
      }
    }
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }
}
