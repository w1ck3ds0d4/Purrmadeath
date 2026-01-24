const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');
const os = require('os');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const TICK_RATE = Number(process.env.TICK_RATE || 20);
const TICK_MS = 1000 / TICK_RATE;
const PLAYER_SPEED = Number(process.env.PLAYER_SPEED || 220);
const MAX_INPUT_MAGNITUDE = 1.0;
const PLAYER_TIMEOUT_MS = 30000;

const wss = new WebSocketServer({ host: HOST, port: PORT });
const clients = new Map();
const reconnectIndex = new Map();
let tick = 0;
let nextPlayerId = 1;
const sessionId = randomUUID();

function clampInputMagnitude(x, y) {
    const mag = Math.hypot(x, y);
    if (mag <= MAX_INPUT_MAGNITUDE || mag <= 0.0001) {
        return { x, y };
    }
    return { x: x / mag, y: y / mag };
}

function createPlayerState(playerId, reconnectToken) {
    return {
        playerId,
        reconnectToken,
        x: 16,
        y: 16,
        inputX: 0,
        inputY: 0,
        lastInputSeq: 0,
        lastSeenAt: Date.now()
    };
}

function sendMessage(socket, payload) {
    if (socket.readyState !== socket.OPEN) {
        return;
    }
    socket.send(JSON.stringify(payload));
}

function attachConnection(socket, state) {
    clients.set(socket, state);
    reconnectIndex.set(state.reconnectToken, state);
    sendMessage(socket, {
        type: 'welcome',
        playerId: state.playerId,
        reconnectToken: state.reconnectToken,
        tickRate: TICK_RATE,
        sessionId,
        host: HOST,
        port: PORT,
        lanAddresses: getLanAddresses()
    });
}

function broadcastSnapshot() {
    const players = [...clients.values()].map((state) => ({
        playerId: state.playerId,
        x: state.x,
        y: state.y,
        lastInputSeq: state.lastInputSeq
    }));
    const payload = {
        type: 'snapshot',
        tick,
        serverTime: Date.now(),
        players
    };
    for (const socket of clients.keys()) {
        sendMessage(socket, payload);
    }
}

function simulateTick() {
    tick += 1;
    const dt = TICK_MS / 1000;
    const now = Date.now();

    for (const [socket, state] of clients) {
        if (now - state.lastSeenAt > PLAYER_TIMEOUT_MS) {
            clients.delete(socket);
            continue;
        }
        state.x += state.inputX * PLAYER_SPEED * dt;
        state.y += state.inputY * PLAYER_SPEED * dt;
    }

    broadcastSnapshot();
}

function handleHello(socket, message) {
    const reconnectToken = typeof message.reconnectToken === 'string' ? message.reconnectToken : null;
    if (reconnectToken && reconnectIndex.has(reconnectToken)) {
        const previous = reconnectIndex.get(reconnectToken);
        previous.lastSeenAt = Date.now();
        attachConnection(socket, previous);
        return;
    }

    const token = randomUUID();
    const state = createPlayerState(nextPlayerId++, token);
    attachConnection(socket, state);
}

function handleInput(socket, message) {
    const state = clients.get(socket);
    if (!state) {
        return;
    }
    const rawX = Number(message.moveX);
    const rawY = Number(message.moveY);
    const seq = Number(message.inputSeq);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY) || !Number.isFinite(seq)) {
        return;
    }
    const clamped = clampInputMagnitude(rawX, rawY);
    state.inputX = clamped.x;
    state.inputY = clamped.y;
    state.lastInputSeq = Math.max(state.lastInputSeq, Math.floor(seq));
    state.lastSeenAt = Date.now();
}

function handlePing(socket, message) {
    sendMessage(socket, {
        type: 'pong',
        clientTime: message.clientTime ?? null,
        serverTime: Date.now()
    });
}

wss.on('connection', (socket) => {
    socket.on('message', (buffer) => {
        let message = null;
        try {
            message = JSON.parse(buffer.toString());
        } catch {
            return;
        }
        if (!message || typeof message.type !== 'string') {
            return;
        }
        if (message.type === 'hello') {
            handleHello(socket, message);
            return;
        }
        if (message.type === 'input') {
            handleInput(socket, message);
            return;
        }
        if (message.type === 'ping') {
            handlePing(socket, message);
        }
    });

    socket.on('close', () => {
        clients.delete(socket);
    });
});

setInterval(simulateTick, TICK_MS);

function getLanAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const entries of Object.values(interfaces)) {
        if (!Array.isArray(entries)) {
            continue;
        }
        for (const entry of entries) {
            if (entry.family === 'IPv4' && !entry.internal) {
                addresses.push(entry.address);
            }
        }
    }
    return [...new Set(addresses)];
}

console.log(`[multiplayer] listening on ws://${HOST}:${PORT} (${TICK_RATE} tick/s)`);
if (HOST === '0.0.0.0') {
    const lanAddresses = getLanAddresses();
    if (lanAddresses.length > 0) {
        for (const address of lanAddresses) {
            console.log(`[multiplayer] LAN join URL: ws://${address}:${PORT}`);
        }
    }
}
