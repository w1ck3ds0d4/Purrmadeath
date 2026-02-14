import { WALL_COST_WOOD } from '@shared/constants';

/**
 * DOM overlay shown while build mode is active.
 * Dark glass panel at bottom-left showing selected building + cost.
 */
export class BuildModeOverlay {
  private el: HTMLElement;
  private costEl: HTMLSpanElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'build-mode-overlay';
    this.el.style.cssText = [
      'position: absolute',
      'bottom: 100px',
      'left: 20px',
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

    this.costEl = document.createElement('span');
    this.costEl.style.fontWeight = 'bold';

    this.el.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = 'Wall';
    title.style.cssText = 'font-weight: bold; font-size: 14px; margin-bottom: 4px; color: #e8c96a;';
    this.el.appendChild(title);

    const costRow = document.createElement('div');
    costRow.style.cssText = 'margin-bottom: 6px;';
    costRow.appendChild(document.createTextNode('Cost: '));
    this.costEl.textContent = `${WALL_COST_WOOD} Wood`;
    costRow.appendChild(this.costEl);
    this.el.appendChild(costRow);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size: 11px; color: #6a7a8a;';
    hint.textContent = 'B to exit build mode';
    this.el.appendChild(hint);

    document.getElementById('overlay')!.appendChild(this.el);
  }

  show(): void {
    this.el.style.display = 'block';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  /** Update affordability color based on current wood count. */
  update(wood: number): void {
    const canAfford = wood >= WALL_COST_WOOD;
    this.costEl.style.color = canAfford ? '#8ade8a' : '#de5050';
    this.costEl.textContent = `${WALL_COST_WOOD} Wood`;
  }
}
