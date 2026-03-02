// ---------------------------------------------------------------------------
// Wave Modifiers - per-wave mechanical twists announced during dusk
// ---------------------------------------------------------------------------

export type WaveModifierId = 'swarm' | 'ironhide' | 'fog' | 'frenzy';

export interface WaveModifierDef {
  id: WaveModifierId;
  name: string;
  description: string;
  /** HUD display color (0xRRGGBB). */
  color: number;
  /** Earliest wave this modifier can appear. */
  minWave: number;
  /** Selection weight (higher = more likely). */
  weight: number;
  // -- Multipliers applied to enemy spawning / vision --
  enemyCountMult: number;
  enemyHpMult: number;
  enemySpeedMult: number;
  enemyDamageMult: number;
  /** Torch / vision radius multiplier (1.0 = normal, 0.5 = halved). */
  visionMult: number;
}

export const WAVE_MODIFIERS: Record<WaveModifierId, WaveModifierDef> = {
  swarm: {
    id: 'swarm', name: 'Swarm', description: '2x enemies, 50% HP',
    color: 0xffaa33, minWave: 3, weight: 1.0,
    enemyCountMult: 2.0, enemyHpMult: 0.5, enemySpeedMult: 1.0, enemyDamageMult: 1.0, visionMult: 1.0,
  },
  ironhide: {
    id: 'ironhide', name: 'Ironhide', description: '+50% HP, +25% damage',
    color: 0x8888cc, minWave: 4, weight: 1.0,
    enemyCountMult: 1.0, enemyHpMult: 1.5, enemySpeedMult: 1.0, enemyDamageMult: 1.25, visionMult: 1.0,
  },
  fog: {
    id: 'fog', name: 'Fog', description: 'Reduced vision radius',
    color: 0x99bbcc, minWave: 5, weight: 0.8,
    enemyCountMult: 1.0, enemyHpMult: 1.0, enemySpeedMult: 1.0, enemyDamageMult: 1.0, visionMult: 0.5,
  },
  frenzy: {
    id: 'frenzy', name: 'Frenzy', description: '+30% speed, +20% damage',
    color: 0xff4444, minWave: 4, weight: 0.9,
    enemyCountMult: 1.0, enemyHpMult: 1.0, enemySpeedMult: 1.3, enemyDamageMult: 1.2, visionMult: 1.0,
  },
};

/** All modifier IDs for iteration. */
const ALL_MODIFIERS: WaveModifierId[] = Object.keys(WAVE_MODIFIERS) as WaveModifierId[];

/** 25% chance per wave of rolling modifier(s). Count: 1 (W3-7), up to 2 (W8-14), up to 3 (W15+). */
export function pickWaveModifiers(wave: number): WaveModifierId[] {
  if (wave < 3) return [];
  // 25% chance of any modifiers this wave
  if (Math.random() > 0.25) return [];

  const maxCount = wave < 8 ? 1 : wave < 15 ? 2 : 3;

  // Build eligible pool
  const pool = ALL_MODIFIERS.filter(id => WAVE_MODIFIERS[id].minWave <= wave);
  if (pool.length === 0) return [];

  // Weighted selection without replacement
  const picked: WaveModifierId[] = [];
  const remaining = [...pool];

  for (let i = 0; i < maxCount && remaining.length > 0; i++) {
    const totalWeight = remaining.reduce((sum, id) => sum + WAVE_MODIFIERS[id].weight, 0);
    let roll = Math.random() * totalWeight;
    let chosen: WaveModifierId | null = null;

    for (let j = 0; j < remaining.length; j++) {
      roll -= WAVE_MODIFIERS[remaining[j]].weight;
      if (roll <= 0) { chosen = remaining[j]; remaining.splice(j, 1); break; }
    }
    if (chosen) picked.push(chosen);
  }

  return picked;
}

/** Aggregate multipliers - product of all active modifiers. */
export interface ModifierAggregate {
  enemyCountMult: number;
  enemyHpMult: number;
  enemySpeedMult: number;
  enemyDamageMult: number;
  visionMult: number;
}

export function computeModifierAggregate(ids: WaveModifierId[]): ModifierAggregate {
  const agg: ModifierAggregate = { enemyCountMult: 1, enemyHpMult: 1, enemySpeedMult: 1, enemyDamageMult: 1, visionMult: 1 };
  for (const id of ids) {
    const m = WAVE_MODIFIERS[id];
    agg.enemyCountMult *= m.enemyCountMult;
    agg.enemyHpMult *= m.enemyHpMult;
    agg.enemySpeedMult *= m.enemySpeedMult;
    agg.enemyDamageMult *= m.enemyDamageMult;
    agg.visionMult *= m.visionMult;
  }
  return agg;
}
