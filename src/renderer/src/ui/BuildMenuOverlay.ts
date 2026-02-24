import { BUILDING_COSTS, PLACEABLE_BUILDINGS } from '@shared/constants';

const RES_COLORS: Record<string, string> = {
  wood: '#8a6a3a',
  stone: '#999',
  iron: '#b08060',
  diamond: '#44ccdd',
  food: '#44aa44',
};

/** Short stats summary for each building type (shown on cards). */
const BUILDING_STATS: Record<string, string> = {
  wall: '150 HP block',
  arrow_turret: '8 Dmg \u00B7 200 Range \u00B7 2.0s',
  cannon_turret: '20 Dmg \u00B7 300 Range \u00B7 4.0s',
  spike_trap: '5 Dmg',
  lumbermill: 'Produces: Wood',
  quarry: 'Produces: Stone',
  mine: 'Produces: Iron & Diamond',
  farm: 'Produces: Food',
  warehouse: 'Shared storage',
  bridge: 'Cross water tiles',
  light_tower: '200px Reveal',
  healing_shrine: '3 HP/s \u00B7 120px Range',
  potion_shop: 'Brew & equip potions',
};

interface BuildCategory {
  name: string;
  accent: string;
  buildings: string[];
}

const BUILD_CATEGORIES: BuildCategory[] = [
  { name: 'Defense',    accent: '#cc4444', buildings: ['wall', 'arrow_turret', 'cannon_turret', 'spike_trap'] },
  { name: 'Production', accent: '#44aa44', buildings: ['lumbermill', 'quarry', 'mine', 'farm'] },
  { name: 'Utility',    accent: '#4488cc', buildings: ['warehouse', 'bridge', 'light_tower', 'healing_shrine'] },
  { name: 'Shops',      accent: '#aa66ff', buildings: ['potion_shop'] },
];

export interface BuildMenuCallbacks {
  onSelect: (buildingType: string) => void;
  onClose: () => void;
}

