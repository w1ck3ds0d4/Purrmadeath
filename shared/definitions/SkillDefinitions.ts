import type { PlayerClass } from './ClassDefinitions';

// ─── Branch & Node IDs ─────────────────────────────────────────────────────────

export type SkillBranchId =
  | 'berserker' | 'guardian' | 'warlord' | 'ironclad' | 'juggernaut'          // Warrior
  | 'sharpshooter' | 'trapper' | 'scout' | 'hawkeye' | 'poisoner'            // Ranger
  | 'pyromancer' | 'frost_mage' | 'arcanist' | 'stormcaller' | 'rift_walker' // Mage
  | 'blade_dancer' | 'shadow' | 'venom' | 'cutthroat' | 'ghost_blade'        // Assassin
  | 'holy_knight' | 'bulwark' | 'crusader' | 'inquisitor' | 'penitent'       // Paladin
  | 'death_mage' | 'cursed' | 'blood_magic' | 'grave_robber' | 'lich'        // Necromancer
  | 'feral' | 'packleader' | 'survivalist' | 'predator' | 'warden';          // Beastmaster

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
  | { type: 'pyroclasm'; damage: number; burnDps: number; burnDuration: number; coneAngle: number; range: number }
  | { type: 'ice_prison'; radius: number; freezeDuration: number }
  | { type: 'arcane_barrage'; boltCount: number; damage: number }
  | { type: 'lightning_storm'; targetCount: number; damage: number; radius: number }
  | { type: 'rift_collapse'; radius: number; damage: number; pullStrength: number }
  // Assassin
  | { type: 'phantom_strike'; distance: number; damage: number }
  | { type: 'smoke_bomb'; radius: number; duration: number; slowFactor: number }
  | { type: 'death_mark'; delay: number; damage: number }
  | { type: 'fan_of_knives'; knifeCount: number; damage: number; radius: number }
  | { type: 'vanish'; duration: number; damage: number }
  // Paladin
  | { type: 'divine_smite'; damage: number; radius: number; healAmount: number }
  | { type: 'aegis'; shieldAmount: number; duration: number; radius: number }
  | { type: 'judgment_hammer'; damage: number; stunDuration: number; range: number }
  | { type: 'consecration'; radius: number; dps: number; healPerSec: number; duration: number }
  | { type: 'guardian_angel'; reviveHpPercent: number }
  // Necromancer
  | { type: 'raise_dead'; count: number; hp: number; damage: number; duration: number }
  | { type: 'soul_drain'; dps: number; radius: number; duration: number }
  | { type: 'death_coil'; damage: number; healAmount: number }
  | { type: 'bone_prison'; duration: number }
  | { type: 'plague_cloud'; radius: number; dps: number; duration: number }
  // Beastmaster
  | { type: 'stampede'; distance: number; damage: number }
  | { type: 'pack_hunt'; count: number; hp: number; damage: number; duration: number }
  | { type: 'primal_roar'; radius: number; fearDuration: number; allySpeedBonus: number; allyBuffDuration: number }
  | { type: 'natures_wrath'; radius: number; rootDuration: number; dps: number }
  | { type: 'wild_transformation'; speedBonus: number; damageBonus: number; defenseBonus: number; duration: number };

export interface SkillActiveAbility {
  abilityId: string;
  name: string;
  description: string;
  cooldown: number;
  params: AbilityParams;
}

// ─── Combat Modifiers (tiers 7, 9, 10) ────────────────────────────────────────

