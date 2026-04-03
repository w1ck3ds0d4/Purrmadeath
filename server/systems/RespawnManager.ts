import { World } from '@shared/ecs/World';
import {
  C,
  PositionComponent,
  VelocityComponent,
  HealthComponent,
  PlayerInputComponent,
  FactionComponent,
  ResourceNodeComponent,
  ResourcesComponent,
  DownedComponent,
  EnemyVariantComponent,
} from '@shared/components';
import type { BarracksSpawnerComponent, BuildingComponent, RuinsComponent } from '@shared/components';
import {
  PLAYER_MAX_HEALTH,
  DOWNED_BLEED_TIME,
  CIVILIAN_BLEED_TIME,
  REVIVE_DURATION,
  REVIVE_HP_PERCENT,
  RESPAWN_DELAY,
  REVIVE_RANGE,
  WIPE_1_RESOURCE_LOSS_PERCENT,
  RUINS_BURN_DURATION,
  RUINS_DECAY_DURATION,
} from '@shared/constants';
import { MessageType } from '@shared/protocol';
import type {
  PlayerDownedMessage,
  ReviveProgressMessage,
  PlayerRevivedMessage,
  PlayerDiedMessage,
  PlayerRespawnedMessage,
  PartyWipeMessage,
  GameOverMessage,
  BuildDestroyedMessage,
  BuildRuinedMessage,
  CampfireDestroyedMessage,
  ResourceUpdateMessage,
} from '@shared/protocol';
import type { ConnectedClient } from '../net/ServerSocket';
import type { SessionPlayer, SendFn } from '../core/GameSession';
import type { WaveState } from './WaveController';
import type { BuildingSystem } from './BuildingSystem';

// ── Dependencies ────────────────────────────────────────────────────────────

export interface RespawnManagerDeps {
  world: World;
  players: Map<string, SessionPlayer>;
  playerEntityIds: Set<number>;
  respawnTimers: Map<string, number>;
  spawnOrigin: { x: number; y: number };
  waveState: WaveState;
  warehousePool: Record<string, number>;
  warehouseIds: Set<number>;
  getGameOver: () => boolean;
  setGameOver: (v: boolean) => void;
  getEnemiesKilled: () => number;
  incrementEnemiesKilled: () => void;
  decrementResourceNodeCount: (entityId: number) => void;
  /** Queue a destroyed resource node for respawn at its original position. */
  queueResourceRespawn?: (x: number, y: number, resourceType: string) => void;
  getCampfireEntityId: () => number;
  getElapsedSeconds: () => number;
  getBuildings: () => BuildingSystem;
  getReviveHpBonus: (entityId: number) => number;
  getSelfRevives: (entityId: number) => number;
  consumeSelfRevive: (entityId: number) => void;
  creditResources: (entityId: number, resource: string, amount: number, send: SendFn) => void;
  spawnLootDrops: (deadEntityId: number) => void;
  spawnItemDrop: (x: number, y: number, itemType: string, quantity: number, autoPickup: boolean) => void;
  findSafeSpawnNear: (wx: number, wy: number) => { x: number; y: number };
  trackKill: (attackerEntityId: number, enemyVariant: string) => void;
  onBossKilled: (deadId: number, send: SendFn) => void;
  isBoss: (entityId: number) => boolean;
  /** Called when a regular enemy is killed - for card auto-grant. */
  onEnemyKilled?: (deadId: number, attackerEntityId: number | undefined, variant: string, send: SendFn) => void;
  fireRunEnd: () => void;
  /** Called when a downed civilian's bleed timer expires. */
  onCivilianDeath?: (entityId: number, send: SendFn) => void;
  /** Set of entity IDs that are civilians (for downed-state routing). */
  civilianEntityIds?: Set<number>;
  /** Called when a hero guard entity dies. */
  onHeroDeath?: (entityId: number, send: SendFn) => void;
  /** Whether the campfire has been placed. Used for permanent death before campfire. */
  isCampfirePlaced?: () => boolean;
  /** Get the undying horde resurrection chance (0 = inactive, 0.15 = 15%). */
  getUndyingChance?: () => number;
  /** Spawn a new enemy at the given position (used for undying horde resurrection). */
  spawnEnemyAt?: (x: number, y: number) => void;
  /** Get the market entity ID (-1 if not placed). */
  getMarketEntityId?: () => number;
  /** Reset the market entity ID (called when market is destroyed). */
  setMarketEntityId?: (id: number) => void;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createRespawnManager(deps: RespawnManagerDeps) {
  const {
    world, players, playerEntityIds, respawnTimers, spawnOrigin, waveState,
    warehousePool, warehouseIds,
  } = deps;

  // ── Undying Horde resurrection queue ──────────────────────────────────────
  const resurrectionQueue: Array<{ x: number; y: number; timer: number }> = [];

  // ── helpers ────────────────────────────────────────────────────────────────

  function findSessionPlayerByEntity(entityId: number): SessionPlayer | undefined {
    for (const p of players.values()) {
      if (p.entityId === entityId) return p;
    }
    return undefined;
  }

  function countAlivePlayers(): number {
    let count = 0;
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      if (world.hasComponent(p.entityId, C.Downed)) continue;
      if (respawnTimers.has(p.client.id)) continue;
      const hp = world.getComponent<HealthComponent>(p.entityId, C.Health);
      if (hp && hp.current > 0) count++;
    }
    return count;
  }

