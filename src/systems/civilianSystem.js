import * as PIXI from 'pixi.js';
import {
    CIVILIAN_MAX_HP,
    CIVILIAN_RADIUS,
    CIVILIAN_SPEED,
    HOUSE_CIVILIAN_CAP_BONUS,
    HOUSE_SPAWN_INTERVAL_FRAMES,
    TILE_SIZE
} from '../config/constants.js';
import {
    findBestApproachPoint,
    getBuildingCenter,
    getPerimeterTiles,
    queryNearbyGridEntries
} from './civilianSpatialUtils.js';
import { resolveCivilianCollisions as resolveCivilianCollisionsBase, resolvePlayerCivilianCollision } from './civilianCollision.js';
import {
    buildProducerLoadMap as buildProducerLoadMapBase,
    findNearestProducerWithOutput as findNearestProducerWithOutputBase,
    findNearestWarehouse as findNearestWarehouseBase,
    getProducerQueueCapacity as getProducerQueueCapacityBase,
    getProducerQueuePoint as getProducerQueuePointBase
} from './civilianLogisticsSelectors.js';
import { syncReplicatedStateFromSnapshot } from './civilianSync.js';
import { CIVILIAN_TUNING } from './civilianConfig.js';
import {
    ensureHouseStatesAdapter,
    getHouseTimerReplicationAdapter,
    syncReplicatedHouseTimersAdapter,
    updateHouseTimerLabelsAdapter
} from './civilianHouseStateAdapter.js';
import {
    findHouseSpawnPoint as findHouseSpawnPointBase,
    findUnstuckPointForCivilian as findUnstuckPointForCivilianBase,
    isCivilianSpawnPositionClear as isCivilianSpawnPositionClearBase
} from './civilianSpawn.js';
import { rebuildProducerGridEntries, rebuildWarehouseGridEntries } from './civilianTargetGrids.js';

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
    // See `civilianConfig.js` for the centralized knobs to tune civilian behavior.
    const {
        SPAWN_FRONT_OFFSET_TILES: CIVILIAN_SPAWN_FRONT_OFFSET_TILES, SEPARATION_PADDING: CIVILIAN_SEPARATION_PADDING, SEPARATION_PASSES: CIVILIAN_SEPARATION_PASSES,
        STUCK_FRAMES_THRESHOLD: CIVILIAN_STUCK_FRAMES_THRESHOLD, STUCK_PROGRESS_EPSILON_SQ: CIVILIAN_STUCK_PROGRESS_EPSILON_SQ, DYNAMIC_AVOID_RADIUS: CIVILIAN_DYNAMIC_AVOID_RADIUS,
        DYNAMIC_AVOID_WEIGHT: CIVILIAN_DYNAMIC_AVOID_WEIGHT, CARRY_AMOUNT: CIVILIAN_CARRY_AMOUNT, PATROL_RECHECK_FRAMES: CIVILIAN_PATROL_RECHECK_FRAMES,
        STUCK_RECOVERY_COOLDOWN_FRAMES: CIVILIAN_STUCK_RECOVERY_COOLDOWN_FRAMES, REROUTE_COOLDOWN_FRAMES: CIVILIAN_REROUTE_COOLDOWN_FRAMES,
        PREEMPTIVE_REROUTE_FRAMES: CIVILIAN_PREEMPTIVE_REROUTE_FRAMES, NO_PROGRESS_FRAMES_THRESHOLD: CIVILIAN_NO_PROGRESS_FRAMES_THRESHOLD,
        MIN_PROGRESS_PER_FRAME: CIVILIAN_MIN_PROGRESS_PER_FRAME, ASSIGNMENTS_PER_FRAME: CIVILIAN_ASSIGNMENTS_PER_FRAME, TARGET_REFRESH_FRAMES: CIVILIAN_TARGET_REFRESH_FRAMES,
        TARGET_GRID_SIZE: CIVILIAN_TARGET_GRID_SIZE, COLLISION_DENSE_THRESHOLD: CIVILIAN_COLLISION_DENSE_THRESHOLD
    } = CIVILIAN_TUNING;

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
    let serverAiDirectives = null;
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

    function createCivilianSprite() {
        const sprite = new PIXI.Graphics();
        sprite.circle(CIVILIAN_RADIUS, CIVILIAN_RADIUS, CIVILIAN_RADIUS);
        sprite.fill(0xffd79a);
        sprite.stroke({ width: 1, color: 0x5c4323 });
        return sprite;
    }

    function rebuildProducerGrid() {
        rebuildProducerGridEntries(producerGrid, buildingSystem, CIVILIAN_TARGET_GRID_SIZE);
    }

    function rebuildWarehouseGrid() {
        rebuildWarehouseGridEntries(warehouseGrid, buildingSystem, CIVILIAN_TARGET_GRID_SIZE);
    }

    function findHouseSpawnPoint(house) {
        return findHouseSpawnPointBase({
            house,
            isTileWalkable,
            spawnFrontOffsetTiles: CIVILIAN_SPAWN_FRONT_OFFSET_TILES,
            isSpawnClear: (x, y) => isCivilianSpawnPositionClear(x, y),
            getBuildingCenter
        });
    }

    function isCivilianSpawnPositionClear(centerX, centerY) {
        return isCivilianSpawnPositionClearBase(
            civilians,
            CIVILIAN_RADIUS,
            CIVILIAN_SEPARATION_PADDING,
            centerX,
            centerY
        );
    }

    function findUnstuckPointForCivilian(originCenter) {
        return findUnstuckPointForCivilianBase({
            originCenter,
            isTileWalkable,
            isSpawnClear: (x, y) => isCivilianSpawnPositionClear(x, y)
        });
    }

    function ensureHouseStates() {
        ensureHouseStatesAdapter({
            houses: buildingSystem.getHouses(),
            houseStates,
            houseTimerLabels,
            civilianLayer,
            civilians,
            HOUSE_SPAWN_INTERVAL_FRAMES
        });
    }

    function updateHouseTimerLabels() {
        updateHouseTimerLabelsAdapter({
            houses: buildingSystem.getHouses(),
            houseStates,
            houseTimerLabels,
            getBuildingCenter,
            TILE_SIZE,
            HOUSE_CIVILIAN_CAP_BONUS
        });
    }

    function getHouseTimerReplication() {
        return getHouseTimerReplicationAdapter(houseStates);
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
            rerouteCooldownFrames: 0,
            noProgressFrames: 0,
            lastDistanceToFinal: 0,
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
        return findNearestProducerWithOutputBase({
            civilian,
            civilianRadius: CIVILIAN_RADIUS,
            producerGrid,
            queryNearbyGridEntries,
            targetGridSize: CIVILIAN_TARGET_GRID_SIZE,
            buildingSystem,
            findBestApproachPoint,
            isTileWalkable,
            perfStats
        });
    }

    function buildProducerLoadMap() {
        return buildProducerLoadMapBase(civilians);
    }

    function getProducerQueueCapacity(producer) {
        return getProducerQueueCapacityBase(producer, getPerimeterTiles, isTileWalkable);
    }

    function getProducerQueuePoint(civilian, producer, queueIndex) {
        return getProducerQueuePointBase({
            civilian,
            civilianRadius: CIVILIAN_RADIUS,
            producer,
            queueIndex,
            findBestApproachPoint,
            isTileWalkable,
            getBuildingCenter
        });
    }

    function findNearestWarehouse(civilian) {
        return findNearestWarehouseBase({
            civilian,
            civilianRadius: CIVILIAN_RADIUS,
            warehouseGrid,
            queryNearbyGridEntries,
            targetGridSize: CIVILIAN_TARGET_GRID_SIZE,
            buildingSystem,
            getBuildingCenter,
            perfStats
        });
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
        civilian.lastDistanceToFinal = dist;
        civilian.noProgressFrames = 0;
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

    function selectBuildingApproachPoint(civilian, building, fromX, fromY, forceAlternate = false) {
        const perimeter = getPerimeterTiles(building, isTileWalkable, 1);
        const candidates = perimeter.length > 0 ? perimeter : getPerimeterTiles(building, isTileWalkable, 2);
        if (candidates.length === 0) {
            return getBuildingCenter(building);
        }

        const previousX = civilian.finalTargetX;
        const previousY = civilian.finalTargetY;
        const ranked = [];
        for (const tile of candidates) {
            const x = tile.x * TILE_SIZE + TILE_SIZE * 0.5;
            const y = tile.y * TILE_SIZE + TILE_SIZE * 0.5;
            const distFrom = Math.hypot(x - fromX, y - fromY);
            const awayFromPrevious = Math.hypot(x - previousX, y - previousY);
            // Force-alternate mode strongly favors another side of the building.
            const score = forceAlternate
                ? (awayFromPrevious * 2.2) - (distFrom * 0.6)
                : (-distFrom) + (awayFromPrevious * 0.12);
            ranked.push({ x, y, score });
        }
        ranked.sort((a, b) => b.score - a.score);
        const window = Math.min(5, ranked.length);
        const pickIndex = Math.abs(civilian.id + civilian.routeSalt + updateFrameIndex) % window;
        return ranked[pickIndex];
    }

    function tryRerouteCivilian(civilian, forceAlternateSide = false) {
        const fromX = civilian.x + CIVILIAN_RADIUS;
        const fromY = civilian.y + CIVILIAN_RADIUS;
        if (civilian.state === 'toProducer' || civilian.state === 'queueProducer') {
            const producer = buildingSystem.getProducers().find((item) => item.id === civilian.targetProducerId);
            if (!producer || producer.storedOutput <= 0) {
                assignIdlePatrol(civilian);
                return true;
            }
            const point = selectBuildingApproachPoint(civilian, producer, fromX, fromY, forceAlternateSide);
            civilian.state = 'toProducer';
            setCivilianTravelTarget(civilian, point.x, point.y, true);
            civilian.routeSalt += 1;
            return true;
        }
        if (civilian.state === 'toWarehouse') {
            const warehouse = buildingSystem.getWarehouses().find((item) => item.id === civilian.targetWarehouseId);
            if (!warehouse) {
                assignIdlePatrol(civilian);
                return true;
            }
            const point = selectBuildingApproachPoint(civilian, warehouse, fromX, fromY, forceAlternateSide);
            setCivilianTravelTarget(civilian, point.x, point.y, true);
            civilian.routeSalt += 1;
            return true;
        }
        if (civilian.state === 'idlePatrol') {
            assignIdlePatrol(civilian);
            return true;
        }
        return false;
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
        const patrolPoint = findBestApproachPoint(anchor, fromX, fromY, civilian.id + (updateFrameIndex * 13), isTileWalkable);
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

        // Dedicated-server AI directives can pin producer/warehouse choices so
        // civilian targeting decisions stay consistent across clients.
        const serverJob = serverAiDirectives?.civilians?.[String(civilian.id)];
        if (serverJob) {
            const directedProducer = buildingSystem.getProducers().find((item) => item.id === Number(serverJob.producerId));
            const directedWarehouse = buildingSystem.getWarehouses().find((item) => item.id === Number(serverJob.warehouseId));
            if (directedProducer && directedWarehouse && directedProducer.storedOutput > 0 && directedProducer.outputResource) {
                const fromX = civilian.x + CIVILIAN_RADIUS;
                const fromY = civilian.y + CIVILIAN_RADIUS;
                const producerCenter = selectBuildingApproachPoint(civilian, directedProducer, fromX, fromY, false);
                civilian.state = 'toProducer';
                civilian.targetProducerId = directedProducer.id;
                civilian.targetWarehouseId = directedWarehouse.id;
                setCivilianTravelTarget(civilian, producerCenter.x, producerCenter.y, true);
                civilian.patrolRecheckFrames = CIVILIAN_PATROL_RECHECK_FRAMES;
                return true;
            }
        }

        const fromX = civilian.x + CIVILIAN_RADIUS;
        const fromY = civilian.y + CIVILIAN_RADIUS;
        let producers = queryNearbyGridEntries(producerGrid, fromX, fromY, CIVILIAN_TARGET_GRID_SIZE);
        if (producers.length === 0) {
            producers = buildingSystem.getProducers();
        }
        const rankedProducers = [];
        for (const producer of producers) {
            if (producer.storedOutput <= 0 || !producer.outputResource) {
                continue;
            }
            const approach = findBestApproachPoint(producer, fromX, fromY, civilian.id, isTileWalkable);
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
            const producerCenter = selectBuildingApproachPoint(civilian, selectedProducer, fromX, fromY, false);
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
        if (civilian.rerouteCooldownFrames > 0) {
            civilian.rerouteCooldownFrames -= 1;
        }
        if (!arrived) {
            const movedX = civilian.x - previousX;
            const movedY = civilian.y - previousY;
            if (movedX * movedX + movedY * movedY < CIVILIAN_STUCK_PROGRESS_EPSILON_SQ) {
                civilian.stuckFrames += 1;
            } else {
                civilian.stuckFrames = 0;
            }
            const centerX = civilian.x + CIVILIAN_RADIUS;
            const centerY = civilian.y + CIVILIAN_RADIUS;
            const distToFinal = Math.hypot(civilian.finalTargetX - centerX, civilian.finalTargetY - centerY);
            const progress = civilian.lastDistanceToFinal - distToFinal;
            civilian.lastDistanceToFinal = distToFinal;
            if (progress < CIVILIAN_MIN_PROGRESS_PER_FRAME) {
                civilian.noProgressFrames += 1;
            } else {
                civilian.noProgressFrames = 0;
            }
            if (civilian.stuckRecoveryCooldownFrames > 0) {
                civilian.stuckRecoveryCooldownFrames -= 1;
            }
            if (
                civilian.rerouteCooldownFrames <= 0 &&
                (civilian.stuckFrames >= CIVILIAN_PREEMPTIVE_REROUTE_FRAMES
                    || civilian.noProgressFrames >= CIVILIAN_NO_PROGRESS_FRAMES_THRESHOLD)
            ) {
                const rerouted = tryRerouteCivilian(civilian, true);
                if (rerouted) {
                    civilian.rerouteCooldownFrames = CIVILIAN_REROUTE_COOLDOWN_FRAMES;
                    civilian.stuckFrames = 0;
                    civilian.noProgressFrames = 0;
                    return;
                }
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
                civilian.noProgressFrames = 0;
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
        civilian.noProgressFrames = 0;

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
            const warehouseCenter = selectBuildingApproachPoint(civilian, warehouse, fromX, fromY, false);
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
        resolveCivilianCollisionsBase({
            civilians,
            isTileWalkable,
            civilianRadius: CIVILIAN_RADIUS,
            separationPadding: CIVILIAN_SEPARATION_PADDING,
            separationPasses: CIVILIAN_SEPARATION_PASSES,
            denseThreshold: CIVILIAN_COLLISION_DENSE_THRESHOLD,
            perfStats
        });
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
        return resolvePlayerCivilianCollision({
            civilians,
            isTileWalkable,
            civilianRadius: CIVILIAN_RADIUS,
            playerCenterX,
            playerCenterY,
            playerRadius,
            applyPlayerPush
        });
    }

    function getStats() {
        const houseCount = buildingSystem.getHouses().length;
        return {
            civilianCount: civilians.length,
            civilianCap: houseCount * HOUSE_CIVILIAN_CAP_BONUS,
            civiliansKilled,
            perf: { ...perfStats }
        };
    }

    function setServerAiDirectives(directives) {
        serverAiDirectives = directives && typeof directives === 'object' ? directives : null;
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
        serverAiDirectives = null;
    }

    function syncReplicatedHouseTimers(entries) {
        syncReplicatedHouseTimersAdapter({
            entries,
            houses: buildingSystem.getHouses(),
            houseTimerLabels,
            civilianLayer,
            getBuildingCenter,
            TILE_SIZE,
            HOUSE_CIVILIAN_CAP_BONUS
        });
    }

    function syncReplicatedState(entries, houseTimerEntries = []) {
        syncReplicatedStateFromSnapshot({
            entries,
            civilians,
            civilianById,
            civilianLayer,
            createCivilianSprite,
            civilianIdCounterRef: {
                get value() {
                    return civilianIdCounter;
                },
                set value(nextValue) {
                    civilianIdCounter = nextValue;
                }
            },
            civilianRadius: CIVILIAN_RADIUS,
            civilianMaxHp: CIVILIAN_MAX_HP,
            syncReplicatedHouseTimers,
            houseTimerEntries
        });
    }

    return {
        update,
        getTargets,
        applyDamage,
        resolvePlayerCollision,
        getStats,
        setServerAiDirectives,
        getHouseTimerReplication,
        syncReplicatedState,
        reset
    };
}
