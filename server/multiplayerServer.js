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
    sanitizeHouseTimers,
    sanitizeSessionState
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

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const TICK_RATE = Number(process.env.TICK_RATE || 30);
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
const MAX_MESSAGE_BYTES = Number(process.env.MAX_MESSAGE_BYTES || 131072);
const MAX_MESSAGES_PER_SECOND = Number(process.env.MAX_MESSAGES_PER_SECOND || 150);
const MAX_CONNECTIONS_PER_MINUTE_PER_IP = Number(process.env.MAX_CONNECTIONS_PER_MINUTE_PER_IP || 30);
const MAX_PLAYER_ACTIONS_PER_SECOND = Number(process.env.MAX_PLAYER_ACTIONS_PER_SECOND || 45);
// Server-authoritative action distance validation (anti-teleport/remote-action abuse).
const SERVER_ATTACK_ORIGIN_MAX_DISTANCE = Number(process.env.SERVER_ATTACK_ORIGIN_MAX_DISTANCE || 120);
const SERVER_HARVEST_ORIGIN_MAX_DISTANCE = Number(process.env.SERVER_HARVEST_ORIGIN_MAX_DISTANCE || 140);
const SERVER_REVIVE_ORIGIN_MAX_DISTANCE = Number(process.env.SERVER_REVIVE_ORIGIN_MAX_DISTANCE || 120);
const SERVER_BUILD_MAX_DISTANCE = Number(process.env.SERVER_BUILD_MAX_DISTANCE || 260);
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
    sessionState: null,
    sharedResources: null,
    buildingsState: null,
    buildingsRevision: 0
};
const perSocketNonPlayerCache = new WeakMap();
const connectionRateByIp = new Map();
const socketSecurityState = new WeakMap();
const pendingBuildReservations = new Map();
const pendingTileReservations = new Map();
const authoritativeResourceDelta = createResourceState();
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
    forwardedAttackActions: 0,
    rangeRejectedActions: 0,
    privilegedRejectedActions: 0
};
let lastTickStartedAt = Date.now();
let lastNetWindowAt = Date.now();
let cachedBuildingRevision = -1;
let cachedOccupiedTiles = new Set();

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

function keyFromTile(x, y) {
    return `${x},${y}`;
}

function rebuildBuildingOccupancyCache() {
    if (cachedBuildingRevision === nonPlayerState.buildingsRevision) {
        return;
    }
    cachedBuildingRevision = nonPlayerState.buildingsRevision;
    cachedOccupiedTiles = new Set();
    const list = Array.isArray(nonPlayerState.buildingsState?.buildings) ? nonPlayerState.buildingsState.buildings : [];
    for (const building of list) {
        if (!building || typeof building.type !== 'string') {
            continue;
        }
        const tileX = Math.floor(Number(building.tileX));
        const tileY = Math.floor(Number(building.tileY));
        if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
            continue;
        }
        const rule = BUILDING_RULES[building.type] ?? { footprint: { w: 1, h: 1 } };
        const w = Math.max(1, Math.floor(Number(rule.footprint?.w) || 1));
        const h = Math.max(1, Math.floor(Number(rule.footprint?.h) || 1));
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                cachedOccupiedTiles.add(keyFromTile(tileX + dx, tileY + dy));
            }
        }
    }
}

function hasSufficientResourcesForBuild(buildingType) {
    const rule = BUILDING_RULES[buildingType];
    if (!rule) {
        return false;
    }
    const r = nonPlayerState.sharedResources;
    if (!r || typeof r !== 'object') {
        return true;
    }
    return (Number(r.wood) || 0) >= (rule.cost.wood || 0)
        && (Number(r.stone) || 0) >= (rule.cost.stone || 0)
        && (Number(r.iron) || 0) >= (rule.cost.iron || 0)
        && (Number(r.gold) || 0) >= (rule.cost.gold || 0);
}

