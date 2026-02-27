const WebSocket = require('ws');

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8080';
const CLIENTS = Math.max(2, Number(process.env.CLIENTS || 4));
const DURATION_SEC = Math.max(10, Number(process.env.DURATION_SEC || 40));
const RECONNECT_EVERY_MS = Math.max(1000, Number(process.env.RECONNECT_EVERY_MS || 5000));
const RECONNECT_DELAY_MS = Math.max(200, Number(process.env.RECONNECT_DELAY_MS || 1200));
const INPUT_HZ = Math.max(1, Number(process.env.INPUT_HZ || 15));
const PROTOCOL_VERSION = 1;

function createClient(index, stats) {
    const state = {
        index,
        socket: null,
        snapshots: 0,
        lastSnapshotAt: 0,
        connected: false,
        reconnects: 0
    };
    let inputTimer = null;

    function send(payload) {
        if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        state.socket.send(JSON.stringify(payload));
    }

    function startInputLoop() {
        const tickMs = Math.max(10, Math.floor(1000 / INPUT_HZ));
        inputTimer = setInterval(() => {
            const angle = Math.random() * Math.PI * 2;
            send({
                v: PROTOCOL_VERSION,
                type: 'input',
                seq: stats.inputSeq++,
                moveX: Math.cos(angle),
                moveY: Math.sin(angle),
                worldX: 16,
                worldY: 16
            });
        }, tickMs);
    }

    function stopInputLoop() {
        if (inputTimer) {
            clearInterval(inputTimer);
            inputTimer = null;
        }
    }

    function connect(reconnect = false) {
        const socket = new WebSocket(WS_URL);
        state.socket = socket;
        socket.on('open', () => {
            state.connected = true;
            if (reconnect) {
                state.reconnects += 1;
                stats.reconnects += 1;
            } else {
                stats.initialConnections += 1;
            }
            send({
                v: PROTOCOL_VERSION,
                type: 'hello',
                reconnectToken: null,
                protocolVersion: PROTOCOL_VERSION
            });
            startInputLoop();
        });
        socket.on('message', (buffer) => {
            let message;
            try {
                message = JSON.parse(buffer.toString());
            } catch {
                stats.badMessages += 1;
                return;
            }
            if (message.type === 'snapshot') {
                state.snapshots += 1;
                stats.snapshots += 1;
                if (state.lastSnapshotAt > 0) {
                    const gap = Date.now() - state.lastSnapshotAt;
                    if (gap > 2500) {
                        stats.snapshotGaps += 1;
                    }
                }
                state.lastSnapshotAt = Date.now();
            }
        });
        socket.on('close', () => {
            state.connected = false;
            stopInputLoop();
        });
        socket.on('error', () => {
            stats.socketErrors += 1;
        });
    }

    function forceReconnect() {
        if (state.socket && state.socket.readyState <= WebSocket.OPEN) {
            state.socket.close();
        }
        setTimeout(() => connect(true), RECONNECT_DELAY_MS);
    }

    connect(false);
    return { state, forceReconnect };
}

async function main() {
    const stats = {
        initialConnections: 0,
        reconnects: 0,
        snapshots: 0,
        snapshotGaps: 0,
        badMessages: 0,
        socketErrors: 0,
        inputSeq: 1
    };
    const clients = [];
    for (let i = 0; i < CLIENTS; i++) {
        clients.push(createClient(i, stats));
    }

    const reconnectTimer = setInterval(() => {
        const pick = clients[Math.floor(Math.random() * clients.length)];
        pick.forceReconnect();
    }, RECONNECT_EVERY_MS);

    await new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000));
    clearInterval(reconnectTimer);
    for (const client of clients) {
        if (client.state.socket && client.state.socket.readyState <= WebSocket.OPEN) {
            client.state.socket.close();
        }
    }

    const summary = {
        wsUrl: WS_URL,
        clients: CLIENTS,
        durationSec: DURATION_SEC,
        reconnectEveryMs: RECONNECT_EVERY_MS,
        reconnectDelayMs: RECONNECT_DELAY_MS,
        initialConnections: stats.initialConnections,
        reconnects: stats.reconnects,
        snapshots: stats.snapshots,
        snapshotGaps: stats.snapshotGaps,
        badMessages: stats.badMessages,
        socketErrors: stats.socketErrors
    };
    console.log('[fault-probe] summary');
    console.log(JSON.stringify(summary, null, 2));
    const success = summary.initialConnections > 0 && summary.socketErrors === 0;
    process.exit(success ? 0 : 1);
}

main().catch((error) => {
    console.error('[fault-probe] failed:', error);
    process.exit(1);
});
