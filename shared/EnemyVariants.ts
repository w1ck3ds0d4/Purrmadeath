import type { EnemyVariantType } from './components';

/**
 * Per-variant base stats for enemies.
 * Used by spawnEnemy() to set entity components.
 * Wave scaling is applied on top of these base values.
 */
export interface EnemyVariantStats {
  hp: number;
  speed: number;
  damage: number;
  /** Melee attack range (px). */
  range: number;
  /** Knockback impulse applied on melee hit. */
  knockback: number;
  /** Attack cooldown (seconds). */
  cooldown: number;
  /** Collision/hit-detection radius (px). */
  radius: number;
  /** If > 0, this variant fires projectiles instead of melee at this range. */
  rangedRange?: number;
  /** Projectile speed (px/s) for ranged variants. */
  projectileSpeed?: number;
  /** Ranged attack damage (separate from melee damage). */
  rangedDamage?: number;
  /** Ranged cooldown override. */
  rangedCooldown?: number;
}

export const ENEMY_VARIANT_STATS: Record<EnemyVariantType, EnemyVariantStats> = {
  melee: {
    hp: 40,
    speed: 75,
    damage: 10,
    range: 40,
    knockback: 200,
    cooldown: 1.0,
    radius: 10,
  },
  ranger: {
    hp: 30,
    speed: 60,
    damage: 10,       // melee fallback damage
    range: 40,        // melee range (when close)
    knockback: 200,
    cooldown: 1.0,    // melee cooldown
    radius: 10,
    rangedRange: 200,
    projectileSpeed: 300,
    rangedDamage: 8,
    rangedCooldown: 2.0,
  },
  ghost: {
    hp: 25,
    speed: 80,
    damage: 12,
    range: 40,
    knockback: 100,
    cooldown: 1.2,
    radius: 10,
  },
  giant: {
    hp: 150,
    speed: 40,
    damage: 40,
    range: 50,
    knockback: 300,
    cooldown: 2.0,     // slow attack speed
    radius: 20,        // 2× normal
  },
  assassin: {
    hp: 25,
    speed: 160,
    damage: 30,
    range: 40,
    knockback: 150,
    cooldown: 0.8,
    radius: 10,
  },
};

/**
 * Wave-dependent spawn weight tables.
 * Returns a weighted array for random enemy type selection.
 */
export function getSpawnWeights(wave: number): { variant: EnemyVariantType; weight: number }[] {
  if (wave >= 7) {
    return [
      { variant: 'melee', weight: 30 },
      { variant: 'ranger', weight: 15 },
      { variant: 'ghost', weight: 20 },
      { variant: 'giant', weight: 15 },
      { variant: 'assassin', weight: 20 },
    ];
  }
  if (wave >= 5) {
    return [
      { variant: 'melee', weight: 40 },
      { variant: 'ranger', weight: 20 },
      { variant: 'ghost', weight: 20 },
      { variant: 'giant', weight: 20 },
    ];
  }
  if (wave >= 3) {
    return [
      { variant: 'melee', weight: 50 },
      { variant: 'ranger', weight: 25 },
      { variant: 'ghost', weight: 25 },
    ];
  }
  // Waves 1-2
  return [
    { variant: 'melee', weight: 70 },
    { variant: 'ranger', weight: 30 },
  ];
}

/** Pick a random variant based on weighted spawn table for the given wave. */
export function pickEnemyVariant(wave: number): EnemyVariantType {
  const weights = getSpawnWeights(wave);
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll <= 0) return entry.variant;
  }
  return weights[weights.length - 1].variant;
}

/** Display names for enemy intro toasts. */
export const ENEMY_VARIANT_NAMES: Record<EnemyVariantType, string> = {
  melee: 'Warriors',
  ranger: 'Rangers',
  ghost: 'Ghosts',
  giant: 'Giants',
  assassin: 'Assassins',
};