function validateBuildOrRemoveAction(action, actorState) {
    rebuildBuildingOccupancyCache();
    const actorX = Number(actorState?.x);
    const actorY = Number(actorState?.y);
    if (action.type === 'build') {
        const rule = BUILDING_RULES[action.buildingType];
        if (!rule) {
            return { ok: false, reason: 'unknown_building_type' };
        }
        const tileX = Math.floor(Number(action.tileX));
        const tileY = Math.floor(Number(action.tileY));
        const w = Math.max(1, Math.floor(Number(rule.footprint?.w) || 1));
        const h = Math.max(1, Math.floor(Number(rule.footprint?.h) || 1));
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                const tileKey = keyFromTile(tileX + dx, tileY + dy);
                if (cachedOccupiedTiles.has(tileKey)) {
                    return { ok: false, reason: 'tile_occupied' };
                }
                if (pendingTileReservations.has(tileKey)) {
                    return { ok: false, reason: 'tile_reserved' };
                }
            }
        }
        if (Number.isFinite(actorX) && Number.isFinite(actorY)) {
            const centerX = (tileX + w * 0.5) * 32;
            const centerY = (tileY + h * 0.5) * 32;
            const dx = centerX - actorX;
            const dy = centerY - actorY;
            if ((dx * dx + dy * dy) > SERVER_BUILD_MAX_DISTANCE * SERVER_BUILD_MAX_DISTANCE) {
                return { ok: false, reason: 'build_out_of_range' };
            }
        }
        if (!hasSufficientResourcesForBuild(action.buildingType)) {
            return { ok: false, reason: 'insufficient_resources' };
        }
        return { ok: true, reason: '' };
    }
    if (action.type === 'remove') {
        const tileX = Math.floor(Number(action.tileX));
        const tileY = Math.floor(Number(action.tileY));
        if (Number.isFinite(actorX) && Number.isFinite(actorY)) {
            const centerX = (tileX + 0.5) * 32;
            const centerY = (tileY + 0.5) * 32;
            const dx = centerX - actorX;
            const dy = centerY - actorY;
            if ((dx * dx + dy * dy) > SERVER_BUILD_MAX_DISTANCE * SERVER_BUILD_MAX_DISTANCE) {
                return { ok: false, reason: 'remove_out_of_range' };
            }
        }
        if (!cachedOccupiedTiles.has(keyFromTile(tileX, tileY))) {
            return { ok: false, reason: 'no_building_at_tile' };
        }
    }
    return { ok: true, reason: '' };
}

function cloneBuildingState(state) {
    if (!state || !Array.isArray(state.buildings)) {
        return null;
    }
    return {
        nextBuildingId: Math.max(1, Math.floor(Number(state.nextBuildingId) || 1)),
        buildings: state.buildings
            .filter((entry) => entry && typeof entry.type === 'string')
            .map((entry) => ({
                id: Math.floor(Number(entry.id) || 0),
                type: entry.type,
                tileX: Math.floor(Number(entry.tileX) || 0),
                tileY: Math.floor(Number(entry.tileY) || 0),
                hp: Number(entry.hp) || 1,
                maxHp: Number(entry.maxHp) || 1,
                unbreakable: Boolean(entry.unbreakable),
                storedOutput: Math.max(0, Math.floor(Number(entry.storedOutput) || 0)),
                cycleTimerFrames: Math.max(0, Number(entry.cycleTimerFrames) || 0),
                towerCooldownRemainingFrames: Math.max(0, Number(entry.towerCooldownRemainingFrames) || 0)
            }))
    };
}

function computeBuildingStateHash(state) {
    if (!state || !Array.isArray(state.buildings)) {
        return '0';
    }
    return JSON.stringify(state.buildings.map((building) => ([
        Math.floor(Number(building.id) || 0),
        String(building.type || ''),
        Math.floor(Number(building.tileX) || 0),
        Math.floor(Number(building.tileY) || 0),
        Math.round(Number(building.hp) || 0),
        Math.round(Number(building.storedOutput) || 0),
        Math.round(Number(building.cycleTimerFrames) || 0),
        Math.round(Number(building.towerCooldownRemainingFrames) || 0)
    ])));
}

function ensureAuthoritativeBuildingState(seedState = null) {
    if (nonPlayerState.buildingsState && Array.isArray(nonPlayerState.buildingsState.buildings)) {
        return;
    }
    const cloned = cloneBuildingState(seedState);
    nonPlayerState.buildingsState = cloned ?? { nextBuildingId: 1, buildings: [] };
    nonPlayerState.buildingsRevision = Math.max(1, Number(nonPlayerState.buildingsRevision) || 0);
    cachedBuildingRevision = -1;
    rebuildBuildingOccupancyCache();
}

