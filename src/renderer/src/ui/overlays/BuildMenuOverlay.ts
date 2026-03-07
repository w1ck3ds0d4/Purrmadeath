import { BUILDING_COSTS, BUILDING_SIZES, PLACEABLE_BUILDINGS } from '@shared/constants';
import { THEME } from '../theme';

const RES_COLORS: Record<string, string> = {
  wood: '#8a6a3a',
  stone: '#999',
  iron: '#b08060',
  diamond: '#44ccdd',
  gold: '#d4aa44',
  food: '#44aa44',
  weapons: '#cc6644',
};

const RES_ICONS: Record<string, string> = {
  wood: '\u25A0',
  stone: '\u25A0',
  iron: '\u25A0',
  diamond: '\u25C6',
  gold: '\u25C6',
  food: '\u25A0',
  weapons: '\u25A0',
};

/** Tooltip detail data per building type. */
interface BuildingDetail {
  hp: number;
  description: string;
  range?: number;
  damage?: number;
  dps?: number;
  cooldown?: number;
  special?: string;
}

const BUILDING_DETAILS: Record<string, BuildingDetail> = {
  wall:             { hp: 150, description: 'Basic barrier that blocks enemy movement.' },
  gate:             { hp: 250, description: 'Automatically opens for allies and closes for enemies.' },
  arrow_turret:     { hp: 100, description: 'Fires arrows at the nearest enemy.', range: 200, damage: 8, cooldown: 2.0 },
  cannon_turret:    { hp: 200, description: 'Slow but powerful cannon with splash damage.', range: 300, damage: 20, cooldown: 4.0 },
  ballista:         { hp: 120, description: 'Long-range siege weapon. Bolts pierce through enemies.', range: 400, damage: 40, cooldown: 5.0 },
  laser_tower:      { hp: 100, description: 'Continuous beam that deals sustained damage.', range: 250, dps: 15 },
  tesla_coil:       { hp: 100, description: 'Lightning arcs to nearby enemies, chaining to 2 additional targets.', range: 180, damage: 10, cooldown: 2.5 },
  flame_tower:      { hp: 100, description: 'Sprays fire in a cone, scorching all enemies in range.', range: 60, dps: 12 },
  catapult:         { hp: 200, description: 'Hurls boulders in an area, dealing heavy AOE damage.', range: 500, damage: 35, cooldown: 6.0 },
  moat:             { hp: 999, description: 'Indestructible trench that slows enemies by 50%.', special: '50% Slow' },
  spike_trap:       { hp: 50, description: 'Damages enemies that walk over it. Wears out over time.', damage: 5, cooldown: 1.0 },
  lumbermill:       { hp: 180, description: 'Assign civilians to produce wood over time.' },
  quarry:           { hp: 180, description: 'Assign civilians to mine stone over time.' },
  mine:             { hp: 200, description: 'Assign civilians to extract iron and rare diamonds.' },
  farm:             { hp: 150, description: 'Assign civilians to grow food for the settlement.' },
  workshop:         { hp: 150, description: 'Assign civilians to forge weapons for guards.' },
  warehouse:        { hp: 200, description: 'Shared storage depot. Civilians deposit resources here.' },
  storage_shed:     { hp: 80, description: 'Small secondary deposit point for resources.' },
  bridge:           { hp: 999, description: 'Allows movement across water tiles.' },
  light_tower:      { hp: 120, description: 'Reveals the fog of war in a radius around it.', range: 200 },
  healing_shrine:   { hp: 100, description: 'Heals nearby players and allies over time.', range: 120, special: '3 HP/s' },
  repair_station:   { hp: 150, description: 'Assign a civilian to repair damaged buildings. Consumes wood and stone from the warehouse.', special: '10 HP per repair' },
  teleporter_pad:   { hp: 100, description: 'Place two pads, then press E to teleport between them.' },
  potion_shop:      { hp: 150, description: 'Brew and equip potions for combat advantages.' },
  training_center:  { hp: 220, description: 'Spend 1 weapon + 1 civilian to train a combat guard.' },
  tavern:           { hp: 200, description: 'Hire powerful hero NPCs using gold.' },
  cat_house:        { hp: 100, description: 'Provides housing for 2/3/4 additional civilians.' },
};

interface BuildCategory {
  name: string;
  accent: string;
  buildings: string[];
}

