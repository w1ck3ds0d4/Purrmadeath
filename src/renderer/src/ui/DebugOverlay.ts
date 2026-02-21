import { CHUNK_SIZE, TILE_SIZE, TICK_RATE } from '@shared/constants';
import type { Camera } from '../render/Camera';

export interface NetStats {
  rtt: number;
  packetLoss: number;
  msgsPerSec: number;
}

export interface ServerStats {
  wave: number;
  enemyCount: number;
  portalCount: number;
  playerCount: number;
  tickProfile?: {
    combat: number; enemy: number; movement: number;
    projectile: number; buildings: number; waves: number; total: number;
  };
}

export interface DebugInfo {
  camera: Camera;
  loadedChunks: number;
  entityCount: number;
  biome: string;
  seed: number;
  net?: NetStats;
  server?: ServerStats;
}

type CheatHandler = (cmd: string, args: string[]) => void;
type ActiveView = 'core' | 'net' | 'server' | 'all' | 'logs' | 'help' | null;

const MAX_LOG_ENTRIES = 100;

/**
 * HTML-based debug console toggled with F4.
 * Type commands like /core, /net, /server, /all, /logs, /help.
 */
export class DebugOverlay {
  private el: HTMLElement;
  private statsEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private visible = false;
  private activeView: ActiveView = null;
  private cheatHandler: CheatHandler | null = null;

  // FPS tracking
  private frameCount = 0;
  private elapsed = 0;
  private fps = 0;