function applyAuthoritativeBuildAction(action) {
    ensureAuthoritativeBuildingState(nonPlayerState.buildingsState);
    const state = nonPlayerState.buildingsState;
    const rule = BUILDING_RULES[action.buildingType];
    if (!rule) {
        return { ok: false, reason: 'unknown_building_type' };
    }
    const tileX = Math.floor(Number(action.tileX));
    const tileY = Math.floor(Number(action.tileY));
    const entry = {
        id: Math.max(1, state.nextBuildingId++),
        type: action.buildingType,
        tileX,
        tileY,
        hp: rule.maxHp,
        maxHp: rule.maxHp,
        unbreakable: Boolean(rule.unbreakable),
        storedOutput: 0,
        cycleTimerFrames: Number(rule.producer?.cycleFrames) || 0,
        towerCooldownRemainingFrames: 0
    };
    state.buildings.push(entry);
    nonPlayerState.buildingsRevision += 1;
    cachedBuildingRevision = -1;
    rebuildBuildingOccupancyCache();
    return { ok: true, reason: '' };
}

function updateAuthoritativeProducerOutputs(dtFrames60) {
    const state = nonPlayerState.buildingsState;
    if (!state || !Array.isArray(state.buildings) || state.buildings.length === 0) {
        return;
    }
    const startedAt = performance.now();
    let changed = false;
    for (const building of state.buildings) {
        const rule = BUILDING_RULES[building.type];
        const producer = rule?.producer;
        if (!producer) {
            continue;
        }
        const cycleFrames = Math.max(1, Number(producer.cycleFrames) || 1);
        const outputPerCycle = Math.max(1, Math.floor(Number(producer.outputPerCycle) || 1));
        const storageCap = Math.max(outputPerCycle, Math.floor(Number(producer.storageCap) || outputPerCycle));
        building.cycleTimerFrames = Number(building.cycleTimerFrames);
        if (!Number.isFinite(building.cycleTimerFrames) || building.cycleTimerFrames <= 0) {
            building.cycleTimerFrames = cycleFrames;
        }
        building.cycleTimerFrames -= dtFrames60;
        let safety = 0;
        while (building.cycleTimerFrames <= 0 && safety < 4) {
            const before = Math.max(0, Math.floor(Number(building.storedOutput) || 0));
            const next = Math.min(storageCap, before + outputPerCycle);
            if (next !== before) {
                building.storedOutput = next;
                changed = true;
            } else {
                building.storedOutput = before;
            }
            building.cycleTimerFrames += cycleFrames;
            safety += 1;
        }
    }
    if (changed) {
        nonPlayerState.buildingsRevision += 1;
    }
    const elapsed = performance.now() - startedAt;
    serverPerf.producerSimUpdateMsAvg = serverPerf.producerSimUpdateMsAvg * 0.9 + elapsed * 0.1;
}

function applyAuthoritativeRemoveAction(action) {
    if (!nonPlayerState.buildingsState || !Array.isArray(nonPlayerState.buildingsState.buildings)) {
        return { ok: false, reason: 'no_buildings_state' };
    }
    const targetTileX = Math.floor(Number(action.tileX));
    const targetTileY = Math.floor(Number(action.tileY));
    const list = nonPlayerState.buildingsState.buildings;
    for (let i = 0; i < list.length; i++) {
        const building = list[i];
        const rule = BUILDING_RULES[building.type] ?? { footprint: { w: 1, h: 1 } };
        const w = Math.max(1, Math.floor(Number(rule.footprint?.w) || 1));
        const h = Math.max(1, Math.floor(Number(rule.footprint?.h) || 1));
        if (
            targetTileX >= building.tileX &&
            targetTileX < building.tileX + w &&
            targetTileY >= building.tileY &&
            targetTileY < building.tileY + h
        ) {
            list.splice(i, 1);
            nonPlayerState.buildingsRevision += 1;
            cachedBuildingRevision = -1;
            rebuildBuildingOccupancyCache();
            return { ok: true, reason: '' };
        }
    }
    return { ok: false, reason: 'no_building_at_tile' };
}

function releaseBuildReservation(playerId, clientActionId, accepted) {
    const reservationKey = `${Math.floor(playerId)}:${Math.floor(clientActionId)}`;
    const reservation = pendingBuildReservations.get(reservationKey);
    if (!reservation) {
        return;
    }
    if (!accepted && reservation.cost) {
        applyResourceDeltaToAuthority(reservation.cost, +1);
        serverPerf.refundedBuildReservations += 1;
    }
    for (const tileKey of reservation.reservedTiles ?? []) {
        const tileReservation = pendingTileReservations.get(tileKey);
        if (tileReservation && tileReservation.reservationKey === reservationKey) {
            pendingTileReservations.delete(tileKey);
        }
    }
    pendingBuildReservations.delete(reservationKey);
}

