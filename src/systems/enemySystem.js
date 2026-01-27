import * as PIXI from 'pixi.js';
import {
    CIVILIAN_RADIUS,
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
    ENEMY_RANGED_SPAWN_CHANCE,
    ENEMY_REPATH_JITTER_FRAMES,
    ENEMY_REPATH_INTERVAL_FRAMES,
    ENEMY_SIZE,
    ENEMY_SPEED,
    ENEMY_SPAWN_INTERVAL_FRAMES,
    TILE_SIZE
} from '../config/constants.js';
import {
    findPathAStar as findPathAStarBase,
    findPathToNearestWall as findPathToNearestWallBase,
    tryGetOffscreenSpawnTile as tryGetOffscreenSpawnTileBase
} from './enemyNavigation.js';
import {
    resolveEnemyCollisions as resolveEnemyCollisionsBase,
    resolvePlayerEnemyCollisions as resolvePlayerEnemyCollisionsBase
} from './enemyCollision.js';

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
    getPlayerTargets = null,
    getWalls,
    getCivilianTargets = () => [],
    onCivilianContactDamage = () => false
}) {
    const enemies = enemyList;
    let enemySpawnTimer = 0;
    let enemyIdCounter = 0;
    let pathRequests = 0;
    let pathExecuted = 0;
    let pathDeferred = 0;
    let framePathBudget = ENEMY_MAX_REPATHS_PER_FRAME;
    let frameIndex = 0;
    const perfStats = {
        skippedByStride: 0,
        collisionSkippedFrames: 0,
        lastUpdateMs: 0
    };

    function beginFramePathBudget() {
        pathRequests = 0;
        pathExecuted = 0;
        pathDeferred = 0;
        framePathBudget = ENEMY_MAX_REPATHS_PER_FRAME;
    }

    function createEnemySprite(isRanged) {
        const container = new PIXI.Container();
        const body = new PIXI.Graphics();
        body.circle(ENEMY_RADIUS, ENEMY_RADIUS, ENEMY_RADIUS);
        // Orange marks ranged enemies, red marks melee enemies.
        body.fill(isRanged ? 0xd9771f : 0x8f1f1f);
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

    function findPathAStar(startX, startY, goalX, goalY) {
        return findPathAStarBase(startX, startY, goalX, goalY, {
            isTileWalkable,
            gridRadius: ENEMY_PATH_GRID_RADIUS,
            maxSteps: ENEMY_PATH_MAX_STEPS
        });
    }

    function tryGetOffscreenSpawnTile() {
        return tryGetOffscreenSpawnTileBase({
            getWorldPosition,
            getViewportSize,
            tileSize: TILE_SIZE,
            offscreenMarginTiles: ENEMY_OFFSCREEN_MARGIN_TILES,
            getPlayerTile,
            minPlayerDistanceTiles: ENEMY_MIN_PLAYER_DISTANCE_TILES,
            isTileWalkable
        });
    }

    function spawnEnemyAtTile(tileX, tileY) {
        const isRanged = Math.random() < ENEMY_RANGED_SPAWN_CHANCE;
        const spriteData = createEnemySprite(isRanged);
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
            isRanged,
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

    function createReplicatedEnemy(entry) {
        const spriteData = createEnemySprite(Boolean(entry.isRanged));
        const enemy = {
            __entity: 'enemy',
            id: Number(entry.id) || enemyIdCounter++,
            x: Number(entry.x) || 0,
            y: Number(entry.y) || 0,
            targetX: Number(entry.x) || 0,
            targetY: Number(entry.y) || 0,
            hp: Number(entry.hp) || ENEMY_MAX_HP,
            maxHp: Number(entry.maxHp) || ENEMY_MAX_HP,
            invulnFrames: 0,
            isDead: false,
            path: [],
            pathIndex: 0,
            repathTimer: 0,
            contactCooldownFrames: 0,
            knockbackVX: 0,
            knockbackVY: 0,
            isRanged: Boolean(entry.isRanged),
            wallTargetTile: null,
            healthBg: spriteData.healthBg,
            healthFill: spriteData.healthFill
        };
        spriteData.container.position.set(enemy.x, enemy.y);
        enemyLayer.addChild(spriteData.container);
        enemy.sprite = spriteData.container;
        updateEnemyHealthBar(enemy);
        return enemy;
    }

    function exportReplicatedState() {
        return enemies.map((enemy) => ({
            id: enemy.id,
            x: enemy.x,
            y: enemy.y,
            hp: enemy.hp,
            maxHp: enemy.maxHp,
            isRanged: enemy.isRanged
        }));
    }

    function syncReplicatedState(entries) {
        const source = Array.isArray(entries) ? entries : [];
        const byId = new Map();
        for (const enemy of enemies) {
            byId.set(String(enemy.id), enemy);
        }
        const seen = new Set();
        for (const entry of source) {
            const key = String(entry.id);
            let enemy = byId.get(key);
            if (!enemy) {
                enemy = createReplicatedEnemy(entry);
                enemies.push(enemy);
            } else {
                enemy.targetX = Number(entry.x) || enemy.targetX || enemy.x;
                enemy.targetY = Number(entry.y) || enemy.targetY || enemy.y;
                enemy.hp = Number(entry.hp) || enemy.hp;
                enemy.maxHp = Number(entry.maxHp) || enemy.maxHp;
                enemy.isRanged = Boolean(entry.isRanged);
                updateEnemyHealthBar(enemy);
            }
            seen.add(key);
        }

        for (let i = enemies.length - 1; i >= 0; i--) {
            const key = String(enemies[i].id);
            if (seen.has(key)) {
                continue;
            }
            removeEnemyAt(i);
        }
    }

    // Follower-side smoothing for replicated enemies to reduce snap jitter.
    function updateReplicatedInterpolation(deltaMoveScale) {
        const alpha = Math.max(0.08, Math.min(0.5, deltaMoveScale * 12));
        for (const enemy of enemies) {
            if (!Number.isFinite(enemy.targetX) || !Number.isFinite(enemy.targetY)) {
                enemy.targetX = enemy.x;
                enemy.targetY = enemy.y;
            }
            enemy.x += (enemy.targetX - enemy.x) * alpha;
            enemy.y += (enemy.targetY - enemy.y) * alpha;
            enemy.sprite.position.set(enemy.x, enemy.y);
        }
    }

    function resolveEnemyCollisions(options = {}) {
        resolveEnemyCollisionsBase({
            enemies,
            enemyRadius: ENEMY_RADIUS,
            tileSize: TILE_SIZE,
            isTileWalkable,
            frameIndex,
            perfStats,
            highDensityThreshold: options.highDensityThreshold,
            highDensityStride: options.highDensityStride
        });
    }

    function resolvePlayerEnemyCollisions() {
        resolvePlayerEnemyCollisionsBase({
            enemies,
            enemyRadius: ENEMY_RADIUS,
            tileSize: TILE_SIZE,
            isTileWalkable,
            isPlayerDead,
            getPlayerCollisionRadius,
            getPlayerCenter,
            setPlayerWorldPosition,
            canMovePlayerTo
        });
    }

    function findPathToNearestWall(enemyTileX, enemyTileY, enemyId = 0) {
        return findPathToNearestWallBase(
            enemyTileX,
            enemyTileY,
            enemyId,
            getWalls,
            isTileWalkable,
            findPathAStar
        );
    }

    function spawnTick(options = {}) {
        const maxCount = Number.isFinite(options.maxCount) ? Math.max(0, Math.floor(options.maxCount)) : ENEMY_MAX_COUNT;
        const spawnIntervalFrames = Number.isFinite(options.spawnIntervalFrames)
            ? Math.max(1, Math.floor(options.spawnIntervalFrames))
            : ENEMY_SPAWN_INTERVAL_FRAMES;
        enemySpawnTimer -= 1;
        if (enemySpawnTimer > 0 || enemies.length >= maxCount) {
            return;
        }
        enemySpawnTimer = spawnIntervalFrames;
        const spawnTile = tryGetOffscreenSpawnTile();
        if (spawnTile) {
            spawnEnemyAtTile(spawnTile.x, spawnTile.y);
        }
    }

    function spawnBurst(count) {
        let spawned = 0;
        const maxToSpawn = Math.max(0, Math.floor(count));
        while (spawned < maxToSpawn && enemies.length < ENEMY_MAX_COUNT) {
            const spawnTile = tryGetOffscreenSpawnTile();
            if (!spawnTile) {
                break;
            }
            spawnEnemyAtTile(spawnTile.x, spawnTile.y);
            spawned += 1;
        }
        return spawned;
    }

    function update(deltaMoveScale, options = {}) {
        const startMs = performance.now();
        frameIndex += 1;
        perfStats.skippedByStride = 0;
        const playerCenter = getPlayerCenter();
        const playerTile = getPlayerTile();
        const playerTargets = typeof getPlayerTargets === 'function'
            ? getPlayerTargets().filter((target) => !target.isDead)
            : [{
                id: 'local',
                x: playerCenter.x,
                y: playerCenter.y,
                radius: getPlayerCollisionRadius(),
                isDead: isPlayerDead()
            }];
        const civilians = getCivilianTargets();
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
            const dxTiles = enemyTileX - playerTile.x;
            const dyTiles = enemyTileY - playerTile.y;
            const distTileSq = dxTiles * dxTiles + dyTiles * dyTiles;
            const nearTiles = options.nearTiles ?? 20;
            const midTiles = options.midTiles ?? 40;
            const midStride = Math.max(1, options.midStride ?? 2);
            const farStride = Math.max(midStride, options.farStride ?? 3);
            const nearSq = nearTiles * nearTiles;
            const midSq = midTiles * midTiles;
            let stride = 1;
            if (distTileSq > midSq) {
                stride = farStride;
            } else if (distTileSq > nearSq) {
                stride = midStride;
            }
            if (stride > 1 && (frameIndex + enemy.id) % stride !== 0) {
                perfStats.skippedByStride += 1;
                continue;
            }
            let targetTileX = playerTile.x;
            let targetTileY = playerTile.y;
            if (playerTargets.length > 0) {
                let bestPlayer = null;
                let bestPlayerDistSq = Infinity;
                for (const playerTarget of playerTargets) {
                    if (playerTarget.isDead) {
                        continue;
                    }
                    const playerTileX = Math.floor(playerTarget.x / TILE_SIZE);
                    const playerTileY = Math.floor(playerTarget.y / TILE_SIZE);
                    const pdx = enemyTileX - playerTileX;
                    const pdy = enemyTileY - playerTileY;
                    const pDistSq = pdx * pdx + pdy * pdy;
                    if (pDistSq < bestPlayerDistSq) {
                        bestPlayerDistSq = pDistSq;
                        bestPlayer = playerTarget;
                    }
                }
                if (bestPlayer) {
                    targetTileX = Math.floor(bestPlayer.x / TILE_SIZE);
                    targetTileY = Math.floor(bestPlayer.y / TILE_SIZE);
                }
            }

            // Civilians are valid aggro targets; enemies pick the closest target by tile distance.
            if (civilians.length > 0) {
                let bestCivilian = null;
                let bestDistSq = Infinity;
                for (const civilian of civilians) {
                    if (civilian.isDead) {
                        continue;
                    }
                    const civilianTileX = Math.floor(civilian.x / TILE_SIZE);
                    const civilianTileY = Math.floor(civilian.y / TILE_SIZE);
                    const cdx = enemyTileX - civilianTileX;
                    const cdy = enemyTileY - civilianTileY;
                    const cDistSq = cdx * cdx + cdy * cdy;
                    if (cDistSq < bestDistSq) {
                        bestDistSq = cDistSq;
                        bestCivilian = civilian;
                    }
                }

                if (bestCivilian) {
                    const pdx = enemyTileX - playerTile.x;
                    const pdy = enemyTileY - playerTile.y;
                    const playerDistSq = pdx * pdx + pdy * pdy;
                    if (bestDistSq < playerDistSq) {
                        targetTileX = Math.floor(bestCivilian.x / TILE_SIZE);
                        targetTileY = Math.floor(bestCivilian.y / TILE_SIZE);
                    }
                }
            }
            if (distTileSq > ENEMY_DESPAWN_DISTANCE_TILES * ENEMY_DESPAWN_DISTANCE_TILES) {
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
                    if (!playerDirectlyEnclosed || targetTileX !== playerTile.x || targetTileY !== playerTile.y) {
                        resolvedPath = findPathAStar(enemyTileX, enemyTileY, targetTileX, targetTileY);
                    }
                    if (resolvedPath.length > 0) {
                        enemy.wallTargetTile = null;
                        enemy.repathTimer = ENEMY_REPATH_INTERVAL_FRAMES + jitter;
                    } else {
                        if (enemy.wallTargetTile && isTileWalkable(enemy.wallTargetTile.x, enemy.wallTargetTile.y)) {
                            resolvedPath = findPathAStar(enemyTileX, enemyTileY, enemy.wallTargetTile.x, enemy.wallTargetTile.y);
                        }
                        if (resolvedPath.length === 0) {
                            const wallPathResult = findPathToNearestWall(enemyTileX, enemyTileY, enemy.id);
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

            if (enemy.contactCooldownFrames <= 0 && playerTargets.length > 0) {
                for (const playerTarget of playerTargets) {
                    const playerRadius = Number.isFinite(playerTarget.radius) ? playerTarget.radius : getPlayerCollisionRadius();
                    const dxPlayer = (enemy.x + ENEMY_RADIUS) - playerTarget.x;
                    const dyPlayer = (enemy.y + ENEMY_RADIUS) - playerTarget.y;
                    const collisionDistance = ENEMY_RADIUS + playerRadius;
                    const collisionDistSq = dxPlayer * dxPlayer + dyPlayer * dyPlayer;
                    if (collisionDistSq < collisionDistance * collisionDistance) {
                        enemy.contactCooldownFrames = ENEMY_CONTACT_COOLDOWN_FRAMES;
                        onPlayerContactDamage(ENEMY_CONTACT_DAMAGE, 'enemy_contact', playerTarget.id);
                        break;
                    }
                }
            }

            if (enemy.contactCooldownFrames <= 0 && civilians.length > 0) {
                for (const civilian of civilians) {
                    if (civilian.isDead) {
                        continue;
                    }
                    const dxCivilian = (enemy.x + ENEMY_RADIUS) - civilian.x;
                    const dyCivilian = (enemy.y + ENEMY_RADIUS) - civilian.y;
                    const hitDistance = ENEMY_RADIUS + CIVILIAN_RADIUS;
                    if (dxCivilian * dxCivilian + dyCivilian * dyCivilian < hitDistance * hitDistance) {
                        enemy.contactCooldownFrames = ENEMY_CONTACT_COOLDOWN_FRAMES;
                        onCivilianContactDamage(civilian.id, ENEMY_CONTACT_DAMAGE, 'enemy_contact');
                        break;
                    }
                }
            }
        }

        resolveEnemyCollisions({
            highDensityThreshold: options.collisionHighDensityThreshold,
            highDensityStride: options.collisionHighDensityStride
        });
        resolvePlayerEnemyCollisions();
        for (const enemy of enemies) {
            enemy.sprite.position.set(enemy.x, enemy.y);
        }
        perfStats.lastUpdateMs = performance.now() - startMs;
    }

    function getPathStats() {
        return {
            requests: pathRequests,
            executed: pathExecuted,
            deferred: pathDeferred,
            budget: ENEMY_MAX_REPATHS_PER_FRAME,
            skippedByStride: perfStats.skippedByStride,
            collisionSkippedFrames: perfStats.collisionSkippedFrames,
            updateMs: perfStats.lastUpdateMs
        };
    }

    return {
        beginFramePathBudget,
        spawnTick,
        spawnBurst,
        update,
        resetEnemies,
        getEnemies: () => enemies,
        getPathStats,
        updateEnemyHealthBar,
        exportReplicatedState,
        syncReplicatedState,
        updateReplicatedInterpolation,
        isEnemyEntity: (entity) => entity?.__entity === 'enemy'
    };
}
