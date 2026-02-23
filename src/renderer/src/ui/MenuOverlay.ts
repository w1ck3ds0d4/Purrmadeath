import type { SaveSlotInfo } from '@shared/SaveFormat';
import { CARD_POOL, CATEGORY_COLORS, RARITY_BORDER_COLORS, type CardDefinition } from '@shared/CardDefinitions';

/**
 * Manages the HTML overlay panels for the main menu, save slot picker, and pause screen.
 *
 * The overlay sits in a `position: absolute` div above the Pixi.js canvas,
 * so the world renders as an animated background behind the menus.
 */
export class MenuOverlay {
  private menuScreen:  HTMLElement;
  private pauseScreen: HTMLElement;

  private onHost:       (() => void) | null = null;
  private onJoin:       ((code: string) => void) | null = null;
  private onResume:     (() => void) | null = null;
  private onQuitToMenu: (() => void) | null = null;
  private onStats:      (() => void) | null = null;

  private nameInput:       HTMLInputElement;
  private codeInput:       HTMLInputElement;
  private pauseSubtitle:   HTMLElement;
  private pauseStats:      HTMLElement;
  private connectionStatus: HTMLElement;
  private hostBtn:         HTMLElement;
  private joinBtn:         HTMLElement;

  // Save slot picker
  private saveSlotScreen: HTMLElement;
  private saveSlotList: HTMLElement;
  private onSlotSelected: ((slot: number) => void) | null = null;
  private onDeleteSlot: ((slot: number) => void) | null = null;

  // Card browser
  private cardScreen: HTMLElement;

  constructor() {
    this.menuScreen  = this.require('menu-screen');
    this.pauseScreen = this.require('pause-screen');
    this.nameInput       = this.require('input-display-name') as HTMLInputElement;
    this.codeInput       = this.require('input-session-code') as HTMLInputElement;
    this.pauseSubtitle   = this.require('pause-subtitle');
    this.pauseStats      = this.require('pause-stats');
    this.connectionStatus = this.require('connection-status');
    this.hostBtn         = this.require('btn-host-game');
    this.joinBtn         = this.require('btn-join-game');

    // Create save slot picker screen dynamically
    this.saveSlotScreen = document.createElement('div');
    this.saveSlotScreen.className = 'screen';
    this.saveSlotScreen.id = 'save-slot-screen';
    this.saveSlotScreen.innerHTML = `
      <h2 style="font-family:'Segoe UI',sans-serif;font-size:30px;font-weight:700;color:#ccd8ea;letter-spacing:4px;margin-bottom:8px;user-select:none;">SELECT SAVE SLOT</h2>
      <p style="font-family:monospace;font-size:12px;color:#6a7a8a;margin-bottom:24px;user-select:none;">Choose a slot to host on</p>
      <div id="save-slot-list" style="display:flex;flex-direction:column;gap:8px;width:360px;"></div>
      <button id="btn-save-slot-back" class="menu-btn muted" style="margin-top:16px;width:360px;">Back</button>
    `;
    document.getElementById('overlay')!.appendChild(this.saveSlotScreen);

    this.saveSlotList = this.saveSlotScreen.querySelector('#save-slot-list')!;
    this.saveSlotScreen.querySelector('#btn-save-slot-back')!.addEventListener('click', () => {
      this.saveSlotScreen.style.display = 'none';
      this.menuScreen.style.display = 'flex';
    });

    // Uppercase only when the value is all letters (session code, not an IP)
    this.codeInput.addEventListener('input', () => {
      if (/^[A-Za-z]*$/.test(this.codeInput.value)) {
        const start = this.codeInput.selectionStart;
        const end   = this.codeInput.selectionEnd;
        this.codeInput.value = this.codeInput.value.toUpperCase();
        this.codeInput.setSelectionRange(start, end);
      }
    });

    this.hostBtn.addEventListener('click', () => this.onHost?.());
    this.joinBtn.addEventListener('click', () => this.onJoin?.(this.codeInput.value.trim()));
    this.require('btn-resume').addEventListener('click', () => this.onResume?.());
    this.require('btn-quit').addEventListener('click',   () => this.onQuitToMenu?.());

    this.require('btn-stats').addEventListener('click', () => this.onStats?.());

    // Settings stub - deferred to Phase 9
    this.require('btn-settings').addEventListener('click', () => {
      console.log('[Settings] Not implemented yet - Phase 9');
    });

    // Card browser screen
    this.cardScreen = document.createElement('div');
    this.cardScreen.className = 'screen';
    this.cardScreen.id = 'card-browser-screen';
    this.cardScreen.style.cssText = 'display:none;flex-direction:column;align-items:center;padding:24px;overflow-y:auto;';
    this.cardScreen.innerHTML = `
      <h2 style="font-family:'Segoe UI',sans-serif;font-size:30px;font-weight:700;color:#ccd8ea;letter-spacing:4px;margin-bottom:8px;user-select:none;">CARDS</h2>
      <p style="font-family:monospace;font-size:12px;color:#6a7a8a;margin-bottom:24px;user-select:none;">All cards in the pool</p>
      <div id="card-browser-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;width:100%;max-width:800px;margin-bottom:16px;"></div>
      <button id="btn-card-back" class="menu-btn muted" style="margin-top:8px;width:360px;">Back</button>
    `;
    document.getElementById('overlay')!.appendChild(this.cardScreen);

    this.cardScreen.querySelector('#btn-card-back')!.addEventListener('click', () => {
      this.cardScreen.style.display = 'none';
      this.menuScreen.style.display = 'flex';
    });

    this.populateCardGrid();

    this.require('btn-cards').addEventListener('click', () => {
      this.menuScreen.style.display = 'none';
      this.cardScreen.style.display = 'flex';
    });
  }

