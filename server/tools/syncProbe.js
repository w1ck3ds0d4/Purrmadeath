const WebSocket = require('ws');

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8080';
const CLIENTS = Math.max(2, Number(process.env.CLIENTS || 2));
const DURATION_SEC = Math.max(5, Number(process.env.DURATION_SEC || 25));
const PROTOCOL_VERSION = 1;

function createProbeClient(index, globalState) {
    const state = {
        index,
        socket: null,
        tickLast: 0,
        nonPlayerSeqLast: 0,
        sessionTimeLast: 0,
        snapshots: 0,
        regressions: 0
    };
    const socket = new WebSocket(WS_URL);
    state.socket = socket;

    socket.on('open', () => {
        socket.send(JSON.stringify({
            v: PROTOCOL_VERSION,
            type: 'hello',
            reconnectToken: null,
            protocolVersion: PROTOCOL_VERSION
        }));
    });

    socket.on('message', (buffer) => {
        let message;
        try {
            message = JSON.parse(buffer.toString());
        } catch {
            globalState.badMessages += 1;
            return;
        }
        if (message.type !== 'snapshot') {
            return;
        }
        state.snapshots += 1;
        globalState.totalSnapshots += 1;
        const tick = Number(message.tick) || 0;
        if (tick < state.tickLast) {
            state.regressions += 1;
            globalState.tickRegressions += 1;
        }
        state.tickLast = tick;
        const nonPlayerSeq = Number(message.nonPlayer?.seq) || 0;
        if (nonPlayerSeq < state.nonPlayerSeqLast) {
            state.regressions += 1;
            globalState.nonPlayerRegressions += 1;
        }
        state.nonPlayerSeqLast = nonPlayerSeq;
        const sessionTime = Number(message.nonPlayer?.sessionTimeSeconds) || 0;
        if (sessionTime + 0.001 < state.sessionTimeLast) {
            state.regressions += 1;
            globalState.timeRegressions += 1;
        }
        state.sessionTimeLast = sessionTime;

        if (!globalState.byTick.has(tick)) {
            globalState.byTick.set(tick, []);
        }
        globalState.byTick.get(tick).push({
            clientIndex: index,
            nonPlayerSeq,
            sessionTime
        });
    });

    socket.on('error', () => {
        globalState.socketErrors += 1;
    });
    return state;
}

async function main() {
    const globalState = {
        badMessages: 0,
        socketErrors: 0,
        totalSnapshots: 0,
        tickRegressions: 0,
        nonPlayerRegressions: 0,
        timeRegressions: 0,
        crossClientTickMismatches: 0,
        byTick: new Map()
    };
    const clients = [];
    for (let i = 0; i < CLIENTS; i++) {
        clients.push(createProbeClient(i, globalState));
    }

    await new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000));

    for (const snapshots of globalState.byTick.values()) {
        if (snapshots.length < 2) {
            continue;
        }
        const firstSeq = snapshots[0].nonPlayerSeq;
        const mismatch = snapshots.some((entry) => Math.abs(entry.nonPlayerSeq - firstSeq) > 1);
        if (mismatch) {
            globalState.crossClientTickMismatches += 1;
        }
    }

    for (const client of clients) {
        if (client.socket && client.socket.readyState <= WebSocket.OPEN) {
            client.socket.close();
        }
    }

    const summary = {
        wsUrl: WS_URL,
        clients: CLIENTS,
        durationSec: DURATION_SEC,
        totalSnapshots: globalState.totalSnapshots,
        tickRegressions: globalState.tickRegressions,
        nonPlayerRegressions: globalState.nonPlayerRegressions,
        timeRegressions: globalState.timeRegressions,
        crossClientTickMismatches: globalState.crossClientTickMismatches,
        badMessages: globalState.badMessages,
        socketErrors: globalState.socketErrors
    };
    console.log('[sync-probe] summary');
    console.log(JSON.stringify(summary, null, 2));
    const success = summary.tickRegressions === 0
        && summary.nonPlayerRegressions === 0
        && summary.timeRegressions === 0
        && summary.crossClientTickMismatches === 0;
    process.exit(success ? 0 : 1);
}

main().catch((error) => {
    console.error('[sync-probe] failed:', error);
    process.exit(1);
});
