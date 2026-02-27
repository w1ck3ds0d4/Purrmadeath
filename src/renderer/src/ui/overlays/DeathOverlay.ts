/**
 * DOM-based death/downed overlay.
 *
 * Shows status text when the local player is downed, being revived, or dead.
 * Appended to #overlay, same pattern as WaveHUD / PauseBanner.
 */
export class DeathOverlay {
  private el: HTMLElement;
  private statusEl: HTMLElement;
  private timerEl: HTMLElement;
  private subEl: HTMLElement;

  private bleedTimer = 0;
  private respawnTimer = 0;
  private reviveProgress = 0;
  private state: 'hidden' | 'downed' | 'reviving' | 'dead' = 'hidden';
  private solo = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'death-overlay';
    this.el.style.cssText = [
      'position: absolute',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 25',
      'background: rgba(10, 0, 0, 0.7)',
      'border: 1px solid rgba(255, 50, 50, 0.3)',
      'border-radius: 8px',
      'padding: 24px 48px',
      "font-family: 'Segoe UI', monospace",
      'text-align: center',
      'pointer-events: none',
      'display: none',
    ].join('; ');

    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'font-size: 22px; color: #ff4444; letter-spacing: 2px; font-weight: bold; margin-bottom: 8px;';

    this.timerEl = document.createElement('div');
    this.timerEl.style.cssText = 'font-size: 16px; color: #cc8888; letter-spacing: 1px; margin-bottom: 6px;';

    this.subEl = document.createElement('div');
    this.subEl.style.cssText = 'font-size: 13px; color: #997777; letter-spacing: 0.5px;';

    this.el.appendChild(this.statusEl);
    this.el.appendChild(this.timerEl);
    this.el.appendChild(this.subEl);
    document.getElementById('overlay')!.appendChild(this.el);
  }

  showDowned(bleedTimer: number, solo = false): void {
    this.state = 'downed';
    this.bleedTimer = bleedTimer;
    this.reviveProgress = 0;
    this.solo = solo;
    this.el.style.display = 'block';
    this.render();
  }

  showReviving(progress: number): void {
    this.state = 'reviving';
    this.reviveProgress = progress;
    this.el.style.display = 'block';
    this.render();
  }

  showDead(respawnTimer: number): void {
    this.state = 'dead';
    this.respawnTimer = respawnTimer;
    this.el.style.display = 'block';
    this.render();
  }

  hide(): void {
    this.state = 'hidden';
    this.el.style.display = 'none';
  }

  update(dt: number): void {
    if (this.state === 'hidden') return;

    if (this.state === 'downed' || this.state === 'reviving') {
      this.bleedTimer = Math.max(0, this.bleedTimer - dt);
    }
    if (this.state === 'dead') {
      this.respawnTimer = Math.max(0, this.respawnTimer - dt);
    }
    this.render();
  }

  private render(): void {
    switch (this.state) {
      case 'downed':
        if (this.solo) {
          this.statusEl.textContent = 'RESPAWNING';
          this.timerEl.textContent = `${Math.ceil(this.bleedTimer)}s`;
          this.subEl.textContent = '';
        } else {
          this.statusEl.textContent = 'YOU ARE DOWNED';
          this.timerEl.textContent = `Bleed-out in ${Math.ceil(this.bleedTimer)}s`;
          this.subEl.textContent = 'A teammate can revive you';
        }
        break;
      case 'reviving':
        this.statusEl.textContent = 'BEING REVIVED';
        this.statusEl.style.color = '#44ccff';
        this.timerEl.textContent = `${Math.round(this.reviveProgress * 100)}%`;
        this.subEl.textContent = 'Hold still...';
        // Reset color after rendering
        setTimeout(() => { this.statusEl.style.color = '#ff4444'; }, 0);
        break;
      case 'dead':
        this.statusEl.textContent = 'DEAD';
        this.timerEl.textContent = `Respawning in ${Math.ceil(this.respawnTimer)}s`;
        this.subEl.textContent = '';
        break;
    }
  }
}
