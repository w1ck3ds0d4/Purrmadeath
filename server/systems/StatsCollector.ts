import type { RunStats } from '@shared/definitions/MetaStats';
import type { SessionPlayer } from '../core/GameSession';
import type { WaveState } from './WaveController';

// ── Dependencies ────────────────────────────────────────────────────────────

export interface StatsCollectorDeps {
  players: Map<string, SessionPlayer>;
  waveState: WaveState;
  buildingsByPlayer: Map<string, number>;
  getElapsedSeconds: () => number;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createStatsCollector(deps: StatsCollectorDeps) {
  const { players, waveState, buildingsByPlayer } = deps;

  const damageByPlayer = new Map<string, number>();
  const resourcesByPlayer = new Map<string, { wood: number; stone: number; iron: number; diamond: number }>();
  const killsByPlayer = new Map<string, Record<string, number>>();

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

  function buildRunStats(): Map<string, RunStats> {
    const timePlayed = Math.round(deps.getElapsedSeconds());
    const statsMap = new Map<string, RunStats>();
    for (const p of players.values()) {
      const pid = p.playerId;
      statsMap.set(pid, {
        damageDealt: damageByPlayer.get(pid) ?? 0,
        resourcesGathered: resourcesByPlayer.get(pid) ?? { wood: 0, stone: 0, iron: 0, diamond: 0 },
        enemiesKilled: Object.values(killsByPlayer.get(pid) ?? {}).reduce((a, b) => a + b, 0),
        killsByType: killsByPlayer.get(pid) ?? {},
        wavesSurvived: Math.max(0, waveState.currentWave - 1),
        timePlayed,
        buildingsBuilt: buildingsByPlayer.get(pid) ?? 0,
      });
    }
    return statsMap;
  }

  return {
    trackDamage,
    trackKill,
    trackResources,
    buildRunStats,
  };
}

export type StatsCollector = ReturnType<typeof createStatsCollector>;