  // ── revive / respawn ──────────────────────────────────────────────────────

  function broadcastReviveProgress(targetId: number, progress: number, reviverId: number, send: SendFn): void {
    const msg: ReviveProgressMessage = {
      type: MessageType.REVIVE_PROGRESS,
      targetId,
      progress: Math.min(1, progress),
      reviverId,
    };
    for (const p of players.values()) send(p.client, msg);
  }

  function revivePlayer(entityId: number, send: SendFn): void {
    const hp = world.getComponent<HealthComponent>(entityId, C.Health);
    const isCivilian = deps.civilianEntityIds?.has(entityId) ?? false;
    const reviveBonus = isCivilian ? 0 : deps.getReviveHpBonus(entityId);
    if (hp) hp.current = Math.round(hp.max * Math.min(1, REVIVE_HP_PERCENT + reviveBonus));
    world.removeComponent(entityId, C.Downed);

    const sp = findSessionPlayerByEntity(entityId);
    const msg: PlayerRevivedMessage = {
      type: MessageType.PLAYER_REVIVED,
      entityId,
      slot: sp?.slot ?? -1,
      hp: hp?.current ?? 0,
    };
    for (const p of players.values()) send(p.client, msg);
    if (isCivilian) {
      console.log(`[Death] Civilian ${entityId} revived at ${hp?.current ?? 0} HP`);
    } else {
      console.log(`[Death] Player ${sp?.slot ?? '?'} revived at ${hp?.current ?? 0} HP`);
    }
  }

  function respawnPlayer(clientId: string, send: SendFn): void {
    const sp = players.get(clientId);
    if (!sp || sp.entityId === null) return;

    const hp = world.getComponent<HealthComponent>(sp.entityId, C.Health);
    if (hp) hp.current = hp.max;

    const pos = world.getComponent<PositionComponent>(sp.entityId, C.Position);
    const OFFSET = 72;
    const offsets = [
      { dx: -OFFSET, dy: -OFFSET }, { dx: OFFSET, dy: -OFFSET },
      { dx: -OFFSET, dy: OFFSET }, { dx: OFFSET, dy: OFFSET },
    ];
    const off = offsets[sp.slot] ?? { dx: -OFFSET, dy: -OFFSET };
    if (pos) {
      const candidate = deps.findSafeSpawnNear(
        spawnOrigin.x + off.dx, spawnOrigin.y + off.dy,
      );
      pos.x = candidate.x;
      pos.y = candidate.y;
    }

    world.removeComponent(sp.entityId, C.Downed);

    const msg: PlayerRespawnedMessage = {
      type: MessageType.PLAYER_RESPAWNED,
      entityId: sp.entityId,
      slot: sp.slot,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      hp: hp?.max ?? PLAYER_MAX_HEALTH,
    };
    for (const p of players.values()) send(p.client, msg);
    console.log(`[Death] Player ${sp.slot} respawned at (${pos?.x ?? 0}, ${pos?.y ?? 0})`);
  }

