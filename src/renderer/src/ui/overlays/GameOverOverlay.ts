/**
 * DOM-based game over screen.
 *
 * Shows run stats (enemies killed, waves survived, time played) and a
 * button to return to the main menu. Appended to #overlay.
 */
export class GameOverOverlay {
  private el: HTMLElement;
  private statsEl: HTMLElement;
  private onMenuCallback: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'game-over-overlay';
    this.el.style.cssText = [
      'position: absolute',
      'top: 0', 'left: 0', 'right: 0', 'bottom: 0',
      'z-index: 30',
      'background: rgba(0, 0, 0, 0.85)',
      'display: none',
      'flex-direction: column',
      'align-items: center',
      'justify-content: center',
      'pointer-events: auto',
      "font-family: 'Segoe UI', monospace",
    ].join('; ');

    // Title
    const title = document.createElement('div');
    title.textContent = 'GAME OVER';
    title.style.cssText = 'font-size: 36px; color: #ff4444; letter-spacing: 4px; font-weight: bold; margin-bottom: 32px;';
    this.el.appendChild(title);

    // Stats container
    this.statsEl = document.createElement('div');
    this.statsEl.style.cssText = [
      'background: rgba(30, 20, 20, 0.6)',
      'border: 1px solid rgba(255, 80, 80, 0.25)',
      'border-radius: 8px',
      'padding: 24px 40px',
      'margin-bottom: 32px',
      'min-width: 280px',
    ].join('; ');
    this.el.appendChild(this.statsEl);

    // Back to Menu button
    const btn = document.createElement('button');
    btn.textContent = 'Back to Menu';
    btn.style.cssText = [
      'padding: 12px 32px',
      'font-size: 16px',
      "font-family: 'Segoe UI', monospace",
      'background: rgba(255, 80, 80, 0.2)',
      'border: 1px solid rgba(255, 80, 80, 0.5)',
      'border-radius: 6px',
      'color: #ffcccc',
      'cursor: pointer',
      'letter-spacing: 1px',
    ].join('; ');
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255, 80, 80, 0.4)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(255, 80, 80, 0.2)';
    });
    btn.addEventListener('click', () => {
      this.hide();
      this.onMenuCallback?.();
    });
    this.el.appendChild(btn);

    document.getElementById('overlay')!.appendChild(this.el);
  }

  setOnMenu(cb: () => void): void {
    this.onMenuCallback = cb;
  }

  show(stats: { waveReached: number; enemiesKilled: number; timePlayed: number; reason: string }): void {
    const minutes = Math.floor(stats.timePlayed / 60);
    const seconds = stats.timePlayed % 60;
    const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

    this.statsEl.innerHTML = [
      this.statRow('Waves Survived', String(stats.waveReached)),
      this.statRow('Enemies Killed', String(stats.enemiesKilled)),
      this.statRow('Time Played', timeStr),
    ].join('');

    this.el.style.display = 'flex';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  private statRow(label: string, value: string): string {
    return `<div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
      <span style="color: #aa8888; font-size: 14px;">${label}</span>
      <span style="color: #ffcccc; font-size: 14px; font-weight: bold; margin-left: 40px;">${value}</span>
    </div>`;
  }
}