export type CombatModifierType =
  | 'cleave' | 'shockwave' | 'berserker_rush'
  | 'multishot_passive' | 'piercing_plus' | 'bouncing' | 'homing_passive' | 'split_on_hit'
  | 'chain_lightning' | 'explosive_projectile' | 'seeking_orbs' | 'frozen_touch' | 'arcane_echo'
  | 'shadow_copies' | 'bleed_stacks' | 'backstab_crit' | 'execute_bonus'
  | 'holy_splash' | 'healing_strikes' | 'smite_chain' | 'shield_bash_stun'
  | 'life_drain_on_hit' | 'curse_spread' | 'bone_shards' | 'soul_mark'
  | 'pack_strike' | 'feral_swipe' | 'natures_bite';

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
    nodes: [
      { id: 'berserker_t1', tier: 1, branch: 'berserker', name: 'Fury', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'berserker_t2', tier: 2, branch: 'berserker', name: 'Frenzy', description: '+15% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.15, mode: 'multiply' }] },
      { id: 'berserker_t3', tier: 3, branch: 'berserker', name: 'Bloodlust', description: '5% lifesteal on hit',
        special: [{ type: 'lifesteal', value: 0.05 }, { type: 'burn_dot', value: 2 }] },
      { id: 'berserker_t4', tier: 4, branch: 'berserker', name: 'Carnage', description: '+20% damage',
        passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'berserker_t5', tier: 5, branch: 'berserker', name: 'Ground Slam', description: 'Slam the ground, stunning nearby enemies',
        active: { abilityId: 'ground_slam', name: 'Ground Slam', description: '2.5x damage AOE + 1.5s stun', cooldown: 10,
          params: { type: 'ground_slam', damage: 2.5, radius: 80, stunDuration: 1.5 } } },
      { id: 'berserker_t6', tier: 6, branch: 'berserker', name: 'Blood Frenzy', description: '+15% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.15, mode: 'multiply' }] },
      { id: 'berserker_t7', tier: 7, branch: 'berserker', name: 'Cleave', description: 'Melee hits splash 50% damage to nearby enemies',
        combatMod: { type: 'cleave', value: 0.50, params: { radius: 40 } } },
      { id: 'berserker_t8', tier: 8, branch: 'berserker', name: 'Savage Fury', description: '+25% damage',
        passive: [{ stat: 'damage', value: 0.25, mode: 'multiply' }] },
      { id: 'berserker_t9', tier: 9, branch: 'berserker', name: 'Berserker Rush', description: 'Kills boost attack speed 30% for 3s',
        combatMod: { type: 'berserker_rush', value: 0.30, params: { duration: 3 } } },
      { id: 'berserker_t10', tier: 10, branch: 'berserker', name: 'Bloodbath', description: 'Cleave deals 100% damage and triggers on-hit effects',
        combatMod: { type: 'cleave', value: 1.0, params: { radius: 50, applyOnHit: 1 } } },
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
      { id: 'guardian_t5', tier: 5, branch: 'guardian', name: 'Shield Charge', description: 'Charge forward, knocking back enemies',
        active: { abilityId: 'shield_charge', name: 'Shield Charge', description: 'Dash 150px + knockback', cooldown: 8,
          params: { type: 'shield_charge', distance: 150, damage: 2, knockback: 200 } } },
      { id: 'guardian_t6', tier: 6, branch: 'guardian', name: 'Fortified', description: '+3 flat defense',
        passive: [{ stat: 'defense', value: 3, mode: 'add' }] },
      { id: 'guardian_t7', tier: 7, branch: 'guardian', name: 'Shield Bash', description: '20% chance to stun on melee for 0.5s',
        combatMod: { type: 'shield_bash_stun', value: 0.20, params: { duration: 0.5 } } },
      { id: 'guardian_t8', tier: 8, branch: 'guardian', name: 'Bulwark', description: '+30 max HP',
        passive: [{ stat: 'maxHp', value: 30, mode: 'add' }] },
      { id: 'guardian_t9', tier: 9, branch: 'guardian', name: 'Shockwave', description: 'Melee hits create a ground wave dealing 30% damage',
        combatMod: { type: 'shockwave', value: 0.30, params: { range: 100, width: 30 } } },
      { id: 'guardian_t10', tier: 10, branch: 'guardian', name: 'Immovable Object', description: 'Shockwave stuns 1s and reflects 15 thorns',
        combatMod: { type: 'shockwave', value: 0.50, params: { range: 120, width: 40, stunDuration: 1 } } },
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
      { id: 'warlord_t5', tier: 5, branch: 'warlord', name: 'Battle Fury', description: 'Enter a frenzy, boosting damage and speed',
        active: { abilityId: 'battle_fury', name: 'Battle Fury', description: '+40% damage, +30% attack speed for 8s', cooldown: 20,
          params: { type: 'battle_fury', damageBonus: 0.40, attackSpeedBonus: 0.30, duration: 8 } } },
      { id: 'warlord_t6', tier: 6, branch: 'warlord', name: 'Commander', description: '+10% movement speed',
        passive: [{ stat: 'speed', value: 0.10, mode: 'multiply' }] },
      { id: 'warlord_t7', tier: 7, branch: 'warlord', name: 'Cleave', description: 'Melee hits splash 40% damage nearby',
        combatMod: { type: 'cleave', value: 0.40, params: { radius: 35 } } },
      { id: 'warlord_t8', tier: 8, branch: 'warlord', name: 'Inspiring', description: '+2 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 2, mode: 'add' }] },
      { id: 'warlord_t9', tier: 9, branch: 'warlord', name: 'Berserker Rush', description: 'Kills grant +25% attack speed for 4s',
        combatMod: { type: 'berserker_rush', value: 0.25, params: { duration: 4 } } },
      { id: 'warlord_t10', tier: 10, branch: 'warlord', name: "Warlord's Might", description: 'Kills heal 10% HP and extend rush to 6s',
        combatMod: { type: 'berserker_rush', value: 0.35, params: { duration: 6, healPercent: 10 } } },
    ],
  },

  ironclad: {
    id: 'ironclad', name: 'Ironclad', description: 'Thorns and regeneration',
    playerClass: 'warrior', color: 0x6688aa,
    nodes: [
      { id: 'ironclad_t1', tier: 1, branch: 'ironclad', name: 'Tough Skin', description: '+1 flat defense',
        passive: [{ stat: 'defense', value: 1, mode: 'add' }] },
      { id: 'ironclad_t2', tier: 2, branch: 'ironclad', name: 'Regeneration', description: '+1 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 1, mode: 'add' }] },
      { id: 'ironclad_t3', tier: 3, branch: 'ironclad', name: 'Barbed Armor', description: 'Reflect 6 damage to attackers',
        special: [{ type: 'thorns', value: 6 }] },
      { id: 'ironclad_t4', tier: 4, branch: 'ironclad', name: 'Second Wind', description: '+2 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 2, mode: 'add' }] },
      { id: 'ironclad_t5', tier: 5, branch: 'ironclad', name: 'Earthquake', description: 'Shake the earth, damaging and slowing all nearby',
        active: { abilityId: 'earthquake', name: 'Earthquake', description: '3x damage AOE + 30% slow', cooldown: 15,
          params: { type: 'earthquake', damage: 3, radius: 120, slowFactor: 0.30, slowDuration: 3 } } },
      { id: 'ironclad_t6', tier: 6, branch: 'ironclad', name: 'Living Steel', description: '+3 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 3, mode: 'add' }] },
      { id: 'ironclad_t7', tier: 7, branch: 'ironclad', name: 'Shockwave', description: 'Melee creates ground wave dealing 25% damage',
        combatMod: { type: 'shockwave', value: 0.25, params: { range: 80, width: 25 } } },
      { id: 'ironclad_t8', tier: 8, branch: 'ironclad', name: 'Adamantine', description: '+4 flat defense',
        passive: [{ stat: 'defense', value: 4, mode: 'add' }] },
      { id: 'ironclad_t9', tier: 9, branch: 'ironclad', name: 'Shield Bash', description: '25% chance to stun 0.8s on melee',
        combatMod: { type: 'shield_bash_stun', value: 0.25, params: { duration: 0.8 } } },
      { id: 'ironclad_t10', tier: 10, branch: 'ironclad', name: 'Undying Fortress', description: 'Below 30% HP: thorns triple, regen doubles',
        combatMod: { type: 'shield_bash_stun', value: 0.35, params: { duration: 1.0, lowHpThornsMult: 3, lowHpRegenMult: 2 } } },
    ],
  },
  juggernaut: {
    id: 'juggernaut', name: 'Juggernaut', description: 'Speed and brute force',
    playerClass: 'warrior', color: 0xdd7722,
    nodes: [
      { id: 'juggernaut_t1', tier: 1, branch: 'juggernaut', name: 'Momentum', description: '+8% movement speed',
        passive: [{ stat: 'speed', value: 0.08, mode: 'multiply' }] },
      { id: 'juggernaut_t2', tier: 2, branch: 'juggernaut', name: 'Heavy Blows', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'juggernaut_t3', tier: 3, branch: 'juggernaut', name: 'Unstoppable', description: '+15 max HP',
        passive: [{ stat: 'maxHp', value: 15, mode: 'add' }] },
      { id: 'juggernaut_t4', tier: 4, branch: 'juggernaut', name: 'Rampage', description: '+15% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.15, mode: 'multiply' }] },
      { id: 'juggernaut_t5', tier: 5, branch: 'juggernaut', name: 'Blade Storm', description: 'Spin dealing damage over time while moving',
        active: { abilityId: 'blade_storm', name: 'Blade Storm', description: '1.5x damage/tick for 4s', cooldown: 12,
          params: { type: 'blade_storm', damage: 1.5, radius: 70, duration: 4 } } },
      { id: 'juggernaut_t6', tier: 6, branch: 'juggernaut', name: 'Relentless', description: '+20% damage',
        passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'juggernaut_t7', tier: 7, branch: 'juggernaut', name: 'Cleave', description: 'Melee hits splash 60% to nearby',
        combatMod: { type: 'cleave', value: 0.60, params: { radius: 45 } } },
      { id: 'juggernaut_t8', tier: 8, branch: 'juggernaut', name: 'Unstoppable Force', description: '+20% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.20, mode: 'multiply' }] },
      { id: 'juggernaut_t9', tier: 9, branch: 'juggernaut', name: 'Shockwave', description: 'Melee creates ground wave 40% damage',
        combatMod: { type: 'shockwave', value: 0.40, params: { range: 110, width: 35 } } },
      { id: 'juggernaut_t10', tier: 10, branch: 'juggernaut', name: 'Cataclysm', description: 'Cleave + shockwave fire simultaneously at 80% damage',
        combatMod: { type: 'cleave', value: 0.80, params: { radius: 55, shockwave: 1, shockwaveRange: 120 } } },
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
      { id: 'sharpshooter_t5', tier: 5, branch: 'sharpshooter', name: 'Arrow Volley', description: 'Fire a cone of arrows at enemies',
        active: { abilityId: 'arrow_volley', name: 'Arrow Volley', description: '12 arrows in cone', cooldown: 10,
          params: { type: 'arrow_volley', arrowCount: 12, damage: 15, coneAngle: 0.8 } } },
      { id: 'sharpshooter_t6', tier: 6, branch: 'sharpshooter', name: 'Deadeye', description: '+8% crit chance',
        passive: [{ stat: 'critChance', value: 0.08, mode: 'add' }] },
      { id: 'sharpshooter_t7', tier: 7, branch: 'sharpshooter', name: 'Piercing Shot', description: 'Projectiles pierce through 2 targets',
        combatMod: { type: 'piercing_plus', value: 2 } },
      { id: 'sharpshooter_t8', tier: 8, branch: 'sharpshooter', name: 'Lethal Precision', description: '+20% damage',
        passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'sharpshooter_t9', tier: 9, branch: 'sharpshooter', name: 'Split on Hit', description: 'Projectiles split into 2 on hit',
        combatMod: { type: 'split_on_hit', value: 2, params: { damage: 0.5 } } },
      { id: 'sharpshooter_t10', tier: 10, branch: 'sharpshooter', name: 'Death Volley', description: 'Unlimited pierce, splits on every hit',
        combatMod: { type: 'split_on_hit', value: 3, params: { damage: 0.6, unlimitedPierce: 1 } } },
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
      { id: 'trapper_t5', tier: 5, branch: 'trapper', name: 'Snare Net', description: 'Throw a net that roots enemies in place',
        active: { abilityId: 'snare_net', name: 'Snare Net', description: 'Root enemies for 3s', cooldown: 12,
          params: { type: 'snare_net', radius: 80, rootDuration: 3, slowFactor: 0.30 } } },
      { id: 'trapper_t6', tier: 6, branch: 'trapper', name: 'Quick Traps', description: '+15% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.15, mode: 'multiply' }] },
      { id: 'trapper_t7', tier: 7, branch: 'trapper', name: 'Bouncing', description: 'Projectiles ricochet to 1 nearby enemy',
        combatMod: { type: 'bouncing', value: 1, params: { range: 120, damageFalloff: 0.7 } } },
      { id: 'trapper_t8', tier: 8, branch: 'trapper', name: 'Tracker', description: '+15 max HP',
        passive: [{ stat: 'maxHp', value: 15, mode: 'add' }] },
      { id: 'trapper_t9', tier: 9, branch: 'trapper', name: 'Multi-Shot', description: 'Fire 2 projectiles per attack',
        combatMod: { type: 'multishot_passive', value: 2, params: { spreadAngle: 0.15 } } },
      { id: 'trapper_t10', tier: 10, branch: 'trapper', name: 'Net Barrage', description: '3 projectiles, all bounce, slow 30%',
        combatMod: { type: 'multishot_passive', value: 3, params: { spreadAngle: 0.2, bounce: 1, bounceRange: 100 } } },
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
      { id: 'scout_t5', tier: 5, branch: 'scout', name: 'Grapple Hook', description: 'Dash to target location instantly',
        active: { abilityId: 'grapple_hook', name: 'Grapple Hook', description: 'Dash 200px', cooldown: 5,
          params: { type: 'grapple_hook', distance: 200 } } },
      { id: 'scout_t6', tier: 6, branch: 'scout', name: 'Wind Walker', description: '+12% movement speed',
        passive: [{ stat: 'speed', value: 0.12, mode: 'multiply' }] },
      { id: 'scout_t7', tier: 7, branch: 'scout', name: 'Homing Arrows', description: 'Projectiles track nearest enemy',
        combatMod: { type: 'homing_passive', value: 1 } },
      { id: 'scout_t8', tier: 8, branch: 'scout', name: 'Swift Strikes', description: '+15% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.15, mode: 'multiply' }] },
      { id: 'scout_t9', tier: 9, branch: 'scout', name: 'Bouncing', description: 'Projectiles ricochet to 2 enemies',
        combatMod: { type: 'bouncing', value: 2, params: { range: 100, damageFalloff: 0.6 } } },
      { id: 'scout_t10', tier: 10, branch: 'scout', name: 'Storm Runner', description: 'Homing + bounce 3 times',
        combatMod: { type: 'bouncing', value: 3, params: { range: 130, damageFalloff: 0.5, homing: 1 } } },
    ],
  },

  hawkeye: {
    id: 'hawkeye', name: 'Hawkeye', description: 'Crit stacking and burst',
    playerClass: 'ranger', color: 0xddaa33,
    nodes: [
      { id: 'hawkeye_t1', tier: 1, branch: 'hawkeye', name: 'Keen Sight', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'hawkeye_t2', tier: 2, branch: 'hawkeye', name: 'Piercing Shot', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'hawkeye_t3', tier: 3, branch: 'hawkeye', name: 'Deadly Aim', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'hawkeye_t4', tier: 4, branch: 'hawkeye', name: 'Headhunter', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'hawkeye_t5', tier: 5, branch: 'hawkeye', name: 'Marked for Death', description: 'Mark an enemy to take +50% damage',
        active: { abilityId: 'marked_for_death', name: 'Marked for Death', description: '+50% damage for 6s', cooldown: 14,
          params: { type: 'marked_for_death', damageAmp: 0.50, duration: 6 } } },
      { id: 'hawkeye_t6', tier: 6, branch: 'hawkeye', name: 'Eagle Sight', description: '+8% crit chance',
        passive: [{ stat: 'critChance', value: 0.08, mode: 'add' }] },
      { id: 'hawkeye_t7', tier: 7, branch: 'hawkeye', name: 'Multi-Shot', description: 'Fire 2 projectiles per attack',
        combatMod: { type: 'multishot_passive', value: 2, params: { spreadAngle: 0.12 } } },
      { id: 'hawkeye_t8', tier: 8, branch: 'hawkeye', name: 'Sniper', description: '+25% damage',
        passive: [{ stat: 'damage', value: 0.25, mode: 'multiply' }] },
      { id: 'hawkeye_t9', tier: 9, branch: 'hawkeye', name: 'Piercing Plus', description: 'Projectiles pierce 3 targets',
        combatMod: { type: 'piercing_plus', value: 3 } },
      { id: 'hawkeye_t10', tier: 10, branch: 'hawkeye', name: 'Rain of Steel', description: '3 projectiles, all pierce infinitely, +10% crit',
        combatMod: { type: 'multishot_passive', value: 3, params: { spreadAngle: 0.18, unlimitedPierce: 1, critBonus: 10 } } },
    ],
  },
  poisoner: {
    id: 'poisoner', name: 'Poisoner', description: 'DoT and slow attrition',
    playerClass: 'ranger', color: 0x66aa33,
    nodes: [
      { id: 'poisoner_t1', tier: 1, branch: 'poisoner', name: 'Poison Tips', description: 'Burn enemies for 2 dps',
        special: [{ type: 'burn_dot', value: 2 }] },
      { id: 'poisoner_t2', tier: 2, branch: 'poisoner', name: 'Weakening Venom', description: 'Slow enemies 15% on hit',
        special: [{ type: 'slow_on_hit', value: 0.15 }, { type: 'poison_dot', value: 2.5 }] },
      { id: 'poisoner_t3', tier: 3, branch: 'poisoner', name: 'Virulent Strain', description: 'Burn enemies for 4 dps',
        special: [{ type: 'burn_dot', value: 4 }] },
      { id: 'poisoner_t4', tier: 4, branch: 'poisoner', name: 'Debilitating Toxin', description: 'Slow enemies 25% on hit',
        special: [{ type: 'slow_on_hit', value: 0.25 }] },
      { id: 'poisoner_t5', tier: 5, branch: 'poisoner', name: 'Multishot', description: 'Each attack fires 3 arrows for 10s',
        active: { abilityId: 'multishot', name: 'Multishot', description: '3-way split shot for 10s', cooldown: 18,
          params: { type: 'multishot', arrowCount: 3, duration: 10 } } },
      { id: 'poisoner_t6', tier: 6, branch: 'poisoner', name: 'Potent Toxin', description: 'Burn 6 dps',
        special: [{ type: 'burn_dot', value: 6 }] },
      { id: 'poisoner_t7', tier: 7, branch: 'poisoner', name: 'Split on Hit', description: 'Projectiles split into 2 on hit',
        combatMod: { type: 'split_on_hit', value: 2, params: { damage: 0.5 } } },
      { id: 'poisoner_t8', tier: 8, branch: 'poisoner', name: 'Virulent', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'poisoner_t9', tier: 9, branch: 'poisoner', name: 'Bouncing', description: 'Projectiles ricochet to 2, spreading poison',
        combatMod: { type: 'bouncing', value: 2, params: { range: 110, damageFalloff: 0.65 } } },
      { id: 'poisoner_t10', tier: 10, branch: 'poisoner', name: 'Plague Arrows', description: 'Split into 3, each bounces once',
        combatMod: { type: 'split_on_hit', value: 3, params: { damage: 0.5, bounce: 1, bounceRange: 100 } } },
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
      { id: 'pyromancer_t5', tier: 5, branch: 'pyromancer', name: 'Pyroclasm', description: 'Unleash a cone of fire',
        active: { abilityId: 'pyroclasm', name: 'Pyroclasm', description: '60 damage + 8 DPS burn', cooldown: 10,
          params: { type: 'pyroclasm', damage: 60, burnDps: 8, burnDuration: 4, coneAngle: 0.8, range: 120 } } },
      { id: 'pyromancer_t6', tier: 6, branch: 'pyromancer', name: 'Hellfire', description: '+20% damage',
        passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'pyromancer_t7', tier: 7, branch: 'pyromancer', name: 'Explosive Projectiles', description: 'Projectiles explode on impact',
        combatMod: { type: 'explosive_projectile', value: 1, params: { radius: 40, damageFraction: 0.5 } } },
      { id: 'pyromancer_t8', tier: 8, branch: 'pyromancer', name: 'Blazing Speed', description: '+8% crit chance',
        passive: [{ stat: 'critChance', value: 0.08, mode: 'add' }] },
      { id: 'pyromancer_t9', tier: 9, branch: 'pyromancer', name: 'Chain Lightning', description: 'Hits arc to 2 nearby enemies',
        combatMod: { type: 'chain_lightning', value: 2, params: { range: 80, damageFraction: 0.4 } } },
      { id: 'pyromancer_t10', tier: 10, branch: 'pyromancer', name: 'Apocalypse', description: 'Explosions chain to 3 targets with burn zones',
        combatMod: { type: 'explosive_projectile', value: 1, params: { radius: 55, damageFraction: 0.7, chainCount: 3, burnZone: 1 } } },
    ],
  },
  frost_mage: {
    id: 'frost_mage', name: 'Frost Mage', description: 'Control and slow',
    playerClass: 'mage', color: 0x44aadd,
    nodes: [
      { id: 'frost_mage_t1', tier: 1, branch: 'frost_mage', name: 'Chill', description: 'Slow enemies 15% on hit',
        special: [{ type: 'slow_on_hit', value: 0.15 }] },
      { id: 'frost_mage_t2', tier: 2, branch: 'frost_mage', name: 'Ice Armor', description: '+10 max HP',
        passive: [{ stat: 'maxHp', value: 10, mode: 'add' }],
        special: [{ type: 'slow_on_hit', value: 0.25 }] },
      { id: 'frost_mage_t3', tier: 3, branch: 'frost_mage', name: 'Frostbite', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'frost_mage_t4', tier: 4, branch: 'frost_mage', name: 'Deep Freeze', description: 'Slow enemies 30% on hit',
        special: [{ type: 'slow_on_hit', value: 0.30 }] },
      { id: 'frost_mage_t5', tier: 5, branch: 'frost_mage', name: 'Ice Prison', description: 'Freeze all nearby enemies in place',
        active: { abilityId: 'ice_prison', name: 'Ice Prison', description: 'Freeze enemies for 3s', cooldown: 14,
          params: { type: 'ice_prison', radius: 90, freezeDuration: 3 } } },
      { id: 'frost_mage_t6', tier: 6, branch: 'frost_mage', name: 'Permafrost', description: 'Slow 35% on hit',
        special: [{ type: 'slow_on_hit', value: 0.35 }] },
      { id: 'frost_mage_t7', tier: 7, branch: 'frost_mage', name: 'Frozen Touch', description: '15% chance to freeze targets 1s',
        combatMod: { type: 'frozen_touch', value: 0.15, params: { duration: 1 } } },
      { id: 'frost_mage_t8', tier: 8, branch: 'frost_mage', name: 'Glacial Power', description: '+20% damage',
        passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'frost_mage_t9', tier: 9, branch: 'frost_mage', name: 'Chain Lightning', description: 'Hits arc to 2 nearby with slow',
        combatMod: { type: 'chain_lightning', value: 2, params: { range: 80, damageFraction: 0.35 } } },
      { id: 'frost_mage_t10', tier: 10, branch: 'frost_mage', name: 'Absolute Zero', description: '30% freeze, frozen shatter on death',
        combatMod: { type: 'frozen_touch', value: 0.30, params: { duration: 1.5, shatterRadius: 50, shatterDamage: 30 } } },
    ],
  },
  arcanist: {
    id: 'arcanist', name: 'Arcanist', description: 'Utility and support',
    playerClass: 'mage', color: 0x9955dd,
    nodes: [
      { id: 'arcanist_t1', tier: 1, branch: 'arcanist', name: 'Arcane Flow', description: '+5% movement speed',
        passive: [{ stat: 'speed', value: 0.05, mode: 'multiply' }] },
      { id: 'arcanist_t2', tier: 2, branch: 'arcanist', name: 'Mana Shield', description: '+1 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 1, mode: 'add' }],
        special: [{ type: 'arcane_mark', value: 0.2 }] },
      { id: 'arcanist_t3', tier: 3, branch: 'arcanist', name: 'Arcane Power', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'arcanist_t4', tier: 4, branch: 'arcanist', name: 'Arcane Barrier', description: '+20 max HP',
        passive: [{ stat: 'maxHp', value: 20, mode: 'add' }] },
      { id: 'arcanist_t5', tier: 5, branch: 'arcanist', name: 'Arcane Barrage', description: 'Fire homing arcane bolts',
        active: { abilityId: 'arcane_barrage', name: 'Arcane Barrage', description: '8 homing bolts, 12 damage each', cooldown: 8,
          params: { type: 'arcane_barrage', boltCount: 8, damage: 12 } } },
      { id: 'arcanist_t6', tier: 6, branch: 'arcanist', name: 'Arcane Mastery', description: '+20% damage',
        passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'arcanist_t7', tier: 7, branch: 'arcanist', name: 'Seeking Orbs', description: 'Projectiles home aggressively',
        combatMod: { type: 'seeking_orbs', value: 1, params: { turnRate: 2 } } },
      { id: 'arcanist_t8', tier: 8, branch: 'arcanist', name: 'Mana Well', description: '+2 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 2, mode: 'add' }] },
      { id: 'arcanist_t9', tier: 9, branch: 'arcanist', name: 'Arcane Echo', description: '30% chance spells cast twice',
        combatMod: { type: 'arcane_echo', value: 0.30 } },
      { id: 'arcanist_t10', tier: 10, branch: 'arcanist', name: 'Dimensional Cascade', description: '50% echo, echoed spells home',
        combatMod: { type: 'arcane_echo', value: 0.50, params: { echoHoming: 1 } } },
    ],
  },

  stormcaller: {
    id: 'stormcaller', name: 'Stormcaller', description: 'Attack speed and damage',
    playerClass: 'mage', color: 0x33bbee,
    nodes: [
      { id: 'stormcaller_t1', tier: 1, branch: 'stormcaller', name: 'Static Charge', description: '+10% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.10, mode: 'multiply' }] },
      { id: 'stormcaller_t2', tier: 2, branch: 'stormcaller', name: 'Lightning Bolt', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'stormcaller_t3', tier: 3, branch: 'stormcaller', name: 'Overcharge', description: '+15% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.15, mode: 'multiply' }],
        special: [{ type: 'stun_on_hit', value: 0.5 }] },
      { id: 'stormcaller_t4', tier: 4, branch: 'stormcaller', name: 'Chain Lightning', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'stormcaller_t5', tier: 5, branch: 'stormcaller', name: 'Lightning Storm', description: 'Call lightning on random enemies',
        active: { abilityId: 'lightning_storm', name: 'Lightning Storm', description: '5 bolts, 25 damage each', cooldown: 10,
          params: { type: 'lightning_storm', targetCount: 5, damage: 25, radius: 200 } } },
      { id: 'stormcaller_t6', tier: 6, branch: 'stormcaller', name: 'Surge', description: '+20% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.20, mode: 'multiply' }] },
      { id: 'stormcaller_t7', tier: 7, branch: 'stormcaller', name: 'Chain Lightning', description: 'Hits arc to 3 nearby enemies',
        combatMod: { type: 'chain_lightning', value: 3, params: { range: 90, damageFraction: 0.4 } } },
      { id: 'stormcaller_t8', tier: 8, branch: 'stormcaller', name: 'Thunder God', description: '+25% damage',
        passive: [{ stat: 'damage', value: 0.25, mode: 'multiply' }] },
      { id: 'stormcaller_t9', tier: 9, branch: 'stormcaller', name: 'Explosive Projectiles', description: 'Projectiles explode on impact',
        combatMod: { type: 'explosive_projectile', value: 1, params: { radius: 35, damageFraction: 0.45 } } },
      { id: 'stormcaller_t10', tier: 10, branch: 'stormcaller', name: 'Tempest', description: 'Chain 5 targets, each explodes',
        combatMod: { type: 'chain_lightning', value: 5, params: { range: 100, damageFraction: 0.5, explodeOnChain: 1, explosionRadius: 25 } } },
    ],
  },
  rift_walker: {
    id: 'rift_walker', name: 'Rift Walker', description: 'Mobility and repositioning',
    playerClass: 'mage', color: 0xbb55dd,
    nodes: [
      { id: 'rift_walker_t1', tier: 1, branch: 'rift_walker', name: 'Phase Shift', description: '+8% movement speed',
        passive: [{ stat: 'speed', value: 0.08, mode: 'multiply' }] },
      { id: 'rift_walker_t2', tier: 2, branch: 'rift_walker', name: 'Spatial Rend', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'rift_walker_t3', tier: 3, branch: 'rift_walker', name: 'Dimensional Rift', description: '+12% movement speed',
        passive: [{ stat: 'speed', value: 0.12, mode: 'multiply' }],
        special: [{ type: 'arcane_mark', value: 0.15 }] },
      { id: 'rift_walker_t4', tier: 4, branch: 'rift_walker', name: 'Void Touch', description: '5% lifesteal on hit',
        special: [{ type: 'lifesteal', value: 0.05 }] },
      { id: 'rift_walker_t5', tier: 5, branch: 'rift_walker', name: 'Rift Collapse', description: 'Pull enemies to a point and damage them',
        active: { abilityId: 'rift_collapse', name: 'Rift Collapse', description: 'Pull + 40 damage', cooldown: 12,
          params: { type: 'rift_collapse', radius: 150, damage: 40, pullStrength: 120 } } },
      { id: 'rift_walker_t6', tier: 6, branch: 'rift_walker', name: 'Warp Speed', description: '+15% movement speed',
        passive: [{ stat: 'speed', value: 0.15, mode: 'multiply' }] },
      { id: 'rift_walker_t7', tier: 7, branch: 'rift_walker', name: 'Seeking Orbs', description: 'Projectiles home aggressively',
        combatMod: { type: 'seeking_orbs', value: 1, params: { turnRate: 1.8 } } },
      { id: 'rift_walker_t8', tier: 8, branch: 'rift_walker', name: 'Void Power', description: '+20% damage',
        passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'rift_walker_t9', tier: 9, branch: 'rift_walker', name: 'Arcane Echo', description: '25% chance to cast twice',
        combatMod: { type: 'arcane_echo', value: 0.25 } },
      { id: 'rift_walker_t10', tier: 10, branch: 'rift_walker', name: 'Rift Storm', description: '40% echo, missed shots teleport to enemies',
        combatMod: { type: 'arcane_echo', value: 0.40, params: { teleportOnMiss: 1 } } },
    ],
  },

  // ── Assassin ──────────────────────────────────────────────────────────────
  blade_dancer: {
    id: 'blade_dancer', name: 'Blade Dancer', description: 'Speed and damage',
    playerClass: 'assassin', color: 0xcc3333,
    nodes: [
      { id: 'blade_dancer_t1', tier: 1, branch: 'blade_dancer', name: 'Quick Slash', description: '+10% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.10, mode: 'multiply' }] },
      { id: 'blade_dancer_t2', tier: 2, branch: 'blade_dancer', name: 'Twin Fangs', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'blade_dancer_t3', tier: 3, branch: 'blade_dancer', name: 'Expose Weakness', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'blade_dancer_t4', tier: 4, branch: 'blade_dancer', name: 'Flurry', description: '+20% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.20, mode: 'multiply' }] },
      { id: 'blade_dancer_t5', tier: 5, branch: 'blade_dancer', name: 'Phantom Strike', description: 'Dash through enemies, dealing damage',
        active: { abilityId: 'phantom_strike', name: 'Phantom Strike', description: 'Dash 120px, 3x damage to each', cooldown: 8,
          params: { type: 'phantom_strike', distance: 120, damage: 3 } } },
      { id: 'blade_dancer_t6', tier: 6, branch: 'blade_dancer', name: 'Blade Mastery', description: '+25% attack speed', passive: [{ stat: 'attackSpeed', value: 0.25, mode: 'multiply' }] },
      { id: 'blade_dancer_t7', tier: 7, branch: 'blade_dancer', name: 'Shadow Copies', description: 'Attacks spawn a clone that attacks once', combatMod: { type: 'shadow_copies', value: 1, params: { cloneDamage: 0.4, duration: 0.5 } } },
      { id: 'blade_dancer_t8', tier: 8, branch: 'blade_dancer', name: 'Deadly Dance', description: '+8% crit chance', passive: [{ stat: 'critChance', value: 0.08, mode: 'add' }] },
      { id: 'blade_dancer_t9', tier: 9, branch: 'blade_dancer', name: 'Backstab Crit', description: 'Behind attacks deal 2x crit damage', combatMod: { type: 'backstab_crit', value: 2.0 } },
      { id: 'blade_dancer_t10', tier: 10, branch: 'blade_dancer', name: 'Thousand Cuts', description: '2 shadow copies, backstab on flanks too', combatMod: { type: 'shadow_copies', value: 2, params: { cloneDamage: 0.5, duration: 0.6, backstabAngle: 2.5 } } },
    ],
  },
  shadow: {
    id: 'shadow', name: 'Shadow', description: 'Stealth and mobility',
    playerClass: 'assassin', color: 0x553366,
    nodes: [
      { id: 'shadow_t1', tier: 1, branch: 'shadow', name: 'Ghost Walk', description: '+10% movement speed',
        passive: [{ stat: 'speed', value: 0.10, mode: 'multiply' }] },
      { id: 'shadow_t2', tier: 2, branch: 'shadow', name: 'Ambush', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'shadow_t3', tier: 3, branch: 'shadow', name: 'Drain', description: '5% lifesteal on hit',
        special: [{ type: 'lifesteal', value: 0.05 }, { type: 'shadow_drain', value: 2 }] },
      { id: 'shadow_t4', tier: 4, branch: 'shadow', name: 'Phantom', description: '+15% movement speed',
        passive: [{ stat: 'speed', value: 0.15, mode: 'multiply' }] },
      { id: 'shadow_t5', tier: 5, branch: 'shadow', name: 'Smoke Bomb', description: 'Become invisible and slow nearby enemies',
        active: { abilityId: 'smoke_bomb', name: 'Smoke Bomb', description: 'Invis 3s + 40% slow zone', cooldown: 14,
          params: { type: 'smoke_bomb', radius: 80, duration: 3, slowFactor: 0.40 } } },
      { id: 'shadow_t6', tier: 6, branch: 'shadow', name: 'Dark Agility', description: '+15% movement speed', passive: [{ stat: 'speed', value: 0.15, mode: 'multiply' }] },
      { id: 'shadow_t7', tier: 7, branch: 'shadow', name: 'Bleed Stacks', description: '3 dps bleed, stacks 3x', combatMod: { type: 'bleed_stacks', value: 3, params: { maxStacks: 3, duration: 4 } } },
      { id: 'shadow_t8', tier: 8, branch: 'shadow', name: 'Shadow Blade', description: '+20% damage', passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'shadow_t9', tier: 9, branch: 'shadow', name: 'Shadow Copies', description: 'Attacks spawn a clone', combatMod: { type: 'shadow_copies', value: 1, params: { cloneDamage: 0.35, duration: 0.5 } } },
      { id: 'shadow_t10', tier: 10, branch: 'shadow', name: 'Phantom Army', description: '2 clones, bleeds stack 5x', combatMod: { type: 'shadow_copies', value: 2, params: { cloneDamage: 0.4, duration: 0.6, bleedMaxStacks: 5 } } },
    ],
  },
  venom: {
    id: 'venom', name: 'Venom', description: 'Poison and control',
    playerClass: 'assassin', color: 0x44aa44,
    nodes: [
      { id: 'venom_t1', tier: 1, branch: 'venom', name: 'Toxic Blade', description: 'Burn enemies for 2 dps',
        special: [{ type: 'burn_dot', value: 2 }] },
      { id: 'venom_t2', tier: 2, branch: 'venom', name: 'Cripple', description: 'Slow enemies 15% on hit',
        special: [{ type: 'slow_on_hit', value: 0.15 }, { type: 'poison_dot', value: 3 }] },
      { id: 'venom_t3', tier: 3, branch: 'venom', name: 'Lethal Dose', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'venom_t4', tier: 4, branch: 'venom', name: 'Neurotoxin', description: 'Slow enemies 25% on hit',
        special: [{ type: 'slow_on_hit', value: 0.25 }] },
      { id: 'venom_t5', tier: 5, branch: 'venom', name: 'Death Mark', description: 'Mark an enemy for delayed explosion',
        active: { abilityId: 'death_mark', name: 'Death Mark', description: '80 damage after 3s', cooldown: 10,
          params: { type: 'death_mark', delay: 3, damage: 80 } } },
      { id: 'venom_t6', tier: 6, branch: 'venom', name: 'Lethal Toxin', description: 'Poison 5 dps', special: [{ type: 'poison_dot', value: 5 }] },
      { id: 'venom_t7', tier: 7, branch: 'venom', name: 'Bleed Stacks', description: '4 dps bleed, stacks 3x', combatMod: { type: 'bleed_stacks', value: 4, params: { maxStacks: 3, duration: 5 } } },
      { id: 'venom_t8', tier: 8, branch: 'venom', name: 'Assassination', description: '+25% damage', passive: [{ stat: 'damage', value: 0.25, mode: 'multiply' }] },
      { id: 'venom_t9', tier: 9, branch: 'venom', name: 'Execute', description: '+50% damage vs targets below 30% HP', combatMod: { type: 'execute_bonus', value: 0.50, params: { threshold: 0.30 } } },
      { id: 'venom_t10', tier: 10, branch: 'venom', name: "Death's Embrace", description: 'Execute at 40% HP, kills spread DoTs', combatMod: { type: 'execute_bonus', value: 0.75, params: { threshold: 0.40, spreadDotsOnKill: 1, spreadRadius: 80 } } },
    ],
  },

  cutthroat: {
    id: 'cutthroat', name: 'Cutthroat', description: 'Crit-fishing burst damage',
    playerClass: 'assassin', color: 0xdd4444,
    nodes: [
      { id: 'cutthroat_t1', tier: 1, branch: 'cutthroat', name: 'Cheap Shot', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'cutthroat_t2', tier: 2, branch: 'cutthroat', name: 'Throat Slash', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'cutthroat_t3', tier: 3, branch: 'cutthroat', name: 'Ruthless', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'cutthroat_t4', tier: 4, branch: 'cutthroat', name: 'Execute', description: '+20% damage',
        passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'cutthroat_t5', tier: 5, branch: 'cutthroat', name: 'Fan of Knives', description: 'Throw knives in all directions',
        active: { abilityId: 'fan_of_knives', name: 'Fan of Knives', description: '12 knives, 20 damage each', cooldown: 8,
          params: { type: 'fan_of_knives', knifeCount: 12, damage: 20, radius: 100 } } },
      { id: 'cutthroat_t6', tier: 6, branch: 'cutthroat', name: "Assassin's Mark", description: '+8% crit chance', passive: [{ stat: 'critChance', value: 0.08, mode: 'add' }] },
      { id: 'cutthroat_t7', tier: 7, branch: 'cutthroat', name: 'Backstab Crit', description: 'Behind attacks crit for 2.5x', combatMod: { type: 'backstab_crit', value: 2.5 } },
      { id: 'cutthroat_t8', tier: 8, branch: 'cutthroat', name: 'Lethal Strikes', description: '+25% damage', passive: [{ stat: 'damage', value: 0.25, mode: 'multiply' }] },
      { id: 'cutthroat_t9', tier: 9, branch: 'cutthroat', name: 'Execute', description: '+60% damage vs targets below 25% HP', combatMod: { type: 'execute_bonus', value: 0.60, params: { threshold: 0.25 } } },
      { id: 'cutthroat_t10', tier: 10, branch: 'cutthroat', name: 'Deathblow', description: 'Execute at 35%, guaranteed crit on low HP', combatMod: { type: 'execute_bonus', value: 1.0, params: { threshold: 0.35, guaranteedCrit: 1 } } },
    ],
  },
  ghost_blade: {
    id: 'ghost_blade', name: 'Ghost Blade', description: 'Lifesteal predator',
    playerClass: 'assassin', color: 0x8855aa,
    nodes: [
      { id: 'ghost_blade_t1', tier: 1, branch: 'ghost_blade', name: 'Siphon Strike', description: '3% lifesteal on hit',
        special: [{ type: 'lifesteal', value: 0.03 }] },
      { id: 'ghost_blade_t2', tier: 2, branch: 'ghost_blade', name: 'Ethereal Blade', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'ghost_blade_t3', tier: 3, branch: 'ghost_blade', name: 'Soul Reaver', description: '8% lifesteal on hit',
        special: [{ type: 'lifesteal', value: 0.08 }] },
      { id: 'ghost_blade_t4', tier: 4, branch: 'ghost_blade', name: 'Wraith Form', description: '+10% movement speed',
        passive: [{ stat: 'speed', value: 0.10, mode: 'multiply' }] },
      { id: 'ghost_blade_t5', tier: 5, branch: 'ghost_blade', name: 'Vanish', description: 'Go invisible, next attack crits for 3x',
        active: { abilityId: 'vanish', name: 'Vanish', description: 'Stealth 4s + 3x crit', cooldown: 16,
          params: { type: 'vanish', duration: 4, damage: 3 } } },
      { id: 'ghost_blade_t6', tier: 6, branch: 'ghost_blade', name: 'Soul Siphon', description: '12% lifesteal', special: [{ type: 'lifesteal', value: 0.12 }] },
      { id: 'ghost_blade_t7', tier: 7, branch: 'ghost_blade', name: 'Shadow Copies', description: 'Clone attacks once', combatMod: { type: 'shadow_copies', value: 1, params: { cloneDamage: 0.35, duration: 0.5 } } },
      { id: 'ghost_blade_t8', tier: 8, branch: 'ghost_blade', name: 'Phantom Power', description: '+20% damage', passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'ghost_blade_t9', tier: 9, branch: 'ghost_blade', name: 'Bleed Stacks', description: '4 dps bleed, stacks 3x', combatMod: { type: 'bleed_stacks', value: 4, params: { maxStacks: 3, duration: 4 } } },
      { id: 'ghost_blade_t10', tier: 10, branch: 'ghost_blade', name: 'Wraith King', description: '2 clones with lifesteal, bleeds heal 50%', combatMod: { type: 'shadow_copies', value: 2, params: { cloneDamage: 0.5, duration: 0.8, bleedLifesteal: 0.5 } } },
    ],
  },

  // ── Paladin ───────────────────────────────────────────────────────────────
  holy_knight: {
    id: 'holy_knight', name: 'Holy Knight', description: 'Healing and defense',
    playerClass: 'paladin', color: 0xddcc44,
    nodes: [
      { id: 'holy_knight_t1', tier: 1, branch: 'holy_knight', name: 'Divine Grace', description: '+1 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 1, mode: 'add' }] },
      { id: 'holy_knight_t2', tier: 2, branch: 'holy_knight', name: 'Holy Armor', description: '+1 flat defense',
        passive: [{ stat: 'defense', value: 1, mode: 'add' }],
        special: [{ type: 'holy_mark', value: 0.3 }] },
      { id: 'holy_knight_t3', tier: 3, branch: 'holy_knight', name: 'Blessed Strikes', description: '5% lifesteal on hit',
        special: [{ type: 'lifesteal', value: 0.05 }] },
      { id: 'holy_knight_t4', tier: 4, branch: 'holy_knight', name: 'Sanctuary', description: '+25 max HP',
        passive: [{ stat: 'maxHp', value: 25, mode: 'add' }] },
      { id: 'holy_knight_t5', tier: 5, branch: 'holy_knight', name: 'Divine Smite', description: 'Holy blast that damages enemies and heals allies',
        active: { abilityId: 'divine_smite', name: 'Divine Smite', description: '50 damage + heal 30 HP', cooldown: 12,
          params: { type: 'divine_smite', damage: 50, radius: 100, healAmount: 30 } } },
      { id: 'holy_knight_t6', tier: 6, branch: 'holy_knight', name: 'Divine Protection', description: '+3 flat defense', passive: [{ stat: 'defense', value: 3, mode: 'add' }] },
      { id: 'holy_knight_t7', tier: 7, branch: 'holy_knight', name: 'Healing Strikes', description: 'Melee heals self 10% of damage', combatMod: { type: 'healing_strikes', value: 0.10 } },
      { id: 'holy_knight_t8', tier: 8, branch: 'holy_knight', name: 'Blessed Armor', description: '+30 max HP', passive: [{ stat: 'maxHp', value: 30, mode: 'add' }] },
      { id: 'holy_knight_t9', tier: 9, branch: 'holy_knight', name: 'Holy Splash', description: 'Melee hits deal 40% splash in 50px', combatMod: { type: 'holy_splash', value: 0.40, params: { radius: 50 } } },
      { id: 'holy_knight_t10', tier: 10, branch: 'holy_knight', name: 'Avatar of Light', description: 'Splash heals allies 20% of damage', combatMod: { type: 'holy_splash', value: 0.60, params: { radius: 60, allyHealFraction: 0.20 } } },
    ],
  },
  bulwark: {
    id: 'bulwark', name: 'Bulwark', description: 'Tank and durability',
    playerClass: 'paladin', color: 0x5577cc,
    nodes: [
      { id: 'bulwark_t1', tier: 1, branch: 'bulwark', name: 'Fortify', description: '+2 flat defense',
        passive: [{ stat: 'defense', value: 2, mode: 'add' }] },
      { id: 'bulwark_t2', tier: 2, branch: 'bulwark', name: 'Endurance', description: '+20 max HP',
        passive: [{ stat: 'maxHp', value: 20, mode: 'add' }] },
      { id: 'bulwark_t3', tier: 3, branch: 'bulwark', name: 'Retribution', description: 'Reflect 8 damage to attackers',
        special: [{ type: 'thorns', value: 8 }] },
      { id: 'bulwark_t4', tier: 4, branch: 'bulwark', name: 'Unbreakable', description: '+3 flat defense',
        passive: [{ stat: 'defense', value: 3, mode: 'add' }] },
      { id: 'bulwark_t5', tier: 5, branch: 'bulwark', name: 'Aegis', description: 'Grant shields to all nearby allies',
        active: { abilityId: 'aegis', name: 'Aegis', description: '40 HP shield for 8s', cooldown: 20,
          params: { type: 'aegis', shieldAmount: 40, duration: 8, radius: 200 } } },
      { id: 'bulwark_t6', tier: 6, branch: 'bulwark', name: 'Living Fortress', description: '+4 flat defense', passive: [{ stat: 'defense', value: 4, mode: 'add' }] },
      { id: 'bulwark_t7', tier: 7, branch: 'bulwark', name: 'Shield Bash', description: '25% chance stun 0.8s', combatMod: { type: 'shield_bash_stun', value: 0.25, params: { duration: 0.8 } } },
      { id: 'bulwark_t8', tier: 8, branch: 'bulwark', name: "Titan's Endurance", description: '+40 max HP', passive: [{ stat: 'maxHp', value: 40, mode: 'add' }] },
      { id: 'bulwark_t9', tier: 9, branch: 'bulwark', name: 'Holy Splash', description: 'Melee hits splash 30% in 45px', combatMod: { type: 'holy_splash', value: 0.30, params: { radius: 45 } } },
      { id: 'bulwark_t10', tier: 10, branch: 'bulwark', name: 'Impenetrable', description: 'Stun every melee, splash reflects thorns', combatMod: { type: 'shield_bash_stun', value: 1.0, params: { duration: 0.3, splashThorns: 10 } } },
    ],
  },
  crusader: {
    id: 'crusader', name: 'Crusader', description: 'Damage and crits',
    playerClass: 'paladin', color: 0xcc8833,
    nodes: [
      { id: 'crusader_t1', tier: 1, branch: 'crusader', name: 'Smite', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'crusader_t2', tier: 2, branch: 'crusader', name: 'Judgment', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }],
        special: [{ type: 'holy_mark', value: 0.2 }] },
      { id: 'crusader_t3', tier: 3, branch: 'crusader', name: 'Zeal', description: '+15% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.15, mode: 'multiply' }] },
      { id: 'crusader_t4', tier: 4, branch: 'crusader', name: 'Wrath', description: '+20% damage',
        passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'crusader_t5', tier: 5, branch: 'crusader', name: 'Judgment Hammer', description: 'Throw a holy hammer that stuns',
        active: { abilityId: 'judgment_hammer', name: 'Judgment Hammer', description: '60 damage + 2s stun', cooldown: 8,
          params: { type: 'judgment_hammer', damage: 60, stunDuration: 2, range: 200 } } },
      { id: 'crusader_t6', tier: 6, branch: 'crusader', name: 'Holy Wrath', description: '+8% crit chance', passive: [{ stat: 'critChance', value: 0.08, mode: 'add' }] },
      { id: 'crusader_t7', tier: 7, branch: 'crusader', name: 'Smite Chain', description: 'Hits arc holy damage to 2 nearby', combatMod: { type: 'smite_chain', value: 2, params: { range: 80, damageFraction: 0.35 } } },
      { id: 'crusader_t8', tier: 8, branch: 'crusader', name: "Crusader's Might", description: '+25% damage', passive: [{ stat: 'damage', value: 0.25, mode: 'multiply' }] },
      { id: 'crusader_t9', tier: 9, branch: 'crusader', name: 'Healing Strikes', description: 'Melee heals 8% of damage', combatMod: { type: 'healing_strikes', value: 0.08 } },
      { id: 'crusader_t10', tier: 10, branch: 'crusader', name: 'Divine Judgment', description: 'Chains to 4 with holy mark', combatMod: { type: 'smite_chain', value: 4, params: { range: 100, damageFraction: 0.5, applyHolyMark: 1 } } },
    ],
  },

  inquisitor: {
    id: 'inquisitor', name: 'Inquisitor', description: 'Aggressive burn damage',
    playerClass: 'paladin', color: 0xee6633,
    nodes: [
      { id: 'inquisitor_t1', tier: 1, branch: 'inquisitor', name: 'Holy Fire', description: 'Burn enemies for 3 dps',
        special: [{ type: 'burn_dot', value: 3 }] },
      { id: 'inquisitor_t2', tier: 2, branch: 'inquisitor', name: 'Righteous Fury', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'inquisitor_t3', tier: 3, branch: 'inquisitor', name: 'Purge', description: 'Burn enemies for 5 dps',
        special: [{ type: 'burn_dot', value: 5 }] },
      { id: 'inquisitor_t4', tier: 4, branch: 'inquisitor', name: 'Zealot\'s Wrath', description: '+10% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.10, mode: 'multiply' }] },
      { id: 'inquisitor_t5', tier: 5, branch: 'inquisitor', name: 'Consecration', description: 'Create a zone that damages enemies and heals allies',
        active: { abilityId: 'consecration', name: 'Consecration', description: '8 DPS + 3 HP/s heal zone', cooldown: 14,
          params: { type: 'consecration', radius: 100, dps: 8, healPerSec: 3, duration: 6 } } },
      { id: 'inquisitor_t6', tier: 6, branch: 'inquisitor', name: 'Sacred Flame', description: 'Burn 8 dps', special: [{ type: 'burn_dot', value: 8 }] },
      { id: 'inquisitor_t7', tier: 7, branch: 'inquisitor', name: 'Smite Chain', description: 'Hits arc fire to 2 nearby', combatMod: { type: 'smite_chain', value: 2, params: { range: 70, damageFraction: 0.3 } } },
      { id: 'inquisitor_t8', tier: 8, branch: 'inquisitor', name: "Zealot's Fury", description: '+20% attack speed', passive: [{ stat: 'attackSpeed', value: 0.20, mode: 'multiply' }] },
      { id: 'inquisitor_t9', tier: 9, branch: 'inquisitor', name: 'Holy Splash', description: 'Melee splashes 35% in 45px', combatMod: { type: 'holy_splash', value: 0.35, params: { radius: 45 } } },
      { id: 'inquisitor_t10', tier: 10, branch: 'inquisitor', name: 'Purifying Flames', description: 'Splash + chain targets burn, radius doubled', combatMod: { type: 'holy_splash', value: 0.50, params: { radius: 70, applyBurn: 1, burnDps: 10 } } },
    ],
  },
  penitent: {
    id: 'penitent', name: 'Penitent', description: 'Thorns and suffering',
    playerClass: 'paladin', color: 0x7788aa,
    nodes: [
      { id: 'penitent_t1', tier: 1, branch: 'penitent', name: 'Martyrdom', description: 'Reflect 4 damage to attackers',
        special: [{ type: 'thorns', value: 4 }] },
      { id: 'penitent_t2', tier: 2, branch: 'penitent', name: 'Penance', description: '+15 max HP',
        passive: [{ stat: 'maxHp', value: 15, mode: 'add' }] },
      { id: 'penitent_t3', tier: 3, branch: 'penitent', name: 'Iron Will', description: '+2 flat defense',
        passive: [{ stat: 'defense', value: 2, mode: 'add' }] },
      { id: 'penitent_t4', tier: 4, branch: 'penitent', name: 'Retribution', description: 'Reflect 8 damage to attackers',
        special: [{ type: 'thorns', value: 8 }] },
      { id: 'penitent_t5', tier: 5, branch: 'penitent', name: 'Guardian Angel', description: 'Revive with 50% HP on death',
        active: { abilityId: 'guardian_angel', name: 'Guardian Angel', description: 'Auto-revive once (60s recharge)', cooldown: 60,
          params: { type: 'guardian_angel', reviveHpPercent: 0.50 } } },
      { id: 'penitent_t6', tier: 6, branch: 'penitent', name: 'Punishing Thorns', description: 'Reflect 12 damage', special: [{ type: 'thorns', value: 12 }] },
      { id: 'penitent_t7', tier: 7, branch: 'penitent', name: 'Shield Bash', description: '20% stun 0.6s on melee', combatMod: { type: 'shield_bash_stun', value: 0.20, params: { duration: 0.6 } } },
      { id: 'penitent_t8', tier: 8, branch: 'penitent', name: 'Endurance', description: '+3 flat defense', passive: [{ stat: 'defense', value: 3, mode: 'add' }] },
      { id: 'penitent_t9', tier: 9, branch: 'penitent', name: 'Healing Strikes', description: 'Melee heals 12% of damage', combatMod: { type: 'healing_strikes', value: 0.12 } },
      { id: 'penitent_t10', tier: 10, branch: 'penitent', name: 'Martyrdom Aura', description: 'AOE thorns, healing strikes affect allies', combatMod: { type: 'healing_strikes', value: 0.15, params: { aoeThorns: 1, thornsRadius: 60, allyHeal: 1 } } },
    ],
  },

  // ── Necromancer ────────────────────────────────────────────────────────────
  death_mage: {
    id: 'death_mage', name: 'Death Mage', description: 'Damage over time',
    playerClass: 'necromancer', color: 0x339988,
    nodes: [
      { id: 'death_mage_t1', tier: 1, branch: 'death_mage', name: 'Decay', description: 'Burn enemies for 3 dps',
        special: [{ type: 'burn_dot', value: 3 }] },
      { id: 'death_mage_t2', tier: 2, branch: 'death_mage', name: 'Blight', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }],
        special: [{ type: 'shadow_drain', value: 2.5 }] },
      { id: 'death_mage_t3', tier: 3, branch: 'death_mage', name: 'Necrosis', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'death_mage_t4', tier: 4, branch: 'death_mage', name: 'Plague', description: 'Burn enemies for 5 dps',
        special: [{ type: 'burn_dot', value: 5 }] },
      { id: 'death_mage_t5', tier: 5, branch: 'death_mage', name: 'Raise Dead', description: 'Summon skeletons to fight for you',
        active: { abilityId: 'raise_dead', name: 'Raise Dead', description: '5 skeletons for 15s', cooldown: 20,
          params: { type: 'raise_dead', count: 5, hp: 30, damage: 8, duration: 15 } } },
      { id: 'death_mage_t6', tier: 6, branch: 'death_mage', name: 'Plague Master', description: 'Burn 8 dps', special: [{ type: 'burn_dot', value: 8 }] },
      { id: 'death_mage_t7', tier: 7, branch: 'death_mage', name: 'Life Drain', description: 'Attacks drain 5 HP/s for 2s', combatMod: { type: 'life_drain_on_hit', value: 5, params: { duration: 2 } } },
      { id: 'death_mage_t8', tier: 8, branch: 'death_mage', name: 'Necrotic Power', description: '+25% damage', passive: [{ stat: 'damage', value: 0.25, mode: 'multiply' }] },
      { id: 'death_mage_t9', tier: 9, branch: 'death_mage', name: 'Curse Spread', description: 'On-hit effects spread to 2 nearby', combatMod: { type: 'curse_spread', value: 2, params: { range: 80 } } },
      { id: 'death_mage_t10', tier: 10, branch: 'death_mage', name: 'Plague Lord', description: 'Spread to 4, chain-spreads once', combatMod: { type: 'curse_spread', value: 4, params: { range: 100, chainSpread: 1 } } },
    ],
  },
  cursed: {
    id: 'cursed', name: 'Cursed', description: 'Control and debuffs',
    playerClass: 'necromancer', color: 0x774488,
    nodes: [
      { id: 'cursed_t1', tier: 1, branch: 'cursed', name: 'Hex', description: 'Slow enemies 20% on hit',
        special: [{ type: 'slow_on_hit', value: 0.20 }] },
      { id: 'cursed_t2', tier: 2, branch: 'cursed', name: 'Wither', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'cursed_t3', tier: 3, branch: 'cursed', name: 'Soul Siphon', description: '5% lifesteal on hit',
        special: [{ type: 'lifesteal', value: 0.05 }, { type: 'shadow_drain', value: 2 }] },
      { id: 'cursed_t4', tier: 4, branch: 'cursed', name: 'Entropy', description: 'Slow enemies 30% on hit',
        special: [{ type: 'slow_on_hit', value: 0.30 }] },
      { id: 'cursed_t5', tier: 5, branch: 'cursed', name: 'Soul Drain', description: 'Channel to drain life from enemies',
        active: { abilityId: 'soul_drain', name: 'Soul Drain', description: '15 DPS drain for 4s', cooldown: 14,
          params: { type: 'soul_drain', dps: 15, radius: 100, duration: 4 } } },
      { id: 'cursed_t6', tier: 6, branch: 'cursed', name: 'Deepening Curse', description: 'Slow 35% on hit', special: [{ type: 'slow_on_hit', value: 0.35 }] },
      { id: 'cursed_t7', tier: 7, branch: 'cursed', name: 'Soul Mark', description: 'Marked targets take 20% more damage 3s', combatMod: { type: 'soul_mark', value: 0.20, params: { duration: 3 } } },
      { id: 'cursed_t8', tier: 8, branch: 'cursed', name: 'Dark Will', description: '+20% damage', passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'cursed_t9', tier: 9, branch: 'cursed', name: 'Life Drain', description: '6 HP/s drain for 2s', combatMod: { type: 'life_drain_on_hit', value: 6, params: { duration: 2 } } },
      { id: 'cursed_t10', tier: 10, branch: 'cursed', name: 'Doom Curse', description: 'Mark amps 40%, marked explode on death', combatMod: { type: 'soul_mark', value: 0.40, params: { duration: 4, deathExplosion: 1, explosionRadius: 60, explosionDamage: 30 } } },
    ],
  },
  blood_magic: {
    id: 'blood_magic', name: 'Blood Magic', description: 'Sacrifice and power',
    playerClass: 'necromancer', color: 0xaa3344,
    nodes: [
      { id: 'blood_magic_t1', tier: 1, branch: 'blood_magic', name: 'Blood Pact', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'blood_magic_t2', tier: 2, branch: 'blood_magic', name: 'Crimson Thorns', description: 'Reflect 5 damage to attackers',
        special: [{ type: 'thorns', value: 5 }] },
      { id: 'blood_magic_t3', tier: 3, branch: 'blood_magic', name: 'Life Tap', description: '8% lifesteal on hit',
        special: [{ type: 'lifesteal', value: 0.08 }] },
      { id: 'blood_magic_t4', tier: 4, branch: 'blood_magic', name: 'Sanguine Power', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'blood_magic_t5', tier: 5, branch: 'blood_magic', name: 'Death Coil', description: 'Fire a homing bolt that damages and heals',
        active: { abilityId: 'death_coil', name: 'Death Coil', description: '50 damage + heal 25 HP', cooldown: 8,
          params: { type: 'death_coil', damage: 50, healAmount: 25 } } },
      { id: 'blood_magic_t6', tier: 6, branch: 'blood_magic', name: 'Blood Power', description: '+8% crit chance', passive: [{ stat: 'critChance', value: 0.08, mode: 'add' }] },
      { id: 'blood_magic_t7', tier: 7, branch: 'blood_magic', name: 'Life Drain', description: '7 HP/s drain for 2s', combatMod: { type: 'life_drain_on_hit', value: 7, params: { duration: 2 } } },
      { id: 'blood_magic_t8', tier: 8, branch: 'blood_magic', name: 'Sanguine Might', description: '+25% damage', passive: [{ stat: 'damage', value: 0.25, mode: 'multiply' }] },
      { id: 'blood_magic_t9', tier: 9, branch: 'blood_magic', name: 'Bone Shards', description: 'Kills spawn 3 bone projectiles', combatMod: { type: 'bone_shards', value: 3, params: { damage: 15, range: 120 } } },
      { id: 'blood_magic_t10', tier: 10, branch: 'blood_magic', name: 'Blood Lord', description: 'Bone shards on 20% of hits, drain heals 2x', combatMod: { type: 'bone_shards', value: 4, params: { damage: 20, range: 140, procChance: 0.20, drainMult: 2 } } },
    ],
  },

  grave_robber: {
    id: 'grave_robber', name: 'Grave Robber', description: 'Speed and lifesteal',
    playerClass: 'necromancer', color: 0x55aa88,
    nodes: [
      { id: 'grave_robber_t1', tier: 1, branch: 'grave_robber', name: 'Grave Haste', description: '+8% movement speed',
        passive: [{ stat: 'speed', value: 0.08, mode: 'multiply' }] },
      { id: 'grave_robber_t2', tier: 2, branch: 'grave_robber', name: 'Corpse Drain', description: '5% lifesteal on hit',
        special: [{ type: 'lifesteal', value: 0.05 }] },
      { id: 'grave_robber_t3', tier: 3, branch: 'grave_robber', name: 'Bone Shards', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'grave_robber_t4', tier: 4, branch: 'grave_robber', name: 'Ghoul Speed', description: '+12% movement speed',
        passive: [{ stat: 'speed', value: 0.12, mode: 'multiply' }] },
      { id: 'grave_robber_t5', tier: 5, branch: 'grave_robber', name: 'Bone Prison', description: 'Trap an enemy in a cage of bones',
        active: { abilityId: 'bone_prison', name: 'Bone Prison', description: 'Trap enemy for 4s', cooldown: 12,
          params: { type: 'bone_prison', duration: 4 } } },
      { id: 'grave_robber_t6', tier: 6, branch: 'grave_robber', name: 'Fleet of Foot', description: '+15% movement speed', passive: [{ stat: 'speed', value: 0.15, mode: 'multiply' }] },
      { id: 'grave_robber_t7', tier: 7, branch: 'grave_robber', name: 'Bone Shards', description: 'Kills spawn 2 bone projectiles', combatMod: { type: 'bone_shards', value: 2, params: { damage: 12, range: 100 } } },
      { id: 'grave_robber_t8', tier: 8, branch: 'grave_robber', name: 'Grave Power', description: '+20% damage', passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'grave_robber_t9', tier: 9, branch: 'grave_robber', name: 'Curse Spread', description: 'On-hit effects spread to 2 nearby', combatMod: { type: 'curse_spread', value: 2, params: { range: 70 } } },
      { id: 'grave_robber_t10', tier: 10, branch: 'grave_robber', name: 'Grave Lord', description: 'Bone shards every 3rd hit, spreads lifesteal', combatMod: { type: 'bone_shards', value: 3, params: { damage: 18, range: 120, everyNthHit: 3, spreadLifesteal: 1 } } },
    ],
  },
  lich: {
    id: 'lich', name: 'Lich', description: 'Raw power and defense',
    playerClass: 'necromancer', color: 0x4466aa,
    nodes: [
      { id: 'lich_t1', tier: 1, branch: 'lich', name: 'Dark Power', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'lich_t2', tier: 2, branch: 'lich', name: 'Bone Armor', description: '+2 flat defense',
        passive: [{ stat: 'defense', value: 2, mode: 'add' }] },
      { id: 'lich_t3', tier: 3, branch: 'lich', name: 'Undying Will', description: '+20 max HP',
        passive: [{ stat: 'maxHp', value: 20, mode: 'add' }] },
      { id: 'lich_t4', tier: 4, branch: 'lich', name: 'Death Aura', description: 'Burn enemies for 4 dps',
        special: [{ type: 'burn_dot', value: 4 }] },
      { id: 'lich_t5', tier: 5, branch: 'lich', name: 'Plague Cloud', description: 'Create a toxic cloud that spreads',
        active: { abilityId: 'plague_cloud', name: 'Plague Cloud', description: '10 DPS for 8s, spreads', cooldown: 16,
          params: { type: 'plague_cloud', radius: 120, dps: 10, duration: 8 } } },
      { id: 'lich_t6', tier: 6, branch: 'lich', name: 'Unholy Power', description: '+30% damage', passive: [{ stat: 'damage', value: 0.30, mode: 'multiply' }] },
      { id: 'lich_t7', tier: 7, branch: 'lich', name: 'Soul Mark', description: '25% damage amp for 3s', combatMod: { type: 'soul_mark', value: 0.25, params: { duration: 3 } } },
      { id: 'lich_t8', tier: 8, branch: 'lich', name: "Death's Embrace", description: '+3 flat defense', passive: [{ stat: 'defense', value: 3, mode: 'add' }] },
      { id: 'lich_t9', tier: 9, branch: 'lich', name: 'Curse Spread', description: 'Effects spread to 3 nearby', combatMod: { type: 'curse_spread', value: 3, params: { range: 90 } } },
      { id: 'lich_t10', tier: 10, branch: 'lich', name: 'Archlich', description: 'Marked targets spread debuffs on death to all nearby', combatMod: { type: 'soul_mark', value: 0.35, params: { duration: 4, spreadAll: 1, spreadRadius: 100 } } },
    ],
  },

  // ── Beastmaster ───────────────────────────────────────────────────────────
  feral: {
    id: 'feral', name: 'Feral', description: 'Raw damage and speed',
    playerClass: 'beastmaster', color: 0xcc6633,
    nodes: [
      { id: 'feral_t1', tier: 1, branch: 'feral', name: 'Savage Claws', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'feral_t2', tier: 2, branch: 'feral', name: 'Predatory Instinct', description: '+10% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.10, mode: 'multiply' }] },
      { id: 'feral_t3', tier: 3, branch: 'feral', name: 'Rend', description: 'Burn enemies for 4 dps',
        special: [{ type: 'burn_dot', value: 4 }] },
      { id: 'feral_t4', tier: 4, branch: 'feral', name: 'Apex Predator', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'feral_t5', tier: 5, branch: 'feral', name: 'Stampede', description: 'Charge with your pack through enemies',
        active: { abilityId: 'stampede', name: 'Stampede', description: 'Charge 180px, 2.5x damage', cooldown: 10,
          params: { type: 'stampede', distance: 180, damage: 2.5 } } },
      { id: 'feral_t6', tier: 6, branch: 'feral', name: 'Primal Fury', description: '+20% damage', passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'feral_t7', tier: 7, branch: 'feral', name: 'Feral Swipe', description: 'Melee arc increased to 180 degrees', combatMod: { type: 'feral_swipe', value: 180, params: { arcRadians: 3.14 } } },
      { id: 'feral_t8', tier: 8, branch: 'feral', name: 'Apex Hunter', description: '+8% crit chance', passive: [{ stat: 'critChance', value: 0.08, mode: 'add' }] },
      { id: 'feral_t9', tier: 9, branch: 'feral', name: "Nature's Bite", description: '5 dps poison for 4s', combatMod: { type: 'natures_bite', value: 5, params: { duration: 4 } } },
      { id: 'feral_t10', tier: 10, branch: 'feral', name: 'Alpha Predator', description: '360 degree melee, poison stacks 3x', combatMod: { type: 'feral_swipe', value: 360, params: { arcRadians: 6.28, poisonStacks: 3 } } },
    ],
  },
  packleader: {
    id: 'packleader', name: 'Packleader', description: 'Team buffs and resilience',
    playerClass: 'beastmaster', color: 0x55aa77,
    nodes: [
      { id: 'packleader_t1', tier: 1, branch: 'packleader', name: 'Thick Hide', description: '+15 max HP',
        passive: [{ stat: 'maxHp', value: 15, mode: 'add' }] },
      { id: 'packleader_t2', tier: 2, branch: 'packleader', name: 'Pack Vitality', description: '+1 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 1, mode: 'add' }] },
      { id: 'packleader_t3', tier: 3, branch: 'packleader', name: 'Alpha Roar', description: '+10% damage',
        passive: [{ stat: 'damage', value: 0.10, mode: 'multiply' }] },
      { id: 'packleader_t4', tier: 4, branch: 'packleader', name: 'Resilience', description: '+20 max HP',
        passive: [{ stat: 'maxHp', value: 20, mode: 'add' }] },
      { id: 'packleader_t5', tier: 5, branch: 'packleader', name: 'Pack Hunt', description: 'Summon wolves to fight alongside you',
        active: { abilityId: 'pack_hunt', name: 'Pack Hunt', description: '3 wolves for 12s', cooldown: 18,
          params: { type: 'pack_hunt', count: 3, hp: 40, damage: 10, duration: 12 } } },
      { id: 'packleader_t6', tier: 6, branch: 'packleader', name: 'Pack Vigor', description: '+30 max HP', passive: [{ stat: 'maxHp', value: 30, mode: 'add' }] },
      { id: 'packleader_t7', tier: 7, branch: 'packleader', name: 'Pack Strike', description: 'Pet attacks with you', combatMod: { type: 'pack_strike', value: 1, params: { petDamageBonus: 0.25 } } },
      { id: 'packleader_t8', tier: 8, branch: 'packleader', name: 'Alpha Command', description: '+2 HP/s regen', passive: [{ stat: 'hpRegen', value: 2, mode: 'add' }] },
      { id: 'packleader_t9', tier: 9, branch: 'packleader', name: 'Feral Swipe', description: 'Wider melee arc 150 degrees', combatMod: { type: 'feral_swipe', value: 150, params: { arcRadians: 2.62 } } },
      { id: 'packleader_t10', tier: 10, branch: 'packleader', name: 'Wolf King', description: '2 companions, pack strike, wolves apply on-hit', combatMod: { type: 'pack_strike', value: 2, params: { petDamageBonus: 0.40, extraWolf: 1, wolvesApplyOnHit: 1 } } },
    ],
  },
  survivalist: {
    id: 'survivalist', name: 'Survivalist', description: 'Mobility and utility',
    playerClass: 'beastmaster', color: 0x8899aa,
    nodes: [
      { id: 'survivalist_t1', tier: 1, branch: 'survivalist', name: 'Nimble', description: '+10% movement speed',
        passive: [{ stat: 'speed', value: 0.10, mode: 'multiply' }] },
      { id: 'survivalist_t2', tier: 2, branch: 'survivalist', name: 'Natural Armor', description: '+1 flat defense',
        passive: [{ stat: 'defense', value: 1, mode: 'add' }],
        special: [{ type: 'nature_blessing', value: 2 }] },
      { id: 'survivalist_t3', tier: 3, branch: 'survivalist', name: 'Leech', description: '5% lifesteal on hit',
        special: [{ type: 'lifesteal', value: 0.05 }] },
      { id: 'survivalist_t4', tier: 4, branch: 'survivalist', name: 'Evasion', description: '+10% movement speed',
        passive: [{ stat: 'speed', value: 0.10, mode: 'multiply' }] },
      { id: 'survivalist_t5', tier: 5, branch: 'survivalist', name: 'Primal Roar', description: 'Fear enemies and boost ally speed',
        active: { abilityId: 'primal_roar', name: 'Primal Roar', description: 'Fear 3s + allies +20% speed', cooldown: 14,
          params: { type: 'primal_roar', radius: 120, fearDuration: 3, allySpeedBonus: 0.20, allyBuffDuration: 6 } } },
      { id: 'survivalist_t6', tier: 6, branch: 'survivalist', name: 'Fleet Paws', description: '+12% movement speed', passive: [{ stat: 'speed', value: 0.12, mode: 'multiply' }] },
      { id: 'survivalist_t7', tier: 7, branch: 'survivalist', name: "Nature's Bite", description: '4 dps poison for 3s', combatMod: { type: 'natures_bite', value: 4, params: { duration: 3 } } },
      { id: 'survivalist_t8', tier: 8, branch: 'survivalist', name: 'Hardy', description: '+2 flat defense', passive: [{ stat: 'defense', value: 2, mode: 'add' }] },
      { id: 'survivalist_t9', tier: 9, branch: 'survivalist', name: 'Pack Strike', description: 'Pet attacks with you', combatMod: { type: 'pack_strike', value: 1, params: { petDamageBonus: 0.20 } } },
      { id: 'survivalist_t10', tier: 10, branch: 'survivalist', name: "Nature's Guardian", description: 'Poison heals 1 HP/s per poisoned enemy', combatMod: { type: 'natures_bite', value: 6, params: { duration: 5, healPerPoisoned: 1, petInheritsDefense: 1 } } },
    ],
  },
  predator: {
    id: 'predator', name: 'Predator', description: 'Pursuit and slow',
    playerClass: 'beastmaster', color: 0xaa4433,
    nodes: [
      { id: 'predator_t1', tier: 1, branch: 'predator', name: 'Hunt', description: '+8% movement speed',
        passive: [{ stat: 'speed', value: 0.08, mode: 'multiply' }] },
      { id: 'predator_t2', tier: 2, branch: 'predator', name: 'Hamstring', description: 'Slow enemies 20% on hit',
        special: [{ type: 'slow_on_hit', value: 0.20 }] },
      { id: 'predator_t3', tier: 3, branch: 'predator', name: 'Savage Bite', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'predator_t4', tier: 4, branch: 'predator', name: 'Pack Tactics', description: '+5% crit chance',
        passive: [{ stat: 'critChance', value: 0.05, mode: 'add' }] },
      { id: 'predator_t5', tier: 5, branch: 'predator', name: "Nature's Wrath", description: 'Vines root all nearby enemies',
        active: { abilityId: 'natures_wrath', name: "Nature's Wrath", description: 'Root 3s + 5 DPS', cooldown: 12,
          params: { type: 'natures_wrath', radius: 100, rootDuration: 3, dps: 5 } } },
      { id: 'predator_t6', tier: 6, branch: 'predator', name: 'Swift Predator', description: '+10% movement speed', passive: [{ stat: 'speed', value: 0.10, mode: 'multiply' }] },
      { id: 'predator_t7', tier: 7, branch: 'predator', name: 'Feral Swipe', description: '150 degree melee arc', combatMod: { type: 'feral_swipe', value: 150, params: { arcRadians: 2.62 } } },
      { id: 'predator_t8', tier: 8, branch: 'predator', name: 'Savage Force', description: '+20% damage', passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'predator_t9', tier: 9, branch: 'predator', name: "Nature's Bite", description: '5 dps poison for 4s', combatMod: { type: 'natures_bite', value: 5, params: { duration: 4 } } },
      { id: 'predator_t10', tier: 10, branch: 'predator', name: 'Apex Hunter', description: 'Poisoned enemies slowed 40%, +20% speed per poisoned', combatMod: { type: 'natures_bite', value: 7, params: { duration: 5, poisonSlow: 0.40, speedPerPoisoned: 0.20 } } },
    ],
  },
  warden: {
    id: 'warden', name: 'Warden', description: 'Defense and regeneration',
    playerClass: 'beastmaster', color: 0x448866,
    nodes: [
      { id: 'warden_t1', tier: 1, branch: 'warden', name: 'Bark Skin', description: '+1 flat defense',
        passive: [{ stat: 'defense', value: 1, mode: 'add' }] },
      { id: 'warden_t2', tier: 2, branch: 'warden', name: 'Nature\'s Gift', description: '+1 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 1, mode: 'add' }] },
      { id: 'warden_t3', tier: 3, branch: 'warden', name: 'Wild Growth', description: '+20 max HP',
        passive: [{ stat: 'maxHp', value: 20, mode: 'add' }],
        special: [{ type: 'nature_blessing', value: 3 }] },
      { id: 'warden_t4', tier: 4, branch: 'warden', name: 'Regrowth', description: '+2 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 2, mode: 'add' }] },
      { id: 'warden_t5', tier: 5, branch: 'warden', name: 'Wild Transformation', description: 'Transform into a beast form',
        active: { abilityId: 'wild_transformation', name: 'Wild Transformation', description: '+50% speed, +30% damage for 10s', cooldown: 25,
          params: { type: 'wild_transformation', speedBonus: 0.50, damageBonus: 0.30, defenseBonus: 2, duration: 10 } } },
      { id: 'warden_t6', tier: 6, branch: 'warden', name: 'Ancient Bark', description: '+3 flat defense', passive: [{ stat: 'defense', value: 3, mode: 'add' }] },
      { id: 'warden_t7', tier: 7, branch: 'warden', name: 'Pack Strike', description: 'Pet attacks with you', combatMod: { type: 'pack_strike', value: 1, params: { petDamageBonus: 0.20 } } },
      { id: 'warden_t8', tier: 8, branch: 'warden', name: 'Rejuvenation', description: '+3 HP/s regen', passive: [{ stat: 'hpRegen', value: 3, mode: 'add' }] },
      { id: 'warden_t9', tier: 9, branch: 'warden', name: "Nature's Bite", description: '4 dps poison for 3s', combatMod: { type: 'natures_bite', value: 4, params: { duration: 3 } } },
      { id: 'warden_t10', tier: 10, branch: 'warden', name: 'Eternal Warden', description: 'Pets poison too, poisoned take 15% more', combatMod: { type: 'pack_strike', value: 1, params: { petDamageBonus: 0.30, petPoison: 1, poisonVulnerability: 0.15 } } },
    ],
  },
};

/** Which branches belong to each class (display order: left, center, right). */
export const CLASS_BRANCHES: Record<PlayerClass, SkillBranchId[]> = {
  warrior: ['berserker', 'guardian', 'warlord', 'ironclad', 'juggernaut'],
  ranger: ['sharpshooter', 'trapper', 'scout', 'hawkeye', 'poisoner'],
  mage: ['pyromancer', 'frost_mage', 'arcanist', 'stormcaller', 'rift_walker'],
  assassin: ['blade_dancer', 'shadow', 'venom', 'cutthroat', 'ghost_blade'],
  paladin: ['holy_knight', 'bulwark', 'crusader', 'inquisitor', 'penitent'],
  necromancer: ['death_mage', 'cursed', 'blood_magic', 'grave_robber', 'lich'],
  beastmaster: ['feral', 'packleader', 'survivalist', 'predator', 'warden'],
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
  // Combat modifiers
  combatMods: CombatModifier[];
}

export function emptySkillBuffs(): SkillBuffs {
  return {
    damageMultiplier: 1, speedMultiplier: 1, attackSpeedMultiplier: 1,
    maxHpBonus: 0, defenseBonus: 0, critChanceBonus: 0, hpRegen: 0,
    lifesteal: 0, burnDot: 0, thornsDamage: 0, slowOnHit: 0,
    poisonDot: 0, stunOnHit: 0, holyMark: 0, shadowDrain: 0, arcaneMark: 0, natureBlessing: 0,
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