  function handlePlayerDeath(entityId: number, send: SendFn): void {
    const sp = findSessionPlayerByEntity(entityId);
    if (!sp) return;

    const vel = world.getComponent<VelocityComponent>(entityId, C.Velocity);
    if (vel) { vel.vx = 0; vel.vy = 0; }

    // Permanent death if campfire hasn't been placed yet
    if (deps.isCampfirePlaced && !deps.isCampfirePlaced()) {
      console.log(`[Death] Player ${sp.slot} died before campfire - permanent death (game over)`);
      deps.setGameOver(true);
      const goMsg: import('@shared/protocol').GameOverMessage = {
        type: MessageType.GAME_OVER,
        waveReached: waveState.currentWave,
        reason: 'Died before placing campfire',
        enemiesKilled: deps.getEnemiesKilled(),
        timePlayed: Math.floor(deps.getElapsedSeconds()),
      };
      for (const p of players.values()) send(p.client, goMsg);
      deps.fireRunEnd();
      return;
    }

    respawnTimers.set(sp.client.id, RESPAWN_DELAY);

    const msg: PlayerDiedMessage = {
      type: MessageType.PLAYER_DIED,
      entityId,
      slot: sp.slot,
      respawnTimer: RESPAWN_DELAY,
    };
    for (const p of players.values()) send(p.client, msg);
    console.log(`[Death] Player ${sp.slot} died - respawn in ${RESPAWN_DELAY}s`);
  }

  // ── party wipe ────────────────────────────────────────────────────────────

  function handlePartyWipe(send: SendFn): void {
    waveState.wipeCount++;
    console.log(`[Wipe] Party wipe #${waveState.wipeCount} on wave ${waveState.currentWave}`);

    // Resource penalty + scatter drops + respawn all
    const wipeMsg: PartyWipeMessage = {
      type: MessageType.PARTY_WIPE,
      wipeCount: waveState.wipeCount,
      outcome: 'penalty',
    };
    for (const p of players.values()) send(p.client, wipeMsg);

    for (const sp of players.values()) {
      if (sp.entityId === null) continue;
      const res = world.getComponent<ResourcesComponent>(sp.entityId, C.Resources);
      if (!res) continue;

      for (const key of ['wood', 'stone', 'iron', 'diamond', 'gold', 'food'] as const) {
        const loss = Math.floor(res[key] * WIPE_1_RESOURCE_LOSS_PERCENT);
        if (loss > 0) {
          res[key] -= loss;
          const angle = Math.random() * Math.PI * 2;
          const dist = 50 + Math.random() * 100;
          deps.spawnItemDrop(
            spawnOrigin.x + Math.cos(angle) * dist,
            spawnOrigin.y + Math.sin(angle) * dist,
            key, loss, true,
          );
        }
      }

      const update: ResourceUpdateMessage = {
        type: MessageType.RESOURCE_UPDATE,
        wood: res.wood, stone: res.stone, iron: res.iron,
        diamond: res.diamond, gold: res.gold, food: res.food, weapons: res.weapons, steel: res.steel,
      };
      send(sp.client, update);
    }

    for (const [clientId, sp] of players) {
      if (sp.entityId === null) continue;
      world.removeComponent(sp.entityId, C.Downed);
      respawnTimers.delete(clientId);
      respawnPlayer(clientId, send);
    }
  }

  // ── downed check ──────────────────────────────────────────────────────────

