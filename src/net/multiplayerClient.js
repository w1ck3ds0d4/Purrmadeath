// Multiplayer client foundation:
// - Connects to authoritative websocket server.
// - Sends input stream and pings.
// - Tracks basic connection/replication stats for dev console.
export function createMultiplayerClient({
    url,
    onLog = () => {}
}) {
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

    function isOpen() {
        return socket && socket.readyState === WebSocket.OPEN;
    }

    function send(payload) {
        if (!isOpen()) {
            return;
        }
        socket.send(JSON.stringify(payload));
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
            onLog('Multiplayer disconnected');
        });

        socket.addEventListener('error', () => {
            lastError = 'socket_error';
        });

        socket.addEventListener('message', (event) => {
            let message = null;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            if (!message || typeof message.type !== 'string') {
                return;
            }
            if (message.type === 'welcome') {
                playerId = message.playerId ?? null;
                reconnectToken = typeof message.reconnectToken === 'string'
                    ? message.reconnectToken
                    : reconnectToken;
                tickRate = Number(message.tickRate) || 0;
                sessionId = typeof message.sessionId === 'string' ? message.sessionId : sessionId;
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
                remotePlayerCount = Math.max(0, players.length - (playerId ? 1 : 0));
                snapshotPlayers = players
                    .map((entry) => ({
                        playerId: entry.playerId,
                        x: Number(entry.x) || 0,
                        y: Number(entry.y) || 0
                    }))
                    .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y));
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
    }

    function update(deltaMs) {
        if (!connected) {
            return;
        }
        pingTimer -= deltaMs;
        if (pingTimer <= 0) {
            pingTimer = 1000;
            lastPingSentAt = performance.now();
            send({
                type: 'ping',
                clientTime: Date.now()
            });
        }
    }

    function sendInput(moveX, moveY) {
        if (!connected) {
            return;
        }
        inputSeq += 1;
        send({
            type: 'input',
            inputSeq,
            moveX,
            moveY
        });
    }

    function getStats() {
        return {
            url,
            connected,
            playerId,
            reconnectToken: reconnectToken ? 'set' : 'none',
            snapshotTick,
            remotePlayerCount,
            pingMs,
            tickRate,
            connectAttempts,
            lastError,
            joinHintUrl,
            sessionId
        };
    }

    function getSnapshotState() {
        return {
            sessionId,
            tick: snapshotTick,
            players: snapshotPlayers
        };
    }

    return {
        connect,
        disconnect,
        update,
        sendInput,
        getStats,
        getSnapshotState
    };
}
