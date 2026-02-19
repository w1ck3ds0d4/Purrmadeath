/**
 * Top-right overlay showing wave status:
 *  - Prep phase:  "Wave N starts in M:SS"
 *  - Active phase: "Wave N ACTIVE"
 *  - Cleared:      "Wave N Cleared!" (for a few seconds)
 *
 * Purely DOM-based, appended to #overlay, same pattern as PauseBanner.
 */
/** Top offset: below minimap (220px) + padding (12px) + coords row (~20px) + gaps */
const WAVE_HUD_TOP = 258;

export class WaveHUD {
  private el: HTMLElement;
  private prepTimer = 0;
  private phase: 'hidden' | 'prep' | 'active' | 'cleared' = 'hidden';
  private waveNumber = 0;
  /** Seconds remaining for the "Cleared!" flash. */
  private clearedTimer = 0;
  private static readonly CLEARED_DURATION = 4;
  /** When true, the server has paused the wave timer (debug). */
  private paused = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'wave-hud';
    this.el.style.cssText = [
      'position: absolute',
      `top: ${WAVE_HUD_TOP}px`,
      'right: 12px',
      'z-index: 20',
      'background: rgba(4, 4, 10, 0.75)',
      'backdrop-filter: blur(4px)',
      'border: 1px solid rgba(255, 255, 255, 0.14)',
      'width: 220px',
      'box-sizing: border-box',
      'padding: 10px 20px',
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

  /** Called when WAVE_START arrives from server. */
  onWaveStart(waveNumber: number, prepDuration: number): void {
    this.waveNumber = waveNumber;
    if (prepDuration > 0) {
      this.phase = 'prep';
      this.prepTimer = prepDuration;
    } else {
      // prepDuration=0 means portals are now live
      this.phase = 'active';
    }
    this.el.style.display = 'block';
    this.render();
  }

  /** Called when WAVE_END arrives from server. */
  onWaveEnd(waveNumber: number): void {
    this.waveNumber = waveNumber;
    this.phase = 'cleared';
    this.clearedTimer = WaveHUD.CLEARED_DURATION;
    this.render();
  }

  /** Called when WAVE_TIMER_SYNC arrives - authoritative server correction. */
  onTimerSync(waveNumber: number, remaining: number, paused: boolean): void {
    this.paused = paused;
    this.waveNumber = waveNumber;

    if (remaining >= 0 && this.phase === 'prep') {
      // Snap local timer to server's authoritative value
      this.prepTimer = remaining;
    }
    this.render();
  }

  /** Tick timers - call each frame with frame delta. */
  update(dt: number): void {
    if (this.phase === 'prep') {
      if (!this.paused) this.prepTimer = Math.max(0, this.prepTimer - dt);
      this.render();
    } else if (this.phase === 'cleared') {
      this.clearedTimer -= dt;
      if (this.clearedTimer <= 0) {
        this.phase = 'hidden';
        this.el.style.display = 'none';
      }
    }
  }

  setVisible(visible: boolean): void {
    if (visible && this.phase !== 'hidden') {
      this.el.style.display = 'block';
    } else if (!visible) {
      this.el.style.display = 'none';
    }
  }

  hide(): void {
    this.phase = 'hidden';
    this.el.style.display = 'none';
  }

  private render(): void {
    if (this.phase === 'prep') {
      const mins = Math.floor(this.prepTimer / 60);
      const secs = Math.floor(this.prepTimer % 60);
      const ss = secs.toString().padStart(2, '0');
      const pauseTag = this.paused ? ' <span style="color:#ffaa33;font-weight:bold">PAUSED</span>' : '';
      this.el.innerHTML = `Wave ${this.waveNumber} starts in ${mins}:${ss}${pauseTag}`;
    } else if (this.phase === 'active') {
      this.el.innerHTML = `Wave ${this.waveNumber} <span style="color:#ff6644;font-weight:bold">ACTIVE</span>`;
    } else if (this.phase === 'cleared') {
      this.el.innerHTML = `Wave ${this.waveNumber} <span style="color:#44cc44;font-weight:bold">Cleared!</span>`;
    }
  }
}
