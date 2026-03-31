/**
 * Shows active shrine blessings with remaining duration.
 * Displays as small icons/labels below the resource HUD.
 */
import { THEME } from '../theme';

// Buff display names and colors
const BUFF_DISPLAY: Record<string, { label: string; icon: string; color: string }> = {
  shrine_speed:   { label: 'Speed',   icon: '⚡', color: '#55ccff' },
  shrine_damage:  { label: 'Damage',  icon: '⚔',  color: '#ff6655' },
  shrine_regen:   { label: 'Regen',   icon: '❤',  color: '#55ff77' },
  shrine_defense: { label: 'Defense', icon: '🛡',  color: '#ffaa33' },
};

interface BuffEntry {
  id: string;
  remaining: number;
  effect: Record<string, number>;
}

export class BlessingHUD {
  readonly el: HTMLElement;
  private entries = new Map<string, HTMLElement>();

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position: absolute',
      'top: 8px',
      'right: 8px',
      'display: flex',
      'flex-direction: column',
      'gap: 4px',
      'pointer-events: none',
      'z-index: 20',
    ].join(';');
  }

  /** Update with current active buffs (call each frame). */
  update(buffs: BuffEntry[]): void {
    // Filter to shrine buffs only
    const shrineBuffs = buffs.filter(b => b.id.startsWith('shrine_'));

    // Remove expired entries
    for (const [id, el] of this.entries) {
      if (!shrineBuffs.find(b => b.id === id)) {
        el.remove();
        this.entries.delete(id);
      }
    }

    // Update or create entries
    for (const buff of shrineBuffs) {
      const display = BUFF_DISPLAY[buff.id];
      if (!display) continue;

      let el = this.entries.get(buff.id);
      if (!el) {
        el = document.createElement('div');
        el.style.cssText = [
          `background: rgba(10, 4, 12, 0.85)`,
          `border: 1px solid ${display.color}44`,
          `border-radius: 4px`,
          `padding: 4px 10px`,
          `font-family: ${THEME.fontMono}`,
          `font-size: 11px`,
          `color: ${display.color}`,
          `letter-spacing: 1px`,
          `white-space: nowrap`,
        ].join(';');
        this.el.appendChild(el);
        this.entries.set(buff.id, el);
      }

      const secs = Math.ceil(buff.remaining);
      const mins = Math.floor(secs / 60);
      const sec = secs % 60;
      const timeStr = mins > 0 ? `${mins}:${String(sec).padStart(2, '0')}` : `${sec}s`;
      el.textContent = `${display.icon} ${display.label} ${timeStr}`;
    }
  }

  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
}
