import type { LobbySlot } from '@shared/protocol';

/**
 * Manages the HTML lobby panel.
 *
 * The lobby shows:
 *   - Share row: session code + host IP, each with a Copy button
 *   - Player slots (1–4)
 *   - A Start button (host only)
 *   - A Leave button
 *   - A small chat window
 */
export class LobbyOverlay {
  private screen:     HTMLElement;
  private shareRow:   HTMLElement;
  private playerList: HTMLElement;
  private chatLog:    HTMLElement;
  private chatInput:  HTMLInputElement;
  private startBtn:   HTMLElement;

  private onStart: (() => void) | null = null;
  private onLeave: (() => void) | null = null;
  private onChat:  ((text: string) => void) | null = null;

  constructor() {
    this.screen     = this.require('lobby-screen');
    this.shareRow   = this.require('lobby-share-row');
    this.playerList = this.require('lobby-player-list');
    this.chatLog    = this.require('lobby-chat-log');
    this.chatInput  = this.require('lobby-chat-input') as HTMLInputElement;
    this.startBtn   = this.require('btn-lobby-start');

    this.startBtn.addEventListener('click', () => this.onStart?.());
    this.require('btn-lobby-leave').addEventListener('click', () => this.onLeave?.());

    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text) {
          this.onChat?.(text);
          this.chatInput.value = '';
        }
        e.preventDefault();
      }
    });
  }

  setCallbacks(cbs: {
    onStart: () => void;
    onLeave: () => void;
    onChat:  (text: string) => void;
  }): void {
    this.onStart = cbs.onStart;
    this.onLeave = cbs.onLeave;
    this.onChat  = cbs.onChat;
  }

  show(sessionId: string, code: string, isHost: boolean): void {
    this.screen.style.display = 'flex';
    this.startBtn.style.display = isHost ? '' : 'none';

    // Build share row
    this.shareRow.innerHTML = '';
    if (code) {
      this.shareRow.appendChild(this.makeShareItem('Code', code));
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'lobby-share-label';
      fallback.textContent = `Session: ${sessionId}`;
      this.shareRow.appendChild(fallback);
    }
  }

  private makeShareItem(label: string, value: string): HTMLElement {
    const item = document.createElement('div');
    item.className = 'lobby-share-item';

    const lbl = document.createElement('span');
    lbl.className = 'lobby-share-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className = 'lobby-share-value';
    val.textContent = value;

    const btn = document.createElement('button');
    btn.className = 'btn-copy';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(value).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
      }).catch(() => {/* clipboard denied — silently ignore */});
    });

    item.appendChild(lbl);
    item.appendChild(val);
    item.appendChild(btn);
    return item;
  }

  hide(): void {
    this.screen.style.display = 'none';
  }

  updatePlayers(slots: LobbySlot[]): void {
    this.playerList.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const slot = slots.find((s) => s.slot === i);
      const li = document.createElement('li');
      li.className = 'lobby-slot';
      if (slot) {
        li.textContent = `P${i + 1}  ${slot.displayName}${slot.isHost ? ' (host)' : ''}`;
        li.classList.add('filled');
      } else {
        li.textContent = `P${i + 1}  — waiting…`;
        li.classList.add('empty');
      }
      this.playerList.appendChild(li);
    }
  }

  addChatMessage(displayName: string, text: string): void {
    const line = document.createElement('p');
    line.className = 'chat-line';
    // Safe: textContent only, no innerHTML
    const nameSpan = document.createElement('span');
    nameSpan.className = 'chat-name';
    nameSpan.textContent = `${displayName}: `;
    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    line.appendChild(nameSpan);
    line.appendChild(textSpan);
    this.chatLog.appendChild(line);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private require(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`LobbyOverlay: missing element #${id} in the DOM`);
    return el;
  }
}
