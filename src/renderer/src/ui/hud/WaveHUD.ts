/**
 * Top-right overlay showing day/night time + wave status as two separate boxes:
 *  - Top box:    Time display (Day timer, Nightfall, Dawn, etc.)
 *  - Bottom box: Wave status (Wave N, ACTIVE, Cleared, etc.)
 *
 * Below both boxes: Sleep button + vote count (during day phase).
 *
 * Purely DOM-based, appended to #overlay, same pattern as PauseBanner.
 */
import type { DayNightPhase } from '@shared/protocol';

/** Top offset: below minimap (220px) + padding (12px) + coords row (~20px) + gaps */
const HUD_TOP = 258;
const BOX_WIDTH = 220;
const BOX_CSS = [
  'position: absolute',
  'right: 12px',
  'z-index: 20',
  'background: rgba(4, 4, 10, 0.75)',
  'backdrop-filter: blur(4px)',
  'border: 1px solid rgba(255, 255, 255, 0.14)',
  `width: ${BOX_WIDTH}px`,
  'box-sizing: border-box',
  'padding: 8px 20px',
  "font-family: 'Segoe UI', monospace",
  'font-size: 15px',
  'color: #ccd8ea',
  'letter-spacing: 1px',
  'display: none',
  'text-align: center',
  'white-space: nowrap',
  'pointer-events: none',
].join('; ');

export class WaveHUD {
  /** Top box - time/phase display. */
  private timeEl: HTMLElement;
  /** Bottom box - wave status display. */
  private waveEl: HTMLElement;
  private sleepBtn: HTMLButtonElement;
  private voteEl: HTMLElement;
  private phase: 'hidden' | 'day' | 'dusk' | 'night' | 'active' | 'dawn' | 'cleared' = 'hidden';
  private waveNumber = 0;
  /** Seconds remaining for the "Cleared!" flash. */
  private clearedTimer = 0;
  private static readonly CLEARED_DURATION = 4;
  /** When true, the server has paused the wave timer (debug). */
  private paused = false;

  // Day/night state
  private dayTimeRemaining = 0;
  private sleepVotes = 0;
  private totalPlayers = 0;
  private hasVotedSleep = false;

  /** Callback to send sleep vote to server. */
  private onSleepVote: ((vote: boolean) => void) | null = null;

  /** Dirty flag - only update DOM when needed. */
  private dirty = true;
  /** When true, all display updates are suppressed (e.g. skill tree is open). */
  private forcedHidden = false;

  /** Pixel heights for layout positioning. */
  private static readonly TIME_BOX_HEIGHT = 38;
  private static readonly WAVE_BOX_HEIGHT = 38;
  private static readonly GAP = 4;

