function sanitizeEnemyEntries(raw, maxReplicatedEnemies, quantizePosition) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const result = [];
    for (let i = 0; i < raw.length && result.length < maxReplicatedEnemies; i++) {
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

function sanitizeProjectileEntries(raw, maxReplicatedProjectiles, quantizePosition) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const result = [];
    for (let i = 0; i < raw.length && result.length < maxReplicatedProjectiles; i++) {
        const entry = raw[i];
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const x = Number(entry.x);
        const y = Number(entry.y);
        const id = Number(entry.id);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }
        result.push({
            id: Number.isFinite(id) ? Math.floor(id) : 0,
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

function sanitizePlayerStates(raw, quantizePosition) {
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
        const kills = Number(entry.kills);
        const x = Number(entry.x);
        const y = Number(entry.y);
        if (!Number.isFinite(playerId)) {
            continue;
        }
        result.push({
            playerId: Math.floor(playerId),
            x: Number.isFinite(x) ? quantizePosition(x) : null,
            y: Number.isFinite(y) ? quantizePosition(y) : null,
            hp: Math.max(0, Number.isFinite(hp) ? hp : 0),
            maxHp: Math.max(1, Number.isFinite(maxHp) ? maxHp : 1),
            isDead: Boolean(entry.isDead),
            respawnTimer: Math.max(0, Number.isFinite(respawnTimer) ? respawnTimer : 0),
            kills: Math.max(0, Math.floor(Number.isFinite(kills) ? kills : 0))
        });
    }
    return result;
}

function sanitizeCivilianStates(raw, quantizePosition) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const result = [];
    for (const entry of raw) {
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
            isDead: Boolean(entry.isDead)
        });
    }
    return result;
}

function sanitizeHouseTimers(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const result = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const houseId = Number(entry.houseId);
        const activeCivilianCount = Number(entry.activeCivilianCount);
        const spawnTimerFrames = Number(entry.spawnTimerFrames);
        if (!Number.isFinite(houseId)) {
            continue;
        }
        result.push({
            houseId: Math.floor(houseId),
            activeCivilianCount: Math.max(0, Math.floor(Number.isFinite(activeCivilianCount) ? activeCivilianCount : 0)),
            spawnTimerFrames: Math.max(0, Number.isFinite(spawnTimerFrames) ? spawnTimerFrames : 0)
        });
    }
    return result;
}

function sanitizeSessionState(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    return {
        paused: Boolean(raw.paused)
    };
}

module.exports = {
    sanitizeEnemyEntries,
    sanitizeProjectileEntries,
    sanitizeSharedResources,
    sanitizePlayerStates,
    sanitizeCivilianStates,
    sanitizeHouseTimers,
    sanitizeSessionState
};
