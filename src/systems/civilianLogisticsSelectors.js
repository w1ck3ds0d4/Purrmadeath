import { TILE_SIZE } from '../config/constants.js';

// Producer/warehouse selector helpers for civilian job assignment.
// Extracted to keep the civilian runtime state machine easier to navigate.
export function findNearestProducerWithOutput(args) {
    const {
        civilian,
        civilianRadius,
        producerGrid,
        queryNearbyGridEntries,
        targetGridSize,
        buildingSystem,
        findBestApproachPoint,
        isTileWalkable,
        perfStats
    } = args;
    perfStats.producerQueries += 1;
    const fromX = civilian.x + civilianRadius;
    const fromY = civilian.y + civilianRadius;
    let producers = queryNearbyGridEntries(producerGrid, fromX, fromY, targetGridSize);
    if (producers.length === 0) {
        producers = buildingSystem.getProducers();
    }
    let best = null;
    let bestScore = -Infinity;
    for (const producer of producers) {
        if (producer.storedOutput <= 0 || !producer.outputResource) {
            continue;
        }
        // Prioritize camps with more output and only use distance as a tie-break.
        const approach = findBestApproachPoint(producer, fromX, fromY, civilian.id, isTileWalkable);
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

export function buildProducerLoadMap(civilians) {
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

export function getProducerQueueCapacity(producer, getPerimeterTiles, isTileWalkable) {
    const perimeterCount = getPerimeterTiles(producer, isTileWalkable, 1).length;
    return Math.max(1, Math.min(4, Math.floor(perimeterCount / 3) || 2));
}

export function getProducerQueuePoint(args) {
    const {
        civilian,
        civilianRadius,
        producer,
        queueIndex,
        findBestApproachPoint,
        isTileWalkable,
        getBuildingCenter
    } = args;
    const fromX = civilian.x + civilianRadius;
    const fromY = civilian.y + civilianRadius;
    const approach = findBestApproachPoint(producer, fromX, fromY, civilian.id + queueIndex * 29, isTileWalkable);
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

export function findNearestWarehouse(args) {
    const {
        civilian,
        civilianRadius,
        warehouseGrid,
        queryNearbyGridEntries,
        targetGridSize,
        buildingSystem,
        getBuildingCenter,
        perfStats
    } = args;
    perfStats.warehouseQueries += 1;
    const fromX = civilian.x + civilianRadius;
    const fromY = civilian.y + civilianRadius;
    let warehouses = queryNearbyGridEntries(warehouseGrid, fromX, fromY, targetGridSize);
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
