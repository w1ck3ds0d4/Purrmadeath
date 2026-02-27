const WebSocket = require('ws');

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8080';
const BOT_COUNT = Math.max(1, Number(process.env.BOTS || 20));
const DURATION_SEC = Math.max(5, Number(process.env.DURATION_SEC || 30));
const INPUT_HZ = Math.max(1, Number(process.env.INPUT_HZ || 20));
const ACTION_HZ = Math.max(0, Number(process.env.ACTION_HZ || 3));
const PROTOCOL_VERSION = 1;

function createBot(index, stats) {
    const state = {
        index,
        socket: null,
        connected: false,
        playerId: 0,
        snapshots: 0,
        rejectedActions: 0,
        attackSent: 0,
        inputSent: 0,
        tickLast: 0
    };
    let inputTimer = null;
    let actionTimer = null;

    function cleanupTimers() {
        if (inputTimer) {
            clearInterval(inputTimer);
            inputTimer = null;
        }
        if (actionTimer) {
            clearInterval(actionTimer);
            actionTimer = null;
        }
    }

    function send(payload) {
        if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        state.socket.send(JSON.stringify(payload));
    }

    function startTraffic() {
        const inputMs = Math.max(10, Math.floor(1000 / INPUT_HZ));
        inputTimer = setInterval(() => {
            const angle = Math.random() * Math.PI * 2;
            send({
                v: PROTOCOL_VERSION,
                type: 'input',
                seq: state.inputSent + 1,
                moveX: Math.cos(angle),
                moveY: Math.sin(angle),
                worldX: 16,
                worldY: 16
            });
            state.inputSent += 1;
            stats.inputMessages += 1;
        }, inputMs);

        if (ACTION_HZ > 0) {
            const actionMs = Math.max(33, Math.floor(1000 / ACTION_HZ));
            actionTimer = setInterval(() => {
                send({
                    v: PROTOCOL_VERSION,
                    type: 'player_action',
                    action: {
                        type: 'attack',
                        weapon: 'pistol',
                        dirX: 1,
                        dirY: 0,
                        originX: 16,
                        originY: 16,
                        clientActionId: state.attackSent + 1
                    }
                });
                state.attackSent += 1;
                stats.actionMessages += 1;
            }, actionMs);
        }
    }

    function connect() {
        const socket = new WebSocket(WS_URL);
        state.socket = socket;
        socket.on('open', () => {
            state.connected = true;
            stats.connected += 1;
            send({
                v: PROTOCOL_VERSION,
                type: 'hello',
                reconnectToken: null,
                protocolVersion: PROTOCOL_VERSION
            });
            startTraffic();
        });
        socket.on('message', (buffer) => {
            let message;
            try {
                message = JSON.parse(buffer.toString());
            } catch {
                stats.badMessages += 1;
                return;
            }
            if (message.type === 'welcome') {
                state.playerId = Number(message.playerId) || 0;
            } else if (message.type === 'snapshot') {
                state.snapshots += 1;
                stats.snapshots += 1;
                const tick = Number(message.tick) || 0;
                if (tick < state.tickLast) {
                    stats.tickRegressions += 1;
                }
                state.tickLast = tick;
            } else if (message.type === 'player_action_result' && message.result?.accepted === false) {
                state.rejectedActions += 1;
                stats.rejectedActions += 1;
            } else if (message.type === 'error') {
                stats.serverErrors += 1;
            }
        });
        socket.on('close', () => {
            state.connected = false;
            cleanupTimers();
        });
        socket.on('error', () => {
            stats.socketErrors += 1;
        });
    }

    connect();
    return state;
}

async function main() {
    const stats = {
        connected: 0,
        snapshots: 0,
        inputMessages: 0,
        actionMessages: 0,
        rejectedActions: 0,
        tickRegressions: 0,
        badMessages: 0,
        serverErrors: 0,
        socketErrors: 0
    };
    const bots = [];
    for (let i = 0; i < BOT_COUNT; i++) {
        bots.push(createBot(i, stats));
    }

    await new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000));

    for (const bot of bots) {
        if (bot.socket && bot.socket.readyState <= WebSocket.OPEN) {
            bot.socket.close();
        }
    }

    const summary = {
        wsUrl: WS_URL,
        botsRequested: BOT_COUNT,
        durationSec: DURATION_SEC,
        connectedBots: stats.connected,
        totalSnapshots: stats.snapshots,
        totalInputs: stats.inputMessages,
        totalActions: stats.actionMessages,
        rejectedActions: stats.rejectedActions,
        tickRegressions: stats.tickRegressions,
        badMessages: stats.badMessages,
        serverErrors: stats.serverErrors,
        socketErrors: stats.socketErrors
    };
    console.log('[load-test] summary');
    console.log(JSON.stringify(summary, null, 2));
    process.exit(summary.connectedBots > 0 && summary.tickRegressions === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error('[load-test] failed:', error);
    process.exit(1);
});
