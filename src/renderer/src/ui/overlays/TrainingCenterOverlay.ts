import { THEME, panelStyle, titleStyle, hintStyle } from '../theme';

export interface TrainingCenterCallbacks {
  onTrain: (buildingId: number, role: 'warrior' | 'ranger' | 'mage') => void;
  onClose: () => void;
}

const ROLE_INFO: { role: 'warrior' | 'ranger' | 'mage'; label: string; color: string; desc: string }[] = [
  { role: 'warrior', label: 'Warrior', color: '#cc4444', desc: 'Melee tank - high HP, draws aggro' },
  { role: 'ranger',  label: 'Ranger',  color: '#44cc44', desc: 'Ranged DPS - piercing arrows' },
  { role: 'mage',    label: 'Mage',    color: '#6644ff', desc: 'Magic DPS - homing bolts, AoE' },
];

export class TrainingCenterOverlay {
  private el: HTMLElement;
  private visible = false;
  private callbacks: TrainingCenterCallbacks | null = null;
  private buildingId = -1;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'training-center-overlay';
    this.el.style.cssText = [
      panelStyle(),
      'position: absolute',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      'border-color: rgba(204, 136, 68, 0.3)',
      'padding: 20px 24px',
      'min-width: 320px',
      'display: none',
    ].join(';');
    document.body.appendChild(this.el);
  }

  setCallbacks(cb: TrainingCenterCallbacks): void {
    this.callbacks = cb;
  }

  get isVisible(): boolean { return this.visible; }

  show(buildingId: number): void {
    this.buildingId = buildingId;
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
    title.textContent = 'Training Center';
    title.style.cssText = titleStyle(18) + '; color: #cc8844; margin-bottom: 4px;';
    this.el.appendChild(title);

    // Subtitle
    const sub = document.createElement('div');
    sub.textContent = 'Cost: 1 weapon + 1 idle civilian';
    sub.style.cssText = `font-size: 11px; color: ${THEME.textSecondary}; text-align: center; margin-bottom: 16px;`;
    this.el.appendChild(sub);

    // Role buttons
    for (const info of ROLE_INFO) {
      const btn = document.createElement('div');
      btn.style.cssText = [
        `background: ${THEME.surfaceBg}`,
        `border: 1px solid ${info.color}55`,
        `border-radius: ${THEME.radiusMd}`,
        'padding: 12px 16px',
        'margin-bottom: 8px',
        'cursor: pointer',
        `transition: background ${THEME.transition}, border-color ${THEME.transition}`,
      ].join(';');
      btn.addEventListener('mouseenter', () => {
        btn.style.background = THEME.surfaceHover;
        btn.style.borderColor = info.color;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = THEME.surfaceBg;
        btn.style.borderColor = `${info.color}55`;
      });
      btn.addEventListener('click', () => {
        this.callbacks?.onTrain(this.buildingId, info.role);
      });

      const label = document.createElement('div');
      label.textContent = info.label;
      label.style.cssText = `font-size: 14px; font-weight: bold; color: ${info.color}; margin-bottom: 4px;`;
      btn.appendChild(label);

      const desc = document.createElement('div');
      desc.textContent = info.desc;
      desc.style.cssText = `font-size: 11px; color: ${THEME.textSecondary};`;
      btn.appendChild(desc);

      this.el.appendChild(btn);
    }

    // Close hint
    const close = document.createElement('div');
    close.textContent = 'Press ESC or E to close';
    close.style.cssText = hintStyle() + '; margin-top: 8px;';
    this.el.appendChild(close);
  }
}
