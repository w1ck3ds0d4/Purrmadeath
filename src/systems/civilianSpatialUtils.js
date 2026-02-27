import { TILE_SIZE } from '../config/constants.js';

// Spatial helper functions extracted from civilianSystem to keep hot update
// code readable while preserving the same runtime behavior.
export function getTargetGridCellKey(worldX, worldY, gridSize) {
    const cellX = Math.floor(worldX / gridSize);
    const cellY = Math.floor(worldY / gridSize);
    return `${cellX},${cellY}`;
}

export function pushToTargetGrid(grid, worldX, worldY, payload, gridSize) {
    const key = getTargetGridCellKey(worldX, worldY, gridSize);
    if (!grid.has(key)) {
        grid.set(key, []);
    }
    grid.get(key).push(payload);
}

export function getBuildingCenter(building) {
    return {
        x: (building.tileX + building.footprintW * 0.5) * TILE_SIZE,
        y: (building.tileY + building.footprintH * 0.5) * TILE_SIZE
    };
}

export function queryNearbyGridEntries(grid, worldX, worldY, gridSize) {
    const centerCellX = Math.floor(worldX / gridSize);
    const centerCellY = Math.floor(worldY / gridSize);
    const matches = [];
    for (let radius = 0; radius <= 2; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const isEdge = Math.abs(dx) === radius || Math.abs(dy) === radius;
                if (!isEdge) {
                    continue;
                }
                const key = `${centerCellX + dx},${centerCellY + dy}`;
                const bucket = grid.get(key);
                if (!bucket) {
                    continue;
                }
                matches.push(...bucket);
            }
        }
        if (matches.length > 0) {
            break;
        }
    }
    return matches;
}

export function getPerimeterTiles(building, isTileWalkable, padding = 1) {
    const tiles = [];
    const minX = building.tileX - padding;
    const maxX = building.tileX + building.footprintW - 1 + padding;
    const minY = building.tileY - padding;
    const maxY = building.tileY + building.footprintH - 1 + padding;

    for (let x = minX; x <= maxX; x++) {
        tiles.push({ x, y: minY });
        tiles.push({ x, y: maxY });
    }
    for (let y = minY + 1; y <= maxY - 1; y++) {
        tiles.push({ x: minX, y });
        tiles.push({ x: maxX, y });
    }
    return tiles.filter((tile) => isTileWalkable(tile.x, tile.y));
}

export function findBestApproachPoint(building, fromX, fromY, laneSeed, isTileWalkable) {
    const candidates = getPerimeterTiles(building, isTileWalkable, 1);
    if (candidates.length === 0) {
        const fallback = getPerimeterTiles(building, isTileWalkable, 2);
        if (fallback.length === 0) {
            return getBuildingCenter(building);
        }
        candidates.push(...fallback);
    }

    const ranked = [];
    for (const tile of candidates) {
        const cx = tile.x * TILE_SIZE + TILE_SIZE * 0.5;
        const cy = tile.y * TILE_SIZE + TILE_SIZE * 0.5;
        const dx = cx - fromX;
        const dy = cy - fromY;
        const distSq = dx * dx + dy * dy;
        ranked.push({ tile, distSq });
    }
    ranked.sort((a, b) => a.distSq - b.distSq);
    const laneWindow = Math.min(4, ranked.length);
    const chosen = ranked[Math.abs(laneSeed) % laneWindow]?.tile ?? ranked[0].tile;
    return {
        x: chosen.x * TILE_SIZE + TILE_SIZE * 0.5,
        y: chosen.y * TILE_SIZE + TILE_SIZE * 0.5
    };
}
