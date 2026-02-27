// Multiplayer client foundation:
// - Connects to authoritative websocket server.
// - Sends input stream and pings.
// - Tracks basic connection/replication stats for dev console.
export function createMultiplayerClient({
    url,
    onLog = () => {}
}) {
    const PROTOCOL_VERSION = 1;
    const INPUT_SEND_INTERVAL_MS = 50;
    const INPUT_KEEPALIVE_MS = 250;
    const STATS_WINDOW_MS = 1000;
    let socket = null;
    let connected = false;
    let playerId = null;
    let reconnectToken = null;
    let snapshotTick = 0;
    let remotePlayerCount = 0;
    let pingMs = 0;
    let tickRate = 0;
    let inputSeq = 0;
    let connectAttempts = 0;
    let lastError = null;
    let lastPingSentAt = 0;
    let pingTimer = 0;
    let joinHintUrl = null;
    let sessionId = null;
    let snapshotPlayers = [];
    let desiredMoveX = 0;
    let desiredMoveY = 0;
    let lastSentMoveX = 0;
    let lastSentMoveY = 0;
    let inputSendTimerMs = 0;
    let inputKeepaliveTimerMs = 0;
    let statsWindowTimerMs = STATS_WINDOW_MS;
    let snapshotCountWindow = 0;
    let inputCountWindow = 0;
    let inboundBytesWindow = 0;
    let outboundBytesWindow = 0;
    let snapshotRate = 0;
    let inputRate = 0;
    let inboundKbps = 0;
    let outboundKbps = 0;
    let snapshotAgeMs = 0;
    let totalPlayersSeen = 0;
    let relevantPlayersSeen = 0;
    let authorityPlayerId = null;
    let nonPlayerSnapshot = {
        seq: 0,
        enemies: [],
        projectiles: { player: [], tower: [], enemy: [] },
        totals: { enemies: 0, playerProjectiles: 0, towerProjectiles: 0, enemyProjectiles: 0 }
    };

    function isOpen() {
        return socket && socket.readyState === WebSocket.OPEN;
    }

    function send(payload) {
        if (!isOpen()) {
            return;
        }
        const encoded = JSON.stringify(payload);
        outboundBytesWindow += encoded.length;
        socket.send(encoded);
    }

    function connect() {
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        connectAttempts += 1;
        lastError = null;
        socket = new WebSocket(url);

        socket.addEventListener('open', () => {
            connected = true;
            send({
                v: PROTOCOL_VERSION,
                type: 'hello',
                reconnectToken
            });
            onLog(`Multiplayer connected (${url})`);
        });

        socket.addEventListener('close', () => {
            connected = false;
            playerId = null;
            snapshotTick = 0;
            remotePlayerCount = 0;
            sessionId = null;
            snapshotPlayers = [];
            snapshotAgeMs = 0;
            totalPlayersSeen = 0;
            relevantPlayersSeen = 0;
            onLog('Multiplayer disconnected');
        });

        socket.addEventListener('error', () => {
            lastError = 'socket_error';
        });

        socket.addEventListener('message', (event) => {
            let message = null;
            const raw = typeof event.data === 'string' ? event.data : '';
            inboundBytesWindow += raw.length;
            try {
                message = JSON.parse(raw);
            } catch {
                return;
            }
            if (!message || typeof message.type !== 'string') {
                return;
            }
            const version = Number(message.v ?? PROTOCOL_VERSION);
            if (version !== PROTOCOL_VERSION) {
                lastError = `protocol_mismatch_server_v${version}`;
                return;
            }
            if (message.type === 'welcome') {
                playerId = message.playerId ?? null;
                reconnectToken = typeof message.reconnectToken === 'string'
                    ? message.reconnectToken
                    : reconnectToken;
                tickRate = Number(message.tickRate) || 0;
                sessionId = typeof message.sessionId === 'string' ? message.sessionId : sessionId;
                authorityPlayerId = Number(message.authorityPlayerId) || authorityPlayerId;
                const lanAddresses = Array.isArray(message.lanAddresses) ? message.lanAddresses : [];
                const preferredAddress = lanAddresses[0] || null;
                if (preferredAddress) {
                    const browserProtocol = window.location.protocol;
                    const browserPort = window.location.port ? `:${window.location.port}` : '';
                    joinHintUrl = `${browserProtocol}//${preferredAddress}${browserPort}/?mp=1&mpHost=${preferredAddress}`;
                } else {
                    joinHintUrl = null;
                }
                return;
            }
            if (message.type === 'snapshot') {
                snapshotTick = Number(message.tick) || snapshotTick;
                const players = Array.isArray(message.players) ? message.players : [];
                authorityPlayerId = Number(message.authorityPlayerId) || authorityPlayerId;
                totalPlayersSeen = Number(message.totalPlayers) || players.length;
                relevantPlayersSeen = Number(message.relevantPlayers) || players.length;
                remotePlayerCount = Math.max(0, players.length - (playerId ? 1 : 0));
                snapshotCountWindow += 1;
                snapshotAgeMs = 0;
                snapshotPlayers = players
                    .map((entry) => ({
                        playerId: entry.playerId,
                        x: Number(entry.x) || 0,
                        y: Number(entry.y) || 0
                    }))
                    .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y));
                const np = message.nonPlayer ?? {};
                nonPlayerSnapshot = {
                    seq: Number(np.seq) || nonPlayerSnapshot.seq,
                    enemies: Array.isArray(np.enemies) ? np.enemies : [],
                    projectiles: {
                        player: Array.isArray(np.projectiles?.player) ? np.projectiles.player : [],
                        tower: Array.isArray(np.projectiles?.tower) ? np.projectiles.tower : [],
                        enemy: Array.isArray(np.projectiles?.enemy) ? np.projectiles.enemy : []
                    },
                    totals: {
                        enemies: Number(np.totals?.enemies) || 0,
                        playerProjectiles: Number(np.totals?.playerProjectiles) || 0,
                        towerProjectiles: Number(np.totals?.towerProjectiles) || 0,
                        enemyProjectiles: Number(np.totals?.enemyProjectiles) || 0
                    }
                };
                return;
            }
            if (message.type === 'pong') {
                const now = performance.now();
                pingMs = Math.max(0, now - lastPingSentAt);
            }
        });
    }

    function disconnect() {
        if (!socket) {
            return;
        }
        try {
            socket.close();
        } catch {
            // Ignore close errors.
        }
        socket = null;
        connected = false;
        joinHintUrl = null;
        sessionId = null;
        snapshotPlayers = [];
        snapshotAgeMs = 0;
        totalPlayersSeen = 0;
        relevantPlayersSeen = 0;
        authorityPlayerId = null;
        nonPlayerSnapshot.seq = 0;
        nonPlayerSnapshot.enemies = [];
        nonPlayerSnapshot.projectiles.player = [];
        nonPlayerSnapshot.projectiles.tower = [];
        nonPlayerSnapshot.projectiles.enemy = [];
    }

    function update(deltaMs) {
        if (!connected) {
            return;
        }
        snapshotAgeMs += deltaMs;
        pingTimer -= deltaMs;
        if (pingTimer <= 0) {
            pingTimer = 1000;
            lastPingSentAt = performance.now();
            send({
                v: PROTOCOL_VERSION,
                type: 'ping',
                clientTime: Date.now()
            });
        }

        inputSendTimerMs -= deltaMs;
        inputKeepaliveTimerMs += deltaMs;
        if (inputSendTimerMs <= 0) {
            inputSendTimerMs = INPUT_SEND_INTERVAL_MS;
            const hasChanged = Math.abs(desiredMoveX - lastSentMoveX) > 0.001 || Math.abs(desiredMoveY - lastSentMoveY) > 0.001;
            if (hasChanged || inputKeepaliveTimerMs >= INPUT_KEEPALIVE_MS) {
                inputSeq += 1;
                send({
                    v: PROTOCOL_VERSION,
                    type: 'input',
                    inputSeq,
                    moveX: desiredMoveX,
                    moveY: desiredMoveY
                });
                inputCountWindow += 1;
                lastSentMoveX = desiredMoveX;
                lastSentMoveY = desiredMoveY;
                inputKeepaliveTimerMs = 0;
            }
        }

        statsWindowTimerMs -= deltaMs;
        if (statsWindowTimerMs <= 0) {
            statsWindowTimerMs += STATS_WINDOW_MS;
            snapshotRate = snapshotCountWindow;
            inputRate = inputCountWindow;
            inboundKbps = inboundBytesWindow / 1024;
            outboundKbps = outboundBytesWindow / 1024;
            snapshotCountWindow = 0;
            inputCountWindow = 0;
            inboundBytesWindow = 0;
            outboundBytesWindow = 0;
        }
    }

    function sendInput(moveX, moveY) {
        if (!connected) {
            return;
        }
        desiredMoveX = moveX;
        desiredMoveY = moveY;
    }

    function sendEntitySnapshot(seq, payload) {
        if (!connected) {
            return;
        }
        send({
            v: PROTOCOL_VERSION,
            type: 'entity_snapshot',
            seq,
            payload
        });
    }

    function getStats() {
        const isAuthority = playerId !== null && authorityPlayerId !== null && String(playerId) === String(authorityPlayerId);
        return {
            url,
            connected,
            playerId,
            authorityPlayerId,
            isAuthority,
            reconnectToken: reconnectToken ? 'set' : 'none',
            snapshotTick,
            remotePlayerCount,
            pingMs,
            tickRate,
            connectAttempts,
            lastError,
            joinHintUrl,
            sessionId,
            snapshotRate,
            inputRate,
            inboundKbps,
            outboundKbps,
            snapshotAgeMs,
            totalPlayersSeen,
            relevantPlayersSeen,
            protocolVersion: PROTOCOL_VERSION,
            nonPlayerSeq: nonPlayerSnapshot.seq,
            nonPlayerTotals: nonPlayerSnapshot.totals
        };
    }

    function getSnapshotState() {
        return {
            sessionId,
            tick: snapshotTick,
            players: snapshotPlayers
        };
    }

    function getNonPlayerSnapshotState() {
        return nonPlayerSnapshot;
    }

    return {
        connect,
        disconnect,
        update,
        sendInput,
        sendEntitySnapshot,
        getStats,
        getSnapshotState,
        getNonPlayerSnapshotState
    };
}
