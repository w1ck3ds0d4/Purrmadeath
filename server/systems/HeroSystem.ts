import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  HealthComponent,
  GuardComponent,
  TavernComponent,
  HeroComponent,
} from '@shared/components';
import type {
  EnemyStatsComponent, FactionComponent,
} from '@shared/components';
import { MessageType } from '@shared/protocol';
import type { SendFn, SessionPlayer } from '../core/GameSession';
import {
  HERO_DEFINITIONS, HERO_IDS, HERO_LEVEL_SCALING,
} from '@shared/definitions/HeroDefinitions';
import type { HeroDef } from '@shared/definitions/HeroDefinitions';
import {
  GUARD_ATTACK_COOLDOWN, GUARD_MELEE_RANGE, GUARD_MELEE_KNOCKBACK, GUARD_RADIUS,
  BARRACKS_GUARD_PATROL_RADIUS, TAVERN_ROSTER_SIZE,
} from '@shared/constants';
import type { SavedHero } from '@shared/SaveFormat';

export interface HeroSystemDeps {
  world: World;
  players: Map<string, SessionPlayer>;
  warehousePool: Record<string, number>;
  warehouseIds: Set<number>;
  getCampfirePosition: () => { x: number; y: number } | null;
  broadcastWarehouseUpdate: (send: SendFn) => void;
}

