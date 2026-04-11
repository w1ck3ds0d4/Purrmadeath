import type { LobbySlot } from '@shared/protocol';
import { CLASS_DISPLAY_NAMES, BASE_CLASSES } from '@shared/definitions/ClassDefinitions';
import type { PlayerClass } from '@shared/definitions/ClassDefinitions';

const CLASS_BADGE_COLORS: Record<string, string> = {
  warrior:     '#cc9966',
  ranger:      '#55cc77',
  mage:        '#9966dd',
};

/**
 * Manages the HTML lobby panel.
 *
 * The lobby shows:
 *   - Share row: session code + host IP, each with a Copy button
 *   - Class selector (Warrior / Ranger / Mage)
 *   - Player slots (1-4)
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
  private classButtons: HTMLElement[];

  private isHost = false;
  private locked = false;
  private singleplayer = false;
  private leftCol: HTMLElement;
  private rightCol: HTMLElement;

  private onStart: (() => void) | null = null;
  private onLeave: (() => void) | null = null;
  private onChat:  ((text: string) => void) | null = null;
  private onClassSelect: ((playerClass: PlayerClass) => void) | null = null;
  private onKick: ((slot: number) => void) | null = null;

  constructor() {
    this.screen     = this.require('lobby-screen');
    this.shareRow   = this.require('lobby-share-row');
    this.playerList = this.require('lobby-player-list');
    this.chatLog    = this.require('lobby-chat-log');
    this.chatInput  = this.require('lobby-chat-input') as HTMLInputElement;
    this.startBtn   = this.require('btn-lobby-start');
    this.leftCol    = this.screen.querySelector('.lobby-col-left') as HTMLElement;
    this.rightCol   = this.screen.querySelector('.lobby-col-right') as HTMLElement;

    // Class selector buttons
    const selector = this.require('class-selector');
    this.classButtons = Array.from(selector.querySelectorAll('.class-btn')) as HTMLElement[];
    for (const btn of this.classButtons) {
      btn.addEventListener('click', () => {
        if (this.locked) return;
        if (btn.classList.contains('locked')) return;
        const cls = btn.dataset.class as PlayerClass;
        this.selectClass(cls);
        this.onClassSelect?.(cls);
      });
    }

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

  /** Visually highlight the selected class button. */
  selectClass(cls: PlayerClass): void {
    for (const btn of this.classButtons) {
      btn.classList.toggle('selected', btn.dataset.class === cls);
    }
  }

  /** Lock or unlock class selection (locked = from a loaded save). */
  setClassLocked(locked: boolean): void {
    this.locked = locked;
    for (const btn of this.classButtons) {
      (btn as HTMLButtonElement).style.opacity = locked ? '0.4' : '';
      (btn as HTMLButtonElement).style.cursor = locked ? 'not-allowed' : 'pointer';
    }
  }

  /** Update which advanced classes are unlocked (show/hide lock state). */
  setUnlockedClasses(unlocked: string[]): void {
    for (const btn of this.classButtons) {
      const cls = btn.dataset.class as string;
      const isBase = (BASE_CLASSES as readonly string[]).includes(cls);
      const isUnlocked = isBase || unlocked.includes(cls);
      btn.classList.toggle('locked', !isUnlocked);
    }
  }

  setCallbacks(cbs: {
    onStart: () => void;
    onLeave: () => void;
    onChat:  (text: string) => void;
    onClassSelect: (playerClass: PlayerClass) => void;
    onKick: (slot: number) => void;
  }): void {
    this.onStart = cbs.onStart;
    this.onLeave = cbs.onLeave;
    this.onChat  = cbs.onChat;
    this.onClassSelect = cbs.onClassSelect;
    this.onKick = cbs.onKick;
  }

  setSingleplayer(sp: boolean): void {
    this.singleplayer = sp;
    this.leftCol.style.display = sp ? 'none' : '';
  }

  show(sessionId: string, code: string, isHost: boolean): void {
    this.isHost = isHost;
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
      }).catch(() => {/* clipboard denied - silently ignore */});
    });

    item.appendChild(lbl);
    item.appendChild(val);
    item.appendChild(btn);
    return item;
  }

  hide(): void {
    this.screen.style.display = 'none';
    this.setClassLocked(false);
    this.setSingleplayer(false);
  }

  updatePlayers(slots: LobbySlot[]): void {
    this.playerList.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const slot = slots.find((s) => s.slot === i);
      const li = document.createElement('li');
      li.className = 'lobby-slot';
      if (slot) {
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `P${i + 1}  ${slot.displayName}${slot.isHost ? ' (host)' : ''}`;
        li.appendChild(nameSpan);
        // Class badge
        if (slot.playerClass) {
          const badge = document.createElement('span');
          badge.className = 'lobby-slot-class';
          badge.textContent = CLASS_DISPLAY_NAMES[slot.playerClass as PlayerClass] ?? slot.playerClass;
          badge.style.color = CLASS_BADGE_COLORS[slot.playerClass] ?? '#8a9ab0';
          li.appendChild(badge);
        }
        // Kick button (host only, not on own slot)
        if (this.isHost && !slot.isHost) {
          const kickBtn = document.createElement('button');
          kickBtn.className = 'btn-kick';
          kickBtn.textContent = 'Kick';
          kickBtn.addEventListener('click', () => this.onKick?.(slot.slot));
          li.appendChild(kickBtn);
        }
        li.classList.add('filled');
      } else {
        li.textContent = `P${i + 1}  - waiting…`;
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
