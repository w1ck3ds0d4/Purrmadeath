// ─── Component Key Constants ───────────────────────────────────────────────────
// Use C.Position instead of the raw string 'Position' everywhere.
// Prevents typos and makes future renames a single-file change.

export const C = {
  Position:    'Position',
  Velocity:    'Velocity',
  Health:      'Health',
  Stamina:     'Stamina',
  Defense:     'Defense',
  Speed:       'Speed',
  PlayerIndex: 'PlayerIndex',
  PlayerInput: 'PlayerInput',
} as const;

// ─── Component interfaces ──────────────────────────────────────────────────────

export interface PositionComponent {
  x: number;
  y: number;
}

export interface VelocityComponent {
  vx: number;
  vy: number;
}

export interface HealthComponent {
  current: number;
  max: number;
}

export interface StaminaComponent {
  current: number;
  max: number;
  /** Units recovered per second while passive (sprint depletion added in Phase 4). */
  regenRate: number;
}

export interface DefenseComponent {
  /** Flat damage subtracted before percent reduction. */
  flat: number;
  /** 0–1 percent damage reduction applied after flat. 0 = no reduction. */
  percent: number;
}

export interface SpeedComponent {
  base: number;
  /** Multiplied by base — modified by buildings/abilities in later phases. */
  multiplier: number;
}

/** Slot index 0–3 — determines player color and spawn order. */
export interface PlayerIndexComponent {
  index: number;
}

/**
 * Transient each-frame input intent — written by InputSystem each tick,
 * consumed by MovementSystem. Reset to 0 when no keys are held.
 */
export interface PlayerInputComponent {
  /** -1 = left, 0 = none, +1 = right */
  dx: number;
  /** -1 = up,   0 = none, +1 = down */
  dy: number;
}
