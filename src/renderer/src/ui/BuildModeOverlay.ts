import { BUILDING_COSTS } from '@shared/constants';

const RES_COLORS: Record<string, string> = {
  wood: '#8a6a3a',
  stone: '#999',
  iron: '#b08060',
  diamond: '#44ccdd',
};

export class BuildModeOverlay {
  private el: HTMLElement;
  private titleEl: HTMLElement;
  private costEl: HTMLElement;

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

    this.costEl = document.createElement('div');
    this.costEl.style.cssText = 'margin-bottom: 6px; font-weight: bold;';
    this.el.appendChild(this.costEl);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size: 11px; color: #6a7a8a;';
    hint.textContent = 'Scroll to change \u00B7 B to exit \u00B7 Right-click to demolish';
    this.el.appendChild(hint);

    document.getElementById('overlay')!.appendChild(this.el);
  }

  show(): void { this.el.style.display = 'block'; }
  hide(): void { this.el.style.display = 'none'; }

  update(buildingType: string, available: Record<string, number>): void {
    this.titleEl.textContent = buildingType.charAt(0).toUpperCase() + buildingType.slice(1);
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
  }
}