function applyAuthoritativeHarvestAction(action, actorState) {
    const state = nonPlayerState.buildingsState;
    if (!state || !Array.isArray(state.buildings) || !nonPlayerState.sharedResources) {
        return { ok: false, reason: 'no_authority_state' };
    }
    const actorX = Number.isFinite(Number(action?.originX))
        ? Number(action.originX)
        : Number(actorState?.x);
    const actorY = Number.isFinite(Number(action?.originY))
        ? Number(action.originY)
        : Number(actorState?.y);
    if (!Number.isFinite(actorX) || !Number.isFinite(actorY)) {
        return { ok: false, reason: 'invalid_origin' };
    }
    const harvestRange = 96;
    const harvestRangeSq = harvestRange * harvestRange;
    let best = null;
    let bestDistSq = Infinity;
    for (const building of state.buildings) {
        const rule = BUILDING_RULES[building.type];
        if (!rule?.producer || !rule.outputResource) {
            continue;
        }
        const stored = Math.max(0, Math.floor(Number(building.storedOutput) || 0));
        if (stored <= 0) {
            continue;
        }
        const footprintW = Math.max(1, Math.floor(Number(rule.footprint?.w) || 1));
        const footprintH = Math.max(1, Math.floor(Number(rule.footprint?.h) || 1));
        const centerX = (building.tileX + footprintW * 0.5) * 32;
        const centerY = (building.tileY + footprintH * 0.5) * 32;
        const dx = centerX - actorX;
        const dy = centerY - actorY;
        const distSq = dx * dx + dy * dy;
        if (distSq > harvestRangeSq || distSq >= bestDistSq) {
            continue;
        }
        best = { building, rule };
        bestDistSq = distSq;
    }
    if (!best) {
        return { ok: false, reason: 'no_resource' };
    }
    best.building.storedOutput = Math.max(0, Math.floor(Number(best.building.storedOutput) || 0) - 1);
    const resourceType = best.rule.outputResource;
    applySingleResourceDelta(resourceType, 1);
    nonPlayerState.buildingsRevision += 1;
    serverPerf.serverHarvestApplied += 1;
    return { ok: true, reason: '' };
}

function applyResourceDeltaToAuthority(cost, sign = -1) {
    if (!cost) {
        return;
    }
    applyResourceDelta(authoritativeResourceDelta, cost, sign);
    if (nonPlayerState.sharedResources) {
        applyResourceDelta(nonPlayerState.sharedResources, cost, sign);
    }
}

