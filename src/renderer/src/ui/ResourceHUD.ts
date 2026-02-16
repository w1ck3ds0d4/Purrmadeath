/**
 * Top-left overlay showing resource counters.
 *
 * Purely DOM-based, appended to #overlay, same pattern as WaveHUD.
 * Displays colored icons + counts for Wood, Stone, Iron, Diamond, Gold.
 */
export class ResourceHUD {
  private el: HTMLElement;

  private resources = { wood: 0, stone: 0, iron: 0, diamond: 0, gold: 0, food: 0 };

  private static readonly ITEMS: { key: keyof ResourceHUD['resources']; color: string; label: string }[] = [
    { key: 'wood',    color: '#8a6a3a', label: 'Wood' },
    { key: 'stone',   color: '#999',    label: 'Stone' },
    { key: 'iron',    color: '#8a5a3a', label: 'Iron' },
    { key: 'diamond', color: '#44ccdd', label: 'Diamond' },
    { key: 'gold',    color: '#e0c030', label: 'Gold' },
    { key: 'food',    color: '#44aa44', label: 'Food' },
  ];

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'resource-hud';
    this.el.style.cssText = [
      'position: absolute',
      'top: 16px',
      'left: 50%',
      'transform: translateX(-50%)',
      'z-index: 20',
      'background: rgba(4, 4, 10, 0.75)',
      'backdrop-filter: blur(4px)',
      'border: 1px solid rgba(255, 255, 255, 0.14)',
      'padding: 8px 14px',
      "font-family: 'Segoe UI', monospace",
      'font-size: 13px',
      'color: #ccd8ea',
      'letter-spacing: 0.5px',
      'pointer-events: none',
      'display: none',
      'white-space: nowrap',
    ].join('; ');
    document.getElementById('overlay')!.appendChild(this.el);
  }

  /** Update resource counts from RESOURCE_UPDATE. */
  setResources(wood: number, stone: number, iron: number, diamond: number, gold: number, food: number): void {
    this.resources = { wood, stone, iron, diamond, gold, food };
    this.render();
  }

  setVisible(visible: boolean): void {
    this.el.style.display = visible ? 'block' : 'none';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  private render(): void {
    const rows = ResourceHUD.ITEMS.map(({ key, color, label }) => {
      const count = this.resources[key];
      return `<span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:2px;vertical-align:middle;margin-right:5px"></span>${label} <span style="color:#fff;font-weight:bold">${count}</span>`;
    });
    this.el.innerHTML = rows.join('&nbsp;&nbsp;&nbsp;');
  }
}
