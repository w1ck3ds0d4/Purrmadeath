import type { CardDefinition } from '@shared/definitions/CardDefinitions';
import { CATEGORY_COLORS, RARITY_BORDER_COLORS } from '@shared/definitions/CardDefinitions';

/** Duration of each phase in seconds. */
const PRE_REVEAL_DURATION = 5;
const FLIP_DURATION = 0.8;
const PICK_DURATION = 30;

/**
 * Full-screen overlay showing 3 card choices after a wave clear.
 * Flow: 5s countdown → cards flip reveal → 30s to pick.
 */
export class CardPickerOverlay {
  private screen: HTMLElement;
  private countdownEl: HTMLElement;
  private timerBarOuter: HTMLElement;
  private timerBarInner: HTMLElement;
  private cardRow: HTMLElement;
  private titleEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private onPick: ((cardId: string) => void) | null = null;

  private animFrame = 0;
  private phase: 'hidden' | 'countdown' | 'flipping' | 'picking' = 'hidden';
  private phaseTime = 0;
  private cards: CardDefinition[] = [];
  private cardPanels: HTMLElement[] = [];

  constructor() {
    this.screen = document.createElement('div');
    this.screen.className = 'screen';
    this.screen.id = 'card-picker-screen';
    this.screen.style.display = 'none';

    // Pre-reveal countdown
    this.countdownEl = document.createElement('div');
    this.countdownEl.style.cssText = `
      font-family: 'Segoe UI', sans-serif;
      font-size: 72px;
      font-weight: 700;
      color: #ccd8ea;
      text-shadow: 0 0 30px rgba(100,160,255,0.4);
      user-select: none;
      position: absolute;
      transition: transform 0.3s ease, opacity 0.3s ease;
    `;

    this.titleEl = document.createElement('h2');
    this.titleEl.style.cssText = "font-family:'Segoe UI',sans-serif;font-size:26px;font-weight:700;color:#ccd8ea;letter-spacing:4px;margin-bottom:8px;user-select:none;opacity:0;transition:opacity 0.4s ease;";
    this.titleEl.textContent = 'CHOOSE A CARD';

    this.subtitleEl = document.createElement('p');
    this.subtitleEl.style.cssText = 'font-family:monospace;font-size:12px;color:#6a7a8a;margin-bottom:24px;user-select:none;opacity:0;transition:opacity 0.4s ease;';

    this.cardRow = document.createElement('div');
    this.cardRow.style.cssText = 'display:flex;gap:24px;justify-content:center;flex-wrap:wrap;';

    // Pick timer bar
    this.timerBarOuter = document.createElement('div');
    this.timerBarOuter.style.cssText = 'width:300px;height:4px;background:rgba(255,255,255,0.1);margin-top:24px;border-radius:2px;overflow:hidden;opacity:0;transition:opacity 0.4s ease;';
    this.timerBarInner = document.createElement('div');
    this.timerBarInner.style.cssText = 'width:100%;height:100%;background:#44aaff;border-radius:2px;transition:background 0.3s ease;';
    this.timerBarOuter.appendChild(this.timerBarInner);

    this.screen.append(this.countdownEl, this.titleEl, this.subtitleEl, this.cardRow, this.timerBarOuter);
    document.getElementById('overlay')!.appendChild(this.screen);
  }

