import { PLAYER_CARRY_LIMITS } from '@shared/constants';
import { THEME, hudStyle } from '../theme';

interface SlotDef {
  key: string;
  color: string;
  label: string;
}

/**
 * Top-center inventory accordion HUD.
 * Shows player resources in a collapsible panel. Open by default.
 */
export class ResourceHUD {
  readonly el: HTMLElement;
  private headerEl: HTMLElement;
  private bodyEl: HTMLElement;
  private arrowEl: HTMLElement;

  private _expanded = true;
  private _manualToggle = false;

  onToggle: ((expanded: boolean) => void) | null = null;

  private resources: Record<string, number> = {};

  private static readonly ITEMS: SlotDef[] = [
    { key: 'wood',    color: '#8a6a3a', label: 'Wood' },
    { key: 'stone',   color: '#999',    label: 'Stone' },
    { key: 'iron',    color: '#8a5a3a', label: 'Iron' },
    { key: 'diamond', color: '#44ccdd', label: 'Diamond' },
    { key: 'gold',    color: '#e0c030', label: 'Gold' },
  ];

  constructor() {
    // Outer container - positioned top center
    this.el = document.createElement('div');
    this.el.id = 'resource-hud';
    this.el.style.cssText = [
      'position: absolute',
      'top: 0',
      'left: 50%',
      'transform: translateX(-50%)',
      'z-index: 20',
      'pointer-events: auto',
      'display: none',
    ].join('; ');

    // Accordion wrapper
    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
      hudStyle(),
      `border: 1px solid ${THEME.borderDefault}`,
      'border-top: none',
      `border-radius: 0 0 ${THEME.radiusMd} ${THEME.radiusMd}`,
      'min-width: 240px',
      'overflow: hidden',
    ].join('; ');

    // Clickable header
    this.headerEl = document.createElement('div');
    this.headerEl.style.cssText = [
      'display: flex',
      'align-items: center',
      'justify-content: space-between',
      'padding: 6px 14px',
      'cursor: pointer',
      'user-select: none',
    ].join('; ');

    const titleEl = document.createElement('span');
    titleEl.style.cssText = `font-size:11px;font-weight:bold;color:${THEME.accent};letter-spacing:2px;`;
    titleEl.textContent = 'INVENTORY';
    this.headerEl.appendChild(titleEl);

    this.arrowEl = document.createElement('span');
    this.arrowEl.style.cssText = `font-size:10px;color:${THEME.textMuted};transition:transform 200ms;`;
    this.arrowEl.textContent = '\u25BC'; // Down arrow (expanded)
    this.headerEl.appendChild(this.arrowEl);

    this.headerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    wrapper.appendChild(this.headerEl);

    // Collapsible body (resource rows)
    this.bodyEl = document.createElement('div');
    this.bodyEl.style.cssText = [
      'padding: 0 14px 8px',
      'transition: max-height 200ms ease-out, opacity 150ms',
      'max-height: 200px',
      'opacity: 1',
      'overflow: hidden',
    ].join('; ');
    wrapper.appendChild(this.bodyEl);

    this.el.appendChild(wrapper);
    this.renderBody();
  }

  get isExpanded(): boolean { return this._expanded; }
  get isManuallyToggled(): boolean { return this._manualToggle; }
  resetManualToggle(): void { this._manualToggle = false; }

  setResources(wood: number, stone: number, iron: number, diamond: number, gold: number, _food: number = 0, _weapons: number = 0): void {
    this.resources = { ...this.resources, wood, stone, iron, diamond, gold };
    this.renderBody();
  }

  setVisible(visible: boolean): void {
    this.el.style.display = visible ? 'block' : 'none';
  }

  hide(): void { this.setVisible(false); }

  expand(): void {
    if (this._expanded) return;
    this._expanded = true;
    this.bodyEl.style.maxHeight = '200px';
    this.bodyEl.style.opacity = '1';
    this.arrowEl.textContent = '\u25BC';
    this.onToggle?.(true);
  }

  collapse(): void {
    if (!this._expanded) return;
    this._expanded = false;
    this.bodyEl.style.maxHeight = '0';
    this.bodyEl.style.opacity = '0';
    this.arrowEl.textContent = '\u25B6';
    this.onToggle?.(false);
  }

  toggle(): void {
    this._manualToggle = true;
    if (this._expanded) this.collapse();
    else this.expand();
  }

  private renderBody(): void {
    this.bodyEl.innerHTML = '';

    for (const item of ResourceHUD.ITEMS) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:2px 0;';

      const left = document.createElement('span');
      left.style.cssText = 'font-size:11px;display:flex;align-items:center;gap:5px;';
      left.innerHTML = `<span style="display:inline-block;width:8px;height:8px;background:${item.color};border-radius:2px;flex-shrink:0;"></span>${item.label}`;

      const right = document.createElement('span');
      right.style.cssText = `color:${THEME.textBright};font-weight:bold;font-size:11px;text-align:right;`;
      const cap = PLAYER_CARRY_LIMITS[item.key];
      const count = this.resources[item.key] ?? 0;
      if (cap !== undefined && cap !== Infinity) {
        const atCap = count >= cap;
        right.innerHTML = `${count}<span style="color:${atCap ? '#cc6644' : '#556'};font-weight:normal;font-size:10px">/${cap}</span>`;
      } else {
        right.textContent = String(count);
      }

      row.appendChild(left);
      row.appendChild(right);
      this.bodyEl.appendChild(row);
    }
  }
}
