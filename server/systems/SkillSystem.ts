import { World } from '@shared/ecs/World';
import {
  C,
  HealthComponent,
  DefenseComponent,
  SpeedComponent,
  SkillCooldownsComponent,
  ActiveBuffsComponent,
  BurnDotComponent,
  SlowEffectComponent,
  PoisonDotComponent,
  StunEffectComponent,
  ShadowDrainComponent,
  ArcaneMarkComponent,
  NatureBlessingComponent,
  FactionComponent,
  PositionComponent,
  VelocityComponent,
  FreezeComponent,
  RootComponent,
  FearComponent,
  DamageMarkComponent,
  ShieldAbsorbComponent,
  StealthComponent,
  ChannelComponent,
  TransformComponent,
  GuardComponent,
  AttackCooldownComponent,
  FacingComponent,
  KnockbackReceiverComponent,
  PlayerInputComponent,
  EnemyStatsComponent,
  PersistentZoneComponent,
  SummonOwnerComponent,
  MeteorShowerComponent,
} from '@shared/components';
import {
  type SkillAllocation,
  type SkillBuffs,
  type SkillActiveAbility,
  type SkillNodeId,
  emptyAllocation,
  emptySkillBuffs,
  canAllocate,
  computeSkillBuffs,
  getActiveAbilities,
  getUnlockedAbilities,
  getNode,
  SKILL_BRANCHES,
} from '@shared/definitions/SkillDefinitions';
import type { PlayerClass } from '@shared/definitions/ClassDefinitions';
import { CLASS_STATS } from '@shared/definitions/ClassDefinitions';
import { MessageType } from '@shared/protocol';
import type { SkillStateMessage, AbilityUseMessage, AbilityEffectMessage } from '@shared/protocol';
import type { ConnectedClient } from '../net/ServerSocket';
import type { SessionPlayer } from '../core/GameSession';
import type { WorldGenerator } from '@shared/world/WorldGenerator';
import { executeAbility, type AbilityResult } from '../abilities/AbilityExecutor';
import type { HitResult } from './CombatSystem';

type SendFn = (client: ConnectedClient, msg: object) => void;

export interface SkillSystemDeps {
  world: World;
  players: Map<string, SessionPlayer>;
  generator: WorldGenerator;
  /** Returns card-based maxHp bonus and penalty for a player. */
  getCardMaxHpMod?: (clientId: string) => number;
}

// ── Class passive constants ─────────────────────────────────────────────────
const LAST_STAND_THRESHOLD = 0.25;
const LAST_STAND_DEFENSE_PERCENT = 0.30;
const HUNTERS_FOCUS_DELAY = 1.0; // seconds stationary before crit buff
const HUNTERS_FOCUS_CRIT = 0.15;

