const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');
const os = require('os');
const {
    checkConnectionRateLimit,
    clampInputMagnitude,
    isOriginAllowed,
    isPrivateIp,
    normalizeRemoteAddress
} = require('./netSecurity');
const {
    sanitizeEnemyEntries,
    sanitizeProjectileEntries,
    sanitizeSharedResources,
    sanitizePlayerStates,
    sanitizeCivilianStates,
    sanitizeHouseTimers
} = require('./sanitizeState');
const {
    applyResourceDelta,
    createResourceState,
    isValidActionPayload,
    isValidActionResultPayload,
    normalizeBuildCost,
    validateAttackAction,
    validateOriginBoundAction
} = require('./actionUtils');
const {
    buildDeltaNonPlayerPayload,
    filterNonPlayerStateForViewer
} = require('./replicationPayload');
const {
    getBuildingFootprint,
    getBuildingCenterFromSnapshot,
    computeServerAiDirectives,
    findPlausibleSwordTarget,
    findPlausiblePistolTarget
} = require('./aiDirectives');
const { createCombatAuthority } = require('./combatAuthority');
const { createBuildingManager } = require('./buildingManager');

// --- TUNING: server tick rate, player speed, relevance radii ---
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const TICK_RATE = Number(process.env.TICK_RATE || 45);
const TICK_MS = 1000 / TICK_RATE;
const PLAYER_SPEED = Number(process.env.PLAYER_SPEED || 200);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 4);
const PROTOCOL_VERSION = 1;
const PLAYER_RELEVANCE_RADIUS = Number(process.env.PLAYER_RELEVANCE_RADIUS || 2200);
const NON_PLAYER_RELEVANCE_RADIUS = Number(process.env.NON_PLAYER_RELEVANCE_RADIUS || 2400);
const SNAPSHOT_POSITION_PRECISION = Number(process.env.SNAPSHOT_POSITION_PRECISION || 10);
const MAX_INPUT_MAGNITUDE = 1.0;
const PLAYER_TIMEOUT_MS = 30000;
const MAX_REPLICATED_ENEMIES = Number(process.env.MAX_REPLICATED_ENEMIES || 2000);
const MAX_REPLICATED_PROJECTILES = Number(process.env.MAX_REPLICATED_PROJECTILES || 4000);
// --- TUNING: rate limits / anti-cheat / security thresholds ---
const MAX_MESSAGE_BYTES = Number(process.env.MAX_MESSAGE_BYTES || 131072);
const MAX_MESSAGES_PER_SECOND = Number(process.env.MAX_MESSAGES_PER_SECOND || 150);
const MAX_CONNECTIONS_PER_MINUTE_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_MINUTE_PER_IP || 30);
const MAX_PLAYER_ACTIONS_PER_SECOND = Number(process.env.MAX_PLAYER_ACTIONS_PER_SECOND || 45);
// --- TUNING: combat cooldowns and damage values ---
// Server-authoritative action distance validation (anti-teleport/remote-action abuse).
const SERVER_ATTACK_ORIGIN_MAX_DISTANCE = Number(process.env.SERVER_ATTACK_ORIGIN_MAX_DISTANCE || 120);
const SERVER_HARVEST_ORIGIN_MAX_DISTANCE = Number(process.env.SERVER_HARVEST_ORIGIN_MAX_DISTANCE || 140);
const SERVER_REVIVE_ORIGIN_MAX_DISTANCE = Number(process.env.SERVER_REVIVE_ORIGIN_MAX_DISTANCE || 120);
const SERVER_BUILD_MAX_DISTANCE = Number(process.env.SERVER_BUILD_MAX_DISTANCE || 260);
const GOLD_PER_ENEMY_KILL = Number(process.env.GOLD_PER_ENEMY_KILL || 5);
const SERVER_SWORD_RANGE = Number(process.env.SERVER_SWORD_RANGE || 52);
const SERVER_SWORD_ARC_RADIANS = Number(process.env.SERVER_SWORD_ARC_RADIANS || (Math.PI * 0.95));
const SERVER_SWORD_DAMAGE = Number(process.env.SERVER_SWORD_DAMAGE || 25);
const SERVER_PISTOL_DAMAGE = Number(process.env.SERVER_PISTOL_DAMAGE || 20);
const SERVER_PISTOL_RANGE = Number(process.env.SERVER_PISTOL_RANGE || 640);
const SERVER_PISTOL_AIM_COS = Number(process.env.SERVER_PISTOL_AIM_COS || 0.95);
const SERVER_ENEMY_RADIUS = Number(process.env.SERVER_ENEMY_RADIUS || 10);
const SERVER_ENEMY_PROJECTILE_DAMAGE = Number(process.env.SERVER_ENEMY_PROJECTILE_DAMAGE || 12);
const SERVER_ENEMY_PROJECTILE_RADIUS = Number(process.env.SERVER_ENEMY_PROJECTILE_RADIUS || 4);
const SERVER_TOWER_PROJECTILE_DAMAGE = Number(process.env.SERVER_TOWER_PROJECTILE_DAMAGE || 16);
const SERVER_TOWER_PROJECTILE_RADIUS = Number(process.env.SERVER_TOWER_PROJECTILE_RADIUS || 4);
const SERVER_ENEMY_CONTACT_DAMAGE = Number(process.env.SERVER_ENEMY_CONTACT_DAMAGE || 10);
const SERVER_ENEMY_CONTACT_COOLDOWN_MS = Number(process.env.SERVER_ENEMY_CONTACT_COOLDOWN_MS || 583);
const AUTHORITY_SNAPSHOT_STALL_MS = Number(process.env.AUTHORITY_SNAPSHOT_STALL_MS || 1200);
const AI_DIRECTIVE_BUDGET_MS = Number(process.env.AI_DIRECTIVE_BUDGET_MS || 1.5);
const SERVER_PLAYER_RADIUS = Number(process.env.SERVER_PLAYER_RADIUS || 10);
const SERVER_CIVILIAN_RADIUS = Number(process.env.SERVER_CIVILIAN_RADIUS || 8);
const SERVER_PLAYER_RESPAWN_SECONDS = Number(process.env.SERVER_PLAYER_RESPAWN_SECONDS || 15);
const SERVER_TILE_SIZE = Number(process.env.SERVER_TILE_SIZE || 32);
// Server cooldowns to bound follower attack spam.
const SERVER_ATTACK_COOLDOWNS_MS = {
    sword: Number(process.env.SERVER_SWORD_COOLDOWN_MS || 333),
    pistol: Number(process.env.SERVER_PISTOL_COOLDOWN_MS || 200)
};
const HELLO_TIMEOUT_MS = Number(process.env.HELLO_TIMEOUT_MS || 5000);
const PRIVATE_NETWORK_ONLY = (process.env.PRIVATE_NETWORK_ONLY || '1') !== '0';
const JOIN_TOKEN = process.env.JOIN_TOKEN || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
const BUILDING_RULES = {
    lumberMill: {
        footprint: { w: 2, h: 2 },
        cost: { wood: 20, stone: 10, iron: 0, gold: 0 },
        maxHp: 1000,
        unbreakable: false,
        outputResource: 'wood',
        producer: { cycleFrames: 180, outputPerCycle: 1, storageCap: 50 }
    },
    stoneQuarry: {
        footprint: { w: 2, h: 2 },
        cost: { wood: 12, stone: 8, iron: 0, gold: 0 },
        maxHp: 1000,
        unbreakable: false,
        outputResource: 'stone',
        producer: { cycleFrames: 220, outputPerCycle: 1, storageCap: 45 }
    },
    ironMine: {
        footprint: { w: 2, h: 2 },
        cost: { wood: 10, stone: 14, iron: 4, gold: 0 },
        maxHp: 1000,
        unbreakable: false,
        outputResource: 'iron',
        producer: { cycleFrames: 280, outputPerCycle: 1, storageCap: 35 }
    },
    houseLvl1: { footprint: { w: 2, h: 2 }, cost: { wood: 15, stone: 5, iron: 0, gold: 0 }, maxHp: 1000, unbreakable: false },
    warehouse: { footprint: { w: 3, h: 3 }, cost: { wood: 25, stone: 20, iron: 5, gold: 0 }, maxHp: 1000, unbreakable: false },
    bridge: { footprint: { w: 1, h: 1 }, cost: { wood: 2, stone: 1, iron: 0, gold: 0 }, maxHp: 1, unbreakable: true },
    combatTower: { footprint: { w: 1, h: 1 }, cost: { wood: 6, stone: 10, iron: 2, gold: 0 }, maxHp: 900, unbreakable: false },
    wallLvl1: { footprint: { w: 1, h: 1 }, cost: { wood: 1, stone: 0, iron: 0, gold: 0 }, maxHp: 500, unbreakable: true },
    wallLvl2: { footprint: { w: 1, h: 1 }, cost: { wood: 0, stone: 1, iron: 0, gold: 0 }, maxHp: 1500, unbreakable: true },
    wallLvl3: { footprint: { w: 1, h: 1 }, cost: { wood: 0, stone: 0, iron: 1, gold: 0 }, maxHp: 3000, unbreakable: true }
};

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    console.error(`[multiplayer] invalid PORT: "${process.env.PORT}". Must be an integer 1–65535.`);
    process.exit(1);
}
const wss = new WebSocketServer({
    host: HOST,
    port: PORT,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false
});
// Avoid crashing with a noisy stack when the port is already in use.
wss.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
        console.error(`[multiplayer] port ${PORT} is already in use. Stop the existing server or run with a different PORT.`);
        process.exit(1);
    }
    console.error('[multiplayer] websocket server error:', error);
    process.exit(1);
});
const clients = new Map();
const reconnectIndex = new Map();
let tick = 0;
let nextPlayerId = 1;
const sessionId = randomUUID();
let authorityPlayerId = null;
let serverSessionTimeSeconds = 0;
let nonPlayerState = {
    seq: 0,
    enemies: [],
    projectiles: {
        player: [],
        tower: [],
        enemy: []
    },
    playerStates: [],
    civilians: [],
    houseTimers: [],
    sessionTimeSeconds: 0,
    sessionState: { paused: false, restartVersion: 0, restartVotes: 0, restartEligiblePlayers: 0 },
    sharedResources: null,
    aiDirectives: null,
    buildingsState: null,
    buildingsRevision: 0
};
const perSocketNonPlayerCache = new WeakMap();
const connectionRateByIp = new Map();
const socketSecurityState = new WeakMap();
const pauseVotesByPlayerId = new Set();
const restartVotesByPlayerId = new Set();
// Server telemetry mirrored to dev console `/server` section.
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
    connectedClients: 0,
    forwardedPlayerActions: 0,
    rejectedPlayerActions: 0,
    reservedBuildActions: 0,
    refundedBuildReservations: 0,
    activeBuildReservations: 0,
    activeTileReservations: 0,
    duplicateOrStaleActions: 0,
    buildingStateMismatchCount: 0,
    lastServerBuildingHash: '0',
    lastAuthorityBuildingHash: '0',
    producerSimUpdateMsAvg: 0,
    serverHarvestApplied: 0,
    serverHarvestRejected: 0,
    attackRejectedOrigin: 0,
    attackRejectedCooldown: 0,
    attackRejectedNoTarget: 0,
    forwardedAttackActions: 0,
    rangeRejectedActions: 0,
    privilegedRejectedActions: 0,
    pauseVotes: 0,
    pauseEligiblePlayers: 0,
    killCorrections: 0,
    goldCorrections: 0,
    enemyProjectileDamageApplied: 0,
    enemyProjectilePlayerHits: 0,
    enemyProjectileCivilianHits: 0,
    enemyProjectileBuildingHits: 0,
    towerProjectileDamageApplied: 0,
    towerProjectileEnemyHits: 0,
    enemyMeleeDamageApplied: 0,
    enemyMeleePlayerHits: 0,
    enemyMeleeCivilianHits: 0,
    authoritySnapshotAgeMs: -1,
    combatFrozenBySnapshotStall: 0,
    combatFreezeTicks: 0,
    droppedQueuedEnemyHits: 0,
    aiDirectiveMsAvg: 0,
    aiDirectiveBudgetMs: AI_DIRECTIVE_BUDGET_MS,
    aiDirectiveOverBudgetTicks: 0,
    aiTowerAssignments: 0,
    aiRangedAssignments: 0,
    aiCivilianAssignments: 0,
    restartVotes: 0,
    restartEligiblePlayers: 0,
    restartsTriggered: 0
};
let lastTickStartedAt = Date.now();
let lastNetWindowAt = Date.now();
// --- EXTENSION: add new authority domain module instances here ---
const combat = createCombatAuthority({
    serverPerf,
    getAuthorityPlayerId: () => authorityPlayerId,
    bumpBuildingRevision: () => {
        nonPlayerState.buildingsRevision = Math.max(0, Number(nonPlayerState.buildingsRevision) || 0) + 1;
    },
    BUILDING_RULES,
    GOLD_PER_ENEMY_KILL,
    AUTHORITY_SNAPSHOT_STALL_MS,
    SERVER_ENEMY_RADIUS,
    SERVER_ENEMY_PROJECTILE_DAMAGE,
    SERVER_ENEMY_PROJECTILE_RADIUS,
    SERVER_ENEMY_CONTACT_DAMAGE,
    SERVER_ENEMY_CONTACT_COOLDOWN_MS,
    SERVER_TOWER_PROJECTILE_DAMAGE,
    SERVER_TOWER_PROJECTILE_RADIUS,
    SERVER_PLAYER_RADIUS,
    SERVER_CIVILIAN_RADIUS,
    SERVER_PLAYER_RESPAWN_SECONDS,
    SERVER_TILE_SIZE
});
const buildings = createBuildingManager({
    getNonPlayerState: () => nonPlayerState,
    serverPerf,
    BUILDING_RULES,
    SERVER_BUILD_MAX_DISTANCE,
    SERVER_TILE_SIZE
});

