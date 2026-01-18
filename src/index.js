import * as PIXI from 'pixi.js';

// Fast deterministic random in [0, 1] from integer coordinates + salt.
function rand2D(x, y, salt = 0) {
    let n = Math.imul(x ^ (salt * 374761393), 668265263) ^ Math.imul(y ^ (salt * 1274126177), 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

async function init() {
    const app = new PIXI.Application();
    await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x1a1a1a
    });

    document.body.appendChild(app.canvas);

    const world = new PIXI.Container();
    app.stage.addChild(world);

    const tileLayer = new PIXI.Container();
    const resourceLayer = new PIXI.Container();
    world.addChild(tileLayer);
    world.addChild(resourceLayer);

    const TILE_SIZE = 32;
    const LOAD_BUFFER = 3;
    const SPAWN_SAFE_RADIUS_TILES = 50;

    const TERRAIN_COLORS = {
        grass: 0x2d5016,
        ocean: 0x0d2a4b,
        lake: 0x245a8d,
        river: 0x3d7fb8
    };

    const FEATURE_REGION_SIZE = 40;
    const FEATURE_SEARCH_RADIUS = 2;
    const WATER_FEATURE_CHANCE = 0.45;

    const RESOURCE_REGION_SIZE = 64;
    const RESOURCE_FEATURE_SEARCH_RADIUS = 1;
    const BASE_RESOURCE_CHANCE = 0.004;
    const HARVEST_RANGE = 40;

    // New resource types can be added here later without changing core logic.
    const RESOURCE_TYPES = {
        wood: { color: 0x1d5b2a, weight: 0.55 },
        stone: { color: 0x7f7f7f, weight: 0.35 },
        iron: { color: 0xffffff, weight: 0.10 }
    };

    const RESOURCE_BIOMES = {
        forest: {
            chance: 0.10,
            minNodes: 50,
            maxNodes: 80,
            radius: 7
        },
        quarry: {
            chance: 0.03,
            minNodes: 50,
            maxNodes: 70,
            radius: 7,
            ironChance: 0.14
        },
        mine: {
            chance: 0.02,
            nodeCount: 15,
            radius: 4
        }
    };

    const tileCache = new Map();
    const tileTypeCache = new Map();
    const waterFeatureCache = new Map();

    const resourceTileTypeCache = new Map();
    const resourceBiomeCache = new Map();
    const harvestedResourceTiles = new Set();
    const resourceNodeCache = new Map();

    const inventory = {
        wood: 0,
        stone: 0,
        iron: 0
    };
    const floatingTexts = [];

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

    function createTileAt(tileX, tileY) {
        const tileType = getTileType(tileX, tileY);
        const color = TERRAIN_COLORS[tileType] ?? TERRAIN_COLORS.grass;

        const tile = new PIXI.Graphics();
        tile.rect(0, 0, TILE_SIZE, TILE_SIZE);
        tile.fill(color);
        tile.stroke({ width: 1, color: 0x000000 });
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

    function updateTiles() {
        const screenCenterX = world.position.x;
        const screenCenterY = world.position.y;

        const tilesAcross = Math.ceil(window.innerWidth / TILE_SIZE) + 2;
        const tilesDown = Math.ceil(window.innerHeight / TILE_SIZE) + 2;

        const startTileX = Math.floor(-screenCenterX / TILE_SIZE) - LOAD_BUFFER;
        const startTileY = Math.floor(-screenCenterY / TILE_SIZE) - LOAD_BUFFER;
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

    function findSafeSpawnPosition() {
        return { x: TILE_SIZE / 2, y: TILE_SIZE / 2 };
    }

    function createPlayerSprite() {
        const sprite = new PIXI.Graphics();
        sprite.rect(0, 0, 32, 32);
        sprite.fill(0xff6b6b);
        return sprite;
    }

    const player = createPlayerSprite();
    player.position.set(window.innerWidth / 2 - 16, window.innerHeight / 2 - 16);
    app.stage.addChild(player);

    const hudText = new PIXI.Text({
        text: '',
        style: {
            fill: '#ffffff',
            fontFamily: 'monospace',
            fontSize: 18
        }
    });
    hudText.position.set(16, 16);
    app.stage.addChild(hudText);

    function updateHud() {
        hudText.text = `Wood: ${inventory.wood}\nStone: ${inventory.stone}\nIron: ${inventory.iron}`;
    }

    function spawnHarvestFeedback(resourceType, tileX, tileY) {
        const text = new PIXI.Text({
            text: `+1 ${resourceType}`,
            style: {
                fill: '#ffffff',
                fontFamily: 'monospace',
                fontSize: 14
            }
        });

        text.anchor.set(0.5);
        text.position.set(tileX * TILE_SIZE + TILE_SIZE / 2, tileY * TILE_SIZE + 6);
        resourceLayer.addChild(text);
        floatingTexts.push({
            sprite: text,
            ttl: 75 // Frames to keep harvest text visible.
        });
    }

    const spawnWorldPos = findSafeSpawnPosition();
    let playerWorldX = spawnWorldPos.x;
    let playerWorldY = spawnWorldPos.y;

    const keys = {};
    const SPEED = 200;
    let harvestRequested = false;

    updateHud();
    updateTiles();

    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        keys[key] = true;
        if (key === 'e') {
            harvestRequested = true;
        }
    });

    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });

    app.ticker.add((delta) => {
        const moveDistance = SPEED * delta.deltaTime / 60;
        let newWorldX = playerWorldX;
        let newWorldY = playerWorldY;

        if (keys.w || keys.arrowup) {
            newWorldY -= moveDistance;
        }
        if (keys.s || keys.arrowdown) {
            newWorldY += moveDistance;
        }
        if (keys.a || keys.arrowleft) {
            newWorldX -= moveDistance;
        }
        if (keys.d || keys.arrowright) {
            newWorldX += moveDistance;
        }

        const centerX = newWorldX + TILE_SIZE / 2;
        const centerY = newWorldY + TILE_SIZE / 2;
        const tileX = Math.floor(centerX / TILE_SIZE);
        const tileY = Math.floor(centerY / TILE_SIZE);

        if (!isTileWater(tileX, tileY)) {
            playerWorldX = newWorldX;
            playerWorldY = newWorldY;
        }

        world.position.x = window.innerWidth / 2 - playerWorldX - 16;
        world.position.y = window.innerHeight / 2 - playerWorldY - 16;

        updateTiles();

        if (harvestRequested) {
            harvestRequested = false;

            const playerCenterX = playerWorldX + TILE_SIZE / 2;
            const playerCenterY = playerWorldY + TILE_SIZE / 2;
            const centerTileX = Math.floor(playerCenterX / TILE_SIZE);
            const centerTileY = Math.floor(playerCenterY / TILE_SIZE);
            const searchRadiusTiles = 2;

            let bestKey = null;
            let bestDistanceSq = HARVEST_RANGE * HARVEST_RANGE;

            for (let y = centerTileY - searchRadiusTiles; y <= centerTileY + searchRadiusTiles; y++) {
                for (let x = centerTileX - searchRadiusTiles; x <= centerTileX + searchRadiusTiles; x++) {
                    const key = `${x},${y}`;
                    const resourceNode = resourceNodeCache.get(key);
                    if (!resourceNode) {
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
                    }
                }
            }

            if (bestKey) {
                const node = resourceNodeCache.get(bestKey);
                const resourceType = resourceTileTypeCache.get(bestKey);

                if (node && resourceType && inventory[resourceType] !== undefined) {
                    const [harvestTileX, harvestTileY] = bestKey.split(',').map(Number);
                    node.destroy();
                    resourceNodeCache.delete(bestKey);
                    harvestedResourceTiles.add(bestKey);
                    resourceTileTypeCache.set(bestKey, null);
                    inventory[resourceType] += 1;
                    spawnHarvestFeedback(resourceType, harvestTileX, harvestTileY);
                    updateHud();
                }
            }
        }

        // Lightweight floating text update for harvest feedback.
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            const entry = floatingTexts[i];
            entry.ttl -= 1;
            entry.sprite.y -= 0.4;
            entry.sprite.alpha = Math.max(0, entry.ttl / 75);

            if (entry.ttl <= 0) {
                entry.sprite.destroy();
                floatingTexts.splice(i, 1);
            }
        }
    });

    window.addEventListener('resize', () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        updateTiles();
    });

    console.log('Purrmadeath initialized');
}

init();