  show(cards: CardDefinition[], onPick: (cardId: string) => void): void {
    this.onPick = onPick;
    this.cards = cards;
    this.cardPanels = [];
    this.cardRow.innerHTML = '';

    // Reset UI
    this.countdownEl.style.opacity = '1';
    this.countdownEl.style.display = 'block';
    this.titleEl.style.opacity = '0';
    this.subtitleEl.style.opacity = '0';
    this.timerBarOuter.style.opacity = '0';
    this.timerBarInner.style.width = '100%';
    this.timerBarInner.style.background = '#44aaff';

    // Build card backs (hidden initially)
    for (const card of cards) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'perspective:600px;width:240px;';

      const flipper = document.createElement('div');
      flipper.style.cssText = `
        width: 240px;
        position: relative;
        transform-style: preserve-3d;
        transform: rotateY(180deg);
        transition: transform ${FLIP_DURATION}s ease;
      `;

      // Front face (card content)
      const front = this.buildCardFace(card);
      front.style.backfaceVisibility = 'hidden';
      front.style.position = 'relative';
      front.style.zIndex = '1';

      // Back face
      const back = document.createElement('div');
      back.style.cssText = `
        width: 240px;
        padding: 24px 20px;
        box-sizing: border-box;
        background: linear-gradient(135deg, #1a1a2e 0%, #0a0a1a 100%);
        border: 2px solid #2a3a4a;
        display: flex;
        align-items: center;
        justify-content: center;
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        backface-visibility: hidden;
        transform: rotateY(180deg);
      `;
      const backPattern = document.createElement('div');
      backPattern.style.cssText = `
        width: 40px; height: 40px;
        border: 3px solid #2a3a5a;
        border-radius: 50%;
        position: relative;
      `;
      const innerDiamond = document.createElement('div');
      innerDiamond.style.cssText = `
        width: 16px; height: 16px;
        border: 2px solid #3a4a6a;
        transform: rotate(45deg);
        position: absolute;
        top: 50%; left: 50%;
        margin-top: -8px; margin-left: -8px;
      `;
      backPattern.appendChild(innerDiamond);
      back.appendChild(backPattern);

      flipper.append(front, back);
      wrapper.appendChild(flipper);
      wrapper.style.opacity = '0';
      this.cardRow.appendChild(wrapper);
      this.cardPanels.push(wrapper);
      // Store flipper ref on wrapper for animation access
      (wrapper as any)._flipper = flipper;
      (wrapper as any)._front = front;
      (wrapper as any)._cardId = card.id;
    }

    this.phase = 'countdown';
    this.phaseTime = 0;
    this.screen.style.display = 'flex';

