import { POTION_POOL, POTION_TYPES, type PotionType } from '@shared/definitions/PotionDefinitions';
import { THEME, panelStyle } from '../theme';

const RES_COLORS: Record<string, string> = {
  wood: '#8a6a3a',
  stone: '#999',
  iron: '#b08060',
  diamond: '#44ccdd',
  food: '#44aa44',
};

const POTION_COLORS: Record<PotionType, string> = {
  health: '#44cc66',
  speed:  '#44aaff',
  damage: '#ff6644',
  shield: '#aa66ff',
};

export interface PotionShopCallbacks {
  onUnlock: (potionType: PotionType, shopEntityId: number) => void;
  onEquip:  (potionType: PotionType) => void;
  onRestock: (shopEntityId: number) => void;
  onClose:  () => void;
}

export interface PotionShopData {
  shopEntityId: number;
  shopLevel: number;
  unlockedPotions: string[];
  equippedPotion: string | null;
  charges: number;
  maxCharges: number;
}

/**
 * HTML overlay for the Potion Shop - shows 4 potions with unlock/equip/restock.
 */
export class PotionShopOverlay {
  private el: HTMLElement;
  private titleEl: HTMLElement;
  private gridEl: HTMLElement;
  private restockRow: HTMLElement;
  private visible = false;
  private data: PotionShopData | null = null;
  private callbacks: PotionShopCallbacks | null = null;
  private available: Record<string, number> = {};

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'potion-shop-overlay';
    this.el.style.cssText = [
      'position: absolute',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      panelStyle(),
      'border-color: rgba(170, 102, 255, 0.3)',
      'padding: 20px 24px',
      'display: none',
      'min-width: 460px',
      'max-width: 520px',
      'user-select: none',
      'pointer-events: auto',
    ].join('; ');

    // Title
    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = 'font-weight: bold; font-size: 16px; color: #aa66ff; margin-bottom: 14px; text-align: center; letter-spacing: 2px;';
    this.el.appendChild(this.titleEl);

    // Potion grid (2x2)
    this.gridEl = document.createElement('div');
    this.gridEl.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;';
    this.el.appendChild(this.gridEl);

    // Restock row
    this.restockRow = document.createElement('div');
    this.restockRow.style.cssText = `display: none; align-items: center; justify-content: center; gap: 12px; padding: 8px; background: ${THEME.surfaceBg}; border-radius: ${THEME.radiusSm}; margin-bottom: 10px;`;
    this.el.appendChild(this.restockRow);

    // Close hint
    const hint = document.createElement('div');
    hint.style.cssText = `font-size: 11px; color: ${THEME.textMuted}; text-align: center;`;
    hint.textContent = 'Press E or ESC to close';
    this.el.appendChild(hint);

