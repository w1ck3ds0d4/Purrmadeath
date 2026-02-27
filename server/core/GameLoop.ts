import { TICK_MS } from '@shared/constants';

/**
 * GameLoop drives the server at a fixed tick rate (default: 20 TPS).
 *
 * Uses setTimeout with drift compensation so ticks don't accumulate latency
 * over time. If a tick takes longer than TICK_MS, the next tick fires immediately
 * (no catch-up spiral - we just accept the slowdown and log a warning).
 */
export class GameLoop {
  private running = false;
  private lastTick = 0;
  private tickCount = 0;

  constructor(private readonly onTick: (dt: number) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTick = Date.now();
    this.schedule();
  }

  stop(): void {
    this.running = false;
  }

  get currentTick(): number {
    return this.tickCount;
  }

  private schedule(): void {
    if (!this.running) return;

    const now = Date.now();
    // Fixed dt keeps movement math deterministic and aligned with client replay.
    // Wall-clock drift is handled by the setTimeout compensation below.
    const dt = TICK_MS / 1_000;
    this.lastTick = now;
    this.tickCount++;

    this.onTick(dt);

    // Compensate for the time the tick itself consumed
    const elapsed = Date.now() - now;
    const delay = Math.max(0, TICK_MS - elapsed);

    if (elapsed > TICK_MS * 2) {
      console.warn(`[GameLoop] Tick ${this.tickCount} overran by ${elapsed - TICK_MS}ms`);
    }

    setTimeout(() => this.schedule(), delay);
  }
}