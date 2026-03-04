import { Container, Graphics, Text } from 'pixi.js';
import { CLASS_STATS } from '@shared/definitions/ClassDefinitions';
import type { PlayerClass } from '@shared/definitions/ClassDefinitions';
import { POTION_POOL } from '@shared/definitions/PotionDefinitions';
import type { PotionType } from '@shared/definitions/PotionDefinitions';

const SLOT_SIZE = 48;
const SLOT_GAP  = 6;
const PAD       = 40;   // room below for health + stamina bars
const SLOT_COUNT = 6;

const SELECTED_BORDER = 0xaa2233;  // crimson accent (matches game theme)
const UNSELECTED_BORDER = 0xffffff;
const SLOT_BG = 0x1a0a0e;
const SLOT_BG_SELECTED = 0x2a1418;
const LOCKED_BG = 0x110608;
const COOLDOWN_OVERLAY = 0x000000;

// Slot 0: class weapon, 1-3: skill abilities (Q/E/R), 4: potion, 5: build hammer
const SLOT_LABELS = ['Sword', 'Skill', 'Skill', 'Skill', 'Potion', 'Build'];
const SLOT_KEYS   = ['1', 'Q', 'E', 'R', '3', 'B'];
const DEFAULT_UNLOCKED = new Set([0, 5]); // weapon slot + build hammer

/** Total pixel width of the hotbar (exported so HUD bars can match). */
export const HOTBAR_TOTAL_W = SLOT_COUNT * SLOT_SIZE + (SLOT_COUNT - 1) * SLOT_GAP;
export const HOTBAR_PAD = PAD;

/**
 * Pixi.js weapon hotbar - shows 6 selectable slots at bottom-center.
 *
 * Slot layout: [Weapon] [Q] [E] [R] [Potion] [Build]
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
        style: { fontSize: 12, fill: locked ? 0x3a3a4a : 0xd8e2ef, fontFamily: 'monospace' },
      });
      // Small charge counter (used for potion slot)
      const chargeText = new Text({
        text: '',
        style: { fontSize: 10, fill: 0xaa2233, fontFamily: 'monospace' },
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
    selectedClass: PlayerClass,
    cooldown: number,
    cooldownMax: number,
    screenW: number,
    screenH: number,
    buildModeActive = false,
    /** Override which slots are unlocked (for skill tree capstones). */
    unlockedSlots?: Set<number>,
    /** Ability names for skill slots 1-3 (empty string = use default label). */
    abilityNames?: string[],
    /** Ability cooldown remaining for skill slots 1-3. */
    abilityCooldowns?: number[],
    /** Ability cooldown max for skill slots 1-3. */
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

    // Update slot 0 label to class weapon name
    const cs = CLASS_STATS[selectedClass];
    this.labelTexts[0].text = cs.weaponName;

    // Update skill slot labels if ability names provided
    if (abilityNames) {
      for (let s = 0; s < 3; s++) {
        if (abilityNames[s]) this.labelTexts[1 + s].text = abilityNames[s];
        else this.labelTexts[1 + s].text = SLOT_LABELS[1 + s];
      }
    }

    // Update potion slot label
    if (potionEquipped) {
      const def = POTION_POOL[potionEquipped as PotionType];
      this.labelTexts[4].text = def?.shortName ?? 'Potion';
    } else {
      this.labelTexts[4].text = SLOT_LABELS[4];
    }

    const startX = (screenW - HOTBAR_TOTAL_W) / 2;
    const startY = screenH - PAD - SLOT_SIZE;

    for (let i = 0; i < SLOT_COUNT; i++) {
      const x = startX + i * (SLOT_SIZE + SLOT_GAP);
      const y = startY;
      const locked = !unlocked.has(i);
      const isSelected = !locked && (i === 5 ? buildModeActive : i === 0);

      // Background
      this.gfx.rect(x, y, SLOT_SIZE, SLOT_SIZE);
      if (locked) {
        this.gfx.fill({ color: LOCKED_BG, alpha: 0.7 });
      } else {
        this.gfx.fill({ color: isSelected ? SLOT_BG_SELECTED : SLOT_BG, alpha: 0.85 });
      }

      // Cooldown overlay - weapon slot
      if (i === 0 && cooldown > 0 && cooldownMax > 0) {
        const ratio = cooldown / cooldownMax;
        const fillH = SLOT_SIZE * ratio;
        this.gfx.rect(x, y, SLOT_SIZE, fillH);
        this.gfx.fill({ color: COOLDOWN_OVERLAY, alpha: 0.45 });
      }

      // Cooldown overlay - potion slot
      if (i === 4 && potionCooldown > 0 && potionCooldownMax > 0) {
        const ratio = potionCooldown / potionCooldownMax;
        const fillH = SLOT_SIZE * ratio;
        this.gfx.rect(x, y, SLOT_SIZE, fillH);
        this.gfx.fill({ color: COOLDOWN_OVERLAY, alpha: 0.45 });
      }

      // Cooldown overlay - skill slots 1-3
      if (i >= 1 && i <= 3 && abilityCooldowns && abilityCooldownMaxes) {
        const si = i - 1;
        const cd = abilityCooldowns[si] ?? 0;
        const cdMax = abilityCooldownMaxes[si] ?? 0;
        if (cd > 0 && cdMax > 0) {
          const ratio = cd / cdMax;
          const fillH = SLOT_SIZE * ratio;
          this.gfx.rect(x, y, SLOT_SIZE, fillH);
          this.gfx.fill({ color: COOLDOWN_OVERLAY, alpha: 0.45 });
        }
      }

      // Border
      const isTargeting = i >= 1 && i <= 3 && targetingSlot === i - 1;
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
      kt.style.fill = locked ? 0x3a3a4a : (isSelected ? SELECTED_BORDER : 0x8a9ab0);

      // Label (centered in slot)
      const lt = this.labelTexts[i];
      lt.position.set(
        x + (SLOT_SIZE - lt.width) / 2,
        y + (SLOT_SIZE - lt.height) / 2 + (i === 4 && potionEquipped ? 0 : 4),
      );
      lt.style.fill = locked ? 0x3a3a4a : (isSelected ? 0xffffff : 0x8a9ab0);

      // Charge counter (potion slot only)
      const ct = this.chargeTexts[i];
      if (i === 4 && potionEquipped && !locked) {
        ct.visible = true;
        ct.text = `${potionCharges}/${potionMaxCharges}`;
        ct.position.set(x + (SLOT_SIZE - ct.width) / 2, y + SLOT_SIZE - 14);
        ct.style.fill = potionCharges > 0 ? 0xaa2233 : 0x5a5a6a;
      } else {
        ct.visible = false;
      }
    }
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }
}
