import * as PIXI from 'pixi.js';
import {
    BASE_RESOURCE_CHANCE,
    FEATURE_REGION_SIZE,
    FEATURE_SEARCH_RADIUS,
    HARVEST_RANGE,
    LOAD_BUFFER,
    RESOURCE_BIOMES,
    RESOURCE_FEATURE_SEARCH_RADIUS,
    RESOURCE_REGION_SIZE,
    RESOURCE_TYPES,
    SPAWN_SAFE_RADIUS_TILES,
    TERRAIN_COLORS,
    TILE_SIZE,
    WATER_FEATURE_CHANCE
} from '../config/constants.js';
import { rand2D } from '../utils/random.js';

export function createWorldSystem({ tileLayer, resourceLayer, getDebugOverlayEnabled }) {
    const tileCache = new Map();
    const tileTypeCache = new Map();
    const waterFeatureCache = new Map();

    const resourceTileTypeCache = new Map();
    const resourceBiomeCache = new Map();
    const harvestedResourceTiles = new Set();
    const resourceNodeCache = new Map();

    function isInSpawnSafeZone(tileX, tileY) {
        return Math.abs(tileX) <= SPAWN_SAFE_RADIUS_TILES && Math.abs(tileY) <= SPAWN_SAFE_RADIUS_TILES;
    }

    function isWaterType(tileType) {
        return tileType === 'ocean' || tileType === 'lake' || tileType === 'river';
    }

    function getWaterFeature(regionX, regionY) {
        const key = `${regionX},${regionY}`;
        if (waterFeatureCache.has(key)) {
            return waterFeatureCache.get(key);
        }

        if (rand2D(regionX, regionY, 1) > WATER_FEATURE_CHANCE) {
            waterFeatureCache.set(key, null);
            return null;
        }

        const centerX = regionX * FEATURE_REGION_SIZE + Math.floor(rand2D(regionX, regionY, 2) * FEATURE_REGION_SIZE);
        const centerY = regionY * FEATURE_REGION_SIZE + Math.floor(rand2D(regionX, regionY, 3) * FEATURE_REGION_SIZE);
        const typeRoll = rand2D(regionX, regionY, 4);

        let feature;
        if (typeRoll < 0.15) {
            const radius = 10 + Math.floor(rand2D(regionX, regionY, 5) * 9);
            feature = { type: 'ocean', centerX, centerY, radius };
        } else if (typeRoll < 0.65) {
            const radius = 3 + Math.floor(rand2D(regionX, regionY, 6) * 3);
            feature = { type: 'lake', centerX, centerY, radius };
        } else {
            const width = 3 + Math.floor(rand2D(regionX, regionY, 7) * 4);
            const targetArea = 220 + Math.floor(rand2D(regionX, regionY, 8) * 281);
            const length = Math.max(30, Math.floor(targetArea / width));
            const angle = rand2D(regionX, regionY, 9) * Math.PI * 2;
            feature = { type: 'river', centerX, centerY, width, length, angle };
        }

        waterFeatureCache.set(key, feature);
        return feature;
    }

    function isTileInsideWaterFeature(tileX, tileY, feature) {
        const dx = tileX - feature.centerX;
        const dy = tileY - feature.centerY;

        if (feature.type === 'ocean' || feature.type === 'lake') {
            return (dx * dx + dy * dy) <= feature.radius * feature.radius;
        }

        const cosA = Math.cos(feature.angle);
        const sinA = Math.sin(feature.angle);
        const localX = dx * cosA + dy * sinA;
        const localY = -dx * sinA + dy * cosA;
        const halfLength = feature.length / 2;
        const radius = feature.width / 2;
        const outsideX = Math.max(Math.abs(localX) - halfLength, 0);
        return (outsideX * outsideX + localY * localY) <= radius * radius;
    }

    function getTileType(tileX, tileY) {
        const key = `${tileX},${tileY}`;
        if (tileTypeCache.has(key)) {
            return tileTypeCache.get(key);
        }

        if (isInSpawnSafeZone(tileX, tileY)) {
            tileTypeCache.set(key, 'grass');
            return 'grass';
        }

        const regionX = Math.floor(tileX / FEATURE_REGION_SIZE);
        const regionY = Math.floor(tileY / FEATURE_REGION_SIZE);
        let resolvedType = 'grass';

        regionSearch:
        for (let ry = regionY - FEATURE_SEARCH_RADIUS; ry <= regionY + FEATURE_SEARCH_RADIUS; ry++) {
            for (let rx = regionX - FEATURE_SEARCH_RADIUS; rx <= regionX + FEATURE_SEARCH_RADIUS; rx++) {
                const feature = getWaterFeature(rx, ry);
                if (!feature || !isTileInsideWaterFeature(tileX, tileY, feature)) {
                    continue;
                }

                if (feature.type === 'ocean') {
                    resolvedType = 'ocean';
                    break regionSearch;
                }
                if (feature.type === 'river' && resolvedType !== 'ocean') {
                    resolvedType = 'river';
                } else if (feature.type === 'lake' && resolvedType === 'grass') {
                    resolvedType = 'lake';
                }
            }
        }

        tileTypeCache.set(key, resolvedType);
        return resolvedType;
    }

    function isTileWater(tileX, tileY) {
        return isWaterType(getTileType(tileX, tileY));
    }

    function buildCandidateTiles(centerX, centerY, radius) {
        const candidates = [];
        const radiusSq = radius * radius;

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx * dx + dy * dy <= radiusSq) {
                    candidates.push({
                        x: centerX + dx,
                        y: centerY + dy
                    });
                }
            }
        }

        return candidates;
    }

    function pickNodeTiles(candidates, count, salt) {
        const ranked = candidates
            .map((tile) => ({
                ...tile,
                rank: rand2D(tile.x, tile.y, salt)
            }))
            .sort((a, b) => a.rank - b.rank);

        return ranked.slice(0, Math.min(count, ranked.length));
    }

    function createResourceBiome(regionX, regionY) {
        const biomeRoll = rand2D(regionX, regionY, 500);
        const mineThreshold = RESOURCE_BIOMES.mine.chance;
        const quarryThreshold = mineThreshold + RESOURCE_BIOMES.quarry.chance;
        const forestThreshold = quarryThreshold + RESOURCE_BIOMES.forest.chance;

        let biomeType = null;
        if (biomeRoll < mineThreshold) {
            biomeType = 'mine';
        } else if (biomeRoll < quarryThreshold) {
            biomeType = 'quarry';
        } else if (biomeRoll < forestThreshold) {
            biomeType = 'forest';
        } else {
            return null;
        }

        const centerX = regionX * RESOURCE_REGION_SIZE + Math.floor(rand2D(regionX, regionY, 501) * RESOURCE_REGION_SIZE);
        const centerY = regionY * RESOURCE_REGION_SIZE + Math.floor(rand2D(regionX, regionY, 502) * RESOURCE_REGION_SIZE);
        const nodes = new Map();

        if (biomeType === 'forest') {
            const cfg = RESOURCE_BIOMES.forest;
            const count = cfg.minNodes + Math.floor(rand2D(regionX, regionY, 503) * (cfg.maxNodes - cfg.minNodes + 1));
            const candidates = buildCandidateTiles(centerX, centerY, cfg.radius);
            const selected = pickNodeTiles(candidates, count, 504);
            for (const tile of selected) {
                nodes.set(`${tile.x},${tile.y}`, 'wood');
            }
        } else if (biomeType === 'quarry') {
            const cfg = RESOURCE_BIOMES.quarry;
            const count = cfg.minNodes + Math.floor(rand2D(regionX, regionY, 505) * (cfg.maxNodes - cfg.minNodes + 1));
            const candidates = buildCandidateTiles(centerX, centerY, cfg.radius);
            const selected = pickNodeTiles(candidates, count, 506);
            for (const tile of selected) {
                const ironRoll = rand2D(tile.x, tile.y, 507);
                const resourceType = ironRoll < cfg.ironChance ? 'iron' : 'stone';
                nodes.set(`${tile.x},${tile.y}`, resourceType);
            }
        } else if (biomeType === 'mine') {
            const cfg = RESOURCE_BIOMES.mine;
            const candidates = buildCandidateTiles(centerX, centerY, cfg.radius);
            const selected = pickNodeTiles(candidates, cfg.nodeCount, 508);
            for (const tile of selected) {
                nodes.set(`${tile.x},${tile.y}`, 'iron');
            }
        }

        return { type: biomeType, centerX, centerY, nodes };
    }

    function getResourceBiome(regionX, regionY) {
        const key = `${regionX},${regionY}`;
        if (resourceBiomeCache.has(key)) {
            return resourceBiomeCache.get(key);
        }

        const biome = createResourceBiome(regionX, regionY);
        resourceBiomeCache.set(key, biome);
        return biome;
    }

    function chooseBaseResourceType(tileX, tileY) {
        const roll = rand2D(tileX, tileY, 520);
        const woodThreshold = RESOURCE_TYPES.wood.weight;
        const stoneThreshold = woodThreshold + RESOURCE_TYPES.stone.weight;

        if (roll < woodThreshold) {
            return 'wood';
        }
        if (roll < stoneThreshold) {
            return 'stone';
        }
        return 'iron';
    }

    function getResourceTypeAtTile(tileX, tileY) {
        const key = `${tileX},${tileY}`;
        if (resourceTileTypeCache.has(key)) {
            return resourceTileTypeCache.get(key);
        }

        if (harvestedResourceTiles.has(key) || isTileWater(tileX, tileY)) {
            resourceTileTypeCache.set(key, null);
            return null;
        }

        const regionX = Math.floor(tileX / RESOURCE_REGION_SIZE);
        const regionY = Math.floor(tileY / RESOURCE_REGION_SIZE);

        for (let ry = regionY - RESOURCE_FEATURE_SEARCH_RADIUS; ry <= regionY + RESOURCE_FEATURE_SEARCH_RADIUS; ry++) {
            for (let rx = regionX - RESOURCE_FEATURE_SEARCH_RADIUS; rx <= regionX + RESOURCE_FEATURE_SEARCH_RADIUS; rx++) {
                const biome = getResourceBiome(rx, ry);
                if (!biome) {
                    continue;
                }

                const biomeResource = biome.nodes.get(key);
                if (biomeResource) {
                    resourceTileTypeCache.set(key, biomeResource);
                    return biomeResource;
                }
            }
        }

        if (rand2D(tileX, tileY, 521) < BASE_RESOURCE_CHANCE) {
            const baseResource = chooseBaseResourceType(tileX, tileY);
            resourceTileTypeCache.set(key, baseResource);
            return baseResource;
        }

        resourceTileTypeCache.set(key, null);
        return null;
    }

    function drawTileGraphic(tileGraphic, fillColor) {
        tileGraphic.clear();
        tileGraphic.rect(0, 0, TILE_SIZE, TILE_SIZE);
        tileGraphic.fill(fillColor);
        if (getDebugOverlayEnabled()) {
            tileGraphic.stroke({ width: 1, color: 0x000000 });
        }
    }

    function createTileAt(tileX, tileY) {
        const tileType = getTileType(tileX, tileY);
        const color = TERRAIN_COLORS[tileType] ?? TERRAIN_COLORS.grass;

        const tile = new PIXI.Graphics();
        drawTileGraphic(tile, color);
        tile.position.set(tileX * TILE_SIZE, tileY * TILE_SIZE);
        return tile;
    }

    function createResourceNode(resourceType, tileX, tileY) {
        const node = new PIXI.Graphics();
        const color = RESOURCE_TYPES[resourceType].color;

        node.rect(6, 6, 20, 20);
        node.fill(color);
        node.stroke({ width: 1, color: 0x111111 });
        node.position.set(tileX * TILE_SIZE, tileY * TILE_SIZE);
        return node;
    }

    function refreshVisibleTileGridlines() {
        for (const [key, tileGraphic] of tileCache) {
            const [tileX, tileY] = key.split(',').map(Number);
            const tileType = getTileType(tileX, tileY);
            const color = TERRAIN_COLORS[tileType] ?? TERRAIN_COLORS.grass;
            drawTileGraphic(tileGraphic, color);
        }
    }

    function updateTiles({ worldPositionX, worldPositionY, screenWidth, screenHeight }) {
        const tilesAcross = Math.ceil(screenWidth / TILE_SIZE) + 2;
        const tilesDown = Math.ceil(screenHeight / TILE_SIZE) + 2;

        const startTileX = Math.floor(-worldPositionX / TILE_SIZE) - LOAD_BUFFER;
        const startTileY = Math.floor(-worldPositionY / TILE_SIZE) - LOAD_BUFFER;
        const endTileX = startTileX + tilesAcross + LOAD_BUFFER;
        const endTileY = startTileY + tilesDown + LOAD_BUFFER;

        for (let y = startTileY; y < endTileY; y++) {
            for (let x = startTileX; x < endTileX; x++) {
                const key = `${x},${y}`;
                if (!tileCache.has(key)) {
                    const tile = createTileAt(x, y);
                    tileLayer.addChild(tile);
                    tileCache.set(key, tile);
                }
            }
        }

        for (let y = startTileY; y < endTileY; y++) {
            for (let x = startTileX; x < endTileX; x++) {
                const key = `${x},${y}`;
                if (resourceNodeCache.has(key)) {
                    continue;
                }

                const resourceType = getResourceTypeAtTile(x, y);
                if (!resourceType) {
                    continue;
                }

                const resourceNode = createResourceNode(resourceType, x, y);
                resourceLayer.addChild(resourceNode);
                resourceNodeCache.set(key, resourceNode);
            }
        }

        const cleanupDistance = LOAD_BUFFER + 5;

        for (const [key, tile] of tileCache) {
            const [x, y] = key.split(',').map(Number);
            if (x < startTileX - cleanupDistance ||
                x > endTileX + cleanupDistance ||
                y < startTileY - cleanupDistance ||
                y > endTileY + cleanupDistance) {
                tile.destroy();
                tileCache.delete(key);
                tileTypeCache.delete(key);
                resourceTileTypeCache.delete(key);
            }
        }

        for (const [key, node] of resourceNodeCache) {
            const [x, y] = key.split(',').map(Number);
            if (x < startTileX - cleanupDistance ||
                x > endTileX + cleanupDistance ||
                y < startTileY - cleanupDistance ||
                y > endTileY + cleanupDistance) {
                node.destroy();
                resourceNodeCache.delete(key);
                resourceTileTypeCache.delete(key);
            }
        }
    }

    function tryHarvestNearest(playerCenterX, playerCenterY) {
        const centerTileX = Math.floor(playerCenterX / TILE_SIZE);
        const centerTileY = Math.floor(playerCenterY / TILE_SIZE);
        const searchRadiusTiles = 2;

        let bestKey = null;
        let bestTileX = 0;
        let bestTileY = 0;
        let bestResourceType = null;
        let bestDistanceSq = HARVEST_RANGE * HARVEST_RANGE;

        for (let y = centerTileY - searchRadiusTiles; y <= centerTileY + searchRadiusTiles; y++) {
            for (let x = centerTileX - searchRadiusTiles; x <= centerTileX + searchRadiusTiles; x++) {
                const key = `${x},${y}`;
                if (harvestedResourceTiles.has(key)) {
                    continue;
                }
                const resourceType = getResourceTypeAtTile(x, y);
                if (!resourceType) {
                    continue;
                }

                const nodeCenterX = x * TILE_SIZE + TILE_SIZE / 2;
                const nodeCenterY = y * TILE_SIZE + TILE_SIZE / 2;
                const dx = nodeCenterX - playerCenterX;
                const dy = nodeCenterY - playerCenterY;
                const distSq = dx * dx + dy * dy;

                if (distSq <= bestDistanceSq) {
                    bestDistanceSq = distSq;
                    bestKey = key;
                    bestTileX = x;
                    bestTileY = y;
                    bestResourceType = resourceType;
                }
            }
        }

        if (!bestKey || !bestResourceType) {
            return null;
        }

        const node = resourceNodeCache.get(bestKey);
        if (node) {
            node.destroy();
            resourceNodeCache.delete(bestKey);
        }
        harvestedResourceTiles.add(bestKey);
        resourceTileTypeCache.set(bestKey, null);
        return { resourceType: bestResourceType, tileX: bestTileX, tileY: bestTileY };
    }

    function getStats() {
        return {
            tilesCached: tileCache.size,
            resourcesActive: resourceNodeCache.size,
            waterFeatureRegions: waterFeatureCache.size
        };
    }

    // Full map reset used on game restart after player death.
    function reset() {
        for (const [, tile] of tileCache) {
            tile.destroy();
        }
        for (const [, node] of resourceNodeCache) {
            node.destroy();
        }
        tileCache.clear();
        tileTypeCache.clear();
        waterFeatureCache.clear();
        resourceTileTypeCache.clear();
        resourceBiomeCache.clear();
        harvestedResourceTiles.clear();
        resourceNodeCache.clear();
    }

    function exportState() {
        return {
            harvestedResourceTiles: [...harvestedResourceTiles]
        };
    }

    function importState(state) {
        if (!state || !Array.isArray(state.harvestedResourceTiles)) {
            return;
        }
        for (const key of state.harvestedResourceTiles) {
            if (typeof key !== 'string') {
                continue;
            }
            harvestedResourceTiles.add(key);
            resourceTileTypeCache.set(key, null);
            const node = resourceNodeCache.get(key);
            if (node) {
                node.destroy();
                resourceNodeCache.delete(key);
            }
        }
    }

    return {
        isTileWater,
        isTileWalkable: (tileX, tileY) => !isTileWater(tileX, tileY),
        refreshVisibleTileGridlines,
        updateTiles,
        tryHarvestNearest,
        exportState,
        importState,
        getStats,
        reset
    };
}
