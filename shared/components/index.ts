// ─── Component Key Constants ───────────────────────────────────────────────────
// Use C.Position instead of the raw string 'Position' everywhere.
// Prevents typos and makes future renames a single-file change.

export const C = {
  Position:        'Position',
  Velocity:        'Velocity',
  Health:          'Health',
  Stamina:         'Stamina',
  Defense:         'Defense',
  Speed:           'Speed',
  PlayerIndex:     'PlayerIndex',
  PlayerInput:     'PlayerInput',
  // ── Phase 4 ──────────────────────────────────────────────────────────────
  Facing:          'Facing',
  Faction:         'Faction',
  AttackCooldown:  'AttackCooldown',
  KnockbackReceiver: 'KnockbackReceiver',
  Projectile:      'Projectile',
  Portal:          'Portal',
  ResourceNode:    'ResourceNode',
  ItemDrop:        'ItemDrop',
  Resources:       'Resources',
  Downed:          'Downed',
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
  regenRate: number;
  /** True after stamina hits 0 while sprinting; cleared when the player releases Sprint. */
  exhausted: boolean;
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
  /** True while Shift is held and stamina > 0. */
  sprint: boolean;
}

// ── Phase 4 components ────────────────────────────────────────────────────────

/** World-space facing angle in radians. Driven by mouse cursor for players,
 *  velocity direction for enemies. Used for melee arc and directional arrow. */
export interface FacingComponent {
  angle: number;
}

/** Which team an entity belongs to. Determines targetting and rendering. */
export interface FactionComponent {
  type: 'player' | 'enemy' | 'portal' | 'resource' | 'item';
}

/** Tracks remaining cooldown before the entity can attack again. */
export interface AttackCooldownComponent {
  /** Seconds until next attack is allowed. Counts down each tick. */
  remaining: number;
  /** Full cooldown duration reset after each attack. */
  max: number;
}

/**
 * Stores a knockback impulse applied by an attack.
 * Separate from Velocity so that knockback decays independently
 * of movement physics (added on top of movement each frame).
 */
export interface KnockbackReceiverComponent {
  vx: number;
  vy: number;
}

/** Tags an entity as a portal that spawns enemies during a wave. */
export interface PortalComponent {
  /** Which wave this portal belongs to. */
  waveNumber: number;
  /** Seconds until next enemy spawn. */
  spawnTimer: number;
  /** Full spawn interval duration (seconds between enemy spawns). */
  spawnInterval: number;
}

/** Tags an entity as a projectile (arrow, bolt, etc.). */
export interface ProjectileComponent {
  /** Entity ID of the owner who fired this projectile. */
  ownerId: number;
  /** Base damage dealt on hit (before defense reduction). */
  damage: number;
  /** Seconds remaining before the projectile is destroyed. */
  lifetime: number;
}

// ── Phase 4.8+ components ─────────────────────────────────────────────────────

export type ResourceType = 'wood' | 'stone' | 'iron' | 'diamond';

/** Tags an entity as a harvestable resource node (tree, stone deposit, etc.). */
export interface ResourceNodeComponent {
  resourceType: ResourceType;
  /** How much resource this node yields when destroyed. */
  yield: number;
}

/** Tags an entity as an item drop sitting in the world. */
export interface ItemDropComponent {
  /** Resource type or item ID. */
  itemType: string;
  quantity: number;
  /** True = auto-pickup on overlap (resources). False = requires E-interact (equipment). */
  autoPickup: boolean;
  /** Seconds until this drop despawns. */
  lifetime: number;
}

/** Per-player resource counters. Attached to player entities on the server. */
export interface ResourcesComponent {
  wood: number;
  stone: number;
  iron: number;
  diamond: number;
  gold: number;
}

// ── Phase 4.11 components ────────────────────────────────────────────────────

/** Marks a player as downed (HP reached 0). Present only while in downed state. */
export interface DownedComponent {
  /** Seconds remaining before the player fully dies (bleed-out timer). */
  bleedTimer: number;
  /** Seconds of revive progress accumulated so far. */
  reviveProgress: number;
  /** Entity ID of the teammate currently reviving, or -1 if none. */
  reviverId: number;
}