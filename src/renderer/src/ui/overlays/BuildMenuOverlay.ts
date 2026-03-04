import { BUILDING_COSTS, PLACEABLE_BUILDINGS } from '@shared/constants';
import { THEME } from '../theme';

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
  gate: '250 HP \u00B7 3x1 \u00B7 Auto-opens for allies',
  arrow_turret: '8 Dmg \u00B7 200 Range \u00B7 2.0s',
  cannon_turret: '20 Dmg \u00B7 300 Range \u00B7 4.0s',
  ballista: '40 Dmg \u00B7 400 Range \u00B7 5.0s \u00B7 Pierce',
  laser_tower: '15 DPS \u00B7 250 Range \u00B7 Beam',
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
  workshop: 'Produces: Weapons',
  training_center: 'Train guards (1 weapon + 1 civilian)',
  cat_house: '+2/3/4 Housing capacity',
  dormitory: '+5/7/10 Housing capacity',
};

interface BuildCategory {
  name: string;
  accent: string;
  buildings: string[];
}

const BUILD_CATEGORIES: BuildCategory[] = [
  { name: 'Defense',    accent: '#cc4444', buildings: ['wall', 'gate', 'arrow_turret', 'cannon_turret', 'ballista', 'laser_tower', 'spike_trap'] },
  { name: 'Production', accent: '#44aa44', buildings: ['lumbermill', 'quarry', 'mine', 'farm', 'workshop'] },
  { name: 'Military',   accent: '#cc8844', buildings: ['training_center'] },
  { name: 'Housing',    accent: '#cc88cc', buildings: ['cat_house', 'dormitory'] },
  { name: 'Utility',    accent: '#4488cc', buildings: ['warehouse', 'bridge', 'light_tower', 'healing_shrine'] },
  { name: 'Shops',      accent: '#aa66ff', buildings: ['potion_shop'] },
];

export interface BuildMenuCallbacks {
  onSelect: (buildingType: string) => void;
  onClose: () => void;
  onSelectMode: () => void;
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
    this.el.className = 'screen';
    this.el.style.cssText = [
      `font-family: ${THEME.fontUI}`,
      'font-size: 13px',
      `color: ${THEME.textBright}`,
      'display: none',
      'user-select: none',
      'pointer-events: auto',
      'justify-content: center',
      'align-items: center',
    ].join('; ');

