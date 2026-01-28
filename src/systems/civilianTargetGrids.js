import { getBuildingCenter, pushToTargetGrid } from './civilianSpatialUtils.js';

// Grid builders for producer/warehouse target lookup.
export function rebuildProducerGridEntries(producerGrid, buildingSystem, targetGridSize) {
    producerGrid.clear();
    const producers = buildingSystem.getProducers();
    for (const producer of producers) {
        if (producer.storedOutput <= 0 || !producer.outputResource) {
            continue;
        }
        const center = getBuildingCenter(producer);
        pushToTargetGrid(producerGrid, center.x, center.y, producer, targetGridSize);
    }
}

export function rebuildWarehouseGridEntries(warehouseGrid, buildingSystem, targetGridSize) {
    warehouseGrid.clear();
    const warehouses = buildingSystem.getWarehouses();
    for (const warehouse of warehouses) {
        const center = getBuildingCenter(warehouse);
        pushToTargetGrid(warehouseGrid, center.x, center.y, warehouse, targetGridSize);
    }
}

