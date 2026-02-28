function filterNonPlayerStateForViewer(nonPlayerState, viewer, relevanceRadius) {
    const radiusSq = relevanceRadius * relevanceRadius;
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
        civilians: nonPlayerState.civilians,
        houseTimers: nonPlayerState.houseTimers,
        sessionTimeSeconds: Number(nonPlayerState.sessionTimeSeconds) || 0,
        sessionState: nonPlayerState.sessionState,
        sharedResources: nonPlayerState.sharedResources,
        aiDirectives: nonPlayerState.aiDirectives,
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
        if (!p || !n || p.id !== n.id || p.x !== n.x || p.y !== n.y) {
            set.push({ i, id: n.id, x: n.x, y: n.y });
        }
    }
    for (let i = sharedLength; i < next.length; i++) {
        const n = next[i];
        set.push({ i, id: n.id, x: n.x, y: n.y });
    }
    return {
        set,
        removeFrom: next.length
    };
}

function buildDeltaNonPlayerPayload(socket, fullPayload, perSocketNonPlayerCache) {
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
        civilians: fullPayload.civilians,
        houseTimers: fullPayload.houseTimers,
        sessionTimeSeconds: fullPayload.sessionTimeSeconds,
        sessionState: fullPayload.sessionState,
        sharedResources: fullPayload.sharedResources,
        aiDirectives: fullPayload.aiDirectives,
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

module.exports = {
    buildDeltaNonPlayerPayload,
    filterNonPlayerStateForViewer
};
