const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');
const os = require('os');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const TICK_RATE = Number(process.env.TICK_RATE || 30);
const TICK_MS = 1000 / TICK_RATE;
const PLAYER_SPEED = Number(process.env.PLAYER_SPEED || 220);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 4);
const PROTOCOL_VERSION = 1;
const PLAYER_RELEVANCE_RADIUS = Number(process.env.PLAYER_RELEVANCE_RADIUS || 2200);
const NON_PLAYER_RELEVANCE_RADIUS = Number(process.env.NON_PLAYER_RELEVANCE_RADIUS || 2400);
const SNAPSHOT_POSITION_PRECISION = Number(process.env.SNAPSHOT_POSITION_PRECISION || 10);
const MAX_INPUT_MAGNITUDE = 1.0;
const PLAYER_TIMEOUT_MS = 30000;
const MAX_REPLICATED_ENEMIES = Number(process.env.MAX_REPLICATED_ENEMIES || 2000);
const MAX_REPLICATED_PROJECTILES = Number(process.env.MAX_REPLICATED_PROJECTILES || 4000);

const wss = new WebSocketServer({ host: HOST, port: PORT });
const clients = new Map();
const reconnectIndex = new Map();
let tick = 0;
let nextPlayerId = 1;
const sessionId = randomUUID();
let authorityPlayerId = null;
let nonPlayerState = {
    seq: 0,
    enemies: [],
    projectiles: {
        player: [],
        tower: [],
        enemy: []
    },
    playerStates: [],
    sharedResources: null,
    buildingsState: null,
    buildingsRevision: 0
};
const perSocketNonPlayerCache = new WeakMap();
const serverPerf = {
    tickRate: TICK_RATE,
    targetTickMs: TICK_MS,
    simMsAvg: 0,
    simMsPeak: 0,
    loopLagMsAvg: 0,
    inboundBytesWindow: 0,
    outboundBytesWindow: 0,
    inboundKbps: 0,
    outboundKbps: 0,
    connectedClients: 0
};
let lastTickStartedAt = Date.now();
let lastNetWindowAt = Date.now();

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

function quantizePosition(value) {
    return Math.round(value * SNAPSHOT_POSITION_PRECISION) / SNAPSHOT_POSITION_PRECISION;
}

function attachConnection(socket, state) {
    clients.set(socket, state);
    reconnectIndex.set(state.reconnectToken, state);
    if (authorityPlayerId === null) {
        authorityPlayerId = state.playerId;
    }
    sendMessage(socket, {
        v: PROTOCOL_VERSION,
        type: 'welcome',
        playerId: state.playerId,
        reconnectToken: state.reconnectToken,
        tickRate: TICK_RATE,
        sessionId,
        authorityPlayerId,
        host: HOST,
        port: PORT,
        lanAddresses: getLanAddresses()
    });
}

function sanitizeEnemyEntries(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const result = [];
    for (let i = 0; i < raw.length && result.length < MAX_REPLICATED_ENEMIES; i++) {
        const entry = raw[i];
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const id = Number(entry.id);
        const x = Number(entry.x);
        const y = Number(entry.y);
        const hp = Number(entry.hp);
        const maxHp = Number(entry.maxHp);
        if (!Number.isFinite(id) || !Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }
        result.push({
            id: Math.floor(id),
            x: quantizePosition(x),
            y: quantizePosition(y),
            hp: Number.isFinite(hp) ? hp : 1,
            maxHp: Number.isFinite(maxHp) ? maxHp : 1,
            isRanged: Boolean(entry.isRanged)
        });
    }
    return result;
}

function sanitizeProjectileEntries(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const result = [];
    for (let i = 0; i < raw.length && result.length < MAX_REPLICATED_PROJECTILES; i++) {
        const entry = raw[i];
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const x = Number(entry.x);
        const y = Number(entry.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }
        result.push({
            x: quantizePosition(x),
            y: quantizePosition(y)
        });
    }
    return result;
}

function sanitizeSharedResources(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    return {
        wood: Math.max(0, Math.floor(Number(raw.wood) || 0)),
        stone: Math.max(0, Math.floor(Number(raw.stone) || 0)),
        iron: Math.max(0, Math.floor(Number(raw.iron) || 0)),
        gold: Math.max(0, Math.floor(Number(raw.gold) || 0))
    };
}