function titleCase(s: string): string {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Centered tab-based build menu panel.
 * Left sidebar: category tabs. Right area: building cards for selected tab.
 */
export class BuildMenuOverlay {
  private el: HTMLElement;
  private tabsEl: HTMLElement;
  private contentEl: HTMLElement;
  private tabButtons: HTMLElement[] = [];
  private visible = false;
  private callbacks: BuildMenuCallbacks | null = null;
  private activeTab = 0;
  private lastAvailable: Record<string, number> = {};

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'build-menu-overlay';
    this.el.style.cssText = [
      'position: absolute',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      'background: rgba(4, 4, 10, 0.92)',
      'backdrop-filter: blur(6px)',
      'border: 1px solid rgba(255, 255, 255, 0.14)',
      'border-radius: 8px',
      'padding: 0',
      "font-family: 'Segoe UI', monospace",
      'font-size: 13px',
      'color: #ccd8ea',
      'display: none',
      'min-width: 560px',
      'max-width: 640px',
      'user-select: none',
      'pointer-events: auto',
      'overflow: hidden',
    ].join('; ');

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = 'padding: 14px 20px 10px; border-bottom: 1px solid rgba(255,255,255,0.08);';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight: bold; font-size: 16px; color: #e8c96a; text-align: center; letter-spacing: 3px;';
    title.textContent = 'BUILD MENU';
    titleBar.appendChild(title);
    this.el.appendChild(titleBar);

    // Body: tabs sidebar + content area
    const body = document.createElement('div');
    body.style.cssText = 'display: flex; min-height: 280px;';

    // Tab sidebar
    this.tabsEl = document.createElement('div');
    this.tabsEl.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'width: 120px',
      'min-width: 120px',
      'border-right: 1px solid rgba(255,255,255,0.08)',
      'padding: 8px 0',
    ].join('; ');

    for (let i = 0; i < BUILD_CATEGORIES.length; i++) {
      const cat = BUILD_CATEGORIES[i];
      const btn = document.createElement('div');
      btn.style.cssText = this.tabStyle(i === 0, cat.accent);
      btn.textContent = cat.name;
      btn.addEventListener('click', () => this.selectTab(i));
      btn.addEventListener('mouseenter', () => {
        if (i !== this.activeTab) btn.style.background = 'rgba(255,255,255,0.06)';
      });
      btn.addEventListener('mouseleave', () => {
        if (i !== this.activeTab) btn.style.background = 'transparent';
      });
      this.tabButtons.push(btn);
      this.tabsEl.appendChild(btn);
    }

    // Spacer pushes '+' to bottom
    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex: 1;';
    this.tabsEl.appendChild(spacer);

    // Disabled '+' placeholder
    const addBtn = document.createElement('div');
    addBtn.style.cssText = [
      'padding: 8px 14px',
      'font-size: 18px',
      'color: #2a2a3a',
      'text-align: center',
      'cursor: default',
    ].join('; ');
    addBtn.textContent = '+';
    this.tabsEl.appendChild(addBtn);

    body.appendChild(this.tabsEl);

    // Content area
    this.contentEl = document.createElement('div');
    this.contentEl.style.cssText = 'flex: 1; padding: 12px 16px; overflow-y: auto;';
    body.appendChild(this.contentEl);

    this.el.appendChild(body);

    // Footer hint
    const footer = document.createElement('div');
    footer.style.cssText = 'font-size: 11px; color: #5a6a7a; text-align: center; padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.08);';
    footer.textContent = 'Click to select \u00B7 B / ESC to close';
    this.el.appendChild(footer);

    document.getElementById('overlay')!.appendChild(this.el);
  }

  setCallbacks(cb: BuildMenuCallbacks): void {
    this.callbacks = cb;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(available: Record<string, number>): void {
    this.visible = true;
    this.lastAvailable = available;
    this.el.style.display = 'block';
    this.renderTabs();
    this.renderContent();
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
  }

  private selectTab(index: number): void {
    this.activeTab = index;
    this.renderTabs();
    this.renderContent();
  }

  private renderTabs(): void {
    for (let i = 0; i < BUILD_CATEGORIES.length; i++) {
      this.tabButtons[i].style.cssText = this.tabStyle(i === this.activeTab, BUILD_CATEGORIES[i].accent);
    }
  }

  private tabStyle(active: boolean, accent: string): string {
    return [
      'padding: 10px 14px',
      'font-size: 12px',
      'font-weight: bold',
      'letter-spacing: 1px',
      'cursor: pointer',
      'transition: background 0.12s',
      `border-left: 3px solid ${active ? accent : 'transparent'}`,
      `background: ${active ? 'rgba(255,255,255,0.06)' : 'transparent'}`,
      `color: ${active ? accent : '#6a7a8a'}`,
    ].join('; ');
  }

  private renderContent(): void {
    this.contentEl.innerHTML = '';
    const cat = BUILD_CATEGORIES[this.activeTab];
    const available = this.lastAvailable;

    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px;';

    for (const type of cat.buildings) {
      if (!PLACEABLE_BUILDINGS.includes(type as any)) continue;

      const card = document.createElement('div');
      card.style.cssText = [
        'background: rgba(255,255,255,0.04)',
        `border-top: 3px solid ${cat.accent}44`,
        'border-radius: 4px',
        'padding: 10px 12px',
        'cursor: pointer',
        'transition: background 0.12s, border-color 0.12s',
      ].join('; ');

      card.addEventListener('mouseenter', () => {
        card.style.background = 'rgba(255,255,255,0.10)';
        card.style.borderTopColor = cat.accent;
      });
      card.addEventListener('mouseleave', () => {
        card.style.background = 'rgba(255,255,255,0.04)';
        card.style.borderTopColor = `${cat.accent}44`;
      });
      card.addEventListener('click', () => {
        this.callbacks?.onSelect(type);
      });

      // Building name
      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-size: 13px; font-weight: bold; color: #e8c96a; margin-bottom: 4px;';
      nameEl.textContent = titleCase(type);
      card.appendChild(nameEl);

      // Cost line
      const costs = BUILDING_COSTS[type] ?? {};
      const costEl = document.createElement('div');
      costEl.style.cssText = 'font-size: 11px; margin-bottom: 4px;';
      costEl.innerHTML = this.formatCost(costs, available);
      card.appendChild(costEl);

      // Stats line
      const stats = BUILDING_STATS[type];
      if (stats) {
        const statsEl = document.createElement('div');
        statsEl.style.cssText = 'font-size: 10px; color: #8a9aaa;';
        statsEl.textContent = stats;
        card.appendChild(statsEl);
      }

      grid.appendChild(card);
    }

    this.contentEl.appendChild(grid);
  }

  private formatCost(cost: Partial<Record<string, number>>, available: Record<string, number>): string {
    const parts: string[] = [];
    for (const [res, amount] of Object.entries(cost)) {
      const have = available[res] ?? 0;
      const canAfford = have >= amount!;
      const color = canAfford ? '#8ade8a' : '#de5050';
      const resColor = RES_COLORS[res] ?? '#ccc';
      parts.push(`<span style="color:${color}">${amount}</span><span style="color:${resColor}"> ${res.charAt(0).toUpperCase() + res.slice(1)}</span>`);
    }
    return parts.length > 0 ? parts.join('&nbsp;&nbsp;') : 'Free';
  }
}
