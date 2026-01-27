function isFiniteCoord(value, maxAbs = 10000000) {
    const n = Number(value);
    return Number.isFinite(n) && Math.abs(n) <= maxAbs;
}

function isValidActionPayload(action) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
        return false;
    }
    const clientActionId = Number(action.clientActionId);
    const hasActionId = Number.isFinite(clientActionId) && clientActionId >= 0;
    switch (action.type) {
    case 'attack':
        return isFiniteCoord(action.dirX)
            && isFiniteCoord(action.dirY)
            && isFiniteCoord(action.originX)
            && isFiniteCoord(action.originY)
            && (action.weapon === 'sword' || action.weapon === 'pistol');
    case 'build':
        return isFiniteCoord(action.tileX)
            && isFiniteCoord(action.tileY)
            && hasActionId
            && typeof action.buildingType === 'string'
            && action.buildingType.length > 0
            && action.buildingType.length <= 64;
    case 'remove':
        return isFiniteCoord(action.tileX) && isFiniteCoord(action.tileY) && hasActionId;
    case 'harvest':
    case 'revive':
        return isFiniteCoord(action.originX) && isFiniteCoord(action.originY);
    case 'toggle_pause':
    case 'restart_session':
    case 'force_reset_session':
    case 'dev_add_resources':
        return true;
    default:
        return false;
    }
}

function validateAttackAction(action, actorState, maxDistance, cooldownsByWeapon) {
    const originX = Number(action?.originX);
    const originY = Number(action?.originY);
    const dirX = Number(action?.dirX);
    const dirY = Number(action?.dirY);
    const weapon = action?.weapon === 'sword' ? 'sword' : (action?.weapon === 'pistol' ? 'pistol' : null);
    if (!weapon || !Number.isFinite(originX) || !Number.isFinite(originY) || !Number.isFinite(dirX) || !Number.isFinite(dirY)) {
        return { ok: false, reason: 'invalid_attack_payload' };
    }
    const dx = originX - Number(actorState?.x || 0);
    const dy = originY - Number(actorState?.y || 0);
    if ((dx * dx + dy * dy) > maxDistance * maxDistance) {
        return { ok: false, reason: 'attack_origin_too_far' };
    }
    const now = Date.now();
    const cooldownMs = cooldownsByWeapon[weapon] || 200;
    const lastAttackAt = Number(actorState?.lastAttackAtByWeapon?.[weapon]) || 0;
    if ((now - lastAttackAt) < cooldownMs) {
        return { ok: false, reason: 'attack_cooldown' };
    }
    actorState.lastAttackAtByWeapon[weapon] = now;
    return { ok: true, reason: '' };
}

function validateOriginBoundAction(action, actorState, maxDistance, outOfRangeReason) {
    const originX = Number(action?.originX);
    const originY = Number(action?.originY);
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
        return { ok: false, reason: 'invalid_origin' };
    }
    const dx = originX - Number(actorState?.x || 0);
    const dy = originY - Number(actorState?.y || 0);
    if ((dx * dx + dy * dy) > maxDistance * maxDistance) {
        return { ok: false, reason: outOfRangeReason };
    }
    return { ok: true, reason: '' };
}

function isValidActionResultPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return false;
    }
    const actionType = typeof payload.actionType === 'string' ? payload.actionType : '';
    if (!actionType) {
        return false;
    }
    if (typeof payload.clientActionId !== 'number' || !Number.isFinite(payload.clientActionId)) {
        return false;
    }
    return true;
}

function createResourceState(raw = null) {
    return {
        wood: Math.max(0, Math.floor(Number(raw?.wood) || 0)),
        stone: Math.max(0, Math.floor(Number(raw?.stone) || 0)),
        iron: Math.max(0, Math.floor(Number(raw?.iron) || 0)),
        gold: Math.max(0, Math.floor(Number(raw?.gold) || 0))
    };
}

function normalizeBuildCost(buildingType, buildingRules) {
    const rule = buildingRules[buildingType];
    if (!rule || !rule.cost) {
        return null;
    }
    return {
        wood: Math.max(0, Math.floor(Number(rule.cost.wood) || 0)),
        stone: Math.max(0, Math.floor(Number(rule.cost.stone) || 0)),
        iron: Math.max(0, Math.floor(Number(rule.cost.iron) || 0)),
        gold: Math.max(0, Math.floor(Number(rule.cost.gold) || 0))
    };
}

function applyResourceDelta(resourceState, cost, sign = -1) {
    if (!resourceState || !cost) {
        return;
    }
    const factor = sign < 0 ? -1 : 1;
    resourceState.wood = Math.max(0, resourceState.wood + factor * cost.wood);
    resourceState.stone = Math.max(0, resourceState.stone + factor * cost.stone);
    resourceState.iron = Math.max(0, resourceState.iron + factor * cost.iron);
    resourceState.gold = Math.max(0, resourceState.gold + factor * cost.gold);
}

module.exports = {
    applyResourceDelta,
    createResourceState,
    isValidActionPayload,
    isValidActionResultPayload,
    normalizeBuildCost,
    validateAttackAction,
    validateOriginBoundAction
};