function createPlayerState(playerId, reconnectToken) {
    return {
        playerId,
        reconnectToken,
        x: 16,
        y: 16,
        clientX: 16,
        clientY: 16,
        hasClientPose: false,
        lastClientPoseAt: 0,
        inputX: 0,
        inputY: 0,
        lastInputSeq: 0,
        lastSeenAt: Date.now(),
        actionWindowStartedAt: Date.now(),
        actionCountInWindow: 0,
        lastClientActionIdByType: {
            build: 0,
            remove: 0
        },
        lastAttackAtByWeapon: {
            sword: 0,
            pistol: 0
        }
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
    if (state.playerId === authorityPlayerId) {
        // Grace period for freshly elected/reconnected authority before first snapshot arrives.
        combat.setLastSnapshotAt(Date.now());
    }
    // New players start unpaused; full session pause requires unanimous vote.
    pauseVotesByPlayerId.delete(state.playerId);
    restartVotesByPlayerId.delete(state.playerId);
    recomputeServerPauseState();
    recomputeServerRestartVoteState();
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

function getActivePlayerIds() {
    const activePlayerIds = new Set();
    for (const state of clients.values()) {
        if (state?.playerId) {
            activePlayerIds.add(state.playerId);
        }
    }
    return activePlayerIds;
}

function recomputeServerPauseState() {
    const activePlayerIds = getActivePlayerIds();
    for (const votedPlayerId of pauseVotesByPlayerId) {
        if (!activePlayerIds.has(votedPlayerId)) {
            pauseVotesByPlayerId.delete(votedPlayerId);
        }
    }
    const requiredVotes = Math.max(1, activePlayerIds.size);
    let activeVotes = 0;
    for (const playerId of activePlayerIds) {
        if (pauseVotesByPlayerId.has(playerId)) {
            activeVotes += 1;
        }
    }
    const current = nonPlayerState.sessionState ?? {};
    nonPlayerState.sessionState = {
        paused: activeVotes >= requiredVotes,
        restartVersion: Math.max(0, Number(current.restartVersion) || 0),
        restartVotes: Math.max(0, Number(current.restartVotes) || 0),
        restartEligiblePlayers: Math.max(0, Number(current.restartEligiblePlayers) || 0)
    };
}

function recomputeServerRestartVoteState() {
    const activePlayerIds = getActivePlayerIds();
    for (const votedPlayerId of restartVotesByPlayerId) {
        if (!activePlayerIds.has(votedPlayerId)) {
            restartVotesByPlayerId.delete(votedPlayerId);
        }
    }
    const current = nonPlayerState.sessionState ?? {};
    nonPlayerState.sessionState = {
        paused: Boolean(current.paused),
        restartVersion: Math.max(0, Number(current.restartVersion) || 0),
        restartVotes: restartVotesByPlayerId.size,
        restartEligiblePlayers: activePlayerIds.size
    };
}

function triggerSessionRestart() {
    pauseVotesByPlayerId.clear();
    restartVotesByPlayerId.clear();
    buildings.clearPendingReservations();
    combat.reset();
    const current = nonPlayerState.sessionState ?? {};
    nonPlayerState.sessionState = {
        paused: false,
        restartVersion: Math.max(0, Number(current.restartVersion) || 0) + 1,
        restartVotes: 0,
        restartEligiblePlayers: getActivePlayerIds().size
    };
    serverPerf.restartsTriggered += 1;
    // Clear entity arrays immediately so the server doesn't broadcast stale state
    // during the window before the authority sends its first fresh snapshot.
    nonPlayerState.enemies = [];
    nonPlayerState.projectiles = { player: [], tower: [], enemy: [] };
    nonPlayerState.civilians = [];
    nonPlayerState.buildingsState = null;
    nonPlayerState.sharedResources = null;
}

function closeWithError(socket, code, reason, extra = {}) {
    sendMessage(socket, {
        v: PROTOCOL_VERSION,
        type: 'error',
        code,
        reason,
        ...extra
    });
    try {
        socket.close();
    } catch {
        // Ignore close errors on dead sockets.
    }
}

function broadcastSnapshot() {
    if (clients.size === 0) {
        return;
    }
    const allPlayers = [...clients.values()];
    serverPerf.connectedClients = allPlayers.length;
    serverPerf.activeBuildReservations = buildings.getPendingBuildReservations().size;
    serverPerf.activeTileReservations = buildings.getPendingTileReservations().size;
    serverPerf.pauseVotes = pauseVotesByPlayerId.size;
    serverPerf.pauseEligiblePlayers = allPlayers.length;
    serverPerf.restartVotes = restartVotesByPlayerId.size;
    serverPerf.restartEligiblePlayers = allPlayers.length;
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
                connectedClients: serverPerf.connectedClients,
                forwardedPlayerActions: serverPerf.forwardedPlayerActions,
                rejectedPlayerActions: serverPerf.rejectedPlayerActions,
                reservedBuildActions: serverPerf.reservedBuildActions,
                refundedBuildReservations: serverPerf.refundedBuildReservations,
                activeBuildReservations: serverPerf.activeBuildReservations,
                activeTileReservations: serverPerf.activeTileReservations,
                duplicateOrStaleActions: serverPerf.duplicateOrStaleActions,
                buildingStateMismatchCount: serverPerf.buildingStateMismatchCount,
                lastServerBuildingHash: serverPerf.lastServerBuildingHash,
                lastAuthorityBuildingHash: serverPerf.lastAuthorityBuildingHash,
                producerSimUpdateMsAvg: Number(serverPerf.producerSimUpdateMsAvg.toFixed(3)),
                serverHarvestApplied: serverPerf.serverHarvestApplied,
                serverHarvestRejected: serverPerf.serverHarvestRejected,
                attackRejectedOrigin: serverPerf.attackRejectedOrigin,
                attackRejectedCooldown: serverPerf.attackRejectedCooldown,
                attackRejectedNoTarget: serverPerf.attackRejectedNoTarget,
                forwardedAttackActions: serverPerf.forwardedAttackActions,
                rangeRejectedActions: serverPerf.rangeRejectedActions,
                privilegedRejectedActions: serverPerf.privilegedRejectedActions,
                pauseVotes: serverPerf.pauseVotes,
                pauseEligiblePlayers: serverPerf.pauseEligiblePlayers,
                restartVotes: serverPerf.restartVotes,
                restartEligiblePlayers: serverPerf.restartEligiblePlayers,
                restartsTriggered: serverPerf.restartsTriggered,
                killCorrections: serverPerf.killCorrections,
                goldCorrections: serverPerf.goldCorrections,
                enemyProjectileDamageApplied: serverPerf.enemyProjectileDamageApplied,
                enemyProjectilePlayerHits: serverPerf.enemyProjectilePlayerHits,
                enemyProjectileCivilianHits: serverPerf.enemyProjectileCivilianHits,
                enemyProjectileBuildingHits: serverPerf.enemyProjectileBuildingHits,
                towerProjectileDamageApplied: serverPerf.towerProjectileDamageApplied,
                towerProjectileEnemyHits: serverPerf.towerProjectileEnemyHits,
                enemyMeleeDamageApplied: serverPerf.enemyMeleeDamageApplied,
                enemyMeleePlayerHits: serverPerf.enemyMeleePlayerHits,
                enemyMeleeCivilianHits: serverPerf.enemyMeleeCivilianHits,
                authoritySnapshotAgeMs: serverPerf.authoritySnapshotAgeMs,
                combatFrozenBySnapshotStall: serverPerf.combatFrozenBySnapshotStall,
                combatFreezeTicks: serverPerf.combatFreezeTicks,
                droppedQueuedEnemyHits: serverPerf.droppedQueuedEnemyHits,
                aiDirectiveMsAvg: Number(serverPerf.aiDirectiveMsAvg.toFixed(3)),
                aiDirectiveBudgetMs: Number(serverPerf.aiDirectiveBudgetMs.toFixed(3)),
                aiDirectiveOverBudgetTicks: serverPerf.aiDirectiveOverBudgetTicks,
                aiTowerAssignments: serverPerf.aiTowerAssignments,
                aiRangedAssignments: serverPerf.aiRangedAssignments,
                aiCivilianAssignments: serverPerf.aiCivilianAssignments
            },
            players: relevantPlayers.map((state) => ({
                playerId: state.playerId,
                x: quantizePosition(state.x),
                y: quantizePosition(state.y),
                lastInputSeq: state.lastInputSeq
            })),
            nonPlayer: buildDeltaNonPlayerPayload(
                socket,
                filterNonPlayerStateForViewer(nonPlayerState, viewer, NON_PLAYER_RELEVANCE_RADIUS),
                perSocketNonPlayerCache
            )
        };
        const encoded = JSON.stringify(payload);
        serverPerf.outboundBytesWindow += encoded.length;
        socket.send(encoded);
    }
}

