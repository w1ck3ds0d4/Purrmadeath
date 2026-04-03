/**
 * Market card shop overlay.
 * Shows 3 cards with gold prices. Player can buy 1 per day.
 */
import { THEME, panelStyle, titleStyle, hintStyle } from '../theme';
import { CATEGORY_COLORS, RARITY_BORDER_COLORS, type CardCategory } from '@shared/definitions/CardDefinitions';
import type { MarketCardInfo } from '@shared/protocol';

export interface MarketCallbacks {
  onBuy: (buildingId: number, cardIndex: number) => void;
  onClose: () => void;
}

export class MarketOverlay {
  private el: HTMLElement;
  private visible = false;
  private callbacks: MarketCallbacks | null = null;
  private buildingId = -1;
  private cards: MarketCardInfo[] = [];
  private boughtThisDay = false;
  private playerGold = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'market-overlay';
    this.el.style.cssText = [
      panelStyle(),
      'position: absolute',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      'padding: 24px 28px',
      'min-width: 520px',
      'display: none',
    ].join(';');
    document.body.appendChild(this.el);
  }

  setCallbacks(cb: MarketCallbacks): void {
    this.callbacks = cb;
  }

  get isVisible(): boolean { return this.visible; }

  show(buildingId: number, cards: MarketCardInfo[], boughtThisDay: boolean, playerGold: number): void {
    this.buildingId = buildingId;
    this.cards = cards;
    this.boughtThisDay = boughtThisDay;
    this.playerGold = playerGold;
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
    title.textContent = 'Market';
    title.style.cssText = titleStyle(20) + '; margin-bottom: 4px;';
    this.el.appendChild(title);

    // Subtitle
    const sub = document.createElement('div');
    sub.textContent = this.boughtThisDay ? 'Already purchased today - come back next wave' : 'Choose 1 card to buy';
    sub.style.cssText = `font-size: 11px; color: ${this.boughtThisDay ? '#cc4444' : THEME.textSecondary}; text-align: center; margin-bottom: 6px;`;
    this.el.appendChild(sub);

    // Gold display
    const goldDiv = document.createElement('div');
    goldDiv.textContent = `Your gold: ${this.playerGold}`;
    goldDiv.style.cssText = 'font-size: 12px; color: #e0c030; text-align: center; margin-bottom: 16px;';
    this.el.appendChild(goldDiv);

    // Card row
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 12px; justify-content: center;';

    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const canAfford = this.playerGold >= card.goldPrice;
      const canBuy = !this.boughtThisDay && canAfford;

      const panel = document.createElement('div');
      const catColorNum = CATEGORY_COLORS[card.category as CardCategory] ?? 0xd4c4b8;
      const catColor = `#${catColorNum.toString(16).padStart(6, '0')}`;
      const rarityColor = (RARITY_BORDER_COLORS as Record<string, string>)[card.rarity] ?? '#666';
      panel.style.cssText = [
        `background: ${THEME.surfaceBg}`,
        `border: 2px solid ${rarityColor}`,
        `border-radius: ${THEME.radiusMd}`,
        'padding: 14px 12px',
        'width: 150px',
        'display: flex',
        'flex-direction: column',
        'align-items: center',
        'gap: 6px',
        `opacity: ${canBuy ? '1' : '0.5'}`,
        `cursor: ${canBuy ? 'pointer' : 'not-allowed'}`,
        `transition: background ${THEME.transition}, border-color ${THEME.transition}`,
      ].join(';');

      if (canBuy) {
        panel.addEventListener('mouseenter', () => {
          panel.style.background = THEME.surfaceHover;
          panel.style.borderColor = '#ffffff44';
        });
        panel.addEventListener('mouseleave', () => {
          panel.style.background = THEME.surfaceBg;
          panel.style.borderColor = rarityColor;
        });
        panel.addEventListener('click', () => {
          this.callbacks?.onBuy(this.buildingId, i);
        });
      }

      // Rarity label
      const rarityEl = document.createElement('div');
      rarityEl.textContent = card.rarity.toUpperCase();
      rarityEl.style.cssText = `font-size: 9px; color: ${rarityColor}; letter-spacing: 1px; font-weight: bold;`;
      panel.appendChild(rarityEl);

      // Card name
      const nameEl = document.createElement('div');
      nameEl.textContent = card.name;
      nameEl.style.cssText = `font-size: 13px; font-weight: bold; color: ${catColor}; text-align: center;`;
      panel.appendChild(nameEl);

      // Description
      const descEl = document.createElement('div');
      descEl.textContent = card.description;
      descEl.style.cssText = `font-size: 10px; color: ${THEME.textSecondary}; text-align: center; line-height: 1.4; flex: 1;`;
      panel.appendChild(descEl);

      // Price
      const priceEl = document.createElement('div');
      priceEl.textContent = `${card.goldPrice} gold`;
      priceEl.style.cssText = `font-size: 12px; font-weight: bold; color: ${canAfford ? '#e0c030' : '#cc4444'}; margin-top: 4px;`;
      panel.appendChild(priceEl);

      row.appendChild(panel);
    }

    this.el.appendChild(row);

    // Close hint
    const close = document.createElement('div');
    close.textContent = 'Press ESC or E to close';
    close.style.cssText = hintStyle() + '; margin-top: 14px;';
    this.el.appendChild(close);
  }
}
