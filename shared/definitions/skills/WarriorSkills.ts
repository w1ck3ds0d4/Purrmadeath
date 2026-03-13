/**
 * Warrior skill branches: Berserker, Guardian, Blood Knight, Templar (placeholder), Slayer (placeholder).
 *
 * Berserker: Sustain through bloodlust stacks and Warcry Rage (speed + DR + regen aura).
 * Guardian: Tank with thorns, Unbreakable Charge (taunt + damage store + AOE release), Aegis Shield.
 * Blood Knight: Lifesteal, armor break, Blood Drain (AOE HP drain), Blood Arc (penetrating projectile).
 */

import type { SkillBranch } from '../SkillDefinitions';

export const WARRIOR_BRANCHES: Record<string, SkillBranch> = {
  berserker: {
    id: 'berserker', name: 'Berserker', description: 'Sustain through bloodlust and rage',
    playerClass: 'warrior', color: 0xcc3333,
    nodes: [
      { id: 'berserker_t1', tier: 1, branch: 'berserker', name: 'Vitality', description: '+40 max HP',
        passive: [{ stat: 'maxHp', value: 40, mode: 'add' }] },
      { id: 'berserker_t2', tier: 2, branch: 'berserker', name: 'Bloodlust', description: 'Each hit gives +2 HP/s regen for 20s (stacks, resets on hit)',
        special: [{ type: 'bloodlust_stack', value: 2 }] },
      { id: 'berserker_t3', tier: 3, branch: 'berserker', name: 'Ferocity', description: '+15% crit chance',
        passive: [{ stat: 'critChance', value: 0.15, mode: 'add' }] },
      { id: 'berserker_t4', tier: 4, branch: 'berserker', name: 'Savage Blows', description: '+40% crit damage',
        passive: [{ stat: 'critDamage', value: 0.40, mode: 'add' }] },
      { id: 'berserker_t5', tier: 5, branch: 'berserker', name: 'Warcry Rage', description: 'Red aura: +100 speed, 70% DR, 100 HP/s regen for 45s',
        active: { abilityId: 'warcry_rage', name: 'Warcry Rage', description: '+100 speed, 70% DR, 100 HP/s for 45s', cooldown: 90,
          params: { type: 'warcry_rage', speedBoost: 100, damageResistance: 0.70, hpRegen: 100, duration: 45 } } },
      { id: 'berserker_t6', tier: 6, branch: 'berserker', name: 'Iron Hide', description: '+10% defense',
        passive: [{ stat: 'defensePercent', value: 0.10, mode: 'add' }] },
      { id: 'berserker_t7', tier: 7, branch: 'berserker', name: 'Raw Power', description: '+40 flat damage',
        passive: [{ stat: 'flatDamage', value: 40, mode: 'add' }] },
      { id: 'berserker_t8', tier: 8, branch: 'berserker', name: 'Eternal Rage', description: 'Warcry Rage duration +20s',
        combatMod: { type: 'warcry_extension', value: 20 } },
      { id: 'berserker_t9', tier: 9, branch: 'berserker', name: 'Battle Focus', description: '-20% ability cooldowns',
        passive: [{ stat: 'cooldownReduction', value: 0.20, mode: 'add' }] },
      { id: 'berserker_t10', tier: 10, branch: 'berserker', name: "Titan's Reach", description: 'Double melee attack range',
        combatMod: { type: 'double_range', value: 2 } },
    ],
  },
  guardian: {
    id: 'guardian', name: 'Guardian', description: 'Tanking and damage reflection',
    playerClass: 'warrior', color: 0x3377cc,
    nodes: [
      { id: 'guardian_t1', tier: 1, branch: 'guardian', name: 'Fortress', description: '+50 max HP',
        passive: [{ stat: 'maxHp', value: 50, mode: 'add' }] },
      { id: 'guardian_t2', tier: 2, branch: 'guardian', name: 'Retaliation', description: 'Enemies take 35% of raw damage dealt to you',
        special: [{ type: 'thorns_percent', value: 0.35 }] },
      { id: 'guardian_t3', tier: 3, branch: 'guardian', name: 'Armor Mastery', description: '+10% defense',
        passive: [{ stat: 'defensePercent', value: 0.10, mode: 'add' }] },
      { id: 'guardian_t4', tier: 4, branch: 'guardian', name: 'Swift Guard', description: '+20 movement speed',
        passive: [{ stat: 'flatSpeed', value: 20, mode: 'add' }] },
      { id: 'guardian_t5', tier: 5, branch: 'guardian', name: 'Unbreakable Charge', description: 'Taunt 500px, 100% DR, store damage for 10s then release 200% AOE',
        active: { abilityId: 'unbreakable_charge', name: 'Unbreakable Charge', description: 'Taunt + store damage, release 200% AOE', cooldown: 120,
          params: { type: 'unbreakable_charge', tauntRadius: 500, damageReduction: 1.0, chargeDuration: 10, damageMultiplier: 2.0 } } },
      { id: 'guardian_t6', tier: 6, branch: 'guardian', name: 'Steel Wall', description: '+20% defense',
        passive: [{ stat: 'defensePercent', value: 0.20, mode: 'add' }] },
      { id: 'guardian_t7', tier: 7, branch: 'guardian', name: 'Guardian Strike', description: '+20 flat damage',
        passive: [{ stat: 'flatDamage', value: 20, mode: 'add' }] },
      { id: 'guardian_t8', tier: 8, branch: 'guardian', name: 'Regeneration', description: '+5 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 5, mode: 'add' }] },
      { id: 'guardian_t9', tier: 9, branch: 'guardian', name: 'Vigilance', description: '-10% ability cooldowns',
        passive: [{ stat: 'cooldownReduction', value: 0.10, mode: 'add' }] },
      { id: 'guardian_t10', tier: 10, branch: 'guardian', name: 'Aegis Shield', description: 'Shield blocks all damage, recharges after 30s or 10 kills',
        combatMod: { type: 'aegis_shield', value: 1, params: { rechargeSec: 30, rechargeKills: 10 } } },
    ],
  },
  blood_knight: {
    id: 'blood_knight', name: 'Blood Knight', description: 'Lifesteal and blood magic',
    playerClass: 'warrior', color: 0x882233,
    nodes: [
      { id: 'blood_knight_t1', tier: 1, branch: 'blood_knight', name: 'Blood Blade', description: '+50 flat damage',
        passive: [{ stat: 'flatDamage', value: 50, mode: 'add' }] },
      { id: 'blood_knight_t2', tier: 2, branch: 'blood_knight', name: 'Armor Break', description: 'Attacks reduce enemy defense',
        special: [{ type: 'armor_break', value: 0.20 }] },
      { id: 'blood_knight_t3', tier: 3, branch: 'blood_knight', name: 'Vitae', description: '+5 HP/s regen',
        passive: [{ stat: 'hpRegen', value: 5, mode: 'add' }] },
      { id: 'blood_knight_t4', tier: 4, branch: 'blood_knight', name: 'Blood Thorns', description: 'Enemies take 20% of their damage back',
        special: [{ type: 'thorns_percent', value: 0.20 }] },
      { id: 'blood_knight_t5', tier: 5, branch: 'blood_knight', name: 'Blood Drain', description: 'Drain HP from enemies in 150px area for 30s',
        active: { abilityId: 'blood_drain', name: 'Blood Drain', description: 'Drain enemy HP as healing for 30s', cooldown: 60,
          params: { type: 'blood_drain', radius: 150, duration: 30, drainPercent: 0.15 } } },
      { id: 'blood_knight_t6', tier: 6, branch: 'blood_knight', name: 'Swiftness', description: '+20 movement speed',
        passive: [{ stat: 'flatSpeed', value: 20, mode: 'add' }] },
      { id: 'blood_knight_t7', tier: 7, branch: 'blood_knight', name: 'Crimson Edge', description: '+20 flat damage',
        passive: [{ stat: 'flatDamage', value: 20, mode: 'add' }] },
      { id: 'blood_knight_t8', tier: 8, branch: 'blood_knight', name: 'Blood Pool', description: '+30 max HP',
        passive: [{ stat: 'maxHp', value: 30, mode: 'add' }] },
      { id: 'blood_knight_t9', tier: 9, branch: 'blood_knight', name: 'Crimson Thorns', description: '+30% thorns (total 50%)',
        special: [{ type: 'thorns_percent', value: 0.30 }] },
      { id: 'blood_knight_t10', tier: 10, branch: 'blood_knight', name: 'Blood Arc', description: 'Every 3rd attack fires a penetrating blood projectile, heals 30%',
        combatMod: { type: 'blood_arc', value: 3, params: { healPercent: 0.30 } } },
    ],
  },
  templar: {
    id: 'templar', name: 'Templar', description: 'Coming soon...',
    playerClass: 'warrior', color: 0xccaa44,
    nodes: [],
  },
  slayer: {
    id: 'slayer', name: 'Slayer', description: 'Coming soon...',
    playerClass: 'warrior', color: 0x993333,
    nodes: [],
  },
};
