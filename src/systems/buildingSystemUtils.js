import { TILE_SIZE } from '../config/constants.js';

export function keyFromTile(tileX, tileY) {
    return `${tileX},${tileY}`;
}

export function hasRequiredResources(inventory, cost) {
    return Object.entries(cost).every(([resource, amount]) => (inventory[resource] ?? 0) >= amount);
}

export function payCost(inventory, cost) {
    for (const [resource, amount] of Object.entries(cost)) {
        if (amount > 0) {
            inventory[resource] -= amount;
        }
    }
}

export function screenToTile(screenX, screenY, worldPos) {
    const worldX = screenX - worldPos.x;
    const worldY = screenY - worldPos.y;
    return {
        tileX: Math.floor(worldX / TILE_SIZE),
        tileY: Math.floor(worldY / TILE_SIZE)
    };
}

export function getPlacementTiles(baseTileX, baseTileY, footprint) {
    const tiles = [];
    for (let dy = 0; dy < footprint.h; dy++) {
        for (let dx = 0; dx < footprint.w; dx++) {
            tiles.push({ x: baseTileX + dx, y: baseTileY + dy });
        }
    }
    return tiles;
}

export function collidesWithUnits(tiles, getPlayerCenter, getEnemies) {
    const tileSet = new Set(tiles.map((t) => keyFromTile(t.x, t.y)));
    const player = getPlayerCenter();
    const playerTileX = Math.floor(player.x / TILE_SIZE);
    const playerTileY = Math.floor(player.y / TILE_SIZE);
    if (tileSet.has(keyFromTile(playerTileX, playerTileY))) {
        return true;
    }

    for (const enemy of getEnemies()) {
        const enemyTileX = Math.floor((enemy.x + TILE_SIZE / 2) / TILE_SIZE);
        const enemyTileY = Math.floor((enemy.y + TILE_SIZE / 2) / TILE_SIZE);
        if (tileSet.has(keyFromTile(enemyTileX, enemyTileY))) {
            return true;
        }
    }
    return false;
}
