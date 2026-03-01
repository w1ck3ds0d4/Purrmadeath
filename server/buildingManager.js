// Building manager — placement validation, production ticks, harvest, and resource accounting.
// Encapsulates all building-related mutable state behind a factory.

'use strict';

const { applyResourceDelta: applyResourceDeltaUtil, createResourceState, normalizeBuildCost } = require('./actionUtils');

function keyFromTile(x, y) {
    return `${x},${y}`;
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

function getBuildingIndexAtTile(state, tileX, tileY, BUILDING_RULES) {
    if (!state || !Array.isArray(state.buildings)) {
        return -1;
    }
    for (let i = 0; i < state.buildings.length; i++) {
        const building = state.buildings[i];
        if (!building) {
            continue;
        }
        const rule = BUILDING_RULES[building.type] ?? { footprint: { w: 1, h: 1 } };
        const bx = Math.floor(Number(building.tileX) || 0);
        const by = Math.floor(Number(building.tileY) || 0);
        const bw = Math.max(1, Math.floor(Number(rule.footprint?.w) || 1));
        const bh = Math.max(1, Math.floor(Number(rule.footprint?.h) || 1));
        if (tileX >= bx && tileX < (bx + bw) && tileY >= by && tileY < (by + bh)) {
            return i;
        }
    }
    return -1;
}

function createBuildingManager({
    getNonPlayerState,
    serverPerf,
    BUILDING_RULES,
    SERVER_BUILD_MAX_DISTANCE,
    SERVER_TILE_SIZE
}) {
    let cachedBuildingRevision = -1;
    let cachedOccupiedTiles = new Set();
    const pendingBuildReservations = new Map();
    const pendingTileReservations = new Map();
    const authoritativeResourceDelta = createResourceState();

    function rebuildBuildingOccupancyCache() {
        const nps = getNonPlayerState();
        if (cachedBuildingRevision === nps.buildingsRevision) {
            return;
        }
        cachedBuildingRevision = nps.buildingsRevision;
        cachedOccupiedTiles = new Set();
        const list = Array.isArray(nps.buildingsState?.buildings) ? nps.buildingsState.buildings : [];
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

    function hasSufficientResources(buildingType) {
        const rule = BUILDING_RULES[buildingType];
        if (!rule) {
            return false;
        }
        const r = getNonPlayerState().sharedResources;
        if (!r || typeof r !== 'object') {
            return true;
        }
        return (Number(r.wood) || 0) >= (rule.cost.wood || 0)
            && (Number(r.stone) || 0) >= (rule.cost.stone || 0)
            && (Number(r.iron) || 0) >= (rule.cost.iron || 0)
            && (Number(r.gold) || 0) >= (rule.cost.gold || 0);
    }

    function validateBuildOrRemove(action, actorState) {
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
                const centerX = (tileX + w * 0.5) * SERVER_TILE_SIZE;
                const centerY = (tileY + h * 0.5) * SERVER_TILE_SIZE;
                const dx = centerX - actorX;
                const dy = centerY - actorY;
                if ((dx * dx + dy * dy) > SERVER_BUILD_MAX_DISTANCE * SERVER_BUILD_MAX_DISTANCE) {
                    return { ok: false, reason: 'build_out_of_range' };
                }
            }
            if (!hasSufficientResources(action.buildingType)) {
                return { ok: false, reason: 'insufficient_resources' };
            }
            return { ok: true, reason: '' };
        }
        if (action.type === 'remove') {
            const tileX = Math.floor(Number(action.tileX));
            const tileY = Math.floor(Number(action.tileY));
            if (Number.isFinite(actorX) && Number.isFinite(actorY)) {
                const centerX = (tileX + 0.5) * SERVER_TILE_SIZE;
                const centerY = (tileY + 0.5) * SERVER_TILE_SIZE;
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

    function ensureBuildingState(seedState = null) {
        const nps = getNonPlayerState();
        if (nps.buildingsState && Array.isArray(nps.buildingsState.buildings)) {
            return;
        }
        const cloned = cloneBuildingState(seedState);
        nps.buildingsState = cloned ?? { nextBuildingId: 1, buildings: [] };
        nps.buildingsRevision = Math.max(1, Number(nps.buildingsRevision) || 0);
        cachedBuildingRevision = -1;
        rebuildBuildingOccupancyCache();
    }

    function applyBuild(action) {
        const nps = getNonPlayerState();
        ensureBuildingState(nps.buildingsState);
        const state = nps.buildingsState;
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
        nps.buildingsRevision += 1;
        cachedBuildingRevision = -1;
        rebuildBuildingOccupancyCache();
        return { ok: true, reason: '' };
    }

    function updateProducerOutputs(dtFrames60) {
        const state = getNonPlayerState().buildingsState;
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
            getNonPlayerState().buildingsRevision += 1;
        }
        const elapsed = performance.now() - startedAt;
        serverPerf.producerSimUpdateMsAvg = serverPerf.producerSimUpdateMsAvg * 0.9 + elapsed * 0.1;
    }

    function applyRemove(action) {
        const nps = getNonPlayerState();
        if (!nps.buildingsState || !Array.isArray(nps.buildingsState.buildings)) {
            return { ok: false, reason: 'no_buildings_state' };
        }
        const targetTileX = Math.floor(Number(action.tileX));
        const targetTileY = Math.floor(Number(action.tileY));
        const list = nps.buildingsState.buildings;
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
                nps.buildingsRevision += 1;
                cachedBuildingRevision = -1;
                rebuildBuildingOccupancyCache();
                return { ok: true, reason: '' };
            }
        }
        return { ok: false, reason: 'no_building_at_tile' };
    }

    function applyResourceDeltaFn(cost, sign = -1) {
        if (!cost) {
            return;
        }
        applyResourceDeltaUtil(authoritativeResourceDelta, cost, sign);
        const nps = getNonPlayerState();
        if (nps.sharedResources) {
            applyResourceDeltaUtil(nps.sharedResources, cost, sign);
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
        const nps = getNonPlayerState();
        if (nps.sharedResources) {
            nps.sharedResources[resourceType] = Math.max(
                0,
                Math.floor(Number(nps.sharedResources[resourceType]) || 0) + value
            );
        }
    }

    function releaseBuildReservation(playerId, clientActionId, accepted) {
        const reservationKey = `${Math.floor(playerId)}:${Math.floor(clientActionId)}`;
        const reservation = pendingBuildReservations.get(reservationKey);
        if (!reservation) {
            return;
        }
        if (!accepted && reservation.cost) {
            applyResourceDeltaFn(reservation.cost, +1);
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

    function applyHarvest(action, actorState) {
        const nps = getNonPlayerState();
        const state = nps.buildingsState;
        if (!state || !Array.isArray(state.buildings) || !nps.sharedResources) {
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
            const centerX = (building.tileX + footprintW * 0.5) * SERVER_TILE_SIZE;
            const centerY = (building.tileY + footprintH * 0.5) * SERVER_TILE_SIZE;
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
        nps.buildingsRevision += 1;
        serverPerf.serverHarvestApplied += 1;
        return { ok: true, reason: '' };
    }

    function clearPendingReservations() {
        pendingBuildReservations.clear();
        pendingTileReservations.clear();
    }

    return {
        keyFromTile,
        clearPendingReservations,
        ensureBuildingState,
        validateBuildOrRemove,
        hasSufficientResources,
        applyBuild,
        applyRemove,
        applyHarvest,
        releaseBuildReservation,
        updateProducerOutputs,
        applyResourceDelta: applyResourceDeltaFn,
        applySingleResourceDelta,
        computeBuildingStateHash,
        getBuildingIndexAtTile: (state, tileX, tileY) => getBuildingIndexAtTile(state, tileX, tileY, BUILDING_RULES),
        getPendingBuildReservations: () => pendingBuildReservations,
        getPendingTileReservations: () => pendingTileReservations,
        getResourceDelta: () => authoritativeResourceDelta
    };
}

module.exports = { createBuildingManager };
