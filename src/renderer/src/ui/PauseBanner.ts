/**
 * Small top-of-screen banner showing vote progress during pause/resume collection.
 *
 * Displays e.g. "Player1 wants to pause (1/3) — press ESC to agree"
 * Purely DOM-based, appended to #overlay, same pattern as MenuOverlay/LobbyOverlay.
 */
export class PauseBanner {
  private el: HTMLElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'pause-banner';
    this.el.style.cssText = [
      'position: absolute',
      'top: 48px',
      'left: 50%',
      'transform: translateX(-50%)',
      'z-index: 20',
      'background: rgba(4, 4, 10, 0.82)',
      'backdrop-filter: blur(4px)',
      'border: 1px solid rgba(255, 255, 255, 0.14)',
      'padding: 12px 28px',
      "font-family: 'Segoe UI', monospace",
      'font-size: 15px',
      'color: #ccd8ea',
      'letter-spacing: 1px',
      'pointer-events: none',
      'display: none',
      'text-align: center',
      'white-space: nowrap',
    ].join('; ');
    document.getElementById('overlay')!.appendChild(this.el);
  }

  show(direction: 'pause' | 'resume', voters: string[], required: number): void {
    const names = voters.join(', ');
    const verb = direction === 'pause' ? 'pause' : 'resume';
    this.el.textContent = `${names} wants to ${verb} (${voters.length}/${required}) — press ESC to agree`;
    this.el.style.display = 'block';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
