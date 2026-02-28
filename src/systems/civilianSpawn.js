import { TILE_SIZE } from '../config/constants.js';
import { getPerimeterTiles } from './civilianSpatialUtils.js';
import { CIVILIAN_UNSTUCK_SEARCH_OFFSETS } from './civilianConfig.js';

// Spawn helpers are isolated so spawn tuning can evolve without touching runtime update logic.
export function isCivilianSpawnPositionClear(civilians, civilianRadius, separationPadding, centerX, centerY) {
    const minDistance = civilianRadius * 2 + separationPadding;
    const minDistanceSq = minDistance * minDistance;
    for (const civilian of civilians) {
        if (civilian.isDead) {
            continue;
        }
        const dx = (civilian.x + civilianRadius) - centerX;
        const dy = (civilian.y + civilianRadius) - centerY;
        if (dx * dx + dy * dy < minDistanceSq) {
            return false;
        }
    }
    return true;
}

export function findUnstuckPointForCivilian({
    originCenter,
    isTileWalkable,
    isSpawnClear
}) {
    const tileX = Math.floor(originCenter.x / TILE_SIZE);
    const tileY = Math.floor(originCenter.y / TILE_SIZE);
    for (const offset of CIVILIAN_UNSTUCK_SEARCH_OFFSETS) {
        const tx = tileX + offset.x;
        const ty = tileY + offset.y;
        if (!isTileWalkable(tx, ty)) {
            continue;
        }
        const centerX = tx * TILE_SIZE + TILE_SIZE * 0.5;
        const centerY = ty * TILE_SIZE + TILE_SIZE * 0.5;
        if (isSpawnClear(centerX, centerY)) {
            return { x: centerX, y: centerY };
        }
    }
    // Wider fallback to avoid teleports looping between the same nearby spots.
    for (let radius = 3; radius <= 5; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
                    continue;
                }
                const tx = tileX + dx;
                const ty = tileY + dy;
                if (!isTileWalkable(tx, ty)) {
                    continue;
                }
                const centerX = tx * TILE_SIZE + TILE_SIZE * 0.5;
                const centerY = ty * TILE_SIZE + TILE_SIZE * 0.5;
                if (isSpawnClear(centerX, centerY)) {
                    return { x: centerX, y: centerY };
                }
            }
        }
    }
    return {
        x: tileX * TILE_SIZE + TILE_SIZE * 0.5,
        y: tileY * TILE_SIZE + TILE_SIZE * 0.5
    };
}

export function findHouseSpawnPoint({
    house,
    isTileWalkable,
    spawnFrontOffsetTiles,
    isSpawnClear,
    getBuildingCenter
}) {
    const frontTileY = house.tileY + house.footprintH + spawnFrontOffsetTiles;
    const frontMidTileX = house.tileX + Math.floor(house.footprintW / 2);
    const candidates = [];

    candidates.push({ x: frontMidTileX, y: frontTileY });
    for (let dx = 0; dx < house.footprintW; dx++) {
        candidates.push({ x: house.tileX + dx, y: frontTileY });
    }
    for (let dx = -1; dx <= house.footprintW; dx++) {
        candidates.push({ x: house.tileX + dx, y: frontTileY - 1 });
        candidates.push({ x: house.tileX + dx, y: frontTileY + 1 });
    }

    // Perimeter fallback if front is blocked (prefer wider padding first).
    candidates.push(...getPerimeterTiles(house, isTileWalkable, 3));
    candidates.push(...getPerimeterTiles(house, isTileWalkable, 2));
    candidates.push(...getPerimeterTiles(house, isTileWalkable, 1));

    let firstWalkableCenter = null;
    for (const tile of candidates) {
        if (!isTileWalkable(tile.x, tile.y)) {
            continue;
        }
        const center = {
            x: tile.x * TILE_SIZE + TILE_SIZE * 0.5,
            y: tile.y * TILE_SIZE + TILE_SIZE * 0.5
        };
        if (!firstWalkableCenter) {
            firstWalkableCenter = center;
        }
        if (isSpawnClear(center.x, center.y)) {
            return center;
        }
    }

    if (firstWalkableCenter) {
        return firstWalkableCenter;
    }
    return findUnstuckPointForCivilian({
        originCenter: getBuildingCenter(house),
        isTileWalkable,
        isSpawnClear
    });
}

