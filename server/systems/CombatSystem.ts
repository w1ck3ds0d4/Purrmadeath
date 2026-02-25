import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  HealthComponent,
  DefenseComponent,
  FactionComponent,
  KnockbackReceiverComponent,
  AttackCooldownComponent,
  BuildingComponent,
  EnemyStatsComponent,
  GhostStateComponent,
  EnemyVariantComponent,
  DodgeRollComponent,
} from '@shared/components';
import { MELEE_RANGE, MELEE_ARC, MELEE_DAMAGE, MELEE_KNOCKBACK, TICK_MS, PLAYER_RADIUS, ENEMY_RADIUS, buildingHalfExtent, CRIT_CHANCE, CRIT_MULTIPLIER, GATHERING_DAMAGE } from '@shared/constants';

export interface HitResult {
  sourceId: number;
  targetId: number;
  damage: number;
  knockbackVx: number;
  knockbackVy: number;
  crit?: boolean;
}

/** Optional per-call overrides for enemy melee (or future weapon variants). */
export interface MeleeOverrides {
  damage?: number;
  range?: number;
  knockback?: number;
  /** If true, attack hits all targets in range (360° AoE, ignores arc check). */
  aoe?: boolean;
}

/**
 * Server-authoritative combat system.
 *
 * processMeleeAttack - called when a player or enemy attacks.
 *   - Enforces AttackCooldown (drops the request if still on cooldown).
 *   - Checks all targets in a 120° arc within range.
 *   - Applies damage (flat + percent Defense reduction) and knockback.
 *   - Returns hit results (for HIT broadcast) and dead entity IDs.
 *
 * update - called each tick to tick down cooldowns.
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

    // Enforce cooldown (one-tick tolerance for client/server timing drift)
    const cd = world.getComponent<AttackCooldownComponent>(sourceId, C.AttackCooldown);
    if (cd && cd.remaining > TICK_MS / 1000) return { hits, deaths };

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

      // No friendly fire: skip same faction (but allow cross-faction enemy combat)
      const tgtFaction = world.getComponent<FactionComponent>(targetId, C.Faction);
      if (srcFaction && tgtFaction && srcFaction.type === tgtFaction.type) {
        // Allow enemies of different factions to damage each other
        if (!(srcFaction.type === 'enemy' && srcFaction.enemyFaction && tgtFaction.enemyFaction
              && srcFaction.enemyFaction !== tgtFaction.enemyFaction)) continue;
      }

      // Skip downed players - they're already at 0 HP
      if (world.hasComponent(targetId, C.Downed)) continue;

      // Dodging entities are invincible
      const dodgeRoll = world.getComponent<DodgeRollComponent>(targetId, C.DodgeRoll);
      if (dodgeRoll && dodgeRoll.timer > 0) continue;

      // Hidden ghosts are untargetable by player/guard melee
      if (srcFaction?.type !== 'enemy') {
        const ghostSt = world.getComponent<GhostStateComponent>(targetId, C.GhostState);
        if (ghostSt?.hidden) continue;
      }

      // Enemies don't attack portals
      if (srcFaction?.type === 'enemy' && tgtFaction?.type === 'portal') continue;

      // Item drops are not damageable
      if (tgtFaction?.type === 'item') continue;
      // Enemies can't damage resource nodes (only players can harvest them)
      if (srcFaction?.type === 'enemy' && tgtFaction?.type === 'resource') continue;

      // Bridges and spike traps are invulnerable to enemy melee
      if (srcFaction?.type === 'enemy' && tgtFaction?.type === 'building') {
        const bldg = world.getComponent<BuildingComponent>(targetId, C.Building);
        if (bldg?.buildingType === 'bridge' || bldg?.buildingType === 'spike_trap') continue;
      }

      // Player attacks don't damage own buildings (no friendly fire on structures)
      if (srcFaction?.type === 'player' && tgtFaction?.type === 'building') continue;

      const tgtPos = world.getComponent<PositionComponent>(targetId, C.Position)!;
      const dx = tgtPos.x - attackX;
      const dy = tgtPos.y - attackY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Account for target size — hit if target edge is within range
      let tgtRadius: number;
      const bldgComp = world.getComponent<BuildingComponent>(targetId, C.Building);
      if (bldgComp) tgtRadius = buildingHalfExtent(bldgComp.buildingType);
      else if (world.getComponent(targetId, C.PlayerIndex)) tgtRadius = PLAYER_RADIUS;
      else {
        const enemyStats = world.getComponent<EnemyStatsComponent>(targetId, C.EnemyStats);
        tgtRadius = enemyStats?.radius ?? ENEMY_RADIUS;
      }
      if (dist > meleeRange + tgtRadius || dist === 0) continue;

      // Arc check - must be within ±60° of facing (skip for buildings and AoE attacks)
      if (!bldgComp && !overrides?.aoe) {
        const angleToTarget = Math.atan2(dy, dx);
        let diff = Math.abs(angleToTarget - facing);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff > halfArc) continue;
      }

      // Damage with defense reduction
      const hp  = world.getComponent<HealthComponent>(targetId, C.Health)!;
      const def = world.getComponent<DefenseComponent>(targetId, C.Defense);
      let dmg: number;
      if (tgtFaction?.type === 'resource') {
        dmg = GATHERING_DAMAGE;
      } else {
        dmg = meleeDamage;
        if (def) dmg = Math.max(0, Math.round((dmg - def.flat) * (1 - def.percent)));
      }

      // Critical hit (players only)
      let crit = false;
      if (srcFaction?.type === 'player' && Math.random() < CRIT_CHANCE) {
        dmg = Math.round(dmg * CRIT_MULTIPLIER);
        crit = true;
      }

      hp.current = Math.max(0, hp.current - dmg);

      // Knockback impulse - direction from attacker to target (giants are immune)
      let knockbackVx = 0;
      let knockbackVy = 0;
      const tgtVariant = world.getComponent<EnemyVariantComponent>(targetId, C.EnemyVariant);
      if (meleeKnockback > 0 && tgtVariant?.variant !== 'giant' && tgtVariant?.variant !== 'titan') {
        knockbackVx = (dx / dist) * meleeKnockback;
        knockbackVy = (dy / dist) * meleeKnockback;
        const kb = world.getComponent<KnockbackReceiverComponent>(targetId, C.KnockbackReceiver);
        if (kb) {
          kb.vx += knockbackVx;
          kb.vy += knockbackVy;
        }
      }

      hits.push({ sourceId, targetId, damage: dmg, knockbackVx, knockbackVy, crit: crit || undefined });
      if (hp.current <= 0) deaths.push(targetId);
    }

    return { hits, deaths };
  }
}