  function checkPlayerDowned(entityId: number, send: SendFn): void {
    if (deps.getGameOver()) return;
    if (!playerEntityIds.has(entityId)) return;
    if (world.hasComponent(entityId, C.Downed)) return;

    const spCheck = findSessionPlayerByEntity(entityId);
    if (spCheck && respawnTimers.has(spCheck.client.id)) return;

    const hp = world.getComponent<HealthComponent>(entityId, C.Health);
    if (!hp || hp.current > 0) return;

    // Spare Life: consume a self-revive instead of downing
    if (deps.getSelfRevives(entityId) > 0) {
      deps.consumeSelfRevive(entityId);
      const reviveBonus = deps.getReviveHpBonus(entityId);
      hp.current = Math.round(hp.max * Math.min(1, REVIVE_HP_PERCENT + reviveBonus));
      return;
    }

    const isSolo = players.size <= 1;
    const bleedTime = isSolo ? 15 : DOWNED_BLEED_TIME;

    // Release Unbreakable Charge explosion before downing
    const abComp = world.getComponent<import('@shared/components').ActiveBuffsComponent>(entityId, C.ActiveBuffs);
    if (abComp) {
      const chargeIdx = abComp.buffs.findIndex(b => b.id === 'unbreakable_charge');
      if (chargeIdx >= 0) {
        const charge = abComp.buffs[chargeIdx];
        const pos = world.getComponent<PositionComponent>(entityId, C.Position);
        if (pos) {
          const storedDmg = charge.effect.damageStorage ?? 0;
          const releaseDmg = 75 + Math.round(storedDmg * (charge.effect.damageMultiplier ?? 2));
          for (const eid of world.query(C.Position, C.Health, C.Faction)) {
            const ef = world.getComponent<FactionComponent>(eid, C.Faction);
            if (ef?.type !== 'enemy') continue;
            const ep = world.getComponent<PositionComponent>(eid, C.Position)!;
            const dx = ep.x - pos.x, dy = ep.y - pos.y;
            if (dx * dx + dy * dy > 250000) continue;
            const ehp = world.getComponent<HealthComponent>(eid, C.Health);
            if (ehp) ehp.current = Math.max(0, ehp.current - releaseDmg);
          }
        }
        abComp.buffs.splice(chargeIdx, 1);
        // Remove root
        if (world.hasComponent(entityId, C.Root)) world.removeComponent(entityId, C.Root);
      }
    }

    world.addComponent(entityId, C.Downed, {
      bleedTimer: bleedTime, reviveProgress: 0, reviverId: -1,
    });

    const inp = world.getComponent<PlayerInputComponent>(entityId, C.PlayerInput);
    if (inp) { inp.dx = 0; inp.dy = 0; inp.sprint = false; }

    const sp = findSessionPlayerByEntity(entityId);
    const msg: PlayerDownedMessage = {
      type: MessageType.PLAYER_DOWNED,
      entityId,
      slot: sp?.slot ?? -1,
      bleedTimer: bleedTime,
    };
    for (const p of players.values()) send(p.client, msg);
    console.log(`[Death] Player ${sp?.slot ?? '?'} downed (${bleedTime}s ${isSolo ? 'respawn' : 'bleed-out'})`);

    if (!isSolo && countAlivePlayers() === 0) {
      handlePartyWipe(send);
    }
  }

  // ── destroy dead entities ─────────────────────────────────────────────────

