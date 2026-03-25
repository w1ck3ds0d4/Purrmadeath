import { World } from '@shared/ecs/World';
import { WorldGenerator } from '@shared/world/WorldGenerator';
import {
  C,
  PositionComponent,
  HealthComponent,
  FactionComponent,
  EnemyVariantComponent,
} from '@shared/components';
import type { EnemyVariantType, EnemyStatsComponent, TitanRallyComponent } from '@shared/components';
import {
  ENEMY_VARIANT_STATS, pickEnemyVariant, ENEMY_VARIANT_NAMES,
  pickWaveFactions, pickEnemyVariantForFaction,
  FACTION_INTRO_MESSAGES,
  type EnemyFaction,
} from '@shared/definitions/EnemyVariants';
import {
  TILE_SIZE,
  PORTAL_BASE_HP,
  PORTAL_HP_PER_WAVE,
  PORTAL_BASE_SPAWN_INTERVAL,
  PORTAL_SPAWN_INTERVAL_DECAY,
  PORTALS_PER_WAVE_BASE,
  PORTALS_PER_WAVE_GROWTH,
  PORTAL_MIN_DIST,
  PORTAL_MAX_DIST,
  PORTAL_MIN_SPACING,
  PORTAL_RADIUS,
  ENEMY_RADIUS,
  ENEMY_HP_SCALE_PER_WAVE,
  ENEMY_DAMAGE_SCALE_PER_WAVE,
  PORTAL_EXTRA_SPAWN_EVERY_N_WAVES,
} from '@shared/constants';
import { MessageType } from '@shared/protocol';
import type { WaveStartMessage, WaveEndMessage, WaveTimerSyncMessage } from '@shared/protocol';
import type { ConnectedClient } from '../net/ServerSocket';
import type { SessionPlayer, SendFn } from '../core/GameSession';
import type { ModifierAggregate } from '@shared/definitions/WaveModifiers';
import type { PortalSystem } from './PortalSystem';
import type { DayNightController } from './DayNightController';

// ── Mutable state shared with GameSession ───────────────────────────────────

export interface WaveState {
  phase: 'idle' | 'prep' | 'active';
  currentWave: number;
  /** @deprecated Prep timer is now managed by DayNightController's day phase. */
  prepTimer: number;
  paused: boolean;
  syncTimer: number;
  enemyCount: number;
  wipeCount: number;
  introducedTypes: Set<EnemyVariantType>;
  introducedFactions: Set<string>;
  pendingIntros: { variant: string; displayName: string }[];
}

// ── Dependencies ────────────────────────────────────────────────────────────

