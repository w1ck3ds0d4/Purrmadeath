// ---------------------------------------------------------------------------
// WorldEventController - dramatic events that roll at the start of each day
// ---------------------------------------------------------------------------

import { World } from '@shared/ecs/World';
import { C, PositionComponent, HealthComponent, BuildingComponent } from '@shared/components';
import type { StunEffectComponent } from '@shared/components';
import { MessageType } from '@shared/protocol';
import type { AoeExplosionMessage, MeteorWarningMessage, DayEventRollMessage, WorldEventStartMessage, WorldEventEndMessage } from '@shared/protocol';
import { WORLD_EVENTS, pickWorldEvent, type WorldEventId } from '@shared/definitions/WorldEvents';
import type { SendFn, SessionPlayer } from '../core/GameSession';

// ── Constants ───────────────────────────────────────────────────────────────

const EVENT_CHANCE = 0.25;               // 25% chance per day start
const ROULETTE_DELAY = 3.5;             // seconds to wait for roulette animation before activating

const METEOR_TICK_INTERVAL = 1;          // seconds between meteor strikes
const METEOR_DAMAGE = 20;
const METEOR_RADIUS = 60;
const METEOR_COUNT = 1;                  // one meteor per tick
const METEOR_SPAWN_RANGE = 300;          // max distance from player center
const METEOR_WARNING_DELAY = 1.5;        // seconds warning before impact

const BLOOD_MOON_DAMAGE_MULT = 1.25;
const BLOOD_MOON_TINT = 0x330808;

const EARTHQUAKE_BUILDING_DAMAGE = 30;
const EARTHQUAKE_BUILDING_COUNT = 3;     // max buildings damaged
const EARTHQUAKE_STUN_DURATION = 0.5;
const EARTHQUAKE_SHAKE_INTENSITY = 12;
const EARTHQUAKE_REPEAT_INTERVAL = 30;   // seconds between quakes

const RESOURCE_BOOM_PRODUCTION_MULT = 3.0;

const PORTAL_SURGE_EXTRA = 3;

const ECLIPSE_TINT = 0x1a0808;           // dark red darkness
const ECLIPSE_SPAWN_INTERVAL = 4;        // seconds between undead spawns
const ECLIPSE_SPAWN_COUNT = 2;           // undead per spawn tick
const ECLIPSE_SPAWN_RANGE = 250;         // max distance from player center

// ── Deps ────────────────────────────────────────────────────────────────────

export interface WorldEventDeps {
  world: World;
  players: Map<string, SessionPlayer>;
  getCurrentWave: () => number;
  getPlayerCenter: () => { x: number; y: number } | null;
  /** Spawn extra portals (portal surge). */
  spawnExtraPortals: (count: number, send: SendFn) => void;
  /** Spawn an enemy at position with faction (for eclipse undead). */
  spawnEnemy: (x: number, y: number, faction: string) => number | null;
  isWalkable: (wx: number, wy: number) => boolean;
  overlapsBuilding: (wx: number, wy: number, radius?: number) => boolean;
  overlapsResourceNode: (wx: number, wy: number, radius?: number) => boolean;
  /** Process entity deaths (handles player downed, entity removal, etc). */
  destroyDeadEntities: (deaths: number[], attackerMap: Map<number, number> | undefined, send: SendFn) => void;
  /** Called when an event ends naturally (timer expired, not force-ended). */
  onEventComplete?: (eventId: string, send: SendFn) => void;
}

// ── Factory ─────────────────────────────────────────────────────────────────

interface PendingMeteor { x: number; y: number; timer: number; }

