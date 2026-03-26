/**
 * Wave Milestones - permanent scaling events that activate at specific wave thresholds.
 * Unlike wave modifiers (random per wave), milestones are cumulative and permanent.
 *
 * W25: Corruption - enemies gain random buffs (speed, regen, damage aura, shield)
 * W50: Undying Horde - 15% chance enemies resurrect 3 seconds after death
 * W75: Final Stand - triple portal count, double enemy HP
 * W100: Apocalypse - mega boss with all abilities + all previous milestones stacked
 * W100+: Infinite Scaling - +10% HP/damage per 10 waves, +1 portal per 10 waves
 */

export interface MilestoneState {
  /** W25+: enemies gain random buffs on spawn. */
  corruptionActive: boolean;
  /** W50+: chance (0-1) for enemies to resurrect after death. */
  undyingChance: number;
  /** W75+: portal count multiplier. */
  portalCountMult: number;
  /** W75+: enemy HP multiplier (stacks with other scaling). */
  milestoneHpMult: number;
  /** W75+: enemy damage multiplier (stacks with other scaling). */
  milestoneDmgMult: number;
  /** W100: trigger mega boss. */
  apocalypseTriggered: boolean;
  /** W100+: additional scaling per 10 waves. */
  infiniteScalingTier: number;
}

/** Create a fresh milestone state (all inactive). */
export function createMilestoneState(): MilestoneState {
  return {
    corruptionActive: false,
    undyingChance: 0,
    portalCountMult: 1,
    milestoneHpMult: 1,
    milestoneDmgMult: 1,
    apocalypseTriggered: false,
    infiniteScalingTier: 0,
  };
}

/** Corruption buff types that can be randomly applied to enemies at W25+. */
export type CorruptionBuff = 'speed' | 'regen' | 'damage_aura' | 'shield';

/** All possible corruption buffs. Each enemy gets 1 random buff on spawn. */
export const CORRUPTION_BUFFS: CorruptionBuff[] = ['speed', 'regen', 'damage_aura', 'shield'];

/** Update milestone state based on current wave number. Called on wave start. */
export function updateMilestones(state: MilestoneState, wave: number): string[] {
  const announcements: string[] = [];

  // W25: Corruption
  if (wave >= 25 && !state.corruptionActive) {
    state.corruptionActive = true;
    announcements.push('CORRUPTION - Enemies gain random buffs!');
  }

  // W50: Undying Horde
  if (wave >= 50 && state.undyingChance === 0) {
    state.undyingChance = 0.15;
    announcements.push('UNDYING HORDE - Enemies may resurrect after death!');
  }

  // W75: Final Stand
  if (wave >= 75 && state.portalCountMult === 1) {
    state.portalCountMult = 3;
    state.milestoneHpMult = 2;
    announcements.push('FINAL STAND - Triple portals, double enemy HP!');
  }

  // W100: Apocalypse
  if (wave >= 100 && !state.apocalypseTriggered) {
    state.apocalypseTriggered = true;
    state.milestoneDmgMult = 1.5;
    announcements.push('APOCALYPSE - The end of all things approaches!');
  }

  // W100+: Infinite Scaling (every 10 waves after W100)
  if (wave > 100) {
    const tier = Math.floor((wave - 100) / 10);
    if (tier > state.infiniteScalingTier) {
      state.infiniteScalingTier = tier;
      // Each tier: +10% HP and damage, applied multiplicatively
      state.milestoneHpMult = 2 * Math.pow(1.1, tier); // Base 2x from W75 + 10% per tier
      state.milestoneDmgMult = 1.5 * Math.pow(1.1, tier); // Base 1.5x from W100 + 10% per tier
      state.portalCountMult = 3 + tier; // Base 3x from W75 + 1 per tier
      announcements.push(`INFINITE SCALING - Tier ${tier} (+${tier * 10}% HP/DMG, +${tier} portals)`);
    }
  }

  return announcements;
}