export interface WaveControllerDeps {
  world: World;
  generator: WorldGenerator;
  portal: PortalSystem;
  state: WaveState;
  players: Map<string, SessionPlayer>;
  cards: {
    debuffs: { enemyDamageMult: number; enemySpeedMult: number; enemyKnockbackMult: number; guaranteedTitans: number };
  };
  /** Night enemy buff multipliers from DayNightController. */
  getNightBuffs: () => { damageMult: number; speedMult: number };
  /** Wave modifier multipliers (defaults all 1.0 when no modifiers). */
  getModifierMults: () => ModifierAggregate;
  /** World event damage buff (Blood Moon = 1.25). */
  getEventDamageMult?: () => number;
  maxEnemies: number;
  waveSyncInterval: number;
  isWalkable: (wx: number, wy: number) => boolean;
  overlapsBuilding: (wx: number, wy: number, radius?: number) => boolean;
  /** Check if a position overlaps a resource node. */
  overlapsResourceNode: (wx: number, wy: number, radius?: number) => boolean;
  onWaveCleared: (wave: number, send: SendFn) => void;
  /** Get campfire position for portal spawning (portals spawn around campfire, not players). */
  getCampfirePosition: () => { x: number; y: number } | null;
  /** Check if a world position is inside the building range square. */
  isInsideBuildRange: (wx: number, wy: number) => boolean;
  /** Whether the campfire has been placed. */
  isCampfirePlaced: () => boolean;
  /** Get the current build range half-extent in pixels (campfire base + watchtower bonuses). */
  getBuildRangeHalfExtent: () => number;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createWaveController(deps: WaveControllerDeps) {
  const {
    world, generator, portal,
    players, cards,
    isWalkable, overlapsBuilding, onWaveCleared,
  } = deps;
  const s = deps.state;

  /** Maps portal entity ID → assigned faction for that portal. */
  const portalFactions = new Map<number, EnemyFaction>();

  /** Grace period after wave activation - prevents instant clear if portals fail to spawn. */
  let activationGraceTicks = 0;

  // ── Portal spawning ──────────────────────────────────────────────────────

  function spawnPortal(x: number, y: number, wave: number): number {
    const hp = PORTAL_BASE_HP + PORTAL_HP_PER_WAVE * wave;
    const interval = PORTAL_BASE_SPAWN_INTERVAL * Math.pow(PORTAL_SPAWN_INTERVAL_DECAY, wave - 1);
    const id = world.createEntity();
    world.addComponent(id, C.Position, { x, y });
    world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
    world.addComponent(id, C.Health, { current: hp, max: hp });
    world.addComponent(id, C.Faction, { type: 'portal', enemyFaction: undefined });
    world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    world.addComponent(id, C.Portal, { waveNumber: wave, spawnTimer: interval, spawnInterval: interval });
    return id;
  }

  function spawnPortals(wave: number): void {
    // Portals spawn around the campfire, not around players
    const campfire = deps.getCampfirePosition();
    let cx: number, cy: number;
    if (campfire) {
      cx = campfire.x;
      cy = campfire.y;
    } else {
      // Fallback to player center if campfire doesn't exist
      cx = 0; cy = 0; let count = 0;
      for (const p of players.values()) {
        if (p.entityId === null) continue;
        const pos = world.getComponent<PositionComponent>(p.entityId, C.Position);
        if (pos) { cx += pos.x; cy += pos.y; count++; }
      }
      if (count === 0) {
        console.warn(`[Wave] No campfire or players found - cannot spawn portals for wave ${wave}`);
        return;
      }
      cx /= count; cy /= count;
    }

    const factions = pickWaveFactions(wave);
    // Introduce new factions with toast messages
    for (const f of factions) {
      if (!s.introducedFactions.has(f) && f !== 'bandits') {
        s.introducedFactions.add(f);
        s.pendingIntros.push({ variant: f, displayName: FACTION_INTRO_MESSAGES[f] });
      }
    }

    const mods = deps.getModifierMults();
    const numPortals = Math.ceil((PORTALS_PER_WAVE_BASE + PORTALS_PER_WAVE_GROWTH * (wave - 1)) * mods.enemyCountMult);
    const placed: { x: number; y: number }[] = [];

    // Dynamic min distance: portals must spawn outside the building range square.
    // Use diagonal distance (center to corner of square) to ensure corners are cleared.
    const buildRangeHE = deps.getBuildRangeHalfExtent();
    const buildRangeDiag = buildRangeHE > 0 ? Math.ceil(Math.sqrt(2) * buildRangeHE) : 0;
    const effectiveMinDist = Math.max(PORTAL_MIN_DIST, buildRangeDiag + 100);
    const effectiveMaxDist = Math.max(effectiveMinDist + 400, PORTAL_MAX_DIST);

    for (let i = 0; i < numPortals; i++) {
      let bestX = 0, bestY = 0, found = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = effectiveMinDist + Math.random() * (effectiveMaxDist - effectiveMinDist);
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;

        if (!isWalkable(px, py)) continue;
        if (overlapsBuilding(px, py, PORTAL_RADIUS)) continue;
        if (deps.overlapsResourceNode(px, py, PORTAL_RADIUS)) continue;
        // Portals cannot spawn inside the building range square
        if (deps.isInsideBuildRange(px, py)) continue;

        let tooClose = false;
        for (const prev of placed) {
          const ddx = px - prev.x, ddy = py - prev.y;
          if (ddx * ddx + ddy * ddy < PORTAL_MIN_SPACING * PORTAL_MIN_SPACING) { tooClose = true; break; }
        }
        if (tooClose) continue;

        bestX = px; bestY = py; found = true; break;
      }
      if (found) {
        // Assign faction to this portal (round-robin across active factions)
        const faction = factions[i % factions.length];
        const portalId = spawnPortal(bestX, bestY, wave);
        portalFactions.set(portalId, faction);
        // Tag portal entity with its faction so the client can color it
        const pFaction = world.getComponent<FactionComponent>(portalId, C.Faction);
        if (pFaction) pFaction.enemyFaction = faction;
        placed.push({ x: bestX, y: bestY });
      }
    }
    if (placed.length === 0) {
      console.warn(`[Wave] Failed to place any portals for wave ${wave} (0/${numPortals}) - all attempts blocked`);
    } else {
      console.log(`[Wave] Spawned ${placed.length}/${numPortals} portals for wave ${wave} (factions: ${factions.join(', ')})`);
    }
  }

