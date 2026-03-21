import type { PlayerClass } from './ClassDefinitions';

// ─── Branch & Node IDs ─────────────────────────────────────────────────────────

export type SkillBranchId =
  | 'berserker' | 'guardian' | 'blood_knight' | 'templar' | 'slayer'           // Warrior
  | 'sharpshooter' | 'beastmaster' | 'trapper' | 'shadow_hunter' | 'windwalker'  // Ranger
  | 'fire_mage' | 'frost_mage' | 'electric_mage' | 'earth_mage' | 'void_mage'; // Mage

/** Node IDs follow the pattern: branchId_tN (e.g. 'berserker_t1'). */
export type SkillNodeId = string;

// ─── Effect Types ──────────────────────────────────────────────────────────────

export type PassiveStat = 'damage' | 'speed' | 'maxHp' | 'defense' | 'critChance' | 'attackSpeed' | 'hpRegen'
  | 'dodgeChance' | 'cooldownReduction' | 'critDamage' | 'flatDamage' | 'flatSpeed' | 'defensePercent';

export interface SkillPassiveEffect {
  stat: PassiveStat;
  value: number;
  /** 'add' = flat additive, 'multiply' = multiplicative factor (e.g. 0.10 = +10%). */
  mode: 'add' | 'multiply';
}

export type SpecialEffectType = 'lifesteal' | 'burn_dot' | 'thorns' | 'slow_on_hit'
  | 'poison_dot' | 'stun_on_hit' | 'holy_mark' | 'shadow_drain' | 'arcane_mark' | 'nature_blessing'
  | 'bloodlust_stack' | 'thorns_percent' | 'armor_break';

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
  | { type: 'warcry_rage'; speedBoost: number; damageResistance: number; hpRegen: number; duration: number }
  | { type: 'unbreakable_charge'; tauntRadius: number; damageReduction: number; chargeDuration: number; damageMultiplier: number }
  | { type: 'blood_drain'; radius: number; duration: number; drainPercent: number }
  // Ranger
  | { type: 'sniper_shot'; damage: number }
  | { type: 'pack_call'; wolfCount: number; wolfHp: number; wolfDamage: number; duration: number }
  | { type: 'explosive_barrage'; arrowCount: number; damagePerArrow: number; explosionRadius: number; duration: number }
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
  | 'double_range' | 'aegis_shield' | 'blood_arc' | 'warcry_extension'
  // Ranger
  | 'toxic_spread' | 'headshot_explosion' | 'wolf_upgrade' | 'wolf_heal' | 'wolf_poison'
  | 'alpha_predator' | 'crippling_slow' | 'multi_shot'
  // Shared
  | 'bouncing'
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

// ─── Branch Definitions (imported from per-class files) ───────────────────────

import { WARRIOR_BRANCHES } from './skills/WarriorSkills';
import { RANGER_BRANCHES } from './skills/RangerSkills';
import { MAGE_BRANCHES } from './skills/MageSkills';

export const SKILL_BRANCHES: Record<SkillBranchId, SkillBranch> = {
  ...WARRIOR_BRANCHES,
  ...RANGER_BRANCHES,
  ...MAGE_BRANCHES,
} as Record<SkillBranchId, SkillBranch>;

/** Which branches belong to each class (display order). */
export const CLASS_BRANCHES: Record<PlayerClass, SkillBranchId[]> = {
  warrior: ['berserker', 'guardian', 'blood_knight', 'templar', 'slayer'],
  ranger: ['sharpshooter', 'beastmaster', 'trapper', 'shadow_hunter', 'windwalker'],
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
  // Cooldown reduction
  cooldownReduction: number;
  // Warrior passive stats
  flatDamage: number;
  critDamageBonus: number;
  flatSpeed: number;
  defensePercent: number;
  thornsPercent: number;
  bloodlustStack: number;
  armorBreak: number;
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
    cooldownReduction: 0,
    flatDamage: 0, critDamageBonus: 0, flatSpeed: 0, defensePercent: 0,
    thornsPercent: 0, bloodlustStack: 0, armorBreak: 0,
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
          case 'attackSpeed': if (p.mode === 'multiply') buffs.attackSpeedMultiplier *= (1 + p.value); else buffs.attackSpeedMultiplier += p.value; break;
          case 'maxHp':       buffs.maxHpBonus += p.value; break;
          case 'defense':     buffs.defenseBonus += p.value; break;
          case 'critChance':  buffs.critChanceBonus += p.value; break;
          case 'hpRegen':     buffs.hpRegen += p.value; break;
          case 'dodgeChance': buffs.dodgeChance += p.value; break;
          case 'cooldownReduction': buffs.cooldownReduction += p.value; break;
          case 'critDamage':    buffs.critDamageBonus += p.value; break;
          case 'flatDamage':    buffs.flatDamage += p.value; break;
          case 'flatSpeed':     buffs.flatSpeed += p.value; break;
          case 'defensePercent': buffs.defensePercent += p.value; break;
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
          case 'bloodlust_stack':  buffs.bloodlustStack = Math.max(buffs.bloodlustStack, s.value); break;
          case 'thorns_percent':   buffs.thornsPercent += s.value; break;
          case 'armor_break':      buffs.armorBreak = Math.max(buffs.armorBreak, s.value); break;
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
