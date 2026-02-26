import * as PIXI from 'pixi.js';
import { TILE_SIZE } from '../config/constants.js';

export function createBuildingSystem({
    buildingLayer,
    getWorldPosition,
    getMouseScreenPosition,
    isTileWalkableBase,
    getPlayerCenter,
    getEnemies,
    inventory,
    buildingTypes,
    onLog
}) {
    // Runtime building state.
    const buildings = [];
    const occupiedTiles = new Set();
    const buildingTypeIds = Object.keys(buildingTypes);
    let nextBuildingId = 1;
    let buildMode = false;
    let selectedIndex = 0;
    let selectedBuildingType = buildingTypeIds[selectedIndex] ?? null;

    // Placement ghost rendered while build mode is active.
    const ghost = new PIXI.Graphics();
    ghost.visible = false;
    buildingLayer.addChild(ghost);

    function keyFromTile(tileX, tileY) {
        return `${tileX},${tileY}`;
    }

    function hasRequiredResources(cost) {
        return Object.entries(cost).every(([resource, amount]) => (inventory[resource] ?? 0) >= amount);
    }

    function payCost(cost) {
        for (const [resource, amount] of Object.entries(cost)) {
            if (amount > 0) {
                inventory[resource] -= amount;
            }
        }
    }

    function screenToTile(screenX, screenY) {
        const worldPos = getWorldPosition();
        const worldX = screenX - worldPos.x;
        const worldY = screenY - worldPos.y;
        return {
            tileX: Math.floor(worldX / TILE_SIZE),
            tileY: Math.floor(worldY / TILE_SIZE)
        };
    }

    function getPlacementTiles(baseTileX, baseTileY, footprint) {
        const tiles = [];
        for (let dy = 0; dy < footprint.h; dy++) {
            for (let dx = 0; dx < footprint.w; dx++) {
                tiles.push({ x: baseTileX + dx, y: baseTileY + dy });
            }
        }
        return tiles;
    }

    function collidesWithUnits(tiles) {
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

    function canPlaceBuilding(buildingTypeId, baseTileX, baseTileY) {
        const type = buildingTypes[buildingTypeId];
        if (!type) {
            return { ok: false, reason: 'Unknown building type' };
        }
        // Resource requirement check uses blueprint cost from `BUILDING_TYPES`.
        if (!hasRequiredResources(type.cost)) {
            return { ok: false, reason: 'Not enough resources' };
        }

        const tiles = getPlacementTiles(baseTileX, baseTileY, type.footprint);
        for (const tile of tiles) {
            const key = keyFromTile(tile.x, tile.y);
            if (occupiedTiles.has(key)) {
                return { ok: false, reason: 'Tile occupied' };
            }
            if (!isTileWalkableBase(tile.x, tile.y)) {
                return { ok: false, reason: 'Blocked terrain' };
            }
        }

        if (collidesWithUnits(tiles)) {
            return { ok: false, reason: 'Unit collision' };
        }

        return { ok: true, tiles };
    }

    function drawGhost(baseTileX, baseTileY, type, valid) {
        ghost.clear();
        ghost.rect(0, 0, type.footprint.w * TILE_SIZE, type.footprint.h * TILE_SIZE);
        // Green = valid placement, red = blocked.
        ghost.fill(valid ? 0x43d17c : 0xcc5f5f);
        ghost.alpha = 0.35;
        ghost.stroke({ width: 1, color: 0x101010 });
        ghost.position.set(baseTileX * TILE_SIZE, baseTileY * TILE_SIZE);
        ghost.visible = buildMode;
    }

    function createBuildingSprite(type) {
        const sprite = new PIXI.Graphics();
        sprite.rect(2, 2, type.footprint.w * TILE_SIZE - 4, type.footprint.h * TILE_SIZE - 4);
        sprite.fill(type.color);
        sprite.stroke({ width: 1, color: 0x1c1208 });
        return sprite;
    }

    function tryPlaceSelectedAtMouse() {
        if (!buildMode || !selectedBuildingType) {
            return false;
        }
        const mouse = getMouseScreenPosition();
        const { tileX, tileY } = screenToTile(mouse.x, mouse.y);
        const check = canPlaceBuilding(selectedBuildingType, tileX, tileY);
        if (!check.ok) {
            onLog?.(`Build blocked: ${check.reason}`);
            return false;
        }

        const type = buildingTypes[selectedBuildingType];
        payCost(type.cost);
        for (const tile of check.tiles) {
            occupiedTiles.add(keyFromTile(tile.x, tile.y));
        }

        const sprite = createBuildingSprite(type);
        sprite.position.set(tileX * TILE_SIZE, tileY * TILE_SIZE);
        buildingLayer.addChild(sprite);

        buildings.push({
            id: nextBuildingId++,
            type: selectedBuildingType,
            role: type.role ?? 'building',
            hp: type.maxHp ?? 0,
            maxHp: type.maxHp ?? 0,
            unbreakable: type.unbreakable ?? false,
            tileX,
            tileY,
            sprite,
            tiles: check.tiles
        });
        onLog?.(`${type.label} placed`);
        return true;
    }

    // Called from input layer (B key in index.js).
    function toggleBuildMode() {
        buildMode = !buildMode;
        ghost.visible = buildMode;
        return buildMode;
    }

    function cycleSelectedBuilding(direction) {
        if (buildingTypeIds.length === 0) {
            return false;
        }
        selectedIndex = (selectedIndex + direction + buildingTypeIds.length) % buildingTypeIds.length;
        selectedBuildingType = buildingTypeIds[selectedIndex];
        return true;
    }

    function updatePlacementGhost() {
        if (!buildMode || !selectedBuildingType) {
            ghost.visible = false;
            return;
        }

        const type = buildingTypes[selectedBuildingType];
        const mouse = getMouseScreenPosition();
        const { tileX, tileY } = screenToTile(mouse.x, mouse.y);
        const valid = canPlaceBuilding(selectedBuildingType, tileX, tileY).ok;
        drawGhost(tileX, tileY, type, valid);
    }

    function isTileBlocked(tileX, tileY) {
        return occupiedTiles.has(keyFromTile(tileX, tileY));
    }

    function getUiState() {
        return {
            buildMode,
            selectedBuildingType,
            selectedLabel: selectedBuildingType ? buildingTypes[selectedBuildingType]?.label ?? 'None' : 'None'
        };
    }

    function getMenuEntries() {
        return buildingTypeIds.map((id, index) => ({
            id,
            label: buildingTypes[id].label,
            cost: buildingTypes[id].cost,
            selected: index === selectedIndex
        }));
    }

    function getWalls() {
        return buildings.filter((building) => building.role === 'wall');
    }

    return {
        toggleBuildMode,
        cycleSelectedBuilding,
        updatePlacementGhost,
        tryPlaceSelectedAtMouse,
        isTileBlocked,
        getUiState,
        getMenuEntries,
        getWalls,
        getStats: () => ({ buildingCount: buildings.length })
    };
}