function simulateTick() {
    const tickStartedAt = Date.now();
    const elapsedTickMs = Math.max(1, tickStartedAt - lastTickStartedAt);
    const loopLagMs = Math.max(0, elapsedTickMs - TICK_MS);
    lastTickStartedAt = tickStartedAt;
    const simStartedAt = performance.now();
    tick += 1;
    // Use elapsed wall-clock time so follower movement does not slow down when the loop jitters.
    const dt = Math.min(TICK_MS * 2, elapsedTickMs) / 1000;
    const dtFrames60 = dt * 60;
    const now = Date.now();
    const authoritySnapshotAgeMs = combat.getSnapshotAgeMs(now);
    const combatMutationsFrozen = combat.isFrozen(now);
    serverPerf.authoritySnapshotAgeMs = Number.isFinite(authoritySnapshotAgeMs) ? authoritySnapshotAgeMs : -1;
    serverPerf.combatFrozenBySnapshotStall = combatMutationsFrozen ? 1 : 0;
    if (combatMutationsFrozen) {
        serverPerf.combatFreezeTicks += 1;
        combat.drainQueuedHits();
    }
    serverSessionTimeSeconds += dt;
    nonPlayerState.sessionTimeSeconds = serverSessionTimeSeconds;
    buildings.updateProducerOutputs(dtFrames60);
    for (const [reservationKey, reservation] of buildings.getPendingBuildReservations()) {
        if (now - reservation.createdAt <= 5000) {
            continue;
        }
        buildings.applyResourceDelta(reservation.cost, +1);
        buildings.getPendingBuildReservations().delete(reservationKey);
        serverPerf.refundedBuildReservations += 1;
    }
    for (const [tileKey, reservation] of buildings.getPendingTileReservations()) {
        if (now - reservation.createdAt <= 5000) {
            continue;
        }
        buildings.getPendingTileReservations().delete(tileKey);
    }

    let removedAnyConnection = false;
    for (const [socket, state] of clients) {
        if (now - state.lastSeenAt > PLAYER_TIMEOUT_MS) {
            clients.delete(socket);
            pauseVotesByPlayerId.delete(state.playerId);
            restartVotesByPlayerId.delete(state.playerId);
            removedAnyConnection = true;
            continue;
        }
        const playerState = Array.isArray(nonPlayerState.playerStates)
            ? nonPlayerState.playerStates.find((entry) => entry.playerId === state.playerId)
            : null;
        if (playerState?.isDead) {
            continue;
        }
        if (
            state.playerId === authorityPlayerId &&
            playerState &&
            Number.isFinite(playerState.x) &&
            Number.isFinite(playerState.y)
        ) {
            state.x = playerState.x;
            state.y = playerState.y;
            continue;
        }
        if (state.playerId !== authorityPlayerId && state.hasClientPose) {
            const freshPose = (now - state.lastClientPoseAt) <= 250;
            if (freshPose) {
                // Followers are client-predicted: allow generous pose catch-up to reduce rubber-banding.
                const maxStep = PLAYER_SPEED * dt * 4.5 + 8;
                const dxPose = state.clientX - state.x;
                const dyPose = state.clientY - state.y;
                const distPose = Math.hypot(dxPose, dyPose);
                if (distPose <= maxStep || distPose <= 0.001) {
                    state.x = state.clientX;
                    state.y = state.clientY;
                } else {
                    const scale = maxStep / distPose;
                    state.x += dxPose * scale;
                    state.y += dyPose * scale;
                }
                continue;
            }
        }
        state.x += state.inputX * PLAYER_SPEED * dt;
        state.y += state.inputY * PLAYER_SPEED * dt;
    }
    if (removedAnyConnection) {
        recomputeServerPauseState();
        recomputeServerRestartVoteState();
    }

    const aiStartedAt = performance.now();
    nonPlayerState.aiDirectives = computeServerAiDirectives(nonPlayerState, tick, BUILDING_RULES, { SERVER_ENEMY_RADIUS, SERVER_TILE_SIZE });
    const aiElapsedMs = performance.now() - aiStartedAt;
    serverPerf.aiDirectiveMsAvg = serverPerf.aiDirectiveMsAvg * 0.9 + aiElapsedMs * 0.1;
    if (aiElapsedMs > AI_DIRECTIVE_BUDGET_MS) {
        serverPerf.aiDirectiveOverBudgetTicks += 1;
    }
    serverPerf.aiTowerAssignments = Object.keys(nonPlayerState.aiDirectives?.towers ?? {}).length;
    serverPerf.aiRangedAssignments = Object.keys(nonPlayerState.aiDirectives?.rangedEnemies ?? {}).length;
    serverPerf.aiCivilianAssignments = Object.keys(nonPlayerState.aiDirectives?.civilians ?? {}).length;

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
    const sec = socketSecurityState.get(socket);
    if (!sec) {
        return;
    }
    if (JOIN_TOKEN && message.joinToken !== JOIN_TOKEN) {
        closeWithError(socket, 'auth_required', 'Invalid join token');
        return;
    }
    const reconnectToken = typeof message.reconnectToken === 'string' ? message.reconnectToken : null;
    if (reconnectToken && reconnectIndex.has(reconnectToken)) {
        const previous = reconnectIndex.get(reconnectToken);
        previous.lastSeenAt = Date.now();
        attachConnection(socket, previous);
        sec.hasCompletedHello = true;
        clearTimeout(sec.helloTimerId);
        return;
    }
    if (clients.size >= MAX_PLAYERS) {
        closeWithError(socket, 'session_full', 'Session is full', { maxPlayers: MAX_PLAYERS });
        return;
    }

    const token = randomUUID();
    const state = createPlayerState(nextPlayerId++, token);
    attachConnection(socket, state);
    sec.hasCompletedHello = true;
    clearTimeout(sec.helloTimerId);
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
    const clamped = clampInputMagnitude(rawX, rawY, MAX_INPUT_MAGNITUDE);
    state.inputX = clamped.x;
    state.inputY = clamped.y;
    const clientX = Number(message.clientX);
    const clientY = Number(message.clientY);
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
        state.clientX = clientX;
        state.clientY = clientY;
        state.hasClientPose = true;
        state.lastClientPoseAt = Date.now();
    }
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
    combat.setLastSnapshotAt(Date.now());
    const seq = Number(message.seq);
    if (!Number.isFinite(seq) || seq <= nonPlayerState.seq) {
        return;
    }
    const payload = message.payload ?? {};
    if (payload.buildingsState && nonPlayerState.buildingsState) {
        const authorityHash = buildings.computeBuildingStateHash(payload.buildingsState);
        const serverHash = buildings.computeBuildingStateHash(nonPlayerState.buildingsState);
        serverPerf.lastAuthorityBuildingHash = authorityHash;
        serverPerf.lastServerBuildingHash = serverHash;
        if (authorityHash !== serverHash) {
            serverPerf.buildingStateMismatchCount += 1;
        }
    }
    if (!nonPlayerState.buildingsState && payload.buildingsState) {
        buildings.ensureBuildingState(payload.buildingsState);
        nonPlayerState.buildingsRevision = Math.max(
            Number(nonPlayerState.buildingsRevision) || 0,
            Number(payload.buildingsRevision) || 0
        );
    }
    const payloadSharedResources = sanitizeSharedResources(payload.sharedResources) ?? nonPlayerState.sharedResources;
    const effectiveSharedResources = payloadSharedResources
        ? createResourceState(payloadSharedResources)
        : createResourceState();
    applyResourceDelta(effectiveSharedResources, buildings.getResourceDelta(), +1);
    nonPlayerState.sharedResources = effectiveSharedResources;
    if (!nonPlayerState.sharedResources) {
        nonPlayerState.sharedResources = createResourceState();
    }
    const sanitizedEnemies = sanitizeEnemyEntries(payload.enemies, MAX_REPLICATED_ENEMIES, quantizePosition);
    const sanitizedPlayerStates = sanitizePlayerStates(payload.playerStates, quantizePosition);
    const sanitizedCivilians = sanitizeCivilianStates(payload.civilians, quantizePosition);
    const sanitizedPlayerProjectiles = sanitizeProjectileEntries(payload.projectiles?.player, MAX_REPLICATED_PROJECTILES, quantizePosition);
    let sanitizedTowerProjectiles = sanitizeProjectileEntries(payload.projectiles?.tower, MAX_REPLICATED_PROJECTILES, quantizePosition);
    let sanitizedEnemyProjectiles = sanitizeProjectileEntries(payload.projectiles?.enemy, MAX_REPLICATED_PROJECTILES, quantizePosition);
    if (!combat.isFrozen()) {
        combat.applyQueuedEnemyHits(sanitizedEnemies);
        sanitizedTowerProjectiles = combat.applyTowerProjectileDamage(sanitizedTowerProjectiles, sanitizedEnemies, tick);
        combat.applyEnemyMeleeContactDamage(sanitizedEnemies, sanitizedPlayerStates, sanitizedCivilians);
        sanitizedEnemyProjectiles = combat.applyEnemyProjectileDamage(
            sanitizedEnemyProjectiles,
            sanitizedPlayerStates,
            sanitizedCivilians,
            nonPlayerState.buildingsState,
            tick
        );
    } else {
        combat.drainQueuedHits();
    }
    combat.reconcile(sanitizedPlayerStates, effectiveSharedResources);
    nonPlayerState = {
        seq: Math.floor(seq),
        enemies: sanitizedEnemies,
        projectiles: {
            player: sanitizedPlayerProjectiles,
            tower: sanitizedTowerProjectiles,
            enemy: sanitizedEnemyProjectiles
        },
        playerStates: sanitizedPlayerStates,
        civilians: sanitizedCivilians,
        houseTimers: sanitizeHouseTimers(payload.houseTimers),
        // Session runtime is authoritative on server tick, never on host payload.
        sessionTimeSeconds: serverSessionTimeSeconds,
        // Session state is fully server-authoritative (pause + restart voting/version).
        sessionState: {
            paused: Boolean(nonPlayerState.sessionState?.paused),
            restartVersion: Math.max(0, Number(nonPlayerState.sessionState?.restartVersion) || 0),
            restartVotes: Math.max(0, Number(nonPlayerState.sessionState?.restartVotes) || 0),
            restartEligiblePlayers: Math.max(0, Number(nonPlayerState.sessionState?.restartEligiblePlayers) || 0)
        },
        sharedResources: effectiveSharedResources,
        aiDirectives: nonPlayerState.aiDirectives,
        buildingsState: nonPlayerState.buildingsState,
        buildingsRevision: nonPlayerState.buildingsRevision
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

// Primary trust-boundary gate for all follower actions:
// validates, applies authoritative mutations where available, then relays to host authority when required.
function handlePlayerAction(socket, message) {
    const actor = clients.get(socket);
    if (!actor) {
        return;
    }
    let forwardedAction = message.action ?? null;
    const now = Date.now();
    if (now - actor.actionWindowStartedAt >= 1000) {
        actor.actionWindowStartedAt = now;
        actor.actionCountInWindow = 0;
    }
    actor.actionCountInWindow += 1;
    if (actor.actionCountInWindow > MAX_PLAYER_ACTIONS_PER_SECOND) {
        serverPerf.rejectedPlayerActions += 1;
        if (Number.isFinite(Number(message.action?.clientActionId))) {
            sendMessage(socket, {
                v: PROTOCOL_VERSION,
                type: 'player_action_result',
                result: {
                    actionType: message.action?.type ?? 'unknown',
                    clientActionId: Math.floor(Number(message.action?.clientActionId) || 0),
                    accepted: false,
                    reason: 'rate_limited'
                }
            });
        }
        return;
    }
    if (!isValidActionPayload(message.action)) {
        serverPerf.rejectedPlayerActions += 1;
        return;
    }
    if (
        actor.playerId !== authorityPlayerId &&
        (message.action?.type === 'dev_add_resources' || message.action?.type === 'force_reset_session')
    ) {
        serverPerf.rejectedPlayerActions += 1;
        serverPerf.privilegedRejectedActions += 1;
        sendMessage(socket, {
            v: PROTOCOL_VERSION,
            type: 'player_action_result',
            result: {
                actionType: message.action.type,
                clientActionId: Math.floor(Number(message.action.clientActionId) || 0),
                accepted: false,
                reason: 'not_authority'
            }
        });
        return;
    }
    if (message.action?.type === 'toggle_pause') {
        if (pauseVotesByPlayerId.has(actor.playerId)) {
            pauseVotesByPlayerId.delete(actor.playerId);
        } else {
            pauseVotesByPlayerId.add(actor.playerId);
        }
        recomputeServerPauseState();
        sendMessage(socket, {
            v: PROTOCOL_VERSION,
            type: 'player_action_result',
            result: {
                actionType: 'toggle_pause',
                clientActionId: Math.floor(Number(message.action.clientActionId) || 0),
                accepted: true,
                reason: ''
            }
        });
        return;
    }
    if (message.action?.type === 'restart_session') {
        if (restartVotesByPlayerId.has(actor.playerId)) {
            restartVotesByPlayerId.delete(actor.playerId);
        } else {
            restartVotesByPlayerId.add(actor.playerId);
        }
        recomputeServerRestartVoteState();
        const activePlayerIds = getActivePlayerIds();
        const requiredVotes = Math.max(1, activePlayerIds.size);
        const hasUnanimousRestart = restartVotesByPlayerId.size >= requiredVotes;
        if (hasUnanimousRestart) {
            triggerSessionRestart();
        }
        sendMessage(socket, {
            v: PROTOCOL_VERSION,
            type: 'player_action_result',
            result: {
                actionType: 'restart_session',
                clientActionId: Math.floor(Number(message.action.clientActionId) || 0),
                accepted: true,
                reason: hasUnanimousRestart ? 'restart_triggered' : ''
            }
        });
        return;
    }
    if (message.action?.type === 'force_reset_session') {
        triggerSessionRestart();
        sendMessage(socket, {
            v: PROTOCOL_VERSION,
            type: 'player_action_result',
            result: {
                actionType: 'force_reset_session',
                clientActionId: Math.floor(Number(message.action.clientActionId) || 0),
                accepted: true,
                reason: ''
            }
        });
        return;
    }
    if (message.action?.type === 'build' || message.action?.type === 'remove') {
        const actionType = message.action.type;
        const clientActionId = Math.floor(Number(message.action.clientActionId) || 0);
        const lastSeenId = Math.floor(Number(actor.lastClientActionIdByType?.[actionType]) || 0);
        if (clientActionId <= 0 || clientActionId <= lastSeenId) {
            serverPerf.rejectedPlayerActions += 1;
            serverPerf.duplicateOrStaleActions += 1;
            sendMessage(socket, {
                v: PROTOCOL_VERSION,
                type: 'player_action_result',
                result: {
                    actionType,
                    clientActionId,
                    accepted: false,
                    reason: 'duplicate_or_stale_action_id'
                }
            });
            return;
        }
        actor.lastClientActionIdByType[actionType] = clientActionId;
    }
    if (message.action?.type === 'build' || message.action?.type === 'remove') {
        const validation = buildings.validateBuildOrRemove(message.action, actor);
        if (!validation.ok) {
            serverPerf.rejectedPlayerActions += 1;
            if (validation.reason === 'build_out_of_range' || validation.reason === 'remove_out_of_range') {
                serverPerf.rangeRejectedActions += 1;
            }
            sendMessage(socket, {
                v: PROTOCOL_VERSION,
                type: 'player_action_result',
                result: {
                    actionType: message.action.type,
                    clientActionId: Math.floor(Number(message.action.clientActionId) || 0),
                    accepted: false,
                    reason: validation.reason
                }
            });
            return;
        }
    }
    if (message.action?.type === 'attack') {
        const validation = validateAttackAction(
            message.action,
            actor,
            SERVER_ATTACK_ORIGIN_MAX_DISTANCE,
            SERVER_ATTACK_COOLDOWNS_MS
        );
        if (!validation.ok) {
            serverPerf.rejectedPlayerActions += 1;
            if (validation.reason === 'attack_origin_too_far') {
                serverPerf.attackRejectedOrigin += 1;
                serverPerf.rangeRejectedActions += 1;
            } else if (validation.reason === 'attack_cooldown') {
                serverPerf.attackRejectedCooldown += 1;
            }
            sendMessage(socket, {
                v: PROTOCOL_VERSION,
                type: 'player_action_result',
                result: {
                    actionType: 'attack',
                    clientActionId: Math.floor(Number(message.action.clientActionId) || 0),
                    accepted: false,
                    reason: validation.reason
                }
            });
            return;
        }
        if (message.action.weapon === 'sword' && actor.playerId !== authorityPlayerId) {
            const target = findPlausibleSwordTarget(message.action, nonPlayerState.enemies, { SERVER_SWORD_RANGE, SERVER_SWORD_ARC_RADIANS, SERVER_ENEMY_RADIUS });
            if (!target) {
                serverPerf.rejectedPlayerActions += 1;
                serverPerf.attackRejectedNoTarget += 1;
                sendMessage(socket, {
                    v: PROTOCOL_VERSION,
                    type: 'player_action_result',
                    result: {
                        actionType: 'attack',
                        clientActionId: Math.floor(Number(message.action.clientActionId) || 0),
                        accepted: false,
                        reason: 'attack_no_target'
                    }
                });
                return;
            }
            combat.queueEnemyHit(actor.playerId, target.enemyId, SERVER_SWORD_DAMAGE);
            forwardedAction = {
                ...message.action,
                serverDamageApplied: true,
                serverTargetEnemyId: target.enemyId
            };
        } else if (message.action.weapon === 'pistol' && actor.playerId !== authorityPlayerId) {
            const target = findPlausiblePistolTarget(message.action, nonPlayerState.enemies, { SERVER_PISTOL_RANGE, SERVER_PISTOL_AIM_COS, SERVER_ENEMY_RADIUS });
            if (target) {
                combat.queueEnemyHit(actor.playerId, target.enemyId, SERVER_PISTOL_DAMAGE);
                forwardedAction = {
                    ...message.action,
                    serverDamageApplied: true,
                    serverTargetEnemyId: target.enemyId
                };
            } else {
                forwardedAction = {
                    ...message.action,
                    serverDamageApplied: true
                };
            }
        }
        sendMessage(socket, {
            v: PROTOCOL_VERSION,
            type: 'player_action_result',
            result: {
                actionType: 'attack',
                clientActionId: Math.floor(Number(message.action.clientActionId) || 0),
                accepted: true,
                reason: ''
            }
        });
    }
    if (message.action?.type === 'harvest') {
        const originValidation = validateOriginBoundAction(
            message.action,
            actor,
            SERVER_HARVEST_ORIGIN_MAX_DISTANCE,
            'harvest_origin_too_far'
        );
        if (!originValidation.ok) {
            serverPerf.rejectedPlayerActions += 1;
            serverPerf.rangeRejectedActions += 1;
            serverPerf.serverHarvestRejected += 1;
            sendMessage(socket, {
                v: PROTOCOL_VERSION,
                type: 'player_action_result',
                result: {
                    actionType: 'harvest',
                    clientActionId: Math.floor(Number(message.action.clientActionId) || 0),
                    accepted: false,
                    reason: originValidation.reason
                }
            });
            return;
        }
    }
    if (message.action?.type === 'revive') {
        const originValidation = validateOriginBoundAction(
            message.action,
            actor,
            SERVER_REVIVE_ORIGIN_MAX_DISTANCE,
            'revive_origin_too_far'
        );
        if (!originValidation.ok) {
            serverPerf.rejectedPlayerActions += 1;
            serverPerf.rangeRejectedActions += 1;
            sendMessage(socket, {
                v: PROTOCOL_VERSION,
                type: 'player_action_result',
                result: {
                    actionType: 'revive',
                    clientActionId: Math.floor(Number(message.action.clientActionId) || 0),
                    accepted: false,
                    reason: originValidation.reason
                }
            });
            return;
        }
    }
    if (message.action?.type === 'harvest') {
        buildings.ensureBuildingState(nonPlayerState.buildingsState);
        if (!nonPlayerState.sharedResources) {
            nonPlayerState.sharedResources = createResourceState();
        }
        const outcome = buildings.applyHarvest(message.action, actor);
        if (!outcome.ok) {
            serverPerf.serverHarvestRejected += 1;
        }
        sendMessage(socket, {
            v: PROTOCOL_VERSION,
            type: 'player_action_result',
            result: {
                actionType: 'harvest',
                clientActionId: Math.floor(Number(message.action.clientActionId) || 0),
                accepted: outcome.ok,
                reason: outcome.reason
            }
        });
        return;
    }
    if (message.action?.type === 'build') {
        buildings.ensureBuildingState(nonPlayerState.buildingsState);
        const actionId = Math.floor(Number(message.action?.clientActionId) || 0);
        const reservationKey = `${actor.playerId}:${actionId}`;
        const cost = normalizeBuildCost(message.action.buildingType, BUILDING_RULES);
        const rule = BUILDING_RULES[message.action.buildingType] ?? { footprint: { w: 1, h: 1 } };
        const tileX = Math.floor(Number(message.action.tileX));
        const tileY = Math.floor(Number(message.action.tileY));
        const w = Math.max(1, Math.floor(Number(rule.footprint?.w) || 1));
        const h = Math.max(1, Math.floor(Number(rule.footprint?.h) || 1));
        const reservedTiles = [];
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                const key = buildings.keyFromTile(tileX + dx, tileY + dy);
                buildings.getPendingTileReservations().set(key, { reservationKey, createdAt: Date.now() });
                reservedTiles.push(key);
            }
        }
        if (actionId > 0 && cost) {
            buildings.applyResourceDelta(cost, -1);
            buildings.getPendingBuildReservations().set(reservationKey, {
                createdAt: Date.now(),
                cost,
                reservedTiles
            });
            serverPerf.reservedBuildActions += 1;
        }
        const authoritativeResult = buildings.applyBuild(message.action);
        if (!authoritativeResult.ok) {
            buildings.releaseBuildReservation(actor.playerId, actionId, false);
            serverPerf.rejectedPlayerActions += 1;
            sendMessage(socket, {
                v: PROTOCOL_VERSION,
                type: 'player_action_result',
                result: {
                    actionType: 'build',
                    clientActionId: actionId,
                    accepted: false,
                    reason: authoritativeResult.reason
                }
            });
            return;
        }
        buildings.releaseBuildReservation(actor.playerId, actionId, true);
        sendMessage(socket, {
            v: PROTOCOL_VERSION,
            type: 'player_action_result',
            result: {
                actionType: 'build',
                clientActionId: actionId,
                accepted: true,
                reason: ''
            }
        });
    }
    if (message.action?.type === 'remove') {
        buildings.ensureBuildingState(nonPlayerState.buildingsState);
        const actionId = Math.floor(Number(message.action?.clientActionId) || 0);
        const authoritativeResult = buildings.applyRemove(message.action);
        if (!authoritativeResult.ok) {
            serverPerf.rejectedPlayerActions += 1;
            sendMessage(socket, {
                v: PROTOCOL_VERSION,
                type: 'player_action_result',
                result: {
                    actionType: 'remove',
                    clientActionId: actionId,
                    accepted: false,
                    reason: authoritativeResult.reason
                }
            });
            return;
        }
        sendMessage(socket, {
            v: PROTOCOL_VERSION,
            type: 'player_action_result',
            result: {
                actionType: 'remove',
                clientActionId: actionId,
                accepted: true,
                reason: ''
            }
        });
    }
    if (actor.playerId === authorityPlayerId) {
        return;
    }
    const authoritySocket = getSocketByPlayerId(authorityPlayerId);
    if (!authoritySocket || authoritySocket.readyState !== authoritySocket.OPEN) {
        serverPerf.rejectedPlayerActions += 1;
        return;
    }
    serverPerf.forwardedPlayerActions += 1;
    if (message.action?.type === 'attack') {
        serverPerf.forwardedAttackActions += 1;
    }
    sendMessage(authoritySocket, {
        v: PROTOCOL_VERSION,
        type: 'peer_action',
        actorPlayerId: actor.playerId,
        action: forwardedAction
    });
}