    cancelAnimationFrame(this.animFrame);
    let lastTime = performance.now();
    const tick = (now: number) => {
      if (this.phase === 'hidden') return;
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      this.phaseTime += dt;
      this.tickPhase();
      this.animFrame = requestAnimationFrame(tick);
    };
    this.animFrame = requestAnimationFrame(tick);
  }

  private tickPhase(): void {
    if (this.phase === 'countdown') {
      const remaining = Math.ceil(PRE_REVEAL_DURATION - this.phaseTime);
      this.countdownEl.textContent = remaining <= 0 ? '' : String(remaining);

      // Pulse effect on number change
      const frac = (this.phaseTime % 1);
      const scale = frac < 0.15 ? 1 + (0.15 - frac) * 2 : 1;
      this.countdownEl.style.transform = `scale(${scale})`;

      if (this.phaseTime >= PRE_REVEAL_DURATION) {
        this.phase = 'flipping';
        this.phaseTime = 0;
        this.countdownEl.style.opacity = '0';
        this.countdownEl.style.display = 'none';
        this.titleEl.style.opacity = '1';

        // Show cards (still face-down) with staggered entrance
        for (let i = 0; i < this.cardPanels.length; i++) {
          const panel = this.cardPanels[i];
          setTimeout(() => {
            panel.style.opacity = '1';
            panel.style.transition = 'opacity 0.3s ease';
          }, i * 100);
          // Trigger flip after appearing
          setTimeout(() => {
            const flipper = (panel as any)._flipper as HTMLElement;
            flipper.style.transform = 'rotateY(0deg)';
          }, i * 150 + 200);
        }
      }
    } else if (this.phase === 'flipping') {
      // Wait for flip animation to finish
      if (this.phaseTime >= FLIP_DURATION + 0.4) {
        this.phase = 'picking';
        this.phaseTime = 0;
        this.subtitleEl.textContent = `${PICK_DURATION}s to choose`;
        this.subtitleEl.style.opacity = '1';
        this.timerBarOuter.style.opacity = '1';

        // Enable click handlers
        for (const panel of this.cardPanels) {
          const front = (panel as any)._front as HTMLElement;
          const cardId = (panel as any)._cardId as string;
          front.style.pointerEvents = 'auto';
          front.style.cursor = 'pointer';
          front.addEventListener('click', () => {
            this.hide();
            this.onPick?.(cardId);
          });
        }
      }
    } else if (this.phase === 'picking') {
      const remaining = Math.max(0, PICK_DURATION - this.phaseTime);
      const pct = (remaining / PICK_DURATION) * 100;
      this.timerBarInner.style.width = `${pct}%`;
      this.subtitleEl.textContent = `${Math.ceil(remaining)}s to choose`;

      // Change color when low
      if (remaining <= 5) {
        this.timerBarInner.style.background = '#cc4444';
        this.subtitleEl.style.color = '#cc4444';
      } else if (remaining <= 10) {
        this.timerBarInner.style.background = '#ddaa22';
        this.subtitleEl.style.color = '#ddaa22';
      }
    }
  }

  private buildCardFace(card: CardDefinition): HTMLElement {
    const panel = document.createElement('div');
    const catColor = CATEGORY_COLORS[card.category];
    const borderColor = RARITY_BORDER_COLORS[card.rarity];
    const isTrap = card.category === 'trap';

    const catHex = '#' + catColor.toString(16).padStart(6, '0');
    panel.style.cssText = `
      width: 240px;
      padding: 24px 20px;
      box-sizing: border-box;
      background: rgba(10,10,20,0.92);
      border: 2px solid ${borderColor};
      border-top: 3px solid ${catHex};
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      transition: transform 0.15s ease, border-color 0.15s ease;
      user-select: none;
      pointer-events: none;
    `;

    const catLabel = document.createElement('div');
    catLabel.style.cssText = `font-family:monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${catHex};`;
    catLabel.textContent = card.category;

    const nameEl = document.createElement('div');
    nameEl.style.cssText = `font-family:'Segoe UI',sans-serif;font-size:20px;font-weight:700;color:${isTrap ? '#cc4444' : '#ccd8ea'};text-align:center;`;
    nameEl.textContent = card.name;

    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-family:monospace;font-size:13px;color:#8a9ab0;text-align:center;line-height:1.5;';
    descEl.textContent = card.description;

    const rarityEl = document.createElement('div');
    rarityEl.style.cssText = `font-family:monospace;font-size:11px;letter-spacing:1px;color:${borderColor};margin-top:auto;`;
    rarityEl.textContent = card.rarity.toUpperCase();

    if (isTrap) {
      const warn = document.createElement('div');
      warn.style.cssText = 'font-family:monospace;font-size:10px;color:#cc4444;letter-spacing:1px;';
      warn.textContent = 'AFFECTS ALL PLAYERS';
      panel.append(catLabel, nameEl, descEl, warn, rarityEl);
    } else {
      panel.append(catLabel, nameEl, descEl, rarityEl);
    }

    panel.addEventListener('mouseenter', () => {
      if (panel.style.pointerEvents === 'none') return;
      panel.style.transform = 'scale(1.05)';
      panel.style.borderColor = isTrap ? '#cc4444' : 'rgba(255,255,255,0.5)';
    });
    panel.addEventListener('mouseleave', () => {
      panel.style.transform = 'scale(1)';
      panel.style.borderColor = borderColor;
    });

    return panel;
  }

  hide(): void {
    this.phase = 'hidden';
    this.screen.style.display = 'none';
    cancelAnimationFrame(this.animFrame);
  }

  get isVisible(): boolean {
    return this.phase !== 'hidden';
  }

  /** True only during the picking phase (when player must choose a card). */
  get isPicking(): boolean {
    return this.phase === 'picking';
  }
}
