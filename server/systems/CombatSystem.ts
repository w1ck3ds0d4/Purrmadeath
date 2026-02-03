import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  HealthComponent,
  DefenseComponent,
  FactionComponent,
  KnockbackReceiverComponent,
  AttackCooldownComponent,
} from '@shared/components';
import { MELEE_RANGE, MELEE_ARC, MELEE_DAMAGE, MELEE_KNOCKBACK } from '@shared/constants';

export interface HitResult {
  sourceId: number;
  targetId: number;
  damage: number;
  knockbackVx: number;
  knockbackVy: number;
}

/** Optional per-call overrides for enemy melee (or future weapon variants). */
export interface MeleeOverrides {
  damage?: number;
  range?: number;
  knockback?: number;
}

/**
 * Server-authoritative combat system.
 *
 * processMeleeAttack — called when a player or enemy attacks.
 *   - Enforces AttackCooldown (drops the request if still on cooldown).
 *   - Checks all targets in a 120° arc within range.
 *   - Applies damage (flat + percent Defense reduction) and knockback.
 *   - Returns hit results (for HIT broadcast) and dead entity IDs.
 *
 * update — called each tick to tick down cooldowns.
 */
export class CombatSystem {
  /** Tick down all attack cooldowns. */
  update(world: World, dt: number): void {
    for (const id of world.query(C.AttackCooldown)) {
      const cd = world.getComponent<AttackCooldownComponent>(id, C.AttackCooldown)!;
      if (cd.remaining > 0) cd.remaining = Math.max(0, cd.remaining - dt);
    }
  }

  /**
   * Resolve one melee attack from sourceId toward the given facing angle.
   *
   * @param clientPos  Optional client-predicted attacker position for lag compensation.
   *                   If within MAX_LAG_COMP_DIST of the server position it's used for
   *                   range/arc checks so moving attacks feel accurate. Falls back to
   *                   server position when absent or too far.
   * @param overrides  Optional damage/range/knockback overrides (used by enemy attacks).
   */
  processMeleeAttack(
    world: World,
    sourceId: number,
    facing: number,
    clientPos?: { x: number; y: number },
    overrides?: MeleeOverrides,
  ): { hits: HitResult[]; deaths: number[] } {
    const hits: HitResult[] = [];
    const deaths: number[] = [];

    const meleeRange     = overrides?.range     ?? MELEE_RANGE;
    const meleeDamage    = overrides?.damage    ?? MELEE_DAMAGE;
    const meleeKnockback = overrides?.knockback ?? MELEE_KNOCKBACK;

    // Enforce cooldown
    const cd = world.getComponent<AttackCooldownComponent>(sourceId, C.AttackCooldown);
    if (cd && cd.remaining > 0) return { hits, deaths };

    const srcPos = world.getComponent<PositionComponent>(sourceId, C.Position);
    if (!srcPos) return { hits, deaths };

    // Reset cooldown after swinging
    if (cd) cd.remaining = cd.max;

    // Lag compensation: use client position if it's close enough to server pos
    const MAX_LAG_COMP_DIST = 60; // ~1/3 second of sprinting
    let attackX = srcPos.x;
    let attackY = srcPos.y;
    if (clientPos && Number.isFinite(clientPos.x) && Number.isFinite(clientPos.y)) {
      const cdx = clientPos.x - srcPos.x;
      const cdy = clientPos.y - srcPos.y;
      if (cdx * cdx + cdy * cdy <= MAX_LAG_COMP_DIST * MAX_LAG_COMP_DIST) {
        attackX = clientPos.x;
        attackY = clientPos.y;
      }
    }

    const srcFaction = world.getComponent<FactionComponent>(sourceId, C.Faction);
    const halfArc = MELEE_ARC / 2;

    for (const targetId of world.query(C.Position, C.Health)) {
      if (targetId === sourceId) continue;

      // No friendly fire: skip same faction
      const tgtFaction = world.getComponent<FactionComponent>(targetId, C.Faction);
      if (srcFaction && tgtFaction && srcFaction.type === tgtFaction.type) continue;

      // Enemies don't attack portals
      if (srcFaction?.type === 'enemy' && tgtFaction?.type === 'portal') continue;

      const tgtPos = world.getComponent<PositionComponent>(targetId, C.Position)!;
      const dx = tgtPos.x - attackX;
      const dy = tgtPos.y - attackY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > meleeRange || dist === 0) continue;

      // Arc check — must be within ±60° of facing
      const angleToTarget = Math.atan2(dy, dx);
      let diff = Math.abs(angleToTarget - facing);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff > halfArc) continue;

      // Damage with defense reduction
      const hp  = world.getComponent<HealthComponent>(targetId, C.Health)!;
      const def = world.getComponent<DefenseComponent>(targetId, C.Defense);
      let dmg = meleeDamage;
      if (def) dmg = Math.max(0, Math.round((dmg - def.flat) * (1 - def.percent)));
      hp.current = Math.max(0, hp.current - dmg);

      // Knockback impulse — direction from attacker to target
      let knockbackVx = 0;
      let knockbackVy = 0;
      if (meleeKnockback > 0) {
        knockbackVx = (dx / dist) * meleeKnockback;
        knockbackVy = (dy / dist) * meleeKnockback;
        const kb = world.getComponent<KnockbackReceiverComponent>(targetId, C.KnockbackReceiver);
        if (kb) {
          kb.vx += knockbackVx;
          kb.vy += knockbackVy;
        }
      }

      hits.push({ sourceId, targetId, damage: dmg, knockbackVx, knockbackVy });
      if (hp.current <= 0) deaths.push(targetId);
    }

    return { hits, deaths };
  }
}