function handlePlayerActionResult(socket, message) {
    const actor = clients.get(socket);
    if (!actor || actor.playerId !== authorityPlayerId) {
        return;
    }
    const targetPlayerId = Number(message.targetPlayerId);
    if (!Number.isFinite(targetPlayerId)) {
        return;
    }
    if (!isValidActionResultPayload(message.result)) {
        return;
    }
    if (message.result.actionType === 'build') {
        const actionId = Math.floor(Number(message.result.clientActionId) || 0);
        buildings.releaseBuildReservation(targetPlayerId, actionId, Boolean(message.result.accepted));
    }
    const targetSocket = getSocketByPlayerId(Math.floor(targetPlayerId));
    if (!targetSocket || targetSocket.readyState !== targetSocket.OPEN) {
        return;
    }
    sendMessage(targetSocket, {
        v: PROTOCOL_VERSION,
        type: 'player_action_result',
        result: {
            actionType: message.result.actionType,
            clientActionId: Math.floor(Number(message.result.clientActionId) || 0),
            accepted: Boolean(message.result.accepted),
            reason: typeof message.result.reason === 'string' ? message.result.reason : ''
        }
    });
}

wss.on('connection', (socket, request) => {
    const remoteAddress = normalizeRemoteAddress(request?.socket?.remoteAddress || socket._socket?.remoteAddress || '');
    const originHeader = request?.headers?.origin || '';
    if (PRIVATE_NETWORK_ONLY && !isPrivateIp(remoteAddress)) {
        closeWithError(socket, 'ip_rejected', 'Only private/LAN addresses are allowed');
        return;
    }
    if (!checkConnectionRateLimit(connectionRateByIp, remoteAddress || 'unknown', MAX_CONNECTIONS_PER_MINUTE_PER_IP)) {
        closeWithError(socket, 'rate_limited', 'Too many connections from this address');
        return;
    }
    if (!isOriginAllowed(originHeader, ALLOWED_ORIGINS)) {
        closeWithError(socket, 'origin_rejected', 'Origin is not allowed');
        return;
    }
    const helloTimerId = setTimeout(() => {
        const sec = socketSecurityState.get(socket);
        if (sec && !sec.hasCompletedHello) {
            closeWithError(socket, 'hello_timeout', 'Handshake timed out');
        }
    }, HELLO_TIMEOUT_MS);
    socketSecurityState.set(socket, {
        hasCompletedHello: false,
        helloTimerId,
        rateWindowStartedAt: Date.now(),
        messageCountInWindow: 0,
        parseErrors: 0
    });

    socket.on('message', (buffer) => {
        const sec = socketSecurityState.get(socket);
        if (!sec) {
            return;
        }
        const now = Date.now();
        if (now - sec.rateWindowStartedAt >= 1000) {
            sec.rateWindowStartedAt = now;
            sec.messageCountInWindow = 0;
        }
        sec.messageCountInWindow += 1;
        if (sec.messageCountInWindow > MAX_MESSAGES_PER_SECOND) {
            closeWithError(socket, 'msg_rate_limited', 'Too many messages per second');
            return;
        }
        serverPerf.inboundBytesWindow += Buffer.byteLength(buffer);
        let message = null;
        try {
            message = JSON.parse(buffer.toString());
        } catch {
            sec.parseErrors += 1;
            if (sec.parseErrors >= 3) {
                closeWithError(socket, 'bad_json', 'Invalid message format');
            }
            return;
        }
        if (!message || typeof message.type !== 'string') {
            return;
        }
        const version = Number(message.v ?? PROTOCOL_VERSION);
        if (version !== PROTOCOL_VERSION) {
            closeWithError(socket, 'protocol_mismatch', 'Protocol version mismatch', {
                serverVersion: PROTOCOL_VERSION
            });
            return;
        }
        // --- EXTENSION: add new message types to the dispatch switch below ---
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
            return;
        }
        if (message.type === 'player_action_result') {
            handlePlayerActionResult(socket, message);
        }
    });

    socket.on('close', () => {
        const sec = socketSecurityState.get(socket);
        if (sec) {
            clearTimeout(sec.helloTimerId);
        }
        const disconnected = clients.get(socket);
        clients.delete(socket);
        if (disconnected?.playerId) {
            pauseVotesByPlayerId.delete(disconnected.playerId);
            restartVotesByPlayerId.delete(disconnected.playerId);
        }
        if (disconnected && disconnected.playerId === authorityPlayerId) {
            authorityPlayerId = null;
            for (const remaining of clients.values()) {
                authorityPlayerId = remaining.playerId;
                break;
            }
            combat.setLastSnapshotAt(authorityPlayerId === null ? 0 : Date.now());
            combat.reset();
        }
        recomputeServerPauseState();
        recomputeServerRestartVoteState();
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
