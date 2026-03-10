import { World } from '@shared/ecs/World';
import { distance } from '@shared/math/utils';
import {
  C,
  PositionComponent,
  HealthComponent,
  SpeedComponent,
  PlayerInputComponent,
  CivilianComponent,
  CivilianState,
  WorkerSlotComponent,
  HousingComponent,
  ProductionComponent,
} from '@shared/components';
import type { FactionComponent } from '@shared/components';
import {
  CIVILIAN_SPEED, CIVILIAN_MAX_HP, CIVILIAN_FLEE_SPEED, CIVILIAN_FLEE_RANGE,
  CIVILIAN_WORK_RANGE, CIVILIAN_HUNGER_INTERVAL, CIVILIAN_HUNGER_PER_TICK,
  CIVILIAN_FOOD_CONSUME, CIVILIAN_STARVATION_DAMAGE,
  CIVILIAN_INITIAL_COUNT, CIVILIAN_SPAWN_WAVE_INTERVAL,
  CIVILIAN_MAX_POPULATION, CAMPFIRE_HOUSING_PER_LEVEL, CAMPFIRE_SPAWN_ON_LEVELUP,
  CIVILIAN_SPEECH_DURATION, CAT_NAMES,
  CIVILIAN_RADIUS, buildingHalfExtent, buildingExtent,
  CIVILIAN_SPECIALIZATION_THRESHOLD,
} from '@shared/constants';
import { MessageType } from '@shared/protocol';
import type { CivilianPanelEntry, WorkableBuildingEntry, CivilianPanelStateMessage } from '@shared/protocol';
import type { BuildingComponent } from '@shared/components';
import type { SavedCivilian } from '@shared/SaveFormat';
import type { SessionPlayer, SendFn } from '../core/GameSession';

// ── Dependencies ────────────────────────────────────────────────────────────

export interface CivilianSystemDeps {
  world: World;
  warehousePool: Record<string, number>;
  warehouseIds: Set<number>;
  players: Map<string, SessionPlayer>;
  getCampfirePosition: () => { x: number; y: number } | null;
  getCampfireLevel: () => number;
  broadcastWarehouseUpdate: (send: SendFn) => void;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createCivilianSystem(deps: CivilianSystemDeps) {
  const { world, warehousePool, players } = deps;

  const usedNames = new Set<string>();
  const civilianIds = new Set<number>();
  let lastKnownCampfireLevel = 1;

  // Stuck detection: track last known positions and stuck timers per civilian
  const lastPos = new Map<number, { x: number; y: number }>();
  const stuckTimer = new Map<number, number>();
  const stuckNudgeAngle = new Map<number, number>();
  const STUCK_THRESHOLD = 1.5; // seconds with no progress before nudging
  const STUCK_PROGRESS_MIN = 3; // min pixels moved to count as progress

  // Timer-based civilian spawning (2 civilians every 60 seconds)
  const CIVILIAN_SPAWN_TIMER_INTERVAL = 60; // seconds
  const CIVILIAN_SPAWN_PER_TICK = 2;
  let civilianSpawnTimer = 0;

  // ── Name picker ─────────────────────────────────────────────────────────

  function pickName(): string {
    for (const name of CAT_NAMES) {
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
    return `Cat #${usedNames.size + 1}`;
  }

  // ── Spawn position helper ───────────────────────────────────────────────

  /** Check if a position overlaps any building AABB (with civilian radius margin). */
  function overlapsBuilding(px: number, py: number): boolean {
    for (const id of world.query(C.Building, C.Position)) {
      const bldg = world.getComponent<BuildingComponent>(id, C.Building)!;
      const bp = world.getComponent<PositionComponent>(id, C.Position)!;
      const ext = buildingExtent(bldg.buildingType, bldg.rotation ?? 0);
      const margin = CIVILIAN_RADIUS;
      if (Math.abs(px - bp.x) < ext.hx + margin && Math.abs(py - bp.y) < ext.hy + margin) {
        return true;
      }
    }
    return false;
  }

  /** Find a clear spawn position around a center point, avoiding buildings. */
  function findClearSpawn(cx: number, cy: number, minDist: number, maxDist: number): { x: number; y: number } {
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = minDist + Math.random() * (maxDist - minDist);
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      if (!overlapsBuilding(x, y)) return { x, y };
    }
    // Fallback: return further out
    const angle = Math.random() * Math.PI * 2;
    return { x: cx + Math.cos(angle) * (maxDist + 40), y: cy + Math.sin(angle) * (maxDist + 40) };
  }

  // ── Spawn ───────────────────────────────────────────────────────────────

  function spawnCivilian(x: number, y: number, send: SendFn): number {
    const id = world.createEntity();
    const name = pickName();

    world.addComponent(id, C.Position, { x, y } as PositionComponent);
    world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
    world.addComponent(id, C.Health, { current: CIVILIAN_MAX_HP, max: CIVILIAN_MAX_HP } as HealthComponent);
    world.addComponent(id, C.Speed, { base: CIVILIAN_SPEED, multiplier: 1 } as SpeedComponent);
    world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false } as PlayerInputComponent);
    world.addComponent(id, C.Faction, { type: 'civilian' } as FactionComponent);
    world.addComponent(id, C.Facing, { angle: 0 });
    world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    world.addComponent(id, C.Civilian, {
      name,
      state: 'idle',
      assignedBuildingId: null,
      hunger: 0,
      hungerTimer: 0,
      speechBubble: null,
      speechTimer: 0,
      carryResource: null,
      carryAmount: 0,
      experience: {},
      specialty: null,
    } as CivilianComponent);