  setCallbacks(cbs: {
    onHost:       () => void;
    onJoin:       (code: string) => void;
    onResume:     () => void;
    onQuitToMenu: () => void;
    onStats?:     () => void;
  }): void {
    this.onHost       = cbs.onHost;
    this.onJoin       = cbs.onJoin;
    this.onResume     = cbs.onResume;
    this.onQuitToMenu = cbs.onQuitToMenu;
    this.onStats      = cbs.onStats ?? null;
  }

  /** The player name entered in the main menu input. */
  get displayName(): string {
    return this.nameInput.value.trim() || 'Player';
  }

  /** Pre-fill the name input (e.g. from localStorage or server's lastDisplayName).
   *  Only fills if the field is currently empty. */
  set displayName(name: string) {
    if (name && !this.nameInput.value.trim()) {
      this.nameInput.value = name;
    }
  }

  /** Update the connection status indicator below the subtitle. */
  setConnectionStatus(status: 'connecting' | 'connected' | 'disconnected'): void {
    const el = this.connectionStatus;
    switch (status) {
      case 'connecting':
        el.textContent = 'CONNECTING...';
        el.style.color = '#6a7a8a';
        break;
      case 'connected':
        el.textContent = 'CONNECTED';
        el.style.color = '#6bcf7f';
        break;
      case 'disconnected':
        el.textContent = 'DISCONNECTED \u2014 RETRYING...';
        el.style.color = '#e05252';
        break;
    }
  }

  /** Enable or disable Host and Join buttons (grayed out when not connected). */
  setButtonsEnabled(enabled: boolean): void {
    const opacity = enabled ? '1' : '0.4';
    const events  = enabled ? 'auto' : 'none';
    this.hostBtn.style.opacity = opacity;
    this.hostBtn.style.pointerEvents = events;
    this.joinBtn.style.opacity = opacity;
    this.joinBtn.style.pointerEvents = events;
  }

  /** Switch code input placeholder between prod and dev modes. */
  setDevMode(isDev: boolean): void {
    this.codeInput.placeholder = isDev ? 'CODE or IP' : 'Invite code';
  }

  showMenu(): void {
    this.menuScreen.style.display  = 'flex';
    this.pauseScreen.style.display = 'none';
    this.saveSlotScreen.style.display = 'none';
    this.cardScreen.style.display = 'none';
    // Hide stats screen if it exists
    const statsScreen = document.getElementById('stats-screen');
    if (statsScreen) statsScreen.style.display = 'none';
  }

  showPause(subtitle?: string, gameTime?: number): void {
    this.menuScreen.style.display  = 'none';
    this.pauseScreen.style.display = 'flex';
    if (subtitle) {
      this.pauseSubtitle.textContent = subtitle;
      this.pauseSubtitle.style.display = 'block';
    } else {
      this.pauseSubtitle.style.display = 'none';
    }
    if (gameTime !== undefined && gameTime > 0) {
      const m = Math.floor(gameTime / 60);
      const s = Math.floor(gameTime % 60);
      this.pauseStats.textContent = `Time: ${m}m ${s}s`;
      this.pauseStats.style.display = 'block';
    } else {
      this.pauseStats.style.display = 'none';
    }
  }

