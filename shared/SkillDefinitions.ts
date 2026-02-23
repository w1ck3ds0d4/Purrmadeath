import type { PlayerClass } from './ClassDefinitions';

// ─── Branch & Node IDs ─────────────────────────────────────────────────────────

export type SkillBranchId =
  | 'berserker' | 'guardian' | 'warlord'       // Warrior
  | 'sharpshooter' | 'trapper' | 'scout'       // Ranger
  | 'pyromancer' | 'frost_mage' | 'arcanist';  // Mage

/** Node IDs follow the pattern: branchId_tN (e.g. 'berserker_t1'). */
export type SkillNodeId = string;

// ─── Effect Types ──────────────────────────────────────────────────────────────

export type PassiveStat = 'damage' | 'speed' | 'maxHp' | 'defense' | 'critChance' | 'attackSpeed' | 'hpRegen';

export interface SkillPassiveEffect {
  stat: PassiveStat;
  value: number;
  /** 'add' = flat additive, 'multiply' = multiplicative factor (e.g. 0.10 = +10%). */
  mode: 'add' | 'multiply';
}

export type SpecialEffectType = 'lifesteal' | 'burn_dot' | 'thorns' | 'slow_on_hit';

export interface SkillSpecialEffect {
  type: SpecialEffectType;
  /** lifesteal = fraction (0.05 = 5%), burn_dot = dps, thorns = flat dmg, slow_on_hit = fraction (0.2 = 20%). */
  value: number;
}

// ─── Active Abilities ──────────────────────────────────────────────────────────

export type AbilityParams =
  | { type: 'whirlwind'; damage: number; radius: number }
  | { type: 'shield_wall'; damageReduction: number; duration: number }
  | { type: 'war_cry'; damageBonus: number; duration: number; radius: number }
  | { type: 'rain_of_arrows'; arrowCount: number; radius: number; damage: number }
  | { type: 'explosive_trap'; damage: number; radius: number; armTime: number }
  | { type: 'shadow_step'; distance: number }
  | { type: 'meteor'; damage: number; radius: number }
  | { type: 'blizzard'; slowFactor: number; duration: number; radius: number }
  | { type: 'teleport'; maxDistance: number };

export interface SkillActiveAbility {
  abilityId: string;
  name: string;
  description: string;
  cooldown: number;
  params: AbilityParams;
}

// ─── Nodes & Branches ──────────────────────────────────────────────────────────

export interface SkillNode {
  id: SkillNodeId;
  tier: number; // 1-5
  branch: SkillBranchId;
  name: string;
  description: string;
  passive?: SkillPassiveEffect[];
  special?: SkillSpecialEffect[];
  /** Only tier-5 capstone nodes have an active ability. */
  active?: SkillActiveAbility;
}

export interface SkillBranch {
  id: SkillBranchId;
  name: string;
  description: string;
  playerClass: PlayerClass;
  color: number;
  nodes: SkillNode[]; // exactly 5, tiers 1-5
}

// ─── Branch Definitions ────────────────────────────────────────────────────────

