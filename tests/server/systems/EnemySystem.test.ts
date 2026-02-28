import { describe, it, expect } from 'vitest';
import { EnemySystem } from '../../../server/systems/EnemySystem';
import { CombatSystem } from '../../../server/systems/CombatSystem';
import { C } from '@shared/components';
import { TILE_SIZE } from '@shared/constants';
import { createTestWorld, spawnTestEntity, mockGenerator } from './__testutil';

/** Spawn a standard enemy at (x, y). */
function spawnEnemy(
  world: ReturnType<typeof createTestWorld>,
  x: number, y: number,
  opts?: { variant?: string; enemyFaction?: string },
) {
  const components: Record<string, unknown> = {
    [C.Position]: { x, y },
    [C.Velocity]: { vx: 0, vy: 0 },
    [C.Health]: { current: 50, max: 50 },
    [C.Speed]: { base: 100, multiplier: 1 },
    [C.PlayerInput]: { dx: 0, dy: 0, sprint: false },
    [C.Faction]: { type: 'enemy', enemyFaction: opts?.enemyFaction ?? 'bandits' },
    [C.Facing]: { angle: 0 },
    [C.AttackCooldown]: { remaining: 0, max: 1.0 },
    [C.KnockbackReceiver]: { vx: 0, vy: 0 },
    [C.EnemyStats]: { damage: 10, range: 40, knockback: 150, radius: 10, rangedRange: 0, projectileSpeed: 0, rangedDamage: 0, rangedCooldown: 1 },
  };
  if (opts?.variant) {
    components[C.EnemyVariant] = { variant: opts.variant };
  }
  return spawnTestEntity(world, components);
}

/** Spawn a guard at (x, y) with a barracks reference. */
function spawnGuard(
  world: ReturnType<typeof createTestWorld>,
  x: number, y: number,
  barracksId: number,
) {
  return spawnTestEntity(world, {
    [C.Position]: { x, y },
    [C.Velocity]: { vx: 0, vy: 0 },
    [C.Health]: { current: 80, max: 80 },
    [C.Speed]: { base: 100, multiplier: 1 },
    [C.PlayerInput]: { dx: 0, dy: 0, sprint: false },
    [C.Faction]: { type: 'guard' },
    [C.Facing]: { angle: 0 },
    [C.AttackCooldown]: { remaining: 0, max: 1.0 },
    [C.KnockbackReceiver]: { vx: 0, vy: 0 },
    [C.Guard]: { barracksId, patrolRadius: 150 },
    [C.EnemyStats]: { damage: 8, range: 40, knockback: 150, radius: 10, rangedRange: 0, projectileSpeed: 0, rangedDamage: 0, rangedCooldown: 1 },
  });
}

/** Spawn a player at (x, y). */
function spawnPlayer(world: ReturnType<typeof createTestWorld>, x: number, y: number) {
  return spawnTestEntity(world, {
    [C.Position]: { x, y },
    [C.Health]: { current: 100, max: 100 },
    [C.PlayerIndex]: { index: 0, displayName: 'Test' },
    [C.Faction]: { type: 'player' },
  });
}

/** Spawn a campfire building at (x, y). */
function spawnCampfire(world: ReturnType<typeof createTestWorld>, x: number, y: number) {
  return spawnTestEntity(world, {
    [C.Position]: { x, y },
    [C.Health]: { current: 200, max: 200 },
    [C.Faction]: { type: 'building' },
    [C.Building]: { buildingType: 'campfire' },
  });
}

/** Get the movement direction of an entity after an update. */
function getDir(world: ReturnType<typeof createTestWorld>, id: number) {
  const inp = world.getComponent<{ dx: number; dy: number }>(id, C.PlayerInput)!;
  return { dx: inp.dx, dy: inp.dy };
}

describe('EnemySystem', () => {
  const combat = new CombatSystem();
  const gen = mockGenerator();

  function createSystem() {
    return new EnemySystem(combat, gen);
  }

  it('guard targets nearest enemy', () => {
    const world = createTestWorld();
    const system = createSystem();

    // Barracks (reference point for guard)
    const barracks = spawnTestEntity(world, { [C.Position]: { x: 0, y: 0 } });
    const guard = spawnGuard(world, 0, 0, barracks);

    // Near enemy at (80, 0), far enemy at (140, 0)
    spawnEnemy(world, 80, 0);
    spawnEnemy(world, 140, 0);

    system.update(world, 1 / 30);

    const dir = getDir(world, guard);
    // Guard should move toward the nearer enemy (positive X)
    expect(dir.dx).toBeGreaterThan(0);
  });

  it('guard ignores non-enemy factions (players)', () => {
    const world = createTestWorld();
    const system = createSystem();

    const barracks = spawnTestEntity(world, { [C.Position]: { x: 0, y: 0 } });
    const guard = spawnGuard(world, 0, 0, barracks);

    // Player nearby, no enemies
    spawnPlayer(world, 50, 0);

    system.update(world, 1 / 30);

    const dir = getDir(world, guard);
    // Guard should NOT chase the player - should be idle (at barracks)
    expect(dir.dx).toBe(0);
    expect(dir.dy).toBe(0);
  });

  it('standard enemy targets campfire', () => {
    const world = createTestWorld();
    const system = createSystem();

    const enemy = spawnEnemy(world, 0, 0, { variant: 'melee' });
    spawnCampfire(world, 200, 0);

    system.update(world, 1 / 30);

    const dir = getDir(world, enemy);
    // Enemy should move toward campfire (positive X)
    expect(dir.dx).toBeGreaterThan(0);
  });

  it('same-faction enemies ignore each other', () => {
    const world = createTestWorld();
    const system = createSystem();

    // Two bandits near each other, no other targets
    const e1 = spawnEnemy(world, 0, 0, { variant: 'melee', enemyFaction: 'bandits' });
    spawnEnemy(world, 50, 0, { variant: 'melee', enemyFaction: 'bandits' });

    system.update(world, 1 / 30);

    const dir = getDir(world, e1);
    // No target found - should be idle
    expect(dir.dx).toBe(0);
    expect(dir.dy).toBe(0);
  });

  it('cross-faction enemies target each other', () => {
    const world = createTestWorld();
    const system = createSystem();

    const bandit = spawnEnemy(world, 0, 0, { variant: 'melee', enemyFaction: 'bandits' });
    spawnEnemy(world, 60, 0, { variant: 'melee', enemyFaction: 'undead' });

    // Campfire far behind - hostile enemy within distract range should override
    spawnCampfire(world, -200, 0);

    system.update(world, 1 / 30);

    const dir = getDir(world, bandit);
    // Bandit should move toward the undead enemy (positive X), not backward to campfire
    expect(dir.dx).toBeGreaterThan(0);
  });

  it('ghost uses direct beeline (ignores terrain)', () => {
    const world = createTestWorld();
    const system = createSystem();

    const ghost = spawnEnemy(world, 0, 0, { variant: 'ghost' });
    // Ghost needs GhostState component
    world.addComponent(ghost, C.GhostState, { hidden: false });

    spawnPlayer(world, 100, 100);

    system.update(world, 1 / 30);

    const dir = getDir(world, ghost);
    // Ghost should move diagonally toward the player
    expect(dir.dx).toBeGreaterThan(0);
    expect(dir.dy).toBeGreaterThan(0);
  });
});