export function createSkillSystem(deps: SkillSystemDeps) {
  const allocations = new Map<string, SkillAllocation>();
  const buffCache = new Map<string, SkillBuffs>();

  // ── Class passive tracking state ────────────────────────────────────────
  // Ranger: Hunter's Focus - track last known positions and stationary timers
  const rangerLastPos = new Map<string, { x: number; y: number }>();
  const rangerStationaryTimer = new Map<string, number>();

  function getAllocation(clientId: string): SkillAllocation {
    let a = allocations.get(clientId);
    if (!a) { a = emptyAllocation(); allocations.set(clientId, a); }
    return a;
  }

  function getSkillBuffs(clientId: string): SkillBuffs {
    return buffCache.get(clientId) ?? emptySkillBuffs();
  }

  function rebuildBuffs(clientId: string): void {
    const alloc = getAllocation(clientId);
    buffCache.set(clientId, computeSkillBuffs(alloc));
  }

  function sendState(clientId: string, send: SendFn): void {
    const player = deps.players.get(clientId);
    if (!player) return;
    const alloc = getAllocation(clientId);
    const entityId = player.entityId;
    const cooldowns: Record<string, number> = {};
    if (entityId != null) {
      const sc = deps.world.getComponent<SkillCooldownsComponent>(entityId, C.SkillCooldowns);
      if (sc) Object.assign(cooldowns, sc.cooldowns);
    }
    const msg: SkillStateMessage = {
      type: MessageType.SKILL_STATE,
      allocated: [...alloc.allocated],
      skillPoints: alloc.skillPoints,
      abilityCooldowns: cooldowns,
      slotAssignments: [...alloc.slotAssignments] as [string | null, string | null, string | null],
    };
    send(player.client, msg);
  }

  function handleAllocate(clientId: string, nodeId: string, send: SendFn): void {
    const player = deps.players.get(clientId);
    if (!player) return;
    const alloc = getAllocation(clientId);
    if (!canAllocate(alloc, nodeId, player.playerClass)) return;

    alloc.allocated.add(nodeId);
    alloc.skillPoints--;
    rebuildBuffs(clientId);

    // Apply stat changes to entity
    applyPassivesToEntity(clientId);

    // If tier-5 capstone, init cooldown component and auto-assign to first empty slot
    const node = getNode(nodeId);
    if (node?.active && player.entityId != null) {
      let sc = deps.world.getComponent<SkillCooldownsComponent>(player.entityId, C.SkillCooldowns);
      if (!sc) {
        sc = { cooldowns: {} };
        deps.world.addComponent(player.entityId, C.SkillCooldowns, sc);
      }
      sc.cooldowns[node.active.abilityId] = 0; // Ready immediately

      // Auto-assign to first empty slot if not already assigned
      const aid = node.active.abilityId;
      if (!alloc.slotAssignments.includes(aid)) {
        const emptySlot = alloc.slotAssignments.indexOf(null);
        if (emptySlot !== -1) alloc.slotAssignments[emptySlot] = aid;
      }
    }

    sendState(clientId, send);
  }

  function handleAbilityUse(
    clientId: string,
    msg: AbilityUseMessage,
    send: SendFn,
  ): { hits: HitResult[]; deaths: number[]; projectileSpawns?: AbilityResult['projectileSpawns'] } {
    const player = deps.players.get(clientId);
    if (!player || player.entityId == null) return { hits: [], deaths: [] };

    const alloc = getAllocation(clientId);
    const abilities = getActiveAbilities(alloc);
    const ability = abilities.find((a): a is SkillActiveAbility => a != null && a.abilityId === msg.abilityId);
    if (!ability) return { hits: [], deaths: [] };

    // Check cooldown
    const sc = deps.world.getComponent<SkillCooldownsComponent>(player.entityId, C.SkillCooldowns);
    if (sc && (sc.cooldowns[ability.abilityId] ?? 0) > 0.05) return { hits: [], deaths: [] };

    // Set cooldown (apply cooldown reduction from skill buffs)
    if (sc) {
      const sBuffs = getSkillBuffs(player.client.id);
      const cdReduction = Math.min(sBuffs.cooldownReduction, 0.5); // Cap at 50%
      sc.cooldowns[ability.abilityId] = ability.cooldown * (1 - cdReduction);
    }

    // Execute
    const result = executeAbility(deps.world, player, ability, msg, deps.generator);

    // Broadcast effect to all clients
    for (const p of deps.players.values()) send(p.client, result.effect);

    return { hits: result.hits, deaths: result.deaths, projectileSpawns: result.projectileSpawns };
  }

  function handleSlotAssign(clientId: string, slot: number, abilityId: string | null, send: SendFn): void {
    if (slot < 0 || slot > 2) return;
    const alloc = getAllocation(clientId);

    if (abilityId != null) {
      // Validate ability is actually unlocked
      const unlocked = getUnlockedAbilities(alloc);
      if (!unlocked.some(a => a.abilityId === abilityId)) return;

      // If ability is already in another slot, clear that slot (swap)
      for (let i = 0; i < 3; i++) {
        if (alloc.slotAssignments[i] === abilityId) {
          alloc.slotAssignments[i] = null;
        }
      }
    }

    alloc.slotAssignments[slot] = abilityId;
    sendState(clientId, send);
  }

  function grantSkillPoint(clientId: string, send: SendFn): void {
    const alloc = getAllocation(clientId);
    alloc.skillPoints++;
    sendState(clientId, send);
  }

  // ── Class Passive Logic ─────────────────────────────────────────────────────

  function tickClassPassives(dt: number): void {
    for (const [clientId, player] of deps.players) {
      if (player.entityId == null) continue;
      const eid = player.entityId;
      const cls = player.playerClass;

      switch (cls) {
        case 'warrior': tickWarriorPassive(eid); break;
        case 'ranger': tickRangerPassive(clientId, eid, dt); break;
        // mage: arcane_surge is handled in onKill()
      }
    }
  }

  /** Warrior - Last Stand: +30% defense when HP < 25% */
  function tickWarriorPassive(eid: number): void {
    const hp = deps.world.getComponent<HealthComponent>(eid, C.Health);
    const def = deps.world.getComponent<DefenseComponent>(eid, C.Defense);
    if (!hp || !def) return;

    let ab = deps.world.getComponent<ActiveBuffsComponent>(eid, C.ActiveBuffs);
    const isLowHp = hp.current < hp.max * LAST_STAND_THRESHOLD;
    const hasBuff = ab?.buffs.some(b => b.id === 'last_stand') ?? false;

    if (isLowHp && !hasBuff) {
      if (!ab) {
        ab = { buffs: [] };
        deps.world.addComponent(eid, C.ActiveBuffs, ab);
      }
      ab.buffs.push({
        id: 'last_stand',
        remaining: 9999, // effectively permanent, removed by logic below
        effect: { defensePercent: LAST_STAND_DEFENSE_PERCENT },
      });
    } else if (!isLowHp && hasBuff && ab) {
      // Remove the last_stand buff
      for (let i = ab.buffs.length - 1; i >= 0; i--) {
        if (ab.buffs[i].id === 'last_stand') ab.buffs.splice(i, 1);
      }
    }
  }

  /** Ranger - Hunter's Focus: +15% crit when stationary for 1s */
  function tickRangerPassive(clientId: string, eid: number, dt: number): void {
    const pos = deps.world.getComponent<PositionComponent>(eid, C.Position);
    if (!pos) return;

    const lastPos = rangerLastPos.get(clientId);
    const moved = !lastPos || Math.abs(pos.x - lastPos.x) > 0.5 || Math.abs(pos.y - lastPos.y) > 0.5;
    rangerLastPos.set(clientId, { x: pos.x, y: pos.y });

    if (moved) {
      rangerStationaryTimer.set(clientId, 0);
      // Remove crit buff if present
      const ab = deps.world.getComponent<ActiveBuffsComponent>(eid, C.ActiveBuffs);
      if (ab) {
        for (let i = ab.buffs.length - 1; i >= 0; i--) {
          if (ab.buffs[i].id === 'hunters_focus') ab.buffs.splice(i, 1);
        }
      }
      return;
    }

    const timer = (rangerStationaryTimer.get(clientId) ?? 0) + dt;
    rangerStationaryTimer.set(clientId, timer);

    if (timer >= HUNTERS_FOCUS_DELAY) {
      let ab = deps.world.getComponent<ActiveBuffsComponent>(eid, C.ActiveBuffs);
      const hasBuff = ab?.buffs.some(b => b.id === 'hunters_focus') ?? false;
      if (!hasBuff) {
        if (!ab) {
          ab = { buffs: [] };
          deps.world.addComponent(eid, C.ActiveBuffs, ab);
        }
        ab.buffs.push({
          id: 'hunters_focus',
          remaining: 9999, // removed when player moves
          effect: { critChance: HUNTERS_FOCUS_CRIT },
        });
      }
    }
  }

  /**
   * Mage - Arcane Surge: on kill, reduce all ability cooldowns by 1s.
   * Called externally when an entity scores a kill.
   */
  function onKill(killerEntityId: number): void {
    // Find the player that owns this entity
    for (const [, player] of deps.players) {
      if (player.entityId !== killerEntityId) continue;

      // Mage - Arcane Surge
      if (player.playerClass === 'mage') {
        const sc = deps.world.getComponent<SkillCooldownsComponent>(killerEntityId, C.SkillCooldowns);
        if (sc) {
          for (const key of Object.keys(sc.cooldowns)) {
            sc.cooldowns[key] = Math.max(0, sc.cooldowns[key] - 1.0);
          }
        }
      }

      break;
    }
  }

  // ── New Effect Component Ticking ────────────────────────────────────────────

  function tickNewEffects(dt: number): void {
    // Freeze: immobilize entity completely
    for (const id of deps.world.query(C.Freeze)) {
      const freeze = deps.world.getComponent<FreezeComponent>(id, C.Freeze)!;
      freeze.remaining -= dt;
      const vel = deps.world.getComponent<VelocityComponent>(id, C.Velocity);
      if (vel) { vel.vx = 0; vel.vy = 0; }
      if (freeze.remaining <= 0) deps.world.removeComponent(id, C.Freeze);
    }

    // Root: cannot move but can still attack
    for (const id of deps.world.query(C.Root)) {
      const root = deps.world.getComponent<RootComponent>(id, C.Root)!;
      root.remaining -= dt;
      const vel = deps.world.getComponent<VelocityComponent>(id, C.Velocity);
      if (vel) { vel.vx = 0; vel.vy = 0; }
      if (root.remaining <= 0) deps.world.removeComponent(id, C.Root);
    }

    // Fear: flee away from source position
    for (const id of deps.world.query(C.Fear, C.Position)) {
      const fear = deps.world.getComponent<FearComponent>(id, C.Fear)!;
      fear.remaining -= dt;
      if (fear.remaining <= 0) {
        deps.world.removeComponent(id, C.Fear);
        continue;
      }
      const pos = deps.world.getComponent<PositionComponent>(id, C.Position)!;
      const vel = deps.world.getComponent<VelocityComponent>(id, C.Velocity);
      const speed = deps.world.getComponent<SpeedComponent>(id, C.Speed);
      if (vel && speed) {
        const dx = pos.x - fear.sourceX;
        const dy = pos.y - fear.sourceY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const fleeSpeed = speed.base * speed.multiplier;
        vel.vx = (dx / dist) * fleeSpeed;
        vel.vy = (dy / dist) * fleeSpeed;
      }
    }

    // DamageMark: delayed detonation
    for (const id of deps.world.query(C.DamageMark, C.Health)) {
      const mark = deps.world.getComponent<DamageMarkComponent>(id, C.DamageMark)!;
      mark.remaining -= dt;
      if (mark.remaining <= 0) {
        const hp = deps.world.getComponent<HealthComponent>(id, C.Health)!;
        hp.current = Math.max(0, hp.current - mark.damage);
        deps.world.removeComponent(id, C.DamageMark);
      }
    }

    // ShieldAbsorb: timer-based expiry (actual absorption in CombatSystem)
    for (const id of deps.world.query(C.ShieldAbsorb)) {
      const shield = deps.world.getComponent<ShieldAbsorbComponent>(id, C.ShieldAbsorb)!;
      shield.remaining -= dt;
      if (shield.remaining <= 0 || shield.amount <= 0) {
        deps.world.removeComponent(id, C.ShieldAbsorb);
      }
    }

    // Stealth: timer-based expiry (invisibility handled by renderer)
    for (const id of deps.world.query(C.Stealth)) {
      const stealth = deps.world.getComponent<StealthComponent>(id, C.Stealth)!;
      stealth.remaining -= dt;
      if (stealth.remaining <= 0) deps.world.removeComponent(id, C.Stealth);
    }

    // Channel: deal tick damage to enemies in radius each tick
    for (const id of deps.world.query(C.Channel, C.Position)) {
      const channel = deps.world.getComponent<ChannelComponent>(id, C.Channel)!;
      channel.remaining -= dt;
      if (channel.remaining <= 0) {
        deps.world.removeComponent(id, C.Channel);
        continue;
      }
      const pos = deps.world.getComponent<PositionComponent>(id, C.Position)!;
      const radiusSq = channel.radius * channel.radius;
      const dmg = channel.tickDamage * dt;
      for (const eid of deps.world.query(C.Position, C.Health, C.Faction)) {
        if (eid === id) continue;
        const ef = deps.world.getComponent<FactionComponent>(eid, C.Faction);
        if (!ef || ef.type !== 'enemy') continue;
        const ep = deps.world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = ep.x - pos.x, dy = ep.y - pos.y;
        if (dx * dx + dy * dy <= radiusSq) {
          const eh = deps.world.getComponent<HealthComponent>(eid, C.Health)!;
          eh.current = Math.max(0, eh.current - dmg);
        }
      }
    }

    // Transform: timer-based expiry, revert stat changes when done
    for (const id of deps.world.query(C.Transform)) {
      const transform = deps.world.getComponent<TransformComponent>(id, C.Transform)!;
      transform.remaining -= dt;
      if (transform.remaining <= 0) {
        // Revert stat changes
        const speed = deps.world.getComponent<SpeedComponent>(id, C.Speed);
        if (speed) speed.multiplier = Math.max(0.1, speed.multiplier - transform.speedBonus);
        const def = deps.world.getComponent<DefenseComponent>(id, C.Defense);
        if (def) def.flat = Math.max(0, def.flat - transform.defenseBonus);
        deps.world.removeComponent(id, C.Transform);
      }
    }

    // PersistentZone: AOE damage to enemies and heal to allies each tick
    for (const id of deps.world.query(C.PersistentZone)) {
      const zone = deps.world.getComponent<PersistentZoneComponent>(id, C.PersistentZone)!;
      zone.remaining -= dt;
      if (zone.remaining <= 0) {
        deps.world.destroyEntity(id);
        continue;
      }
      const radiusSq = zone.radius * zone.radius;
      for (const eid of deps.world.query(C.Position, C.Health, C.Faction)) {
        const ep = deps.world.getComponent<PositionComponent>(eid, C.Position)!;
        const dx = ep.x - zone.x, dy = ep.y - zone.y;
        if (dx * dx + dy * dy > radiusSq) continue;
        const ef = deps.world.getComponent<FactionComponent>(eid, C.Faction)!;
        const eh = deps.world.getComponent<HealthComponent>(eid, C.Health)!;
        if (ef.type === 'enemy' && zone.dps > 0) {
          eh.current = Math.max(0, eh.current - zone.dps * dt);
        } else if ((ef.type === 'player' || ef.type === 'guard' || ef.type === 'civilian') && zone.healPerSec > 0) {
          eh.current = Math.min(eh.max, eh.current + zone.healPerSec * dt);
        }
      }
    }

    // MeteorShower: spawn individual meteor impacts over time
    for (const id of deps.world.query(C.MeteorShower)) {
      const ms = deps.world.getComponent<MeteorShowerComponent>(id, C.MeteorShower)!;
      ms.remaining -= dt;
      if (ms.remaining <= 0) {
        deps.world.destroyEntity(id);
        continue;
      }
      ms.meteorTimer += dt;
      while (ms.meteorTimer >= ms.meteorInterval) {
        ms.meteorTimer -= ms.meteorInterval;
        // Spawn one meteor impact at a random position within the zone
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * ms.radius;
        const mx = ms.x + Math.cos(angle) * dist;
        const my = ms.y + Math.sin(angle) * dist;
        const impactR2 = ms.impactRadius * ms.impactRadius;
        // Deal damage to all enemies in the impact area
        for (const eid of deps.world.query(C.Position, C.Health, C.Faction)) {
          const ef = deps.world.getComponent<FactionComponent>(eid, C.Faction);
          if (!ef || ef.type === 'player' || ef.type === 'building' || ef.type === 'item' || ef.type === 'guard' || ef.type === 'civilian') continue;
          const ep = deps.world.getComponent<PositionComponent>(eid, C.Position)!;
          const dx = ep.x - mx, dy = ep.y - my;
          if (dx * dx + dy * dy > impactR2) continue;
          const hp = deps.world.getComponent<HealthComponent>(eid, C.Health)!;
          if (hp.current <= 0) continue;
          const def = deps.world.getComponent<DefenseComponent>(eid, C.Defense);
          let dmg = ms.damagePerMeteor;
          if (def) dmg = Math.max(1, Math.round((dmg - def.flat) * (1 - def.percent)));
          hp.current = Math.max(0, hp.current - dmg);
        }
      }
    }

    // SummonOwner: check expiry
    for (const id of deps.world.query(C.SummonOwner)) {
      const summon = deps.world.getComponent<SummonOwnerComponent>(id, C.SummonOwner)!;
      if (Date.now() > summon.expireTime) {
        deps.world.destroyEntity(id);
      }
    }
  }

  function tick(dt: number): void {
    // Tick ability cooldowns
    for (const id of deps.world.query(C.SkillCooldowns)) {
      const sc = deps.world.getComponent<SkillCooldownsComponent>(id, C.SkillCooldowns)!;
      for (const key of Object.keys(sc.cooldowns)) {
        if (sc.cooldowns[key] > 0) sc.cooldowns[key] = Math.max(0, sc.cooldowns[key] - dt);
      }
    }

    // ActiveBuffs are ticked by GameSession.tickActiveBuffs() - do NOT tick here
    // (double decrement was causing buffs to expire at half their intended duration)

    // Tick burn DOT
    for (const id of deps.world.query(C.BurnDot, C.Health)) {
      const burn = deps.world.getComponent<BurnDotComponent>(id, C.BurnDot)!;
      const hp = deps.world.getComponent<HealthComponent>(id, C.Health)!;
      burn.remaining -= dt;
      const burnDmg = burn.dps * dt;
      hp.current = Math.max(0, hp.current - burnDmg);

      // Burn lifesteal: heal the burn source if their owner has the burn_lifesteal combat mod
      if (burn.sourceId != null) {
        for (const [, player] of deps.players) {
          if (player.entityId !== burn.sourceId) continue;
          const playerBuffs = getSkillBuffs(player.client.id);
          const burnLifestealMod = playerBuffs.combatMods.find(m => m.type === 'burn_lifesteal');
          if (burnLifestealMod) {
            const srcHp = deps.world.getComponent<HealthComponent>(burn.sourceId, C.Health);
            if (srcHp) srcHp.current = Math.min(srcHp.max, srcHp.current + burnDmg * burnLifestealMod.value);
          }
          break;
        }
      }

      if (burn.remaining <= 0) deps.world.removeComponent(id, C.BurnDot);
    }

    // Tick slow effects
    for (const id of deps.world.query(C.SlowEffect)) {
      const slow = deps.world.getComponent<SlowEffectComponent>(id, C.SlowEffect)!;
      slow.remaining -= dt;
      if (slow.remaining <= 0) {
        deps.world.removeComponent(id, C.SlowEffect);
        // Restore speed
        const speed = deps.world.getComponent<SpeedComponent>(id, C.Speed);
        if (speed) speed.multiplier = Math.min(speed.multiplier / (1 - slow.factor), 2);
      }
    }

    // Tick poison DOT
    for (const id of deps.world.query(C.PoisonDot, C.Health)) {
      const poison = deps.world.getComponent<PoisonDotComponent>(id, C.PoisonDot)!;
      const hp = deps.world.getComponent<HealthComponent>(id, C.Health)!;
      poison.remaining -= dt;
      hp.current = Math.max(0, hp.current - poison.dps * dt);
      if (poison.remaining <= 0) deps.world.removeComponent(id, C.PoisonDot);
    }

    // Tick stun effects
    for (const id of deps.world.query(C.StunEffect)) {
      const stun = deps.world.getComponent<StunEffectComponent>(id, C.StunEffect)!;
      stun.remaining -= dt;
      if (stun.remaining <= 0) deps.world.removeComponent(id, C.StunEffect);
    }

    // Tick shadow drain (damage target, heal source)
    for (const id of deps.world.query(C.ShadowDrain, C.Health)) {
      const drain = deps.world.getComponent<ShadowDrainComponent>(id, C.ShadowDrain)!;
      const hp = deps.world.getComponent<HealthComponent>(id, C.Health)!;
      drain.remaining -= dt;
      const dmg = drain.dps * dt;
      hp.current = Math.max(0, hp.current - dmg);
      // Heal the source entity
      const srcHp = deps.world.getComponent<HealthComponent>(drain.sourceId, C.Health);
      if (srcHp) srcHp.current = Math.min(srcHp.max, srcHp.current + dmg);
      if (drain.remaining <= 0) deps.world.removeComponent(id, C.ShadowDrain);
    }

    // Tick arcane mark (expires naturally)
    for (const id of deps.world.query(C.ArcaneMark)) {
      const arcane = deps.world.getComponent<ArcaneMarkComponent>(id, C.ArcaneMark)!;
      arcane.remaining -= dt;
      if (arcane.remaining <= 0) deps.world.removeComponent(id, C.ArcaneMark);
    }

    // Tick nature blessing (heal nearby allies)
    for (const id of deps.world.query(C.NatureBlessing)) {
      const nature = deps.world.getComponent<NatureBlessingComponent>(id, C.NatureBlessing)!;
      nature.remaining -= dt;
      if (nature.remaining <= 0) { deps.world.removeComponent(id, C.NatureBlessing); continue; }
      // Heal nearby player entities
      const pos = deps.world.getComponent<PositionComponent>(id, C.Position);
      if (!pos) continue;
      for (const pid of deps.world.query(C.Position, C.Health, C.Faction)) {
        const pf = deps.world.getComponent<FactionComponent>(pid, C.Faction);
        if (pf?.type !== 'player') continue;
        const pp = deps.world.getComponent<PositionComponent>(pid, C.Position)!;
        const dx = pp.x - pos.x, dy = pp.y - pos.y;
        if (dx * dx + dy * dy <= nature.radius * nature.radius) {
          const ph = deps.world.getComponent<HealthComponent>(pid, C.Health)!;
          ph.current = Math.min(ph.max, ph.current + nature.healPerSecond * dt);
        }
      }
    }

    // Holy mark expires naturally (bonus damage applied in CombatSystem)
    for (const id of deps.world.query(C.HolyMark)) {
      const holy = deps.world.getComponent<import('@shared/components').HolyMarkComponent>(id, C.HolyMark)!;
      holy.remaining -= dt;
      if (holy.remaining <= 0) deps.world.removeComponent(id, C.HolyMark);
    }

    // Tick new ability-system effects (Freeze, Root, Fear, etc.)
    tickNewEffects(dt);

    // Tick class passive abilities (Last Stand, Hunter's Focus, etc.)
    tickClassPassives(dt);

    // ── Permanent Wolf Companion management ──────────────────────────────────
    // Beastmaster tier 2 spawns a permanent wolf. Tier 4/7/9/10 upgrade it.
    tickWolfCompanions(dt);
  }

  // Track permanent wolf entity per player
  const permanentWolves = new Map<string, number>(); // clientId -> wolfEntityId

  function tickWolfCompanions(dt: number): void {
    for (const [clientId, player] of deps.players) {
      if (player.entityId == null) continue;
      const sBuffs = getSkillBuffs(clientId);
      // Check if player has wolf_upgrade combat mod (tier 2 grants value=1)
      const wolfMod = sBuffs.combatMods.find(m => m.type === 'wolf_upgrade' && m.value === 1);
      if (!wolfMod) {
        // No wolf mod - remove existing wolf if any
        const existingWolf = permanentWolves.get(clientId);
        if (existingWolf != null && deps.world.hasEntity(existingWolf)) {
          const hp = deps.world.getComponent<HealthComponent>(existingWolf, C.Health);
          if (hp) hp.current = 0; // Kill it, death sweep cleans up
        }
        permanentWolves.delete(clientId);
        continue;
      }

      const existingWolf = permanentWolves.get(clientId);
      const wolfAlive = existingWolf != null && deps.world.hasEntity(existingWolf)
        && (deps.world.getComponent<HealthComponent>(existingWolf, C.Health)?.current ?? 0) > 0;

      // Spawn wolf if none exists
      if (!wolfAlive) {
        const pos = deps.world.getComponent<PositionComponent>(player.entityId, C.Position);
        if (!pos) continue;

        // Base wolf stats
        let wolfHp = (wolfMod as any).params?.wolfHp ?? 50;
        let wolfDmg = (wolfMod as any).params?.wolfDamage ?? 8;

        // Tier 4: Pack Strength - +50% HP and damage
        const packStrength = sBuffs.combatMods.find(m => m.type === 'wolf_upgrade' && m.value === 2);
        if (packStrength) {
          wolfHp = Math.round(wolfHp * ((packStrength as any).params?.wolfHpMult ?? 1.5));
          wolfDmg = Math.round(wolfDmg * ((packStrength as any).params?.wolfDamageMult ?? 1.5));
        }

        // Tier 10: Alpha Predator - 2x damage
        const alpha = sBuffs.combatMods.find(m => m.type === 'alpha_predator');
        if (alpha) wolfDmg *= 2;

        const angle = Math.random() * Math.PI * 2;
        const spawnDist = 40;
        const wolfId = deps.world.createEntity();
        deps.world.addComponent(wolfId, C.Position, { x: pos.x + Math.cos(angle) * spawnDist, y: pos.y + Math.sin(angle) * spawnDist });
        deps.world.addComponent(wolfId, C.Velocity, { vx: 0, vy: 0 });
        deps.world.addComponent(wolfId, C.Health, { current: wolfHp, max: wolfHp });
        deps.world.addComponent(wolfId, C.Faction, { type: 'guard' });
        deps.world.addComponent(wolfId, C.Speed, { base: 180, multiplier: 1 });
        deps.world.addComponent(wolfId, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
        deps.world.addComponent(wolfId, C.Facing, { angle: 0 });
        deps.world.addComponent(wolfId, C.AttackCooldown, { remaining: 0, max: 1.0 });
        deps.world.addComponent(wolfId, C.KnockbackReceiver, { vx: 0, vy: 0 });
        deps.world.addComponent(wolfId, C.EnemyStats, {
          damage: wolfDmg, range: 30, knockback: 50, radius: 10,
          rangedRange: 0, projectileSpeed: 0, rangedDamage: 0, rangedCooldown: 0,
        });
        deps.world.addComponent(wolfId, C.Guard, {
          barracksId: player.entityId,
          patrolRadius: 150,
          followEntityId: player.entityId,
          variant: 'wolf',
        } as GuardComponent);

        permanentWolves.set(clientId, wolfId);
        continue;
      }

      // ── Wolf buff ticks ──────────────────────────────────────────────
      const wolfId = existingWolf!;

      // Tier 7: Nature's Bond - wolf heals 5 HP/s when near player
      const wolfHealMod = sBuffs.combatMods.find(m => m.type === 'wolf_heal');
      if (wolfHealMod) {
        const wolfPos = deps.world.getComponent<PositionComponent>(wolfId, C.Position);
        const playerPos = deps.world.getComponent<PositionComponent>(player.entityId, C.Position);
        if (wolfPos && playerPos) {
          const dx = wolfPos.x - playerPos.x, dy = wolfPos.y - playerPos.y;
          if (dx * dx + dy * dy <= 200 * 200) { // Within 200px
            const wolfHp = deps.world.getComponent<HealthComponent>(wolfId, C.Health);
            if (wolfHp) wolfHp.current = Math.min(wolfHp.max, wolfHp.current + wolfHealMod.value * dt);
          }
        }
      }

      // Tier 10: Alpha Predator - wolf is invulnerable (clamp HP to max)
      const alphaMod = sBuffs.combatMods.find(m => m.type === 'alpha_predator');
      if (alphaMod) {
        const wolfHp = deps.world.getComponent<HealthComponent>(wolfId, C.Health);
        if (wolfHp) wolfHp.current = wolfHp.max;
      }
    }
  }

  function applyPassivesToEntity(clientId: string): void {
    const player = deps.players.get(clientId);
    if (!player || player.entityId == null) return;
    const buffs = getSkillBuffs(clientId);
    const eid = player.entityId;

    // Defense (flat + percent from skill tree)
    const def = deps.world.getComponent<DefenseComponent>(eid, C.Defense);
    if (def) {
      const baseDef = CLASS_STATS[player.playerClass].defense;
      def.flat = baseDef + buffs.defenseBonus;
      def.percent = buffs.defensePercent;
    }

    // Max HP (class base + skill bonus + card bonus)
    const hp = deps.world.getComponent<HealthComponent>(eid, C.Health);
    if (hp) {
      const baseHp = CLASS_STATS[player.playerClass].hp;
      const cardMod = deps.getCardMaxHpMod?.(clientId) ?? 0;
      const oldMax = hp.max;
      hp.max = Math.max(1, baseHp + buffs.maxHpBonus + cardMod);
      // Heal proportionally if max increased
      if (hp.max > oldMax) hp.current = Math.min(hp.max, hp.current + (hp.max - oldMax));
    }

    // Speed (multiplicative from skill tree + flat bonus)
    const speed = deps.world.getComponent<SpeedComponent>(eid, C.Speed);
    if (speed) {
      speed.multiplier = buffs.speedMultiplier;
      speed.base = CLASS_STATS[player.playerClass].speed + buffs.flatSpeed;
    }
  }

  // ── Save/Load ────────────────────────────────────────────────────────────

  function serialize(clientId: string): { skillNodes: string[]; skillPoints: number; slotAssignments: [string | null, string | null, string | null] } {
    const alloc = getAllocation(clientId);
    return { skillNodes: [...alloc.allocated], skillPoints: alloc.skillPoints, slotAssignments: [...alloc.slotAssignments] as [string | null, string | null, string | null] };
  }

  function restore(clientId: string, skillNodes: string[], skillPoints: number, slotAssignments?: [string | null, string | null, string | null]): void {
    const alloc = getAllocation(clientId);
    alloc.allocated = new Set(skillNodes);
    alloc.skillPoints = skillPoints;
    if (slotAssignments) alloc.slotAssignments = [...slotAssignments] as [string | null, string | null, string | null];
    rebuildBuffs(clientId);
  }

  function reset(): void {
    allocations.clear();
    buffCache.clear();
    rangerLastPos.clear();
    rangerStationaryTimer.clear();
  }

  return {
    getAllocation,
    getSkillBuffs,
    handleAllocate,
    handleSlotAssign,
    handleAbilityUse,
    grantSkillPoint,
    tick,
    applyPassivesToEntity,
    serialize,
    restore,
    reset,
    sendState,
    onKill,
  };
}

export type SkillSystem = ReturnType<typeof createSkillSystem>;
