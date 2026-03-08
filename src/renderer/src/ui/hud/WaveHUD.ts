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
import { THEME } from '../theme';
import { getSpawnWeights, ENEMY_VARIANT_NAMES } from '@shared/definitions/EnemyVariants';

/** Escape HTML entities to prevent XSS from server-controlled strings. */
function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Top offset: below minimap (220px) + padding (12px) + coords row (~20px) + gaps */
const HUD_TOP = 258;
const BOX_WIDTH = 220;
const BOX_CSS = [
  'position: absolute',
  'right: 12px',
  'z-index: 20',
  `background: ${THEME.panelBgLight}`,
  `backdrop-filter: ${THEME.blurLight}`,
  `border: 1px solid ${THEME.borderDefault}`,
  `width: ${BOX_WIDTH}px`,
  'box-sizing: border-box',
  'padding: 8px 20px',
  `font-family: ${THEME.fontUI}`,
  'font-size: 15px',
  `color: ${THEME.textPrimary}`,
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

  /** Active wave modifiers (Swarm, Fog, etc). */
  private activeModifiers: { id: string; name: string; description: string; color: number }[] = [];
  /** Active world event name (or null). */
  private activeEventName: string | null = null;
  /** Big center banner element for event announcements. */
  private bannerEl: HTMLElement;
  /** Subtitle element below banner for event descriptions. */
  private bannerDescEl: HTMLElement;
  private bannerTimer = 0;
  /** Centered countdown element (5-4-3-2-1 before wave). */
  private countdownEl: HTMLElement;
  private duskTimer = 0;

  /** Boss HP bar elements (top center). */
  private bossBarContainer: HTMLElement;
  private bossBarNameEl: HTMLElement;
  private bossBarFill: HTMLElement;
  private bossBarHpText: HTMLElement;
  private activeBoss: { entityId: number; name: string; maxHp: number } | null = null;

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

    // Sleep button - positioned dynamically below wave box in render()
    this.sleepBtn = document.createElement('button');
    this.sleepBtn.id = 'sleep-btn';
    this.sleepBtn.style.cssText = [
      'position: absolute',
      'right: 12px',
      `width: ${BOX_WIDTH}px`,
      'display: none',
      'z-index: 20',
      'padding: 5px 16px',
      'background: rgba(60, 60, 120, 0.8)',
      `backdrop-filter: ${THEME.blurLight}`,
      'border: 1px solid rgba(140, 140, 255, 0.4)',
      `border-radius: ${THEME.radiusSm}`,
      'color: #aabbee',
      `font-family: ${THEME.fontUI}`,
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

    // Vote count text - positioned dynamically below sleep button in render()
    this.voteEl = document.createElement('div');
    this.voteEl.style.cssText = [
      'position: absolute',
      'right: 12px',
      `width: ${BOX_WIDTH}px`,
      'font-size: 11px',
      'color: #8899bb',
      'display: none',
      'text-align: center',
      'pointer-events: none',
      `font-family: ${THEME.fontUI}`,
    ].join('; ');

    // Event banner (big centered text, hidden by default)
    this.bannerEl = document.createElement('div');
    this.bannerEl.style.cssText = [
      'position: absolute',
      'top: 20%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      "font-family: 'Segoe UI', Impact, monospace",
      'font-size: 36px',
      'font-weight: bold',
      'letter-spacing: 4px',
      'color: #ffcc44',
      'text-shadow: 0 0 20px #ff8800, 0 0 40px #ff4400, 0 2px 4px rgba(0,0,0,0.8)',
      'pointer-events: none',
      'opacity: 0',
      'transition: opacity 0.5s ease-out',
      'text-align: center',
      'white-space: nowrap',
    ].join('; ');

    // Description subtitle below the banner title
    this.bannerDescEl = document.createElement('div');
    this.bannerDescEl.style.cssText = [
      'position: absolute',
      'top: calc(20% + 36px)',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      "font-family: 'Segoe UI', monospace",
      'font-size: 16px',
      'font-weight: normal',
      'letter-spacing: 1px',
      'color: #ddc88a',
      'text-shadow: 0 0 10px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8)',
      'pointer-events: none',
      'opacity: 0',
      'transition: opacity 0.5s ease-out',
      'text-align: center',
      'white-space: nowrap',
    ].join('; ');

    // Wave countdown (big centered number during dusk)
    this.countdownEl = document.createElement('div');
    this.countdownEl.style.cssText = [
      'position: absolute',
      'top: 40%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 50',
      "font-family: 'Segoe UI', Impact, monospace",
      'font-size: 72px',
      'font-weight: bold',
      'color: #ff6644',
      'text-shadow: 0 0 20px rgba(255, 50, 20, 0.6), 0 2px 6px rgba(0,0,0,0.8)',
      'pointer-events: none',
      'opacity: 0',
      'transition: opacity 0.2s',
    ].join('; ');

    // Boss HP bar (top center, hidden by default)
    this.bossBarContainer = document.createElement('div');
    this.bossBarContainer.style.cssText = [
      'position: absolute',
      'top: 24px',
      'left: 50%',
      'transform: translateX(-50%)',
      'z-index: 30',
      'display: none',
      'text-align: center',
      'pointer-events: none',
    ].join('; ');

    this.bossBarNameEl = document.createElement('div');
    this.bossBarNameEl.style.cssText = `font-family:${THEME.fontUI};font-size:18px;font-weight:700;color:#ffcc44;letter-spacing:3px;margin-bottom:4px;text-shadow:0 1px 4px rgba(0,0,0,0.8);`;

    const barOuter = document.createElement('div');
    barOuter.style.cssText = 'width:400px;height:10px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.15);border-radius:3px;overflow:hidden;';

    this.bossBarFill = document.createElement('div');
    this.bossBarFill.style.cssText = 'width:100%;height:100%;background:linear-gradient(90deg,#cc2222,#ff4444);border-radius:2px;transition:width 0.2s ease;';
    barOuter.appendChild(this.bossBarFill);

    this.bossBarHpText = document.createElement('div');
    this.bossBarHpText.style.cssText = `font-family:${THEME.fontMono};font-size:11px;color:${THEME.textSecondary};margin-top:2px;`;

    this.bossBarContainer.append(this.bossBarNameEl, barOuter, this.bossBarHpText);

    const overlay = document.getElementById('overlay')!;
    overlay.appendChild(this.timeEl);
    overlay.appendChild(this.waveEl);
    overlay.appendChild(this.sleepBtn);
    overlay.appendChild(this.voteEl);
    overlay.appendChild(this.bannerEl);
    overlay.appendChild(this.bannerDescEl);
    overlay.appendChild(this.countdownEl);
    overlay.appendChild(this.bossBarContainer);
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
    this.activeModifiers = [];
    this.activeEventName = null;
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
        this.duskTimer = 5; // DUSK_DAWN_DURATION
        // Show wave preview banner
        {
          const weights = getSpawnWeights(this.waveNumber);
          const enemies = weights.map(w => ENEMY_VARIANT_NAMES[w.variant]).join(', ');
          this.showBanner(`Wave ${this.waveNumber} Incoming!`, enemies);
        }
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

  /** Called when WAVE_MODIFIER arrives from server. */
  onWaveModifier(modifiers: { id: string; name: string; description: string; color: number }[]): void {
    this.activeModifiers = modifiers;
    this.dirty = true;
    if (modifiers.length > 0) {
      this.showBanner(modifiers.map(m => m.name.toUpperCase()).join(' + '));
    }
  }

  /** Called when WORLD_EVENT_START arrives. */
  onWorldEventStart(eventId: string, name: string, description: string, duration: number): void {
    this.activeEventName = name;
    this.dirty = true;
    // Show big center banner with description
    this.showBanner(name.toUpperCase(), description);
  }

  /** Show a "Safe Day" banner (called from EventRoulette landing on null). */
  onSafeDay(): void {
    this.showBanner('SAFE DAY', 'No events today - prepare your defenses', '#66bb66');
  }

  /** Called when a boss spawns - show the HP bar. */
  onBossSpawn(entityId: number, bossName: string, description: string, maxHp: number): void {
    this.activeBoss = { entityId, name: bossName, maxHp };
    this.bossBarNameEl.textContent = bossName.toUpperCase();
    this.bossBarFill.style.width = '100%';
    this.bossBarHpText.textContent = '';
    this.bossBarContainer.style.display = 'block';
    this.showBanner(bossName.toUpperCase(), description, '#ff4444');
  }

  /** Called when a boss changes phase - flash banner text. */
  onBossPhase(entityId: number, bannerText: string): void {
    this.showBanner(bannerText, undefined, '#ff6644');
  }

  /** Update the boss HP bar from the entity's current HP. Call each frame. */
  updateBossHp(entityId: number, currentHp: number, maxHp: number): void {
    if (!this.activeBoss || this.activeBoss.entityId !== entityId) return;
    const pct = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));
    this.bossBarFill.style.width = `${pct}%`;
    if (pct < 25) {
      this.bossBarFill.style.background = 'linear-gradient(90deg,#881111,#cc2222)';
    } else if (pct < 50) {
      this.bossBarFill.style.background = 'linear-gradient(90deg,#cc6622,#ff8844)';
    } else {
      this.bossBarFill.style.background = 'linear-gradient(90deg,#cc2222,#ff4444)';
    }
    this.bossBarHpText.textContent = `${Math.ceil(currentHp)} / ${maxHp}`;

    // Hide bar if boss is dead
    if (currentHp <= 0) {
      this.activeBoss = null;
      this.bossBarContainer.style.display = 'none';
    }
  }

  /** Remove boss HP bar (boss died or wave ended). */
  hideBossBar(): void {
    this.activeBoss = null;
    this.bossBarContainer.style.display = 'none';
  }

  /** Get the tracked boss entity ID (for HP bar updates from game loop). */
  getActiveBossEntityId(): number | null {
    return this.activeBoss?.entityId ?? null;
  }

  /** Called when WORLD_EVENT_END arrives. */
  onWorldEventEnd(): void {
    this.activeEventName = null;
    this.dirty = true;
  }

  /** Show a dramatic banner in the center of the screen for 3 seconds. */
  private showBanner(text: string, description?: string, color?: string): void {
    if (this.paused) return;
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = color ?? '#ffcc44';
    this.bannerEl.style.opacity = '1';
    if (description) {
      this.bannerDescEl.textContent = description;
      this.bannerDescEl.style.opacity = '1';
    } else {
      this.bannerDescEl.style.opacity = '0';
    }
    this.bannerTimer = 3;
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

    // Dusk countdown (5-4-3-2-1)
    if (this.phase === 'dusk') {
      const prevCount = Math.ceil(this.duskTimer);
      this.duskTimer = Math.max(0, this.duskTimer - dt);
      const count = Math.ceil(this.duskTimer);
      if (count !== prevCount || count === 0) {
        if (count > 0) {
          this.countdownEl.textContent = String(count);
          this.countdownEl.style.opacity = '1';
          this.countdownEl.style.transform = 'translate(-50%, -50%) scale(1.3)';
          setTimeout(() => { this.countdownEl.style.transform = 'translate(-50%, -50%) scale(1)'; }, 50);
        } else {
          this.countdownEl.style.opacity = '0';
        }
      }
    } else if (this.countdownEl.style.opacity !== '0') {
      this.countdownEl.style.opacity = '0';
    }

    // Banner fade-out
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.bannerEl.style.opacity = '0';
        this.bannerDescEl.style.opacity = '0';
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

  get currentPhase(): string { return this.phase; }

  setPaused(p: boolean): void {
    this.paused = p;
    this.dirty = true;
    if (p) {
      this.bannerEl.style.opacity = '0';
      this.bannerDescEl.style.opacity = '0';
      this.bannerTimer = 0;
    }
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

    // ── Modifier tags (append below wave text) ──
    if (this.activeModifiers.length > 0) {
      const tags = this.activeModifiers.map(m => {
        const hex = '#' + m.color.toString(16).padStart(6, '0');
        return `<span style="color:${hex};font-weight:bold;font-size:12px;letter-spacing:0.5px">${esc(m.name.toUpperCase())}</span>`;
      }).join(' <span style="color:#555;font-size:10px">|</span> ');
      this.waveEl.innerHTML += `<br><span style="font-size:11px">${tags}</span>`;
    }

    // ── Active world event tag ──
    if (this.activeEventName) {
      this.waveEl.innerHTML += `<br><span style="color:#ff8844;font-weight:bold;font-size:11px;letter-spacing:0.5px">${esc(this.activeEventName.toUpperCase())}</span>`;
    }

    // Dynamically position sleep button below wave box (which may have extra lines)
    const waveBoxBottom = this.waveEl.offsetTop + this.waveEl.offsetHeight;
    const sleepTop = waveBoxBottom + WaveHUD.GAP;

    // Grey out sleep during active events
    const eventActive = this.activeEventName !== null;

    // Sleep button
    this.sleepBtn.style.display = showSleep ? 'block' : 'none';
    if (showSleep) {
      this.sleepBtn.style.top = sleepTop + 'px';
      if (eventActive) {
        this.sleepBtn.textContent = 'Sleep';
        this.sleepBtn.style.background = 'rgba(40, 40, 50, 0.6)';
        this.sleepBtn.style.borderColor = 'rgba(80, 80, 80, 0.3)';
        this.sleepBtn.style.color = '#556';
        this.sleepBtn.style.cursor = 'not-allowed';
        this.sleepBtn.style.pointerEvents = 'none';
      } else {
        this.sleepBtn.textContent = this.hasVotedSleep ? 'Cancel' : 'Sleep';
        this.sleepBtn.style.background = this.hasVotedSleep ? 'rgba(120, 60, 60, 0.8)' : 'rgba(60, 60, 120, 0.8)';
        this.sleepBtn.style.borderColor = this.hasVotedSleep ? 'rgba(255, 140, 140, 0.4)' : 'rgba(140, 140, 255, 0.4)';
        this.sleepBtn.style.color = this.hasVotedSleep ? '#ffaaaa' : '#aabbee';
        this.sleepBtn.style.cursor = 'pointer';
        this.sleepBtn.style.pointerEvents = 'auto';
      }
    }

    // Vote count - positioned below sleep button
    if (showSleep && this.sleepVotes > 0 && !eventActive) {
      this.voteEl.style.top = (sleepTop + 30 + WaveHUD.GAP) + 'px';
      this.voteEl.textContent = `${this.sleepVotes}/${this.totalPlayers} ready to sleep`;
      this.voteEl.style.color = '#8899bb';
      this.voteEl.style.fontSize = '11px';
      this.voteEl.style.display = 'block';
    } else {
      this.voteEl.style.display = 'none';
    }
  }
}