function sanitizePlayerStates(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const result = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const playerId = Number(entry.playerId);
        const hp = Number(entry.hp);
        const maxHp = Number(entry.maxHp);
        const respawnTimer = Number(entry.respawnTimer);
        if (!Number.isFinite(playerId)) {
            continue;
        }
        result.push({
            playerId: Math.floor(playerId),
            hp: Math.max(0, Number.isFinite(hp) ? hp : 0),
            maxHp: Math.max(1, Number.isFinite(maxHp) ? maxHp : 1),
            isDead: Boolean(entry.isDead),
            respawnTimer: Math.max(0, Number.isFinite(respawnTimer) ? respawnTimer : 0)
        });
    }
    return result;
}

function filterNonPlayerStateForViewer(viewer) {
    const radiusSq = NON_PLAYER_RELEVANCE_RADIUS * NON_PLAYER_RELEVANCE_RADIUS;
    const filterByDistance = (entries) => entries.filter((entry) => {
        const dx = entry.x - viewer.x;
        const dy = entry.y - viewer.y;
        return (dx * dx + dy * dy) <= radiusSq;
    });

    const enemies = filterByDistance(nonPlayerState.enemies);
    return {
        seq: nonPlayerState.seq,
        enemies,
        projectiles: {
            player: filterByDistance(nonPlayerState.projectiles.player),
            tower: filterByDistance(nonPlayerState.projectiles.tower),
            enemy: filterByDistance(nonPlayerState.projectiles.enemy)
        },
        playerStates: nonPlayerState.playerStates,
        sharedResources: nonPlayerState.sharedResources,
        buildingsState: nonPlayerState.buildingsState,
        buildingsRevision: nonPlayerState.buildingsRevision,
        totals: {
            enemies: nonPlayerState.enemies.length,
            playerProjectiles: nonPlayerState.projectiles.player.length,
            towerProjectiles: nonPlayerState.projectiles.tower.length,
            enemyProjectiles: nonPlayerState.projectiles.enemy.length
        }
    };
}

function buildProjectileDelta(previousEntries, nextEntries) {
    const prev = Array.isArray(previousEntries) ? previousEntries : [];
    const next = Array.isArray(nextEntries) ? nextEntries : [];
    const sharedLength = Math.min(prev.length, next.length);
    const set = [];
    for (let i = 0; i < sharedLength; i++) {
        const p = prev[i];
        const n = next[i];
        if (!p || !n || p.x !== n.x || p.y !== n.y) {
            set.push({ i, x: n.x, y: n.y });
        }
    }
    for (let i = sharedLength; i < next.length; i++) {
        const n = next[i];
        set.push({ i, x: n.x, y: n.y });
    }
    return {
        set,
        removeFrom: next.length
    };
}

function buildDeltaNonPlayerPayload(socket, fullPayload) {
    const previousRecord = perSocketNonPlayerCache.get(socket) ?? null;
    const previous = previousRecord?.payload ?? null;
    const previousDeltaStreak = Number(previousRecord?.deltaStreak) || 0;
    const forceFull = previousDeltaStreak >= 20;
    if (forceFull) {
        perSocketNonPlayerCache.set(socket, { payload: fullPayload, deltaStreak: 0 });
        return {
            mode: 'full',
            ...fullPayload
        };
    }
    perSocketNonPlayerCache.set(socket, { payload: fullPayload, deltaStreak: previousDeltaStreak });
    if (!previous || !Array.isArray(previous.enemies)) {
        return {
            mode: 'full',
            ...fullPayload
        };
    }

    const previousById = new Map();
    for (const enemy of previous.enemies) {
        previousById.set(enemy.id, enemy);
    }
    const nextById = new Map();
    const upsert = [];
    for (const enemy of fullPayload.enemies) {
        nextById.set(enemy.id, enemy);
        const prev = previousById.get(enemy.id);
        if (!prev || prev.x !== enemy.x || prev.y !== enemy.y || prev.hp !== enemy.hp || prev.maxHp !== enemy.maxHp || prev.isRanged !== enemy.isRanged) {
            upsert.push(enemy);
        }
    }
    const remove = [];
    for (const previousEnemy of previous.enemies) {
        if (!nextById.has(previousEnemy.id)) {
            remove.push(previousEnemy.id);
        }
    }

    const projectileDelta = {
        player: buildProjectileDelta(previous.projectiles?.player, fullPayload.projectiles.player),
        tower: buildProjectileDelta(previous.projectiles?.tower, fullPayload.projectiles.tower),
        enemy: buildProjectileDelta(previous.projectiles?.enemy, fullPayload.projectiles.enemy)
    };

    const deltaPayload = {
        mode: 'delta',
        seq: fullPayload.seq,
        baseSeq: previous.seq,
        enemyDelta: {
            upsert,
            remove
        },
        projectileDelta,
        totals: fullPayload.totals,
        playerStates: fullPayload.playerStates,
        sharedResources: fullPayload.sharedResources,
        buildingsState: fullPayload.buildingsState,
        buildingsRevision: fullPayload.buildingsRevision
    };
    const fullLength = JSON.stringify(fullPayload).length;
    const deltaLength = JSON.stringify(deltaPayload).length;
    if (deltaLength >= fullLength) {
        perSocketNonPlayerCache.set(socket, { payload: fullPayload, deltaStreak: 0 });
        return {
            mode: 'full',
            ...fullPayload
        };
    }
    perSocketNonPlayerCache.set(socket, { payload: fullPayload, deltaStreak: previousDeltaStreak + 1 });
    return deltaPayload;
}

