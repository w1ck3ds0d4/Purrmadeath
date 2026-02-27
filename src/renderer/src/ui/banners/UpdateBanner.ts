/**
 * Displays a small banner at the top of the screen when a game update
 * is available or ready to install.
 */
export class UpdateBanner {
  private el: HTMLElement;
  private btn: HTMLButtonElement;
  private label: HTMLElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position: absolute',
      'top: 12px',
      'left: 50%',
      'transform: translateX(-50%)',
      'z-index: 50',
      'display: none',
      'align-items: center',
      'gap: 12px',
      'background: rgba(10, 10, 20, 0.92)',
      'border: 1px solid rgba(100, 180, 255, 0.35)',
      'border-radius: 8px',
      'padding: 10px 20px',
      "font-family: 'Segoe UI', monospace",
      'font-size: 13px',
      'color: #aaccff',
      'pointer-events: auto',
    ].join('; ');

    this.label = document.createElement('span');
    this.el.appendChild(this.label);

    this.btn = document.createElement('button');
    this.btn.style.cssText = [
      'padding: 5px 14px',
      'font-size: 12px',
      "font-family: 'Segoe UI', monospace",
      'background: rgba(100, 180, 255, 0.15)',
      'border: 1px solid rgba(100, 180, 255, 0.5)',
      'border-radius: 5px',
      'color: #aaccff',
      'cursor: pointer',
      'display: none',
    ].join('; ');
    this.btn.textContent = 'Install & Restart';
    this.btn.addEventListener('mouseenter', () => {
      this.btn.style.background = 'rgba(100, 180, 255, 0.3)';
    });
    this.btn.addEventListener('mouseleave', () => {
      this.btn.style.background = 'rgba(100, 180, 255, 0.15)';
    });
    this.btn.addEventListener('click', () => {
      window.electronAPI?.installUpdate();
    });
    this.el.appendChild(this.btn);

    document.getElementById('overlay')!.appendChild(this.el);
  }

  showDownloading(): void {
    this.label.textContent = 'A new update is downloading...';
    this.btn.style.display = 'none';
    this.el.style.display = 'flex';
  }

  showReady(): void {
    this.label.textContent = 'Update ready!';
    this.btn.style.display = 'inline-block';
    this.el.style.display = 'flex';
  }
}
