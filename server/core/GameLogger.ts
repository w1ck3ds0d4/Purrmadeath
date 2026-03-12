/**
 * GameLogger - Persistent server-side logging per game session.
 *
 * Creates a log file in `logs/` directory named `slot{N}_{timestamp}.log`.
 * Captures: ability activations, damage events, buff changes, wave transitions,
 * building events, enemy spawns, errors, and custom debug messages.
 *
 * Auto-cleans old logs (keeps last 5 per save slot).
 */

import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = process.env.LOG_DIR ?? path.join(process.cwd(), 'logs');
const MAX_LOGS_PER_SLOT = 5;

export type LogCategory =
  | 'ability'    // Ability activations, cooldowns
  | 'damage'     // Damage dealt/taken, kills
  | 'buff'       // Buff add/remove/tick
  | 'wave'       // Wave start/clear, enemy spawns
  | 'building'   // Building place/upgrade/demolish
  | 'save'       // Save/load events
  | 'player'     // Player join/leave/class/respawn
  | 'combat'     // Melee/ranged attacks, combat mods
  | 'error'      // Errors and warnings
  | 'debug'      // Custom debug messages
  | 'system';    // System lifecycle events

export class GameLogger {
  private stream: fs.WriteStream | null = null;
  private filePath: string = '';
  private sessionStart: number;
  private enabledCategories: Set<LogCategory> = new Set([
    'ability', 'damage', 'buff', 'wave', 'building',
    'save', 'player', 'combat', 'error', 'debug', 'system',
  ]);

  constructor(saveSlot: number) {
    this.sessionStart = Date.now();

    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });

      // Clean old logs for this slot
      this.cleanOldLogs(saveSlot);

      // Create new log file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `slot${saveSlot}_${timestamp}.log`;
      this.filePath = path.join(LOG_DIR, filename);
      this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });

      this.write('system', `Session started - Save slot ${saveSlot}`);
      this.write('system', `Log file: ${filename}`);
    } catch (err) {
      console.error('[GameLogger] Failed to create log file:', err);
    }
  }

  /** Log a message with category and optional data. */
  log(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    if (!this.enabledCategories.has(category)) return;
    this.write(category, message, data);
  }

  // ── Convenience methods ──────────────────────────────────────────────────

  ability(msg: string, data?: Record<string, unknown>): void { this.log('ability', msg, data); }
  damage(msg: string, data?: Record<string, unknown>): void { this.log('damage', msg, data); }
  buff(msg: string, data?: Record<string, unknown>): void { this.log('buff', msg, data); }
  wave(msg: string, data?: Record<string, unknown>): void { this.log('wave', msg, data); }
  building(msg: string, data?: Record<string, unknown>): void { this.log('building', msg, data); }
  save(msg: string, data?: Record<string, unknown>): void { this.log('save', msg, data); }
  player(msg: string, data?: Record<string, unknown>): void { this.log('player', msg, data); }
  combat(msg: string, data?: Record<string, unknown>): void { this.log('combat', msg, data); }
  error(msg: string, data?: Record<string, unknown>): void { this.log('error', msg, data); }
  debug(msg: string, data?: Record<string, unknown>): void { this.log('debug', msg, data); }

  /** Enable or disable a log category. */
  setCategory(category: LogCategory, enabled: boolean): void {
    if (enabled) this.enabledCategories.add(category);
    else this.enabledCategories.delete(category);
  }

  /** Close the log file stream. */
  close(): void {
    if (this.stream) {
      const elapsed = ((Date.now() - this.sessionStart) / 1000).toFixed(1);
      this.write('system', `Session ended - Duration: ${elapsed}s`);
      this.stream.end();
      this.stream = null;
    }
  }

  /** Get the log file path. */
  getFilePath(): string {
    return this.filePath;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private write(category: string, message: string, data?: Record<string, unknown>): void {
    const elapsed = ((Date.now() - this.sessionStart) / 1000).toFixed(2);
    const cat = category.toUpperCase().padEnd(8);
    let line = `[${elapsed.padStart(8)}s] [${cat}] ${message}`;
    if (data && Object.keys(data).length > 0) {
      line += ' | ' + Object.entries(data).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
    }

    // Write to file
    if (this.stream) {
      this.stream.write(line + '\n');
    }

    // Also log errors to console
    if (category === 'error') {
      console.error(`[GameLogger] ${message}`);
    }
  }

  private cleanOldLogs(saveSlot: number): void {
    try {
      const prefix = `slot${saveSlot}_`;
      const files = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith(prefix) && f.endsWith('.log'))
        .sort()
        .reverse();

      // Keep only MAX_LOGS_PER_SLOT, delete the rest
      for (let i = MAX_LOGS_PER_SLOT; i < files.length; i++) {
        fs.unlinkSync(path.join(LOG_DIR, files[i]));
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