export const SKILL_BRANCHES: Record<SkillBranchId, SkillBranch> = {
  // ── Warrior ────────────────────────────────────────────────────────────────
  berserker: {
    id: 'berserker', name: 'Berserker', description: 'Damage and attack speed',
    playerClass: 'warrior', color: 0xcc3333,
    nodes: [
      { id: 'berserker_t1', tier: 1, branch: 'berserker', name: 'Fury', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'berserker_t2', tier: 2, branch: 'berserker', name: 'Frenzy', description: '+15% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.15, mode: 'multiply' }] },
      { id: 'berserker_t3', tier: 3, branch: 'berserker', name: 'Bloodlust', description: '5% lifesteal on hit',
        special: [{ type: 'lifesteal', value: 0.05 }] },
      { id: 'berserker_t4', tier: 4, branch: 'berserker', name: 'Carnage', description: '+20% damage',
        passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'berserker_t5', tier: 5, branch: 'berserker', name: 'Whirlwind', description: '360° spin dealing 3× damage',
        active: { abilityId: 'whirlwind', name: 'Whirlwind', description: '360° spin, 3× damage', cooldown: 8,
          params: { type: 'whirlwind', damage: 3, radius: 60 } } },
    ],
  },
  guardian: {
    id: 'guardian', name: 'Guardian', description: 'Tank and defense',
    playerClass: 'warrior', color: 0x3377cc,
    nodes: [
      { id: 'guardian_t1', tier: 1, branch: 'guardian', name: 'Iron Skin', description: '+1 flat defense',
        passive: [{ stat: 'defense', value: 1, mode: 'add' }] },
      { id: 'guardian_t2', tier: 2, branch: 'guardian', name: 'Fortitude', description: '+15 max HP',
        passive: [{ stat: 'maxHp', value: 15, mode: 'add' }] },
      { id: 'guardian_t3', tier: 3, branch: 'guardian', name: 'Thorns', description: 'Reflect 5 damage to attackers',
        special: [{ type: 'thorns', value: 5 }] },
      { id: 'guardian_t4', tier: 4, branch: 'guardian', name: 'Steel Will', description: '+2 flat defense',
        passive: [{ stat: 'defense', value: 2, mode: 'add' }] },
      { id: 'guardian_t5', tier: 5, branch: 'guardian', name: 'Shield Wall', description: '50% damage reduction for 5s',
        active: { abilityId: 'shield_wall', name: 'Shield Wall', description: '50% DR for 5s', cooldown: 12,
          params: { type: 'shield_wall', damageReduction: 0.50, duration: 5 } } },
    ],
  },
  warlord: {
    id: 'warlord', name: 'Warlord', description: 'Team buffs and control',
    playerClass: 'warrior', color: 0xccaa33,
    nodes: [
      { id: 'warlord_t1', tier: 1, branch: 'warlord', name: 'Charge', description: '+5% movement speed',
        passive: [{ stat: 'speed', value: 0.05, mode: 'multiply' }] },
      { id: 'warlord_t2', tier: 2, branch: 'warlord', name: 'Battle Fervor', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'warlord_t3', tier: 3, branch: 'warlord', name: 'Rally', description: '+1 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 1, mode: 'add' }] },
      { id: 'warlord_t4', tier: 4, branch: 'warlord', name: 'Valor', description: '+20 max HP',
        passive: [{ stat: 'maxHp', value: 20, mode: 'add' }] },
      { id: 'warlord_t5', tier: 5, branch: 'warlord', name: 'War Cry', description: 'Allies +20% damage for 8s',
        active: { abilityId: 'war_cry', name: 'War Cry', description: '+20% team damage for 8s', cooldown: 15,
          params: { type: 'war_cry', damageBonus: 0.20, duration: 8, radius: 200 } } },
    ],
  },

  // ── Ranger ─────────────────────────────────────────────────────────────────
  sharpshooter: {
    id: 'sharpshooter', name: 'Sharpshooter', description: 'Ranged damage and crits',
    playerClass: 'ranger', color: 0x33aa55,
    nodes: [
      { id: 'sharpshooter_t1', tier: 1, branch: 'sharpshooter', name: 'Steady Aim', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'sharpshooter_t2', tier: 2, branch: 'sharpshooter', name: 'Eagle Eye', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'sharpshooter_t3', tier: 3, branch: 'sharpshooter', name: 'Marksman', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'sharpshooter_t4', tier: 4, branch: 'sharpshooter', name: 'Lethal Focus', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'sharpshooter_t5', tier: 5, branch: 'sharpshooter', name: 'Rain of Arrows', description: '8 arrows in target area',
        active: { abilityId: 'rain_of_arrows', name: 'Rain of Arrows', description: '8 arrows in target area', cooldown: 10,
          params: { type: 'rain_of_arrows', arrowCount: 8, radius: 80, damage: 15 } } },
    ],
  },
  trapper: {
    id: 'trapper', name: 'Trapper', description: 'Utility and control',
    playerClass: 'ranger', color: 0x88774d,
    nodes: [
      { id: 'trapper_t1', tier: 1, branch: 'trapper', name: 'Swift Feet', description: '+5% movement speed',
        passive: [{ stat: 'speed', value: 0.05, mode: 'multiply' }] },
      { id: 'trapper_t2', tier: 2, branch: 'trapper', name: 'Crippling Shot', description: 'Slow enemies 20% on hit',
        special: [{ type: 'slow_on_hit', value: 0.20 }] },
      { id: 'trapper_t3', tier: 3, branch: 'trapper', name: 'Hunter\'s Mark', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'trapper_t4', tier: 4, branch: 'trapper', name: 'Survivalist', description: '+10 max HP',
        passive: [{ stat: 'maxHp', value: 10, mode: 'add' }] },
      { id: 'trapper_t5', tier: 5, branch: 'trapper', name: 'Explosive Trap', description: 'Place AOE trap at target',
        active: { abilityId: 'explosive_trap', name: 'Explosive Trap', description: 'Place AOE trap', cooldown: 8,
          params: { type: 'explosive_trap', damage: 30, radius: 60, armTime: 1 } } },
    ],
  },
  scout: {
    id: 'scout', name: 'Scout', description: 'Mobility and vision',
    playerClass: 'ranger', color: 0x55bbdd,
    nodes: [
      { id: 'scout_t1', tier: 1, branch: 'scout', name: 'Fleet Foot', description: '+10% movement speed',
        passive: [{ stat: 'speed', value: 0.10, mode: 'multiply' }] },
      { id: 'scout_t2', tier: 2, branch: 'scout', name: 'Quick Draw', description: '+10% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.10, mode: 'multiply' }] },
      { id: 'scout_t3', tier: 3, branch: 'scout', name: 'Precision', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'scout_t4', tier: 4, branch: 'scout', name: 'Wind Runner', description: '+15% movement speed',
        passive: [{ stat: 'speed', value: 0.15, mode: 'multiply' }] },
      { id: 'scout_t5', tier: 5, branch: 'scout', name: 'Shadow Step', description: 'Teleport 150px forward',
        active: { abilityId: 'shadow_step', name: 'Shadow Step', description: 'Teleport 150px forward', cooldown: 6,
          params: { type: 'shadow_step', distance: 150 } } },
    ],
  },

  // ── Mage ───────────────────────────────────────────────────────────────────
  pyromancer: {
    id: 'pyromancer', name: 'Pyromancer', description: 'Fire and damage',
    playerClass: 'mage', color: 0xdd5522,
    nodes: [
      { id: 'pyromancer_t1', tier: 1, branch: 'pyromancer', name: 'Ignite', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'pyromancer_t2', tier: 2, branch: 'pyromancer', name: 'Combustion', description: 'Burn enemies for 3 dps',
        special: [{ type: 'burn_dot', value: 3 }] },
      { id: 'pyromancer_t3', tier: 3, branch: 'pyromancer', name: 'Inferno', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'pyromancer_t4', tier: 4, branch: 'pyromancer', name: 'Firestorm', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'pyromancer_t5', tier: 5, branch: 'pyromancer', name: 'Meteor', description: 'Massive AOE that destroys everything',
        active: { abilityId: 'meteor', name: 'Meteor', description: 'Massive AOE at target', cooldown: 12,
          params: { type: 'meteor', damage: 80, radius: 120 } } },
    ],
  },
  frost_mage: {
    id: 'frost_mage', name: 'Frost Mage', description: 'Control and slow',
    playerClass: 'mage', color: 0x44aadd,
    nodes: [
      { id: 'frost_mage_t1', tier: 1, branch: 'frost_mage', name: 'Chill', description: 'Slow enemies 15% on hit',
        special: [{ type: 'slow_on_hit', value: 0.15 }] },
      { id: 'frost_mage_t2', tier: 2, branch: 'frost_mage', name: 'Ice Armor', description: '+10 max HP',
        passive: [{ stat: 'maxHp', value: 10, mode: 'add' }] },
      { id: 'frost_mage_t3', tier: 3, branch: 'frost_mage', name: 'Frostbite', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'frost_mage_t4', tier: 4, branch: 'frost_mage', name: 'Deep Freeze', description: 'Slow enemies 30% on hit',
        special: [{ type: 'slow_on_hit', value: 0.30 }] },
      { id: 'frost_mage_t5', tier: 5, branch: 'frost_mage', name: 'Blizzard', description: 'AOE slow zone for 6s',
        active: { abilityId: 'blizzard', name: 'Blizzard', description: 'AOE slow zone for 6s', cooldown: 15,
          params: { type: 'blizzard', slowFactor: 0.50, duration: 6, radius: 100 } } },
    ],
  },
  arcanist: {
    id: 'arcanist', name: 'Arcanist', description: 'Utility and support',
    playerClass: 'mage', color: 0x9955dd,
    nodes: [
      { id: 'arcanist_t1', tier: 1, branch: 'arcanist', name: 'Arcane Flow', description: '+5% movement speed',
        passive: [{ stat: 'speed', value: 0.05, mode: 'multiply' }] },
      { id: 'arcanist_t2', tier: 2, branch: 'arcanist', name: 'Mana Shield', description: '+1 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 1, mode: 'add' }] },
      { id: 'arcanist_t3', tier: 3, branch: 'arcanist', name: 'Arcane Power', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'arcanist_t4', tier: 4, branch: 'arcanist', name: 'Arcane Barrier', description: '+20 max HP',
        passive: [{ stat: 'maxHp', value: 20, mode: 'add' }] },
      { id: 'arcanist_t5', tier: 5, branch: 'arcanist', name: 'Teleport', description: 'Blink to cursor (200px max)',
        active: { abilityId: 'teleport', name: 'Teleport', description: 'Blink to cursor, 200px max', cooldown: 8,
          params: { type: 'teleport', maxDistance: 200 } } },
    ],
  },
};

/** Which branches belong to each class (display order: left, center, right). */
export const CLASS_BRANCHES: Record<PlayerClass, SkillBranchId[]> = {
  warrior: ['berserker', 'guardian', 'warlord'],
  ranger: ['sharpshooter', 'trapper', 'scout'],
  mage: ['pyromancer', 'frost_mage', 'arcanist'],
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
}

export function emptyAllocation(): SkillAllocation {
  return { allocated: new Set(), skillPoints: 0 };
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
}

export function emptySkillBuffs(): SkillBuffs {
  return {
    damageMultiplier: 1, speedMultiplier: 1, attackSpeedMultiplier: 1,
    maxHpBonus: 0, defenseBonus: 0, critChanceBonus: 0, hpRegen: 0,
    lifesteal: 0, burnDot: 0, thornsDamage: 0, slowOnHit: 0,
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
        }
      }
    }
    if (node.special) {
      for (const s of node.special) {
        switch (s.type) {
          case 'lifesteal':   buffs.lifesteal = Math.max(buffs.lifesteal, s.value); break;
          case 'burn_dot':    buffs.burnDot = Math.max(buffs.burnDot, s.value); break;
          case 'thorns':      buffs.thornsDamage += s.value; break;
          case 'slow_on_hit': buffs.slowOnHit = Math.max(buffs.slowOnHit, s.value); break;
        }
      }
    }
  }
  return buffs;
}

/** Get list of active abilities from allocated tier-5 capstones. */
export function getActiveAbilities(alloc: SkillAllocation): SkillActiveAbility[] {
  const abilities: SkillActiveAbility[] = [];
  for (const nodeId of alloc.allocated) {
    const node = getNode(nodeId);
    if (node?.active) abilities.push(node.active);
  }
  return abilities;
}