  // ── Enemy spawning ───────────────────────────────────────────────────────

  function spawnEnemy(x: number, y: number, faction: EnemyFaction = 'bandits'): number | null {
    if (s.enemyCount >= deps.maxEnemies) return null;

    const variant = pickEnemyVariantForFaction(s.currentWave, faction);
    const base = ENEMY_VARIANT_STATS[variant];
    const wave = Math.max(1, s.currentWave);
    const hpMult = Math.pow(1 + ENEMY_HP_SCALE_PER_WAVE, wave - 1);
    const dmgMult = Math.pow(1 + ENEMY_DAMAGE_SCALE_PER_WAVE, wave - 1);
    const nightBuffs = deps.getNightBuffs();
    const mods = deps.getModifierMults();
    const eventDmg = deps.getEventDamageMult?.() ?? 1.0;
    const scaledHp = Math.round(base.hp * hpMult * mods.enemyHpMult);
    const scaledDmg = Math.round(base.damage * dmgMult * cards.debuffs.enemyDamageMult * nightBuffs.damageMult * mods.enemyDamageMult * eventDmg);

    const id = world.createEntity();
    world.addComponent(id, C.Position, { x, y });
    world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
    world.addComponent(id, C.Health, { current: scaledHp, max: scaledHp });
    world.addComponent(id, C.Speed, { base: base.speed, multiplier: cards.debuffs.enemySpeedMult * nightBuffs.speedMult * mods.enemySpeedMult });
    world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
    world.addComponent(id, C.Faction, { type: 'enemy', enemyFaction: faction });
    world.addComponent(id, C.Facing, { angle: 0 });
    world.addComponent(id, C.AttackCooldown, { remaining: 0, max: base.rangedCooldown ?? base.cooldown });
    world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
    world.addComponent(id, C.EnemyVariant, { variant });
    world.addComponent(id, C.EnemyStats, {
      damage: scaledDmg, range: base.range, knockback: Math.round(base.knockback * cards.debuffs.enemyKnockbackMult), radius: base.radius,
      rangedRange: base.rangedRange ?? 0, projectileSpeed: base.projectileSpeed ?? 0,
      rangedDamage: Math.round((base.rangedDamage ?? 0) * dmgMult * cards.debuffs.enemyDamageMult),
      rangedCooldown: base.rangedCooldown ?? base.cooldown,
    });

    if (variant === 'ghost') world.addComponent(id, C.GhostState, { hidden: true });
    if (variant === 'assassin') {
      world.addComponent(id, C.AssassinDash, {
        cooldown: 0, maxCooldown: 20, dashSpeed: 500, dashDuration: 0.3, dashing: false, dashTimer: 0,
      });
    }

    if (!s.introducedTypes.has(variant) && variant !== 'melee' && variant !== 'ranger') {
      s.introducedTypes.add(variant);
      s.pendingIntros.push({ variant, displayName: ENEMY_VARIANT_NAMES[variant] });
    }

    s.enemyCount++;
    return id;
  }

  // ── Titan spawning ──────────────────────────────────────────────────────

  /** Natural titan waves: every 5 waves starting at wave 10. */
  const TITAN_NATURAL_START = 10;
  const TITAN_NATURAL_INTERVAL = 5;

  function isTitanWave(wave: number): boolean {
    return wave >= TITAN_NATURAL_START && (wave - TITAN_NATURAL_START) % TITAN_NATURAL_INTERVAL === 0;
  }