  function destroyDeadEntities(
    deaths: number[],
    attackerMap?: Map<number, number>,
    send?: SendFn,
  ): void {
    const processed = new Set<number>();
    for (const deadId of deaths) {
      if (processed.has(deadId)) continue;
      processed.add(deadId);

      if (playerEntityIds.has(deadId)) {
        if (send) checkPlayerDowned(deadId, send);
        continue;
      }

      const faction = world.getComponent<FactionComponent>(deadId, C.Faction);

      // Resource node → credit attacker and queue respawn
      if (faction?.type === 'resource' && attackerMap && send) {
        const rn = world.getComponent<ResourceNodeComponent>(deadId, C.ResourceNode);
        const pos = world.getComponent<PositionComponent>(deadId, C.Position);
        const attackerId = attackerMap.get(deadId);
        if (rn && attackerId !== undefined) {
          deps.creditResources(attackerId, rn.resourceType, rn.yield, send);
        }
        // Queue respawn at the node's original position
        if (rn && pos && deps.queueResourceRespawn) {
          deps.queueResourceRespawn(pos.x, pos.y, rn.resourceType);
        }
        deps.decrementResourceNodeCount(deadId);
      }

      // Enemy → spawn loot drops + track kill
      if (faction?.type === 'enemy') {
        deps.spawnLootDrops(deadId);
        waveState.enemyCount--;
        deps.incrementEnemiesKilled();
        const ev = world.getComponent<EnemyVariantComponent>(deadId, C.EnemyVariant);
        if (attackerMap) {
          const attackerId = attackerMap.get(deadId);
          if (attackerId !== undefined) {
            deps.trackKill(attackerId, ev?.variant ?? 'melee');
          }
        }
        // Boss death: guaranteed card drop
        if (send && deps.isBoss(deadId)) {
          deps.onBossKilled(deadId, send);
        }
        // Regular enemy kill: chance to auto-grant card to killer
        if (send && !deps.isBoss(deadId) && deps.onEnemyKilled) {
          const attackerId = attackerMap?.get(deadId);
          deps.onEnemyKilled(deadId, attackerId, ev?.variant ?? 'melee', send);
        }
        // W50+ Undying Horde: chance to resurrect enemy after 3 seconds
        const undyingChance = deps.getUndyingChance?.() ?? 0;
        if (undyingChance > 0 && Math.random() < undyingChance && !deps.isBoss(deadId)) {
          const pos = world.getComponent<PositionComponent>(deadId, C.Position);
          if (pos && deps.spawnEnemyAt) {
            const rx = pos.x, ry = pos.y;
            // Queue resurrection after 3 seconds
            resurrectionQueue.push({ x: rx, y: ry, timer: 3.0 });
          }
        }
      }

      // Civilian → enter downed state (can be revived)
      if (faction?.type === 'civilian' && deps.civilianEntityIds?.has(deadId)) {
        if (!world.hasComponent(deadId, C.Downed)) {
          world.addComponent(deadId, C.Downed, {
            bleedTimer: CIVILIAN_BLEED_TIME,
            reviveProgress: 0,
            reviverId: -1,
          } as DownedComponent);
          // Stop civilian movement
          const inp = world.getComponent<PlayerInputComponent>(deadId, C.PlayerInput);
          if (inp) { inp.dx = 0; inp.dy = 0; inp.sprint = false; }
          // Broadcast downed notification (reuse PLAYER_DOWNED - works for any entity)
          if (send) {
            const msg: PlayerDownedMessage = {
              type: MessageType.PLAYER_DOWNED,
              entityId: deadId,
              slot: -1,
              bleedTimer: CIVILIAN_BLEED_TIME,
            };
            for (const p of players.values()) send(p.client, msg);
          }
        }
        continue;
      }

      // Building → convert to ruins or handle campfire game-over
      if (faction?.type === 'building' && send) {
        const bldg = world.getComponent<BuildingComponent>(deadId, C.Building);

        // Campfire → instant game-over (no ruins)
        if (deadId === deps.getCampfireEntityId() && !deps.getGameOver()) {
          const destroyedMsg: BuildDestroyedMessage = {
            type: MessageType.BUILD_DESTROYED,
            entityId: deadId,
          };
          for (const p of players.values()) send(p.client, destroyedMsg);

          deps.setGameOver(true);
          const campfireMsg: CampfireDestroyedMessage = {
            type: MessageType.CAMPFIRE_DESTROYED,
          };
          for (const p of players.values()) send(p.client, campfireMsg);

          const timePlayed = Math.floor(deps.getElapsedSeconds());
          const gameOverMsg: GameOverMessage = {
            type: MessageType.GAME_OVER,
            waveReached: waveState.currentWave,
            reason: 'campfire_destroyed',
            enemiesKilled: deps.getEnemiesKilled(),
            timePlayed,
          };
          for (const p of players.values()) send(p.client, gameOverMsg);
          deps.fireRunEnd();
          world.destroyEntity(deadId);
          continue;
        }

        // Bridge → fully destroyed (no ruins for bridges)
        if (world.hasComponent(deadId, C.Bridge)) {
          const destroyedMsg: BuildDestroyedMessage = {
            type: MessageType.BUILD_DESTROYED,
            entityId: deadId,
          };
          for (const p of players.values()) send(p.client, destroyedMsg);
          deps.getBuildings().cleanupBridge(deadId);
          world.destroyEntity(deadId);
          continue;
        }

        // Warehouse destroyed → drop supplies + clean up (then convert to ruins)
        if (warehouseIds.has(deadId)) {
          const wPos = world.getComponent<PositionComponent>(deadId, C.Position);
          if (wPos) {
            const DROP_FRACTION = 0.5;
            const MAX_PER_DROP = 50;
            for (const [res, amount] of Object.entries(warehousePool)) {
              const dropAmount = Math.floor(amount * DROP_FRACTION);
              if (dropAmount <= 0) continue;
              warehousePool[res] -= dropAmount;
              let remaining = dropAmount;
              while (remaining > 0) {
                const qty = Math.min(remaining, MAX_PER_DROP);
                deps.spawnItemDrop(wPos.x, wPos.y, res, qty, true);
                remaining -= qty;
              }
            }
          }
          warehouseIds.delete(deadId);
          if (warehouseIds.size === 0) {
            warehousePool.wood = 0; warehousePool.stone = 0; warehousePool.iron = 0;
            warehousePool.diamond = 0; warehousePool.gold = 0; warehousePool.food = 0;
          }
          deps.getBuildings().broadcastWarehouseUpdate(send);
        }

        // Market destroyed → reset market entity ID so a new one can be placed
        const bldgComp = world.getComponent<BuildingComponent>(deadId, C.Building);
        if (bldgComp?.buildingType === 'market' && deps.getMarketEntityId?.() === deadId) {
          deps.setMarketEntityId?.(-1);
        }

        // Watchtower destroyed → shrink build range
        if (bldgComp?.buildingType === 'watchtower') {
          deps.getBuildings().broadcastBuildRange(send);
        }

        // Barracks destroyed → destroy all its guards
        const spawner = world.getComponent<BarracksSpawnerComponent>(deadId, C.BarracksSpawner);
        if (spawner) {
          for (const gid of spawner.guardIds) {
            if (world.hasEntity(gid)) world.destroyEntity(gid);
          }
          spawner.guardIds.length = 0;
        }

        // If already a ruin (POI decoration or previously ruined), fully destroy it
        if (world.hasComponent(deadId, C.Ruins)) {
          const destroyedMsg: BuildDestroyedMessage = {
            type: MessageType.BUILD_DESTROYED,
            entityId: deadId,
          };
          for (const p of players.values()) send(p.client, destroyedMsg);
          world.destroyEntity(deadId);
          continue;
        }

        // Convert to ruins - strip functional components, add Ruins component
        const originalType = bldg?.buildingType ?? 'wall';
        const originalLevel = bldg?.upgradeLevel ?? 1;

        // Remove functional components so building stops working
        if (world.hasComponent(deadId, C.Production)) world.removeComponent(deadId, C.Production);
        if (world.hasComponent(deadId, C.Turret)) world.removeComponent(deadId, C.Turret);
        if (world.hasComponent(deadId, C.SpikeTrap)) world.removeComponent(deadId, C.SpikeTrap);
        if (world.hasComponent(deadId, C.HealAura)) world.removeComponent(deadId, C.HealAura);
        if (world.hasComponent(deadId, C.LightReveal)) world.removeComponent(deadId, C.LightReveal);
        if (world.hasComponent(deadId, C.BarracksSpawner)) world.removeComponent(deadId, C.BarracksSpawner);
        if (world.hasComponent(deadId, C.WorkerSlot)) world.removeComponent(deadId, C.WorkerSlot);
        if (world.hasComponent(deadId, C.Housing)) world.removeComponent(deadId, C.Housing);

        // Set HP to 1 so the entity stays alive in the ECS (0 would trigger death again)
        const hp = world.getComponent<HealthComponent>(deadId, C.Health);
        if (hp) { hp.current = 1; hp.max = 1; }

        // Add Ruins component
        world.addComponent(deadId, C.Ruins, {
          originalType,
          originalLevel,
          burnTimer: RUINS_BURN_DURATION,
          decayTimer: RUINS_DECAY_DURATION,
        } as RuinsComponent);

        // Broadcast ruins notification
        const ruinedMsg: BuildRuinedMessage = {
          type: MessageType.BUILD_RUINED,
          entityId: deadId,
          buildingType: originalType,
          originalLevel,
        };
        for (const p of players.values()) send(p.client, ruinedMsg);

        // Don't destroy the entity - it stays as ruins
        continue;
      }

      // Hero death: notify HeroSystem before destruction
      if (faction?.type === 'guard' && world.hasComponent(deadId, C.Hero) && send && deps.onHeroDeath) {
        deps.onHeroDeath(deadId, send);
      }

      world.destroyEntity(deadId);
    }
  }

