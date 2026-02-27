export function computeBuildingStateHash(state) {
    if (!state || !Array.isArray(state.buildings)) {
        return '0';
    }
    // Compact hash to avoid shipping full building snapshots when nothing changed.
    return JSON.stringify(state.buildings.map((building) => ([
        building.id,
        building.type,
        building.tileX,
        building.tileY,
        Math.round(Number(building.hp) || 0),
        Math.round(Number(building.storedOutput) || 0),
        Math.round(Number(building.cycleTimerFrames) || 0),
        Math.round(Number(building.towerCooldownRemainingFrames) || 0)
    ])));
}
