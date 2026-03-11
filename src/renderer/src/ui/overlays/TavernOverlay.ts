import { THEME, panelStyle, titleStyle, hintStyle } from '../theme';

export interface TavernHeroEntry {
  heroId: string;
  name: string;
  cost: number;
  hp: number;
  damage: number;
  ability: string;
}

export interface TavernCallbacks {
  onHire: (tavernId: number, heroId: string) => void;
  onClose: () => void;
}

const HERO_COLORS: Record<string, string> = {
  knight:    '#cc8844',
  archer:    '#44cc44',
  cleric:    '#66aaff',
  berserker: '#cc4444',
  wizard:    '#aa44ff',
  scout:     '#88cccc',
};

export class TavernOverlay {
  private el: HTMLElement;
  private visible = false;
  private callbacks: TavernCallbacks | null = null;
  private tavernId = -1;
  private roster: TavernHeroEntry[] = [];
  private activeCount = 0;
  private maxHeroes = 0;
  private gold = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'tavern-overlay';
    this.el.style.cssText = [
      panelStyle(),
      'position: absolute',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      'border-color: rgba(204, 170, 68, 0.3)',
      'padding: 20px 24px',
      'min-width: 380px',
      'max-width: 480px',
      'max-height: 70vh',
      'overflow-y: auto',
      'display: none',
    ].join(';');
    document.body.appendChild(this.el);
  }

  setCallbacks(cb: TavernCallbacks): void {
    this.callbacks = cb;
  }

  get isVisible(): boolean { return this.visible; }

  show(tavernId: number, roster: TavernHeroEntry[], activeCount: number, maxHeroes: number, gold: number): void {
    this.tavernId = tavernId;
    this.roster = roster;
    this.activeCount = activeCount;
    this.maxHeroes = maxHeroes;
    this.gold = gold;
    this.visible = true;
    this.el.style.display = 'block';
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
    this.el.innerHTML = '';
    this.callbacks?.onClose();
  }

  updateGold(gold: number): void {
    this.gold = gold;
    if (this.visible) this.render();
  }

  private render(): void {
    this.el.innerHTML = '';

    // Title
    const title = document.createElement('div');
    title.textContent = 'TAVERN';
    title.style.cssText = titleStyle(18) + '; color: #ccaa44; margin-bottom: 4px;';
    this.el.appendChild(title);

    // Hero count
    const countEl = document.createElement('div');
    const atMax = this.activeCount >= this.maxHeroes;
    countEl.textContent = `Heroes: ${this.activeCount} / ${this.maxHeroes}`;
    countEl.style.cssText = `font-size: 12px; color: ${atMax ? '#cc4444' : THEME.textSecondary}; text-align: center; margin-bottom: 14px;`;
    this.el.appendChild(countEl);

    // Gold display
    const goldEl = document.createElement('div');
    goldEl.textContent = `Gold: ${this.gold}`;
    goldEl.style.cssText = `font-size: 11px; color: #e8c96a; text-align: center; margin-bottom: 14px;`;
    this.el.appendChild(goldEl);

    // Roster
    if (this.roster.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No heroes available.';
      empty.style.cssText = `text-align: center; color: ${THEME.textMuted}; padding: 12px; font-size: 12px;`;
      this.el.appendChild(empty);
    }

    for (const hero of this.roster) {
      const color = HERO_COLORS[hero.heroId] ?? THEME.accent;
      const canAfford = this.gold >= hero.cost;
      const canHire = canAfford && !atMax;

      const card = document.createElement('div');
      card.style.cssText = [
        `background: ${THEME.surfaceBg}`,
        `border: 1px solid ${color}55`,
        `border-radius: ${THEME.radiusMd}`,
        'padding: 12px 16px',
        'margin-bottom: 8px',
        canHire ? 'cursor: pointer' : 'cursor: default',
        `transition: background ${THEME.transition}, border-color ${THEME.transition}`,
        canHire ? '' : 'opacity: 0.6',
      ].join(';');

      if (canHire) {
        card.addEventListener('mouseenter', () => {
          card.style.background = THEME.surfaceHover;
          card.style.borderColor = color;
        });
        card.addEventListener('mouseleave', () => {
          card.style.background = THEME.surfaceBg;
          card.style.borderColor = `${color}55`;
        });
        card.addEventListener('click', () => {
          this.callbacks?.onHire(this.tavernId, hero.heroId);
        });
      }

      // Name + cost row
      const header = document.createElement('div');
      header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;';

      const nameEl = document.createElement('span');
      nameEl.textContent = hero.name;
      nameEl.style.cssText = `font-size: 14px; font-weight: bold; color: ${color};`;
      header.appendChild(nameEl);

      const costEl = document.createElement('span');
      costEl.textContent = `${hero.cost}g`;
      costEl.style.cssText = `font-size: 12px; color: ${canAfford ? '#e8c96a' : '#cc4444'}; font-weight: bold;`;
      header.appendChild(costEl);

      card.appendChild(header);

      // Stats row
      const stats = document.createElement('div');
      stats.style.cssText = `font-size: 11px; color: ${THEME.textSecondary}; margin-bottom: 4px;`;
      stats.textContent = `HP: ${hero.hp}  |  DMG: ${hero.damage}`;
      card.appendChild(stats);

      // Ability
      const abilityEl = document.createElement('div');
      abilityEl.style.cssText = `font-size: 11px; color: ${THEME.textMuted}; font-style: italic;`;
      abilityEl.textContent = hero.ability;
      card.appendChild(abilityEl);

      // Reason text if can't hire
      if (!canHire) {
        const reason = document.createElement('div');
        reason.style.cssText = 'font-size: 10px; color: #cc4444; margin-top: 4px;';
        reason.textContent = atMax ? 'Max heroes reached' : 'Not enough gold';
        card.appendChild(reason);
      }

      this.el.appendChild(card);
    }

    // Close hint
    const close = document.createElement('div');
    close.textContent = 'Press ESC or E to close';
    close.style.cssText = hintStyle() + '; margin-top: 8px;';
    this.el.appendChild(close);
  }
}
