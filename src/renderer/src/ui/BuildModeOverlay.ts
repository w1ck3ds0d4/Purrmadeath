import {
  BUILDING_COSTS, BUILDING_MAX_LEVEL, getUpgradeCost, getRepairCost,
  ARROW_TURRET_DAMAGE, ARROW_TURRET_RANGE, ARROW_TURRET_COOLDOWN,
  CANNON_TURRET_DAMAGE, CANNON_TURRET_RANGE, CANNON_TURRET_COOLDOWN,
  SPIKE_TRAP_DAMAGE,
  UPGRADE_ARROW_DMG, UPGRADE_ARROW_CD,
  UPGRADE_CANNON_DMG, UPGRADE_CANNON_CD,
  UPGRADE_LIGHT_RANGE, UPGRADE_HEAL_RATE, UPGRADE_HEAL_RANGE,
} from '@shared/constants';
import type { BuildingType } from '@shared/components';

const RES_COLORS: Record<string, string> = {
  wood: '#8a6a3a',
  stone: '#999',
  iron: '#b08060',
  diamond: '#44ccdd',
  food: '#44aa44',
};

/** Resource type produced by each production building. */
const PROD_RESOURCE: Record<string, string> = {
  lumbermill: 'Wood',
  quarry: 'Stone',
  mine: 'Iron & Diamond',
  farm: 'Food',
};

export class BuildModeOverlay {
  private el: HTMLElement;
  private titleEl: HTMLElement;
  private costEl: HTMLElement;
  private infoEl: HTMLElement;
  private hpBarOuter: HTMLElement;
  private hpBarInner: HTMLElement;
  private hpText: HTMLElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'build-mode-overlay';
    this.el.style.cssText = [
      'position: absolute',
      'bottom: 12px',
      'left: calc(50% + 198px)',
      'z-index: 20',
      'background: rgba(4, 4, 10, 0.80)',
      'backdrop-filter: blur(4px)',
      'border: 1px solid rgba(255, 255, 255, 0.14)',
      'padding: 10px 16px',
      "font-family: 'Segoe UI', monospace",
      'font-size: 13px',
      'color: #ccd8ea',
      'pointer-events: none',
      'display: none',
    ].join('; ');

    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = 'font-weight: bold; font-size: 14px; margin-bottom: 4px; color: #e8c96a;';
    this.el.appendChild(this.titleEl);

    // HP bar (hidden when placing new buildings)
    const hpRow = document.createElement('div');
    hpRow.style.cssText = 'display: none; align-items: center; gap: 6px; margin-bottom: 4px;';
    this.hpText = document.createElement('span');
    this.hpText.style.cssText = 'font-size: 12px; min-width: 80px;';
    this.hpBarOuter = document.createElement('div');
    this.hpBarOuter.style.cssText = 'flex: 1; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; min-width: 80px;';
    this.hpBarInner = document.createElement('div');
    this.hpBarInner.style.cssText = 'height: 100%; border-radius: 3px; transition: width 0.15s;';
    this.hpBarOuter.appendChild(this.hpBarInner);
    hpRow.append(this.hpText, this.hpBarOuter);
    this.el.appendChild(hpRow);

    // Stats info line
    this.infoEl = document.createElement('div');
    this.infoEl.style.cssText = 'font-size: 12px; color: #8a9aaa; margin-bottom: 4px; display: none;';
    this.el.appendChild(this.infoEl);

    this.costEl = document.createElement('div');
    this.costEl.style.cssText = 'margin-bottom: 6px; font-weight: bold;';
    this.el.appendChild(this.costEl);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size: 11px; color: #6a7a8a;';
    hint.textContent = 'B to reopen menu \u00B7 Click to select \u00B7 X demolish \u00B7 V upgrade \u00B7 G repair';
    this.el.appendChild(hint);