  // ── tick ───────────────────────────────────────────────────────────────────

  function tickDownedPlayers(dt: number, send: SendFn): void {
    for (const id of world.query(C.Downed, C.Position)) {
      const spDown = findSessionPlayerByEntity(id);
      if (spDown && respawnTimers.has(spDown.client.id)) continue;

      const downed = world.getComponent<DownedComponent>(id, C.Downed)!;

      downed.bleedTimer -= dt;
      if (downed.bleedTimer <= 0) {
        // Civilian bleed-out → permanent death
        if (deps.civilianEntityIds?.has(id)) {
          world.removeComponent(id, C.Downed);
          if (deps.onCivilianDeath) deps.onCivilianDeath(id, send);
          world.destroyEntity(id);
          continue;
        }
        if (players.size <= 1) {
          handlePartyWipe(send);
        } else {
          handlePlayerDeath(id, send);
        }
        continue;
      }

      if (downed.reviverId >= 0) {
        const reviverPos = world.getComponent<PositionComponent>(downed.reviverId, C.Position);
        const myPos = world.getComponent<PositionComponent>(id, C.Position);
        const reviverDowned = world.hasComponent(downed.reviverId, C.Downed);

        if (!reviverPos || !myPos || reviverDowned) {
          downed.reviverId = -1;
          downed.reviveProgress = 0;
          broadcastReviveProgress(id, 0, -1, send);
        } else {
          const rdx = reviverPos.x - myPos.x;
          const rdy = reviverPos.y - myPos.y;
          if (rdx * rdx + rdy * rdy > REVIVE_RANGE * REVIVE_RANGE) {
            downed.reviverId = -1;
            downed.reviveProgress = 0;
            broadcastReviveProgress(id, 0, -1, send);
          } else {
            downed.reviveProgress += dt;
            broadcastReviveProgress(id, downed.reviveProgress / REVIVE_DURATION, downed.reviverId, send);
            if (downed.reviveProgress >= REVIVE_DURATION) {
              revivePlayer(id, send);
            }
          }
        }
      }
    }
  }

  function tickRespawnTimers(dt: number, send: SendFn): void {
    for (const [clientId, timer] of respawnTimers) {
      const remaining = timer - dt;
      if (remaining <= 0) {
        respawnTimers.delete(clientId);
        respawnPlayer(clientId, send);
      } else {
        respawnTimers.set(clientId, remaining);
      }
    }
  }

  /** Tick resurrection queue (Undying Horde W50+). */
  function tickResurrections(dt: number): void {
    for (let i = resurrectionQueue.length - 1; i >= 0; i--) {
      resurrectionQueue[i].timer -= dt;
      if (resurrectionQueue[i].timer <= 0) {
        const { x, y } = resurrectionQueue[i];
        // Find safe position in case a building was placed on the death spot
        const safe = deps.findSafeSpawnNear(x, y);
        deps.spawnEnemyAt?.(safe.x, safe.y);
        resurrectionQueue.splice(i, 1);
      }
    }
  }

  return {
    destroyDeadEntities,
    tickDownedPlayers,
    tickRespawnTimers,
    tickResurrections,
    checkPlayerDowned,
    countAlivePlayers,
    findSessionPlayerByEntity,
  };
}

export type RespawnManager = ReturnType<typeof createRespawnManager>;