  function spawnTitans(wave: number): void {
    // Natural titan(s) on milestone waves
    let count = isTitanWave(wave) ? 1 : 0;
    // Card-based extra titans every wave
    count += cards.debuffs.guaranteedTitans;
    if (count <= 0) return;

    // Find player center for spawn location
    let cx = 0, cy = 0, pc = 0;
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (pos) { cx += pos.x; cy += pos.y; pc++; }
    }
    if (pc === 0) return;
    cx /= pc; cy /= pc;

    for (let i = 0; i < count; i++) {
      // Find a walkable spawn position at a distance from the player center
      let sx = 0, sy = 0, found = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = PORTAL_MIN_DIST + Math.random() * (PORTAL_MAX_DIST - PORTAL_MIN_DIST);
        sx = cx + Math.cos(angle) * dist;
        sy = cy + Math.sin(angle) * dist;
        if (isWalkable(sx, sy) && !overlapsBuilding(sx, sy, 30)) { found = true; break; }
      }
      if (!found) continue;

      const base = ENEMY_VARIANT_STATS['titan'];
      const hpMult = Math.pow(1 + ENEMY_HP_SCALE_PER_WAVE, wave - 1);
      const dmgMult = Math.pow(1 + ENEMY_DAMAGE_SCALE_PER_WAVE, wave - 1);
      const scaledHp = Math.round(base.hp * hpMult);
      const scaledDmg = Math.round(base.damage * dmgMult * cards.debuffs.enemyDamageMult);

      const id = world.createEntity();
      world.addComponent(id, C.Position, { x: sx, y: sy });
      world.addComponent(id, C.Velocity, { vx: 0, vy: 0 });
      world.addComponent(id, C.Health, { current: scaledHp, max: scaledHp });
      world.addComponent(id, C.Speed, { base: base.speed, multiplier: cards.debuffs.enemySpeedMult });
      world.addComponent(id, C.PlayerInput, { dx: 0, dy: 0, sprint: false });
      world.addComponent(id, C.Faction, { type: 'enemy', enemyFaction: 'bandits' });
      world.addComponent(id, C.Facing, { angle: 0 });
      world.addComponent(id, C.AttackCooldown, { remaining: 0, max: base.cooldown });
      world.addComponent(id, C.KnockbackReceiver, { vx: 0, vy: 0 });
      world.addComponent(id, C.EnemyVariant, { variant: 'titan' });
      world.addComponent(id, C.EnemyStats, {
        damage: scaledDmg, range: base.range, knockback: Math.round(base.knockback * cards.debuffs.enemyKnockbackMult), radius: base.radius,
        rangedRange: 0, projectileSpeed: 0, rangedDamage: 0, rangedCooldown: base.cooldown,
      });
      world.addComponent(id, C.TitanRally, { active: false, range: 350, speedBuff: 1.5 } as TitanRallyComponent);