const BUILD_CATEGORIES: BuildCategory[] = [
  { name: 'Defense',    accent: '#cc4444', buildings: ['wall', 'gate', 'arrow_turret', 'cannon_turret', 'ballista', 'laser_tower', 'tesla_coil', 'flame_tower', 'catapult', 'moat', 'spike_trap'] },
  { name: 'Production', accent: '#44aa44', buildings: ['lumbermill', 'quarry', 'mine', 'farm', 'workshop'] },
  { name: 'Military',   accent: '#cc8844', buildings: ['training_center'] },
  { name: 'Housing',    accent: '#cc88cc', buildings: ['cat_house'] },
  { name: 'Utility',    accent: '#4488cc', buildings: ['warehouse', 'storage_shed', 'bridge', 'light_tower', 'healing_shrine', 'repair_station', 'teleporter_pad'] },
  { name: 'Shops',      accent: '#aa66ff', buildings: ['potion_shop', 'tavern'] },
];

/** Inject custom scrollbar styles once. */
let scrollbarInjected = false;
function injectScrollbarStyles(): void {
  if (scrollbarInjected) return;
  scrollbarInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    #build-menu-content::-webkit-scrollbar { width: 6px; }
    #build-menu-content::-webkit-scrollbar-track { background: rgba(10, 4, 6, 0.5); border-radius: 3px; }
    #build-menu-content::-webkit-scrollbar-thumb { background: ${THEME.accent}66; border-radius: 3px; }
    #build-menu-content::-webkit-scrollbar-thumb:hover { background: ${THEME.accent}aa; }
  `;
  document.head.appendChild(style);
}

export interface BuildMenuCallbacks {
  onSelect: (buildingType: string) => void;
  onClose: () => void;
  onSelectMode: () => void;
}

function titleCase(s: string): string {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Build menu with resource sidebar, category tabs, 5-column uniform grid, and hover tooltip.
 */
export class BuildMenuOverlay {
  private el: HTMLElement;
  private sidebarEl: HTMLElement;
  private tabsEl: HTMLElement;
  private contentEl: HTMLElement;
  private tooltipEl: HTMLElement;
  private tabButtons: HTMLElement[] = [];
  private visible = false;
  private callbacks: BuildMenuCallbacks | null = null;
  private activeTab = 0;
  private lastAvailable: Record<string, number> = {};

  constructor() {
    injectScrollbarStyles();

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

    // Inner panel
    const panel = document.createElement('div');
    panel.style.cssText = [
      `background: ${THEME.panelBg}`,
      `border: 1px solid ${THEME.borderDefault}`,
      `border-radius: ${THEME.radiusLg}`,
      'width: 860px',
      'max-width: 92vw',
      'max-height: 85vh',
      'overflow: hidden',
      'display: flex',
      'flex-direction: column',
      'position: relative',
    ].join('; ');

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = `padding: 12px 20px 10px; border-bottom: 1px solid ${THEME.borderSubtle}; flex-shrink: 0;`;
    const title = document.createElement('div');
    title.style.cssText = `font-family:${THEME.fontUI};font-weight:700;font-size:20px;color:${THEME.accent};text-align:center;letter-spacing:3px;text-transform:uppercase;`;
    title.textContent = 'Build Menu';
    titleBar.appendChild(title);
    panel.appendChild(titleBar);

    // Body: resource sidebar + tabs + content
    const body = document.createElement('div');
    body.style.cssText = 'display: flex; flex: 1; min-height: 0;';

    // Resource sidebar
    this.sidebarEl = document.createElement('div');
    this.sidebarEl.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'width: 140px',
      'min-width: 140px',
      `border-right: 1px solid ${THEME.borderSubtle}`,
      'padding: 12px 14px',
      'flex-shrink: 0',
    ].join('; ');
    body.appendChild(this.sidebarEl);

    // Right side: tabs on top + content below
    const rightSide = document.createElement('div');
    rightSide.style.cssText = 'display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0;';

    // Category tabs (horizontal bar)
    this.tabsEl = document.createElement('div');
    this.tabsEl.style.cssText = [
      'display: flex',
      'flex-wrap: nowrap',
      `border-bottom: 1px solid ${THEME.borderSubtle}`,
      'padding: 0 8px',
      'flex-shrink: 0',
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

    rightSide.appendChild(this.tabsEl);

    // Content area (scrollable, 5-col grid)
    this.contentEl = document.createElement('div');
    this.contentEl.id = 'build-menu-content';
    this.contentEl.style.cssText = 'flex: 1; padding: 10px 14px; overflow-y: auto; min-height: 0;';
    rightSide.appendChild(this.contentEl);

    body.appendChild(rightSide);
    panel.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = `border-top: 1px solid ${THEME.borderSubtle}; padding: 8px 16px 6px; flex-shrink: 0;`;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; justify-content: center; margin-bottom: 4px;';

    const selectBtn = document.createElement('div');
    selectBtn.style.cssText = [
      'padding: 5px 18px',
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
    hint.textContent = 'F upgrade \u00B7 R repair \u00B7 X demolish \u00B7 Scroll rotate \u00B7 B / ESC to close';
    footer.appendChild(hint);

    panel.appendChild(footer);

    // Tooltip (hidden, positioned fixed)
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.style.cssText = [
      'display: none',
      'position: fixed',
      'z-index: 9999',
      'pointer-events: none',
      `background: ${THEME.panelBg}`,
      `border: 1px solid ${THEME.borderAccent}`,
      `border-radius: ${THEME.radiusSm}`,
      `box-shadow: 0 4px 16px rgba(0,0,0,0.6), ${THEME.panelGlow}`,
      'padding: 10px 14px',
      'min-width: 200px',
      'max-width: 280px',
      `font-family: ${THEME.fontUI}`,
      'font-size: 12px',
      `color: ${THEME.textPrimary}`,
    ].join('; ');
    document.body.appendChild(this.tooltipEl);

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
    this.renderSidebar();
    this.renderTabs();
    this.renderContent();
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
    this.tooltipEl.style.display = 'none';
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
      'padding: 8px 14px',
      'font-size: 12px',
      'font-weight: 600',
      'letter-spacing: 1px',
      'cursor: pointer',
      'white-space: nowrap',
      `transition: background ${THEME.transition}`,
      `border-bottom: 2px solid ${active ? accent : 'transparent'}`,
      `background: ${active ? accent + '18' : 'transparent'}`,
      `color: ${active ? THEME.textBright : THEME.textMuted}`,
    ].join('; ');
  }

  private renderSidebar(): void {
    this.sidebarEl.innerHTML = '';
    const available = this.lastAvailable;

    const label = document.createElement('div');
    label.style.cssText = `font-family:${THEME.fontUI};font-size:12px;font-weight:700;color:${THEME.accent};letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px;`;
    label.textContent = 'Resources';
    this.sidebarEl.appendChild(label);

    const order = ['wood', 'stone', 'iron', 'diamond', 'gold', 'food', 'weapons'];
    for (const res of order) {
      const amount = available[res] ?? 0;
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px;';

      const icon = document.createElement('span');
      icon.style.cssText = `color:${RES_COLORS[res] ?? '#ccc'};font-size:10px;margin-right:6px;`;
      icon.textContent = RES_ICONS[res] ?? '\u25A0';
      row.appendChild(icon);

      const nameEl = document.createElement('span');
      nameEl.style.cssText = `font-family:${THEME.fontMono};font-size:12px;color:${THEME.textSecondary};flex:1;`;
      nameEl.textContent = res.charAt(0).toUpperCase() + res.slice(1);
      row.appendChild(nameEl);

      const valEl = document.createElement('span');
      valEl.style.cssText = `font-family:${THEME.fontMono};font-size:13px;font-weight:600;color:${THEME.textBright};`;
      valEl.textContent = String(amount);
      row.appendChild(valEl);

      this.sidebarEl.appendChild(row);
    }
  }

  private showTooltip(type: string, cardEl: HTMLElement): void {
    const detail = BUILDING_DETAILS[type];
    if (!detail) return;

    const dimColor = THEME.textSecondary;
    const brightColor = THEME.textBright;
    const statColor = '#d4aa44';

    // Title
    let html = `<div style="font-size:14px;font-weight:700;color:${brightColor};margin-bottom:6px;">${titleCase(type)}</div>`;

    // Stats rows
    const statsLines: string[] = [];
    statsLines.push(`<span style="color:${dimColor}">HP:</span> <span style="color:#cc5555">${detail.hp}</span>`);
    if (detail.damage != null) statsLines.push(`<span style="color:${dimColor}">Damage:</span> <span style="color:${statColor}">${detail.damage}</span>`);
    if (detail.dps != null) statsLines.push(`<span style="color:${dimColor}">DPS:</span> <span style="color:${statColor}">${detail.dps}</span>`);
    if (detail.range != null) statsLines.push(`<span style="color:${dimColor}">Range:</span> <span style="color:${statColor}">${detail.range}px</span>`);
    if (detail.cooldown != null) statsLines.push(`<span style="color:${dimColor}">Cooldown:</span> <span style="color:${statColor}">${detail.cooldown}s</span>`);
    if (detail.special) statsLines.push(`<span style="color:${dimColor}">Special:</span> <span style="color:#88ccee">${detail.special}</span>`);

    html += `<div style="font-family:${THEME.fontMono};font-size:11px;line-height:1.6;margin-bottom:6px;">${statsLines.join('<br>')}</div>`;

    // Description
    html += `<div style="font-size:11px;color:${dimColor};line-height:1.4;border-top:1px solid ${THEME.borderSubtle};padding-top:6px;">${detail.description}</div>`;

    this.tooltipEl.innerHTML = html;
    this.tooltipEl.style.display = 'block';

    // Position near the card
    const rect = cardEl.getBoundingClientRect();
    const ttW = this.tooltipEl.offsetWidth;
    const ttH = this.tooltipEl.offsetHeight;

    let left = rect.right + 8;
    let top = rect.top;

    if (left + ttW > window.innerWidth - 8) {
      left = rect.left - ttW - 8;
    }
    if (top + ttH > window.innerHeight - 8) {
      top = window.innerHeight - ttH - 8;
    }
    if (top < 8) top = 8;

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
  }

  private hideTooltip(): void {
    this.tooltipEl.style.display = 'none';
  }

  private renderContent(): void {
    this.contentEl.innerHTML = '';
    this.hideTooltip();
    const cat = BUILD_CATEGORIES[this.activeTab];
    const available = this.lastAvailable;
    const placeable = cat.buildings.filter(b => PLACEABLE_BUILDINGS.includes(b as any));

    // 5-column grid with uniform square cells
    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px;';

    for (const type of placeable) {
      // Outer wrapper to enforce square aspect ratio
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position: relative; width: 100%; padding-bottom: 100%;';

      const card = document.createElement('div');
      card.style.cssText = [
        'position: absolute',
        'inset: 0',
        'display: flex',
        'flex-direction: column',
        'align-items: center',
        'justify-content: center',
        'text-align: center',
        `background: ${THEME.surfaceBg}`,
        `border: 1px solid ${THEME.borderDefault}`,
        `border-top: 3px solid ${cat.accent}66`,
        `border-radius: ${THEME.radiusSm}`,
        'padding: 6px 4px',
        'cursor: pointer',
        `transition: background ${THEME.transition}, border-color ${THEME.transition}, box-shadow ${THEME.transition}`,
        'overflow: hidden',
        'gap: 3px',
      ].join('; ');

      card.addEventListener('mouseenter', () => {
        card.style.background = THEME.surfaceHover;
        card.style.borderColor = cat.accent;
        card.style.borderTopColor = cat.accent;
        card.style.boxShadow = `0 0 8px ${cat.accent}33`;
        this.showTooltip(type, card);
      });
      card.addEventListener('mousemove', () => {
        this.showTooltip(type, card);
      });
      card.addEventListener('mouseleave', () => {
        card.style.background = THEME.surfaceBg;
        card.style.borderColor = THEME.borderDefault;
        card.style.borderTopColor = `${cat.accent}66`;
        card.style.boxShadow = 'none';
        this.hideTooltip();
      });
      card.addEventListener('click', () => {
        this.callbacks?.onSelect(type);
      });

      // Building name
      const nameEl = document.createElement('div');
      nameEl.style.cssText = `font-family:${THEME.fontUI};font-size:12px;font-weight:600;color:${THEME.textBright};line-height:1.2;`;
      nameEl.textContent = titleCase(type);
      card.appendChild(nameEl);

      // Cost line
      const costs = BUILDING_COSTS[type] ?? {};
      const costEl = document.createElement('div');
      costEl.style.cssText = `font-family:${THEME.fontMono};font-size:10px;line-height:1.3;`;
      costEl.innerHTML = this.formatCostCompact(costs, available);
      card.appendChild(costEl);

      // Size label
      const size = BUILDING_SIZES[type];
      if (size) {
        const sizeEl = document.createElement('div');
        sizeEl.style.cssText = `font-family:${THEME.fontMono};font-size:9px;color:${THEME.textDim};`;
        sizeEl.textContent = `${size.w}x${size.h}`;
        card.appendChild(sizeEl);
      }

      wrapper.appendChild(card);
      grid.appendChild(wrapper);
    }

    this.contentEl.appendChild(grid);
  }

  /** Compact cost format for card display. */
  private formatCostCompact(cost: Partial<Record<string, number>>, available: Record<string, number>): string {
    const parts: string[] = [];
    for (const [res, amount] of Object.entries(cost)) {
      const have = available[res] ?? 0;
      const canAfford = have >= amount!;
      const color = canAfford ? '#8ade8a' : '#de5050';
      const resColor = RES_COLORS[res] ?? '#ccc';
      // Short resource name
      const short = res === 'diamond' ? 'Dia' : res.charAt(0).toUpperCase() + res.slice(1, 4);
      parts.push(`<span style="color:${color}">${amount}</span><span style="color:${resColor}"> ${short}</span>`);
    }
    return parts.length > 0 ? parts.join('&nbsp; ') : 'Free';
  }
}