function broadcastSnapshot() {
    if (clients.size === 0) {
        return;
    }
    const allPlayers = [...clients.values()];
    serverPerf.connectedClients = allPlayers.length;
    for (const [socket, viewer] of clients) {
        if (socket.readyState !== socket.OPEN) {
            continue;
        }
        const relevantPlayers = [];
        const radiusSq = PLAYER_RELEVANCE_RADIUS * PLAYER_RELEVANCE_RADIUS;
        for (const player of allPlayers) {
            if (player.playerId === viewer.playerId) {
                relevantPlayers.push(player);
                continue;
            }
            const dx = player.x - viewer.x;
            const dy = player.y - viewer.y;
            if ((dx * dx + dy * dy) <= radiusSq) {
                relevantPlayers.push(player);
            }
        }
        const payload = {
            v: PROTOCOL_VERSION,
            type: 'snapshot',
            tick,
            serverTime: Date.now(),
            authorityPlayerId,
            totalPlayers: allPlayers.length,
            relevantPlayers: relevantPlayers.length,
            serverPerf: {
                tickRate: serverPerf.tickRate,
                targetTickMs: serverPerf.targetTickMs,
                simMsAvg: Number(serverPerf.simMsAvg.toFixed(2)),
                simMsPeak: Number(serverPerf.simMsPeak.toFixed(2)),
                loopLagMsAvg: Number(serverPerf.loopLagMsAvg.toFixed(2)),
                inboundKbps: Number(serverPerf.inboundKbps.toFixed(2)),
                outboundKbps: Number(serverPerf.outboundKbps.toFixed(2)),
                connectedClients: serverPerf.connectedClients
            },
            players: relevantPlayers.map((state) => ({
                playerId: state.playerId,
                x: quantizePosition(state.x),
                y: quantizePosition(state.y),
                lastInputSeq: state.lastInputSeq
            })),
            nonPlayer: buildDeltaNonPlayerPayload(socket, filterNonPlayerStateForViewer(viewer))
        };
        const encoded = JSON.stringify(payload);
        serverPerf.outboundBytesWindow += encoded.length;
        socket.send(encoded);
    }
}

function simulateTick() {
    const tickStartedAt = Date.now();
    const loopLagMs = Math.max(0, tickStartedAt - lastTickStartedAt - TICK_MS);
    lastTickStartedAt = tickStartedAt;
    const simStartedAt = performance.now();
    tick += 1;
    const dt = TICK_MS / 1000;
    const now = Date.now();

    for (const [socket, state] of clients) {
        if (now - state.lastSeenAt > PLAYER_TIMEOUT_MS) {
            clients.delete(socket);
            continue;
        }
        const playerState = Array.isArray(nonPlayerState.playerStates)
            ? nonPlayerState.playerStates.find((entry) => entry.playerId === state.playerId)
            : null;
        if (playerState?.isDead) {
            continue;
        }
        state.x += state.inputX * PLAYER_SPEED * dt;
        state.y += state.inputY * PLAYER_SPEED * dt;
    }

    broadcastSnapshot();
    const simDurationMs = performance.now() - simStartedAt;
    serverPerf.simMsAvg = serverPerf.simMsAvg * 0.9 + simDurationMs * 0.1;
    serverPerf.simMsPeak = Math.max(simDurationMs, serverPerf.simMsPeak * 0.95);
    serverPerf.loopLagMsAvg = serverPerf.loopLagMsAvg * 0.9 + loopLagMs * 0.1;
    const netNow = Date.now();
    const netWindowMs = netNow - lastNetWindowAt;
    if (netWindowMs >= 1000) {
        const scale = 1000 / Math.max(1, netWindowMs);
        serverPerf.inboundKbps = (serverPerf.inboundBytesWindow * scale) / 1024;
        serverPerf.outboundKbps = (serverPerf.outboundBytesWindow * scale) / 1024;
        serverPerf.inboundBytesWindow = 0;
        serverPerf.outboundBytesWindow = 0;
        lastNetWindowAt = netNow;
    }
}

