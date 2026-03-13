/**
 * Mage skill branches: Fire Mage, Frost Mage, Electric Mage, Earth Mage (placeholder), Void Mage (placeholder).
 *
 * Fire Mage: Burn DOT, explosions, Meteor Shower ability, combustion heal, explosive burn AOE.
 * Frost Mage: Slow/freeze, Blizzard ability, crit bonus on frozen targets, frost shatter AOE.
 * Electric Mage: Chain bouncing projectiles, Thunderwave ability, stun on hit.
 */

import type { SkillBranch } from '../SkillDefinitions';

export const MAGE_BRANCHES: Record<string, SkillBranch> = {
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
          params: { type: 'meteor_shower', radius: 300, duration: 4, meteorCount: 15, damagePerMeteor: 300 } } },
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
