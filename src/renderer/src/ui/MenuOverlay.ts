/**
 * Manages the HTML overlay panels for the main menu and pause screen.
 *
 * The overlay sits in a `position: absolute` div above the Pixi.js canvas,
 * so the world renders as an animated background behind the menus.
 */
export class MenuOverlay {
  private menuScreen:  HTMLElement;
  private pauseScreen: HTMLElement;

  private onNewGame:    (() => void) | null = null;
  private onResume:     (() => void) | null = null;
  private onQuitToMenu: (() => void) | null = null;

  constructor() {
    this.menuScreen  = this.require('menu-screen');
    this.pauseScreen = this.require('pause-screen');

    this.require('btn-new-game').addEventListener('click', () => this.onNewGame?.());
    this.require('btn-resume').addEventListener('click',   () => this.onResume?.());
    this.require('btn-quit').addEventListener('click',     () => this.onQuitToMenu?.());

    // Settings stub — deferred to Phase 9
    this.require('btn-settings').addEventListener('click', () => {
      console.log('[Settings] Not implemented yet — Phase 9');
    });
  }

  setCallbacks(cbs: {
    onNewGame:    () => void;
    onResume:     () => void;
    onQuitToMenu: () => void;
  }): void {
    this.onNewGame    = cbs.onNewGame;
    this.onResume     = cbs.onResume;
    this.onQuitToMenu = cbs.onQuitToMenu;
  }

  showMenu(): void {
    this.menuScreen.style.display  = 'flex';
    this.pauseScreen.style.display = 'none';
  }

  showPause(): void {
    this.menuScreen.style.display  = 'none';
    this.pauseScreen.style.display = 'flex';
  }

  /** Hide all overlay screens (transition to Playing). */
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
