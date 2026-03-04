import { BUILDING_COSTS } from '@shared/constants';
import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  HealthComponent,
  FactionComponent,
  EnemyVariantComponent,
  PortalComponent,
  ResourceNodeComponent,
  ResourcesComponent,
  ItemDropComponent,
  BuildingComponent,
  ProductionComponent,
  TurretComponent,
  SpikeTrapComponent,
  BridgeComponent,
} from '@shared/components';
import type {
  EnemyStatsComponent, GhostStateComponent,
  LightRevealComponent, HealAuraComponent, BarracksSpawnerComponent,
  SpeedComponent, WorkerSlotComponent, HousingComponent,
} from '@shared/components';
import type {
  SaveData, SavedBuilding, SavedPlayer, SavedEnemy,
  SavedPortal, SavedResourceNode, SavedItemDrop, SavedCivilian, SavedHero,
} from '@shared/SaveFormat';
import type { WaveState } from './WaveController';
import type { SessionPlayer } from '../core/GameSession';

// ── Loaded save state returned by loadSave ──────────────────────────────────

export interface LoadedSaveState {
  elapsedTime: number;
  buildings: SavedBuilding[];
  players: SavedPlayer[];
  enemies: SavedEnemy[];
  portals: SavedPortal[];
  resourceNodes: SavedResourceNode[];
  itemDrops: SavedItemDrop[];
  wavePhase: 'idle' | 'prep' | 'active' | 'cleared';
  prepTimeRemaining: number | null;
  civilians: SavedCivilian[];
  dayTimeRemaining: number | null;
  permanentNight: boolean;
  heroes: SavedHero[];
}

// ── Dependencies ────────────────────────────────────────────────────────────