export function createWorldEventController(deps: WorldEventDeps) {
  const { world, players } = deps;

  let activeEvent: WorldEventId | null = null;
  let eventTimer = 0;
  let meteorTickTimer = 0;
  let eclipseSpawnTimer = 0;
  let earthquakeRepeatTimer = 0;
  let portalSurgeTimer = 0;
  const pendingMeteors: PendingMeteor[] = [];
  // Pending event waiting for roulette animation to finish
  let pendingEvent: WorldEventId | null = null;
  let pendingTimer = 0;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function broadcast(send: SendFn, msg: object): void {
    for (const p of players.values()) send(p.client, msg);
  }

  function startEvent(eventId: WorldEventId, send: SendFn): void {
    const def = WORLD_EVENTS[eventId];
    activeEvent = eventId;
    eventTimer = def.duration;
    meteorTickTimer = 0;

    const msg: WorldEventStartMessage = {
      type: MessageType.WORLD_EVENT_START,
      eventId: def.id,
      name: def.name,
      description: def.description,
      duration: def.duration,
    };

    // Attach event-specific payload
    switch (eventId) {
      case 'blood_moon':
        msg.tintColor = BLOOD_MOON_TINT;
        msg.damageMult = BLOOD_MOON_DAMAGE_MULT;
        break;
      case 'earthquake':
        msg.shakeIntensity = EARTHQUAKE_SHAKE_INTENSITY;
        earthquakeRepeatTimer = EARTHQUAKE_REPEAT_INTERVAL;
        applyEarthquake(send);
        break;
      case 'resource_boom':
        msg.productionMult = RESOURCE_BOOM_PRODUCTION_MULT;
        break;
      case 'portal_surge':
        deps.spawnExtraPortals(PORTAL_SURGE_EXTRA, send);
        portalSurgeTimer = 30;
        break;
      case 'solar_eclipse':
        msg.tintColor = ECLIPSE_TINT;
        msg.visionMult = 0.4;
        eclipseSpawnTimer = ECLIPSE_SPAWN_INTERVAL;
        break;
    }

    broadcast(send, msg);
    console.log(`[WorldEvent] Started: ${def.name} (${def.duration}s)`);

    // Portal surge used to be instant - now it keeps spawning portals
  }

  function endEvent(send: SendFn): void {
    if (!activeEvent) return;
    const msg: WorldEventEndMessage = {
      type: MessageType.WORLD_EVENT_END,
      eventId: activeEvent,
    };
    broadcast(send, msg);
    console.log(`[WorldEvent] Ended: ${activeEvent}`);
    activeEvent = null;
    eventTimer = 0;
  }

  function applyEarthquake(send: SendFn): void {
    // Damage random buildings
    const buildings: number[] = [];
    for (const eid of world.query(C.Building, C.Health)) {
      buildings.push(eid);
    }
    // Shuffle and take up to EARTHQUAKE_BUILDING_COUNT
    for (let i = buildings.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [buildings[i], buildings[j]] = [buildings[j], buildings[i]];
    }
    const targets = buildings.slice(0, Math.min(EARTHQUAKE_BUILDING_COUNT, buildings.length));
    for (const eid of targets) {
      const hp = world.getComponent<HealthComponent>(eid, C.Health);
      if (hp) {
        hp.current = Math.max(1, hp.current - EARTHQUAKE_BUILDING_DAMAGE);
      }
    }

    // Stun all enemies briefly
    for (const eid of world.query(C.Faction)) {
      const f = world.getComponent<import('@shared/components').FactionComponent>(eid, C.Faction);
      if (f?.type === 'enemy') {
        const existing = world.getComponent<StunEffectComponent>(eid, C.StunEffect);
        if (existing) {
          existing.remaining = Math.max(existing.remaining, EARTHQUAKE_STUN_DURATION);
        } else {
          world.addComponent(eid, C.StunEffect, { remaining: EARTHQUAKE_STUN_DURATION, sourceId: -1 });
        }
      }
    }
  }

  function tickMeteorShower(dt: number, send: SendFn): void {
    // Spawn new meteor warnings on interval
    meteorTickTimer -= dt;
    if (meteorTickTimer <= 0) {
      meteorTickTimer = METEOR_TICK_INTERVAL;
      const center = deps.getPlayerCenter();
      if (center) {
        for (let i = 0; i < METEOR_COUNT; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * METEOR_SPAWN_RANGE;
          const mx = center.x + Math.cos(angle) * dist;
          const my = center.y + Math.sin(angle) * dist;
          pendingMeteors.push({ x: mx, y: my, timer: METEOR_WARNING_DELAY });
          // Send warning to clients (red circle on ground)
          const warn: MeteorWarningMessage = {
            type: MessageType.METEOR_WARNING,
            x: mx, y: my, radius: METEOR_RADIUS,
            delay: METEOR_WARNING_DELAY,
          };
          broadcast(send, warn);
        }
      }
    }

    // Tick pending meteors and apply impact when timer expires
    for (let i = pendingMeteors.length - 1; i >= 0; i--) {
      pendingMeteors[i].timer -= dt;
      if (pendingMeteors[i].timer <= 0) {
        const m = pendingMeteors.splice(i, 1)[0];
        // Damage ALL entities in radius (players, enemies, buildings)
        const deaths: number[] = [];
        for (const eid of world.query(C.Position, C.Health)) {
          const pos = world.getComponent<PositionComponent>(eid, C.Position)!;
          const dx = pos.x - m.x, dy = pos.y - m.y;
          if (dx * dx + dy * dy <= METEOR_RADIUS * METEOR_RADIUS) {
            const hp = world.getComponent<HealthComponent>(eid, C.Health)!;
            hp.current = Math.max(0, hp.current - METEOR_DAMAGE);
            if (hp.current <= 0) deaths.push(eid);
          }
        }
        // Broadcast explosion VFX
        const aoeMsg: AoeExplosionMessage = {
          type: MessageType.AOE_EXPLOSION,
          x: m.x, y: m.y, radius: METEOR_RADIUS,
          meteor: true,
        };
        broadcast(send, aoeMsg);
        // Process deaths (handles player downed state, entity cleanup)
        if (deaths.length > 0) {
          deps.destroyDeadEntities(deaths, undefined, send);
        }
      }
    }
  }

  function tickEarthquake(dt: number, send: SendFn): void {
    earthquakeRepeatTimer -= dt;
    if (earthquakeRepeatTimer > 0) return;
    earthquakeRepeatTimer = EARTHQUAKE_REPEAT_INTERVAL;
    applyEarthquake(send);
    // Re-send shake to clients
    const shakeMsg: WorldEventStartMessage = {
      type: MessageType.WORLD_EVENT_START,
      eventId: 'earthquake',
      name: 'Earthquake',
      description: 'Quakes every 30s, damages buildings',
      duration: 3,
      shakeIntensity: EARTHQUAKE_SHAKE_INTENSITY,
    };
    broadcast(send, shakeMsg);
  }

  function tickPortalSurge(dt: number, send: SendFn): void {
    portalSurgeTimer -= dt;
    if (portalSurgeTimer > 0) return;
    portalSurgeTimer = 30;
    const count = 1 + Math.floor(Math.random() * 3); // 1-3 portals
    deps.spawnExtraPortals(count, send);
  }

  function tickSolarEclipse(dt: number): void {
    eclipseSpawnTimer -= dt;
    if (eclipseSpawnTimer > 0) return;
    eclipseSpawnTimer = ECLIPSE_SPAWN_INTERVAL;

    const center = deps.getPlayerCenter();
    if (!center) return;

    for (let i = 0; i < ECLIPSE_SPAWN_COUNT; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 80 + Math.random() * ECLIPSE_SPAWN_RANGE;
        const sx = center.x + Math.cos(angle) * dist;
        const sy = center.y + Math.sin(angle) * dist;
        if (!deps.isWalkable(sx, sy) || deps.overlapsBuilding(sx, sy, 10) || deps.overlapsResourceNode(sx, sy, 10)) continue;
        deps.spawnEnemy(sx, sy, 'undead');
        break;
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  return {
    /** Tick active event and pending roulette delay. */
    tick(dt: number, send: SendFn): void {
      // Countdown for pending roulette animation
      if (pendingEvent) {
        pendingTimer -= dt;
        if (pendingTimer <= 0) {
          const evt = pendingEvent;
          pendingEvent = null;
          pendingTimer = 0;
          startEvent(evt, send);
        }
      }

      if (!activeEvent) return;

      if (activeEvent === 'meteor_shower') {
        tickMeteorShower(dt, send);
      }
      if (activeEvent === 'solar_eclipse') {
        tickSolarEclipse(dt);
      }
      if (activeEvent === 'earthquake') {
        tickEarthquake(dt, send);
      }
      if (activeEvent === 'portal_surge') {
        tickPortalSurge(dt, send);
      }

      eventTimer -= dt;
      if (eventTimer <= 0) {
        const completedId = activeEvent;
        endEvent(send);
        if (completedId && deps.onEventComplete) deps.onEventComplete(completedId, send);
      }
    },

    /** Roll a random event at the start of a new day (25% chance, wave 2+). */
    rollDayEvent(wave: number, send: SendFn): void {
      // No events on the very first day (wave 1)
      if (wave < 2) return;

      let eventId: WorldEventId | null = null;
      if (Math.random() <= EVENT_CHANCE) {
        eventId = pickWorldEvent(wave);
      }

      // Always send the roll result so the client can show the roulette
      const rollMsg: DayEventRollMessage = {
        type: MessageType.DAY_EVENT_ROLL,
        eventId: eventId,
        eventName: eventId ? WORLD_EVENTS[eventId].name : null,
      };
      broadcast(send, rollMsg);

      if (eventId) {
        // Queue event activation after roulette animation finishes
        pendingEvent = eventId;
        pendingTimer = ROULETTE_DELAY;
      }
    },

    /** Get event-driven enemy damage multiplier. */
    getEventBuffs(): { damageMult: number } {
      if (activeEvent === 'blood_moon') return { damageMult: BLOOD_MOON_DAMAGE_MULT };
      return { damageMult: 1.0 };
    },

    /** Get event-driven production multiplier. */
    getProductionMult(): number {
      if (activeEvent === 'resource_boom') return RESOURCE_BOOM_PRODUCTION_MULT;
      return 1.0;
    },

    /** Whether an event forces darkness + night buffs (solar eclipse or blood moon). */
    isSolarEclipse(): boolean {
      return activeEvent === 'solar_eclipse' || activeEvent === 'blood_moon';
    },

    /** Force-start a specific event (debug command). */
    forceEvent(eventId: WorldEventId, send: SendFn): void {
      if (!WORLD_EVENTS[eventId]) return;
      if (activeEvent) endEvent(send);
      startEvent(eventId, send);
    },

    /** End any active event (call on wave clear or game reset). */
    endActiveEvent(send: SendFn): void {
      pendingEvent = null;
      pendingTimer = 0;
      if (activeEvent) endEvent(send);
    },

    /** Get the active event ID (for save/restore). */
    getActiveEvent(): WorldEventId | null {
      return activeEvent;
    },

    /** Reset all state (new game). */
    reset(): void {
      activeEvent = null;
      eventTimer = 0;
      meteorTickTimer = 0;
      eclipseSpawnTimer = 0;
      earthquakeRepeatTimer = 0;
      portalSurgeTimer = 0;
      pendingMeteors.length = 0;
      pendingEvent = null;
      pendingTimer = 0;
    },
  };
}

export type WorldEventController = ReturnType<typeof createWorldEventController>;