    // Inner panel (centered card within full-screen overlay)
    const panel = document.createElement('div');
    panel.style.cssText = [
      `background: ${THEME.panelBg}`,
      `border: 1px solid ${THEME.borderDefault}`,
      `border-radius: ${THEME.radiusLg}`,
      'min-width: 560px',
      'max-width: 640px',
      'overflow: hidden',
    ].join('; ');

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `padding: 14px 20px 10px; border-bottom: 1px solid ${THEME.borderSubtle};`;
    const title = document.createElement('div');
    title.style.cssText = `font-family:${THEME.fontUI};font-weight:700;font-size:22px;color:${THEME.textBright};text-align:center;letter-spacing:3px;`;
    title.textContent = 'BUILD MENU';
    titleBar.appendChild(title);
    panel.appendChild(titleBar);

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
      `border-right: 1px solid ${THEME.borderSubtle}`,
      'padding: 8px 0',
    ].join('; ');

    for (let i = 0; i < BUILD_CATEGORIES.length; i++) {
      const cat = BUILD_CATEGORIES[i];
      const btn = document.createElement('div');
      btn.style.cssText = this.tabStyle(i === 0, cat.accent);
      btn.textContent = cat.name;
      btn.addEventListener('click', () => this.selectTab(i));
      btn.addEventListener('mouseenter', () => {
        if (i !== this.activeTab) btn.style.background = THEME.surfaceBg;
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
      `color: ${THEME.textDim}`,
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

    panel.appendChild(body);

    // Footer: select button + hint
    const footer = document.createElement('div');
    footer.style.cssText = `border-top: 1px solid ${THEME.borderSubtle}; padding: 10px 16px 8px;`;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; justify-content: center; margin-bottom: 6px;';

    const selectBtn = document.createElement('div');
    selectBtn.style.cssText = [
      'padding: 6px 20px',
      'font-family: monospace',
      'font-size: 13px',
      'font-weight: bold',
      'cursor: pointer',
      `border-radius: ${THEME.radiusSm}`,
      `border: 1px solid ${THEME.accent}66`,
      `color: ${THEME.accent}`,
      `background: ${THEME.surfaceBg}`,
      `transition: background ${THEME.transition}, box-shadow ${THEME.transition}`,
      'letter-spacing: 0.5px',
    ].join('; ');
    selectBtn.textContent = 'Select Building';
    selectBtn.addEventListener('mouseenter', () => { selectBtn.style.background = THEME.surfaceHover; selectBtn.style.boxShadow = `0 0 10px ${THEME.accentRgba(0.3)}`; });
    selectBtn.addEventListener('mouseleave', () => { selectBtn.style.background = THEME.surfaceBg; selectBtn.style.boxShadow = 'none'; });
    selectBtn.addEventListener('click', () => this.callbacks?.onSelectMode());
    btnRow.appendChild(selectBtn);
    footer.appendChild(btnRow);

    const hint = document.createElement('div');
    hint.style.cssText = `font-family:${THEME.fontMono};font-size:11px;color:${THEME.textDim};text-align:center;`;
    hint.textContent = 'V upgrade \u00B7 G repair \u00B7 X demolish \u00B7 B / ESC to close';
    footer.appendChild(hint);

    panel.appendChild(footer);

    this.el.appendChild(panel);
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
    this.el.style.display = 'flex';
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
      'font-size: 13px',
      'font-weight: 600',
      'letter-spacing: 1px',
      'cursor: pointer',
      `transition: background ${THEME.transition}`,
      `border-left: 3px solid ${active ? accent : 'transparent'}`,
      `background: ${active ? accent + '18' : 'transparent'}`,
      `color: ${active ? THEME.textBright : THEME.textMuted}`,
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
        `background: ${THEME.surfaceBg}`,
        `border: 1px solid ${THEME.borderDefault}`,
        `border-top: 3px solid ${cat.accent}66`,
        `border-radius: ${THEME.radiusSm}`,
        'padding: 10px 12px',
        'cursor: pointer',
        `transition: background ${THEME.transition}, border-color ${THEME.transition}, box-shadow ${THEME.transition}`,
      ].join('; ');

      card.addEventListener('mouseenter', () => {
        card.style.background = THEME.surfaceHover;
        card.style.borderColor = cat.accent;
        card.style.borderTopColor = cat.accent;
        card.style.boxShadow = `0 0 10px ${cat.accent}44`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.background = THEME.surfaceBg;
        card.style.borderColor = THEME.borderDefault;
        card.style.borderTopColor = `${cat.accent}66`;
        card.style.boxShadow = 'none';
      });
      card.addEventListener('click', () => {
        this.callbacks?.onSelect(type);
      });

      // Building name
      const nameEl = document.createElement('div');
      nameEl.style.cssText = `font-family:${THEME.fontUI};font-size:14px;font-weight:600;color:${THEME.textBright};margin-bottom:4px;`;
      nameEl.textContent = titleCase(type);
      card.appendChild(nameEl);

      // Cost line
      const costs = BUILDING_COSTS[type] ?? {};
      const costEl = document.createElement('div');
      costEl.style.cssText = `font-family:${THEME.fontMono};font-size:12px;margin-bottom:4px;`;
      costEl.innerHTML = this.formatCost(costs, available);
      card.appendChild(costEl);

      // Stats line
      const stats = BUILDING_STATS[type];
      if (stats) {
        const statsEl = document.createElement('div');
        statsEl.style.cssText = `font-family:${THEME.fontMono};font-size:11px;color:${THEME.textSecondary};`;
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
