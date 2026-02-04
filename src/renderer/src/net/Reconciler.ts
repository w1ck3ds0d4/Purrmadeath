import { World } from '@shared/ecs/World';
import { C, PositionComponent, VelocityComponent, PlayerInputComponent, HealthComponent } from '@shared/components';
import type { EntitySnapshot, DeltaMessage } from '@shared/protocol';

/**
 * Reconciler implements client-side prediction + server reconciliation.
 *
 * ## How it works
 *
 * 1. Each input frame is tagged with an incrementing `seq` number and stored
 *    in the `pendingInputs` buffer before being sent to the server.
 * 2. Every DELTA message includes `lastSeq` — the last input sequence number
 *    the server successfully applied for this client.
 * 3. On receiving DELTA, we:
 *    a. Snap the local player position to the server-authoritative value.
 *    b. Discard all pending inputs up to and including `lastSeq`.
 *    c. Re-apply the remaining (unacknowledged) inputs on top of the
 *       server position to maintain smooth predicted movement.
 *
 * For LAN play the correction step rarely fires (round-trip < 5 ms), but it
 * ensures correctness when it does (e.g. wall collisions, lag spikes).
 */
export class Reconciler {
  private seq = 0;

  /** Buffer of pending (unacknowledged) inputs. */
  private pending: PendingInput[] = [];

  /** Entity ID of the local player. Set by game.ts after spawn. */
  localEntityId: number | null = null;

  /** Threshold (px) below which we skip correction entirely (rounding noise). */
  private static readonly CORRECTION_THRESHOLD = 4;

  /** Above this distance, hard-snap instead of blending (teleport / major desync). */
  private static readonly HARD_SNAP_THRESHOLD = 100;

  /** Visual offset that smooths out corrections over multiple render frames.
   *  Applied to camera target only — physics position stays clean for prediction. */
  smoothX = 0;
  smoothY = 0;

  // ── Input recording ─────────────────────────────────────────────────────────

  /**
   * Stamp the current input frame and add it to the pending buffer.
   * Returns the sequence number to include in the INPUT message.
   */
  recordInput(dx: number, dy: number, sprint: boolean, dt: number): number {
    const s = ++this.seq;
    this.pending.push({ seq: s, dx, dy, sprint, dt });
    return s;
  }

  // ── Delta reconciliation ────────────────────────────────────────────────────

  /**
   * Apply a server DELTA to the local player entity.
   * - Snaps to server position if the error exceeds CORRECTION_THRESHOLD.
   * - Replays unacknowledged inputs so predicted position stays smooth.
   */
  applyDelta(world: World, delta: DeltaMessage, moveFn: ReplayMoveFn): void {
    if (this.localEntityId === null) return;

    // Find the local player's snapshot in the delta
    const serverSnap = delta.entities.find((e) => e.entityId === this.localEntityId);
    if (!serverSnap) return;

    // Step 1: discard acknowledged inputs
    this.pending = this.pending.filter((p) => p.seq > delta.lastSeq);

    // Always sync health from server (not predicted client-side)
    const hp = world.getComponent<HealthComponent>(this.localEntityId, C.Health);
    if (hp && serverSnap.hp !== undefined) {
      hp.current = serverSnap.hp;
      hp.max     = serverSnap.maxHp ?? hp.max;
    }

    // Step 2: measure error
    const pos = world.getComponent<PositionComponent>(this.localEntityId, C.Position);
    if (!pos) return;

    const errX = pos.x - serverSnap.x;
    const errY = pos.y - serverSnap.y;
    const err = Math.sqrt(errX * errX + errY * errY);

    if (err < Reconciler.CORRECTION_THRESHOLD) return; // no correction needed

    // Save pre-correction visual position (physics + any remaining smoothing offset)
    const oldVisualX = pos.x + this.smoothX;
    const oldVisualY = pos.y + this.smoothY;

    // Step 3: snap to server position
    pos.x = serverSnap.x;
    pos.y = serverSnap.y;

    const vel = world.getComponent<VelocityComponent>(this.localEntityId, C.Velocity);
    if (vel) { vel.vx = serverSnap.vx; vel.vy = serverSnap.vy; }

    // Step 4: replay unacknowledged inputs
    const inp = world.getComponent<PlayerInputComponent>(this.localEntityId, C.PlayerInput);
    if (inp) {
      for (const p of this.pending) {
        inp.dx = p.dx;
        inp.dy = p.dy;
        inp.sprint = p.sprint;
        moveFn(p.dt);
      }
    }

    // Step 5: compute smoothing offset (difference between old visual and new physics)
    if (err >= Reconciler.HARD_SNAP_THRESHOLD) {
      // Large desync (teleport) — no smoothing, snap immediately
      this.smoothX = 0;
      this.smoothY = 0;
    } else {
      this.smoothX = oldVisualX - pos.x;
      this.smoothY = oldVisualY - pos.y;
    }
  }

  /**
   * Decay the visual smoothing offset each render frame.
   * game.ts adds smoothX/smoothY to the camera target so corrections
   * blend over ~100-150ms instead of hard-snapping.
   */
  decaySmooth(dt: number): void {
    if (this.smoothX === 0 && this.smoothY === 0) return;

    const decay = Math.min(12 * dt, 1);
    this.smoothX *= (1 - decay);
    this.smoothY *= (1 - decay);

    // Snap to zero when close enough to avoid perpetual drift
    if (Math.abs(this.smoothX) < 0.5) this.smoothX = 0;
    if (Math.abs(this.smoothY) < 0.5) this.smoothY = 0;
  }

  // ── Apply remote entity positions ───────────────────────────────────────────

  /**
   * Apply a server entity snapshot to the world (for remote players / enemies).
   * Skips the local player entity — that is handled by applyDelta.
   */
  applyRemote(world: World, snap: EntitySnapshot): void {
    if (snap.entityId === this.localEntityId) return;

    const pos = world.getComponent<PositionComponent>(snap.entityId, C.Position);
    const vel = world.getComponent<VelocityComponent>(snap.entityId, C.Velocity);
    if (pos) { pos.x = snap.x; pos.y = snap.y; }
    if (vel) { vel.vx = snap.vx; vel.vy = snap.vy; }
  }

  get nextSeq(): number {
    return this.seq + 1;
  }
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface PendingInput {
  seq: number;
  dx: number;
  dy: number;
  sprint: boolean;
  dt: number;
}

/** Callback that advances the local player movement simulation by `dt` seconds. */
export type ReplayMoveFn = (dt: number) => void;
