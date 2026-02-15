const RES_COLORS: Record<string, string> = {
  wood: '#8a6a3a',
  stone: '#999',
  iron: '#b08060',
  diamond: '#44ccdd',
  gold: '#e8c96a',
};

/**
 * Displays the shared warehouse resource pool below the personal ResourceHUD.
 * Only visible when at least one warehouse exists in the session.
 */
export class WarehouseHUD {
  private el: HTMLElement;
  private bodyEl: HTMLElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'warehouse-hud';
    this.el.style.cssText = [
      'position: absolute',
      'top: 48px',
      'left: 50%',
      'transform: translateX(-50%)',
      'z-index: 15',
      'background: rgba(4, 4, 10, 0.75)',
      'backdrop-filter: blur(4px)',
      'border: 1px solid rgba(255, 255, 255, 0.14)',
      'padding: 6px 14px',
      "font-family: 'Segoe UI', monospace",
      'font-size: 12px',
      'color: #ccd8ea',
      'pointer-events: none',
      'display: none',
      'white-space: nowrap',
    ].join('; ');

    const title = document.createElement('span');
    title.style.cssText = 'font-weight: bold; color: #c8a050; margin-right: 10px;';
    title.textContent = 'Warehouse';
    this.el.appendChild(title);

    this.bodyEl = document.createElement('span');
    this.el.appendChild(this.bodyEl);

    document.getElementById('overlay')!.appendChild(this.el);
  }

  show(): void { this.el.style.display = 'block'; }
  hide(): void { this.el.style.display = 'none'; }

  update(resources: { wood: number; stone: number; iron: number; diamond: number; gold: number }): void {
    const parts: string[] = [];
    for (const [key, val] of Object.entries(resources)) {
      if (key === 'gold') continue; // skip gold in display for now
      const color = RES_COLORS[key] ?? '#ccc';
      parts.push(`<span style="color:${color}">${val} ${key.charAt(0).toUpperCase() + key.slice(1)}</span>`);
    }
    this.bodyEl.innerHTML = parts.join('&nbsp;&nbsp;');
  }
}
