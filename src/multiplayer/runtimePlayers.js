export function ensureRuntimePlayer(runtimeMap, playerId, defaults) {
    const key = String(playerId);
    if (!runtimeMap.has(key)) {
        runtimeMap.set(key, {
            __entity: 'player',
            id: key,
            hp: defaults.maxHp,
            maxHp: defaults.maxHp,
            isDead: false,
            invulnFrames: 0,
            respawnTimer: 0,
            kills: 0,
            x: defaults.centerX,
            y: defaults.centerY
        });
    }
    return runtimeMap.get(key);
}

export function syncRuntimePlayersFromSnapshot(runtimeMap, snapshotPlayers, tileSize, defaultCenter, maxHp = 100) {
    const seen = new Set();
    for (const entry of snapshotPlayers) {
        const runtime = ensureRuntimePlayer(runtimeMap, entry.playerId, {
            maxHp,
            centerX: defaultCenter.x,
            centerY: defaultCenter.y
        });
        runtime.x = Number(entry.x) + tileSize / 2;
        runtime.y = Number(entry.y) + tileSize / 2;
        seen.add(String(entry.playerId));
    }
    for (const [id] of runtimeMap) {
        if (!seen.has(id)) {
            runtimeMap.delete(id);
        }
    }
}

export function getRuntimePlayerCenterById(snapshotPlayers, playerId, tileSize) {
    const entry = snapshotPlayers.find((playerEntry) => String(playerEntry.playerId) === String(playerId));
    if (!entry) {
        return null;
    }
    return {
        x: Number(entry.x) + tileSize / 2,
        y: Number(entry.y) + tileSize / 2
    };
}
