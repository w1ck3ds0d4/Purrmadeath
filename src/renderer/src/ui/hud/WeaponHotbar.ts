import { Container, Graphics, Text } from 'pixi.js';
import { POTION_POOL } from '@shared/definitions/PotionDefinitions';
import type { PotionType } from '@shared/definitions/PotionDefinitions';

const SLOT_SIZE = 56;
const SLOT_GAP  = 6;
const PAD       = 44;   // room below for health + stamina bars
const SLOT_COUNT = 5;

const SELECTED_BORDER = 0xc41830;  // crimson accent
const UNSELECTED_BORDER = 0xffffff;
const SLOT_BG = 0x1a0a0e;
const SLOT_BG_SELECTED = 0x2a1418;
const LOCKED_BG = 0x110608;
const COOLDOWN_OVERLAY = 0x881122;

// Slot 0-2: skill abilities (1/2/3), 3: potion (4), 4: build (Q)
const SLOT_LABELS = ['Skill', 'Skill', 'Skill', 'Potion', 'Build'];
const SLOT_KEYS   = ['1', '2', '3', '4', 'Q'];
const DEFAULT_UNLOCKED = new Set([4]); // build hammer always unlocked

/** Total pixel width of the hotbar (exported so HUD bars can match). */
export const HOTBAR_TOTAL_W = SLOT_COUNT * SLOT_SIZE + (SLOT_COUNT - 1) * SLOT_GAP;
export const HOTBAR_PAD = PAD;

/**
 * Pixi.js hotbar - shows 5 selectable slots at bottom-center.
 *
 * Slot layout: [1] [2] [3] [Q-Potion] [B-Build]
 */
export class WeaponHotbar {
  private container: Container;
  private gfx: Graphics;
  private keyTexts: Text[] = [];
  private labelTexts: Text[] = [];
  private chargeTexts: Text[] = [];

  constructor(stage: Container) {
    this.container = new Container();
    this.container.zIndex = 200; // above night overlay
    this.gfx = new Graphics();
    this.container.addChild(this.gfx);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const locked = !DEFAULT_UNLOCKED.has(i);
      const keyText = new Text({
        text: SLOT_KEYS[i],
        style: { fontSize: 11, fill: locked ? 0x3a3a4a : 0x8a9ab0, fontFamily: 'monospace' },
      });
      const labelText = new Text({
        text: SLOT_LABELS[i],
        style: { fontSize: 9, fill: locked ? 0x3a3a4a : 0xd8e2ef, fontFamily: 'monospace', wordWrap: true, wordWrapWidth: SLOT_SIZE - 4, align: 'center' },
      });
      // Small charge counter (used for potion slot)
      const chargeText = new Text({
        text: '',
        style: { fontSize: 10, fill: 0xc41830, fontFamily: 'monospace' },
      });
      chargeText.visible = false;
      this.keyTexts.push(keyText);
      this.labelTexts.push(labelText);
      this.chargeTexts.push(chargeText);
      this.container.addChild(keyText);
      this.container.addChild(labelText);
      this.container.addChild(chargeText);
    }