export interface SaveManagerDeps {
  world: World;
  seed: number;
  waveState: WaveState;
  warehousePool: { wood: number; stone: number; iron: number; diamond: number; gold: number; food: number };
  spawnOrigin: { x: number; y: number };
  processedChunks: Set<string>;
  players: Map<string, SessionPlayer>;
  getEnemiesKilled: () => number;
  getElapsedSeconds: () => number;
  getHostPlayerId: () => string;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createSaveManager(deps: SaveManagerDeps) {
  const { world, waveState, warehousePool, spawnOrigin, processedChunks, players } = deps;

  function serialize(): SaveData {
    const buildings: SavedBuilding[] = [];
    for (const id of world.query(C.Building, C.Position, C.Health)) {
      const bld = world.getComponent<BuildingComponent>(id, C.Building)!;
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const hp = world.getComponent<HealthComponent>(id, C.Health)!;

      const saved: SavedBuilding = {
        x: pos.x, y: pos.y,
        buildingType: bld.buildingType,
        permanent: bld.permanent,
        upgradeLevel: bld.upgradeLevel,
        currentHp: hp.current,
        maxHp: hp.max,
        rotation: bld.rotation || undefined,
      };

      const prod = world.getComponent<ProductionComponent>(id, C.Production);
      if (prod) {
        saved.production = {
          resourceType: prod.resourceType,
          interval: prod.interval,
          timer: prod.timer,
          amount: prod.amount,
          stored: prod.stored,
          maxStored: prod.maxStored,
          secondaryResourceType: prod.secondaryResourceType,
          secondaryChance: prod.secondaryChance,
        };
      }

      const turret = world.getComponent<TurretComponent>(id, C.Turret);
      if (turret) {
        saved.turret = {
          range: turret.range, cooldown: turret.cooldown,
          damage: turret.damage, projectileSpeed: turret.projectileSpeed,
        };
      }

      const spike = world.getComponent<SpikeTrapComponent>(id, C.SpikeTrap);
      if (spike) {
        saved.spikeTrap = {
          damage: spike.damage, cooldown: spike.cooldown, selfDamage: spike.selfDamage,
        };
      }

      const bridge = world.getComponent<BridgeComponent>(id, C.Bridge);
      if (bridge) {
        saved.bridge = { tileX: bridge.tileX, tileY: bridge.tileY };
      }

      const lr = world.getComponent<LightRevealComponent>(id, C.LightReveal);
      if (lr) saved.lightReveal = { range: lr.range };

      const ha = world.getComponent<HealAuraComponent>(id, C.HealAura);
      if (ha) saved.healAura = { range: ha.range, healPerSecond: ha.healPerSecond };

      const bs = world.getComponent<BarracksSpawnerComponent>(id, C.BarracksSpawner);
      if (bs) saved.barracksSpawner = { maxGuards: bs.maxGuards, spawnInterval: bs.spawnInterval };

      const wsComp = world.getComponent<WorkerSlotComponent>(id, C.WorkerSlot);
      if (wsComp) saved.workerSlot = { workerId: wsComp.workerId };

      const hComp = world.getComponent<HousingComponent>(id, C.Housing);
      if (hComp) saved.housing = { capacity: hComp.capacity };

      buildings.push(saved);
    }

    const savedPlayers: SavedPlayer[] = [];
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      const hp = world.getComponent<HealthComponent>(p.entityId, C.Health);
      const res = world.getComponent<ResourcesComponent>(p.entityId, C.Resources);
      if (!pos || !hp || !res) continue;

      savedPlayers.push({
        playerId: p.playerId,
        displayName: p.displayName,
        slot: p.slot,
        resources: { wood: res.wood, stone: res.stone, iron: res.iron, diamond: res.diamond, gold: res.gold, food: res.food, weapons: res.weapons },
        hp: hp.current,
        maxHp: hp.max,
        x: pos.x,
        y: pos.y,
        playerClass: p.playerClass,
      });
    }

    const enemies: SavedEnemy[] = [];
    for (const id of world.query(C.Faction, C.Position, C.Health, C.EnemyVariant, C.EnemyStats)) {
      const f = world.getComponent<FactionComponent>(id, C.Faction)!;
      if (f.type !== 'enemy') continue;
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const hp = world.getComponent<HealthComponent>(id, C.Health)!;
      const ev = world.getComponent<EnemyVariantComponent>(id, C.EnemyVariant)!;
      const es = world.getComponent<EnemyStatsComponent>(id, C.EnemyStats)!;
      const spd = world.getComponent<SpeedComponent>(id, C.Speed);
      const ghost = world.getComponent<GhostStateComponent>(id, C.GhostState);
      enemies.push({
        x: pos.x, y: pos.y,
        variant: ev.variant,
        currentHp: hp.current, maxHp: hp.max,
        damage: es.damage, range: es.range, knockback: es.knockback, radius: es.radius,
        rangedRange: es.rangedRange, projectileSpeed: es.projectileSpeed,
        rangedDamage: es.rangedDamage, rangedCooldown: es.rangedCooldown,
        speedBase: spd?.base ?? 80, speedMultiplier: spd?.multiplier ?? 1,
        ghostHidden: ghost?.hidden,
      });
    }

    const portals: SavedPortal[] = [];
    for (const id of world.query(C.Portal, C.Position, C.Health)) {
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const hp = world.getComponent<HealthComponent>(id, C.Health)!;
      const portal = world.getComponent<PortalComponent>(id, C.Portal)!;
      if (hp.current <= 0) continue;
      portals.push({
        x: pos.x, y: pos.y,
        waveNumber: portal.waveNumber,
        currentHp: hp.current, maxHp: hp.max,
        spawnTimer: portal.spawnTimer, spawnInterval: portal.spawnInterval,
      });
    }

    const resourceNodes: SavedResourceNode[] = [];
    for (const id of world.query(C.ResourceNode, C.Position, C.Health)) {
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const hp = world.getComponent<HealthComponent>(id, C.Health)!;
      const rn = world.getComponent<ResourceNodeComponent>(id, C.ResourceNode)!;
      if (hp.current <= 0) continue;
      resourceNodes.push({
        x: pos.x, y: pos.y,
        resourceType: rn.resourceType, yield: rn.yield,
        currentHp: hp.current, maxHp: hp.max,
      });
    }

    const itemDrops: SavedItemDrop[] = [];
    for (const id of world.query(C.ItemDrop, C.Position)) {
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const drop = world.getComponent<ItemDropComponent>(id, C.ItemDrop)!;
      itemDrops.push({
        x: pos.x, y: pos.y,
        itemType: drop.itemType, quantity: drop.quantity,
        autoPickup: drop.autoPickup, lifetime: drop.lifetime,
      });
    }

    return {
      formatVersion: 1,
      seed: deps.seed,
      currentWave: waveState.currentWave,
      wavePhase: waveState.phase,
      prepTimeRemaining: waveState.phase === 'prep' ? waveState.prepTimer : undefined,
      warehousePool: { ...warehousePool },
      spawnOrigin: { ...spawnOrigin },
      processedChunks: [...processedChunks],
      enemiesKilled: deps.getEnemiesKilled(),
      elapsedTime: deps.getElapsedSeconds(),
      buildings,
      players: savedPlayers,
      enemies,
      portals,
      resourceNodes,
      itemDrops,
      hostPlayerId: deps.getHostPlayerId(),
      timestamp: Date.now(),
    };
  }

