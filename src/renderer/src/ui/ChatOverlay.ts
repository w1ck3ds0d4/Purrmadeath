import { PLAYER_COLORS } from '@shared/constants';

const MESSAGE_VISIBLE_MS = 8_000;
const MESSAGE_FADE_MS = 1_000;
const MAX_HISTORY = 30;

type SendHandler = (text: string) => void;

interface ChatEntry {
  displayName: string;
  slot: number;
  text: string;
}

/**
 * In-game chat overlay. Press Enter to open, type, Enter to send.
 * Messages appear as a fade-out feed at bottom-left.
 * Opening the chat shows the full message history.
 */
export class ChatOverlay {
  private el: HTMLElement;
  private feedEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private visible = false;
  private sendHandler: SendHandler | null = null;
  private history: ChatEntry[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'chat-overlay';
    this.el.style.cssText = [
      'position: absolute',
      'bottom: 12px',
      'left: 8px',
      'z-index: 35',
      'display: flex',
      'flex-direction: column',
      'max-width: 380px',
      'pointer-events: none',
      'user-select: none',
    ].join('; ');

    // Message feed
    this.feedEl = document.createElement('div');
    this.feedEl.style.cssText = [
      'display: flex',
      'flex-direction: column',
      'gap: 2px',
      'margin-bottom: 4px',
      'max-height: 200px',
      'overflow-y: auto',
    ].join('; ');
    this.el.appendChild(this.feedEl);

    // Input field (hidden by default)
    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.maxLength = 200;
    this.inputEl.spellcheck = false;
    this.inputEl.autocomplete = 'off';
    this.inputEl.placeholder = 'Press Enter to chat...';
    this.inputEl.style.cssText = [
      'display: none',
      'background: rgba(0, 0, 0, 0.75)',
      'border: 1px solid rgba(255, 255, 255, 0.15)',
      'border-radius: 4px',
      'padding: 6px 10px',
      'color: #d8e2ef',
      'font-family: monospace',
      'font-size: 12px',
      'outline: none',
      'pointer-events: auto',
      'width: 380px',
    ].join('; ');

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.inputEl.value.trim();
        if (text) this.sendHandler?.(text);
        this.hide();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
      // Block all key events from reaching game input while typing
      e.stopPropagation();
    });

    // Prevent click-through to game
    this.inputEl.addEventListener('mousedown', (e) => e.stopPropagation());

    this.el.appendChild(this.inputEl);
    document.getElementById('overlay')!.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.visible;
  }

  onSend(handler: SendHandler): void {
    this.sendHandler = handler;
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.inputEl.style.display = 'block';
    this.inputEl.value = '';
    this.inputEl.focus();
    this.renderHistory();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.inputEl.style.display = 'none';
    this.inputEl.value = '';
    this.inputEl.blur();
    // Clear feed - new incoming messages will create their own fading elements
    this.feedEl.innerHTML = '';
  }

  /** Hide/show the entire chat container (used on menu transitions). */
  setActive(active: boolean): void {
    this.el.style.display = active ? 'flex' : 'none';
    if (!active) {
      this.hide();
      this.history.length = 0;
    }
  }

  addMessage(displayName: string, slot: number, text: string): void {
    this.history.push({ displayName, slot, text });
    if (this.history.length > MAX_HISTORY) this.history.shift();

    if (this.visible) {
      // Chat is open - append persistent line (no fade)
      this.appendLine(displayName, slot, text, false);
      // Trim visible lines
      while (this.feedEl.children.length > MAX_HISTORY) {
        this.feedEl.removeChild(this.feedEl.firstChild!);
      }
      this.feedEl.scrollTop = this.feedEl.scrollHeight;
    } else {
      // Chat closed - show as a temporary fading message
      const line = this.appendLine(displayName, slot, text, true);
      // Limit fading messages
      while (this.feedEl.children.length > 6) {
        this.feedEl.removeChild(this.feedEl.firstChild!);
      }
      this.feedEl.scrollTop = this.feedEl.scrollHeight;
      // Fade out after delay, then remove
      setTimeout(() => {
        line.style.opacity = '0';
        setTimeout(() => {
          if (line.parentNode === this.feedEl) {
            this.feedEl.removeChild(line);
          }
        }, MESSAGE_FADE_MS);
      }, MESSAGE_VISIBLE_MS);
    }
  }

  /** Rebuild the feed with all buffered history (called on show). */
  private renderHistory(): void {
    this.feedEl.innerHTML = '';
    for (const msg of this.history) {
      this.appendLine(msg.displayName, msg.slot, msg.text, false);
    }
    // Scroll feed to bottom
    this.feedEl.scrollTop = this.feedEl.scrollHeight;
  }

  /** Create and append a single chat line. Returns the element. */
  private appendLine(displayName: string, slot: number, text: string, withFade: boolean): HTMLElement {
    const line = document.createElement('div');
    line.style.cssText = [
      'font-family: monospace',
      'font-size: 12px',
      'padding: 2px 6px',
      'background: rgba(0, 0, 0, 0.5)',
      'border-radius: 3px',
      withFade ? 'transition: opacity ' + MESSAGE_FADE_MS + 'ms ease' : '',
      'opacity: 1',
    ].filter(Boolean).join('; ');

    const nameSpan = document.createElement('span');
    const color = PLAYER_COLORS[slot] ?? 0xd8e2ef;
    nameSpan.style.color = '#' + color.toString(16).padStart(6, '0');
    nameSpan.style.fontWeight = '700';
    nameSpan.textContent = displayName;

    const textSpan = document.createElement('span');
    textSpan.style.color = '#cccccc';
    textSpan.textContent = ': ' + text;

    line.appendChild(nameSpan);
    line.appendChild(textSpan);
    this.feedEl.appendChild(line);
    return line;
  }
}
