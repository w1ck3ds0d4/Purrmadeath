export function buildMultiplayerSectionLines(multiplayerStats, lanHostHint, locationProtocol, locationPort) {
    return [
        `State: ${multiplayerStats.connected ? 'CONNECTED' : 'DISCONNECTED'} | URL: ${multiplayerStats.url}`,
        `Session: ${multiplayerStats.sessionId ?? 'none'} | Player ID: ${multiplayerStats.playerId ?? '-'}`,
        `Authority: ${multiplayerStats.authorityPlayerId ?? '-'} | Role: ${multiplayerStats.isAuthority ? 'HOST_AUTH' : 'FOLLOWER'}`,
        `Protocol: v${multiplayerStats.protocolVersion ?? 1}`,
        `Ping: ${Math.round(multiplayerStats.pingMs)} ms | Tick: ${multiplayerStats.tickRate}`,
        `Snapshots: tick ${multiplayerStats.snapshotTick} | remote ${multiplayerStats.remotePlayerCount} | age ${Math.round(multiplayerStats.snapshotAgeMs ?? 0)} ms`,
        `Snapshot interval: ${Math.round(multiplayerStats.snapshotIntervalMs ?? 0)} ms | jitter ${Math.round(multiplayerStats.snapshotJitterMs ?? 0)} ms`,
        `Relevance: ${multiplayerStats.relevantPlayersSeen ?? 0}/${multiplayerStats.totalPlayersSeen ?? 0} players in scope`,
        `Replicated non-player seq: ${multiplayerStats.nonPlayerSeq ?? 0} | Totals E/P/T/EP: ${(multiplayerStats.nonPlayerTotals?.enemies ?? 0)}/${(multiplayerStats.nonPlayerTotals?.playerProjectiles ?? 0)}/${(multiplayerStats.nonPlayerTotals?.towerProjectiles ?? 0)}/${(multiplayerStats.nonPlayerTotals?.enemyProjectiles ?? 0)}`,
        `Net rate: in ${Number(multiplayerStats.inboundKbps ?? 0).toFixed(2)} kB/s | out ${Number(multiplayerStats.outboundKbps ?? 0).toFixed(2)} kB/s`,
        `Msg rate: snapshots ${multiplayerStats.snapshotRate ?? 0}/s | inputs ${multiplayerStats.inputRate ?? 0}/s`,
        `Reconnect token: ${multiplayerStats.reconnectToken} | Attempts: ${multiplayerStats.connectAttempts}`,
        `Last error: ${multiplayerStats.lastError ?? 'none'}`,
        `LAN host hint: ${lanHostHint}`,
        `LAN join: ${multiplayerStats.joinHintUrl ?? 'connect first to detect host LAN IP'}`,
        `Manual join: ${locationProtocol}//${lanHostHint}:${locationPort || '3001'}/?mp=1&mpHost=${lanHostHint}`
    ];
}

export function buildServerSectionLines(serverPerfStats) {
    if (!serverPerfStats) {
        return ['No server metrics yet (connect first).'];
    }
    return [
        `Tick: ${serverPerfStats.tickRate} Hz | Target: ${Number(serverPerfStats.targetTickMs ?? 0).toFixed(2)} ms`,
        `Sim avg/peak: ${Number(serverPerfStats.simMsAvg ?? 0).toFixed(2)} / ${Number(serverPerfStats.simMsPeak ?? 0).toFixed(2)} ms`,
        `Loop lag avg: ${Number(serverPerfStats.loopLagMsAvg ?? 0).toFixed(2)} ms`,
        `Net in/out: ${Number(serverPerfStats.inboundKbps ?? 0).toFixed(2)} / ${Number(serverPerfStats.outboundKbps ?? 0).toFixed(2)} kB/s`,
        `Connected clients: ${serverPerfStats.connectedClients ?? 0}`
    ];
}

export function buildCheatsSectionLines(enemiesDisabled, activePerfProfileKey, autoPerfGovernorEnabled, buildMode) {
    return [
        `K: enemy toggle (${enemiesDisabled ? 'ON' : 'OFF'})`,
        'H: +100 resources',
        'J: force reset | F8: export crash logs',
        `L: perf profile (${activePerfProfileKey}) | O: auto governor (${autoPerfGovernorEnabled ? 'ON' : 'OFF'})`,
        'U: start benchmark',
        `Build mode: ${buildMode ? 'ON' : 'OFF'}`
    ];
}