function applySingleResourceDelta(resourceType, amount) {
    if (!resourceType || !Number.isFinite(Number(amount))) {
        return;
    }
    const value = Math.floor(Number(amount));
    if (!Number.isFinite(value) || value === 0) {
        return;
    }
    if (!Object.prototype.hasOwnProperty.call(authoritativeResourceDelta, resourceType)) {
        return;
    }
    authoritativeResourceDelta[resourceType] = Math.max(0, authoritativeResourceDelta[resourceType] + value);
    if (nonPlayerState.sharedResources) {
        nonPlayerState.sharedResources[resourceType] = Math.max(
            0,
            Math.floor(Number(nonPlayerState.sharedResources[resourceType]) || 0) + value
        );
    }
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
    serverPerf.activeBuildReservations = pendingBuildReservations.size;
    serverPerf.activeTileReservations = pendingTileReservations.size;
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
            forwardedAttackActions: serverPerf.forwardedAttackActions,
            rangeRejectedActions: serverPerf.rangeRejectedActions,
            privilegedRejectedActions: serverPerf.privilegedRejectedActions
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
    const loopLagMs = Math.max(0, tickStartedAt - lastTickStartedAt - TICK_MS);
    lastTickStartedAt = tickStartedAt;
    const simStartedAt = performance.now();
    tick += 1;
    const dt = TICK_MS / 1000;
    const dtFrames60 = dt * 60;
    const now = Date.now();
    serverSessionTimeSeconds += dt;
    nonPlayerState.sessionTimeSeconds = serverSessionTimeSeconds;
    updateAuthoritativeProducerOutputs(dtFrames60);
    for (const [reservationKey, reservation] of pendingBuildReservations) {
        if (now - reservation.createdAt <= 5000) {
            continue;
        }
        applyResourceDeltaToAuthority(reservation.cost, +1);
        pendingBuildReservations.delete(reservationKey);
        serverPerf.refundedBuildReservations += 1;
    }
    for (const [tileKey, reservation] of pendingTileReservations) {
        if (now - reservation.createdAt <= 5000) {
            continue;
        }
        pendingTileReservations.delete(tileKey);
    }

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
                const maxStep = PLAYER_SPEED * dt * 2.5 + 4;
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
    const seq = Number(message.seq);
    if (!Number.isFinite(seq) || seq <= nonPlayerState.seq) {
        return;
    }
    const payload = message.payload ?? {};
    if (payload.buildingsState && nonPlayerState.buildingsState) {
        const authorityHash = computeBuildingStateHash(payload.buildingsState);
        const serverHash = computeBuildingStateHash(nonPlayerState.buildingsState);
        serverPerf.lastAuthorityBuildingHash = authorityHash;
        serverPerf.lastServerBuildingHash = serverHash;
        if (authorityHash !== serverHash) {
            serverPerf.buildingStateMismatchCount += 1;
        }
    }
    if (!nonPlayerState.buildingsState && payload.buildingsState) {
        ensureAuthoritativeBuildingState(payload.buildingsState);
        nonPlayerState.buildingsRevision = Math.max(
            Number(nonPlayerState.buildingsRevision) || 0,
            Number(payload.buildingsRevision) || 0
        );
    }
    const payloadSharedResources = sanitizeSharedResources(payload.sharedResources) ?? nonPlayerState.sharedResources;
    const effectiveSharedResources = payloadSharedResources
        ? createResourceState(payloadSharedResources)
        : createResourceState();
    applyResourceDelta(effectiveSharedResources, authoritativeResourceDelta, +1);
    nonPlayerState.sharedResources = effectiveSharedResources;
    if (!nonPlayerState.sharedResources) {
        nonPlayerState.sharedResources = createResourceState();
    }
    nonPlayerState = {
        seq: Math.floor(seq),
        enemies: sanitizeEnemyEntries(payload.enemies, MAX_REPLICATED_ENEMIES, quantizePosition),
        projectiles: {
            player: sanitizeProjectileEntries(payload.projectiles?.player, MAX_REPLICATED_PROJECTILES, quantizePosition),
            tower: sanitizeProjectileEntries(payload.projectiles?.tower, MAX_REPLICATED_PROJECTILES, quantizePosition),
            enemy: sanitizeProjectileEntries(payload.projectiles?.enemy, MAX_REPLICATED_PROJECTILES, quantizePosition)
        },
        playerStates: sanitizePlayerStates(payload.playerStates, quantizePosition),
        civilians: sanitizeCivilianStates(payload.civilians, quantizePosition),
        houseTimers: sanitizeHouseTimers(payload.houseTimers),
        // Session runtime is authoritative on server tick, never on host payload.
        sessionTimeSeconds: serverSessionTimeSeconds,
        sessionState: sanitizeSessionState(payload.sessionState) ?? nonPlayerState.sessionState,
        sharedResources: effectiveSharedResources,
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
        const validation = validateBuildOrRemoveAction(message.action, actor);
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
        ensureAuthoritativeBuildingState(nonPlayerState.buildingsState);
        if (!nonPlayerState.sharedResources) {
            nonPlayerState.sharedResources = createResourceState();
        }
        const outcome = applyAuthoritativeHarvestAction(message.action, actor);
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
        ensureAuthoritativeBuildingState(nonPlayerState.buildingsState);
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
                const key = keyFromTile(tileX + dx, tileY + dy);
                pendingTileReservations.set(key, { reservationKey, createdAt: Date.now() });
                reservedTiles.push(key);
            }
        }
        if (actionId > 0 && cost) {
            applyResourceDeltaToAuthority(cost, -1);
            pendingBuildReservations.set(reservationKey, {
                createdAt: Date.now(),
                cost,
                reservedTiles
            });
            serverPerf.reservedBuildActions += 1;
        }
        const authoritativeResult = applyAuthoritativeBuildAction(message.action);
        if (!authoritativeResult.ok) {
            releaseBuildReservation(actor.playerId, actionId, false);
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
        releaseBuildReservation(actor.playerId, actionId, true);
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
        ensureAuthoritativeBuildingState(nonPlayerState.buildingsState);
        const actionId = Math.floor(Number(message.action?.clientActionId) || 0);
        const authoritativeResult = applyAuthoritativeRemoveAction(message.action);
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
        action: message.action ?? null
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
        releaseBuildReservation(targetPlayerId, actionId, Boolean(message.result.accepted));
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
