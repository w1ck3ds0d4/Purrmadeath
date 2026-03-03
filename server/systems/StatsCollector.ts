import type { RunStats } from '@shared/definitions/MetaStats';
import type { SessionPlayer } from '../core/GameSession';
import type { WaveState } from './WaveController';

// -- Dependencies ------------------------------------------------------------

export interface StatsCollectorDeps {
  players: Map<string, SessionPlayer>;
  waveState: WaveState;
  buildingsByPlayer: Map<string, number>;
  getElapsedSeconds: () => number;
}

// -- Factory -----------------------------------------------------------------

export function createStatsCollector(deps: StatsCollectorDeps) {
  const { players, waveState, buildingsByPlayer } = deps;

  const damageByPlayer = new Map<string, number>();
  const resourcesByPlayer = new Map<string, { wood: number; stone: number; iron: number; diamond: number }>();
  const killsByPlayer = new Map<string, Record<string, number>>();

  // Tracks what was already merged per player to avoid double-counting
  const mergedSnapshot = new Map<string, RunStats>();

  function playerIdForEntity(entityId: number): string | undefined {
    for (const p of players.values()) {
      if (p.entityId === entityId) return p.playerId;
    }
    return undefined;
  }

  function trackDamage(attackerEntityId: number, damage: number): void {
    const pid = playerIdForEntity(attackerEntityId);
    if (!pid) return;
    damageByPlayer.set(pid, (damageByPlayer.get(pid) ?? 0) + damage);
  }

  function trackKill(attackerEntityId: number, enemyVariant: string): void {
    const pid = playerIdForEntity(attackerEntityId);
    if (!pid) return;
    let kills = killsByPlayer.get(pid);
    if (!kills) { kills = {}; killsByPlayer.set(pid, kills); }
    kills[enemyVariant] = (kills[enemyVariant] ?? 0) + 1;
  }

  function trackResources(playerId: string, itemType: string, quantity: number): void {
    if (itemType !== 'wood' && itemType !== 'stone' && itemType !== 'iron' && itemType !== 'diamond') return;
    let pr = resourcesByPlayer.get(playerId);
    if (!pr) { pr = { wood: 0, stone: 0, iron: 0, diamond: 0 }; resourcesByPlayer.set(playerId, pr); }
    pr[itemType as 'wood' | 'stone' | 'iron' | 'diamond'] += quantity;
  }

  /** Get the absolute (total) stats for a player this run. */
  function absoluteStatsForPlayer(pid: string): RunStats {
    const timePlayed = Math.round(deps.getElapsedSeconds());
    const res = resourcesByPlayer.get(pid);
    const kills = killsByPlayer.get(pid);
    return {
      damageDealt: damageByPlayer.get(pid) ?? 0,
      resourcesGathered: res ? { ...res } : { wood: 0, stone: 0, iron: 0, diamond: 0 },
      enemiesKilled: Object.values(kills ?? {}).reduce((a, b) => a + b, 0),
      killsByType: kills ? { ...kills } : {},
      wavesSurvived: Math.max(0, waveState.currentWave - 1),
      timePlayed,
      buildingsBuilt: buildingsByPlayer.get(pid) ?? 0,
    };
  }

  /**
   * Compute the delta between current absolute stats and the last merged snapshot.
   * This prevents double-counting when stats are merged multiple times during a run
   * (e.g. on save, on player disconnect, and on game over).
   */
  function deltaForPlayer(pid: string): RunStats {
    const current = absoluteStatsForPlayer(pid);
    const prev = mergedSnapshot.get(pid);
    if (!prev) return current;

    const deltaKills: Record<string, number> = {};
    for (const [type, count] of Object.entries(current.killsByType)) {
      const prevCount = prev.killsByType[type] ?? 0;
      if (count - prevCount > 0) deltaKills[type] = count - prevCount;
    }

    return {
      damageDealt: current.damageDealt - prev.damageDealt,
      resourcesGathered: {
        wood: current.resourcesGathered.wood - prev.resourcesGathered.wood,
        stone: current.resourcesGathered.stone - prev.resourcesGathered.stone,
        iron: current.resourcesGathered.iron - prev.resourcesGathered.iron,
        diamond: current.resourcesGathered.diamond - prev.resourcesGathered.diamond,
      },
      enemiesKilled: current.enemiesKilled - prev.enemiesKilled,
      killsByType: deltaKills,
      wavesSurvived: current.wavesSurvived,
      timePlayed: current.timePlayed - prev.timePlayed,
      buildingsBuilt: current.buildingsBuilt - prev.buildingsBuilt,
    };
  }

  /**
   * Build delta RunStats for all active players and record their current totals
   * so subsequent calls only return the new delta. Safe to call multiple times.
   */
  function buildRunStats(): Map<string, RunStats> {
    const statsMap = new Map<string, RunStats>();
    for (const p of players.values()) {
      const pid = p.playerId;
      const delta = deltaForPlayer(pid);
      statsMap.set(pid, delta);
      // Snapshot current totals so next call only returns the new delta
      mergedSnapshot.set(pid, absoluteStatsForPlayer(pid));
    }
    return statsMap;
  }

  /**
   * Build delta RunStats for a single player (e.g. on disconnect).
   * Records snapshot to prevent double-counting if called again later.
   */
  function buildRunStatsForPlayer(playerId: string): RunStats | null {
    // Check the player exists or at least has tracked data
    const hasDamage = damageByPlayer.has(playerId);
    const hasResources = resourcesByPlayer.has(playerId);
    const hasKills = killsByPlayer.has(playerId);
    const hasBuildings = buildingsByPlayer.has(playerId);
    if (!hasDamage && !hasResources && !hasKills && !hasBuildings) return null;

    const delta = deltaForPlayer(playerId);
    mergedSnapshot.set(playerId, absoluteStatsForPlayer(playerId));
    return delta;
  }

  return {
    trackDamage,
    trackKill,
    trackResources,
    buildRunStats,
    buildRunStatsForPlayer,
  };
}

export type StatsCollector = ReturnType<typeof createStatsCollector>;