  constructor() {
    // Time box (top)
    this.timeEl = document.createElement('div');
    this.timeEl.id = 'time-hud';
    this.timeEl.style.cssText = BOX_CSS + `; top: ${HUD_TOP}px`;

    // Wave box (below time box)
    const waveTop = HUD_TOP + WaveHUD.TIME_BOX_HEIGHT + WaveHUD.GAP;
    this.waveEl = document.createElement('div');
    this.waveEl.id = 'wave-hud';
    this.waveEl.style.cssText = BOX_CSS + `; top: ${waveTop}px`;

    // Sleep button - below wave box
    const sleepTop = waveTop + WaveHUD.WAVE_BOX_HEIGHT + WaveHUD.GAP;
    this.sleepBtn = document.createElement('button');
    this.sleepBtn.id = 'sleep-btn';
    this.sleepBtn.style.cssText = [
      'position: absolute',
      `top: ${sleepTop}px`,
      'right: 12px',
      `width: ${BOX_WIDTH}px`,
      'display: none',
      'z-index: 20',
      'padding: 5px 16px',
      'background: rgba(60, 60, 120, 0.8)',
      'backdrop-filter: blur(4px)',
      'border: 1px solid rgba(140, 140, 255, 0.4)',
      'border-radius: 4px',
      'color: #aabbee',
      "font-family: 'Segoe UI', monospace",
      'font-size: 13px',
      'cursor: pointer',
      'letter-spacing: 1px',
      'pointer-events: auto',
      'text-align: center',
      'box-sizing: border-box',
    ].join('; ');
    this.sleepBtn.textContent = 'Sleep';
    this.sleepBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSleepVote();
    });

    // Vote count text - below the sleep button
    const voteTop = sleepTop + 30 + WaveHUD.GAP;
    this.voteEl = document.createElement('div');
    this.voteEl.style.cssText = [
      'position: absolute',
      `top: ${voteTop}px`,
      'right: 12px',
      `width: ${BOX_WIDTH}px`,
      'font-size: 11px',
      'color: #8899bb',
      'display: none',
      'text-align: center',
      'pointer-events: none',
      "font-family: 'Segoe UI', monospace",
    ].join('; ');

    const overlay = document.getElementById('overlay')!;
    overlay.appendChild(this.timeEl);
    overlay.appendChild(this.waveEl);
    overlay.appendChild(this.sleepBtn);
    overlay.appendChild(this.voteEl);
  }

  /** Set the sleep vote callback. */
  setSleepVoteCallback(cb: (vote: boolean) => void): void {
    this.onSleepVote = cb;
  }

  private toggleSleepVote(): void {
    this.hasVotedSleep = !this.hasVotedSleep;
    this.onSleepVote?.(this.hasVotedSleep);
    this.dirty = true;
  }

  /** Called when WAVE_START arrives from server. */
  onWaveStart(waveNumber: number, prepDuration: number): void {
    this.waveNumber = waveNumber;
    if (prepDuration === 0) {
      this.phase = 'active';
    } else {
      this.phase = 'day';
    }
    if (!this.forcedHidden) {
      this.timeEl.style.display = 'block';
      this.waveEl.style.display = 'block';
    }
    this.dirty = true;
  }

  /** Called when WAVE_END arrives from server. */
  onWaveEnd(waveNumber: number): void {
    this.waveNumber = waveNumber;
    this.phase = 'cleared';
    this.clearedTimer = WaveHUD.CLEARED_DURATION;
    this.dirty = true;
  }

  /** Called when WAVE_TIMER_SYNC arrives - authoritative server correction. */
  onTimerSync(waveNumber: number, remaining: number, paused: boolean): void {
    this.paused = paused;
    this.waveNumber = waveNumber;

    if (remaining >= 0 && this.phase === 'day') {
      this.dayTimeRemaining = remaining;
    }
    this.dirty = true;
  }

  /** Called when DAY_NIGHT_SYNC arrives from server. */
  onDayNightSync(phase: DayNightPhase, dayTimeRemaining: number, sleepVotes: number, totalPlayers: number): void {
    this.dayTimeRemaining = dayTimeRemaining;
    this.sleepVotes = sleepVotes;
    this.totalPlayers = totalPlayers;

    switch (phase) {
      case 'day':
        if (this.phase !== 'cleared') {
          this.phase = 'day';
        }
        break;
      case 'dusk':
        this.phase = 'dusk';
        this.hasVotedSleep = false;
        break;
      case 'night':
        this.phase = 'active';
        break;
      case 'dawn':
        this.phase = 'dawn';
        break;
    }
    if (!this.forcedHidden) {
      this.timeEl.style.display = 'block';
      this.waveEl.style.display = 'block';
    }
    this.dirty = true;
  }

  /** Called when SLEEP_UPDATE arrives from server. */
  onSleepUpdate(votes: number, needed: number, _voterSlots: number[]): void {
    this.sleepVotes = votes;
    this.totalPlayers = needed;
    this.dirty = true;
  }

  /** Tick timers - call each frame with frame delta. */
  update(dt: number): void {
    if (this.phase === 'day') {
      if (!this.paused) {
        const prev = Math.floor(this.dayTimeRemaining);
        this.dayTimeRemaining = Math.max(0, this.dayTimeRemaining - dt);
        if (Math.floor(this.dayTimeRemaining) !== prev) this.dirty = true;
      }
    } else if (this.phase === 'cleared') {
      this.clearedTimer -= dt;
      if (this.clearedTimer <= 0) {
        this.phase = 'day';
        this.dirty = true;
      }
    }

    if (this.dirty && !this.forcedHidden) {
      this.dirty = false;
      this.render();
    }
  }

  setVisible(visible: boolean): void {
    this.forcedHidden = !visible;
    if (visible && this.phase !== 'hidden') {
      this.timeEl.style.display = 'block';
      this.waveEl.style.display = 'block';
      this.dirty = true;
    } else if (!visible) {
      this.timeEl.style.display = 'none';
      this.waveEl.style.display = 'none';
      this.sleepBtn.style.display = 'none';
      this.voteEl.style.display = 'none';
    }
  }

  hide(): void {
    this.phase = 'hidden';
    this.timeEl.style.display = 'none';
    this.waveEl.style.display = 'none';
    this.sleepBtn.style.display = 'none';
    this.voteEl.style.display = 'none';
    this.hasVotedSleep = false;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.dirty = true;
  }

  private render(): void {
    const showSleep = this.phase === 'day';

    // ── Time box (top) ──
    if (this.phase === 'day') {
      const mins = Math.floor(this.dayTimeRemaining / 60);
      const secs = Math.floor(this.dayTimeRemaining % 60);
      const ss = secs.toString().padStart(2, '0');
      const pauseTag = this.paused ? ' <span style="color:#ffaa33;font-weight:bold;font-size:12px">PAUSED</span>' : '';
      this.timeEl.innerHTML = `<span style="color:#ffdd66">Day</span> - ${mins}:${ss}${pauseTag}`;

    } else if (this.phase === 'dusk') {
      this.timeEl.innerHTML = `<span style="color:#8866cc;font-weight:bold">Nightfall...</span>`;

    } else if (this.phase === 'active') {
      this.timeEl.innerHTML = `<span style="color:#6666bb">Night</span>`;

    } else if (this.phase === 'dawn') {
      this.timeEl.innerHTML = `<span style="color:#ffaa44;font-weight:bold">Dawn</span>`;

    } else if (this.phase === 'cleared') {
      this.timeEl.innerHTML = `<span style="color:#ffdd66">Day</span>`;
    }

    // ── Wave box (bottom) ──
    if (this.phase === 'day' || this.phase === 'cleared') {
      this.waveEl.innerHTML = `Wave ${this.waveNumber} - <span style="color:#88aadd">Preparing</span>`;

    } else if (this.phase === 'dusk') {
      this.waveEl.innerHTML = `Wave ${this.waveNumber} - <span style="color:#cc8844">Incoming</span>`;

    } else if (this.phase === 'active') {
      this.waveEl.innerHTML = `Wave ${this.waveNumber} - <span style="color:#ff6644;font-weight:bold">ACTIVE</span>`;

    } else if (this.phase === 'dawn') {
      this.waveEl.innerHTML = `Wave ${this.waveNumber} - <span style="color:#44cc44;font-weight:bold">Cleared!</span>`;
    }

    // Sleep button
    this.sleepBtn.style.display = showSleep ? 'block' : 'none';
    if (showSleep) {
      this.sleepBtn.textContent = this.hasVotedSleep ? 'Cancel' : 'Sleep';
      this.sleepBtn.style.background = this.hasVotedSleep ? 'rgba(120, 60, 60, 0.8)' : 'rgba(60, 60, 120, 0.8)';
      this.sleepBtn.style.borderColor = this.hasVotedSleep ? 'rgba(255, 140, 140, 0.4)' : 'rgba(140, 140, 255, 0.4)';
      this.sleepBtn.style.color = this.hasVotedSleep ? '#ffaaaa' : '#aabbee';
    }

    // Vote count (only during day with active votes)
    if (showSleep && this.sleepVotes > 0) {
      this.voteEl.textContent = `${this.sleepVotes}/${this.totalPlayers} ready to sleep`;
      this.voteEl.style.color = '#8899bb';
      this.voteEl.style.fontSize = '11px';
      this.voteEl.style.display = 'block';
    } else {
      this.voteEl.style.display = 'none';
    }
  }
}
