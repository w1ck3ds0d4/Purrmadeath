import type { PlayerClass } from './ClassDefinitions';

// ─── Branch & Node IDs ─────────────────────────────────────────────────────────

export type SkillBranchId =
  | 'berserker' | 'guardian' | 'warlord' | 'ironclad' | 'juggernaut'          // Warrior
  | 'sharpshooter' | 'trapper' | 'scout' | 'hawkeye' | 'poisoner'            // Ranger
  | 'fire_mage' | 'frost_mage' | 'electric_mage' | 'earth_mage' | 'void_mage'; // Mage

/** Node IDs follow the pattern: branchId_tN (e.g. 'berserker_t1'). */
export type SkillNodeId = string;

// ─── Effect Types ──────────────────────────────────────────────────────────────

export type PassiveStat = 'damage' | 'speed' | 'maxHp' | 'defense' | 'critChance' | 'attackSpeed' | 'hpRegen' | 'dodgeChance' | 'cooldownReduction';

export interface SkillPassiveEffect {
  stat: PassiveStat;
  value: number;
  /** 'add' = flat additive, 'multiply' = multiplicative factor (e.g. 0.10 = +10%). */
  mode: 'add' | 'multiply';
}

export type SpecialEffectType = 'lifesteal' | 'burn_dot' | 'thorns' | 'slow_on_hit'
  | 'poison_dot' | 'stun_on_hit' | 'holy_mark' | 'shadow_drain' | 'arcane_mark' | 'nature_blessing';

export interface SkillSpecialEffect {
  type: SpecialEffectType;
  /** lifesteal = fraction, burn_dot/poison_dot = dps, thorns = flat dmg, slow_on_hit = fraction,
   *  stun_on_hit = duration(s), holy_mark = bonus dmg fraction, shadow_drain = dps,
   *  arcane_mark = attack slow factor, nature_blessing = heal/s. */
  value: number;
}

// ─── Active Abilities ──────────────────────────────────────────────────────────

export type AbilityParams =
  // Warrior
  | { type: 'ground_slam'; damage: number; radius: number; stunDuration: number }
  | { type: 'shield_charge'; distance: number; damage: number; knockback: number }
  | { type: 'battle_fury'; damageBonus: number; attackSpeedBonus: number; duration: number }
  | { type: 'earthquake'; damage: number; radius: number; slowFactor: number; slowDuration: number }
  | { type: 'blade_storm'; damage: number; radius: number; duration: number }
  // Ranger
  | { type: 'arrow_volley'; arrowCount: number; damage: number; coneAngle: number }
  | { type: 'snare_net'; radius: number; rootDuration: number; slowFactor: number }
  | { type: 'grapple_hook'; distance: number }
  | { type: 'marked_for_death'; damageAmp: number; duration: number }
  | { type: 'multishot'; arrowCount: number; duration: number }
  // Mage
  | { type: 'meteor_shower'; radius: number; duration: number; meteorCount: number; damagePerMeteor: number }
  | { type: 'blizzard_freeze'; radius: number; freezeDuration: number; damageAmp: number }
  | { type: 'thunderwave'; radius: number; knockback: number; stunDuration: number };

export interface SkillActiveAbility {
  abilityId: string;
  name: string;
  description: string;
  cooldown: number;
  params: AbilityParams;
}

// ─── Combat Modifiers (tiers 7, 9, 10) ────────────────────────────────────────

export type CombatModifierType =
  // Warrior
  | 'cleave' | 'shockwave' | 'berserker_rush' | 'shield_bash_stun'
  // Ranger
  | 'multishot_passive' | 'piercing_plus' | 'bouncing' | 'homing_passive' | 'split_on_hit'
  // Mage - Fire
  | 'burn_lifesteal' | 'explosive_burn'
  // Mage - Frost
  | 'frost_crit' | 'frost_shatter'
  // Mage - Electric
  | 'electric_stun'
  // Generic
  | 'explosive_projectile' | 'chain_lightning';

export interface CombatModifier {
  type: CombatModifierType;
  value: number;
  params?: Record<string, number>;
}

// ─── Nodes & Branches ──────────────────────────────────────────────────────────

export interface SkillNode {
  id: SkillNodeId;
  tier: number; // 1-10
  branch: SkillBranchId;
  name: string;
  description: string;
  passive?: SkillPassiveEffect[];
  special?: SkillSpecialEffect[];
  /** Only tier-5 capstone nodes have an active ability. */
  active?: SkillActiveAbility;
  /** Combat modifier unlocked at tiers 7, 9, 10. */
  combatMod?: CombatModifier;
}