    document.getElementById('overlay')!.appendChild(this.el);
  }

  show(): void { this.el.style.display = 'block'; }
  hide(): void { this.el.style.display = 'none'; }

  update(buildingType: string, available: Record<string, number>): void {
    this.titleEl.textContent = buildingType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const costs = BUILDING_COSTS[buildingType] ?? {};
    const parts: string[] = [];
    for (const [res, amount] of Object.entries(costs)) {
      const have = available[res] ?? 0;
      const canAfford = have >= amount!;
      const color = canAfford ? '#8ade8a' : '#de5050';
      const resColor = RES_COLORS[res] ?? '#ccc';
      parts.push(`<span style="color:${color}">${amount}</span> <span style="color:${resColor}">${res.charAt(0).toUpperCase() + res.slice(1)}</span>`);
    }
    this.costEl.innerHTML = parts.length > 0 ? `Cost: ${parts.join('&nbsp;&nbsp;')}` : 'Free';
    // Hide HP bar and stats when placing new buildings
    (this.hpBarOuter.parentElement as HTMLElement).style.display = 'none';
    this.infoEl.style.display = 'none';
  }

  /** Show info for a selected existing building (name + level + upgrade/repair cost + HP + stats). */
  updateSelection(buildingType: string, level: number, available: Record<string, number>, currentHp?: number, maxHp?: number): void {
    const name = buildingType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    this.titleEl.textContent = `${name}  Lv.${level}`;

    // HP bar
    this.updateHpBar(currentHp, maxHp);

    // Stats
    this.updateStats(buildingType, level);

    const lines: string[] = [];

    // Upgrade cost line
    const maxLevel = BUILDING_MAX_LEVEL[buildingType as BuildingType] ?? 1;
    if (level >= maxLevel) {
      lines.push('<span style="color: #8a8a9a">Max Level</span>');
    } else {
      const upgCost = getUpgradeCost(buildingType as BuildingType, level);
      if (upgCost) {
        lines.push('Upgrade: ' + this.formatCost(upgCost, available));
      }
    }

    // Repair cost line (only if damaged)
    if (currentHp !== undefined && maxHp !== undefined && currentHp < maxHp) {
      const missingHp = maxHp - currentHp;
      const repCost = getRepairCost(buildingType as BuildingType, missingHp, maxHp);
      if (repCost) {
        lines.push('Repair: ' + this.formatCost(repCost, available));
      }
    }

    this.costEl.innerHTML = lines.join('<br>');
  }

  /** Lightweight per-frame update for live HP changes on the selected building. */
  updateSelectionHp(currentHp: number, maxHp: number): void {
    this.updateHpBar(currentHp, maxHp);
  }

  private updateHpBar(currentHp?: number, maxHp?: number): void {
    const hpRow = this.hpBarOuter.parentElement as HTMLElement;
    if (currentHp !== undefined && maxHp !== undefined && maxHp > 0) {
      hpRow.style.display = 'flex';
      const pct = Math.max(0, Math.min(1, currentHp / maxHp));
      this.hpBarInner.style.width = `${pct * 100}%`;
      // Color: green > yellow > red
      const color = pct > 0.6 ? '#44cc44' : pct > 0.3 ? '#ccaa22' : '#cc3333';
      this.hpBarInner.style.background = color;
      this.hpText.innerHTML = `HP: <span style="color:${color}">${Math.ceil(currentHp)}</span>/${maxHp}`;
    } else {
      hpRow.style.display = 'none';
    }
  }

  private updateStats(buildingType: string, level: number): void {
    const i = Math.max(0, Math.min(level - 1, 2));
    let stats = '';

    switch (buildingType) {
      case 'arrow_turret': {
        const dmg = Math.round(ARROW_TURRET_DAMAGE * UPGRADE_ARROW_DMG[i]);
        const cd = (ARROW_TURRET_COOLDOWN * UPGRADE_ARROW_CD[i]).toFixed(1);
        stats = `Dmg: ${dmg}  |  Range: ${ARROW_TURRET_RANGE}  |  Rate: ${cd}s`;
        break;
      }
      case 'cannon_turret': {
        const dmg = Math.round(CANNON_TURRET_DAMAGE * UPGRADE_CANNON_DMG[i]);
        const cd = (CANNON_TURRET_COOLDOWN * UPGRADE_CANNON_CD[i]).toFixed(1);
        stats = `Dmg: ${dmg}  |  Range: ${CANNON_TURRET_RANGE}  |  Rate: ${cd}s`;
        break;
      }
      case 'spike_trap':
        stats = `Dmg: ${SPIKE_TRAP_DAMAGE}`;
        break;
      case 'light_tower':
        stats = `Reveal Range: ${UPGRADE_LIGHT_RANGE[i]}px`;
        break;
      case 'healing_shrine':
        stats = `Heal: ${UPGRADE_HEAL_RATE[i]} HP/s  |  Range: ${UPGRADE_HEAL_RANGE[i]}px`;
        break;
      case 'potion_shop':
        stats = 'Brew and equip potions';
        break;
      default: {
        const prod = PROD_RESOURCE[buildingType];
        if (prod) stats = `Produces: ${prod}`;
        break;
      }
    }

    if (stats) {
      this.infoEl.textContent = stats;
      this.infoEl.style.display = 'block';
    } else {
      this.infoEl.style.display = 'none';
    }
  }

  private formatCost(cost: Partial<Record<string, number>>, available: Record<string, number>): string {
    const parts: string[] = [];
    for (const [res, amount] of Object.entries(cost)) {
      const have = available[res] ?? 0;
      const canAfford = have >= (amount as number);
      const color = canAfford ? '#8ade8a' : '#de5050';
      const resColor = RES_COLORS[res] ?? '#ccc';
      parts.push(`<span style="color:${color}">${amount}</span> <span style="color:${resColor}">${res.charAt(0).toUpperCase() + res.slice(1)}</span>`);
    }
    return parts.length > 0 ? parts.join('&nbsp;&nbsp;') : 'Free';
  }
}
