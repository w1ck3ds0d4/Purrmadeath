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
    const enemyLayer = new PIXI.Container();
    world.addChild(tileLayer);
    world.addChild(resourceLayer);
    world.addChild(enemyLayer);

    const TILE_SIZE = 32;
    const LOAD_BUFFER = 3;
    const SPAWN_SAFE_RADIUS_TILES = 50;

    const TERRAIN_COLORS = {
        grass: 0x2d5016,
        ocean: 0x0d2a4b,
        lake: 0x245a8d,
        river: 0x3d7fb8
    };

    // Terrain tuning knobs:
    // - Increase WATER_FEATURE_CHANCE to generate more water overall.
    // - Decrease it to generate more grass land.
    const FEATURE_REGION_SIZE = 40;
    const FEATURE_SEARCH_RADIUS = 2;
    const WATER_FEATURE_CHANCE = 0.45;

    // Resource tuning knobs:
    // - Increase BASE_RESOURCE_CHANCE for more scattered resources outside biomes.
    // - Increase HARVEST_RANGE to make collecting easier.
    const RESOURCE_REGION_SIZE = 64;
    const RESOURCE_FEATURE_SEARCH_RADIUS = 1;
    const BASE_RESOURCE_CHANCE = 0.004;
    const HARVEST_RANGE = 40;

    // Enemy tuning knobs:
    // - ENEMY_MAX_COUNT controls max simultaneous enemies.
    // - Lower ENEMY_SPAWN_INTERVAL_FRAMES for faster spawning.
    // - Increase ENEMY_SPEED for more aggressive enemies.
    // - ENEMY_MAX_REPATHS_PER_FRAME limits A* workload per frame.
    const ENEMY_SIZE = 24;
    const ENEMY_RADIUS = ENEMY_SIZE / 2;
    const PLAYER_COLLISION_RADIUS = 16;
    const ENEMY_SPEED = 90;
    const ENEMY_MAX_COUNT = 100;
    const ENEMY_SPAWN_INTERVAL_FRAMES = 30;
    const ENEMY_OFFSCREEN_MARGIN_TILES = 4;
    const ENEMY_MIN_PLAYER_DISTANCE_TILES = 8;
    const ENEMY_DESPAWN_DISTANCE_TILES = 95;
    const ENEMY_REPATH_INTERVAL_FRAMES = 30;
    const ENEMY_PATH_GRID_RADIUS = 18;
    const ENEMY_PATH_MAX_STEPS = 900;
    const ENEMY_MAX_REPATHS_PER_FRAME = 8;

    // New resource types can be added here later without changing core logic.
    const RESOURCE_TYPES = {
        wood: { color: 0x1d5b2a, weight: 0.55 },
        stone: { color: 0x7f7f7f, weight: 0.35 },
        iron: { color: 0xffffff, weight: 0.10 }
    };

    const RESOURCE_BIOMES = {
        forest: {
            // Chance that a resource region becomes a forest biome.
            chance: 0.10,
            minNodes: 50,
            maxNodes: 80,
            radius: 7
        },
        quarry: {
            // Chance that a resource region becomes a quarry biome.
            chance: 0.03,
            minNodes: 50,
            maxNodes: 70,
            radius: 7,
            // Increase to make quarries produce more iron.
            ironChance: 0.14
        },
        mine: {
            // Chance that a resource region becomes a mine biome.
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
    const enemies = [];
    let enemySpawnTimer = 0;
    let enemyIdCounter = 0;
    let playerHitFlashFrames = 0;
    let framePathRequests = 0;
    let framePathExecuted = 0;
    let framePathDeferred = 0;
    let framePathBudget = 0;
    const debugLogs = [];
    let debugOverlayEnabled = false;
    let smoothedFps = 60;

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
        drawTileGraphic(tile, color);
        tile.position.set(tileX * TILE_SIZE, tileY * TILE_SIZE);
        return tile;
    }

    function drawTileGraphic(tileGraphic, fillColor) {
        tileGraphic.clear();
        tileGraphic.rect(0, 0, TILE_SIZE, TILE_SIZE);
        tileGraphic.fill(fillColor);
        // Gridlines are debug-only and shown only with the dev overlay.
        if (debugOverlayEnabled) {
            tileGraphic.stroke({ width: 1, color: 0x000000 });
        }
    }

    function refreshVisibleTileGridlines() {
        for (const [key, tileGraphic] of tileCache) {
            const [tileX, tileY] = key.split(',').map(Number);
            const tileType = getTileType(tileX, tileY);
            const color = TERRAIN_COLORS[tileType] ?? TERRAIN_COLORS.grass;
            drawTileGraphic(tileGraphic, color);
        }
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

    function createEnemySprite() {
        const sprite = new PIXI.Graphics();
        sprite.circle(ENEMY_RADIUS, ENEMY_RADIUS, ENEMY_RADIUS);
        sprite.fill(0x8f1f1f);
        sprite.stroke({ width: 1, color: 0x220808 });
        return sprite;
    }

    function isTileWalkable(tileX, tileY) {
        return !isTileWater(tileX, tileY);
    }

    function estimatePathCost(ax, ay, bx, by) {
        return Math.abs(ax - bx) + Math.abs(ay - by);
    }

    function reconstructPath(cameFrom, endKey) {
        const path = [];
        let currentKey = endKey;
        while (currentKey) {
            const [x, y] = currentKey.split(',').map(Number);
            path.push({ x, y });
            currentKey = cameFrom.get(currentKey);
        }
        path.reverse();
        // Skip current tile so enemies move toward the next point.
        return path.slice(1);
    }

    function findPathAStar(startX, startY, goalX, goalY) {
        if (startX === goalX && startY === goalY) {
            return [];
        }

        const minX = Math.min(startX, goalX) - ENEMY_PATH_GRID_RADIUS;
        const maxX = Math.max(startX, goalX) + ENEMY_PATH_GRID_RADIUS;
        const minY = Math.min(startY, goalY) - ENEMY_PATH_GRID_RADIUS;
        const maxY = Math.max(startY, goalY) + ENEMY_PATH_GRID_RADIUS;

        const startKey = `${startX},${startY}`;
        const goalKey = `${goalX},${goalY}`;

        const open = [{ key: startKey, x: startX, y: startY, f: estimatePathCost(startX, startY, goalX, goalY) }];
        const openKeys = new Set([startKey]);
        const closedKeys = new Set();
        const cameFrom = new Map();
        const gScore = new Map([[startKey, 0]]);

        let steps = 0;
        while (open.length > 0 && steps < ENEMY_PATH_MAX_STEPS) {
            steps += 1;

            let bestIdx = 0;
            for (let i = 1; i < open.length; i++) {
                if (open[i].f < open[bestIdx].f) {
                    bestIdx = i;
                }
            }

            const current = open.splice(bestIdx, 1)[0];
            openKeys.delete(current.key);

            if (current.key === goalKey) {
                return reconstructPath(cameFrom, current.key);
            }

            closedKeys.add(current.key);

            const neighbors = [
                { x: current.x + 1, y: current.y, cost: 1, diagonal: false },
                { x: current.x - 1, y: current.y, cost: 1, diagonal: false },
                { x: current.x, y: current.y + 1, cost: 1, diagonal: false },
                { x: current.x, y: current.y - 1, cost: 1, diagonal: false },
                { x: current.x + 1, y: current.y + 1, cost: Math.SQRT2, diagonal: true },
                { x: current.x + 1, y: current.y - 1, cost: Math.SQRT2, diagonal: true },
                { x: current.x - 1, y: current.y + 1, cost: Math.SQRT2, diagonal: true },
                { x: current.x - 1, y: current.y - 1, cost: Math.SQRT2, diagonal: true }
            ];

            for (const neighbor of neighbors) {
                if (neighbor.x < minX || neighbor.x > maxX || neighbor.y < minY || neighbor.y > maxY) {
                    continue;
                }
                // Prevent diagonal corner-cutting through blocked water edges.
                if (neighbor.diagonal) {
                    if (!isTileWalkable(current.x, neighbor.y) || !isTileWalkable(neighbor.x, current.y)) {
                        continue;
                    }
                }
                if (!isTileWalkable(neighbor.x, neighbor.y)) {
                    continue;
                }

                const neighborKey = `${neighbor.x},${neighbor.y}`;
                if (closedKeys.has(neighborKey)) {
                    continue;
                }

                const tentativeG = (gScore.get(current.key) ?? Infinity) + neighbor.cost;
                if (tentativeG >= (gScore.get(neighborKey) ?? Infinity)) {
                    continue;
                }

                cameFrom.set(neighborKey, current.key);
                gScore.set(neighborKey, tentativeG);
                const fScore = tentativeG + estimatePathCost(neighbor.x, neighbor.y, goalX, goalY);

                if (!openKeys.has(neighborKey)) {
                    open.push({
                        key: neighborKey,
                        x: neighbor.x,
                        y: neighbor.y,
                        f: fScore
                    });
                    openKeys.add(neighborKey);
                } else {
                    for (const node of open) {
                        if (node.key === neighborKey) {
                            node.f = fScore;
                            break;
                        }
                    }
                }
            }
        }

        return [];
    }

    function getViewTileBounds() {
        const startTileX = Math.floor(-world.position.x / TILE_SIZE);
        const startTileY = Math.floor(-world.position.y / TILE_SIZE);
        const endTileX = startTileX + Math.ceil(window.innerWidth / TILE_SIZE);
        const endTileY = startTileY + Math.ceil(window.innerHeight / TILE_SIZE);
        return { startTileX, startTileY, endTileX, endTileY };
    }

    function isTileInView(tileX, tileY, bounds) {
        return tileX >= bounds.startTileX && tileX <= bounds.endTileX && tileY >= bounds.startTileY && tileY <= bounds.endTileY;
    }

    function tryGetOffscreenSpawnTile() {
        const bounds = getViewTileBounds();
        const margin = ENEMY_OFFSCREEN_MARGIN_TILES;
        const minX = bounds.startTileX - margin;
        const maxX = bounds.endTileX + margin;
        const minY = bounds.startTileY - margin;
        const maxY = bounds.endTileY + margin;
        const playerTileX = Math.floor((playerWorldX + TILE_SIZE / 2) / TILE_SIZE);
        const playerTileY = Math.floor((playerWorldY + TILE_SIZE / 2) / TILE_SIZE);

        for (let attempt = 0; attempt < 24; attempt++) {
            const side = Math.floor(Math.random() * 4);
            let tileX;
            let tileY;

            if (side === 0) { // top
                tileX = minX + Math.floor(Math.random() * (maxX - minX + 1));
                tileY = minY;
            } else if (side === 1) { // bottom
                tileX = minX + Math.floor(Math.random() * (maxX - minX + 1));
                tileY = maxY;
            } else if (side === 2) { // left
                tileX = minX;
                tileY = minY + Math.floor(Math.random() * (maxY - minY + 1));
            } else { // right
                tileX = maxX;
                tileY = minY + Math.floor(Math.random() * (maxY - minY + 1));
            }

            if (isTileInView(tileX, tileY, bounds)) {
                continue;
            }
            if (!isTileWalkable(tileX, tileY)) {
                continue;
            }

            const dx = tileX - playerTileX;
            const dy = tileY - playerTileY;
            if ((dx * dx + dy * dy) < ENEMY_MIN_PLAYER_DISTANCE_TILES * ENEMY_MIN_PLAYER_DISTANCE_TILES) {
                continue;
            }

            return { x: tileX, y: tileY };
        }

        return null;
    }

    function spawnEnemyAtTile(tileX, tileY) {
        const sprite = createEnemySprite();
        const enemy = {
            id: enemyIdCounter++,
            x: tileX * TILE_SIZE + (TILE_SIZE - ENEMY_SIZE) / 2,
            y: tileY * TILE_SIZE + (TILE_SIZE - ENEMY_SIZE) / 2,
            path: [],
            pathIndex: 0,
            repathTimer: 0,
            hitCooldown: 0
        };
        sprite.position.set(enemy.x, enemy.y);
        enemyLayer.addChild(sprite);
        enemy.sprite = sprite;
        enemies.push(enemy);
    }

    function removeEnemyAt(index) {
        const enemy = enemies[index];
        enemy.sprite.destroy();
        enemies.splice(index, 1);
    }

    function resolveEnemyCollisions() {
        const minDistance = ENEMY_RADIUS * 2;
        const minDistanceSq = minDistance * minDistance;

        for (let i = 0; i < enemies.length; i++) {
            for (let j = i + 1; j < enemies.length; j++) {
                const a = enemies[i];
                const b = enemies[j];

                const ax = a.x + ENEMY_RADIUS;
                const ay = a.y + ENEMY_RADIUS;
                const bx = b.x + ENEMY_RADIUS;
                const by = b.y + ENEMY_RADIUS;

                let dx = bx - ax;
                let dy = by - ay;
                let distSq = dx * dx + dy * dy;

                if (distSq >= minDistanceSq) {
                    continue;
                }

                // If centers fully overlap, use a deterministic tiny direction.
                if (distSq < 0.0001) {
                    const angle = (a.id * 0.37 + b.id * 0.73) % (Math.PI * 2);
                    dx = Math.cos(angle);
                    dy = Math.sin(angle);
                    distSq = 1;
                }

                const dist = Math.sqrt(distSq);
                const overlap = minDistance - dist;
                const nx = dx / dist;
                const ny = dy / dist;
                const halfPushX = nx * overlap * 0.5;
                const halfPushY = ny * overlap * 0.5;

                const newAX = a.x - halfPushX;
                const newAY = a.y - halfPushY;
                const newBX = b.x + halfPushX;
                const newBY = b.y + halfPushY;

                const aTileX = Math.floor((newAX + ENEMY_RADIUS) / TILE_SIZE);
                const aTileY = Math.floor((newAY + ENEMY_RADIUS) / TILE_SIZE);
                const bTileX = Math.floor((newBX + ENEMY_RADIUS) / TILE_SIZE);
                const bTileY = Math.floor((newBY + ENEMY_RADIUS) / TILE_SIZE);

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

    function resolvePlayerEnemyCollisions() {
        const minDistance = ENEMY_RADIUS + PLAYER_COLLISION_RADIUS;
        const minDistanceSq = minDistance * minDistance;
        let playerCenterX = playerWorldX + TILE_SIZE / 2;
        let playerCenterY = playerWorldY + TILE_SIZE / 2;

        for (const enemy of enemies) {
            const enemyCenterX = enemy.x + ENEMY_RADIUS;
            const enemyCenterY = enemy.y + ENEMY_RADIUS;
            let dx = enemyCenterX - playerCenterX;
            let dy = enemyCenterY - playerCenterY;
            let distSq = dx * dx + dy * dy;

            if (distSq >= minDistanceSq) {
                continue;
            }

            if (distSq < 0.0001) {
                const angle = (enemy.id * 0.61) % (Math.PI * 2);
                dx = Math.cos(angle);
                dy = Math.sin(angle);
                distSq = 1;
            }

            const dist = Math.sqrt(distSq);
            const overlap = minDistance - dist;
            const nx = dx / dist;
            const ny = dy / dist;

            const pushedPlayerX = playerWorldX - nx * overlap;
            const pushedPlayerY = playerWorldY - ny * overlap;
            const pushedPlayerTileX = Math.floor((pushedPlayerX + TILE_SIZE / 2) / TILE_SIZE);
            const pushedPlayerTileY = Math.floor((pushedPlayerY + TILE_SIZE / 2) / TILE_SIZE);

            if (isTileWalkable(pushedPlayerTileX, pushedPlayerTileY)) {
                playerWorldX = pushedPlayerX;
                playerWorldY = pushedPlayerY;
                playerCenterX = playerWorldX + TILE_SIZE / 2;
                playerCenterY = playerWorldY + TILE_SIZE / 2;
            } else {
                const pushedEnemyX = enemy.x + nx * overlap;
                const pushedEnemyY = enemy.y + ny * overlap;
                const pushedEnemyTileX = Math.floor((pushedEnemyX + ENEMY_RADIUS) / TILE_SIZE);
                const pushedEnemyTileY = Math.floor((pushedEnemyY + ENEMY_RADIUS) / TILE_SIZE);
                if (isTileWalkable(pushedEnemyTileX, pushedEnemyTileY)) {
                    enemy.x = pushedEnemyX;
                    enemy.y = pushedEnemyY;
                    enemy.sprite.position.set(enemy.x, enemy.y);
                }
            }
        }
    }

    function updateEnemySpawning() {
        enemySpawnTimer -= 1;
        if (enemySpawnTimer > 0) {
            return;
        }
        enemySpawnTimer = ENEMY_SPAWN_INTERVAL_FRAMES;

        if (enemies.length >= ENEMY_MAX_COUNT) {
            return;
        }

        const spawnTile = tryGetOffscreenSpawnTile();
        if (spawnTile) {
            spawnEnemyAtTile(spawnTile.x, spawnTile.y);
        }
    }

    function updateEnemies(deltaMoveScale) {
        const playerCenterX = playerWorldX + TILE_SIZE / 2;
        const playerCenterY = playerWorldY + TILE_SIZE / 2;
        const playerTileX = Math.floor(playerCenterX / TILE_SIZE);
        const playerTileY = Math.floor(playerCenterY / TILE_SIZE);

        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            const enemyCenterX = enemy.x + ENEMY_SIZE / 2;
            const enemyCenterY = enemy.y + ENEMY_SIZE / 2;
            const enemyTileX = Math.floor(enemyCenterX / TILE_SIZE);
            const enemyTileY = Math.floor(enemyCenterY / TILE_SIZE);

            const dxPlayerTiles = enemyTileX - playerTileX;
            const dyPlayerTiles = enemyTileY - playerTileY;
            if (dxPlayerTiles * dxPlayerTiles + dyPlayerTiles * dyPlayerTiles > ENEMY_DESPAWN_DISTANCE_TILES * ENEMY_DESPAWN_DISTANCE_TILES) {
                removeEnemyAt(i);
                continue;
            }

            enemy.repathTimer -= 1;
            if (enemy.repathTimer <= 0 || enemy.pathIndex >= enemy.path.length) {
                framePathRequests += 1;
                if (framePathBudget > 0) {
                    enemy.path = findPathAStar(enemyTileX, enemyTileY, playerTileX, playerTileY);
                    enemy.pathIndex = 0;
                    enemy.repathTimer = ENEMY_REPATH_INTERVAL_FRAMES;
                    framePathBudget -= 1;
                    framePathExecuted += 1;
                } else {
                    framePathDeferred += 1;
                    enemy.repathTimer = 0;
                }
            }

            if (enemy.pathIndex < enemy.path.length) {
                const targetTile = enemy.path[enemy.pathIndex];
                const targetCenterX = targetTile.x * TILE_SIZE + TILE_SIZE / 2;
                const targetCenterY = targetTile.y * TILE_SIZE + TILE_SIZE / 2;
                const dx = targetCenterX - (enemy.x + ENEMY_SIZE / 2);
                const dy = targetCenterY - (enemy.y + ENEMY_SIZE / 2);
                const dist = Math.hypot(dx, dy);
                const step = ENEMY_SPEED * deltaMoveScale;

                if (dist <= step) {
                    enemy.x = targetCenterX - ENEMY_SIZE / 2;
                    enemy.y = targetCenterY - ENEMY_SIZE / 2;
                    enemy.pathIndex += 1;
                } else if (dist > 0) {
                    enemy.x += (dx / dist) * step;
                    enemy.y += (dy / dist) * step;
                }

                const newTileX = Math.floor((enemy.x + ENEMY_SIZE / 2) / TILE_SIZE);
                const newTileY = Math.floor((enemy.y + ENEMY_SIZE / 2) / TILE_SIZE);
                if (!isTileWalkable(newTileX, newTileY)) {
                    enemy.repathTimer = 0;
                }
            }

            enemy.sprite.position.set(enemy.x, enemy.y);

            if (enemy.hitCooldown > 0) {
                enemy.hitCooldown -= 1;
            }

            const dxPlayer = (enemy.x + ENEMY_RADIUS) - playerCenterX;
            const dyPlayer = (enemy.y + ENEMY_RADIUS) - playerCenterY;
            const collisionDistance = ENEMY_RADIUS + PLAYER_COLLISION_RADIUS;
            const collisionDistSq = dxPlayer * dxPlayer + dyPlayer * dyPlayer;
            if (collisionDistSq < collisionDistance * collisionDistance && enemy.hitCooldown <= 0) {
                enemy.hitCooldown = 40;
                playerHitFlashFrames = 8;
            }
        }

        resolveEnemyCollisions();
        resolvePlayerEnemyCollisions();
        for (const enemy of enemies) {
            enemy.sprite.position.set(enemy.x, enemy.y);
        }
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
        sprite.circle(16, 16, 16);
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

    const debugText = new PIXI.Text({
        text: '',
        style: {
            fill: '#8df7ff',
            fontFamily: 'monospace',
            fontSize: 13
        }
    });
    debugText.visible = false;
    debugText.position.set(window.innerWidth - 360, 16);
    app.stage.addChild(debugText);

    function updateHud() {
        hudText.text = `Wood: ${inventory.wood}\nStone: ${inventory.stone}\nIron: ${inventory.iron}`;
    }

    function logDebug(message) {
        const stamp = new Date().toLocaleTimeString();
        debugLogs.push(`[${stamp}] ${message}`);
        if (debugLogs.length > 6) {
            debugLogs.shift();
        }
    }

    function updateDebugOverlay(frameMs) {
        if (!debugOverlayEnabled) {
            return;
        }

        const lines = [
            'DEV CONSOLE (F4 or `)',
            `FPS: ${smoothedFps.toFixed(1)} | Frame: ${frameMs.toFixed(2)} ms`,
            `Enemies: ${enemies.length}/${ENEMY_MAX_COUNT}`,
            `Path req/exe/def: ${framePathRequests}/${framePathExecuted}/${framePathDeferred}`,
            `Path budget/frame: ${ENEMY_MAX_REPATHS_PER_FRAME}`,
            `Tiles cached: ${tileCache.size}`,
            `Resources active: ${resourceNodeCache.size}`,
            `Water feature regions: ${waterFeatureCache.size}`
        ];

        if (debugLogs.length > 0) {
            lines.push('Logs:');
            for (const entry of debugLogs) {
                lines.push(entry);
            }
        }

        debugText.text = lines.join('\n');
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
        if (key === 'f4' || key === 'ç') {
            debugOverlayEnabled = !debugOverlayEnabled;
            debugText.visible = debugOverlayEnabled;
            refreshVisibleTileGridlines();
            logDebug(`Debug console ${debugOverlayEnabled ? 'enabled' : 'disabled'}`);
        }
        if (key === 'e') {
            harvestRequested = true;
        }
    });

    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });

    app.ticker.add((delta) => {
        const frameMs = delta.deltaMS;
        const fps = frameMs > 0 ? 1000 / frameMs : 0;
        smoothedFps = smoothedFps * 0.9 + fps * 0.1;
        framePathRequests = 0;
        framePathExecuted = 0;
        framePathDeferred = 0;
        framePathBudget = ENEMY_MAX_REPATHS_PER_FRAME;

        const deltaMoveScale = delta.deltaTime / 60;
        const moveDistance = SPEED * deltaMoveScale;
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
        updateEnemySpawning();
        updateEnemies(deltaMoveScale);

        // Re-apply camera in case enemy collision resolution pushed the player.
        world.position.x = window.innerWidth / 2 - playerWorldX - 16;
        world.position.y = window.innerHeight / 2 - playerWorldY - 16;

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

        if (playerHitFlashFrames > 0) {
            player.alpha = 0.5;
            playerHitFlashFrames -= 1;
        } else {
            player.alpha = 1;
        }

        updateDebugOverlay(frameMs);
    });

    window.addEventListener('resize', () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        debugText.position.set(window.innerWidth - 360, 16);
        updateTiles();
    });

    console.log('Purrmadeath initialized');
}

init();
