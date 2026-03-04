import { PLAYER_COLORS } from '@shared/constants';
import { THEME } from '../theme';

const IDLE_DELAY_MS = 4_000;
const FADE_MS = 1_500;
const MIN_OPACITY = 0.12;
const MAX_HISTORY = 50;

type SendHandler = (text: string) => void;

interface ChatEntry {
  displayName: string;
  slot: number;
  text: string;
  timestamp: string;
}

function timeStamp(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * MMORPG-style in-game chat panel.
 * Always visible; fades to transparent when idle.
 * Press Enter to activate (type + send). ESC or Enter to deactivate.
 */
export class ChatOverlay {
  private el: HTMLElement;
  private panelEl: HTMLElement;
  private titleBarEl: HTMLElement;
  private feedEl: HTMLElement;
  private inputRowEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private sendBtnEl: HTMLButtonElement;

  private active = false;
  private sendHandler: SendHandler | null = null;
  private history: ChatEntry[] = [];
  private idleAge = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'chat-overlay';
    this.el.style.cssText = [
      'position: absolute',
      'bottom: 12px',
      'left: 12px',
      'z-index: 35',
      'display: flex',
      'flex-direction: column',
      'pointer-events: none',
      'user-select: none',
    ].join('; ');

    // ── Panel ──
    this.panelEl = document.createElement('div');
    this.panelEl.style.cssText = [
      'width: 420px',
      `background: ${THEME.panelBg}`,
      `border: 1px solid ${THEME.borderAccent}`,
      `border-radius: ${THEME.radiusMd}`,
      'overflow: hidden',
      'pointer-events: auto',
      `backdrop-filter: ${THEME.blurHeavy}`,
      `box-shadow: ${THEME.panelGlow}`,
      `opacity: ${MIN_OPACITY}`,
      'transition: opacity 0.3s ease',
    ].join('; ');

    // Title bar
    this.titleBarEl = document.createElement('div');
    this.titleBarEl.style.cssText = [
      'display: flex',
      'align-items: center',
      'justify-content: space-between',
      'padding: 6px 12px',
      `background: ${THEME.accentRgba(0.08)}`,
      `border-bottom: 1px solid ${THEME.accentRgba(0.2)}`,
    ].join('; ');

    const titleText = document.createElement('span');
    titleText.textContent = 'CHAT';
    titleText.style.cssText = [
      `font-family: ${THEME.fontUI}`,
      'font-size: 11px',
      'font-weight: bold',
      `color: ${THEME.accent}`,
      'letter-spacing: 2px',
      'text-transform: uppercase',
    ].join('; ');
    this.titleBarEl.appendChild(titleText);

    const closeHint = document.createElement('span');
    closeHint.textContent = 'ESC to close';
    closeHint.style.cssText = [
      `font-family: ${THEME.fontUI}`,
      'font-size: 10px',
      `color: ${THEME.textMuted}`,
    ].join('; ');
    this.titleBarEl.appendChild(closeHint);
    this.panelEl.appendChild(this.titleBarEl);

    // Message feed area
    this.feedEl = document.createElement('div');
    this.feedEl.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'gap: 1px',
      'padding: 8px 10px',
      'height: 200px',
      'overflow-y: auto',
      `font-family: ${THEME.fontUI}`,
      'font-size: 12px',
    ].join('; ');
    const scrollCSS = document.createElement('style');
    scrollCSS.textContent = `
      #chat-feed::-webkit-scrollbar { width: 6px; }
      #chat-feed::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 3px; }
      #chat-feed::-webkit-scrollbar-thumb { background: ${THEME.accentRgba(0.3)}; border-radius: 3px; }
      #chat-feed::-webkit-scrollbar-thumb:hover { background: ${THEME.accentRgba(0.5)}; }
    `;
    document.head.appendChild(scrollCSS);
    this.feedEl.id = 'chat-feed';
    this.panelEl.appendChild(this.feedEl);

    // Input row (hidden when inactive)
    this.inputRowEl = document.createElement('div');
    this.inputRowEl.style.cssText = [
      'display: none',
      'align-items: center',
      'gap: 0',
      'padding: 6px 8px',
      `border-top: 1px solid ${THEME.accentRgba(0.15)}`,
      'background: rgba(0, 0, 0, 0.3)',
    ].join('; ');

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.maxLength = 200;
    this.inputEl.spellcheck = false;
    this.inputEl.autocomplete = 'off';
    this.inputEl.placeholder = 'Type a message...';
    this.inputEl.style.cssText = [
      'flex: 1',
      'background: rgba(0, 0, 0, 0.5)',
      'border: 1px solid rgba(255, 255, 255, 0.1)',
      'border-radius: 3px 0 0 3px',
      'padding: 6px 10px',
      `color: ${THEME.textPrimary}`,
      `font-family: ${THEME.fontUI}`,
      'font-size: 12px',
      'outline: none',
    ].join('; ');

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.trySend();
        this.hide();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
      e.stopPropagation();
    });
    this.inputEl.addEventListener('mousedown', (e) => e.stopPropagation());

    this.sendBtnEl = document.createElement('button');
    this.sendBtnEl.textContent = 'Send';
    this.sendBtnEl.style.cssText = [
      `background: ${THEME.accentRgba(0.15)}`,
      `border: 1px solid ${THEME.accentRgba(0.3)}`,
      'border-left: none',
      `border-radius: 0 ${THEME.radiusSm} ${THEME.radiusSm} 0`,
      'padding: 6px 14px',
      `color: ${THEME.accent}`,
      `font-family: ${THEME.fontUI}`,
      'font-size: 11px',
      'font-weight: bold',
      'cursor: pointer',
      'letter-spacing: 1px',
      'transition: background 0.15s',
    ].join('; ');
    this.sendBtnEl.addEventListener('mouseenter', () => {
      this.sendBtnEl.style.background = THEME.accentRgba(0.25);
    });
    this.sendBtnEl.addEventListener('mouseleave', () => {
      this.sendBtnEl.style.background = THEME.accentRgba(0.15);
    });
    this.sendBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.trySend();
      this.inputEl.focus();
    });
    this.sendBtnEl.addEventListener('mousedown', (e) => e.stopPropagation());

    this.inputRowEl.appendChild(this.inputEl);
    this.inputRowEl.appendChild(this.sendBtnEl);
    this.panelEl.appendChild(this.inputRowEl);

    this.el.appendChild(this.panelEl);
    document.getElementById('overlay')!.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.active;
  }

  onSend(handler: SendHandler): void {
    this.sendHandler = handler;
  }

  show(): void {
    if (this.active) return;
    this.active = true;
    this.idleAge = 0;
    this.panelEl.style.opacity = '1';
    this.inputRowEl.style.display = 'flex';
    this.inputEl.value = '';
    this.inputEl.focus();
    this.feedEl.scrollTop = this.feedEl.scrollHeight;
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.inputRowEl.style.display = 'none';
    this.inputEl.value = '';
    this.inputEl.blur();
    // Reset idle timer so panel stays visible briefly after closing
    this.idleAge = 0;
    this.panelEl.style.opacity = '1';
  }

  /** Hide/show the entire chat container (used on menu transitions). */
  setActive(active: boolean): void {
    this.el.style.display = active ? 'flex' : 'none';
    if (!active) {
      this.active = false;
      this.inputRowEl.style.display = 'none';
      this.inputEl.value = '';
      this.inputEl.blur();
      this.history.length = 0;
      this.feedEl.innerHTML = '';
      this.idleAge = 0;
    }
  }

  addMessage(displayName: string, slot: number, text: string): void {
    const entry: ChatEntry = { displayName, slot, text, timestamp: timeStamp() };
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) this.history.shift();

    this.appendLine(entry);
    while (this.feedEl.children.length > MAX_HISTORY) {
      this.feedEl.removeChild(this.feedEl.firstChild!);
    }
    this.feedEl.scrollTop = this.feedEl.scrollHeight;

    // New message bumps panel to full opacity
    if (!this.active) {
      this.idleAge = 0;
      this.panelEl.style.opacity = '1';
    }
  }

  /** Tick each frame with dt in seconds. Fades the panel when idle. */
  update(dt: number): void {
    if (this.active) return;

    this.idleAge += dt * 1000;
    if (this.idleAge > IDLE_DELAY_MS) {
      const fadeProgress = Math.min(1, (this.idleAge - IDLE_DELAY_MS) / FADE_MS);
      const opacity = 1 - fadeProgress * (1 - MIN_OPACITY);
      this.panelEl.style.opacity = opacity.toFixed(2);
    }
  }

  private trySend(): void {
    const text = this.inputEl.value.trim();
    if (text) this.sendHandler?.(text);
    this.inputEl.value = '';
  }

  /** Append a message line to the feed. */
  private appendLine(entry: ChatEntry): HTMLElement {
    const line = document.createElement('div');
    line.style.cssText = [
      'padding: 3px 4px',
      'border-radius: 2px',
      'line-height: 1.4',
      'word-wrap: break-word',
    ].join('; ');

    const tsSpan = document.createElement('span');
    tsSpan.style.cssText = `color: ${THEME.textDim}; font-size: 10px; margin-right: 6px;`;
    tsSpan.textContent = `[${entry.timestamp}]`;
    line.appendChild(tsSpan);

    const nameSpan = document.createElement('span');
    const color = PLAYER_COLORS[entry.slot] ?? 0xd8e2ef;
    nameSpan.style.cssText = `color: #${color.toString(16).padStart(6, '0')}; font-weight: 700;`;
    nameSpan.textContent = entry.displayName;
    line.appendChild(nameSpan);

    const textSpan = document.createElement('span');
    textSpan.style.color = THEME.textPrimary;
    textSpan.textContent = ': ' + entry.text;
    line.appendChild(textSpan);

    this.feedEl.appendChild(line);
    return line;
  }
}