    stage.addChild(this.container);
  }

  update(
    screenW: number,
    screenH: number,
    buildModeActive = false,
    /** Override which slots are unlocked (for skill tree capstones). */
    unlockedSlots?: Set<number>,
    /** Ability names for skill slots 0-2 (empty string = use default label). */
    abilityNames?: string[],
    /** Ability cooldown remaining for skill slots 0-2. */
    abilityCooldowns?: number[],
    /** Ability cooldown max for skill slots 0-2. */
    abilityCooldownMaxes?: number[],
    /** Which ability slot (0-2) is in targeting mode, or -1. */
    targetingSlot = -1,
    /** Potion slot data. */
    potionEquipped: string | null = null,
    potionCharges = 0,
    potionMaxCharges = 0,
    potionCooldown = 0,
    potionCooldownMax = 0,
  ): void {
    this.gfx.clear();

    const unlocked = unlockedSlots ?? DEFAULT_UNLOCKED;

    // Update skill slot labels if ability names provided
    if (abilityNames) {
      for (let s = 0; s < 3; s++) {
        if (abilityNames[s]) {
          // Shorten long names to fit in slot
          const name = abilityNames[s];
          this.labelTexts[s].text = name.length > 10 ? name.split(' ').map(w => w.slice(0, 5)).join('\n') : name;
        }
        else this.labelTexts[s].text = SLOT_LABELS[s];
      }
    }

    // Update potion slot label
    if (potionEquipped) {
      const def = POTION_POOL[potionEquipped as PotionType];
      this.labelTexts[3].text = def?.shortName ?? 'Potion';
    } else {
      this.labelTexts[3].text = SLOT_LABELS[3];
    }

    const startX = (screenW - HOTBAR_TOTAL_W) / 2;
    const startY = screenH - PAD - SLOT_SIZE;

    for (let i = 0; i < SLOT_COUNT; i++) {
      const x = startX + i * (SLOT_SIZE + SLOT_GAP);
      const y = startY;
      const locked = !unlocked.has(i);
      const isSelected = !locked && (i === 4 && buildModeActive);

      // Background
      this.gfx.rect(x, y, SLOT_SIZE, SLOT_SIZE);
      if (locked) {
        this.gfx.fill({ color: LOCKED_BG, alpha: 0.7 });
      } else {
        this.gfx.fill({ color: isSelected ? SLOT_BG_SELECTED : SLOT_BG, alpha: 0.85 });
      }

      // Cooldown overlay - potion slot
      if (i === 3 && potionCooldown > 0 && potionCooldownMax > 0) {
        const ratio = potionCooldown / potionCooldownMax;
        const fillH = SLOT_SIZE * ratio;
        this.gfx.rect(x, y, SLOT_SIZE, fillH);
        this.gfx.fill({ color: COOLDOWN_OVERLAY, alpha: 0.45 });
      }

      // Cooldown overlay - skill slots 0-2
      if (i <= 2 && abilityCooldowns && abilityCooldownMaxes) {
        const cd = abilityCooldowns[i] ?? 0;
        const cdMax = abilityCooldownMaxes[i] ?? 0;
        if (cd > 0 && cdMax > 0) {
          const ratio = cd / cdMax;
          const fillH = SLOT_SIZE * ratio;
          this.gfx.rect(x, y, SLOT_SIZE, fillH);
          this.gfx.fill({ color: COOLDOWN_OVERLAY, alpha: 0.45 });
        }
      }

      // Border
      const isTargeting = i <= 2 && targetingSlot === i;
      this.gfx.rect(x, y, SLOT_SIZE, SLOT_SIZE);
      if (locked) {
        this.gfx.stroke({ color: UNSELECTED_BORDER, alpha: 0.06, width: 1 });
      } else if (isTargeting) {
        // Pulsing gold border for targeting slot
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 200);
        this.gfx.stroke({ color: SELECTED_BORDER, alpha: pulse, width: 3 });
      } else {
        this.gfx.stroke({
          color: isSelected ? SELECTED_BORDER : UNSELECTED_BORDER,
          alpha: isSelected ? 0.9 : 0.15,
          width: isSelected ? 2 : 1,
        });
      }

      // Key label (top-left corner of slot)
      const kt = this.keyTexts[i];
      kt.position.set(x + 4, y + 2);
      kt.style.fill = locked ? 0x5a5a6a : (isSelected ? SELECTED_BORDER : 0x8a9ab0);

      // Label (centered in slot)
      const lt = this.labelTexts[i];
      lt.position.set(
        x + (SLOT_SIZE - lt.width) / 2,
        y + (SLOT_SIZE - lt.height) / 2 + (i === 3 && potionEquipped ? 0 : 4),
      );
      lt.style.fill = locked ? 0x5a5a6a : (isSelected ? 0xffffff : 0x8a9ab0);

      // Charge counter (potion slot only)
      const ct = this.chargeTexts[i];
      if (i === 3 && potionEquipped && !locked) {
        ct.visible = true;
        ct.text = `${potionCharges}/${potionMaxCharges}`;
        ct.position.set(x + (SLOT_SIZE - ct.width) / 2, y + SLOT_SIZE - 14);
        ct.style.fill = potionCharges > 0 ? 0xc41830 : 0x5a5a6a;
      } else {
        ct.visible = false;
      }
    }
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }
}