  /** Hide all overlay screens (transition to Playing or Lobby). */
  hide(): void {
    this.menuScreen.style.display  = 'none';
    this.pauseScreen.style.display = 'none';
    this.saveSlotScreen.style.display = 'none';
    this.cardScreen.style.display = 'none';
  }

  /** Show save slot picker - called after SAVE_SLOTS_REQUEST is sent. */
  showSaveSlotPicker(onSelect: (slot: number) => void, onDelete?: (slot: number) => void): void {
    this.onSlotSelected = onSelect;
    this.onDeleteSlot = onDelete ?? null;
    this.menuScreen.style.display = 'none';
    this.saveSlotScreen.style.display = 'flex';
    // Show loading state initially; will be updated when SAVE_SLOTS_RESPONSE arrives
    this.saveSlotList.innerHTML = '<p style="font-family:monospace;font-size:13px;color:#6a7a8a;">Loading save slots...</p>';
  }

  /** Update save slot picker with data from server (called from SAVE_SLOTS_RESPONSE handler). */
  showSaveSlots(slots: SaveSlotInfo[]): void {
    this.saveSlotList.innerHTML = '';

    // Ensure we always show 3 slots
    for (let i = 1; i <= 3; i++) {
      const info = slots.find(s => s.slot === i);
      const btn = document.createElement('button');
      btn.className = 'menu-btn';
      btn.style.cssText = 'text-align:left;padding:14px 20px;width:100%;';

      if (info?.exists) {
        const time = this.formatTime(info.elapsedTime ?? 0);
        const row1 = document.createElement('div');
        row1.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
        const slotLabel = document.createElement('span');
        slotLabel.style.cssText = 'color:#e8c96a;font-weight:bold;';
        slotLabel.textContent = `Slot ${i}`;
        const tsLabel = document.createElement('span');
        tsLabel.style.cssText = 'font-size:11px;color:#6a7a8a;';
        tsLabel.textContent = this.formatTimestamp(info.timestamp ?? 0);
        row1.append(slotLabel, tsLabel);
        const row2 = document.createElement('div');
        row2.style.cssText = 'font-size:12px;color:#8a9ab0;margin-top:4px;';
        row2.textContent = `Wave ${info.wave ?? 0}  \u00B7  ${time}  \u00B7  ${info.enemiesKilled ?? 0} kills`;
        btn.append(row1, row2);
      } else {
        const row1 = document.createElement('div');
        row1.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
        const slotLabel = document.createElement('span');
        slotLabel.style.cssText = 'color:#e8c96a;font-weight:bold;';
        slotLabel.textContent = `Slot ${i}`;
        const emptyLabel = document.createElement('span');
        emptyLabel.style.cssText = 'font-size:12px;color:#4a5a6a;';
        emptyLabel.textContent = 'Empty';
        row1.append(slotLabel, emptyLabel);
        const row2 = document.createElement('div');
        row2.style.cssText = 'font-size:12px;color:#4a5a6a;margin-top:4px;';
        row2.textContent = 'New Game';
        btn.append(row1, row2);
      }

      btn.addEventListener('click', () => {
        this.saveSlotScreen.style.display = 'none';
        this.onSlotSelected?.(i);
      });

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:stretch;';
      btn.style.flex = '1';
      row.appendChild(btn);

      // Delete button for existing saves
      if (info?.exists && this.onDeleteSlot) {
        const del = document.createElement('button');
        del.className = 'menu-btn muted';
        del.style.cssText = 'padding:8px 12px;font-size:16px;color:#cc4444;min-width:42px;display:flex;align-items:center;justify-content:center;';
        del.textContent = '\u2715';
        del.title = 'Delete save';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onDeleteSlot?.(i);
        });
        row.appendChild(del);
      }

