import { THEME, hudStyle } from '../theme';

/** Total slots per accordion (2 columns x 10 rows). */
const TOTAL_SLOTS = 20;

/** Fixed width for both accordions to match. */
const PANEL_WIDTH = '260px';

interface SlotDef {
  key: string;
  color: string;
  label: string;
}

/**
 * Accordion-style warehouse resource HUD.
 *
 * Collapsed: "Warehouse" label + chevron.
 * Expanded: 2-column x 10-row grid of resource slots (empty slots shown as placeholders).
 * Only visible when at least one warehouse building exists.
 */
export class WarehouseHUD {
  readonly el: HTMLElement;
  private headerEl: HTMLElement;
  private bodyEl: HTMLElement;
  private chevronEl: HTMLElement;
  private _expanded = false;

  onToggle: ((expanded: boolean) => void) | null = null;

  private static readonly ITEMS: SlotDef[] = [
    { key: 'wood',    color: '#8a6a3a', label: 'Wood' },
    { key: 'stone',   color: '#999',    label: 'Stone' },
    { key: 'iron',    color: '#b08060', label: 'Iron' },
    { key: 'diamond', color: '#44ccdd', label: 'Diamond' },
    { key: 'gold',    color: '#e8c96a', label: 'Gold' },
    { key: 'food',    color: '#44aa44', label: 'Food' },
    { key: 'weapons', color: '#aa6644', label: 'Weapons' },
  ];

  private static readonly PANEL_STYLE = hudStyle();

  private lastResources: Record<string, number> = {};

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'warehouse-hud';
    this.el.style.display = 'none';
    this.el.style.width = PANEL_WIDTH;

    // Header bar
    this.headerEl = document.createElement('div');
    this.headerEl.style.cssText = [
      WarehouseHUD.PANEL_STYLE,
      'display: flex',
      'align-items: center',
      'gap: 8px',
      'padding: 7px 14px',
      `border: 1px solid ${THEME.borderDefault}`,
      `border-radius: ${THEME.radiusMd}`,
      'pointer-events: auto',
      'cursor: pointer',
      'white-space: nowrap',
      'user-select: none',
    ].join('; ');
    this.headerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'Warehouse';
    titleSpan.style.cssText = `font-weight: bold; color: ${THEME.accent}; font-size: 12px;`;
    this.headerEl.appendChild(titleSpan);

    this.chevronEl = document.createElement('span');
    this.chevronEl.textContent = '\u25BE';
    this.chevronEl.style.cssText = [
      'display: inline-block',
      'margin-left: auto',
      'transition: transform 180ms ease-out',
      'font-size: 11px',
      `color: ${THEME.textMuted}`,
    ].join('; ');
    this.headerEl.appendChild(this.chevronEl);

    // Expandable body - 2 column grid
    this.bodyEl = document.createElement('div');
    this.bodyEl.style.cssText = [
      WarehouseHUD.PANEL_STYLE,
      'max-height: 0',
      'overflow: hidden',
      'transition: max-height 180ms ease-out',
      'border: none',
      `border-radius: 0 0 ${THEME.radiusMd} ${THEME.radiusMd}`,
      'pointer-events: auto',
      'display: grid',
      'grid-template-columns: 1fr 1fr',
      'gap: 0',
    ].join('; ');

    this.el.appendChild(this.headerEl);
    this.el.appendChild(this.bodyEl);
  }

  get isExpanded(): boolean { return this._expanded; }

  show(): void { this.el.style.display = 'block'; }

  hide(): void {
    this._expanded = false;
    this.bodyEl.style.maxHeight = '0';
    this.chevronEl.style.transform = '';
    this.headerEl.style.borderRadius = THEME.radiusMd;
    this.el.style.display = 'none';
  }

  /** @deprecated No longer needed - accordions are side-by-side, not stacked. */
  setTopOffset(_px: number): void {}

  update(resources: { wood: number; stone: number; iron: number; diamond: number; gold: number; food: number; weapons: number }): void {
    this.lastResources = resources;
    this.renderBody();
    if (this._expanded) {
      this.bodyEl.style.maxHeight = this.bodyEl.scrollHeight + 'px';
    }
  }

  expand(): void {
    if (this._expanded) return;
    this._expanded = true;
    this.headerEl.style.borderRadius = `${THEME.radiusMd} ${THEME.radiusMd} 0 0`;
    this.bodyEl.style.border = `1px solid ${THEME.borderDefault}`;
    this.bodyEl.style.borderTop = 'none';
    this.bodyEl.style.maxHeight = this.bodyEl.scrollHeight + 'px';
    this.chevronEl.style.transform = 'rotate(180deg)';
    this.onToggle?.(true);
  }

  collapse(): void {
    if (!this._expanded) return;
    this._expanded = false;
    this.headerEl.style.borderRadius = THEME.radiusMd;
    this.bodyEl.style.maxHeight = '0';
    this.bodyEl.style.border = 'none';
    this.chevronEl.style.transform = '';
    this.onToggle?.(false);
  }

  toggle(): void {
    if (this._expanded) this.collapse();
    else this.expand();
  }

  private renderBody(): void {
    this.bodyEl.innerHTML = '';
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const item = WarehouseHUD.ITEMS[i] as SlotDef | undefined;
      const cell = document.createElement('div');
      const isTop = i < 2;
      const isBottom = i >= TOTAL_SLOTS - 2;
      cell.style.cssText = [
        'display: flex',
        'align-items: center',
        'justify-content: space-between',
        'padding: 3px 10px',
        isTop ? 'padding-top: 8px' : '',
        isBottom ? 'padding-bottom: 8px' : '',
        'min-height: 22px',
      ].filter(Boolean).join('; ');

      if (item) {
        const left = document.createElement('span');
        left.innerHTML = `<span style="display:inline-block;width:10px;height:10px;background:${item.color};border-radius:2px;vertical-align:middle;margin-right:5px"></span>${item.label}`;

        const right = document.createElement('span');
        right.style.cssText = `color: ${THEME.textBright}; font-weight: bold; font-size: 11px;`;
        right.textContent = String(this.lastResources[item.key] ?? 0);

        cell.appendChild(left);
        cell.appendChild(right);
      } else {
        // Empty placeholder slot
        const dash = document.createElement('span');
        dash.textContent = '--';
        dash.style.cssText = `color: ${THEME.textDim}; font-size: 11px;`;
        cell.appendChild(dash);
      }

      this.bodyEl.appendChild(cell);
    }
  }
}
