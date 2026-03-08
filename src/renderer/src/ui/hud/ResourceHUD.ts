import { PLAYER_CARRY_LIMITS } from '@shared/constants';
import { THEME, hudStyle } from '../theme';

interface SlotDef {
  key: string;
  color: string;
  label: string;
}

/**
 * Left-side sliding drawer inventory HUD.
 * Slides in from the left edge. Click tab handle to toggle.
 */
export class ResourceHUD {
  readonly el: HTMLElement;
  private panelEl: HTMLElement;
  private handleEl: HTMLElement;

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
    // Outer container - handles the sliding transform
    this.el = document.createElement('div');
    this.el.id = 'resource-hud';
    this.el.style.cssText = [
      'display: flex',
      'align-items: stretch',
      'pointer-events: auto',
      'transition: transform 200ms ease-out',
    ].join('; ');

    // Panel with resources
    this.panelEl = document.createElement('div');
    this.panelEl.style.cssText = [
      hudStyle(),
      `border: 1px solid ${THEME.borderDefault}`,
      'border-left: none',
      'padding: 6px 14px 8px',
      'width: 170px',
      'box-sizing: border-box',
    ].join('; ');

    // Title
    const title = document.createElement('div');
    title.textContent = 'INVENTORY';
    title.style.cssText = `font-size:10px;font-weight:bold;color:${THEME.accent};letter-spacing:2px;margin-bottom:4px;text-align:center;`;
    this.panelEl.appendChild(title);

    this.el.appendChild(this.panelEl);

    // Tab handle (attached to right edge of panel)
    this.handleEl = document.createElement('div');
    this.handleEl.style.cssText = [
      'cursor: pointer',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'width: 16px',
      `background: ${THEME.panelBg}`,
      `border: 1px solid ${THEME.borderDefault}`,
      'border-left: none',
      `border-radius: 0 ${THEME.radiusSm} ${THEME.radiusSm} 0`,
      `color: ${THEME.textMuted}`,
      'font-size: 10px',
      'user-select: none',
    ].join('; ');
    this.handleEl.textContent = '\u25C0';
    this.handleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.el.appendChild(this.handleEl);

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
    this.el.style.display = visible ? 'flex' : 'none';
  }

  hide(): void { this.setVisible(false); }

  expand(): void {
    if (this._expanded) return;
    this._expanded = true;
    this.el.style.transform = 'translateX(0)';
    this.handleEl.textContent = '\u25C0';
    this.onToggle?.(true);
  }

  collapse(): void {
    if (!this._expanded) return;
    this._expanded = false;
    // Slide left by the panel width, keeping the handle visible
    this.el.style.transform = `translateX(-170px)`;
    this.handleEl.textContent = '\u25B6';
    this.onToggle?.(false);
  }

  toggle(): void {
    this._manualToggle = true;
    if (this._expanded) this.collapse();
    else this.expand();
  }

  private renderBody(): void {
    // Keep title, rebuild resource rows
    const title = this.panelEl.firstElementChild;
    this.panelEl.innerHTML = '';
    if (title) this.panelEl.appendChild(title);

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
      this.panelEl.appendChild(row);
    }
  }
}