      this.saveSlotList.appendChild(row);
    }
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
  }

  private formatTimestamp(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  /** Show a modal confirmation dialog. Calls onConfirm if user clicks Yes, otherwise dismisses. */
  showConfirmDialog(message: string, onConfirm: () => void): void {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:absolute;inset:0;z-index:50;background:rgba(4,4,10,0.8);display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(10,10,20,0.95);border:1px solid rgba(255,255,255,0.14);padding:24px 32px;max-width:400px;text-align:center;font-family:monospace;color:#ccd8ea;';
    const msg = document.createElement('p');
    msg.style.cssText = 'font-size:14px;margin-bottom:20px;line-height:1.5;';
    msg.textContent = message;
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;justify-content:center;';
    const yesBtn = document.createElement('button');
    yesBtn.className = 'menu-btn muted';
    yesBtn.style.cssText = 'width:120px;color:#ff6644;';
    yesBtn.textContent = 'Leave';
    const noBtn = document.createElement('button');
    noBtn.className = 'menu-btn';
    noBtn.style.cssText = 'width:120px;';
    noBtn.textContent = 'Stay';
    yesBtn.addEventListener('click', () => { backdrop.remove(); onConfirm(); });
    noBtn.addEventListener('click', () => { backdrop.remove(); });
    btnRow.append(noBtn, yesBtn);
    box.append(msg, btnRow);
    backdrop.appendChild(box);
    document.getElementById('overlay')!.appendChild(backdrop);
  }

  /** Show an info dialog with a single OK button. */
  showInfoDialog(message: string): void {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:absolute;inset:0;z-index:50;background:rgba(4,4,10,0.8);display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(10,10,20,0.95);border:1px solid rgba(255,255,255,0.14);padding:24px 32px;max-width:400px;text-align:center;font-family:monospace;color:#ccd8ea;';
    const msg = document.createElement('p');
    msg.style.cssText = 'font-size:14px;margin-bottom:20px;line-height:1.5;';
    msg.textContent = message;
    const okBtn = document.createElement('button');
    okBtn.className = 'menu-btn';
    okBtn.style.cssText = 'width:120px;';
    okBtn.textContent = 'OK';
    okBtn.addEventListener('click', () => backdrop.remove());
    box.append(msg, okBtn);
    backdrop.appendChild(box);
    document.getElementById('overlay')!.appendChild(backdrop);
  }

  private populateCardGrid(): void {
    const grid = this.cardScreen.querySelector('#card-browser-grid')!;

    // Group cards by category
    const categories: Array<{ key: string; label: string }> = [
      { key: 'buff', label: 'BUFFS' },
      { key: 'ability', label: 'ABILITIES' },
      { key: 'resource', label: 'RESOURCES' },
      { key: 'trap', label: 'TRAPS' },
    ];

    for (const cat of categories) {
      const cards = CARD_POOL.filter(c => c.category === cat.key);
      if (cards.length === 0) continue;

      // Category header spanning full width
      const header = document.createElement('div');
      header.style.cssText = `grid-column:1/-1;font-family:'Segoe UI',sans-serif;font-size:14px;font-weight:700;letter-spacing:2px;user-select:none;margin-top:8px;color:#${CATEGORY_COLORS[cat.key as keyof typeof CATEGORY_COLORS].toString(16).padStart(6, '0')};`;
      header.textContent = cat.label;
      grid.appendChild(header);

      for (const card of cards) {
        grid.appendChild(this.createCardElement(card));
      }
    }
  }

  private createCardElement(card: CardDefinition): HTMLElement {
    const el = document.createElement('div');
    const catColor = '#' + CATEGORY_COLORS[card.category].toString(16).padStart(6, '0');
    const rarBorder = RARITY_BORDER_COLORS[card.rarity];
    const rarLabel = card.rarity.toUpperCase();

    const rarColor = card.rarity === 'epic' ? '#aa44ff' : card.rarity === 'rare' ? '#4a90d9' : '#8a8a8a';

    el.style.cssText = `
      background: rgba(20, 20, 35, 0.9);
      border: 1px solid ${rarBorder};
      border-left: 3px solid ${catColor};
      padding: 10px 14px;
      display: flex; flex-direction: column; gap: 4px;
      user-select: none;
    `;

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-family:'Segoe UI',sans-serif;font-size:13px;font-weight:600;color:#ccd8ea;">${card.name}</span>
        <span style="font-family:monospace;font-size:10px;color:${rarColor};letter-spacing:1px;">${rarLabel}</span>
      </div>
      <div style="font-family:monospace;font-size:11px;color:#8a9ab0;">${card.description}</div>
    `;

    return el;
  }

  private require(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`MenuOverlay: missing element #${id} in the DOM`);
    return el;
  }
}
