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
    const civilians = [];
    const civilianById = new Map();
    const houseStates = new Map();
    const houseTimerLabels = new Map();
    let civilianIdCounter = 0;
    let civiliansKilled = 0;

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

    function findBestApproachPoint(building, fromX, fromY) {
        const candidates = getPerimeterTiles(building, 1);
        if (candidates.length === 0) {
            const fallback = getPerimeterTiles(building, 2);
            if (fallback.length === 0) {
                return getBuildingCenter(building);
            }
            candidates.push(...fallback);
        }

        let best = candidates[0];
        let bestDistSq = Infinity;
        for (const tile of candidates) {
            const cx = tile.x * TILE_SIZE + TILE_SIZE * 0.5;
            const cy = tile.y * TILE_SIZE + TILE_SIZE * 0.5;
            const dx = cx - fromX;
            const dy = cy - fromY;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                best = tile;
            }
        }
        return {
            x: best.x * TILE_SIZE + TILE_SIZE * 0.5,
            y: best.y * TILE_SIZE + TILE_SIZE * 0.5
        };
    }

    // Civilians should spawn outside the house footprint. We prioritize "front"
    // tiles (below the house) and then fall back to nearby perimeter tiles.
    function findHouseSpawnPoint(house) {
        const frontTileY = house.tileY + house.footprintH + 1;
        const frontMidTileX = house.tileX + Math.floor(house.footprintW / 2);
        const candidates = [];

        for (let dx = 0; dx < house.footprintW; dx++) {
            candidates.push({ x: house.tileX + dx, y: frontTileY });
        }
        candidates.unshift({ x: frontMidTileX, y: frontTileY });

        // Perimeter fallback if front is blocked (prefer 2-tile padding).
        candidates.push(...getPerimeterTiles(house, 2));
        candidates.push(...getPerimeterTiles(house, 1));

        for (const tile of candidates) {
            if (!isTileWalkable(tile.x, tile.y)) {
                continue;
            }
            return {
                x: tile.x * TILE_SIZE + TILE_SIZE * 0.5,
                y: tile.y * TILE_SIZE + TILE_SIZE * 0.5
            };
        }

        // Last resort: center (should be rare, only if fully enclosed).
        return getBuildingCenter(house);
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
        const producers = buildingSystem.getProducers();
        let best = null;
        let bestScore = -Infinity;
        for (const producer of producers) {
            if (producer.storedOutput <= 0 || !producer.outputResource) {
                continue;
            }
            // Prioritize camps with more stored resources; distance only breaks ties.
            const fromX = civilian.x + CIVILIAN_RADIUS;
            const fromY = civilian.y + CIVILIAN_RADIUS;
            const approach = findBestApproachPoint(producer, fromX, fromY);
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

    function findNearestWarehouse(civilian) {
        const warehouses = buildingSystem.getWarehouses();
        let best = null;
        let bestDistSq = Infinity;
        for (const warehouse of warehouses) {
            const center = getBuildingCenter(warehouse);
            const dx = center.x - (civilian.x + CIVILIAN_RADIUS);
            const dy = center.y - (civilian.y + CIVILIAN_RADIUS);
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                best = warehouse;
            }
        }
        return best;
    }

    function assignTransportJob(civilian) {
        const producer = findNearestProducerWithOutput(civilian);
        const warehouse = findNearestWarehouse(civilian);
        if (!producer || !warehouse) {
            civilian.state = 'idle';
            civilian.targetProducerId = null;
            civilian.targetWarehouseId = null;
            civilian.cargoAmount = 0;
            civilian.cargoResource = null;
            return;
        }
        const fromX = civilian.x + CIVILIAN_RADIUS;
        const fromY = civilian.y + CIVILIAN_RADIUS;
        const producerCenter = findBestApproachPoint(producer, fromX, fromY);
        civilian.state = 'toProducer';
        civilian.targetProducerId = producer.id;
        civilian.targetWarehouseId = warehouse.id;
        civilian.targetX = producerCenter.x;
        civilian.targetY = producerCenter.y;
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
        const moveX = dist > 0 ? (dx / dist) * step : 0;
        const moveY = dist > 0 ? (dy / dist) * step : 0;

        const candidateX = civilian.x + moveX;
        const candidateY = civilian.y + moveY;
        const centerTileX = Math.floor((candidateX + CIVILIAN_RADIUS) / TILE_SIZE);
        const centerTileY = Math.floor((candidateY + CIVILIAN_RADIUS) / TILE_SIZE);
        if (isTileWalkable(centerTileX, centerTileY)) {
            civilian.x = candidateX;
            civilian.y = candidateY;
            civilian.sprite.position.set(civilian.x, civilian.y);
            return false;
        }

        // Fallback axis checks reduce jitter when a direct diagonal step is blocked.
        const axisXTile = Math.floor((civilian.x + moveX + CIVILIAN_RADIUS) / TILE_SIZE);
        const axisYTile = Math.floor((civilian.y + moveY + CIVILIAN_RADIUS) / TILE_SIZE);
        if (isTileWalkable(axisXTile, Math.floor((civilian.y + CIVILIAN_RADIUS) / TILE_SIZE))) {
            civilian.x += moveX;
        } else if (isTileWalkable(Math.floor((civilian.x + CIVILIAN_RADIUS) / TILE_SIZE), axisYTile)) {
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
                if (!isTileWalkable(tTileX, tTileY)) {
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

    function processCivilianState(civilian, deltaMoveScale) {
        if (civilian.state === 'idle') {
            assignTransportJob(civilian);
            return;
        }

        const arrived = moveCivilianTowardTarget(civilian, deltaMoveScale);
        if (!arrived) {
            return;
        }

        if (civilian.state === 'toProducer') {
            const taken = buildingSystem.takeProducerOutput(civilian.targetProducerId, 1);
            if (!taken) {
                civilian.state = 'idle';
                return;
            }
            civilian.cargoResource = taken.resourceType;
            civilian.cargoAmount = taken.amount;
            const warehouse = buildingSystem.getWarehouses().find((item) => item.id === civilian.targetWarehouseId);
            if (!warehouse) {
                civilian.state = 'idle';
                civilian.cargoAmount = 0;
                civilian.cargoResource = null;
                return;
            }
            const fromX = civilian.x + CIVILIAN_RADIUS;
            const fromY = civilian.y + CIVILIAN_RADIUS;
            const warehouseCenter = findBestApproachPoint(warehouse, fromX, fromY);
            civilian.state = 'toWarehouse';
            civilian.targetX = warehouseCenter.x;
            civilian.targetY = warehouseCenter.y;
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

    function update(deltaFrames, deltaMoveScale) {
        spawnTick(deltaFrames);
        for (const civilian of civilians) {
            if (civilian.isDead) {
                continue;
            }
            processCivilianState(civilian, deltaMoveScale);
        }
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

    function getStats() {
        const houseCount = buildingSystem.getHouses().length;
        return {
            civilianCount: civilians.length,
            civilianCap: houseCount * HOUSE_CIVILIAN_CAP_BONUS,
            civiliansKilled
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
        civiliansKilled = 0;
    }

    return {
        update,
        getTargets,
        applyDamage,
        getStats,
        reset
    };
}