export function createHeroSystem(deps: HeroSystemDeps) {
  const { world, players } = deps;
  const activeHeroIds = new Set<number>();

  function wPool(): Record<string, number> { return deps.warehousePool; }

  function getMaxHeroCapacity(): number {
    let total = 0;
    for (const id of world.query(C.Tavern)) {
      const tavern = world.getComponent<TavernComponent>(id, C.Tavern)!;
      total += tavern.maxHeroes;
    }
    return total;
  }

  function spawnHero(heroDef: HeroDef, tavernId: number, tavernLevel: number): number {
    const campPos = deps.getCampfirePosition();
    const sx = (campPos?.x ?? 0) + (Math.random() - 0.5) * 100;
    const sy = (campPos?.y ?? 0) + (Math.random() - 0.5) * 100;

    const scale = HERO_LEVEL_SCALING[Math.min(tavernLevel - 1, HERO_LEVEL_SCALING.length - 1)];
    const hp = Math.round(heroDef.hp * scale);
    const dmg = Math.round(heroDef.damage * scale);

    const id = world.createEntity();
    world.addComponent(id, C.Position, { x: sx, y: sy });
    world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
    world.addComponent(id, C.Health, { current: hp, max: hp });
    world.addComponent(id, C.Speed, { base: heroDef.speed, multiplier: 1 });
    world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
    world.addComponent(id, C.Faction, { type: 'guard' } as FactionComponent);
    world.addComponent(id, C.Facing, { angle: 0 });
    world.addComponent(id, C.AttackCooldown, { remaining: 0, max: GUARD_ATTACK_COOLDOWN });
    world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    world.addComponent(id, C.Guard, {
      barracksId: tavernId,
      patrolRadius: BARRACKS_GUARD_PATROL_RADIUS,
    } as GuardComponent);
    world.addComponent(id, C.EnemyStats, {
      damage: dmg, range: heroDef.range > 0 ? GUARD_MELEE_RANGE : GUARD_MELEE_RANGE,
      knockback: GUARD_MELEE_KNOCKBACK, radius: GUARD_RADIUS,
      rangedRange: heroDef.range, projectileSpeed: heroDef.range > 0 ? 300 : 0,
      rangedDamage: heroDef.range > 0 ? dmg : 0, rangedCooldown: heroDef.range > 0 ? 1.5 : 0,
    } as EnemyStatsComponent);
    world.addComponent(id, C.Hero, {
      heroId: heroDef.id,
      tavernId,
      patrolRadius: 200,
      abilityCooldowns: { [heroDef.ability.id]: 0 },
    } as HeroComponent);

    activeHeroIds.add(id);
    return id;
  }

  function handleHireHero(clientId: string, tavernId: number, heroId: string, send: SendFn): void {
    const player = players.get(clientId);
    if (!player) return;

    if (!world.hasEntity(tavernId)) {
      send(player.client, { type: MessageType.HIRE_HERO_RESULT, success: false, reason: 'no_tavern' });
      return;
    }

    const tavern = world.getComponent<TavernComponent>(tavernId, C.Tavern);
    if (!tavern) {
      send(player.client, { type: MessageType.HIRE_HERO_RESULT, success: false, reason: 'no_tavern' });
      return;
    }

    // Check roster has this hero
    if (!tavern.roster.includes(heroId)) {
      send(player.client, { type: MessageType.HIRE_HERO_RESULT, success: false, reason: 'not_available' });
      return;
    }

    const heroDef = HERO_DEFINITIONS[heroId];
    if (!heroDef) {
      send(player.client, { type: MessageType.HIRE_HERO_RESULT, success: false, reason: 'unknown_hero' });
      return;
    }

    // Check capacity
    if (activeHeroIds.size >= getMaxHeroCapacity()) {
      send(player.client, { type: MessageType.HIRE_HERO_RESULT, success: false, reason: 'max_heroes' });
      return;
    }

    // Check gold cost (from warehouse)
    const wp = wPool();
    if ((wp.gold ?? 0) < heroDef.cost) {
      send(player.client, { type: MessageType.HIRE_HERO_RESULT, success: false, reason: 'insufficient_gold' });
      return;
    }

    // Deduct gold
    wp.gold -= heroDef.cost;
    deps.broadcastWarehouseUpdate(send);

    // Get tavern upgrade level for scaling
    const bldg = world.getComponent<import('@shared/components').BuildingComponent>(tavernId, C.Building);
    const tavernLevel = bldg?.upgradeLevel ?? 1;

    // Spawn hero
    const heroEntityId = spawnHero(heroDef, tavernId, tavernLevel);
    tavern.heroIds.push(heroEntityId);

    // Remove from roster
    const rosterIdx = tavern.roster.indexOf(heroId);
    if (rosterIdx >= 0) tavern.roster.splice(rosterIdx, 1);

    send(player.client, { type: MessageType.HIRE_HERO_RESULT, success: true });

    // Send updated tavern state
    sendTavernState(tavernId, clientId, send);
  }

  function handleHeroDeath(entityId: number, send: SendFn): void {
    if (!activeHeroIds.has(entityId)) return;
    activeHeroIds.delete(entityId);

    const hero = world.getComponent<HeroComponent>(entityId, C.Hero);
    if (!hero) return;

    const heroDef = HERO_DEFINITIONS[hero.heroId];
    const heroName = heroDef?.name ?? hero.heroId;

    // Return hero to tavern roster
    if (world.hasEntity(hero.tavernId)) {
      const tavern = world.getComponent<TavernComponent>(hero.tavernId, C.Tavern);
      if (tavern) {
        tavern.heroIds = tavern.heroIds.filter(id => id !== entityId);
        tavern.roster.push(hero.heroId);
      }
    }

    // Broadcast hero died
    const msg = { type: MessageType.HERO_DIED, heroId: hero.heroId, heroName };
    for (const p of players.values()) send(p.client, msg);
  }

  function sendTavernState(tavernId: number, clientId: string, send: SendFn): void {
    const player = players.get(clientId);
    if (!player) return;

    const tavern = world.getComponent<TavernComponent>(tavernId, C.Tavern);
    if (!tavern) return;

    const roster = tavern.roster.map(hid => {
      const def = HERO_DEFINITIONS[hid];
      if (!def) return null;
      return {
        heroId: hid,
        name: def.name,
        cost: def.cost,
        hp: def.hp,
        damage: def.damage,
        ability: `${def.ability.name}: ${def.ability.description}`,
      };
    }).filter(Boolean) as Array<{ heroId: string; name: string; cost: number; hp: number; damage: number; ability: string }>;

    send(player.client, {
      type: MessageType.TAVERN_STATE,
      tavernId,
      roster,
      activeCount: activeHeroIds.size,
      maxHeroes: getMaxHeroCapacity(),
    });
  }

  function tickHeroAbilities(dt: number, send: SendFn): void {
    for (const id of activeHeroIds) {
      if (!world.hasEntity(id)) { activeHeroIds.delete(id); continue; }

      const hero = world.getComponent<HeroComponent>(id, C.Hero);
      if (!hero) continue;
      const pos = world.getComponent<PositionComponent>(id, C.Position);
      if (!pos) continue;

      const heroDef = HERO_DEFINITIONS[hero.heroId];
      if (!heroDef) continue;

      const abilityId = heroDef.ability.id;
      hero.abilityCooldowns[abilityId] = (hero.abilityCooldowns[abilityId] ?? 0) - dt;
      if (hero.abilityCooldowns[abilityId] > 0) continue;

      // Check if ability conditions are met
      const ability = heroDef.ability;
      let used = false;

      if (ability.damage > 0) {
        // Offensive ability: use when enemies nearby
        let nearestDist = (ability.radius > 0 ? ability.radius + 50 : 150);
        let nearestId = -1;
        for (const eid of world.query(C.EnemyStats, C.Position)) {
          if (activeHeroIds.has(eid)) continue;
          const faction = world.getComponent<FactionComponent>(eid, C.Faction);
          if (faction?.type === 'guard') continue;
          const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
          const dx = ep.x - pos.x, dy = ep.y - pos.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < nearestDist) { nearestDist = d; nearestId = eid; }
        }

        if (nearestId >= 0) {
          const ep = world.getComponent<PositionComponent>(nearestId, C.Position)!;

          if (ability.radius > 0) {
            // AOE damage
            for (const eid of world.query(C.EnemyStats, C.Position)) {
              if (activeHeroIds.has(eid)) continue;
              const faction = world.getComponent<FactionComponent>(eid, C.Faction);
              if (faction?.type === 'guard') continue;
              const eep = world.getComponent<PositionComponent>(eid, C.Position)!;
              const dx = eep.x - ep.x, dy = eep.y - ep.y;
              if (dx * dx + dy * dy <= ability.radius * ability.radius) {
                const hp = world.getComponent<HealthComponent>(eid, C.Health);
                if (hp) hp.current -= ability.damage;
              }
            }
          } else {
            // Single target
            const hp = world.getComponent<HealthComponent>(nearestId, C.Health);
            if (hp) hp.current -= ability.damage;
          }

          // Broadcast VFX
          const vfxMsg = {
            type: MessageType.HERO_ABILITY,
            heroId: hero.heroId, abilityId,
            x: ep.x, y: ep.y, radius: ability.radius,
          };
          for (const p of players.values()) send(p.client, vfxMsg);
          used = true;
        }
      } else if (abilityId === 'heal_pulse') {
        // Heal nearby allies (guards, heroes, players)
        let hasHurt = false;
        for (const aid of world.query(C.Health, C.Position)) {
          const faction = world.getComponent<FactionComponent>(aid, C.Faction);
          if (!faction || (faction.type !== 'guard' && faction.type !== 'player')) continue;
          const ap = world.getComponent<PositionComponent>(aid, C.Position)!;
          const dx = ap.x - pos.x, dy = ap.y - pos.y;
          if (dx * dx + dy * dy > ability.radius * ability.radius) continue;
          const hp = world.getComponent<HealthComponent>(aid, C.Health)!;
          if (hp.current < hp.max) {
            hp.current = Math.min(hp.max, hp.current + 20);
            hasHurt = true;
          }
        }
        if (hasHurt) {
          const vfxMsg = {
            type: MessageType.HERO_ABILITY,
            heroId: hero.heroId, abilityId,
            x: pos.x, y: pos.y, radius: ability.radius,
          };
          for (const p of players.values()) send(p.client, vfxMsg);
          used = true;
        }
      } else if (abilityId === 'taunt') {
        // Force enemies in range to target this hero (reset their targeting)
        let taunted = false;
        for (const eid of world.query(C.EnemyStats, C.Position)) {
          if (activeHeroIds.has(eid)) continue;
          const faction = world.getComponent<FactionComponent>(eid, C.Faction);
          if (faction?.type === 'guard') continue;
          const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
          const dx = ep.x - pos.x, dy = ep.y - pos.y;
          if (dx * dx + dy * dy <= ability.radius * ability.radius) {
            taunted = true;
          }
        }
        if (taunted) {
          const vfxMsg = {
            type: MessageType.HERO_ABILITY,
            heroId: hero.heroId, abilityId,
            x: pos.x, y: pos.y, radius: ability.radius,
          };
          for (const p of players.values()) send(p.client, vfxMsg);
          used = true;
        }
      } else if (abilityId === 'shield_aura') {
        // Buff nearby allies (VFX only for now)
        let hasAllies = false;
        for (const aid of world.query(C.Health, C.Position)) {
          const faction = world.getComponent<FactionComponent>(aid, C.Faction);
          if (!faction || (faction.type !== 'guard' && faction.type !== 'player')) continue;
          if (aid === id) continue;
          const ap = world.getComponent<PositionComponent>(aid, C.Position)!;
          const dx = ap.x - pos.x, dy = ap.y - pos.y;
          if (dx * dx + dy * dy <= ability.radius * ability.radius) { hasAllies = true; break; }
        }
        if (hasAllies) {
          const vfxMsg = {
            type: MessageType.HERO_ABILITY,
            heroId: hero.heroId, abilityId,
            x: pos.x, y: pos.y, radius: ability.radius,
          };
          for (const p of players.values()) send(p.client, vfxMsg);
          used = true;
        }
      }

      if (used) {
        hero.abilityCooldowns[abilityId] = ability.cooldown;
      }
    }
  }

  function serialize(): SavedHero[] {
    const result: SavedHero[] = [];
    for (const id of activeHeroIds) {
      if (!world.hasEntity(id)) continue;
      const hero = world.getComponent<HeroComponent>(id, C.Hero);
      const pos = world.getComponent<PositionComponent>(id, C.Position);
      const hp = world.getComponent<HealthComponent>(id, C.Health);
      if (!hero || !pos || !hp) continue;
      result.push({
        x: pos.x, y: pos.y,
        heroId: hero.heroId,
        tavernId: hero.tavernId,
        currentHp: hp.current,
        maxHp: hp.max,
        abilityCooldowns: { ...hero.abilityCooldowns },
      });
    }
    return result;
  }

  function restore(heroes: SavedHero[]): void {
    for (const sh of heroes) {
      const heroDef = HERO_DEFINITIONS[sh.heroId];
      if (!heroDef) continue;

      const id = world.createEntity();
      world.addComponent(id, C.Position, { x: sh.x, y: sh.y });
      world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
      world.addComponent(id, C.Health, { current: sh.currentHp, max: sh.maxHp });
      world.addComponent(id, C.Speed, { base: heroDef.speed, multiplier: 1 });
      world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
      world.addComponent(id, C.Faction, { type: 'guard' } as FactionComponent);
      world.addComponent(id, C.Facing, { angle: 0 });
      world.addComponent(id, C.AttackCooldown, { remaining: 0, max: GUARD_ATTACK_COOLDOWN });
      world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
      world.addComponent(id, C.Guard, {
        barracksId: sh.tavernId,
        patrolRadius: BARRACKS_GUARD_PATROL_RADIUS,
      } as GuardComponent);
      world.addComponent(id, C.EnemyStats, {
        damage: heroDef.damage, range: GUARD_MELEE_RANGE,
        knockback: GUARD_MELEE_KNOCKBACK, radius: GUARD_RADIUS,
        rangedRange: heroDef.range, projectileSpeed: heroDef.range > 0 ? 300 : 0,
        rangedDamage: heroDef.range > 0 ? heroDef.damage : 0,
        rangedCooldown: heroDef.range > 0 ? 1.5 : 0,
      } as EnemyStatsComponent);
      world.addComponent(id, C.Hero, {
        heroId: sh.heroId,
        tavernId: sh.tavernId,
        patrolRadius: 200,
        abilityCooldowns: sh.abilityCooldowns,
      } as HeroComponent);

      activeHeroIds.add(id);

      // Add to tavern heroIds if tavern exists
      if (world.hasEntity(sh.tavernId)) {
        const tavern = world.getComponent<TavernComponent>(sh.tavernId, C.Tavern);
        if (tavern) tavern.heroIds.push(id);
      }
    }
  }

  return {
    handleHireHero,
    handleHeroDeath,
    sendTavernState,
    tickHeroAbilities,
    serialize,
    restore,
    getActiveHeroIds: () => activeHeroIds,
  };
}

export type HeroSystem = ReturnType<typeof createHeroSystem>;
