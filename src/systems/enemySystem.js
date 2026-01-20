import * as PIXI from 'pixi.js';
import {
    ENEMY_BLOCKED_REPATH_INTERVAL_FRAMES,
    ENEMY_CONTACT_COOLDOWN_FRAMES,
    ENEMY_CONTACT_DAMAGE,
    ENEMY_DESPAWN_DISTANCE_TILES,
    ENEMY_KNOCKBACK_FRICTION,
    ENEMY_MAX_COUNT,
    ENEMY_MAX_HP,
    ENEMY_MAX_REPATHS_PER_FRAME,
    ENEMY_MIN_KNOCKBACK_SPEED,
    ENEMY_MIN_PLAYER_DISTANCE_TILES,
    ENEMY_OFFSCREEN_MARGIN_TILES,
    ENEMY_PATH_GRID_RADIUS,
    ENEMY_PATH_MAX_STEPS,
    ENEMY_RADIUS,
    ENEMY_REPATH_JITTER_FRAMES,
    ENEMY_REPATH_INTERVAL_FRAMES,
    ENEMY_SIZE,
    ENEMY_SPEED,
    ENEMY_SPAWN_INTERVAL_FRAMES,
    TILE_SIZE
} from '../config/constants.js';

// Enemy system owns spawning, navigation, collision between enemies, and
// enemy-player push/contact interactions. It keeps pathfinding metrics for debug UI.
export function createEnemySystem({
    enemyList = [],
    enemyLayer,
    isTileWalkable,
    getWorldPosition,
    getViewportSize,
    getPlayerCenter,
    getPlayerTile,
    isPlayerDead,
    getPlayerCollisionRadius,
    setPlayerWorldPosition,
    canMovePlayerTo,
    onPlayerContactDamage,
    getWalls
}) {
    const enemies = enemyList;
    let enemySpawnTimer = 0;
    let enemyIdCounter = 0;
    let pathRequests = 0;
    let pathExecuted = 0;
    let pathDeferred = 0;
    let framePathBudget = ENEMY_MAX_REPATHS_PER_FRAME;
    let frameIndex = 0;

    function beginFramePathBudget() {
        pathRequests = 0;
        pathExecuted = 0;
        pathDeferred = 0;
        framePathBudget = ENEMY_MAX_REPATHS_PER_FRAME;
    }

    function createEnemySprite() {
        const container = new PIXI.Container();
        const body = new PIXI.Graphics();
        body.circle(ENEMY_RADIUS, ENEMY_RADIUS, ENEMY_RADIUS);
        body.fill(0x8f1f1f);
        body.stroke({ width: 1, color: 0x220808 });

        const healthBg = new PIXI.Graphics();
        const healthFill = new PIXI.Graphics();
        container.addChild(body);
        container.addChild(healthBg);
        container.addChild(healthFill);
        return { container, healthBg, healthFill };
    }

    function updateEnemyHealthBar(enemy) {
        const barWidth = ENEMY_SIZE;
        const barHeight = 4;
        const barY = -8;
        const ratio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));

        enemy.healthBg.clear();
        enemy.healthBg.rect(0, barY, barWidth, barHeight);
        enemy.healthBg.fill(0x1d1d1d);

        enemy.healthFill.clear();
        enemy.healthFill.rect(0, barY, barWidth * ratio, barHeight);
        enemy.healthFill.fill(0x4ed85a);

        enemy.healthBg.visible = ratio < 1;
        enemy.healthFill.visible = ratio < 1;
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
                    open.push({ key: neighborKey, x: neighbor.x, y: neighbor.y, f: fScore });
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
        const worldPos = getWorldPosition();
        const viewport = getViewportSize();
        const startTileX = Math.floor(-worldPos.x / TILE_SIZE);
        const startTileY = Math.floor(-worldPos.y / TILE_SIZE);
        const endTileX = startTileX + Math.ceil(viewport.width / TILE_SIZE);
        const endTileY = startTileY + Math.ceil(viewport.height / TILE_SIZE);
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
        const playerTile = getPlayerTile();

        for (let attempt = 0; attempt < 24; attempt++) {
            const side = Math.floor(Math.random() * 4);
            let tileX;
            let tileY;
            if (side === 0) {
                tileX = minX + Math.floor(Math.random() * (maxX - minX + 1));
                tileY = minY;
            } else if (side === 1) {
                tileX = minX + Math.floor(Math.random() * (maxX - minX + 1));
                tileY = maxY;
            } else if (side === 2) {
                tileX = minX;
                tileY = minY + Math.floor(Math.random() * (maxY - minY + 1));
            } else {
                tileX = maxX;
                tileY = minY + Math.floor(Math.random() * (maxY - minY + 1));
            }

            if (isTileInView(tileX, tileY, bounds) || !isTileWalkable(tileX, tileY)) {
                continue;
            }
            const dx = tileX - playerTile.x;
            const dy = tileY - playerTile.y;
            if ((dx * dx + dy * dy) < ENEMY_MIN_PLAYER_DISTANCE_TILES * ENEMY_MIN_PLAYER_DISTANCE_TILES) {
                continue;
            }
            return { x: tileX, y: tileY };
        }
        return null;
    }

    function spawnEnemyAtTile(tileX, tileY) {
        const spriteData = createEnemySprite();
        const enemy = {
            __entity: 'enemy',
            id: enemyIdCounter++,
            x: tileX * TILE_SIZE + (TILE_SIZE - ENEMY_SIZE) / 2,
            y: tileY * TILE_SIZE + (TILE_SIZE - ENEMY_SIZE) / 2,
            hp: ENEMY_MAX_HP,
            maxHp: ENEMY_MAX_HP,
            invulnFrames: 0,
            isDead: false,
            path: [],
            pathIndex: 0,
            repathTimer: Math.floor(Math.random() * (ENEMY_REPATH_INTERVAL_FRAMES + 1)),
            contactCooldownFrames: 0,
            knockbackVX: 0,
            knockbackVY: 0,
            wallTargetTile: null,
            healthBg: spriteData.healthBg,
            healthFill: spriteData.healthFill
        };
        spriteData.container.position.set(enemy.x, enemy.y);
        enemyLayer.addChild(spriteData.container);
        enemy.sprite = spriteData.container;
        updateEnemyHealthBar(enemy);
        enemies.push(enemy);
    }

    function removeEnemyAt(index) {
        const enemy = enemies[index];
        enemy.sprite.destroy();
        enemies.splice(index, 1);
    }

    function resetEnemies() {
        for (let i = enemies.length - 1; i >= 0; i--) {
            removeEnemyAt(i);
        }
    }

    function resolveEnemyCollisions() {
        const minDistance = ENEMY_RADIUS * 2;
        const minDistanceSq = minDistance * minDistance;
        const highDensity = enemies.length >= 90;
        const pairBudget = highDensity ? 16000 : Infinity;
        let pairChecks = 0;
        for (let i = 0; i < enemies.length; i++) {
            for (let j = i + 1; j < enemies.length; j++) {
                pairChecks += 1;
                if (pairChecks > pairBudget) {
                    return;
                }
                // Under heavy swarms, stagger half the pairs per frame to reduce spikes.
                if (highDensity && ((i + j + frameIndex) % 2 !== 0)) {
                    continue;
                }
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
        if (isPlayerDead()) {
            return;
        }
        const minDistance = ENEMY_RADIUS + getPlayerCollisionRadius();
        const minDistanceSq = minDistance * minDistance;
        let player = getPlayerCenter();
        for (const enemy of enemies) {
            const enemyCenterX = enemy.x + ENEMY_RADIUS;
            const enemyCenterY = enemy.y + ENEMY_RADIUS;
            let dx = enemyCenterX - player.x;
            let dy = enemyCenterY - player.y;
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
            const pushedPlayerX = (player.x - TILE_SIZE / 2) - nx * overlap;
            const pushedPlayerY = (player.y - TILE_SIZE / 2) - ny * overlap;
            if (canMovePlayerTo(pushedPlayerX, pushedPlayerY)) {
                setPlayerWorldPosition(pushedPlayerX, pushedPlayerY);
                player = getPlayerCenter();
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

    function findPathToNearestWall(enemyTileX, enemyTileY) {
        const walls = getWalls();
        if (walls.length === 0) {
            return { path: [], targetTile: null };
        }
        const rankedWalls = walls
            .map((wall) => ({
                wall,
                score: Math.abs(wall.tileX - enemyTileX) + Math.abs(wall.tileY - enemyTileY)
            }))
            .sort((a, b) => a.score - b.score);

        // Lower probe count keeps fallback wall targeting cheaper under swarms.
        const maxWallsToProbe = Math.min(4, rankedWalls.length);
        for (let wi = 0; wi < maxWallsToProbe; wi++) {
            const wall = rankedWalls[wi].wall;
            for (const tile of wall.tiles) {
                const candidates = [
                    { x: tile.x + 1, y: tile.y },
                    { x: tile.x - 1, y: tile.y },
                    { x: tile.x, y: tile.y + 1 },
                    { x: tile.x, y: tile.y - 1 }
                ];
                for (const candidate of candidates) {
                    if (!isTileWalkable(candidate.x, candidate.y)) {
                        continue;
                    }
                    const path = findPathAStar(enemyTileX, enemyTileY, candidate.x, candidate.y);
                    if (path.length > 0) {
                        return { path, targetTile: candidate };
                    }
                }
            }
        }
        return { path: [], targetTile: null };
    }

    function spawnTick() {
        enemySpawnTimer -= 1;
        if (enemySpawnTimer > 0 || enemies.length >= ENEMY_MAX_COUNT) {
            return;
        }
        enemySpawnTimer = ENEMY_SPAWN_INTERVAL_FRAMES;
        const spawnTile = tryGetOffscreenSpawnTile();
        if (spawnTile) {
            spawnEnemyAtTile(spawnTile.x, spawnTile.y);
        }
    }

    function update(deltaMoveScale) {
        frameIndex += 1;
        const playerCenter = getPlayerCenter();
        const playerTile = getPlayerTile();
        const playerTileNeighbors = [
            { x: playerTile.x + 1, y: playerTile.y },
            { x: playerTile.x - 1, y: playerTile.y },
            { x: playerTile.x, y: playerTile.y + 1 },
            { x: playerTile.x, y: playerTile.y - 1 }
        ];
        // Fast enclosure check: if no adjacent walkable tile, skip player A* first pass.
        const playerDirectlyEnclosed = playerTileNeighbors.every((tile) => !isTileWalkable(tile.x, tile.y));

        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            if (enemy.isDead) {
                removeEnemyAt(i);
                continue;
            }
            const enemyCenterX = enemy.x + ENEMY_SIZE / 2;
            const enemyCenterY = enemy.y + ENEMY_SIZE / 2;
            const enemyTileX = Math.floor(enemyCenterX / TILE_SIZE);
            const enemyTileY = Math.floor(enemyCenterY / TILE_SIZE);
            const dxPlayerTiles = enemyTileX - playerTile.x;
            const dyPlayerTiles = enemyTileY - playerTile.y;
            if (dxPlayerTiles * dxPlayerTiles + dyPlayerTiles * dyPlayerTiles > ENEMY_DESPAWN_DISTANCE_TILES * ENEMY_DESPAWN_DISTANCE_TILES) {
                removeEnemyAt(i);
                continue;
            }

            let hasStrongKnockback = false;
            const knockbackSpeed = Math.hypot(enemy.knockbackVX, enemy.knockbackVY);
            if (knockbackSpeed > ENEMY_MIN_KNOCKBACK_SPEED) {
                hasStrongKnockback = true;
                const pushedX = enemy.x + enemy.knockbackVX * deltaMoveScale;
                const pushedY = enemy.y + enemy.knockbackVY * deltaMoveScale;
                const pushedTileX = Math.floor((pushedX + ENEMY_SIZE / 2) / TILE_SIZE);
                const pushedTileY = Math.floor((pushedY + ENEMY_SIZE / 2) / TILE_SIZE);
                if (isTileWalkable(pushedTileX, pushedTileY)) {
                    enemy.x = pushedX;
                    enemy.y = pushedY;
                } else {
                    enemy.knockbackVX = 0;
                    enemy.knockbackVY = 0;
                    hasStrongKnockback = false;
                }
                enemy.knockbackVX *= ENEMY_KNOCKBACK_FRICTION;
                enemy.knockbackVY *= ENEMY_KNOCKBACK_FRICTION;
            }

            enemy.repathTimer -= 1;
            if (enemy.repathTimer <= 0 || enemy.pathIndex >= enemy.path.length) {
                pathRequests += 1;
                if (framePathBudget > 0) {
                    const jitter = Math.floor(Math.random() * (ENEMY_REPATH_JITTER_FRAMES + 1));
                    let resolvedPath = [];
                    if (!playerDirectlyEnclosed) {
                        resolvedPath = findPathAStar(enemyTileX, enemyTileY, playerTile.x, playerTile.y);
                    }
                    if (resolvedPath.length > 0) {
                        enemy.wallTargetTile = null;
                        enemy.repathTimer = ENEMY_REPATH_INTERVAL_FRAMES + jitter;
                    } else {
                        if (enemy.wallTargetTile && isTileWalkable(enemy.wallTargetTile.x, enemy.wallTargetTile.y)) {
                            resolvedPath = findPathAStar(enemyTileX, enemyTileY, enemy.wallTargetTile.x, enemy.wallTargetTile.y);
                        }
                        if (resolvedPath.length === 0) {
                            const wallPathResult = findPathToNearestWall(enemyTileX, enemyTileY);
                            resolvedPath = wallPathResult.path;
                            enemy.wallTargetTile = wallPathResult.targetTile;
                        }
                        enemy.repathTimer = resolvedPath.length > 0
                            ? ENEMY_REPATH_INTERVAL_FRAMES + jitter
                            : ENEMY_BLOCKED_REPATH_INTERVAL_FRAMES + jitter;
                    }
                    enemy.path = resolvedPath;
                    enemy.pathIndex = 0;
                    framePathBudget -= 1;
                    pathExecuted += 1;
                } else {
                    pathDeferred += 1;
                    enemy.repathTimer = 0;
                }
            }

            if (!hasStrongKnockback && enemy.pathIndex < enemy.path.length) {
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
            if (enemy.invulnFrames > 0) {
                enemy.invulnFrames -= 1;
            }
            if (enemy.contactCooldownFrames > 0) {
                enemy.contactCooldownFrames -= 1;
            }

            const dxPlayer = (enemy.x + ENEMY_RADIUS) - playerCenter.x;
            const dyPlayer = (enemy.y + ENEMY_RADIUS) - playerCenter.y;
            const collisionDistance = ENEMY_RADIUS + getPlayerCollisionRadius();
            const collisionDistSq = dxPlayer * dxPlayer + dyPlayer * dyPlayer;
            if (collisionDistSq < collisionDistance * collisionDistance && enemy.contactCooldownFrames <= 0) {
                enemy.contactCooldownFrames = ENEMY_CONTACT_COOLDOWN_FRAMES;
                onPlayerContactDamage(ENEMY_CONTACT_DAMAGE, 'enemy_contact');
            }
        }

        resolveEnemyCollisions();
        resolvePlayerEnemyCollisions();
        for (const enemy of enemies) {
            enemy.sprite.position.set(enemy.x, enemy.y);
        }
    }

    function getPathStats() {
        return {
            requests: pathRequests,
            executed: pathExecuted,
            deferred: pathDeferred,
            budget: ENEMY_MAX_REPATHS_PER_FRAME
        };
    }

    return {
        beginFramePathBudget,
        spawnTick,
        update,
        resetEnemies,
        getEnemies: () => enemies,
        getPathStats,
        updateEnemyHealthBar,
        isEnemyEntity: (entity) => entity?.__entity === 'enemy'
    };
}
