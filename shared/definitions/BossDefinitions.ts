// ---------------------------------------------------------------------------
// Boss Definitions - unique boss enemies with special attacks
// ---------------------------------------------------------------------------

export interface BossDefinition {
  id: string;
  name: string;
  /** Minimum wave to appear. */
  minWave: number;
  /** Base HP before wave scaling. */
  hp: number;
  speed: number;
  damage: number;
  /** Melee attack range (px). */
  range: number;
  knockback: number;
  /** Attack cooldown (seconds). */
  cooldown: number;
  /** Collision/hit-detection radius (px). */
  radius: number;
  /** Special ability cooldown (seconds). */
  specialCooldown: number;
  /** HP fraction at which boss enrages (0-1). */
  enrageThreshold: number;
  /** Description shown on boss intro. */
  description: string;
}

export const BOSS_DEFINITIONS: BossDefinition[] = [
  {
    id: 'ravager',
    name: 'The Ravager',
    minWave: 5,
    hp: 2000,
    speed: 80,
    damage: 60,
    range: 55,
    knockback: 350,
    cooldown: 1.0,
    radius: 35,
    specialCooldown: 8,
    enrageThreshold: 0.5,
    description: 'A hulking beast that charges and slams.',
  },
  {
    id: 'necromancer',
    name: 'The Necromancer',
    minWave: 10,
    hp: 1500,
    speed: 50,
    damage: 30,
    range: 40,
    knockback: 200,
    cooldown: 1.5,
    radius: 25,
    specialCooldown: 10,
    enrageThreshold: 0.5,
    description: 'Raises the dead to fight for him.',
  },
  {
    id: 'shadow_lord',
    name: 'The Shadow Lord',
    minWave: 15,
    hp: 3000,
    speed: 70,
    damage: 50,
    range: 50,
    knockback: 300,
    cooldown: 1.2,
    radius: 30,
    specialCooldown: 12,
    enrageThreshold: 0.5,
    description: 'Teleports and creates shadow clones.',
  },
];

/**
 * Pick a boss for the given wave from the eligible pool.
 * Returns null if no bosses are eligible (shouldn't happen if called correctly).
 */
export function getBossForWave(wave: number): BossDefinition | null {
  const eligible = BOSS_DEFINITIONS.filter(b => wave >= b.minWave);
  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}