      if (!s.introducedTypes.has('titan')) {
        s.introducedTypes.add('titan');
        s.pendingIntros.push({ variant: 'titan', displayName: ENEMY_VARIANT_NAMES['titan'] });
      }
      s.enemyCount++;
    }
    console.log(`[Wave] Spawned ${count} Titan(s) for wave ${wave}`);
  }

  // ── Wave timer sync ──────────────────────────────────────────────────────

  function broadcastWaveTimerSync(send: SendFn): void {
    const sync: WaveTimerSyncMessage = {
      type: MessageType.WAVE_TIMER_SYNC,
      waveNumber: s.currentWave,
      remaining: s.phase === 'prep' ? s.prepTimer : -1,
      paused: s.paused,
    };
    for (const p of players.values()) send(p.client, sync);
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  /**
   * Called by DayNightController when night begins → spawn portals and activate wave.
   */
  function activateWave(send: SendFn): void {
    if (s.phase !== 'prep') return;
    spawnPortals(s.currentWave);
    spawnTitans(s.currentWave);
    s.phase = 'active';
    // Grace period: don't check wave-clear for a few ticks so portals have time to exist
    activationGraceTicks = 3;
    const waveActive: WaveStartMessage = {
      type: MessageType.WAVE_START, waveNumber: s.currentWave, prepDuration: 0,
    };
    for (const p of players.values()) send(p.client, waveActive);
    console.log(`[Wave] Wave ${s.currentWave} active!`);
  }

  function tick(dt: number, send: SendFn): void {
    if (s.paused) return;

    // Prep phase is now managed by DayNightController (day timer + sleep voting).
    // WaveController only ticks the active phase.
    if (s.phase === 'active') {
      // Tick down activation grace period
      if (activationGraceTicks > 0) {
        activationGraceTicks--;
      }

      const extraSpawns = Math.floor(s.currentWave / PORTAL_EXTRA_SPAWN_EVERY_N_WAVES);
      const spawnRequests = portal.update(world, dt, extraSpawns);
      for (const req of spawnRequests) {
        if (isWalkable(req.x, req.y) && !overlapsBuilding(req.x, req.y, ENEMY_RADIUS)) {
          const faction = portalFactions.get(req.portalId) ?? 'bandits';
          spawnEnemy(req.x, req.y, faction);
        }
      }

      let anyAlive = false;
      for (const id of world.query(C.Portal, C.Health)) {
        const hp = world.getComponent<HealthComponent>(id, C.Health)!;
        if (hp.current > 0) { anyAlive = true; } else { world.destroyEntity(id); }
      }

      if (!anyAlive && activationGraceTicks <= 0) {
        const waveEnd: WaveEndMessage = {
          type: MessageType.WAVE_END, waveNumber: s.currentWave, outcome: 'cleared',
        };
        for (const p of players.values()) send(p.client, waveEnd);

        s.currentWave++;
        s.wipeCount = 0;
        s.phase = 'prep';

        // Notify WaveHUD of next wave prep (day phase handles the timer)
        const waveStart: WaveStartMessage = {
          type: MessageType.WAVE_START, waveNumber: s.currentWave, prepDuration: -1,
        };
        for (const p of players.values()) send(p.client, waveStart);
        console.log(`[Wave] Wave ${s.currentWave - 1} cleared! Day phase begins.`);

        onWaveCleared(s.currentWave - 1, send);
      }
    }
  }

  // ── Debug helpers ────────────────────────────────────────────────────────

  function debugSkip(send: SendFn): void {
    if (s.phase !== 'prep') return;
    // Directly activate the wave (bypasses DayNight controller)
    activateWave(send);
    console.log(`[Debug] Skipping to wave ${s.currentWave}`);
  }

  function debugPause(send: SendFn): void {
    s.paused = !s.paused;
    broadcastWaveTimerSync(send);
    console.log(`[Debug] Wave timer ${s.paused ? 'PAUSED' : 'RESUMED'}`);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Spawn extra portals mid-wave (Portal Surge event). */
  function spawnExtraPortals(count: number, _send: SendFn): void {
    let cx = 0, cy = 0, pc = 0;
    for (const p of players.values()) {
      if (p.entityId === null) continue;
      const pos = world.getComponent<PositionComponent>(p.entityId, C.Position);
      if (pos) { cx += pos.x; cy += pos.y; pc++; }
    }
    if (pc === 0) return;
    cx /= pc; cy /= pc;

    const factions = pickWaveFactions(s.currentWave);
    let placed = 0;
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 80; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = PORTAL_MIN_DIST + Math.random() * (PORTAL_MAX_DIST - PORTAL_MIN_DIST);
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;
        if (!isWalkable(px, py) || overlapsBuilding(px, py, PORTAL_RADIUS)) continue;
        const portalId = spawnPortal(px, py, s.currentWave);
        const faction = factions[i % factions.length];
        portalFactions.set(portalId, faction);
        const pf = world.getComponent<FactionComponent>(portalId, C.Faction);
        if (pf) pf.enemyFaction = faction;
        placed++;
        break;
      }
    }
    console.log(`[WaveController] Portal Surge: spawned ${placed}/${count} extra portals`);
  }

  return {
    tick,
    activateWave,
    spawnEnemy,
    spawnPortal,
    spawnExtraPortals,
    broadcastWaveTimerSync,
    debugSkip,
    debugPause,
  };
}

export type WaveController = ReturnType<typeof createWaveController>;
