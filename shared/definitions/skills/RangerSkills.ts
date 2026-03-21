/**
 * Ranger skill branches: Sharpshooter, Beastmaster, Trapper, Shadow Hunter (placeholder), Windwalker (placeholder).
 *
 * Sharpshooter: Poison arrows + crit scaling. Sniper Shot charges then fires massive arrow.
 * Beastmaster: Permanent wolf companion + Pack Call (summon temp wolves). Wolf upgrades through tree.
 * Trapper: Multi-shot, explosive barrage, poison tips, slow on hit.
 */

import type { SkillBranch } from '../SkillDefinitions';

export const RANGER_BRANCHES: Record<string, SkillBranch> = {
  sharpshooter: {
    id: 'sharpshooter', name: 'Sharpshooter', description: 'Poison and critical strikes',
    playerClass: 'ranger', color: 0x33aa55,
    nodes: [
      { id: 'sharpshooter_t1', tier: 1, branch: 'sharpshooter', name: 'Eagle Eye', description: '+15% crit chance',
        passive: [{ stat: 'critChance', value: 0.15, mode: 'add' }] },
      { id: 'sharpshooter_t2', tier: 2, branch: 'sharpshooter', name: 'Poison Arrows', description: 'Arrows apply poison (4 DPS for 5s), projectiles turn green',
        special: [{ type: 'poison_dot', value: 4 }] },
      { id: 'sharpshooter_t3', tier: 3, branch: 'sharpshooter', name: 'Steady Aim', description: '+20% damage',
        passive: [{ stat: 'damage', value: 0.20, mode: 'multiply' }] },
      { id: 'sharpshooter_t4', tier: 4, branch: 'sharpshooter', name: 'Toxic Spread', description: 'Poisoned enemies spread poison to nearby enemies on death (100px)',
        combatMod: { type: 'toxic_spread', value: 100, params: { radius: 100, poisonDps: 4, poisonDuration: 5 } } },
      { id: 'sharpshooter_t5', tier: 5, branch: 'sharpshooter', name: 'Sniper Shot', description: 'Fire a massive piercing arrow dealing 150 damage through all enemies. 30s CD',
        active: { abilityId: 'sniper_shot', name: 'Sniper Shot', description: 'Fire massive piercing arrow (150 dmg, pierces all)', cooldown: 30,
          params: { type: 'sniper_shot', damage: 150 } } },
      { id: 'sharpshooter_t6', tier: 6, branch: 'sharpshooter', name: 'Quick Draw', description: '+20% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.20, mode: 'add' }] },
      { id: 'sharpshooter_t7', tier: 7, branch: 'sharpshooter', name: 'Lethal Precision', description: '+30% crit damage',
        passive: [{ stat: 'critDamage', value: 0.30, mode: 'add' }] },
      { id: 'sharpshooter_t8', tier: 8, branch: 'sharpshooter', name: 'Longbow Mastery', description: '+30 flat damage',
        passive: [{ stat: 'flatDamage', value: 30, mode: 'add' }] },
      { id: 'sharpshooter_t9', tier: 9, branch: 'sharpshooter', name: 'Focus', description: '-20% ability cooldowns',
        passive: [{ stat: 'cooldownReduction', value: 0.20, mode: 'add' }] },
      { id: 'sharpshooter_t10', tier: 10, branch: 'sharpshooter', name: 'Headshot', description: 'Crits deal 3x damage and explode on impact (100px AOE)',
        combatMod: { type: 'headshot_explosion', value: 3.0, params: { radius: 100 } } },
    ],
  },
  beastmaster: {
    id: 'beastmaster', name: 'Beastmaster', description: 'Wolf companion and nature',
    playerClass: 'ranger', color: 0x88774d,
    nodes: [
      { id: 'beastmaster_t1', tier: 1, branch: 'beastmaster', name: 'Thick Skin', description: '+30 max HP',
        passive: [{ stat: 'maxHp', value: 30, mode: 'add' }] },
      { id: 'beastmaster_t2', tier: 2, branch: 'beastmaster', name: 'Wolf Companion', description: 'Summon a permanent wolf (50 HP, 8 dmg) that follows you and attacks enemies',
        combatMod: { type: 'wolf_upgrade', value: 1, params: { wolfHp: 50, wolfDamage: 8 } } },
      { id: 'beastmaster_t3', tier: 3, branch: 'beastmaster', name: 'Feral Strength', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'beastmaster_t4', tier: 4, branch: 'beastmaster', name: 'Pack Strength', description: 'Wolf gets +50% HP and damage',
        combatMod: { type: 'wolf_upgrade', value: 2, params: { wolfHpMult: 1.5, wolfDamageMult: 1.5 } } },
      { id: 'beastmaster_t5', tier: 5, branch: 'beastmaster', name: 'Pack Call', description: 'Summon 3 temporary wolves for 20s. 45s CD',
        active: { abilityId: 'pack_call', name: 'Pack Call', description: 'Summon 3 wolves for 20s', cooldown: 45,
          params: { type: 'pack_call', wolfCount: 3, wolfHp: 50, wolfDamage: 8, duration: 20 } } },
      { id: 'beastmaster_t6', tier: 6, branch: 'beastmaster', name: 'Swift Paws', description: '+20 movement speed',
        passive: [{ stat: 'flatSpeed', value: 20, mode: 'add' }] },
      { id: 'beastmaster_t7', tier: 7, branch: 'beastmaster', name: "Nature's Bond", description: 'Wolf heals 5 HP/s when near player',
        combatMod: { type: 'wolf_heal', value: 5 } },
      { id: 'beastmaster_t8', tier: 8, branch: 'beastmaster', name: 'Wild Heart', description: '+30 max HP',
        passive: [{ stat: 'maxHp', value: 30, mode: 'add' }] },
      { id: 'beastmaster_t9', tier: 9, branch: 'beastmaster', name: 'Venomous Bite', description: 'Wolf attacks apply poison (3 DPS for 10s)',
        combatMod: { type: 'wolf_poison', value: 3, params: { duration: 10 } } },
      { id: 'beastmaster_t10', tier: 10, branch: 'beastmaster', name: 'Alpha Predator', description: 'Permanent wolf is invulnerable + 2x damage. Player +20% damage while wolf alive',
        combatMod: { type: 'alpha_predator', value: 0.20 } },
    ],
  },
  trapper: {
    id: 'trapper', name: 'Trapper', description: 'Multi-shot, explosives and control',
    playerClass: 'ranger', color: 0x55bbdd,
    nodes: [
      { id: 'trapper_t1', tier: 1, branch: 'trapper', name: 'Fleet Foot', description: '+10% movement speed',
        passive: [{ stat: 'speed', value: 0.10, mode: 'multiply' }] },
      { id: 'trapper_t2', tier: 2, branch: 'trapper', name: 'Poison Tips', description: 'Arrows apply poison on hit (5 DPS for 3s)',
        special: [{ type: 'poison_dot', value: 5 }] },
      { id: 'trapper_t3', tier: 3, branch: 'trapper', name: 'Sharpened Tips', description: '+15% damage',
        passive: [{ stat: 'damage', value: 0.15, mode: 'multiply' }] },
      { id: 'trapper_t4', tier: 4, branch: 'trapper', name: 'Wind Runner', description: '+20% movement speed',
        passive: [{ stat: 'speed', value: 0.20, mode: 'multiply' }] },
      { id: 'trapper_t5', tier: 5, branch: 'trapper', name: 'Explosive Barrage', description: 'Fire 5 explosive arrows in a spread, each exploding for 80 dmg in 60px. 25s CD',
        active: { abilityId: 'explosive_barrage', name: 'Explosive Barrage', description: 'Fire 5 explosive arrows', cooldown: 25,
          params: { type: 'explosive_barrage', arrowCount: 5, damagePerArrow: 80, explosionRadius: 60, duration: 2 } } },
      { id: 'trapper_t6', tier: 6, branch: 'trapper', name: 'Survivalist', description: '+30 max HP',
        passive: [{ stat: 'maxHp', value: 30, mode: 'add' }] },
      { id: 'trapper_t7', tier: 7, branch: 'trapper', name: 'Rapid Fire', description: '+25% attack speed',
        passive: [{ stat: 'attackSpeed', value: 0.25, mode: 'add' }] },
      { id: 'trapper_t8', tier: 8, branch: 'trapper', name: 'Crippling Arrows', description: '30% chance to slow enemies by 30% for 5s',
        combatMod: { type: 'crippling_slow', value: 0.30, params: { slowPercent: 0.30, duration: 5 } } },
      { id: 'trapper_t9', tier: 9, branch: 'trapper', name: 'Efficiency', description: '-15% ability cooldowns',
        passive: [{ stat: 'cooldownReduction', value: 0.15, mode: 'add' }] },
      { id: 'trapper_t10', tier: 10, branch: 'trapper', name: 'Multi-Shot', description: 'Fire 3 arrows per attack (spread pattern)',
        combatMod: { type: 'multi_shot', value: 3 } },
    ],
  },
  shadow_hunter: {
    id: 'shadow_hunter', name: 'Shadow Hunter', description: 'Stealth and dodge',
    playerClass: 'ranger', color: 0x665588,
    nodes: [],
  },
  windwalker: {
    id: 'windwalker', name: 'Windwalker', description: 'Extreme mobility and evasion',
    playerClass: 'ranger', color: 0x99ccdd,
    nodes: [],
  },
};
