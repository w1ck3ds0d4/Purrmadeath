import { CHUNK_SIZE, TILE_SIZE, TICK_RATE } from '@shared/constants';
import { CARD_POOL } from '@shared/definitions/CardDefinitions';
import type { Camera } from '../../render/Camera';

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

export interface GameStats {
  class: string;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  kills: number;
  skillPoints: number;
  cards: number;
  civilians: number;
  buildings: number;
  dayPhase: string;
  darkness: number;
}

export interface DebugInfo {
  camera: Camera;
  loadedChunks: number;
  entityCount: number;
  biome: string;
  seed: number;
  net?: NetStats;
  server?: ServerStats;
  game?: GameStats;
}

type CheatHandler = (cmd: string, args: string[]) => void;
type BuffsProvider = () => Array<{ id: string; remaining: number; effect: Record<string, unknown> }>;
type StatsProvider = () => Record<string, string>;
type ActiveView = 'core' | 'net' | 'server' | 'all' | 'logs' | 'help' | 'buffs' | 'stats' | null;

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
  private buffsProvider: BuffsProvider | null = null;
  private statsProvider: StatsProvider | null = null;
  dmgLogEnabled = false;

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
      'width: fit-content',
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
        const cmd = this.inputEl.value.trim();
        if (cmd) {
          this.executeCommand(cmd);
          this.inputEl.value = '';
        } else {
          // Empty Enter closes console
          this.hide();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
      // Stop key events from propagating to game input while typing
      e.stopPropagation();
    });
    inputRow.appendChild(this.inputEl);
    this.el.appendChild(inputRow);

    document.getElementById('overlay')!.appendChild(this.el);

    // F4 toggles console, Tab focuses input when console is open
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F4') {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'Tab' && this.visible) {
        e.preventDefault();
        this.inputEl.focus();
      }
    });
  }

  get isOpen(): boolean {
    return this.visible;
  }

  onCheat(handler: CheatHandler): void {
    this.cheatHandler = handler;
  }

  setBuffsProvider(provider: BuffsProvider): void {
    this.buffsProvider = provider;
  }

  setStatsProvider(provider: StatsProvider): void {
    this.statsProvider = provider;
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

    // Two-column layout for 'all' view, single column for others
    if (this.activeView === 'all') {
      this.renderAllColumns(info);
      return;
    }

    const lines: string[] = [];

    if (this.activeView === 'core') {
      lines.push(...this.coreLines(info));
    }

    if (this.activeView === 'net') {
      lines.push(...this.netLines(info));
    }

    if (this.activeView === 'server') {
      lines.push(...this.serverLines(info));
    }

    if (this.activeView === 'logs') {
      lines.push('-- Logs --');
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
        '-- Commands --',
        '/core       Core stats (FPS, pos, biome)',
        '/net        Network stats (RTT, loss)',
        '/server     Server stats (wave, enemies)',
        '/all        Show everything (2-col)',
        '/logs       Game event log',
        '/spawn [n]  Spawn n enemies (default 5)',
        '/skipwave   Skip wave prep timer',
        '/pausewave  Pause/resume wave timer',
        '/skipnight  Skip to night',
        '/skipday    Skip to day (end night)',
        '/settime <s> Set day timer (seconds)',
        '/card <id>  Give a card by ID',
        '/cards [f]  List all card IDs (filter)',
        '/sp [n]     Give n skill points (default 1)',
        '/modifier <id> Force wave modifier',
        '/event <id>   Force world event',
        '/buffs      Show active buffs + timers',
        '/stats      Full stat breakdown',
        '/ability <id> Force activate ability',
        '/dmglog     Toggle damage logging',
        '/pause      Pause day timer',
        '/clear      Close stats panel',
        '/help       This help text',
      );
    }

    if (this.activeView === 'buffs') {
      lines.push('-- Active Buffs --');
      const buffs = this.buffsProvider?.() ?? [];
      if (buffs.length === 0) {
        lines.push('  (no active buffs)');
      } else {
        for (const b of buffs) {
          lines.push(`  ${b.id}  ${b.remaining.toFixed(1)}s`);
          for (const [k, v] of Object.entries(b.effect)) {
            if (v != null && v !== 0) lines.push(`    ${k}: ${typeof v === 'number' ? (v as number).toFixed(2) : v}`);
          }
        }
      }
    }

    if (this.activeView === 'stats') {
      lines.push('-- Stat Breakdown --');
      const stats = this.statsProvider?.() ?? {};
      if (Object.keys(stats).length === 0) {
        lines.push('  (no stats available)');
      } else {
        for (const [k, v] of Object.entries(stats)) {
          lines.push(`  ${k}: ${v}`);
        }
      }
    }

    this.statsEl.innerHTML = '';
    this.statsEl.style.display = 'block';
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
      case '/skipnight':
      case '/skipday':
      case '/settime':
      case '/give':
      case '/card':
      case '/sp':
      case '/modifier':
      case '/event':
      case '/ability':
      case '/pause':
        this.cheatHandler?.(cmd, args);
        this.log(`Executed: ${raw}`);
        break;
      case '/buffs':
        this.activeView = 'buffs';
        break;
      case '/stats':
        this.activeView = 'stats';
        break;
      case '/dmglog':
        this.dmgLogEnabled = !this.dmgLogEnabled;
        this.log(`Damage logging: ${this.dmgLogEnabled ? 'ON' : 'OFF'}`);
        this.activeView = 'logs';
        break;
      case '/cards': {
        const filter = args[0]?.toLowerCase();
        const cards = filter
          ? CARD_POOL.filter(c => c.id.includes(filter) || c.name.toLowerCase().includes(filter) || c.rarity === filter || c.category === filter)
          : CARD_POOL;
        this.log(`── Card IDs (${cards.length}) ──`);
        for (const c of cards) {
          this.log(`  ${c.id} - ${c.name} [${c.rarity}/${c.category}]`);
        }
        this.activeView = 'logs';
        break;
      }
      default:
        this.log(`Unknown command: ${cmd}`);
        this.activeView = 'logs';
        break;
    }
  }

  // ── Column data helpers ──────────────────────────────────────────────────

  private coreLines(info: DebugInfo): string[] {
    const { camera, loadedChunks, entityCount, biome, seed } = info;
    const chunkPixels = CHUNK_SIZE * TILE_SIZE;
    const cx = Math.floor(camera.x / chunkPixels);
    const cy = Math.floor(camera.y / chunkPixels);
    return [
      '-- Core --',
      `FPS:    ${this.fps}`,
      `Ents:   ${entityCount}`,
      `Pos:    ${Math.round(camera.x)}, ${Math.round(camera.y)}`,
      `Chunk:  ${cx}, ${cy}`,
      `Biome:  ${biome}`,
      `Chunks: ${loadedChunks}`,
      `Seed: ${seed}`,
    ];
  }

  private netLines(info: DebugInfo): string[] {
    if (info.net) {
      const { rtt, packetLoss, msgsPerSec } = info.net;
      return [
        '-- Network --',
        `RTT:    ${rtt} ms`,
        `Loss:   ${packetLoss}%`,
        `Msg/s:  ${msgsPerSec}`,
        `Tick:   ${TICK_RATE} Hz`,
      ];
    }
    return ['-- Network --', 'Not connected'];
  }

  private serverLines(info: DebugInfo): string[] {
    if (info.server) {
      const { wave, enemyCount, portalCount, playerCount, tickProfile } = info.server;
      const lines = [
        '-- Server --',
        `Wave:    ${wave}`,
        `Enemies: ${enemyCount}`,
        `Portals: ${portalCount}`,
        `Players: ${playerCount}`,
      ];
      if (tickProfile) {
        lines.push(
          '',
          '-- Tick (ms) --',
          `Total:  ${tickProfile.total.toFixed(2)}`,
          `Enemy:  ${tickProfile.enemy.toFixed(2)}`,
          `Combat: ${tickProfile.combat.toFixed(2)}`,
          `Move:   ${tickProfile.movement.toFixed(2)}`,
          `Proj:   ${tickProfile.projectile.toFixed(2)}`,
          `Build:  ${tickProfile.buildings.toFixed(2)}`,
          `Waves:  ${tickProfile.waves.toFixed(2)}`,
        );
      }
      return lines;
    }
    return ['-- Server --', 'No active session'];
  }

  private gameLines(info: DebugInfo): string[] {
    if (!info.game) return ['-- Game --', 'No session'];
    const g = info.game;
    const hpPct = g.maxHp > 0 ? Math.round(g.hp / g.maxHp * 100) : 0;
    return [
      '-- Game --',
      `Class:  ${g.class}`,
      `HP:     ${Math.ceil(g.hp)}/${g.maxHp} (${hpPct}%)`,
      `Stam:   ${Math.ceil(g.stamina)}/${g.maxStamina}`,
      `Kills:  ${g.kills}`,
      `SP:     ${g.skillPoints}`,
      `Cards:  ${g.cards}`,
      '',
      '-- World --',
      `Phase:  ${g.dayPhase}`,
      `Dark:   ${(g.darkness * 100).toFixed(0)}%`,
      `Civs:   ${g.civilians}`,
      `Bldgs:  ${g.buildings}`,
    ];
  }

  private renderAllColumns(info: DebugInfo): void {
    const col1 = [...this.coreLines(info), '', ...this.netLines(info)];
    const col2 = this.serverLines(info);
    const col3 = this.gameLines(info);

    const maxLen = Math.max(col1.length, col2.length, col3.length);
    while (col1.length < maxLen) col1.push('');
    while (col2.length < maxLen) col2.push('');
    while (col3.length < maxLen) col3.push('');

    // Fixed column widths for consistent alignment
    const w1 = 18;
    const w2 = 18;
    const merged = col1.map((l, i) =>
      l.padEnd(w1) + (col2[i] ?? '').padEnd(w2) + (col3[i] ?? ''),
    );

    this.statsEl.innerHTML = '';
    this.statsEl.style.display = 'block';
    this.statsEl.textContent = merged.join('\n');
  }
}