    civilianIds.add(id);

    for (const p of players.values()) {
      send(p.client, { type: MessageType.CIVILIAN_SPAWNED, entityId: id, name });
    }

    return id;
  }

  function spawnInitialCivilians(origin: { x: number; y: number }, send: SendFn): void {
    for (let i = 0; i < CIVILIAN_INITIAL_COUNT; i++) {
      const pos = findClearSpawn(origin.x, origin.y, 60, 100);
      spawnCivilian(pos.x, pos.y, send);
    }
    reassignWorkers();
  }

  // ── Enemy proximity ─────────────────────────────────────────────────────

  function findNearestEnemy(x: number, y: number, range: number): { x: number; y: number; dist: number } | null {
    let best: { x: number; y: number; dist: number } | null = null;
    for (const eid of world.query(C.Faction, C.Position)) {
      const f = world.getComponent<FactionComponent>(eid, C.Faction)!;
      if (f.type !== 'enemy') continue;
      const epos = world.getComponent<PositionComponent>(eid, C.Position)!;
      const dx = epos.x - x;
      const dy = epos.y - y;
      const dist = distance(dx, dy);
      if (dist < range && (!best || dist < best.dist)) {
        best = { x: epos.x, y: epos.y, dist };
      }
    }
    return best;
  }

  // ── Warehouse lookup ────────────────────────────────────────────────────

  function findNearestWarehouse(x: number, y: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (const wid of deps.warehouseIds) {
      if (!world.hasEntity(wid)) continue;
      const wpos = world.getComponent<PositionComponent>(wid, C.Position);
      if (!wpos) continue;
      const dx = wpos.x - x;
      const dy = wpos.y - y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: wpos.x, y: wpos.y };
      }
    }
    return best;
  }

  // ── Steering with stuck detection ──────────────────────────────────────

  function steerToward(
    id: number, pos: PositionComponent, input: PlayerInputComponent,
    dx: number, dy: number, dist: number, dt: number,
  ): void {
    // Check if civilian has made progress since last check
    const lp = lastPos.get(id);
    if (lp) {
      const movedX = pos.x - lp.x;
      const movedY = pos.y - lp.y;
      const movedDist = Math.sqrt(movedX * movedX + movedY * movedY);
      if (movedDist < STUCK_PROGRESS_MIN * dt * 30) {
        // Not making progress - increment stuck timer
        const t = (stuckTimer.get(id) ?? 0) + dt;
        stuckTimer.set(id, t);
        if (t > STUCK_THRESHOLD) {
          // Nudge perpendicular to target direction to go around obstacle
          if (!stuckNudgeAngle.has(id)) {
            // Pick a random perpendicular direction (left or right)
            stuckNudgeAngle.set(id, Math.random() < 0.5 ? 1 : -1);
          }
          const side = stuckNudgeAngle.get(id)!;
          const nx = dx / dist;
          const ny = dy / dist;
          // Blend: mostly perpendicular, slightly toward target
          input.dx = -ny * side * 0.8 + nx * 0.2;
          input.dy = nx * side * 0.8 + ny * 0.2;
          // Reset after a full nudge cycle
          if (t > STUCK_THRESHOLD + 1.0) {
            stuckTimer.set(id, 0);
            stuckNudgeAngle.delete(id);
          }
          lastPos.set(id, { x: pos.x, y: pos.y });
          return;
        }
      } else {
        // Making progress - reset stuck state
        stuckTimer.set(id, 0);
        stuckNudgeAngle.delete(id);
      }
    }
    lastPos.set(id, { x: pos.x, y: pos.y });

    // Normal steering: straight toward target
    input.dx = dx / dist;
    input.dy = dy / dist;
  }

  // ── AI tick ─────────────────────────────────────────────────────────────

  let aiTickCounter = 0;

  function tickAI(dt: number, send: SendFn): void {
    aiTickCounter++;
    const campPos = deps.getCampfirePosition();

    let civIdx = 0;
    for (const id of civilianIds) {
      civIdx++;
      if (!world.hasEntity(id)) continue;
      // Downed civilians don't act
      if (world.hasComponent(id, C.Downed)) continue;
      const civ = world.getComponent<CivilianComponent>(id, C.Civilian)!;
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const speed = world.getComponent<SpeedComponent>(id, C.Speed)!;
      const input = world.getComponent<PlayerInputComponent>(id, C.PlayerInput)!;

      // Stagger non-urgent AI: only 1 in 3 civilians do full pathfinding per tick
      // Flee checks always run (urgent). Working/idle movement throttled.
      const doFullAI = (civIdx % 3) === (aiTickCounter % 3);

      // Flee from nearby enemies (overrides everything) - always checked
      const nearestEnemy = findNearestEnemy(pos.x, pos.y, CIVILIAN_FLEE_RANGE);
      if (nearestEnemy) {
        civ.state = 'fleeing';
        speed.base = CIVILIAN_FLEE_SPEED;

        if (campPos) {
          const dx = campPos.x - pos.x;
          const dy = campPos.y - pos.y;
          const dist = distance(dx, dy);
          if (dist > 10) {
            input.dx = dx / dist;
            input.dy = dy / dist;
          } else {
            input.dx = 0;
            input.dy = 0;
          }
        } else {
          // No campfire - run away from enemy
          const dx = pos.x - nearestEnemy.x;
          const dy = pos.y - nearestEnemy.y;
          const dist = distance(dx, dy);
          if (dist > 0) {
            input.dx = dx / dist;
            input.dy = dy / dist;
          }
        }
        continue;
      }

      // Not fleeing - restore normal speed
      speed.base = CIVILIAN_SPEED;

      // Throttle non-urgent AI (pathfinding to buildings, idle wandering)
      if (!doFullAI) continue;

      // Resume delivery if still carrying resources after fleeing
      if (civ.state !== 'delivering' && civ.carryAmount > 0 && civ.carryResource) {
        civ.state = 'delivering';
      }

      if (civ.state === 'delivering') {
        // Carrying resources to the nearest warehouse
        const whPos = findNearestWarehouse(pos.x, pos.y);
        if (!whPos || civ.carryAmount <= 0) {
          civ.state = civ.assignedBuildingId !== null ? 'working' : 'idle';
          civ.carryResource = null;
          civ.carryAmount = 0;
          input.dx = 0;
          input.dy = 0;
          stuckTimer.delete(id);
          continue;
        }

        const dx = whPos.x - pos.x;
        const dy = whPos.y - pos.y;
        const dist = distance(dx, dy);

        const deliveryRange = buildingHalfExtent('warehouse') + CIVILIAN_RADIUS + 16;
        if (dist <= deliveryRange) {
          // Deposit into warehouse pool
          const res = civ.carryResource!;
          if (res in warehousePool) {
            warehousePool[res] = (warehousePool[res] ?? 0) + civ.carryAmount;
            deps.broadcastWarehouseUpdate(send);
          }
          civ.carryResource = null;
          civ.carryAmount = 0;
          civ.state = civ.assignedBuildingId !== null ? 'working' : 'idle';
          input.dx = 0;
          input.dy = 0;
          stuckTimer.delete(id);
        } else {
          // Steer toward warehouse with obstacle avoidance
          steerToward(id, pos, input, dx, dy, dist, dt);
        }
        continue;
      }

      if (civ.assignedBuildingId !== null) {
        // Validate building still exists
        if (!world.hasEntity(civ.assignedBuildingId)) {
          civ.assignedBuildingId = null;
          civ.state = 'idle';
          civ.carryResource = null;
          civ.carryAmount = 0;
          input.dx = 0;
          input.dy = 0;
          stuckTimer.delete(id);
          continue;
        }

        // Move toward assigned building
        const bpos = world.getComponent<PositionComponent>(civ.assignedBuildingId, C.Position);
        if (bpos) {
          const dx = bpos.x - pos.x;
          const dy = bpos.y - pos.y;
          const dist = distance(dx, dy);

          if (dist <= CIVILIAN_WORK_RANGE) {
            civ.state = 'working';
            input.dx = 0;
            input.dy = 0;
            stuckTimer.delete(id);

            // Check if building has stored resources to deliver
            const prod = world.getComponent<ProductionComponent>(civ.assignedBuildingId, C.Production);
            if (prod && prod.stored > 0 && deps.warehouseIds.size > 0) {
              civ.carryResource = prod.resourceType;
              civ.carryAmount = prod.stored;
              prod.stored = 0;
              civ.state = 'delivering';
            }
          } else {
            civ.state = 'working';
            // Steer toward building with obstacle avoidance
            steerToward(id, pos, input, dx, dy, dist, dt);
          }
        }
      } else {
        // No assignment - wander near campfire
        if (campPos && Math.random() < dt * 0.5) {
          const angle = Math.random() * Math.PI * 2;
          const wanderDist = 30 + Math.random() * 50;
          const tx = campPos.x + Math.cos(angle) * wanderDist;
          const ty = campPos.y + Math.sin(angle) * wanderDist;
          const dx = tx - pos.x;
          const dy = ty - pos.y;
          const dist = distance(dx, dy);
          if (dist > 10) {
            input.dx = dx / dist;
            input.dy = dy / dist;
            civ.state = 'wandering';
          }
        } else if (civ.state === 'wandering' && Math.random() < dt * 0.3) {
          civ.state = 'idle';
          input.dx = 0;
          input.dy = 0;
        } else if (civ.state !== 'wandering') {
          civ.state = 'idle';
          input.dx = 0;
          input.dy = 0;
        }
      }
    }
  }

  // ── Hunger tick ─────────────────────────────────────────────────────────

  function tickHunger(dt: number, send: SendFn): void {
    for (const id of civilianIds) {
      if (!world.hasEntity(id)) continue;
      if (world.hasComponent(id, C.Downed)) continue;
      const civ = world.getComponent<CivilianComponent>(id, C.Civilian)!;
      const hp = world.getComponent<HealthComponent>(id, C.Health);

      civ.hungerTimer += dt;
      if (civ.hungerTimer < CIVILIAN_HUNGER_INTERVAL) continue;
      civ.hungerTimer -= CIVILIAN_HUNGER_INTERVAL;

      // Try to eat from warehouse
      if (warehousePool.food >= CIVILIAN_FOOD_CONSUME) {
        warehousePool.food -= CIVILIAN_FOOD_CONSUME;
        civ.hunger = Math.max(0, civ.hunger - 20);
      } else {
        civ.hunger = Math.min(100, civ.hunger + CIVILIAN_HUNGER_PER_TICK);
      }

      // Starvation damage
      if (civ.hunger >= 100 && hp) {
        hp.current -= CIVILIAN_STARVATION_DAMAGE;
        setSpeech(id, civ, "I'm hungry!", send);
      }
    }
  }

  // ── Speech tick ─────────────────────────────────────────────────────────

  function tickSpeech(dt: number): void {
    for (const id of civilianIds) {
      if (!world.hasEntity(id)) continue;
      const civ = world.getComponent<CivilianComponent>(id, C.Civilian)!;
      if (civ.speechTimer > 0) {
        civ.speechTimer -= dt;
        if (civ.speechTimer <= 0) {
          civ.speechBubble = null;
          civ.speechTimer = 0;
        }
      }
    }
  }

  function setSpeech(id: number, civ: CivilianComponent, text: string, send: SendFn): void {
    civ.speechBubble = text;
    civ.speechTimer = CIVILIAN_SPEECH_DURATION;
    for (const p of players.values()) {
      send(p.client, { type: MessageType.CIVILIAN_SPEECH, entityId: id, text });
    }
  }

  // ── Worker assignment ───────────────────────────────────────────────────

  function reassignWorkers(): void {
    // Gather unoccupied production buildings with WorkerSlot
    const unassigned: number[] = [];
    for (const bid of world.query(C.WorkerSlot, C.Position)) {
      const ws = world.getComponent<WorkerSlotComponent>(bid, C.WorkerSlot)!;
      if (ws.workerId !== null) {
        if (!world.hasEntity(ws.workerId)) {
          ws.workerId = null;
        } else {
          continue;
        }
      }
      unassigned.push(bid);
    }

    // Find idle civilians
    const idleCivs: number[] = [];
    for (const cid of civilianIds) {
      if (!world.hasEntity(cid)) continue;
      const civ = world.getComponent<CivilianComponent>(cid, C.Civilian)!;
      if (civ.assignedBuildingId === null) {
        idleCivs.push(cid);
      }
    }

    // Assign nearest idle civilian to each unoccupied building
    for (const bid of unassigned) {
      if (idleCivs.length === 0) break;
      const bpos = world.getComponent<PositionComponent>(bid, C.Position)!;

      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < idleCivs.length; i++) {
        const cpos = world.getComponent<PositionComponent>(idleCivs[i], C.Position)!;
        const dx = cpos.x - bpos.x;
        const dy = cpos.y - bpos.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        const cid = idleCivs[bestIdx];
        const civ = world.getComponent<CivilianComponent>(cid, C.Civilian)!;
        const ws = world.getComponent<WorkerSlotComponent>(bid, C.WorkerSlot)!;
        civ.assignedBuildingId = bid;
        ws.workerId = cid;
        idleCivs.splice(bestIdx, 1);
      }
    }
  }

  // ── Death handling ──────────────────────────────────────────────────────

  function handleCivilianDeath(entityId: number, send: SendFn): void {
    if (!civilianIds.has(entityId)) return;
    const civ = world.getComponent<CivilianComponent>(entityId, C.Civilian);

    // Clear worker assignment on building
    if (civ?.assignedBuildingId != null) {
      const ws = world.getComponent<WorkerSlotComponent>(civ.assignedBuildingId, C.WorkerSlot);
      if (ws && ws.workerId === entityId) {
        ws.workerId = null;
      }
    }

    if (civ) usedNames.delete(civ.name);
    civilianIds.delete(entityId);
    lastPos.delete(entityId);
    stuckTimer.delete(entityId);
    stuckNudgeAngle.delete(entityId);

    for (const p of players.values()) {
      send(p.client, { type: MessageType.CIVILIAN_DIED, entityId, name: civ?.name ?? 'Unknown' });
    }

    reassignWorkers();
  }

  // ── Main tick ───────────────────────────────────────────────────────────

  function tick(dt: number, send: SendFn): void {
    // Clean up civilians whose entities no longer exist (destroyed by RespawnManager after bleed-out)
    const gone: number[] = [];
    for (const id of civilianIds) {
      if (!world.hasEntity(id)) {
        gone.push(id);
      }
    }
    for (const id of gone) {
      handleCivilianDeath(id, send);
    }
    // Note: civilians with HP <= 0 are NOT killed here.
    // RespawnManager.destroyDeadEntities() adds the Downed component (30s bleed timer).
    // When the bleed timer expires, RespawnManager calls onCivilianDeath and destroys the entity.

    // Note: auto-reassignment removed from periodic tick to avoid overriding manual assignments.
    // Workers are auto-assigned only on civilian spawn, building placed/destroyed, and restore.

    tickAI(dt, send);
    tickHunger(dt, send);
    tickSpeech(dt);
    tickSpeechTriggers(dt, send);
    tickCivilianSpawn(dt, send);
  }

  /** Accumulator for periodic worker reassignment checks. */
  let reassignAccum = 0;

  /** Accumulator for periodic speech checks. */
  let speechCheckTimer = 0;

  function tickSpeechTriggers(dt: number, send: SendFn): void {
    speechCheckTimer += dt;
    if (speechCheckTimer < 5) return; // Check every 5 seconds
    speechCheckTimer -= 5;

    for (const id of civilianIds) {
      if (!world.hasEntity(id)) continue;
      if (world.hasComponent(id, C.Downed)) continue;
      const civ = world.getComponent<CivilianComponent>(id, C.Civilian)!;
      if (civ.speechTimer > 0) continue; // Already talking
      if (Math.random() > 0.3) continue; // Only 30% chance per check

      if (civ.state === 'fleeing') {
        setSpeech(id, civ, 'Help!', send);
      } else if (civ.hunger > 50 && civ.hunger < 100) {
        setSpeech(id, civ, "I'm getting hungry...", send);
      } else if (civ.state === 'idle' && civ.assignedBuildingId === null) {
        const msgs = ['I need a job...', 'Any work for me?', '*yawn*'];
        setSpeech(id, civ, msgs[Math.floor(Math.random() * msgs.length)], send);
      } else if (civ.state === 'delivering') {
        const msgs = ['Delivery!', 'Coming through!', 'Heavy load...'];
        setSpeech(id, civ, msgs[Math.floor(Math.random() * msgs.length)], send);
      } else if (civ.state === 'working' && civ.hunger === 0) {
        const msgs = ['Working hard!', '*purr*', 'This is nice.'];
        setSpeech(id, civ, msgs[Math.floor(Math.random() * msgs.length)], send);
      }
    }

  }

  // ── Civilian spawn timer (runs every frame to accumulate dt correctly) ──

  function tickCivilianSpawn(dt: number, send: SendFn): void {
    civilianSpawnTimer += dt;
    if (civilianSpawnTimer >= CIVILIAN_SPAWN_TIMER_INTERVAL) {
      civilianSpawnTimer = 0;
      const campPos = deps.getCampfirePosition();
      if (campPos) {
        const capacity = getHousingCapacity();
        const currentPop = getCivilianCount();
        const availableSlots = Math.max(0, Math.min(capacity, CIVILIAN_MAX_POPULATION) - currentPop);
        const toSpawn = Math.min(CIVILIAN_SPAWN_PER_TICK, availableSlots);
        for (let i = 0; i < toSpawn; i++) {
          if (getCivilianCount() >= capacity || getCivilianCount() >= CIVILIAN_MAX_POPULATION) break;
          const pos = findClearSpawn(campPos.x, campPos.y, 40, 100);
          spawnCivilian(pos.x, pos.y, send);
        }
        if (toSpawn > 0) reassignWorkers();
      }
    }
  }

  // ── Wave cleared hook ───────────────────────────────────────────────────

  function onWaveCleared(wave: number, send: SendFn): void {
    const campPos = deps.getCampfirePosition();
    if (!campPos) return;

    // Campfire level-up bonus: spawn 2 civilians when campfire is upgraded
    const currentCfLevel = deps.getCampfireLevel();
    let spawnCount = 0;
    if (currentCfLevel > lastKnownCampfireLevel) {
      spawnCount = CAMPFIRE_SPAWN_ON_LEVELUP;
      lastKnownCampfireLevel = currentCfLevel;
    }

    // Spawn campfire bonus civilians (timer handles regular spawning now)
    const capacity = getHousingCapacity();
    for (let i = 0; i < spawnCount; i++) {
      if (getCivilianCount() >= capacity || getCivilianCount() >= CIVILIAN_MAX_POPULATION) break;
      const pos = findClearSpawn(campPos.x, campPos.y, 40, 100);
      spawnCivilian(pos.x, pos.y, send);
    }
    if (spawnCount > 0) reassignWorkers();

    // ── Civilian specialization: increment experience for assigned workers ──
    for (const cid of civilianIds) {
      if (!world.hasEntity(cid)) continue;
      const civ = world.getComponent<CivilianComponent>(cid, C.Civilian)!;
      if (civ.assignedBuildingId === null) continue;
      if (!world.hasEntity(civ.assignedBuildingId)) continue;
      const bldg = world.getComponent<BuildingComponent>(civ.assignedBuildingId, C.Building);
      if (!bldg) continue;
      const bType = bldg.buildingType;
      civ.experience[bType] = (civ.experience[bType] ?? 0) + 1;
      if (civ.specialty === null && civ.experience[bType] >= CIVILIAN_SPECIALIZATION_THRESHOLD) {
        civ.specialty = bType;
        civ.speechBubble = "I'm an expert now!";
        civ.speechTimer = CIVILIAN_SPEECH_DURATION;
        // Broadcast speech
        const speechMsg = { type: MessageType.CIVILIAN_SPEECH, entityId: cid, text: civ.speechBubble };
        for (const p of deps.players.values()) send(p.client, speechMsg);
      }
    }
  }

  // ── Building events ─────────────────────────────────────────────────────

  function onBuildingPlaced(): void {
    reassignWorkers();
  }

  function onBuildingDestroyed(buildingId: number): void {
    for (const cid of civilianIds) {
      if (!world.hasEntity(cid)) continue;
      const civ = world.getComponent<CivilianComponent>(cid, C.Civilian)!;
      if (civ.assignedBuildingId === buildingId) {
        civ.assignedBuildingId = null;
        civ.state = 'idle';
      }
    }
    reassignWorkers();
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  function getCivilianCount(): number {
    let count = 0;
    for (const id of civilianIds) {
      if (world.hasEntity(id)) count++;
    }
    return count;
  }

  function getHousingCapacity(): number {
    const cfLevel = deps.getCampfireLevel();
    let capacity = CAMPFIRE_HOUSING_PER_LEVEL[cfLevel - 1] ?? CAMPFIRE_HOUSING_PER_LEVEL[0];
    for (const id of world.query(C.Housing)) {
      const h = world.getComponent<HousingComponent>(id, C.Housing)!;
      capacity += h.capacity;
    }
    return capacity;
  }

  // ── Panel state (for civilian management UI) ───────────────────────────

  function gatherPanelState(): CivilianPanelStateMessage {
    const civEntries: CivilianPanelEntry[] = [];
    for (const id of civilianIds) {
      if (!world.hasEntity(id)) continue;
      const civ = world.getComponent<CivilianComponent>(id, C.Civilian)!;
      const hp = world.getComponent<HealthComponent>(id, C.Health);
      const downed = world.hasComponent(id, C.Downed);
      let assignedBuildingType: string | null = null;
      if (civ.assignedBuildingId !== null && world.hasEntity(civ.assignedBuildingId)) {
        const bldg = world.getComponent<BuildingComponent>(civ.assignedBuildingId, C.Building);
        assignedBuildingType = bldg?.buildingType ?? null;
      }
      civEntries.push({
        entityId: id,
        name: civ.name,
        state: civ.state,
        hunger: civ.hunger,
        hp: hp?.current ?? 0,
        maxHp: hp?.max ?? 0,
        assignedBuildingId: civ.assignedBuildingId,
        assignedBuildingType,
        downed,
        specialty: civ.specialty ?? null,
      });
    }

    const bldgEntries: WorkableBuildingEntry[] = [];
    for (const bid of world.query(C.WorkerSlot, C.Position)) {
      const ws = world.getComponent<WorkerSlotComponent>(bid, C.WorkerSlot)!;
      const bldg = world.getComponent<BuildingComponent>(bid, C.Building);
      let workerName: string | null = null;
      if (ws.workerId !== null && world.hasEntity(ws.workerId)) {
        const civ = world.getComponent<CivilianComponent>(ws.workerId, C.Civilian);
        workerName = civ?.name ?? null;
      }
      const bType = bldg?.buildingType ?? 'unknown';
      const prod = world.getComponent<ProductionComponent>(bid, C.Production);
      let productionRate = 0;
      let resourceType = '';
      if (prod) {
        // Rate = amount per interval, adjusted if worker assigned
        productionRate = ws.workerId !== null ? prod.amount / prod.interval : 0;
        resourceType = prod.resourceType ?? '';
      } else if (bType === 'repair_station') {
        resourceType = 'repair';
        productionRate = ws.workerId !== null ? 10 : 0; // 10 HP per repair tick
      }
      bldgEntries.push({
        entityId: bid,
        buildingType: bType,
        workerName,
        maxWorkers: 1, // All worker buildings currently have 1 slot
        productionRate,
        resourceType,
        level: bldg?.upgradeLevel ?? 1,
      });
    }

    const pop = getCivilianCount();
    const cap = getHousingCapacity();
    const atCapacity = pop >= cap;
    return {
      type: MessageType.CIVILIAN_PANEL_STATE,
      civilians: civEntries,
      buildings: bldgEntries,
      population: pop,
      housingCapacity: cap,
      nextSpawnSeconds: atCapacity ? 0 : Math.max(0, CIVILIAN_SPAWN_TIMER_INTERVAL - civilianSpawnTimer),
    };
  }

  function handleAssign(civilianId: number, buildingId: number | null): void {
    if (!civilianIds.has(civilianId) || !world.hasEntity(civilianId)) return;
    if (world.hasComponent(civilianId, C.Downed)) return;
    const civ = world.getComponent<CivilianComponent>(civilianId, C.Civilian)!;

    // Unassign from current building first
    if (civ.assignedBuildingId !== null) {
      const oldWs = world.getComponent<WorkerSlotComponent>(civ.assignedBuildingId, C.WorkerSlot);
      if (oldWs && oldWs.workerId === civilianId) oldWs.workerId = null;
    }

    if (buildingId === null) {
      // Unassign
      civ.assignedBuildingId = null;
      civ.state = 'idle';
    } else {
      // Assign to new building
      if (!world.hasEntity(buildingId)) return;
      const ws = world.getComponent<WorkerSlotComponent>(buildingId, C.WorkerSlot);
      if (!ws) return;
      // Evict current worker if occupied
      if (ws.workerId !== null && ws.workerId !== civilianId && world.hasEntity(ws.workerId)) {
        const oldCiv = world.getComponent<CivilianComponent>(ws.workerId, C.Civilian);
        if (oldCiv) { oldCiv.assignedBuildingId = null; oldCiv.state = 'idle'; }
      }
      ws.workerId = civilianId;
      civ.assignedBuildingId = buildingId;
    }
  }

  // ── Save / Restore ──────────────────────────────────────────────────────

  function serialize(): SavedCivilian[] {
    const result: SavedCivilian[] = [];
    for (const id of civilianIds) {
      if (!world.hasEntity(id)) continue;
      const pos = world.getComponent<PositionComponent>(id, C.Position)!;
      const hp = world.getComponent<HealthComponent>(id, C.Health)!;
      const civ = world.getComponent<CivilianComponent>(id, C.Civilian)!;
      result.push({
        x: pos.x, y: pos.y,
        name: civ.name,
        currentHp: hp.current, maxHp: hp.max,
        hunger: civ.hunger,
        state: civ.state,
        experience: civ.experience,
        specialty: civ.specialty,
      });
    }
    return result;
  }

  function restore(civilians: SavedCivilian[]): void {
    for (const sc of civilians) {
      const id = world.createEntity();
      usedNames.add(sc.name);

      world.addComponent(id, C.Position, { x: sc.x, y: sc.y } as PositionComponent);
      world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
      world.addComponent(id, C.Health, { current: sc.currentHp, max: sc.maxHp } as HealthComponent);
      world.addComponent(id, C.Speed, { base: CIVILIAN_SPEED, multiplier: 1 } as SpeedComponent);
      world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false } as PlayerInputComponent);
      world.addComponent(id, C.Faction, { type: 'civilian' } as FactionComponent);
      world.addComponent(id, C.Facing, { angle: 0 });
      world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
      world.addComponent(id, C.Civilian, {
        name: sc.name,
        state: (sc.state || 'idle') as CivilianState,
        assignedBuildingId: null,
        hunger: sc.hunger,
        hungerTimer: 0,
        speechBubble: null,
        speechTimer: 0,
        carryResource: null,
        carryAmount: 0,
        experience: sc.experience ?? {},
        specialty: sc.specialty ?? null,
      } as CivilianComponent);

      civilianIds.add(id);
    }
    reassignWorkers();
  }

  function getSpawnInfo(): { nextSpawnSeconds: number; population: number; capacity: number } {
    const pop = getCivilianCount();
    const cap = getHousingCapacity();
    const atCap = pop >= cap || pop >= CIVILIAN_MAX_POPULATION;
    return {
      nextSpawnSeconds: atCap ? 0 : Math.max(0, CIVILIAN_SPAWN_TIMER_INTERVAL - civilianSpawnTimer),
      population: pop,
      capacity: cap,
    };
  }

  return {
    spawnCivilian,
    spawnInitialCivilians,
    tick,
    onWaveCleared,
    onBuildingPlaced,
    onBuildingDestroyed,
    handleCivilianDeath,
    getCivilianCount,
    getHousingCapacity,
    getSpawnInfo,
    reassignWorkers,
    serialize,
    restore,
    gatherPanelState,
    handleAssign,
    /** Exposed for RespawnManager to detect civilian entities. */
    civilianIds,
  };
}

export type CivilianSystem = ReturnType<typeof createCivilianSystem>;