export interface SkillBranch {
  id: SkillBranchId;
  name: string;
  description: string;
  playerClass: PlayerClass;
  color: number;
  nodes: SkillNode[]; // tiers 1-10 (5 base + 5 advanced with combat modifiers)
}

// ─── Branch Definitions ────────────────────────────────────────────────────────

export const SKILL_BRANCHES: Record<SkillBranchId, SkillBranch> = {
  // ── Warrior ────────────────────────────────────────────────────────────────
  berserker: {
    id: 'berserker', name: 'Berserker', description: 'Damage and attack speed',
    playerClass: 'warrior', color: 0xcc3333,
    nodes: [],
  },
  guardian: {
    id: 'guardian', name: 'Guardian', description: 'Tank and defense',
    playerClass: 'warrior', color: 0x3377cc,
    nodes: [],
  },
  warlord: {
    id: 'warlord', name: 'Warlord', description: 'Team buffs and control',
    playerClass: 'warrior', color: 0xccaa33,
    nodes: [],
  },
  ironclad: {
    id: 'ironclad', name: 'Ironclad', description: 'Thorns and regeneration',
    playerClass: 'warrior', color: 0x6688aa,
    nodes: [],
  },
  juggernaut: {
    id: 'juggernaut', name: 'Juggernaut', description: 'Speed and brute force',
    playerClass: 'warrior', color: 0xdd7722,
    nodes: [],
  },

  // ── Ranger ─────────────────────────────────────────────────────────────────
  sharpshooter: {
    id: 'sharpshooter', name: 'Sharpshooter', description: 'Ranged damage and crits',
    playerClass: 'ranger', color: 0x33aa55,
    nodes: [],
  },
  trapper: {
    id: 'trapper', name: 'Trapper', description: 'Utility and control',
    playerClass: 'ranger', color: 0x88774d,
    nodes: [],
  },
  scout: {
    id: 'scout', name: 'Scout', description: 'Mobility and vision',
    playerClass: 'ranger', color: 0x55bbdd,
    nodes: [],
  },
  hawkeye: {
    id: 'hawkeye', name: 'Hawkeye', description: 'Crit stacking and burst',
    playerClass: 'ranger', color: 0xddaa33,
    nodes: [],
  },
  poisoner: {
    id: 'poisoner', name: 'Poisoner', description: 'DoT and slow attrition',
    playerClass: 'ranger', color: 0x66aa33,
    nodes: [],
  },

  // ── Mage ───────────────────────────────────────────────────────────────────
  fire_mage: {
    id: 'fire_mage', name: 'Fire Mage', description: 'Burning damage and explosions',
    playerClass: 'mage', color: 0xdd5522,
    nodes: [
      { id: 'fire_mage_t1', tier: 1, branch: 'fire_mage', name: 'Ignite', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'fire_mage_t2', tier: 2, branch: 'fire_mage', name: 'Searing Bolts', description: 'Projectiles turn red, 3 DPS burn for 15s',
        special: [{ type: 'burn_dot', value: 3 }] },
      { id: 'fire_mage_t3', tier: 3, branch: 'fire_mage', name: 'Inner Fire', description: '+15 max HP',
        passive: [{ stat: 'maxHp', value: 15, mode: 'add' }] },
      { id: 'fire_mage_t4', tier: 4, branch: 'fire_mage', name: 'Inferno', description: '7 DPS burn for 20s',
        special: [{ type: 'burn_dot', value: 7 }] },
      { id: 'fire_mage_t5', tier: 5, branch: 'fire_mage', name: 'Meteor Shower', description: 'Rain meteors in a 300px area dealing massive damage',
        active: { abilityId: 'meteor_shower', name: 'Meteor Shower', description: 'Meteors rain in 300px area', cooldown: 15,
          params: { type: 'meteor_shower', radius: 300, duration: 4, meteorCount: 15, damagePerMeteor: 50 } } },
      { id: 'fire_mage_t6', tier: 6, branch: 'fire_mage', name: 'Evasion', description: '15% chance to dodge attacks',
        passive: [{ stat: 'dodgeChance', value: 0.15, mode: 'add' }] },
      { id: 'fire_mage_t7', tier: 7, branch: 'fire_mage', name: 'Pyromaniac', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'fire_mage_t8', tier: 8, branch: 'fire_mage', name: 'Firebrand', description: '+30 max HP',
        passive: [{ stat: 'maxHp', value: 30, mode: 'add' }] },
      { id: 'fire_mage_t9', tier: 9, branch: 'fire_mage', name: 'Combustion Heal', description: 'Regen 10% of burn damage dealt as HP',
        combatMod: { type: 'burn_lifesteal', value: 0.10 } },
      { id: 'fire_mage_t10', tier: 10, branch: 'fire_mage', name: 'Cataclysm', description: 'Projectiles explode on hit, burning everything in AOE',
        combatMod: { type: 'explosive_burn', value: 1, params: { radius: 50, burnDps: 5, burnDuration: 10 } } },
    ],
  },
  frost_mage: {
    id: 'frost_mage', name: 'Frost Mage', description: 'Slowing and freezing enemies',
    playerClass: 'mage', color: 0x44aadd,
    nodes: [
      { id: 'frost_mage_t1', tier: 1, branch: 'frost_mage', name: 'Chill', description: '+10% movement speed',
        passive: [{ stat: 'speed', value: 0.10, mode: 'multiply' }] },
      { id: 'frost_mage_t2', tier: 2, branch: 'frost_mage', name: 'Frostbolts', description: 'Projectiles turn blue, slow enemies 20% for 15s',
        special: [{ type: 'slow_on_hit', value: 0.20 }] },
      { id: 'frost_mage_t3', tier: 3, branch: 'frost_mage', name: 'Frost Power', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'frost_mage_t4', tier: 4, branch: 'frost_mage', name: 'Deep Chill', description: '+10% slow on enemies (total 30%)',
        special: [{ type: 'slow_on_hit', value: 0.30 }] },
      { id: 'frost_mage_t5', tier: 5, branch: 'frost_mage', name: 'Blizzard', description: 'Freeze enemies in 200px area, +50% damage taken',
        active: { abilityId: 'blizzard_freeze', name: 'Blizzard', description: 'Freeze enemies in 200px, +50% damage', cooldown: 18,
          params: { type: 'blizzard_freeze', radius: 200, freezeDuration: 4, damageAmp: 0.50 } } },
      { id: 'frost_mage_t6', tier: 6, branch: 'frost_mage', name: 'Frost Armor', description: '+30 max HP',
        passive: [{ stat: 'maxHp', value: 30, mode: 'add' }] },
      { id: 'frost_mage_t7', tier: 7, branch: 'frost_mage', name: 'Regeneration', description: '+5 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 5, mode: 'add' }] },
      { id: 'frost_mage_t8', tier: 8, branch: 'frost_mage', name: 'Shatter', description: '+30% crit damage on frozen/slowed enemies',
        combatMod: { type: 'frost_crit', value: 0.30 } },
      { id: 'frost_mage_t9', tier: 9, branch: 'frost_mage', name: 'Ice Veins', description: '+15% crit chance',
        passive: [{ stat: 'critChance', value: 0.15, mode: 'add' }] },
      { id: 'frost_mage_t10', tier: 10, branch: 'frost_mage', name: 'Frost Nova', description: 'Projectiles explode into shards, freezing nearby enemies',
        combatMod: { type: 'frost_shatter', value: 1, params: { radius: 60, slowFactor: 0.40, slowDuration: 8 } } },
    ],
  },
  electric_mage: {
    id: 'electric_mage', name: 'Electric Mage', description: 'Chain lightning and stunning',
    playerClass: 'mage', color: 0xddcc22,
    nodes: [
      { id: 'electric_mage_t1', tier: 1, branch: 'electric_mage', name: 'Static', description: '+15% crit chance',
        passive: [{ stat: 'critChance', value: 0.15, mode: 'add' }] },
      { id: 'electric_mage_t2', tier: 2, branch: 'electric_mage', name: 'Chain Bolts', description: 'Projectiles turn yellow, bounce to 2 nearby enemies',
        combatMod: { type: 'bouncing', value: 2, params: { range: 120, damageFalloff: 0.8 } } },
      { id: 'electric_mage_t3', tier: 3, branch: 'electric_mage', name: 'Voltage', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'electric_mage_t4', tier: 4, branch: 'electric_mage', name: 'Arc Mastery', description: '+3 bounces (total 5)',
        combatMod: { type: 'bouncing', value: 5, params: { range: 150, damageFalloff: 0.7 } } },
      { id: 'electric_mage_t5', tier: 5, branch: 'electric_mage', name: 'Thunderwave', description: 'Shockwave knocks back and stuns enemies in 350px',
        active: { abilityId: 'thunderwave', name: 'Thunderwave', description: '350px shockwave, knockback + 5s stun', cooldown: 20,
          params: { type: 'thunderwave', radius: 350, knockback: 400, stunDuration: 5 } } },
      { id: 'electric_mage_t6', tier: 6, branch: 'electric_mage', name: 'Charged Body', description: '+15 max HP',
        passive: [{ stat: 'maxHp', value: 15, mode: 'add' }] },
      { id: 'electric_mage_t7', tier: 7, branch: 'electric_mage', name: 'Overload', description: '+30% crit chance',
        passive: [{ stat: 'critChance', value: 0.30, mode: 'add' }] },
      { id: 'electric_mage_t8', tier: 8, branch: 'electric_mage', name: 'Lightning Speed', description: '+30% movement speed',
        passive: [{ stat: 'speed', value: 0.30, mode: 'multiply' }] },
      { id: 'electric_mage_t9', tier: 9, branch: 'electric_mage', name: 'Resonance', description: '-20% ability cooldowns',
        passive: [{ stat: 'cooldownReduction', value: 0.20, mode: 'add' }] },
      { id: 'electric_mage_t10', tier: 10, branch: 'electric_mage', name: 'Paralysis', description: '50% chance to stun enemy on projectile hit for 1s',
        combatMod: { type: 'electric_stun', value: 0.50, params: { duration: 1 } } },
    ],
  },
  earth_mage: {
    id: 'earth_mage', name: 'Earth Mage', description: 'Coming soon...',
    playerClass: 'mage', color: 0x886633,
    nodes: [],
  },
  void_mage: {
    id: 'void_mage', name: 'Void Mage', description: 'Coming soon...',
    playerClass: 'mage', color: 0x6633aa,
    nodes: [],
  },
};

/** Which branches belong to each class (display order: left, center, right). */
export const CLASS_BRANCHES: Record<PlayerClass, SkillBranchId[]> = {
  warrior: ['berserker', 'guardian', 'warlord', 'ironclad', 'juggernaut'],
  ranger: ['sharpshooter', 'trapper', 'scout', 'hawkeye', 'poisoner'],
  mage: ['fire_mage', 'frost_mage', 'electric_mage', 'earth_mage', 'void_mage'],
};

// ─── Lookup helpers ────────────────────────────────────────────────────────────

const NODE_MAP = new Map<SkillNodeId, SkillNode>();
for (const branch of Object.values(SKILL_BRANCHES)) {
  for (const node of branch.nodes) NODE_MAP.set(node.id, node);
}

export function getNode(nodeId: SkillNodeId): SkillNode | undefined {
  return NODE_MAP.get(nodeId);
}

export function getBranch(branchId: SkillBranchId): SkillBranch {
  return SKILL_BRANCHES[branchId];
}

// ─── Allocation State ──────────────────────────────────────────────────────────

export interface SkillAllocation {
  allocated: Set<SkillNodeId>;
  skillPoints: number;
  /** Which ability is assigned to each hotbar slot (Q=0, E=1, R=2). */
  slotAssignments: [string | null, string | null, string | null];
}

export function emptyAllocation(): SkillAllocation {
  return { allocated: new Set(), skillPoints: 0, slotAssignments: [null, null, null] };
}

/** Check if a node can be allocated. */
export function canAllocate(alloc: SkillAllocation, nodeId: SkillNodeId, playerClass: PlayerClass): boolean {
  if (alloc.allocated.has(nodeId)) return false;
  if (alloc.skillPoints < 1) return false;
  const node = getNode(nodeId);
  if (!node) return false;
  const branch = SKILL_BRANCHES[node.branch];
  if (!branch || branch.playerClass !== playerClass) return false;
  // Prerequisite: previous tier in same branch must be allocated
  if (node.tier > 1) {
    const prereq = branch.nodes.find(n => n.tier === node.tier - 1);
    if (prereq && !alloc.allocated.has(prereq.id)) return false;
  }
  return true;
}

// ─── Buff Computation ──────────────────────────────────────────────────────────

export interface SkillBuffs {
  damageMultiplier: number;
  speedMultiplier: number;
  attackSpeedMultiplier: number;
  maxHpBonus: number;
  defenseBonus: number;
  critChanceBonus: number;
  hpRegen: number;
  // Special effects
  lifesteal: number;
  burnDot: number;
  thornsDamage: number;
  slowOnHit: number;
  // Elemental effects
  poisonDot: number;
  stunOnHit: number;
  holyMark: number;
  shadowDrain: number;
  arcaneMark: number;
  natureBlessing: number;
  // Dodge
  dodgeChance: number;
  // Combat modifiers
  combatMods: CombatModifier[];
}

export function emptySkillBuffs(): SkillBuffs {
  return {
    damageMultiplier: 1, speedMultiplier: 1, attackSpeedMultiplier: 1,
    maxHpBonus: 0, defenseBonus: 0, critChanceBonus: 0, hpRegen: 0,
    lifesteal: 0, burnDot: 0, thornsDamage: 0, slowOnHit: 0,
    poisonDot: 0, stunOnHit: 0, holyMark: 0, shadowDrain: 0, arcaneMark: 0, natureBlessing: 0,
    dodgeChance: 0,
    combatMods: [],
  };
}

/** Compute aggregate buffs from all allocated nodes. */
export function computeSkillBuffs(alloc: SkillAllocation): SkillBuffs {
  const buffs = emptySkillBuffs();
  for (const nodeId of alloc.allocated) {
    const node = getNode(nodeId);
    if (!node) continue;
    if (node.passive) {
      for (const p of node.passive) {
        switch (p.stat) {
          case 'damage':      if (p.mode === 'multiply') buffs.damageMultiplier *= (1 + p.value); else buffs.damageMultiplier += p.value; break;
          case 'speed':       if (p.mode === 'multiply') buffs.speedMultiplier *= (1 + p.value); break;
          case 'attackSpeed': if (p.mode === 'multiply') buffs.attackSpeedMultiplier *= (1 + p.value); break;
          case 'maxHp':       buffs.maxHpBonus += p.value; break;
          case 'defense':     buffs.defenseBonus += p.value; break;
          case 'critChance':  buffs.critChanceBonus += p.value; break;
          case 'hpRegen':     buffs.hpRegen += p.value; break;
          case 'dodgeChance': buffs.dodgeChance += p.value; break;
        }
      }
    }
    if (node.special) {
      for (const s of node.special) {
        switch (s.type) {
          case 'lifesteal':        buffs.lifesteal = Math.max(buffs.lifesteal, s.value); break;
          case 'burn_dot':         buffs.burnDot = Math.max(buffs.burnDot, s.value); break;
          case 'thorns':           buffs.thornsDamage += s.value; break;
          case 'slow_on_hit':      buffs.slowOnHit = Math.max(buffs.slowOnHit, s.value); break;
          case 'poison_dot':       buffs.poisonDot = Math.max(buffs.poisonDot, s.value); break;
          case 'stun_on_hit':      buffs.stunOnHit = Math.max(buffs.stunOnHit, s.value); break;
          case 'holy_mark':        buffs.holyMark = Math.max(buffs.holyMark, s.value); break;
          case 'shadow_drain':     buffs.shadowDrain = Math.max(buffs.shadowDrain, s.value); break;
          case 'arcane_mark':      buffs.arcaneMark = Math.max(buffs.arcaneMark, s.value); break;
          case 'nature_blessing':  buffs.natureBlessing = Math.max(buffs.natureBlessing, s.value); break;
        }
      }
    }
    if (node.combatMod) {
      buffs.combatMods.push(node.combatMod);
    }
  }
  // Cap multipliers to prevent extreme stacking when many branches are unlocked
  buffs.speedMultiplier = Math.min(buffs.speedMultiplier, 1.8);
  buffs.damageMultiplier = Math.min(buffs.damageMultiplier, 5);
  buffs.attackSpeedMultiplier = Math.min(buffs.attackSpeedMultiplier, 3);
  return buffs;
}

/** Get all unlocked active abilities (unordered). */
export function getUnlockedAbilities(alloc: SkillAllocation): SkillActiveAbility[] {
  const abilities: SkillActiveAbility[] = [];
  for (const nodeId of alloc.allocated) {
    const node = getNode(nodeId);
    if (node?.active) abilities.push(node.active);
  }
  return abilities;
}

/** Get active abilities ordered by slot assignment (Q=0, E=1, R=2).
 *  Returns a 3-element array where each slot is the assigned ability or null. */
export function getActiveAbilities(alloc: SkillAllocation): (SkillActiveAbility | null)[] {
  const unlocked = getUnlockedAbilities(alloc);
  const byId = new Map(unlocked.map(a => [a.abilityId, a]));
  const result: (SkillActiveAbility | null)[] = [null, null, null];

  // Fill from slot assignments
  for (let i = 0; i < 3; i++) {
    const id = alloc.slotAssignments[i];
    if (id && byId.has(id)) {
      result[i] = byId.get(id)!;
    }
  }

  // Backward compat: if no assignments exist, auto-fill in unlock order
  const hasAnyAssignment = result.some(r => r !== null);
  if (!hasAnyAssignment && unlocked.length > 0) {
    for (let i = 0; i < Math.min(unlocked.length, 3); i++) {
      result[i] = unlocked[i] ?? null;
    }
  }

  return result;
}
