import * as PIXI from 'pixi.js';
import {
    CIVILIAN_MAX_HP,
    CIVILIAN_RADIUS,
    CIVILIAN_SPEED,
    HOUSE_CIVILIAN_CAP_BONUS,
    HOUSE_SPAWN_INTERVAL_FRAMES,
    TILE_SIZE
} from '../config/constants.js';

// Civilian system:
// - Spawns civilians from houses based on per-house timers and cap rules.
// - Assigns transport jobs from producers to warehouses.
// - Deposits delivered resources directly into global inventory callback.
// - Exposes civilian targets so enemies can attack them.
export function createCivilianSystem({
    civilianLayer,
    buildingSystem,
    isTileWalkable,
    onDepositResource,
    onLog
}) {
    // Civilian movement tuning:
    // - Increase `CIVILIAN_SPAWN_FRONT_OFFSET_TILES` to spawn farther from houses.
    // - Increase `CIVILIAN_SEPARATION_PASSES` / `CIVILIAN_SEPARATION_PADDING` if overlap remains under heavy load.
    const CIVILIAN_SPAWN_FRONT_OFFSET_TILES = 2;
    const CIVILIAN_SEPARATION_PADDING = 2;
    const CIVILIAN_SEPARATION_PASSES = 3;
    const CIVILIAN_STUCK_FRAMES_THRESHOLD = 40;
    const CIVILIAN_STUCK_PROGRESS_EPSILON_SQ = 0.09;
    const CIVILIAN_DYNAMIC_AVOID_RADIUS = CIVILIAN_RADIUS * 2.5;
    const CIVILIAN_DYNAMIC_AVOID_WEIGHT = 1.15;
    const CIVILIAN_CARRY_AMOUNT = 5;
    const CIVILIAN_PATROL_RECHECK_FRAMES = 45;
    const CIVILIAN_STUCK_RECOVERY_COOLDOWN_FRAMES = 75;
    const CIVILIAN_ASSIGNMENTS_PER_FRAME = 10;
    const CIVILIAN_TARGET_REFRESH_FRAMES = 24;
    const CIVILIAN_TARGET_GRID_SIZE = TILE_SIZE * 10;
    const CIVILIAN_COLLISION_DENSE_THRESHOLD = 45;

    const civilians = [];
    const civilianById = new Map();
    const houseStates = new Map();
    const houseTimerLabels = new Map();
    const producerGrid = new Map();
    const warehouseGrid = new Map();
    let producerGridRefreshTimer = 0;
    let warehouseGridRefreshTimer = 0;
    let civilianUpdateCursor = 0;
    let updateFrameIndex = 0;
    const perfStats = {
        updateMs: 0,
        assignmentCalls: 0,
        assignmentSkippedByBudget: 0,
        producerQueries: 0,
        warehouseQueries: 0,
        collisionPasses: 0,
        civiliansResolvedCollisions: 0
    };
    let civilianIdCounter = 0;
    let civiliansKilled = 0;

    function getTargetGridCellKey(worldX, worldY) {
        const cellX = Math.floor(worldX / CIVILIAN_TARGET_GRID_SIZE);
        const cellY = Math.floor(worldY / CIVILIAN_TARGET_GRID_SIZE);
        return `${cellX},${cellY}`;
    }

    function pushToTargetGrid(grid, worldX, worldY, payload) {
        const key = getTargetGridCellKey(worldX, worldY);
        if (!grid.has(key)) {
            grid.set(key, []);
        }
        grid.get(key).push(payload);
    }

    function createCivilianSprite() {
        const sprite = new PIXI.Graphics();
        sprite.circle(CIVILIAN_RADIUS, CIVILIAN_RADIUS, CIVILIAN_RADIUS);
        sprite.fill(0xffd79a);
        sprite.stroke({ width: 1, color: 0x5c4323 });
        return sprite;
    }

    function getBuildingCenter(building) {
        return {
            x: (building.tileX + building.footprintW * 0.5) * TILE_SIZE,
            y: (building.tileY + building.footprintH * 0.5) * TILE_SIZE
        };
    }

    function rebuildProducerGrid() {
        producerGrid.clear();
        const producers = buildingSystem.getProducers();
        for (const producer of producers) {
            if (producer.storedOutput <= 0 || !producer.outputResource) {
                continue;
            }
            const center = getBuildingCenter(producer);
            pushToTargetGrid(producerGrid, center.x, center.y, producer);
        }
    }

    function rebuildWarehouseGrid() {
        warehouseGrid.clear();
        const warehouses = buildingSystem.getWarehouses();
        for (const warehouse of warehouses) {
            const center = getBuildingCenter(warehouse);
            pushToTargetGrid(warehouseGrid, center.x, center.y, warehouse);
        }
    }

    function queryNearbyGridEntries(grid, worldX, worldY) {
        const centerCellX = Math.floor(worldX / CIVILIAN_TARGET_GRID_SIZE);
        const centerCellY = Math.floor(worldY / CIVILIAN_TARGET_GRID_SIZE);
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

    // Returns walkable perimeter tiles around a building footprint.
    function getPerimeterTiles(building, padding = 1) {
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

    function findBestApproachPoint(building, fromX, fromY, laneSeed = 0) {
        const candidates = getPerimeterTiles(building, 1);
        if (candidates.length === 0) {
            const fallback = getPerimeterTiles(building, 2);
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
        // Spread workers over nearby perimeter points to avoid lane clumping.
        const laneWindow = Math.min(4, ranked.length);
        const chosen = ranked[Math.abs(laneSeed) % laneWindow]?.tile ?? ranked[0].tile;
        return {
            x: chosen.x * TILE_SIZE + TILE_SIZE * 0.5,
            y: chosen.y * TILE_SIZE + TILE_SIZE * 0.5
        };
    }

    // Civilians should spawn outside the house footprint. We prioritize "front"
    // tiles (below the house) and then fall back to nearby perimeter tiles.
    function findHouseSpawnPoint(house) {
        const frontTileY = house.tileY + house.footprintH + CIVILIAN_SPAWN_FRONT_OFFSET_TILES;
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
        candidates.push(...getPerimeterTiles(house, 3));
        candidates.push(...getPerimeterTiles(house, 2));
        candidates.push(...getPerimeterTiles(house, 1));

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
            if (isCivilianSpawnPositionClear(center.x, center.y)) {
                return center;
            }
        }

        if (firstWalkableCenter) {
            return firstWalkableCenter;
        }
        // Last resort if fully enclosed.
        return findUnstuckPointForCivilian(getBuildingCenter(house));
    }

    function isCivilianSpawnPositionClear(centerX, centerY) {
        const minDistance = CIVILIAN_RADIUS * 2 + CIVILIAN_SEPARATION_PADDING;
        const minDistanceSq = minDistance * minDistance;
        for (const civilian of civilians) {
            if (civilian.isDead) {
                continue;
            }
            const dx = (civilian.x + CIVILIAN_RADIUS) - centerX;
            const dy = (civilian.y + CIVILIAN_RADIUS) - centerY;
            if (dx * dx + dy * dy < minDistanceSq) {
                return false;
            }
        }
        return true;
    }

    function findUnstuckPointForCivilian(originCenter) {
        const searchOffsets = [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 },
            { x: 1, y: 1 },
            { x: 1, y: -1 },
            { x: -1, y: 1 },
            { x: -1, y: -1 },
            { x: 2, y: 0 },
            { x: -2, y: 0 },
            { x: 0, y: 2 },
            { x: 0, y: -2 },
            { x: 2, y: 1 },
            { x: 2, y: -1 },
            { x: -2, y: 1 },
            { x: -2, y: -1 }
        ];
        const tileX = Math.floor(originCenter.x / TILE_SIZE);
        const tileY = Math.floor(originCenter.y / TILE_SIZE);
        for (const offset of searchOffsets) {
            const tx = tileX + offset.x;
            const ty = tileY + offset.y;
            if (!isTileWalkable(tx, ty)) {
                continue;
            }
            const centerX = tx * TILE_SIZE + TILE_SIZE * 0.5;
            const centerY = ty * TILE_SIZE + TILE_SIZE * 0.5;
            if (isCivilianSpawnPositionClear(centerX, centerY)) {
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
                    return {
                        x: tx * TILE_SIZE + TILE_SIZE * 0.5,
                        y: ty * TILE_SIZE + TILE_SIZE * 0.5
                    };
                }
            }
        }
        return originCenter;
    }

    function ensureHouseStates() {
        const houses = buildingSystem.getHouses();
        const houseIds = new Set(houses.map((house) => house.id));

        for (const house of houses) {
            if (!houseStates.has(house.id)) {
                houseStates.set(house.id, {
                    // New houses spawn one civilian immediately, then follow timer cadence.
                    spawnTimer: 0,
                    activeCivilianIds: new Set()
                });
            }
            if (!houseTimerLabels.has(house.id)) {
                const label = new PIXI.Text({
                    text: '',
                    style: {
                        fill: '#f7f7f7',
                        fontFamily: 'monospace',
                        fontSize: 11
                    }
                });
                label.anchor.set(0.5);
                civilianLayer.addChild(label);
                houseTimerLabels.set(house.id, label);
            }
        }

        for (const [houseId, state] of houseStates) {
            if (!houseIds.has(houseId)) {
                for (const civilianId of state.activeCivilianIds) {
                    const civilian = civilianById.get(civilianId);
                    if (civilian) {
                        civilian.homeHouseId = null;
                    }
                }
                const label = houseTimerLabels.get(houseId);
                if (label) {
                    label.destroy();
                    houseTimerLabels.delete(houseId);
                }
                houseStates.delete(houseId);
            }
        }
    }

    function updateHouseTimerLabels() {
        const houses = buildingSystem.getHouses();
        for (const house of houses) {
            const state = houseStates.get(house.id);
            const label = houseTimerLabels.get(house.id);
            if (!state || !label) {
                continue;
            }
            const center = getBuildingCenter(house);
            label.position.set(center.x, center.y - (house.footprintH * TILE_SIZE * 0.5) - 8);
            const seconds = Math.max(0, Math.ceil(state.spawnTimer / 60));
            label.text = `Civ ${state.activeCivilianIds.size}/${HOUSE_CIVILIAN_CAP_BONUS} | ${seconds}s`;
        }
    }

    function spawnCivilianFromHouse(house) {
        const center = findHouseSpawnPoint(house);
        const sprite = createCivilianSprite();
        const civilian = {
            id: civilianIdCounter++,
            homeHouseId: house.id,
            x: center.x - CIVILIAN_RADIUS,
            y: center.y - CIVILIAN_RADIUS,
            hp: CIVILIAN_MAX_HP,
            maxHp: CIVILIAN_MAX_HP,
            isDead: false,
            state: 'idle',
            cargoResource: null,
            cargoAmount: 0,
            targetProducerId: null,
            targetWarehouseId: null,
            targetX: center.x,
            targetY: center.y,
            finalTargetX: center.x,
            finalTargetY: center.y,
            hasTravelWaypoint: false,
            routeSalt: 0,
            stuckFrames: 0,
            stuckRecoveryCooldownFrames: 0,
            patrolRecheckFrames: 0,
            sprite
        };
        sprite.position.set(civilian.x, civilian.y);
        civilianLayer.addChild(sprite);
        civilians.push(civilian);
        civilianById.set(civilian.id, civilian);
        houseStates.get(house.id)?.activeCivilianIds.add(civilian.id);
    }

    function removeCivilian(civilian) {
        civilian.isDead = true;
        civilian.sprite.destroy();
        civilianById.delete(civilian.id);
        const idx = civilians.findIndex((item) => item.id === civilian.id);
        if (idx >= 0) {
            civilians.splice(idx, 1);
        }
        if (civilian.homeHouseId !== null && houseStates.has(civilian.homeHouseId)) {
            houseStates.get(civilian.homeHouseId).activeCivilianIds.delete(civilian.id);
            // Respawn timer for this house restarts on death.
            houseStates.get(civilian.homeHouseId).spawnTimer = HOUSE_SPAWN_INTERVAL_FRAMES;
        }
        civiliansKilled += 1;
    }

    function findNearestProducerWithOutput(civilian) {
        perfStats.producerQueries += 1;
        const fromX = civilian.x + CIVILIAN_RADIUS;
        const fromY = civilian.y + CIVILIAN_RADIUS;
        let producers = queryNearbyGridEntries(producerGrid, fromX, fromY);
        if (producers.length === 0) {
            producers = buildingSystem.getProducers();
        }
        let best = null;
        let bestScore = -Infinity;
        for (const producer of producers) {
            if (producer.storedOutput <= 0 || !producer.outputResource) {
                continue;
            }
            // Prioritize camps with more stored resources; distance only breaks ties.
            const approach = findBestApproachPoint(producer, fromX, fromY, civilian.id);
            const dx = approach.x - fromX;
            const dy = approach.y - fromY;
            const dist = Math.hypot(dx, dy);
            const score = producer.storedOutput * 1000 - dist;
            if (score > bestScore) {
                bestScore = score;
                best = producer;
            }
        }
        return best;
    }

    function buildProducerLoadMap() {
        const loadByProducerId = new Map();
        for (const civilian of civilians) {
            if (civilian.isDead || !civilian.targetProducerId) {
                continue;
            }
            if (civilian.state !== 'toProducer' && civilian.state !== 'queueProducer') {
                continue;
            }
            loadByProducerId.set(
                civilian.targetProducerId,
                (loadByProducerId.get(civilian.targetProducerId) ?? 0) + 1
            );
        }
        return loadByProducerId;
    }

    function getProducerQueueCapacity(producer) {
        const perimeterCount = getPerimeterTiles(producer, 1).length;
        return Math.max(1, Math.min(4, Math.floor(perimeterCount / 3) || 2));
    }

    function getProducerQueuePoint(civilian, producer, queueIndex) {
        const fromX = civilian.x + CIVILIAN_RADIUS;
        const fromY = civilian.y + CIVILIAN_RADIUS;
        const approach = findBestApproachPoint(producer, fromX, fromY, civilian.id + queueIndex * 29);
        const producerCenter = getBuildingCenter(producer);
        const dx = approach.x - producerCenter.x;
        const dy = approach.y - producerCenter.y;
        const mag = Math.hypot(dx, dy);
        if (mag < 0.001) {
            return approach;
        }
        const distanceOut = TILE_SIZE * (1 + queueIndex * 0.8);
        const queuePoint = {
            x: approach.x + (dx / mag) * distanceOut,
            y: approach.y + (dy / mag) * distanceOut
        };
        const tileX = Math.floor(queuePoint.x / TILE_SIZE);
        const tileY = Math.floor(queuePoint.y / TILE_SIZE);
        if (!isTileWalkable(tileX, tileY)) {
            return approach;
        }
        return queuePoint;
    }

    function findNearestWarehouse(civilian) {
        perfStats.warehouseQueries += 1;
        const fromX = civilian.x + CIVILIAN_RADIUS;
        const fromY = civilian.y + CIVILIAN_RADIUS;
        let warehouses = queryNearbyGridEntries(warehouseGrid, fromX, fromY);
        if (warehouses.length === 0) {
            warehouses = buildingSystem.getWarehouses();
        }
        let best = null;
        let bestDistSq = Infinity;
        for (const warehouse of warehouses) {
            const center = getBuildingCenter(warehouse);
            const dx = center.x - fromX;
            const dy = center.y - fromY;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                best = warehouse;
            }
        }
        return best;
    }

    // Travel diversity:
    // - Adds a lightweight detour waypoint so civilians do not all pick identical straight lines.
    // - If detour tile is blocked, falls back to direct movement.
    function setCivilianTravelTarget(civilian, finalX, finalY, preferDetour = true) {
        civilian.finalTargetX = finalX;
        civilian.finalTargetY = finalY;
        civilian.hasTravelWaypoint = false;

        const fromX = civilian.x + CIVILIAN_RADIUS;
        const fromY = civilian.y + CIVILIAN_RADIUS;
        const dx = finalX - fromX;
        const dy = finalY - fromY;
        const dist = Math.hypot(dx, dy);
        if (!preferDetour || dist < TILE_SIZE * 3) {
            civilian.targetX = finalX;
            civilian.targetY = finalY;
            return;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const basePerpX = -ny;
        const basePerpY = nx;
        civilian.routeSalt += 1;
        const sign = ((civilian.id + civilian.routeSalt) % 2 === 0) ? 1 : -1;
        const offsetScale = TILE_SIZE * (1.15 + ((civilian.id + civilian.routeSalt) % 3) * 0.28);
        const midpointX = fromX + dx * 0.52;
        const midpointY = fromY + dy * 0.52;

        const candidateOffsets = [
            sign * offsetScale,
            -sign * offsetScale,
            sign * offsetScale * 0.6,
            -sign * offsetScale * 0.6
        ];
        for (const offset of candidateOffsets) {
            const waypointX = midpointX + basePerpX * offset;
            const waypointY = midpointY + basePerpY * offset;
            const tileX = Math.floor(waypointX / TILE_SIZE);
            const tileY = Math.floor(waypointY / TILE_SIZE);
            if (!isTileWalkable(tileX, tileY)) {
                continue;
            }
            civilian.targetX = waypointX;
            civilian.targetY = waypointY;
            civilian.hasTravelWaypoint = true;
            return;
        }

        civilian.targetX = finalX;
        civilian.targetY = finalY;
    }

    function findIdleAnchorBuilding(civilian) {
        if (civilian.homeHouseId !== null) {
            const home = buildingSystem.getHouses().find((house) => house.id === civilian.homeHouseId);
            if (home) {
                return home;
            }
        }
        const warehouses = buildingSystem.getWarehouses();
        if (warehouses.length > 0) {
            return warehouses[0];
        }
        const producers = buildingSystem.getProducers();
        if (producers.length > 0) {
            return producers[0];
        }
        return null;
    }

    function assignIdlePatrol(civilian) {
        const anchor = findIdleAnchorBuilding(civilian);
        if (!anchor) {
            civilian.state = 'idle';
            return;
        }
        const fromX = civilian.x + CIVILIAN_RADIUS;
        const fromY = civilian.y + CIVILIAN_RADIUS;
        const patrolPoint = findBestApproachPoint(anchor, fromX, fromY, civilian.id + (updateFrameIndex * 13));
        civilian.state = 'idlePatrol';
        setCivilianTravelTarget(civilian, patrolPoint.x, patrolPoint.y, true);
        civilian.patrolRecheckFrames = CIVILIAN_PATROL_RECHECK_FRAMES;
    }

    function assignTransportJob(civilian) {
        const warehouse = findNearestWarehouse(civilian);
        if (!warehouse) {
            civilian.state = 'idlePatrol';
            civilian.targetProducerId = null;
            civilian.targetWarehouseId = null;
            civilian.cargoAmount = 0;
            civilian.cargoResource = null;
            assignIdlePatrol(civilian);
            return false;
        }

        const fromX = civilian.x + CIVILIAN_RADIUS;
        const fromY = civilian.y + CIVILIAN_RADIUS;
        let producers = queryNearbyGridEntries(producerGrid, fromX, fromY);
        if (producers.length === 0) {
            producers = buildingSystem.getProducers();
        }
        const rankedProducers = [];
        for (const producer of producers) {
            if (producer.storedOutput <= 0 || !producer.outputResource) {
                continue;
            }
            const approach = findBestApproachPoint(producer, fromX, fromY, civilian.id);
            const dx = approach.x - fromX;
            const dy = approach.y - fromY;
            const dist = Math.hypot(dx, dy);
            const score = producer.storedOutput * 1000 - dist;
            rankedProducers.push({ producer, score });
        }
        rankedProducers.sort((a, b) => b.score - a.score);
        if (rankedProducers.length === 0) {
            civilian.state = 'idlePatrol';
            civilian.targetProducerId = null;
            civilian.targetWarehouseId = null;
            civilian.cargoAmount = 0;
            civilian.cargoResource = null;
            assignIdlePatrol(civilian);
            return false;
        }

        const producerLoadMap = buildProducerLoadMap();
        let selectedProducer = null;
        let fallbackQueueProducer = null;
        let fallbackQueueLoad = Infinity;
        for (const entry of rankedProducers) {
            const producer = entry.producer;
            const currentLoad = producerLoadMap.get(producer.id) ?? 0;
            const capacity = getProducerQueueCapacity(producer);
            if (currentLoad < capacity) {
                selectedProducer = producer;
                producerLoadMap.set(producer.id, currentLoad + 1);
                break;
            }
            if (currentLoad < fallbackQueueLoad) {
                fallbackQueueProducer = producer;
                fallbackQueueLoad = currentLoad;
            }
        }
        if (!selectedProducer && !fallbackQueueProducer) {
            civilian.state = 'idlePatrol';
            assignIdlePatrol(civilian);
            return false;
        }

        if (selectedProducer) {
            const producerCenter = findBestApproachPoint(selectedProducer, fromX, fromY, civilian.id);
            civilian.state = 'toProducer';
            civilian.targetProducerId = selectedProducer.id;
            civilian.targetWarehouseId = warehouse.id;
            setCivilianTravelTarget(civilian, producerCenter.x, producerCenter.y, true);
            civilian.patrolRecheckFrames = CIVILIAN_PATROL_RECHECK_FRAMES;
            return true;
        }

        const queuePoint = getProducerQueuePoint(civilian, fallbackQueueProducer, fallbackQueueLoad);
        civilian.state = 'queueProducer';
        civilian.targetProducerId = fallbackQueueProducer.id;
        civilian.targetWarehouseId = warehouse.id;
        setCivilianTravelTarget(civilian, queuePoint.x, queuePoint.y, false);
        civilian.patrolRecheckFrames = Math.max(15, CIVILIAN_PATROL_RECHECK_FRAMES / 2);
        return true;
    }

    function moveCivilianTowardTarget(civilian, deltaMoveScale) {
        const centerX = civilian.x + CIVILIAN_RADIUS;
        const centerY = civilian.y + CIVILIAN_RADIUS;
        const dx = civilian.targetX - centerX;
        const dy = civilian.targetY - centerY;
        const dist = Math.hypot(dx, dy);
        if (dist < 2) {
            return true;
        }
        const step = CIVILIAN_SPEED * deltaMoveScale;
        let dirX = dist > 0 ? (dx / dist) : 0;
        let dirY = dist > 0 ? (dy / dist) : 0;

        // Dynamic steering around nearby civilians reduces same-lane pileups.
        let avoidX = 0;
        let avoidY = 0;
        const avoidRadiusSq = CIVILIAN_DYNAMIC_AVOID_RADIUS * CIVILIAN_DYNAMIC_AVOID_RADIUS;
        for (const other of civilians) {
            if (other.id === civilian.id || other.isDead) {
                continue;
            }
            const ox = (other.x + CIVILIAN_RADIUS) - centerX;
            const oy = (other.y + CIVILIAN_RADIUS) - centerY;
            const odSq = ox * ox + oy * oy;
            if (odSq <= 0.0001 || odSq > avoidRadiusSq) {
                continue;
            }
            const forwardDot = ox * dirX + oy * dirY;
            if (forwardDot < -2) {
                continue;
            }
            const od = Math.sqrt(odSq);
            const strength = (CIVILIAN_DYNAMIC_AVOID_RADIUS - od) / CIVILIAN_DYNAMIC_AVOID_RADIUS;
            avoidX -= (ox / od) * strength;
            avoidY -= (oy / od) * strength;
        }
        dirX += avoidX * CIVILIAN_DYNAMIC_AVOID_WEIGHT;
        dirY += avoidY * CIVILIAN_DYNAMIC_AVOID_WEIGHT;
        const dirMag = Math.hypot(dirX, dirY);
        if (dirMag > 0.001) {
            dirX /= dirMag;
            dirY /= dirMag;
        }
        const moveX = dirX * step;
        const moveY = dirY * step;

        const candidateX = civilian.x + moveX;
        const candidateY = civilian.y + moveY;
        const centerTileX = Math.floor((candidateX + CIVILIAN_RADIUS) / TILE_SIZE);
        const centerTileY = Math.floor((candidateY + CIVILIAN_RADIUS) / TILE_SIZE);
        if (isTileWalkable(centerTileX, centerTileY) && isCivilianStepClear(civilian, candidateX, candidateY)) {
            civilian.x = candidateX;
            civilian.y = candidateY;
            civilian.sprite.position.set(civilian.x, civilian.y);
            return false;
        }

        // Fallback axis checks reduce jitter when a direct diagonal step is blocked.
        const axisXTile = Math.floor((civilian.x + moveX + CIVILIAN_RADIUS) / TILE_SIZE);
        const axisYTile = Math.floor((civilian.y + moveY + CIVILIAN_RADIUS) / TILE_SIZE);
        if (
            isTileWalkable(axisXTile, Math.floor((civilian.y + CIVILIAN_RADIUS) / TILE_SIZE)) &&
            isCivilianStepClear(civilian, civilian.x + moveX, civilian.y)
        ) {
            civilian.x += moveX;
        } else if (
            isTileWalkable(Math.floor((civilian.x + CIVILIAN_RADIUS) / TILE_SIZE), axisYTile) &&
            isCivilianStepClear(civilian, civilian.x, civilian.y + moveY)
        ) {
            civilian.y += moveY;
        } else {
            // Local obstacle avoidance: try short detours that still move toward target.
            const detours = [
                { x: 1, y: 0 },
                { x: -1, y: 0 },
                { x: 0, y: 1 },
                { x: 0, y: -1 },
                { x: 0.7, y: 0.7 },
                { x: 0.7, y: -0.7 },
                { x: -0.7, y: 0.7 },
                { x: -0.7, y: -0.7 }
            ];
            let bestCandidate = null;
            let bestScore = Infinity;
            for (const detour of detours) {
                const stepX = detour.x * step;
                const stepY = detour.y * step;
                const tx = civilian.x + stepX;
                const ty = civilian.y + stepY;
                const tTileX = Math.floor((tx + CIVILIAN_RADIUS) / TILE_SIZE);
                const tTileY = Math.floor((ty + CIVILIAN_RADIUS) / TILE_SIZE);
                if (!isTileWalkable(tTileX, tTileY) || !isCivilianStepClear(civilian, tx, ty)) {
                    continue;
                }
                const tdx = civilian.targetX - (tx + CIVILIAN_RADIUS);
                const tdy = civilian.targetY - (ty + CIVILIAN_RADIUS);
                const score = tdx * tdx + tdy * tdy;
                if (score < bestScore) {
                    bestScore = score;
                    bestCandidate = { x: tx, y: ty };
                }
            }
            if (bestCandidate) {
                civilian.x = bestCandidate.x;
                civilian.y = bestCandidate.y;
            }
        }
        civilian.sprite.position.set(civilian.x, civilian.y);
        return false;
    }

    function isCivilianStepClear(civilian, candidateX, candidateY) {
        const candidateCenterX = candidateX + CIVILIAN_RADIUS;
        const candidateCenterY = candidateY + CIVILIAN_RADIUS;
        const minDistance = Math.max(6, CIVILIAN_RADIUS * 2 - 3);
        const minDistanceSq = minDistance * minDistance;
        for (const other of civilians) {
            if (other.id === civilian.id || other.isDead) {
                continue;
            }
            const dx = (other.x + CIVILIAN_RADIUS) - candidateCenterX;
            const dy = (other.y + CIVILIAN_RADIUS) - candidateCenterY;
            if (dx * dx + dy * dy < minDistanceSq) {
                return false;
            }
        }
        return true;
    }

    function processCivilianState(civilian, deltaMoveScale, assignmentBudget) {
        if (civilian.state === 'idle') {
            if (assignmentBudget.remaining <= 0) {
                perfStats.assignmentSkippedByBudget += 1;
                return;
            }
            assignmentBudget.remaining -= 1;
            perfStats.assignmentCalls += 1;
            assignTransportJob(civilian);
            return;
        }

        if (civilian.state === 'idlePatrol') {
            civilian.patrolRecheckFrames -= 1;
            if (civilian.patrolRecheckFrames <= 0 && assignmentBudget.remaining > 0) {
                assignmentBudget.remaining -= 1;
                perfStats.assignmentCalls += 1;
                const assigned = assignTransportJob(civilian);
                if (assigned) {
                    return;
                }
                civilian.patrolRecheckFrames = CIVILIAN_PATROL_RECHECK_FRAMES;
            } else if (civilian.patrolRecheckFrames <= 0) {
                perfStats.assignmentSkippedByBudget += 1;
                civilian.patrolRecheckFrames = 8;
            }

            const arrivedPatrol = moveCivilianTowardTarget(civilian, deltaMoveScale);
            if (arrivedPatrol) {
                assignIdlePatrol(civilian);
            }
            return;
        }

        if (civilian.state === 'queueProducer') {
            civilian.patrolRecheckFrames -= 1;
            if (civilian.patrolRecheckFrames <= 0) {
                if (assignmentBudget.remaining > 0) {
                    assignmentBudget.remaining -= 1;
                    perfStats.assignmentCalls += 1;
                    assignTransportJob(civilian);
                } else {
                    perfStats.assignmentSkippedByBudget += 1;
                }
                civilian.patrolRecheckFrames = Math.max(15, CIVILIAN_PATROL_RECHECK_FRAMES / 2);
            }
            const arrivedQueue = moveCivilianTowardTarget(civilian, deltaMoveScale);
            if (arrivedQueue) {
                civilian.targetX = civilian.finalTargetX;
                civilian.targetY = civilian.finalTargetY;
            }
            return;
        }

        const previousX = civilian.x;
        const previousY = civilian.y;
        const arrived = moveCivilianTowardTarget(civilian, deltaMoveScale);
        if (!arrived) {
            const movedX = civilian.x - previousX;
            const movedY = civilian.y - previousY;
            if (movedX * movedX + movedY * movedY < CIVILIAN_STUCK_PROGRESS_EPSILON_SQ) {
                civilian.stuckFrames += 1;
            } else {
                civilian.stuckFrames = 0;
            }
            if (civilian.stuckRecoveryCooldownFrames > 0) {
                civilian.stuckRecoveryCooldownFrames -= 1;
            }
            if (
                civilian.stuckFrames >= CIVILIAN_STUCK_FRAMES_THRESHOLD &&
                civilian.stuckRecoveryCooldownFrames <= 0
            ) {
                const center = {
                    x: civilian.x + CIVILIAN_RADIUS,
                    y: civilian.y + CIVILIAN_RADIUS
                };
                const unstuckCenter = findUnstuckPointForCivilian(center);
                civilian.x = unstuckCenter.x - CIVILIAN_RADIUS;
                civilian.y = unstuckCenter.y - CIVILIAN_RADIUS;
                civilian.sprite.position.set(civilian.x, civilian.y);
                civilian.stuckFrames = 0;
                civilian.stuckRecoveryCooldownFrames = CIVILIAN_STUCK_RECOVERY_COOLDOWN_FRAMES;
                // Force a patrol reset to break repeated stuck/unstuck loops.
                assignIdlePatrol(civilian);
            }
            return;
        }
        if (civilian.hasTravelWaypoint) {
            civilian.hasTravelWaypoint = false;
            civilian.targetX = civilian.finalTargetX;
            civilian.targetY = civilian.finalTargetY;
            return;
        }
        civilian.stuckFrames = 0;
        civilian.stuckRecoveryCooldownFrames = 0;

        if (civilian.state === 'toProducer') {
            const producer = buildingSystem.getProducers().find((item) => item.id === civilian.targetProducerId);
            if (!producer || producer.storedOutput <= 0) {
                civilian.state = 'idlePatrol';
                assignIdlePatrol(civilian);
                return;
            }
            const taken = buildingSystem.takeProducerOutput(civilian.targetProducerId, CIVILIAN_CARRY_AMOUNT, false);
            if (!taken) {
                civilian.state = 'idlePatrol';
                assignIdlePatrol(civilian);
                return;
            }
            civilian.cargoResource = taken.resourceType;
            civilian.cargoAmount = taken.amount;
            const warehouse = buildingSystem.getWarehouses().find((item) => item.id === civilian.targetWarehouseId);
            if (!warehouse) {
                civilian.state = 'idlePatrol';
                civilian.cargoAmount = 0;
                civilian.cargoResource = null;
                assignIdlePatrol(civilian);
                return;
            }
            const fromX = civilian.x + CIVILIAN_RADIUS;
            const fromY = civilian.y + CIVILIAN_RADIUS;
            const warehouseCenter = findBestApproachPoint(warehouse, fromX, fromY, civilian.id);
            civilian.state = 'toWarehouse';
            setCivilianTravelTarget(civilian, warehouseCenter.x, warehouseCenter.y, true);
            return;
        }

        if (civilian.state === 'toWarehouse') {
            if (civilian.cargoResource && civilian.cargoAmount > 0) {
                onDepositResource(civilian.cargoResource, civilian.cargoAmount);
            }
            civilian.cargoAmount = 0;
            civilian.cargoResource = null;
            civilian.state = 'idle';
        }
    }

    function spawnTick(deltaFrames) {
        ensureHouseStates();
        producerGridRefreshTimer -= deltaFrames;
        warehouseGridRefreshTimer -= deltaFrames;
        if (producerGridRefreshTimer <= 0) {
            rebuildProducerGrid();
            producerGridRefreshTimer = CIVILIAN_TARGET_REFRESH_FRAMES;
        }
        if (warehouseGridRefreshTimer <= 0) {
            rebuildWarehouseGrid();
            warehouseGridRefreshTimer = CIVILIAN_TARGET_REFRESH_FRAMES;
        }
        const houses = buildingSystem.getHouses();
        const globalCap = houses.length * HOUSE_CIVILIAN_CAP_BONUS;
        for (const house of houses) {
            const state = houseStates.get(house.id);
            if (!state) {
                continue;
            }
            state.spawnTimer -= deltaFrames;
            if (state.spawnTimer > 0) {
                continue;
            }
            if (state.activeCivilianIds.size >= HOUSE_CIVILIAN_CAP_BONUS || civilians.length >= globalCap) {
                state.spawnTimer = 30;
                continue;
            }
            spawnCivilianFromHouse(house);
            state.spawnTimer = HOUSE_SPAWN_INTERVAL_FRAMES;
        }
        updateHouseTimerLabels();
    }

    function resolveCivilianCollisions() {
        if (civilians.length <= 1) {
            return;
        }
        const denseMode = civilians.length >= CIVILIAN_COLLISION_DENSE_THRESHOLD;
        const minDistance = CIVILIAN_RADIUS * 2 + CIVILIAN_SEPARATION_PADDING;
        const minDistanceSq = minDistance * minDistance;
        const cellSize = minDistance;
        const maxPasses = denseMode ? 2 : CIVILIAN_SEPARATION_PASSES;
        let separatedCount = 0;
        for (let pass = 0; pass < maxPasses; pass++) {
            const grid = new Map();
            for (let i = 0; i < civilians.length; i++) {
                const civilian = civilians[i];
                if (civilian.isDead) {
                    continue;
                }
                const cx = Math.floor((civilian.x + CIVILIAN_RADIUS) / cellSize);
                const cy = Math.floor((civilian.y + CIVILIAN_RADIUS) / cellSize);
                const key = `${cx},${cy}`;
                if (!grid.has(key)) {
                    grid.set(key, []);
                }
                grid.get(key).push(i);
            }

            for (let i = 0; i < civilians.length; i++) {
                const base = civilians[i];
                if (base.isDead) {
                    continue;
                }
                const bxCell = Math.floor((base.x + CIVILIAN_RADIUS) / cellSize);
                const byCell = Math.floor((base.y + CIVILIAN_RADIUS) / cellSize);
                for (let oy = -1; oy <= 1; oy++) {
                    for (let ox = -1; ox <= 1; ox++) {
                        const bucket = grid.get(`${bxCell + ox},${byCell + oy}`);
                        if (!bucket) {
                            continue;
                        }
                        for (const j of bucket) {
                            if (j <= i) {
                                continue;
                            }
                            const a = civilians[i];
                            const b = civilians[j];
                            if (a.isDead || b.isDead) {
                                continue;
                            }
                            const ax = a.x + CIVILIAN_RADIUS;
                            const ay = a.y + CIVILIAN_RADIUS;
                            const bx = b.x + CIVILIAN_RADIUS;
                            const by = b.y + CIVILIAN_RADIUS;
                            let dx = bx - ax;
                            let dy = by - ay;
                            let distSq = dx * dx + dy * dy;
                            if (distSq >= minDistanceSq) {
                                continue;
                            }
                            if (distSq < 0.0001) {
                                const angle = (a.id * 0.43 + b.id * 0.79) % (Math.PI * 2);
                                dx = Math.cos(angle);
                                dy = Math.sin(angle);
                                distSq = 1;
                            }
                            const dist = Math.sqrt(distSq);
                            const overlap = minDistance - dist;
                            const nx = dx / dist;
                            const ny = dy / dist;
                            separatedCount += 1;
                            const halfPushX = nx * overlap * 0.65;
                            const halfPushY = ny * overlap * 0.65;
                            const newAX = a.x - halfPushX;
                            const newAY = a.y - halfPushY;
                            const newBX = b.x + halfPushX;
                            const newBY = b.y + halfPushY;
                            const aTileX = Math.floor((newAX + CIVILIAN_RADIUS) / TILE_SIZE);
                            const aTileY = Math.floor((newAY + CIVILIAN_RADIUS) / TILE_SIZE);
                            const bTileX = Math.floor((newBX + CIVILIAN_RADIUS) / TILE_SIZE);
                            const bTileY = Math.floor((newBY + CIVILIAN_RADIUS) / TILE_SIZE);
                            const canMoveA = isTileWalkable(aTileX, aTileY);
                            const canMoveB = isTileWalkable(bTileX, bTileY);
                            if (canMoveA && canMoveB) {
                                a.x = newAX;
                                a.y = newAY;
                                b.x = newBX;
                                b.y = newBY;
                            } else if (canMoveA) {
                                a.x -= nx * overlap;
                                a.y -= ny * overlap;
                            } else if (canMoveB) {
                                b.x += nx * overlap;
                                b.y += ny * overlap;
                            }
                        }
                    }
                }
            }
        }
        perfStats.collisionPasses = maxPasses;
        perfStats.civiliansResolvedCollisions = separatedCount;
        for (const civilian of civilians) {
            civilian.sprite.position.set(civilian.x, civilian.y);
        }
    }

    function update(deltaFrames, deltaMoveScale) {
        const startMs = performance.now();
        updateFrameIndex += 1;
        perfStats.assignmentCalls = 0;
        perfStats.assignmentSkippedByBudget = 0;
        perfStats.producerQueries = 0;
        perfStats.warehouseQueries = 0;
        spawnTick(deltaFrames);
        if (civilians.length === 0) {
            perfStats.updateMs = performance.now() - startMs;
            return;
        }
        const assignmentBudget = { remaining: CIVILIAN_ASSIGNMENTS_PER_FRAME };
        for (let i = 0; i < civilians.length; i++) {
            const idx = (civilianUpdateCursor + i) % civilians.length;
            const civilian = civilians[idx];
            if (civilian.isDead) {
                continue;
            }
            processCivilianState(civilian, deltaMoveScale, assignmentBudget);
        }
        civilianUpdateCursor = (civilianUpdateCursor + 1) % civilians.length;
        resolveCivilianCollisions();
        perfStats.updateMs = performance.now() - startMs;
    }

    function getTargets() {
        return civilians.map((civilian) => ({
            id: civilian.id,
            x: civilian.x + CIVILIAN_RADIUS,
            y: civilian.y + CIVILIAN_RADIUS,
            hp: civilian.hp,
            isDead: civilian.isDead
        }));
    }

    function applyDamage(civilianId, amount, source) {
        const civilian = civilianById.get(civilianId);
        if (!civilian || civilian.isDead || amount <= 0) {
            return false;
        }
        civilian.hp = Math.max(0, civilian.hp - amount);
        if (civilian.hp <= 0) {
            removeCivilian(civilian);
            onLog?.(`Civilian lost (${source})`);
        }
        return true;
    }

    // Player-civilian collision:
    // - Player cannot phase through civilians.
    // - Player movement can push civilians away when there is space.
    function resolvePlayerCollision(playerCenterX, playerCenterY, playerRadius, applyPlayerPush) {
        const minDistance = playerRadius + CIVILIAN_RADIUS;
        const minDistanceSq = minDistance * minDistance;
        let collisions = 0;

        for (const civilian of civilians) {
            if (civilian.isDead) {
                continue;
            }
            const cx = civilian.x + CIVILIAN_RADIUS;
            const cy = civilian.y + CIVILIAN_RADIUS;
            let dx = cx - playerCenterX;
            let dy = cy - playerCenterY;
            let distSq = dx * dx + dy * dy;
            if (distSq >= minDistanceSq) {
                continue;
            }
            if (distSq < 0.0001) {
                const angle = (civilian.id * 0.53) % (Math.PI * 2);
                dx = Math.cos(angle);
                dy = Math.sin(angle);
                distSq = 1;
            }

            collisions += 1;
            const dist = Math.sqrt(distSq);
            const overlap = minDistance - dist;
            const nx = dx / dist;
            const ny = dy / dist;
            const pushCivilian = overlap * 0.85;
            const targetCivilianX = civilian.x + nx * pushCivilian;
            const targetCivilianY = civilian.y + ny * pushCivilian;
            const civilianTileX = Math.floor((targetCivilianX + CIVILIAN_RADIUS) / TILE_SIZE);
            const civilianTileY = Math.floor((targetCivilianY + CIVILIAN_RADIUS) / TILE_SIZE);
            if (isTileWalkable(civilianTileX, civilianTileY)) {
                civilian.x = targetCivilianX;
                civilian.y = targetCivilianY;
                civilian.sprite.position.set(civilian.x, civilian.y);
            } else {
                applyPlayerPush(-nx * overlap * 0.6, -ny * overlap * 0.6);
            }
        }

        return collisions;
    }

    function getStats() {
        const houseCount = buildingSystem.getHouses().length;
        return {
            civilianCount: civilians.length,
            civilianCap: houseCount * HOUSE_CIVILIAN_CAP_BONUS,
            civiliansKilled,
            perf: {
                updateMs: perfStats.updateMs,
                assignmentCalls: perfStats.assignmentCalls,
                assignmentSkippedByBudget: perfStats.assignmentSkippedByBudget,
                producerQueries: perfStats.producerQueries,
                warehouseQueries: perfStats.warehouseQueries,
                collisionPasses: perfStats.collisionPasses,
                civiliansResolvedCollisions: perfStats.civiliansResolvedCollisions
            }
        };
    }

    // Clears all civilians and timers so a death restart begins from a clean world state.
    function reset() {
        for (const civilian of civilians) {
            civilian.sprite.destroy();
        }
        for (const [, label] of houseTimerLabels) {
            label.destroy();
        }
        civilians.length = 0;
        civilianById.clear();
        houseStates.clear();
        houseTimerLabels.clear();
        producerGrid.clear();
        warehouseGrid.clear();
        producerGridRefreshTimer = 0;
        warehouseGridRefreshTimer = 0;
        civilianUpdateCursor = 0;
        updateFrameIndex = 0;
        perfStats.updateMs = 0;
        perfStats.assignmentCalls = 0;
        perfStats.assignmentSkippedByBudget = 0;
        perfStats.producerQueries = 0;
        perfStats.warehouseQueries = 0;
        perfStats.collisionPasses = 0;
        perfStats.civiliansResolvedCollisions = 0;
        civiliansKilled = 0;
    }

    function syncReplicatedState(entries) {
        const source = Array.isArray(entries) ? entries : [];
        civilianById.clear();
        while (civilians.length < source.length) {
            const sprite = createCivilianSprite();
            civilianLayer.addChild(sprite);
            const civilian = {
                id: civilianIdCounter++,
                homeHouseId: null,
                x: 0,
                y: 0,
                hp: CIVILIAN_MAX_HP,
                maxHp: CIVILIAN_MAX_HP,
                isDead: false,
                state: 'replicated',
                cargoResource: null,
                cargoAmount: 0,
                targetProducerId: null,
                targetWarehouseId: null,
                targetX: 0,
                targetY: 0,
                finalTargetX: 0,
                finalTargetY: 0,
                hasTravelWaypoint: false,
                routeSalt: 0,
                stuckFrames: 0,
                stuckRecoveryCooldownFrames: 0,
                patrolRecheckFrames: 0,
                sprite
            };
            civilians.push(civilian);
            civilianById.set(civilian.id, civilian);
        }
        for (let i = 0; i < source.length; i++) {
            const civilian = civilians[i];
            const entry = source[i];
            const centerX = Number(entry?.x) || 0;
            const centerY = Number(entry?.y) || 0;
            civilian.id = Number(entry?.id) || civilian.id;
            civilian.x = centerX - CIVILIAN_RADIUS;
            civilian.y = centerY - CIVILIAN_RADIUS;
            civilian.hp = Number(entry?.hp) || civilian.hp;
            civilian.maxHp = Number(entry?.maxHp) || civilian.maxHp;
            civilian.isDead = Boolean(entry?.isDead);
            civilian.state = 'replicated';
            civilian.sprite.visible = !civilian.isDead;
            civilian.sprite.position.set(civilian.x, civilian.y);
            civilianById.set(civilian.id, civilian);
        }
        for (let i = civilians.length - 1; i >= source.length; i--) {
            const civilian = civilians[i];
            civilian.sprite.destroy();
            civilians.splice(i, 1);
        }
        for (const [, label] of houseTimerLabels) {
            label.visible = false;
        }
    }

    return {
        update,
        getTargets,
        applyDamage,
        resolvePlayerCollision,
        getStats,
        syncReplicatedState,
        reset
    };
}
