import { THEME, panelStyle, titleStyle, hintStyle } from '../theme';

export interface TrainingCenterCallbacks {
  onTrain: (buildingId: number, role: 'warrior' | 'ranger' | 'mage') => void;
  onClose: () => void;
}

/**
 * Guard House overlay - simplified from Training Center.
 * Shows a single "Train Guard" button with cost. Role is assigned randomly server-side.
 */
export class TrainingCenterOverlay {
  private el: HTMLElement;
  private visible = false;
  private callbacks: TrainingCenterCallbacks | null = null;
  private buildingId = -1;
  private guardCount = 0;
  private maxGuards = 2;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'guard-house-overlay';
    this.el.style.cssText = [
      panelStyle(),
      'position: absolute',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      'border-color: rgba(204, 136, 68, 0.3)',
      'padding: 20px 24px',
      'min-width: 280px',
      'display: none',
    ].join(';');
    document.body.appendChild(this.el);
  }

  setCallbacks(cb: TrainingCenterCallbacks): void {
    this.callbacks = cb;
  }

  get isVisible(): boolean { return this.visible; }

  show(buildingId: number, guardCount = 0, maxGuards = 2): void {
    this.buildingId = buildingId;
    this.guardCount = guardCount;
    this.maxGuards = maxGuards;
    this.visible = true;
    this.el.style.display = 'block';
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
    this.el.innerHTML = '';
  }

  private render(): void {
    this.el.innerHTML = '';

    // Title
    const title = document.createElement('div');
    title.textContent = 'Guard House';
    title.style.cssText = titleStyle(18) + '; color: #cc8844; margin-bottom: 4px;';
    this.el.appendChild(title);

    // Guard count
    const count = document.createElement('div');
    const atMax = this.guardCount >= this.maxGuards;
    count.textContent = `Guards: ${this.guardCount} / ${this.maxGuards}`;
    count.style.cssText = `font-size: 12px; color: ${atMax ? '#cc4444' : THEME.textSecondary}; text-align: center; margin-bottom: 14px;`;
    this.el.appendChild(count);

    // Cost display
    const costDiv = document.createElement('div');
    costDiv.style.cssText = `font-size: 11px; color: ${THEME.textMuted}; text-align: center; margin-bottom: 12px; line-height: 1.6;`;
    costDiv.textContent = 'Cost: 1 civilian + 20 food + 5 steel + 30 gold';
    this.el.appendChild(costDiv);

    // Train button
    const btn = document.createElement('div');
    const canTrain = !atMax;
    btn.style.cssText = [
      `background: ${canTrain ? THEME.surfaceBg : 'rgba(60,60,60,0.3)'}`,
      `border: 1px solid ${canTrain ? '#cc884466' : '#44444444'}`,
      `border-radius: ${THEME.radiusMd}`,
      'padding: 14px 16px',
      'text-align: center',
      `cursor: ${canTrain ? 'pointer' : 'not-allowed'}`,
      `opacity: ${canTrain ? '1' : '0.5'}`,
      `transition: background ${THEME.transition}, border-color ${THEME.transition}`,
    ].join(';');
    if (canTrain) {
      btn.addEventListener('mouseenter', () => {
        btn.style.background = THEME.surfaceHover;
        btn.style.borderColor = '#cc8844';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = THEME.surfaceBg;
        btn.style.borderColor = '#cc884466';
      });
      btn.addEventListener('click', () => {
        // Send with dummy role - server assigns random role
        this.callbacks?.onTrain(this.buildingId, 'warrior');
      });
    }

    const label = document.createElement('div');
    label.textContent = atMax ? 'Guard Capacity Full' : 'Train Guard (Random Role)';
    label.style.cssText = `font-size: 14px; font-weight: bold; color: ${canTrain ? '#cc8844' : THEME.textMuted};`;
    btn.appendChild(label);

    const desc = document.createElement('div');
    desc.textContent = 'Randomly assigned as Warrior, Ranger, or Mage';
    desc.style.cssText = `font-size: 10px; color: ${THEME.textSecondary}; margin-top: 4px;`;
    btn.appendChild(desc);

    this.el.appendChild(btn);

    // Close hint
    const close = document.createElement('div');
    close.textContent = 'Press ESC or E to close';
    close.style.cssText = hintStyle() + '; margin-top: 12px;';
    this.el.appendChild(close);
  }
}
