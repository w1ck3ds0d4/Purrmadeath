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
  private onJoin:       ((ip: string) => void) | null = null;
  private onResume:     (() => void) | null = null;
  private onQuitToMenu: (() => void) | null = null;

  private nameInput:  HTMLInputElement;
  private codeInput:  HTMLInputElement;

  constructor() {
    this.menuScreen  = this.require('menu-screen');
    this.pauseScreen = this.require('pause-screen');
    this.nameInput   = this.require('input-display-name') as HTMLInputElement;
    this.codeInput   = this.require('input-session-code') as HTMLInputElement;

    // Uppercase only when the value is all letters (session code, not an IP)
    this.codeInput.addEventListener('input', () => {
      if (/^[A-Za-z]*$/.test(this.codeInput.value)) {
        const start = this.codeInput.selectionStart;
        const end   = this.codeInput.selectionEnd;
        this.codeInput.value = this.codeInput.value.toUpperCase();
        this.codeInput.setSelectionRange(start, end);
      }
    });

    this.require('btn-host-game').addEventListener('click', () => this.onHost?.());
    this.require('btn-join-game').addEventListener('click', () => this.onJoin?.(this.codeInput.value.trim()));
    this.require('btn-resume').addEventListener('click',    () => this.onResume?.());
    this.require('btn-quit').addEventListener('click',      () => this.onQuitToMenu?.());

    // Settings stub — deferred to Phase 9
    this.require('btn-settings').addEventListener('click', () => {
      console.log('[Settings] Not implemented yet — Phase 9');
    });
  }

  setCallbacks(cbs: {
    onHost:       () => void;
    onJoin:       (ip: string) => void;
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

  showMenu(): void {
    this.menuScreen.style.display  = 'flex';
    this.pauseScreen.style.display = 'none';
  }

  showPause(): void {
    this.menuScreen.style.display  = 'none';
    this.pauseScreen.style.display = 'flex';
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