  // Log buffer
  private logEntries: string[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'debug-console';
    this.el.style.cssText = [
      'position: absolute',
      'top: 8px',
      'left: 8px',
      'z-index: 40',
      'display: none',
      'flex-direction: column',
      'max-width: 420px',
      'max-height: 50vh',
      'pointer-events: auto',
      'user-select: none',
    ].join('; ');

    // Stats output
    this.statsEl = document.createElement('pre');
    this.statsEl.style.cssText = [
      'margin: 0',
      'padding: 8px 10px',
      'background: rgba(0, 0, 0, 0.75)',
      'color: #00ff88',
      'font-family: monospace',
      'font-size: 11px',
      'line-height: 16px',
      'border-radius: 6px 6px 0 0',
      'border: 1px solid rgba(0, 255, 136, 0.15)',
      'border-bottom: none',
      'overflow-y: auto',
      'max-height: 40vh',
      'white-space: pre-wrap',
      'scrollbar-width: none',
    ].join('; ');
    this.el.appendChild(this.statsEl);

    // Input row
    const inputRow = document.createElement('div');
    inputRow.style.cssText = [
      'display: flex',
      'align-items: center',
      'background: rgba(0, 0, 0, 0.85)',
      'border-radius: 0 0 6px 6px',
      'border: 1px solid rgba(0, 255, 136, 0.15)',
      'padding: 4px 8px',
    ].join('; ');

    const prompt = document.createElement('span');
    prompt.textContent = '>';
    prompt.style.cssText = 'color: #00ff88; font-family: monospace; font-size: 12px; margin-right: 6px;';
    inputRow.appendChild(prompt);

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.spellcheck = false;
    this.inputEl.autocomplete = 'off';
    this.inputEl.placeholder = 'type /help';
    this.inputEl.style.cssText = [
      'flex: 1',
      'background: transparent',
      'border: none',
      'outline: none',
      'color: #00ff88',
      'font-family: monospace',
      'font-size: 12px',
      'caret-color: #00ff88',
    ].join('; ');
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.executeCommand(this.inputEl.value.trim());
        this.inputEl.value = '';
        this.inputEl.blur();
      }
      // Stop key events from propagating to game input while typing
      e.stopPropagation();
    });
    inputRow.appendChild(this.inputEl);
    this.el.appendChild(inputRow);

    document.getElementById('overlay')!.appendChild(this.el);

    // F4 toggles console
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F4') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  get isOpen(): boolean {
    return this.visible;
  }

  onCheat(handler: CheatHandler): void {
    this.cheatHandler = handler;
  }

  log(msg: string): void {
    const time = new Date();
    const ts = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;
    this.logEntries.push(`[${ts}] ${msg}`);
    if (this.logEntries.length > MAX_LOG_ENTRIES) {
      this.logEntries.shift();
    }
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
    this.inputEl.blur();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'flex' : 'none';
    if (this.visible) {
      if (this.activeView === null) this.activeView = 'all';
      this.inputEl.focus();
    } else {
      this.inputEl.blur();
    }
  }

  update(dt: number, info: DebugInfo): void {
    // Always track FPS
    this.frameCount++;
    this.elapsed += dt;
    if (this.elapsed >= 0.5) {
      this.fps = Math.round(this.frameCount / this.elapsed);
      this.frameCount = 0;
      this.elapsed = 0;
    }

    if (!this.visible || this.activeView === null) return;

    const lines: string[] = [];

    if (this.activeView === 'core' || this.activeView === 'all') {
      const { camera, loadedChunks, entityCount, biome, seed } = info;
      const chunkPixels = CHUNK_SIZE * TILE_SIZE;
      const cx = Math.floor(camera.x / chunkPixels);
      const cy = Math.floor(camera.y / chunkPixels);
      lines.push(
        '── Core ──',
        `FPS:      ${this.fps}`,
        `Entities: ${entityCount}`,
        `Pos:      (${Math.round(camera.x)}, ${Math.round(camera.y)})`,
        `Chunk:    (${cx}, ${cy})`,
        `Biome:    ${biome}`,
        `Chunks:   ${loadedChunks}`,
        `Seed:     ${seed}`,
      );
    }

    if (this.activeView === 'net' || this.activeView === 'all') {
      if (lines.length > 0) lines.push('');
      if (info.net) {
        const { rtt, packetLoss, msgsPerSec } = info.net;
        lines.push(
          '── Network ──',
          `RTT:       ${rtt} ms`,
          `Loss:      ${packetLoss}%`,
          `Svr msg/s: ${msgsPerSec}`,
          `Tick rate: ${TICK_RATE} Hz`,
        );
      } else {
        lines.push('── Network ──', 'Not connected');
      }
    }

    if (this.activeView === 'server' || this.activeView === 'all') {
      if (lines.length > 0) lines.push('');
      if (info.server) {
        const { wave, enemyCount, portalCount, playerCount, tickProfile } = info.server;
        lines.push(
          '── Server ──',
          `Wave:     ${wave}`,
          `Enemies:  ${enemyCount}`,
          `Portals:  ${portalCount}`,
          `Players:  ${playerCount}`,
        );
        if (tickProfile) {
          lines.push(
            '',
            '── Tick Profile (ms) ──',
            `Total:      ${tickProfile.total.toFixed(2)}`,
            `Enemy:      ${tickProfile.enemy.toFixed(2)}`,
            `Combat:     ${tickProfile.combat.toFixed(2)}`,
            `Movement:   ${tickProfile.movement.toFixed(2)}`,
            `Projectile: ${tickProfile.projectile.toFixed(2)}`,
            `Buildings:  ${tickProfile.buildings.toFixed(2)}`,
            `Waves:      ${tickProfile.waves.toFixed(2)}`,
          );
        }
      } else {
        lines.push('── Server ──', 'No active session');
      }
    }

    if (this.activeView === 'logs') {
      lines.push('── Logs ──');
      if (this.logEntries.length === 0) {
        lines.push('(no log entries)');
      } else {
        const start = Math.max(0, this.logEntries.length - 30);
        for (let i = start; i < this.logEntries.length; i++) {
          lines.push(this.logEntries[i]);
        }
      }
    }

    if (this.activeView === 'help') {
      lines.push(
        '── Commands ──',
        '/core       Core stats (FPS, pos, biome)',
        '/net        Network stats (RTT, loss)',
        '/server     Server stats (wave, enemies)',
        '/all        Show everything',
        '/logs       Game event log',
        '/spawn [n]  Spawn n enemies (default 5)',
        '/skipwave   Skip wave prep timer',
        '/pausewave  Pause/resume wave timer',
        '/clear      Close stats panel',
        '/help       This help text',
      );
    }

    this.statsEl.textContent = lines.join('\n');

    // Auto-scroll for logs view
    if (this.activeView === 'logs') {
      this.statsEl.scrollTop = this.statsEl.scrollHeight;
    }
  }

  private executeCommand(raw: string): void {
    if (!raw) return;
    if (!raw.startsWith('/')) raw = '/' + raw;
    const parts = raw.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '/core':
        this.activeView = 'core';
        break;
      case '/net':
        this.activeView = 'net';
        break;
      case '/server':
        this.activeView = 'server';
        break;
      case '/all':
        this.activeView = 'all';
        break;
      case '/logs':
        this.activeView = 'logs';
        break;
      case '/help':
        this.activeView = 'help';
        break;
      case '/clear':
        this.activeView = null;
        this.statsEl.textContent = '';
        break;
      case '/spawn':
      case '/skipwave':
      case '/pausewave':
      case '/give':
        this.cheatHandler?.(cmd, args);
        this.log(`Executed: ${raw}`);
        break;
      default:
        this.log(`Unknown command: ${cmd}`);
        this.activeView = 'logs';
        break;
    }
  }
}