    document.getElementById('overlay')!.appendChild(this.el);
  }

  setCallbacks(cb: PotionShopCallbacks): void {
    this.callbacks = cb;
  }

  get isVisible(): boolean { return this.visible; }

  show(data: PotionShopData, available: Record<string, number>): void {
    this.data = data;
    this.available = available;
    this.visible = true;
    this.el.style.display = 'block';
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
    this.data = null;
  }

  /** Re-render with updated potion state (called when POTION_STATE arrives while shop is open). */
  refreshState(equippedPotion: string | null, unlockedPotions: string[], charges: number, maxCharges: number, available: Record<string, number>): void {
    if (!this.visible || !this.data) return;
    this.data.equippedPotion = equippedPotion;
    this.data.unlockedPotions = unlockedPotions;
    this.data.charges = charges;
    this.data.maxCharges = maxCharges;
    this.available = available;
    this.render();
  }

  /** Re-render with updated resource counts (called on RESOURCE_UPDATE / WAREHOUSE_UPDATE). */
  updateResources(available: Record<string, number>): void {
    if (!this.visible || !this.data) return;
    this.available = available;
    this.render();
  }

  private render(): void {
    if (!this.data) return;
    const { shopLevel, unlockedPotions, equippedPotion, charges, maxCharges, shopEntityId } = this.data;

    this.titleEl.textContent = `POTION SHOP - Level ${shopLevel}`;

    // Build potion panels
    this.gridEl.innerHTML = '';
    for (const pt of POTION_TYPES) {
      const def = POTION_POOL[pt];
      const unlocked = unlockedPotions.includes(pt);
      const equipped = equippedPotion === pt;
      const effect = def.effectByLevel[Math.min(shopLevel - 1, def.effectByLevel.length - 1)] ?? def.effectByLevel[0];
      const color = POTION_COLORS[pt];

      const panel = document.createElement('div');
      panel.style.cssText = [
        `background: ${THEME.surfaceBg}`,
        `border: 1px solid ${equipped ? color : THEME.borderSubtle}`,
        `border-radius: ${THEME.radiusMd}`,
        'padding: 10px',
        'display: flex',
        'flex-direction: column',
        'gap: 4px',
      ].join('; ');

      // Name
      const nameEl = document.createElement('div');
      nameEl.style.cssText = `font-weight: bold; font-size: 14px; color: ${color};`;
      nameEl.textContent = def.name;
      panel.appendChild(nameEl);

      // Description
      const descEl = document.createElement('div');
      descEl.style.cssText = `font-size: 11px; color: ${THEME.textSecondary};`;
      descEl.textContent = def.description;
      panel.appendChild(descEl);

      // Effect at current level
      const effectEl = document.createElement('div');
      effectEl.style.cssText = `font-size: 12px; color: ${THEME.textPrimary}; margin-top: 2px;`;
      effectEl.textContent = this.formatEffect(effect);
      panel.appendChild(effectEl);

      // Cooldown
      const cdEl = document.createElement('div');
      cdEl.style.cssText = `font-size: 11px; color: ${THEME.textMuted};`;
      cdEl.textContent = `Cooldown: ${def.cooldown}s`;
      panel.appendChild(cdEl);

      // Action button
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'margin-top: 6px; display: flex; gap: 6px;';

      if (!unlocked) {
        // Unlock button
        const btn = this.createButton('Unlock', this.formatCostInline(def.unlockCost), color);
        btn.addEventListener('click', () => this.callbacks?.onUnlock(pt, shopEntityId));
        btnRow.appendChild(btn);
      } else {
        // Unlocked badge
        const badge = document.createElement('span');
        badge.style.cssText = `font-size: 11px; color: #6aaa6a; margin-right: 6px; line-height: 24px;`;
        badge.textContent = 'UNLOCKED';
        btnRow.appendChild(badge);

        // Equip button
        if (!equipped) {
          const eqBtn = this.createButton('Equip', '', color);
          eqBtn.addEventListener('click', () => this.callbacks?.onEquip(pt));
          btnRow.appendChild(eqBtn);
        } else {
          const eqBadge = document.createElement('span');
          eqBadge.style.cssText = `font-size: 11px; color: ${color}; font-weight: bold; line-height: 24px;`;
          eqBadge.textContent = 'EQUIPPED';
          btnRow.appendChild(eqBadge);
        }
      }

      panel.appendChild(btnRow);
      this.gridEl.appendChild(panel);
    }

    // Restock row
    this.restockRow.innerHTML = '';
    if (equippedPotion && unlockedPotions.includes(equippedPotion)) {
      this.restockRow.style.display = 'flex';
      const def = POTION_POOL[equippedPotion as PotionType];

      const chargeEl = document.createElement('span');
      chargeEl.style.cssText = `font-size: 13px; color: ${THEME.textPrimary};`;
      chargeEl.innerHTML = `Charges: <b style="color:${charges >= maxCharges ? '#6aaa6a' : '#e8c96a'}">${charges}/${maxCharges}</b>`;
      this.restockRow.appendChild(chargeEl);

      if (charges < maxCharges && def) {
        const restockBtn = this.createButton('Restock', this.formatCostInline(def.restockCost), '#e8c96a');
        restockBtn.addEventListener('click', () => this.callbacks?.onRestock(shopEntityId));
        this.restockRow.appendChild(restockBtn);
      } else if (charges >= maxCharges) {
        const fullEl = document.createElement('span');
        fullEl.style.cssText = 'font-size: 11px; color: #6aaa6a;';
        fullEl.textContent = 'FULL';
        this.restockRow.appendChild(fullEl);
      }
    } else {
      this.restockRow.style.display = 'none';
    }
  }

  private formatEffect(effect: { type: string; value: number; duration: number }): string {
    switch (effect.type) {
      case 'heal': return `Heal ${effect.value} HP`;
      case 'speed_boost': return `+${Math.round(effect.value * 100)}% speed for ${effect.duration}s`;
      case 'damage_boost': return `+${Math.round(effect.value * 100)}% damage for ${effect.duration}s`;
      case 'shield': return `${effect.value} HP shield for ${effect.duration}s`;
      default: return '';
    }
  }

  private formatCostInline(cost: Partial<Record<string, number>>): string {
    const parts: string[] = [];
    for (const [res, amount] of Object.entries(cost)) {
      const have = this.available[res] ?? 0;
      const canAfford = have >= amount!;
      const color = canAfford ? '#8ade8a' : '#de5050';
      const resColor = RES_COLORS[res] ?? '#ccc';
      parts.push(`<span style="color:${color}">${amount}</span> <span style="color:${resColor}">${res.charAt(0).toUpperCase() + res.slice(1)}</span>`);
    }
    return parts.join(' ');
  }

  private createButton(label: string, costHtml: string, accentColor: string): HTMLElement {
    const btn = document.createElement('button');
    btn.style.cssText = [
      `background: ${THEME.surfaceBg}`,
      `border: 1px solid ${accentColor}44`,
      `border-radius: ${THEME.radiusSm}`,
      'padding: 3px 10px',
      `color: ${accentColor}`,
      'font-size: 12px',
      'cursor: pointer',
      `font-family: ${THEME.fontUI}`,
      `transition: background ${THEME.transition}`,
    ].join('; ');
    btn.innerHTML = costHtml ? `${label} (${costHtml})` : label;
    btn.addEventListener('mouseenter', () => { btn.style.background = THEME.surfaceHover; });
    btn.addEventListener('mouseleave', () => { btn.style.background = THEME.surfaceBg; });
    return btn;
  }
}