function handleHello(socket, message) {
    const reconnectToken = typeof message.reconnectToken === 'string' ? message.reconnectToken : null;
    if (reconnectToken && reconnectIndex.has(reconnectToken)) {
        const previous = reconnectIndex.get(reconnectToken);
        previous.lastSeenAt = Date.now();
        attachConnection(socket, previous);
        return;
    }
    if (clients.size >= MAX_PLAYERS) {
        sendMessage(socket, {
            v: PROTOCOL_VERSION,
            type: 'error',
            code: 'session_full',
            maxPlayers: MAX_PLAYERS
        });
        socket.close();
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
        v: PROTOCOL_VERSION,
        type: 'pong',
        clientTime: message.clientTime ?? null,
        serverTime: Date.now()
    });
}

function handleEntitySnapshot(socket, message) {
    const state = clients.get(socket);
    if (!state || state.playerId !== authorityPlayerId) {
        return;
    }
    const seq = Number(message.seq);
    if (!Number.isFinite(seq) || seq <= nonPlayerState.seq) {
        return;
    }
    const payload = message.payload ?? {};
    nonPlayerState = {
        seq: Math.floor(seq),
        enemies: sanitizeEnemyEntries(payload.enemies),
        projectiles: {
            player: sanitizeProjectileEntries(payload.projectiles?.player),
            tower: sanitizeProjectileEntries(payload.projectiles?.tower),
            enemy: sanitizeProjectileEntries(payload.projectiles?.enemy)
        },
        playerStates: sanitizePlayerStates(payload.playerStates),
        sharedResources: sanitizeSharedResources(payload.sharedResources) ?? nonPlayerState.sharedResources,
        buildingsState: payload.buildingsState ?? nonPlayerState.buildingsState,
        buildingsRevision: Number(payload.buildingsRevision) || nonPlayerState.buildingsRevision
    };
}

function getSocketByPlayerId(playerId) {
    for (const [socket, state] of clients) {
        if (state.playerId === playerId) {
            return socket;
        }
    }
    return null;
}

function handlePlayerAction(socket, message) {
    const actor = clients.get(socket);
    if (!actor || actor.playerId === authorityPlayerId) {
        return;
    }
    const authoritySocket = getSocketByPlayerId(authorityPlayerId);
    if (!authoritySocket || authoritySocket.readyState !== authoritySocket.OPEN) {
        return;
    }
    sendMessage(authoritySocket, {
        v: PROTOCOL_VERSION,
        type: 'peer_action',
        actorPlayerId: actor.playerId,
        action: message.action ?? null
    });
}

wss.on('connection', (socket) => {
    socket.on('message', (buffer) => {
        serverPerf.inboundBytesWindow += Buffer.byteLength(buffer);
        let message = null;
        try {
            message = JSON.parse(buffer.toString());
        } catch {
            return;
        }
        if (!message || typeof message.type !== 'string') {
            return;
        }
        const version = Number(message.v ?? PROTOCOL_VERSION);
        if (version !== PROTOCOL_VERSION) {
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
            return;
        }
        if (message.type === 'entity_snapshot') {
            handleEntitySnapshot(socket, message);
            return;
        }
        if (message.type === 'player_action') {
            handlePlayerAction(socket, message);
        }
    });

    socket.on('close', () => {
        const disconnected = clients.get(socket);
        clients.delete(socket);
        if (disconnected && disconnected.playerId === authorityPlayerId) {
            authorityPlayerId = null;
            for (const remaining of clients.values()) {
                authorityPlayerId = remaining.playerId;
                break;
            }
        }
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
