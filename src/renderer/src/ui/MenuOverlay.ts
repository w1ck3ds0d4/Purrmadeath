/**
 * Manages the HTML overlay panels for the main menu and pause screen.
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

  private nameInput:       HTMLInputElement;
  private codeInput:       HTMLInputElement;
  private pauseSubtitle:   HTMLElement;
  private connectionStatus: HTMLElement;
  private hostBtn:         HTMLElement;
  private joinBtn:         HTMLElement;

  constructor() {
    this.menuScreen  = this.require('menu-screen');
    this.pauseScreen = this.require('pause-screen');
    this.nameInput       = this.require('input-display-name') as HTMLInputElement;
    this.codeInput       = this.require('input-session-code') as HTMLInputElement;
    this.pauseSubtitle   = this.require('pause-subtitle');
    this.connectionStatus = this.require('connection-status');
    this.hostBtn         = this.require('btn-host-game');
    this.joinBtn         = this.require('btn-join-game');

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

    // Settings stub — deferred to Phase 9
    this.require('btn-settings').addEventListener('click', () => {
      console.log('[Settings] Not implemented yet — Phase 9');
    });
  }

  setCallbacks(cbs: {
    onHost:       () => void;
    onJoin:       (code: string) => void;
    onResume:     () => void;
    onQuitToMenu: () => void;
  }): void {
    this.onHost       = cbs.onHost;
    this.onJoin       = cbs.onJoin;
    this.onResume     = cbs.onResume;
    this.onQuitToMenu = cbs.onQuitToMenu;
  }

  /** The player name entered in the main menu input. */
  get displayName(): string {
    return this.nameInput.value.trim() || 'Player';
  }

  /** Pre-fill the name input (e.g. from server's lastDisplayName). */
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
  }

  showPause(subtitle?: string): void {
    this.menuScreen.style.display  = 'none';
    this.pauseScreen.style.display = 'flex';
    if (subtitle) {
      this.pauseSubtitle.textContent = subtitle;
      this.pauseSubtitle.style.display = 'block';
    } else {
      this.pauseSubtitle.style.display = 'none';
    }
  }

  /** Hide all overlay screens (transition to Playing or Lobby). */
  hide(): void {
    this.menuScreen.style.display  = 'none';
    this.pauseScreen.style.display = 'none';
  }

  private require(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`MenuOverlay: missing element #${id} in the DOM`);
    return el;
  }
}
