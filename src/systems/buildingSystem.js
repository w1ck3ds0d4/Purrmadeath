import * as PIXI from 'pixi.js';
import { TILE_SIZE } from '../config/constants.js';

export function createBuildingSystem({
    buildingLayer,
    getWorldPosition,
    getMouseScreenPosition,
    isTileWalkableBase,
    isTileWaterBase,
    getPlayerCenter,
    getEnemies,
    inventory,
    buildingTypes,
    onLog
}) {
    // Runtime building state.
    const buildings = [];
    const producers = [];
    const houses = [];
    const warehouses = [];
    const occupiedTiles = new Set();
    const movementBlockedTiles = new Set();
    const projectileBlockedTiles = new Set();
    const occupiedTileToBuildingId = new Map();
    const buildingById = new Map();
    const buildingTypeIds = Object.keys(buildingTypes);
    let nextBuildingId = 1;
    let buildMode = false;
    let selectedIndex = 0;
    let selectedBuildingType = buildingTypeIds[selectedIndex] ?? null;
    let selectedPlacedBuildingId = null;
    let producedUnitsWindow = 0;
    let producedFramesWindow = 0;
    let producedPerSecond = 0;

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
            const isWaterTile = isTileWaterBase(tile.x, tile.y);
            if (type.placeOnWater) {
                if (!isWaterTile) {
                    return { ok: false, reason: 'Must be placed on water' };
                }
            } else if (!isTileWalkableBase(tile.x, tile.y)) {
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
        const container = new PIXI.Container();
        const body = new PIXI.Graphics();
        body.rect(2, 2, type.footprint.w * TILE_SIZE - 4, type.footprint.h * TILE_SIZE - 4);
        body.fill(type.color);
        body.stroke({ width: 1, color: 0x1c1208 });
        container.addChild(body);

        // Producer buildings render local buffered output above the structure.
        let outputText = null;
        if (type.role === 'producer') {
            outputText = new PIXI.Text({
                text: '',
                style: {
                    fill: '#f7f7f7',
                    fontFamily: 'monospace',
                    fontSize: 11
                }
            });
            outputText.anchor.set(0.5);
            outputText.position.set((type.footprint.w * TILE_SIZE) / 2, -8);
            container.addChild(outputText);
        }

        return { container, outputText };
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

        const spriteData = createBuildingSprite(type);
        spriteData.container.position.set(tileX * TILE_SIZE, tileY * TILE_SIZE);
        buildingLayer.addChild(spriteData.container);

        const id = nextBuildingId++;
        const building = {
            id,
            type: selectedBuildingType,
            role: type.role ?? 'building',
            hp: type.maxHp ?? 0,
            maxHp: type.maxHp ?? 0,
            unbreakable: type.unbreakable ?? false,
            tileX,
            tileY,
            sprite: spriteData.container,
            outputText: spriteData.outputText,
            tiles: check.tiles,
            footprintW: type.footprint.w,
            footprintH: type.footprint.h,
            storedOutput: 0,
            outputResource: type.outputResource ?? null,
            outputPerCycle: type.outputPerCycle ?? 0,
            cycleFrames: type.cycleFrames ?? 0,
            cycleTimerFrames: type.cycleFrames ?? 0,
            storageCap: type.storageCap ?? 0
        };
        buildings.push(building);
        buildingById.set(id, building);
        if (building.role === 'producer') {
            producers.push(building);
        } else if (building.role === 'house') {
            houses.push(building);
        } else if (building.role === 'warehouse') {
            warehouses.push(building);
        }
        for (const tile of check.tiles) {
            const key = keyFromTile(tile.x, tile.y);
            occupiedTileToBuildingId.set(key, id);
            if (type.blocksMovement !== false) {
                movementBlockedTiles.add(key);
            }
            if (type.blocksProjectiles !== false) {
                projectileBlockedTiles.add(key);
            }
        }
        onLog?.(`${type.label} placed`);
        return true;
    }

    function removeFromRoleList(building) {
        const removeById = (list) => {
            const idx = list.findIndex((item) => item.id === building.id);
            if (idx >= 0) {
                list.splice(idx, 1);
            }
        };
        if (building.role === 'producer') {
            removeById(producers);
        } else if (building.role === 'house') {
            removeById(houses);
        } else if (building.role === 'warehouse') {
            removeById(warehouses);
        }
    }

    // Delete the currently selected placed building (select with LMB first).
    function removeSelectedPlacedBuilding() {
        if (!selectedPlacedBuildingId) {
            return false;
        }
        const building = buildingById.get(selectedPlacedBuildingId);
        if (!building) {
            selectedPlacedBuildingId = null;
            return false;
        }

        building.sprite.destroy();
        buildingById.delete(building.id);
        removeFromRoleList(building);
        const idx = buildings.findIndex((item) => item.id === building.id);
        if (idx >= 0) {
            buildings.splice(idx, 1);
        }
        for (const tile of building.tiles) {
            const key = keyFromTile(tile.x, tile.y);
            occupiedTiles.delete(key);
            occupiedTileToBuildingId.delete(key);
            movementBlockedTiles.delete(key);
            projectileBlockedTiles.delete(key);
        }
        onLog?.(`${buildingTypes[building.type]?.label ?? 'Building'} removed`);
        selectedPlacedBuildingId = null;
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

    function updateProduction(deltaFrames) {
        if (producers.length === 0) {
            return;
        }
        for (const producer of producers) {
            if (!producer.outputResource || producer.cycleFrames <= 0 || producer.storageCap <= 0) {
                continue;
            }
            if (producer.storedOutput >= producer.storageCap) {
                continue;
            }

            producer.cycleTimerFrames -= deltaFrames;
            while (producer.cycleTimerFrames <= 0 && producer.storedOutput < producer.storageCap) {
                producer.storedOutput += producer.outputPerCycle;
                producedUnitsWindow += producer.outputPerCycle;
                producer.cycleTimerFrames += producer.cycleFrames;
            }
            if (producer.outputText) {
                producer.outputText.text = `${producer.outputResource}: ${producer.storedOutput}/${producer.storageCap}`;
            }
        }

        producedFramesWindow += deltaFrames;
        if (producedFramesWindow >= 60) {
            producedPerSecond = producedUnitsWindow * (60 / producedFramesWindow);
            producedUnitsWindow = 0;
            producedFramesWindow = 0;
        }
    }

    function selectBuildingAtMouse() {
        const mouse = getMouseScreenPosition();
        const { tileX, tileY } = screenToTile(mouse.x, mouse.y);
        const buildingId = occupiedTileToBuildingId.get(keyFromTile(tileX, tileY)) ?? null;
        selectedPlacedBuildingId = buildingId;
        return buildingId !== null;
    }

    function collectNearestOutput(playerCenterX, playerCenterY, maxDistancePx) {
        const maxDistanceSq = maxDistancePx * maxDistancePx;
        let best = null;
        let bestDistSq = maxDistanceSq;

        for (const producer of producers) {
            if (producer.storedOutput <= 0 || !producer.outputResource) {
                continue;
            }
            const centerX = (producer.tileX + producer.footprintW * 0.5) * TILE_SIZE;
            const centerY = (producer.tileY + producer.footprintH * 0.5) * TILE_SIZE;
            const dx = centerX - playerCenterX;
            const dy = centerY - playerCenterY;
            const distSq = dx * dx + dy * dy;
            if (distSq <= bestDistSq) {
                bestDistSq = distSq;
                best = producer;
            }
        }

        if (!best) {
            return null;
        }

        const amount = best.storedOutput;
        best.storedOutput = 0;
        if (best.outputText) {
            best.outputText.text = `${best.outputResource}: 0/${best.storageCap}`;
        }
        return { resourceType: best.outputResource, amount };
    }

    function isTileBlocked(tileX, tileY) {
        return movementBlockedTiles.has(keyFromTile(tileX, tileY));
    }

    function hasBridgeAt(tileX, tileY) {
        const buildingId = occupiedTileToBuildingId.get(keyFromTile(tileX, tileY));
        if (!buildingId) {
            return false;
        }
        const building = buildingById.get(buildingId);
        return building?.role === 'bridge';
    }

    function isProjectileBlocked(tileX, tileY) {
        return projectileBlockedTiles.has(keyFromTile(tileX, tileY));
    }

    function getUiState() {
        const selectedPlaced = selectedPlacedBuildingId ? buildingById.get(selectedPlacedBuildingId) : null;
        return {
            buildMode,
            selectedBuildingType,
            selectedLabel: selectedBuildingType ? buildingTypes[selectedBuildingType]?.label ?? 'None' : 'None',
            selectedPlacedBuilding: selectedPlaced ? {
                id: selectedPlaced.id,
                label: buildingTypes[selectedPlaced.type]?.label ?? selectedPlaced.type,
                role: selectedPlaced.role,
                storedOutput: selectedPlaced.storedOutput,
                outputResource: selectedPlaced.outputResource,
                storageCap: selectedPlaced.storageCap
            } : null
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

    function getProducers() {
        return producers;
    }

    function getHouses() {
        return houses;
    }

    function getWarehouses() {
        return warehouses;
    }

    // Used by civilian logistics so workers can haul resources to warehouses.
    function takeProducerOutput(producerId, amount = 1) {
        const producer = buildingById.get(producerId);
        if (!producer || producer.role !== 'producer' || !producer.outputResource || producer.storedOutput <= 0) {
            return null;
        }
        const takenAmount = Math.min(amount, producer.storedOutput);
        producer.storedOutput -= takenAmount;
        return {
            resourceType: producer.outputResource,
            amount: takenAmount
        };
    }

    // Reset all buildings/runtime state for full game restarts.
    function reset() {
        for (const building of buildings) {
            building.sprite.destroy();
        }
        buildings.length = 0;
        producers.length = 0;
        houses.length = 0;
        warehouses.length = 0;
        occupiedTiles.clear();
        movementBlockedTiles.clear();
        projectileBlockedTiles.clear();
        occupiedTileToBuildingId.clear();
        buildingById.clear();
        selectedPlacedBuildingId = null;
        ghost.clear();
        ghost.visible = false;
    }

    return {
        toggleBuildMode,
        cycleSelectedBuilding,
        updatePlacementGhost,
        tryPlaceSelectedAtMouse,
        isTileBlocked,
        isProjectileBlocked,
        hasBridgeAt,
        getUiState,
        getMenuEntries,
        getWalls,
        getProducers,
        getHouses,
        getWarehouses,
        takeProducerOutput,
        removeSelectedPlacedBuilding,
        reset,
        selectBuildingAtMouse,
        updateProduction,
        collectNearestOutput,
        getStats: () => ({
            buildingCount: buildings.length,
            producerCount: producers.length,
            producedPerSecond
        })
    };
}