  function validate(save: unknown): save is SaveData {
    if (!save || typeof save !== 'object') return false;
    const s = save as Record<string, unknown>;
    if (s.formatVersion !== 1) return false;
    if (!Number.isFinite(s.currentWave) || !Number.isInteger(s.currentWave) || (s.currentWave as number) < 1) return false;
    if (!Number.isFinite(s.seed) || !Number.isInteger(s.seed)) return false;
    if (!Number.isFinite(s.enemiesKilled) || (s.enemiesKilled as number) < 0) return false;
    if (!Number.isFinite(s.elapsedTime) || (s.elapsedTime as number) < 0) return false;
    const wp = s.warehousePool;
    if (!wp || typeof wp !== 'object') return false;
    const pool = wp as Record<string, unknown>;
    for (const key of ['wood', 'stone', 'iron', 'diamond', 'gold', 'food']) {
      if (!Number.isFinite(pool[key]) || (pool[key] as number) < 0) return false;
    }
    const origin = s.spawnOrigin as Record<string, unknown> | undefined;
    if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return false;
    if (!Array.isArray(s.buildings)) return false;
    const validBuildings = new Set(Object.keys(BUILDING_COSTS));
    for (const b of s.buildings as Record<string, unknown>[]) {
      if (!b || typeof b !== 'object') return false;
      if (!validBuildings.has(b.buildingType as string)) return false;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return false;
      if (!Number.isFinite(b.currentHp) || (b.currentHp as number) <= 0) return false;
      if (!Number.isFinite(b.maxHp) || (b.maxHp as number) <= 0) return false;
      if (!Number.isInteger(b.upgradeLevel) || (b.upgradeLevel as number) < 1 || (b.upgradeLevel as number) > 5) return false;
    }
    if (!Array.isArray(s.players)) return false;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const p of s.players as Record<string, unknown>[]) {
      if (!p || typeof p !== 'object') return false;
      if (typeof p.playerId !== 'string' || !uuidRe.test(p.playerId)) return false;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    }
    return true;
  }

  function load(save: SaveData): LoadedSaveState | null {
    if (!validate(save)) {
      console.warn('[SaveManager] Invalid save data');
      return null;
    }

    // Update shared mutable state
    waveState.currentWave = save.currentWave;
    const wp = warehousePool as Record<string, number>;
    wp.wood = save.warehousePool.wood;
    wp.stone = save.warehousePool.stone;
    wp.iron = save.warehousePool.iron;
    wp.diamond = save.warehousePool.diamond;
    wp.gold = save.warehousePool.gold;
    wp.food = save.warehousePool.food;
    spawnOrigin.x = save.spawnOrigin.x;
    spawnOrigin.y = save.spawnOrigin.y;
    processedChunks.clear();
    for (const c of save.processedChunks) processedChunks.add(c);

    // Migrate old 'mine' (stone) → 'quarry' for save compatibility
    const buildings = save.buildings.map(b => {
      if (b.buildingType === 'mine' && b.production?.resourceType === 'stone') {
        return { ...b, buildingType: 'quarry' as const };
      }
      return b;
    });

    return {
      elapsedTime: save.elapsedTime,
      buildings,
      players: save.players,
      enemies: save.enemies ?? [],
      portals: save.portals ?? [],
      resourceNodes: save.resourceNodes ?? [],
      itemDrops: save.itemDrops ?? [],
      wavePhase: save.wavePhase ?? 'prep',
      prepTimeRemaining: save.prepTimeRemaining ?? null,
      civilians: save.civilians ?? [],
      dayTimeRemaining: save.dayTimeRemaining ?? null,
      permanentNight: save.permanentNight ?? false,
      heroes: save.heroes ?? [],
    };
  }

  return { serialize, validate, load };
}

export type SaveManager = ReturnType<typeof createSaveManager>;
