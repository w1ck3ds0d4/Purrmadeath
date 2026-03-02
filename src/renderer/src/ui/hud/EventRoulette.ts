// ---------------------------------------------------------------------------
// EventRoulette - slot-machine spinner shown at the start of each day
// ---------------------------------------------------------------------------

/** Color palette for each event. */
const EVENT_COLORS: Record<string, string> = {
  meteor_shower: '#ff6633',
  blood_moon:    '#cc2222',
  earthquake:    '#aa8844',
  resource_boom: '#44cc44',
  portal_surge:  '#8844dd',
  solar_eclipse: '#6666bb',
};

/** All possible roulette entries (events + safe day fillers). */
interface RouletteEntry {
  id: string | null;  // null = safe day
  label: string;
  color: string;
}

const SAFE_DAY: RouletteEntry = { id: null, label: 'SAFE DAY', color: '#66bb66' };

// Animation constants
const SPIN_DURATION = 3.0;    // total spin time in seconds
const ITEM_HEIGHT = 48;       // pixels per slot
const VISIBLE_ITEMS = 5;      // how many items visible in the window
const LINGER_DURATION = 1.2;  // how long result stays visible after landing

export class EventRoulette {
  private container: HTMLElement;
  private strip: HTMLElement;
  private entries: RouletteEntry[] = [];
  private targetIndex = 0;
  private elapsed = 0;
  private phase: 'idle' | 'spinning' | 'landed' = 'idle';
  private totalOffset = 0;
  private lingerTimer = 0;
  private resultEventId: string | null = null;
  /** Callback fired when roulette lands on result. Arg is eventId (null = safe day). */
  onLand: ((eventId: string | null) => void) | null = null;

  constructor() {
    // Outer container with viewport mask
    this.container = document.createElement('div');
    this.container.style.cssText = [
      'position: absolute',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 60',
      `width: 340px`,
      `height: ${ITEM_HEIGHT * VISIBLE_ITEMS}px`,
      'overflow: hidden',
      'border: 2px solid rgba(255, 200, 80, 0.5)',
      'border-radius: 8px',
      'background: rgba(4, 4, 12, 0.85)',
      'backdrop-filter: blur(6px)',
      'display: none',
      'pointer-events: none',
      "font-family: 'Segoe UI', monospace",
    ].join('; ');

    // Selection indicator (center highlight bar)
    const indicator = document.createElement('div');
    indicator.style.cssText = [
      'position: absolute',
      'left: 0',
      'right: 0',
      `top: ${ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2)}px`,
      `height: ${ITEM_HEIGHT}px`,
      'background: rgba(255, 200, 80, 0.12)',
      'border-top: 1px solid rgba(255, 200, 80, 0.4)',
      'border-bottom: 1px solid rgba(255, 200, 80, 0.4)',
      'pointer-events: none',
      'z-index: 1',
    ].join('; ');
    this.container.appendChild(indicator);

    // Scrolling strip
    this.strip = document.createElement('div');
    this.strip.style.cssText = [
      'position: absolute',
      'left: 0',
      'right: 0',
      'top: 0',
      'transition: none',
    ].join('; ');
    this.container.appendChild(this.strip);

    const overlay = document.getElementById('overlay')!;
    overlay.appendChild(this.container);
  }

  /** Start the roulette animation. resultEventId=null means safe day. */
  spin(resultEventId: string | null, resultEventName: string | null): void {
    // Build the roulette strip entries
    const allEvents: RouletteEntry[] = Object.entries(EVENT_COLORS).map(([id, color]) => ({
      id,
      label: id.replace(/_/g, ' ').toUpperCase(),
      color,
    }));

    // Create a long shuffled strip with safe day entries mixed in
    this.entries = [];
    const totalEntries = 30; // enough for a convincing spin
    const centerSlot = Math.floor(VISIBLE_ITEMS / 2);
    this.targetIndex = totalEntries - 3; // land near the end

    for (let i = 0; i < totalEntries; i++) {
      if (i === this.targetIndex) {
        // Place the result at the target position
        if (resultEventId) {
          this.entries.push({
            id: resultEventId,
            label: (resultEventName ?? resultEventId).toUpperCase(),
            color: EVENT_COLORS[resultEventId] ?? '#ffaa33',
          });
        } else {
          this.entries.push(SAFE_DAY);
        }
      } else {
        // Random filler: mix of events and safe days
        if (Math.random() < 0.35) {
          this.entries.push(SAFE_DAY);
        } else {
          const rndEvt = allEvents[Math.floor(Math.random() * allEvents.length)];
          this.entries.push(rndEvt);
        }
      }
    }

    // Build DOM items
    this.strip.innerHTML = '';
    for (const entry of this.entries) {
      const item = document.createElement('div');
      item.style.cssText = [
        `height: ${ITEM_HEIGHT}px`,
        `line-height: ${ITEM_HEIGHT}px`,
        'text-align: center',
        'font-size: 18px',
        'font-weight: bold',
        'letter-spacing: 2px',
        `color: ${entry.color}`,
        'text-shadow: 0 0 8px rgba(0,0,0,0.8)',
        'white-space: nowrap',
        'overflow: hidden',
        'text-overflow: ellipsis',
      ].join('; ');
      item.textContent = entry.label;
      this.strip.appendChild(item);
    }

    // The final offset: target item should be centered in the window
    this.totalOffset = (this.targetIndex - centerSlot) * ITEM_HEIGHT;

    this.resultEventId = resultEventId;
    this.elapsed = 0;
    this.phase = 'spinning';
    this.lingerTimer = 0;
    this.container.style.display = 'block';
    this.strip.style.top = '0px';
  }

  /** Call every frame with dt in seconds. */
  update(dt: number): void {
    if (this.phase === 'idle') return;

    if (this.phase === 'spinning') {
      this.elapsed += dt;
      const t = Math.min(this.elapsed / SPIN_DURATION, 1);

      // Ease-out cubic for deceleration
      const eased = 1 - Math.pow(1 - t, 3);
      const offset = eased * this.totalOffset;
      this.strip.style.top = -offset + 'px';

      if (t >= 1) {
        this.phase = 'landed';
        this.lingerTimer = LINGER_DURATION;
        // Snap to exact position
        this.strip.style.top = -this.totalOffset + 'px';
        this.onLand?.(this.resultEventId);
      }
    } else if (this.phase === 'landed') {
      this.lingerTimer -= dt;
      if (this.lingerTimer <= 0) {
        this.hide();
      }
    }
  }

  hide(): void {
    this.phase = 'idle';
    this.container.style.display = 'none';
  }

  isActive(): boolean {
    return this.phase !== 'idle';
  }
}
