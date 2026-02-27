import { describe, it, expect } from 'vitest';
import { CombatSystem } from './CombatSystem';
import { C } from '@shared/components';
import { createTestWorld, spawnTestEntity } from './__testutil';

/** Helper: create a melee-ready entity at (x, y) with the given faction. */
function spawnCombatant(
  world: ReturnType<typeof createTestWorld>,
  x: number, y: number,
  faction: { type: string; enemyFaction?: string },
  opts?: { hp?: number; buildingType?: string },
) {
  const components: Record<string, unknown> = {
    [C.Position]: { x, y },
    [C.Health]: { current: opts?.hp ?? 100, max: opts?.hp ?? 100 },
    [C.Faction]: faction,
    [C.AttackCooldown]: { remaining: 0, max: 1.0 },
    [C.Facing]: { angle: 0 },
    [C.KnockbackReceiver]: { vx: 0, vy: 0 },
  };
  if (opts?.buildingType) {
    components[C.Building] = { buildingType: opts.buildingType };
  }
  return spawnTestEntity(world, components);
}

describe('CombatSystem', () => {
  const combat = new CombatSystem();

  it('blocks player-on-player friendly fire', () => {
    const world = createTestWorld();
    const src = spawnCombatant(world, 0, 0, { type: 'player' });
    spawnCombatant(world, 10, 0, { type: 'player' });
    const { hits } = combat.processMeleeAttack(world, src, 0); // facing right
    expect(hits).toHaveLength(0);
  });

  it('player hits enemy within range and arc', () => {
    const world = createTestWorld();
    const src = spawnCombatant(world, 0, 0, { type: 'player' });
    spawnCombatant(world, 20, 0, { type: 'enemy', enemyFaction: 'bandits' });
    const { hits } = combat.processMeleeAttack(world, src, 0);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('same enemyFaction enemies do NOT damage each other', () => {
    const world = createTestWorld();
    const src = spawnCombatant(world, 0, 0, { type: 'enemy', enemyFaction: 'bandits' });
    spawnCombatant(world, 10, 0, { type: 'enemy', enemyFaction: 'bandits' });
    const { hits } = combat.processMeleeAttack(world, src, 0);
    expect(hits).toHaveLength(0);
  });

  it('different enemyFaction enemies DO damage each other', () => {
    const world = createTestWorld();
    const src = spawnCombatant(world, 0, 0, { type: 'enemy', enemyFaction: 'bandits' });
    spawnCombatant(world, 10, 0, { type: 'enemy', enemyFaction: 'undead' });
    const { hits } = combat.processMeleeAttack(world, src, 0);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('guard hits enemy', () => {
    const world = createTestWorld();
    const src = spawnCombatant(world, 0, 0, { type: 'guard' });
    spawnCombatant(world, 10, 0, { type: 'enemy', enemyFaction: 'bandits' });
    const { hits } = combat.processMeleeAttack(world, src, 0);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('enemy does NOT damage portals', () => {
    const world = createTestWorld();
    const src = spawnCombatant(world, 0, 0, { type: 'enemy', enemyFaction: 'bandits' });
    spawnCombatant(world, 10, 0, { type: 'portal' });
    const { hits } = combat.processMeleeAttack(world, src, 0);
    expect(hits).toHaveLength(0);
  });

  it('enemy does NOT damage bridge buildings', () => {
    const world = createTestWorld();
    const src = spawnCombatant(world, 0, 0, { type: 'enemy', enemyFaction: 'bandits' });
    spawnCombatant(world, 10, 0, { type: 'building' }, { buildingType: 'bridge' });
    const { hits } = combat.processMeleeAttack(world, src, 0);
    expect(hits).toHaveLength(0);
  });

  it('respects attack cooldown', () => {
    const world = createTestWorld();
    const src = spawnCombatant(world, 0, 0, { type: 'player' });
    spawnCombatant(world, 10, 0, { type: 'enemy', enemyFaction: 'bandits' });
    // First attack should hit
    const r1 = combat.processMeleeAttack(world, src, 0);
    expect(r1.hits.length).toBeGreaterThan(0);
    // Second attack immediately — should be blocked by cooldown
    const r2 = combat.processMeleeAttack(world, src, 0);
    expect(r2.hits).toHaveLength(0);
  });
});
