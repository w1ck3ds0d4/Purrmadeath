import { describe, it, expect } from 'vitest';
import {
  SKILL_BRANCHES,
  canAllocate,
  getUnlockedAbilities,
  type SkillBranch,
  type SkillAllocation,
} from '../../../shared/definitions/SkillDefinitions';
import { PLAYER_CLASSES, type PlayerClass } from '../../../shared/definitions/ClassDefinitions';

function makeAlloc(overrides?: Partial<SkillAllocation>): SkillAllocation {
  return {
    allocated: new Set<string>(),
    skillPoints: 5,
    slotAssignments: [null, null, null],
    ...overrides,
  };
}

describe('SkillDefinitions structure', () => {
  const allBranches = Object.values(SKILL_BRANCHES) as SkillBranch[];

  it('has 5 branches per class (7 classes = 35 branches)', () => {
    expect(allBranches.length).toBe(35);
    for (const cls of PLAYER_CLASSES) {
      const classBranches = allBranches.filter(b => b.playerClass === cls);
      expect(classBranches).toHaveLength(5);
    }
  });

  it('each branch has exactly 10 nodes (tiers 1-10)', () => {
    for (const branch of allBranches) {
      expect(branch.nodes).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        expect(branch.nodes[i].tier).toBe(i + 1);
      }
    }
  });

  it('all node IDs are globally unique', () => {
    const allIds = allBranches.flatMap(b => b.nodes.map(n => n.id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('node IDs follow branchId_tN pattern', () => {
    for (const branch of allBranches) {
      for (const node of branch.nodes) {
        expect(node.id).toBe(`${branch.id}_t${node.tier}`);
      }
    }
  });

  it('all branches have valid required fields', () => {
    for (const branch of allBranches) {
      expect(branch.id.length).toBeGreaterThan(0);
      expect(branch.name.length).toBeGreaterThan(0);
      expect(branch.description.length).toBeGreaterThan(0);
      expect(typeof branch.color).toBe('number');
      expect(branch.color).toBeGreaterThan(0);
    }
  });

  it('all nodes have name and description', () => {
    for (const branch of allBranches) {
      for (const node of branch.nodes) {
        expect(node.name.length).toBeGreaterThan(0);
        expect(node.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('tier 1-4 nodes have passive or special effects', () => {
    for (const branch of allBranches) {
      for (const node of branch.nodes) {
        if (node.tier < 5) {
          const hasEffect = (node.passive && node.passive.length > 0) ||
                           (node.special && node.special.length > 0);
          expect(hasEffect).toBe(true);
        }
      }
    }
  });

  it('tier 5 (capstone) nodes have active abilities', () => {
    for (const branch of allBranches) {
      const capstone = branch.nodes[4];
      expect(capstone.tier).toBe(5);
      expect(capstone.active).toBeDefined();
      expect(capstone.active!.abilityId.length).toBeGreaterThan(0);
      expect(capstone.active!.name.length).toBeGreaterThan(0);
      expect(capstone.active!.cooldown).toBeGreaterThan(0);
    }
  });

  it('passive effects have valid stat and mode', () => {
    const validStats = ['damage', 'speed', 'maxHp', 'defense', 'critChance', 'attackSpeed', 'hpRegen'];
    for (const branch of allBranches) {
      for (const node of branch.nodes) {
        if (node.passive) {
          for (const p of node.passive) {
            expect(validStats).toContain(p.stat);
            expect(['add', 'multiply']).toContain(p.mode);
            expect(typeof p.value).toBe('number');
          }
        }
      }
    }
  });
});

describe('canAllocate', () => {
  it('allows tier 1 node with skill points', () => {
    const alloc = makeAlloc();
    expect(canAllocate(alloc, 'berserker_t1', 'warrior')).toBe(true);
  });

  it('rejects already allocated node', () => {
    const alloc = makeAlloc({ allocated: new Set(['berserker_t1']) });
    expect(canAllocate(alloc, 'berserker_t1', 'warrior')).toBe(false);
  });

  it('rejects when no skill points', () => {
    const alloc = makeAlloc({ skillPoints: 0 });
    expect(canAllocate(alloc, 'berserker_t1', 'warrior')).toBe(false);
  });

  it('rejects wrong class', () => {
    const alloc = makeAlloc();
    expect(canAllocate(alloc, 'berserker_t1', 'ranger')).toBe(false);
  });

  it('requires prerequisite for tier 2+', () => {
    const alloc = makeAlloc();
    // Tier 2 without tier 1 should fail
    expect(canAllocate(alloc, 'berserker_t2', 'warrior')).toBe(false);

    // With tier 1, tier 2 should succeed
    alloc.allocated.add('berserker_t1');
    expect(canAllocate(alloc, 'berserker_t2', 'warrior')).toBe(true);
  });

  it('requires full chain for capstone', () => {
    const alloc = makeAlloc({ skillPoints: 10 });
    // Can't jump to tier 5
    expect(canAllocate(alloc, 'berserker_t5', 'warrior')).toBe(false);

    // Allocate full chain
    alloc.allocated.add('berserker_t1');
    alloc.allocated.add('berserker_t2');
    alloc.allocated.add('berserker_t3');
    alloc.allocated.add('berserker_t4');
    expect(canAllocate(alloc, 'berserker_t5', 'warrior')).toBe(true);
  });

  it('allows tier 9 and 10 when prerequisites are met', () => {
    const alloc = makeAlloc({ skillPoints: 20 });
    // Allocate tiers 1-8
    for (let t = 1; t <= 8; t++) alloc.allocated.add(`berserker_t${t}`);

    // Tier 9 should be available
    expect(canAllocate(alloc, 'berserker_t9', 'warrior')).toBe(true);

    // Tier 10 should not be available yet
    expect(canAllocate(alloc, 'berserker_t10', 'warrior')).toBe(false);

    // Allocate tier 9
    alloc.allocated.add('berserker_t9');
    expect(canAllocate(alloc, 'berserker_t10', 'warrior')).toBe(true);
  });

  it('allows full 1-10 chain for all branches', () => {
    for (const branch of Object.values(SKILL_BRANCHES)) {
      const alloc = makeAlloc({ skillPoints: 20 });
      for (let t = 1; t <= 10; t++) {
        const nodeId = `${branch.id}_t${t}`;
        expect(canAllocate(alloc, nodeId, branch.playerClass)).toBe(true);
        alloc.allocated.add(nodeId);
      }
    }
  });

  it('returns false for invalid node ID', () => {
    const alloc = makeAlloc();
    expect(canAllocate(alloc, 'nonexistent_t1', 'warrior')).toBe(false);
  });
});

describe('getUnlockedAbilities', () => {
  it('returns empty for no allocations', () => {
    const alloc = makeAlloc();
    expect(getUnlockedAbilities(alloc)).toHaveLength(0);
  });

  it('returns empty when only non-capstone nodes allocated', () => {
    const alloc = makeAlloc({ allocated: new Set(['berserker_t1', 'berserker_t2']) });
    expect(getUnlockedAbilities(alloc)).toHaveLength(0);
  });

  it('returns ability when capstone is allocated', () => {
    const alloc = makeAlloc({
      allocated: new Set(['berserker_t1', 'berserker_t2', 'berserker_t3', 'berserker_t4', 'berserker_t5']),
    });
    const abilities = getUnlockedAbilities(alloc);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].abilityId).toBe('ground_slam');
  });

  it('returns multiple abilities from different branches', () => {
    const alloc = makeAlloc({
      allocated: new Set([
        'berserker_t1', 'berserker_t2', 'berserker_t3', 'berserker_t4', 'berserker_t5',
        'guardian_t1', 'guardian_t2', 'guardian_t3', 'guardian_t4', 'guardian_t5',
      ]),
    });
    const abilities = getUnlockedAbilities(alloc);
    expect(abilities).toHaveLength(2);
    const ids = abilities.map(a => a.abilityId);
    expect(ids).toContain('ground_slam');
    expect(ids).toContain('shield_charge');
  });
});
