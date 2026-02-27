export function getLatencyVerdict(serverPerfStats, multiplayerStats) {
    if (!multiplayerStats.connected) {
        return { text: 'Verdict: offline', color: '#8df7ff' };
    }
    if (!serverPerfStats) {
        return { text: 'Verdict: waiting for server metrics', color: '#8df7ff' };
    }
    const targetTickMs = Math.max(1, Number(serverPerfStats.targetTickMs) || 1);
    const simMsAvg = Number(serverPerfStats.simMsAvg) || 0;
    const loopLagMsAvg = Number(serverPerfStats.loopLagMsAvg) || 0;
    const pingMs = Number(multiplayerStats.pingMs) || 0;
    const snapshotJitterMs = Number(multiplayerStats.snapshotJitterMs) || 0;
    const serverCpuBound = simMsAvg >= targetTickMs * 0.8 || loopLagMsAvg >= Math.max(4, targetTickMs * 0.35);
    const networkBound = pingMs >= 35 || snapshotJitterMs >= 10;
    if (serverCpuBound && networkBound) {
        return { text: 'Verdict: mixed pressure (server + network)', color: '#ffc14d' };
    }
    if (serverCpuBound) {
        return { text: 'Verdict: likely host-laptop/server bound', color: '#ff8f8f' };
    }
    if (networkBound) {
        return { text: 'Verdict: likely network/Wi-Fi bound', color: '#ffd166' };
    }
    return { text: 'Verdict: stable (no obvious bottleneck)', color: '#9ce9a0' };
}
