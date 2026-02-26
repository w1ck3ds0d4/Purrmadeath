import * as PIXI from 'pixi.js';
import {
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
    ENEMY_REPATH_INTERVAL_FRAMES,
    ENEMY_SIZE,
    ENEMY_SPEED,
    ENEMY_SPAWN_INTERVAL_FRAMES,
    GOLD_PER_ENEMY_KILL,
    INVULN_FRAMES_ON_HIT,
    MAX_BULLETS,
    PLAYER_COLLISION_RADIUS,
    PLAYER_INVULN_FRAMES,
    PLAYER_MAX_HP,
    PLAYER_SPEED,
    TILE_SIZE,
    WEAPONS
} from './config/constants.js';
import { createWorldSystem } from './systems/worldSystem.js';

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
    const projectileLayer = new PIXI.Container();
    world.addChild(tileLayer);
    world.addChild(resourceLayer);
    world.addChild(enemyLayer);
    world.addChild(projectileLayer);

    const inventory = {
        wood: 0,
        stone: 0,
        iron: 0,
        gold: 0
    };
    const combatStats = {
        enemiesKilled: 0
    };
    const playerState = {
        hp: PLAYER_MAX_HP,
        maxHp: PLAYER_MAX_HP,
        invulnFrames: 0,
        isDead: false
    };
    const playerCombat = {
        weapon: 'sword',
        cooldownFrames: 0,
        facingX: 1,
        facingY: 0
    };
    const floatingTexts = [];
    const enemies = [];
    const projectiles = [];
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
    let isPaused = false;
    const worldSystem = createWorldSystem({
        tileLayer,
        resourceLayer,
        getDebugOverlayEnabled: () => debugOverlayEnabled
    });

    function updateVisibleWorld() {
        worldSystem.updateTiles({
            worldPositionX: world.position.x,
            worldPositionY: world.position.y,
            screenWidth: window.innerWidth,
            screenHeight: window.innerHeight
        });
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

    function createBulletSprite() {
        const sprite = new PIXI.Graphics();
        sprite.circle(4, 4, 4);
        sprite.fill(0xf7e56a);
        sprite.stroke({ width: 1, color: 0x2a2409 });
        return sprite;
    }

    function createAimIndicator() {
        const sprite = new PIXI.Graphics();
        sprite.moveTo(0, -6);
        sprite.lineTo(16, 0);
        sprite.lineTo(0, 6);
        sprite.closePath();
        sprite.fill(0xffd166);
        sprite.stroke({ width: 1, color: 0x5c4a11 });
        return sprite;
    }

    function createSwordSwingSprite() {
        return new PIXI.Graphics();
    }

    function drawSwordSwing(sprite, centerX, centerY, angle, progress) {
        const cfg = WEAPONS.sword;
        const arcHalf = cfg.arcRadians * 0.5;
        const start = angle - arcHalf;
        const end = angle + arcHalf;
        const radius = cfg.range + 14 + progress * 8;

        sprite.clear();
        sprite.moveTo(centerX, centerY);
        sprite.arc(centerX, centerY, radius, start, end);
        sprite.closePath();
        sprite.fill(0xf6dfa7);
        sprite.alpha = 0.32 * (1 - progress);
    }

    function isTileWalkable(tileX, tileY) {
        return worldSystem.isTileWalkable(tileX, tileY);
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
        const spriteData = createEnemySprite();
        const enemy = {
            id: enemyIdCounter++,
            x: tileX * TILE_SIZE + (TILE_SIZE - ENEMY_SIZE) / 2,
            y: tileY * TILE_SIZE + (TILE_SIZE - ENEMY_SIZE) / 2,
            hp: ENEMY_MAX_HP,
            maxHp: ENEMY_MAX_HP,
            invulnFrames: 0,
            isDead: false,
            path: [],
            pathIndex: 0,
            repathTimer: 0,
            contactCooldownFrames: 0,
            knockbackVX: 0,
            knockbackVY: 0,
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

    function resetCombatEntities() {
        for (let i = enemies.length - 1; i >= 0; i--) {
            removeEnemyAt(i);
        }
        for (let i = projectiles.length - 1; i >= 0; i--) {
            removeProjectileAt(i);
        }
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
        if (playerState.isDead) {
            return;
        }
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
            if (enemy.isDead) {
                removeEnemyAt(i);
                continue;
            }
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

            const dxPlayer = (enemy.x + ENEMY_RADIUS) - playerCenterX;
            const dyPlayer = (enemy.y + ENEMY_RADIUS) - playerCenterY;
            const collisionDistance = ENEMY_RADIUS + PLAYER_COLLISION_RADIUS;
            const collisionDistSq = dxPlayer * dxPlayer + dyPlayer * dyPlayer;
            if (collisionDistSq < collisionDistance * collisionDistance && enemy.contactCooldownFrames <= 0) {
                enemy.contactCooldownFrames = ENEMY_CONTACT_COOLDOWN_FRAMES;
                applyDamage(playerState, ENEMY_CONTACT_DAMAGE, 'enemy_contact');
            }
        }

        resolveEnemyCollisions();
        resolvePlayerEnemyCollisions();
        for (const enemy of enemies) {
            enemy.sprite.position.set(enemy.x, enemy.y);
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
    const aimIndicator = createAimIndicator();
    app.stage.addChild(aimIndicator);
    const swordSwingSprite = createSwordSwingSprite();
    swordSwingSprite.visible = false;
    app.stage.addChild(swordSwingSprite);
    const swordSwingState = {
        ttl: 0,
        maxTtl: 8,
        angle: 0
    };

    const hudText = new PIXI.Text({
        text: '',
        style: {
            fill: '#ffffff',
            fontFamily: 'monospace',
            fontSize: 18
        }
    });
    hudText.position.set(16, 66);
    app.stage.addChild(hudText);

    const healthBarBackground = new PIXI.Graphics();
    const healthBarFill = new PIXI.Graphics();
    const healthText = new PIXI.Text({
        text: '',
        style: {
            fill: '#ffffff',
            fontFamily: 'monospace',
            fontSize: 14
        }
    });
    app.stage.addChild(healthBarBackground);
    app.stage.addChild(healthBarFill);
    app.stage.addChild(healthText);

    const deathText = new PIXI.Text({
        text: 'You Died\nPress R to restart',
        style: {
            fill: '#ffaaaa',
            fontFamily: 'monospace',
            fontSize: 28,
            align: 'center'
        }
    });
    deathText.anchor.set(0.5);
    deathText.visible = false;
    deathText.position.set(window.innerWidth / 2, window.innerHeight / 2);
    app.stage.addChild(deathText);

    const pauseText = new PIXI.Text({
        text: 'Paused\nPress ESC to resume',
        style: {
            fill: '#f3e6a1',
            fontFamily: 'monospace',
            fontSize: 26,
            align: 'center'
        }
    });
    pauseText.anchor.set(0.5);
    pauseText.visible = false;
    pauseText.position.set(window.innerWidth / 2, window.innerHeight / 2);
    app.stage.addChild(pauseText);

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
        hudText.text = `Weapon: ${playerCombat.weapon}\nKills: ${combatStats.enemiesKilled}\nGold: ${inventory.gold}\nWood: ${inventory.wood}\nStone: ${inventory.stone}\nIron: ${inventory.iron}`;
    }

    function updateHealthHud() {
        const barX = 16;
        const barY = 16;
        const barWidth = 240;
        const barHeight = 18;
        const ratio = Math.max(0, Math.min(1, playerState.hp / playerState.maxHp));

        healthBarBackground.clear();
        healthBarBackground.rect(barX, barY, barWidth, barHeight);
        healthBarBackground.fill(0x2a2a2a);
        healthBarBackground.stroke({ width: 1, color: 0x000000 });

        healthBarFill.clear();
        healthBarFill.rect(barX, barY, barWidth * ratio, barHeight);
        healthBarFill.fill(0xd94b4b);

        healthText.text = `HP: ${Math.max(0, Math.ceil(playerState.hp))}/${playerState.maxHp}`;
        healthText.position.set(barX + 8, barY + 1);
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
        const worldStats = worldSystem.getStats();

        const lines = [
            'DEV CONSOLE (F4 or `)',
            `FPS: ${smoothedFps.toFixed(1)} | Frame: ${frameMs.toFixed(2)} ms`,
            `Player HP: ${Math.ceil(playerState.hp)}/${playerState.maxHp} | Weapon: ${playerCombat.weapon}`,
            `Enemies: ${enemies.length}/${ENEMY_MAX_COUNT}`,
            `Bullets: ${projectiles.length}/${MAX_BULLETS}`,
            `Path req/exe/def: ${framePathRequests}/${framePathExecuted}/${framePathDeferred}`,
            `Path budget/frame: ${ENEMY_MAX_REPATHS_PER_FRAME}`,
            `Tiles cached: ${worldStats.tilesCached}`,
            `Resources active: ${worldStats.resourcesActive}`,
            `Water feature regions: ${worldStats.waterFeatureRegions}`
        ];

        if (debugLogs.length > 0) {
            lines.push('Logs:');
            for (const entry of debugLogs) {
                lines.push(entry);
            }
        }

        debugText.text = lines.join('\n');
    }

    function removeProjectileAt(index) {
        const projectile = projectiles[index];
        projectile.sprite.destroy();
        projectiles.splice(index, 1);
    }

    function applyDamage(target, amount, source) {
        if (!target || target.isDead || amount <= 0) {
            return false;
        }
        if ((target.invulnFrames ?? 0) > 0) {
            return false;
        }

        target.hp = Math.max(0, target.hp - amount);
        target.invulnFrames = target === playerState ? PLAYER_INVULN_FRAMES : INVULN_FRAMES_ON_HIT;

        if (target === playerState) {
            playerHitFlashFrames = 8;
            updateHealthHud();
        } else if (target.healthBg && target.healthFill) {
            updateEnemyHealthBar(target);
        }

        if (target.hp <= 0) {
            target.isDead = true;
            if (target === playerState) {
                deathText.visible = true;
                logDebug(`Player defeated by ${source}`);
            } else {
                combatStats.enemiesKilled += 1;
                inventory.gold += GOLD_PER_ENEMY_KILL;
                updateHud();
            }
        }

        return true;
    }

    function performSwordAttack(playerCenterX, playerCenterY, dirX, dirY) {
        const cfg = WEAPONS.sword;
        const cosHalfArc = Math.cos(cfg.arcRadians / 2);
        swordSwingState.ttl = swordSwingState.maxTtl;
        swordSwingState.angle = Math.atan2(dirY, dirX);

        for (const enemy of enemies) {
            if (enemy.isDead) {
                continue;
            }
            const enemyCenterX = enemy.x + ENEMY_RADIUS;
            const enemyCenterY = enemy.y + ENEMY_RADIUS;
            const dx = enemyCenterX - playerCenterX;
            const dy = enemyCenterY - playerCenterY;
            const dist = Math.hypot(dx, dy);
            if (dist > cfg.range + ENEMY_RADIUS || dist <= 0.001) {
                continue;
            }

            const nx = dx / dist;
            const ny = dy / dist;
            const dot = nx * dirX + ny * dirY;
            if (dot < cosHalfArc) {
                continue;
            }

            const hit = applyDamage(enemy, cfg.damage, 'sword');
            if (hit) {
                enemy.knockbackVX += nx * cfg.knockbackSpeed;
                enemy.knockbackVY += ny * cfg.knockbackSpeed;
            }
        }
    }

    function spawnBullet(playerCenterX, playerCenterY, dirX, dirY) {
        if (projectiles.length >= MAX_BULLETS) {
            return;
        }

        const cfg = WEAPONS.pistol;
        const sprite = createBulletSprite();
        const bullet = {
            x: playerCenterX - 4,
            y: playerCenterY - 4,
            vx: dirX * cfg.bulletSpeed,
            vy: dirY * cfg.bulletSpeed,
            ttl: cfg.bulletLifetimeFrames,
            damage: cfg.damage,
            sprite
        };
        sprite.position.set(bullet.x, bullet.y);
        projectileLayer.addChild(sprite);
        projectiles.push(bullet);
    }

    function performAttack(playerCenterX, playerCenterY) {
        const mag = Math.hypot(playerCombat.facingX, playerCombat.facingY);
        const dirX = mag > 0.001 ? playerCombat.facingX / mag : 1;
        const dirY = mag > 0.001 ? playerCombat.facingY / mag : 0;

        if (playerCombat.weapon === 'sword') {
            performSwordAttack(playerCenterX, playerCenterY, dirX, dirY);
            playerCombat.cooldownFrames = WEAPONS.sword.cooldownFrames;
        } else {
            spawnBullet(playerCenterX, playerCenterY, dirX, dirY);
            playerCombat.cooldownFrames = WEAPONS.pistol.cooldownFrames;
        }
    }

    function updateProjectiles(deltaMoveScale) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const bullet = projectiles[i];
            bullet.ttl -= 1;
            bullet.x += bullet.vx * deltaMoveScale;
            bullet.y += bullet.vy * deltaMoveScale;
            bullet.sprite.position.set(bullet.x, bullet.y);

            if (bullet.ttl <= 0) {
                removeProjectileAt(i);
                continue;
            }

            const bulletCenterX = bullet.x + 4;
            const bulletCenterY = bullet.y + 4;
            const bulletTileX = Math.floor(bulletCenterX / TILE_SIZE);
            const bulletTileY = Math.floor(bulletCenterY / TILE_SIZE);
            if (!isTileWalkable(bulletTileX, bulletTileY)) {
                removeProjectileAt(i);
                continue;
            }

            let hitEnemy = false;
            for (const enemy of enemies) {
                if (enemy.isDead) {
                    continue;
                }
                const dx = (enemy.x + ENEMY_RADIUS) - bulletCenterX;
                const dy = (enemy.y + ENEMY_RADIUS) - bulletCenterY;
                const hitDistance = ENEMY_RADIUS + 4;
                if (dx * dx + dy * dy <= hitDistance * hitDistance) {
                    applyDamage(enemy, bullet.damage, 'bullet');
                    hitEnemy = true;
                    break;
                }
            }

            if (hitEnemy) {
                removeProjectileAt(i);
            }
        }
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
    let harvestRequested = false;
    let leftMouseDown = false;
    let mouseScreenX = window.innerWidth / 2;
    let mouseScreenY = window.innerHeight / 2;

    updateHud();
    updateHealthHud();
    updateVisibleWorld();

    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        keys[key] = true;
        if (key === 'escape') {
            isPaused = !isPaused;
            pauseText.visible = isPaused;
            logDebug(`Game ${isPaused ? 'paused' : 'resumed'}`);
            e.preventDefault();
            return;
        }
        if (key === 'f4' || key === 'ç') {
            debugOverlayEnabled = !debugOverlayEnabled;
            debugText.visible = debugOverlayEnabled;
            worldSystem.refreshVisibleTileGridlines();
            logDebug(`Debug console ${debugOverlayEnabled ? 'enabled' : 'disabled'}`);
        }
        if (key === 'e') {
            harvestRequested = true;
        }
        if (key === '1') {
            playerCombat.weapon = 'sword';
            updateHud();
        } else if (key === '2') {
            playerCombat.weapon = 'pistol';
            updateHud();
        }
        if (key === ' ' || key === 'space') {
            keys.attack = true;
        }
        if (key === 'r' && playerState.isDead) {
            playerState.hp = playerState.maxHp;
            playerState.invulnFrames = 0;
            playerState.isDead = false;
            combatStats.enemiesKilled = 0;
            inventory.gold = 0;
            deathText.visible = false;
            const respawn = findSafeSpawnPosition();
            playerWorldX = respawn.x;
            playerWorldY = respawn.y;
            resetCombatEntities();
            updateHud();
            updateHealthHud();
            logDebug('Player restarted');
        }
    });

    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        keys[key] = false;
        if (key === ' ' || key === 'space') {
            keys.attack = false;
        }
    });

    app.canvas.addEventListener('contextmenu', (e) => {
        // Disable RMB behavior for now to avoid browser/game conflicts.
        e.preventDefault();
    });

    app.canvas.addEventListener('mousemove', (e) => {
        mouseScreenX = e.clientX;
        mouseScreenY = e.clientY;
    });

    app.canvas.addEventListener('mousedown', (e) => {
        mouseScreenX = e.clientX;
        mouseScreenY = e.clientY;
        if (e.button === 2) {
            e.preventDefault();
            return;
        }
        if (e.button === 0) {
            leftMouseDown = true;
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
            leftMouseDown = false;
        }
    });

    app.ticker.add((delta) => {
        const frameMs = delta.deltaMS;
        const fps = frameMs > 0 ? 1000 / frameMs : 0;
        smoothedFps = smoothedFps * 0.9 + fps * 0.1;
        framePathRequests = 0;
        framePathExecuted = 0;
        framePathDeferred = 0;
        framePathBudget = ENEMY_MAX_REPATHS_PER_FRAME;

        const aimDx = mouseScreenX - window.innerWidth / 2;
        const aimDy = mouseScreenY - window.innerHeight / 2;
        const aimMagnitude = Math.hypot(aimDx, aimDy);
        if (aimMagnitude > 0.001) {
            playerCombat.facingX = aimDx / aimMagnitude;
            playerCombat.facingY = aimDy / aimMagnitude;
        }

        const playerScreenCenterX = player.position.x + PLAYER_COLLISION_RADIUS;
        const playerScreenCenterY = player.position.y + PLAYER_COLLISION_RADIUS;
        aimIndicator.rotation = Math.atan2(playerCombat.facingY, playerCombat.facingX);
        aimIndicator.position.set(
            playerScreenCenterX + playerCombat.facingX * 22,
            playerScreenCenterY + playerCombat.facingY * 22
        );
        if (swordSwingState.ttl > 0) {
            const progress = 1 - swordSwingState.ttl / swordSwingState.maxTtl;
            drawSwordSwing(swordSwingSprite, playerScreenCenterX, playerScreenCenterY, swordSwingState.angle, progress);
            swordSwingState.ttl -= 1;
            swordSwingSprite.visible = true;
        } else {
            swordSwingSprite.visible = false;
        }

        if (isPaused) {
            updateDebugOverlay(frameMs);
            return;
        }

        const deltaMoveScale = delta.deltaTime / 60;
        const moveDistance = PLAYER_SPEED * deltaMoveScale;
        let newWorldX = playerWorldX;
        let newWorldY = playerWorldY;

        if (playerState.invulnFrames > 0) {
            playerState.invulnFrames -= 1;
        }
        if (playerCombat.cooldownFrames > 0) {
            playerCombat.cooldownFrames -= 1;
        }

        if (!playerState.isDead) {
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
        }

        const centerX = newWorldX + TILE_SIZE / 2;
        const centerY = newWorldY + TILE_SIZE / 2;
        const tileX = Math.floor(centerX / TILE_SIZE);
        const tileY = Math.floor(centerY / TILE_SIZE);

        if (!playerState.isDead && !worldSystem.isTileWater(tileX, tileY)) {
            playerWorldX = newWorldX;
            playerWorldY = newWorldY;
        }

        world.position.x = window.innerWidth / 2 - playerWorldX - 16;
        world.position.y = window.innerHeight / 2 - playerWorldY - 16;

        updateVisibleWorld();
        if (!playerState.isDead) {
            updateEnemySpawning();
        }
        updateEnemies(deltaMoveScale);
        updateProjectiles(deltaMoveScale);

        // Re-apply camera in case enemy collision resolution pushed the player.
        world.position.x = window.innerWidth / 2 - playerWorldX - 16;
        world.position.y = window.innerHeight / 2 - playerWorldY - 16;

        if (!playerState.isDead && (keys.attack || leftMouseDown) && playerCombat.cooldownFrames <= 0) {
            performAttack(playerWorldX + TILE_SIZE / 2, playerWorldY + TILE_SIZE / 2);
        }

        if (!playerState.isDead && harvestRequested) {
            harvestRequested = false;

            const playerCenterX = playerWorldX + TILE_SIZE / 2;
            const playerCenterY = playerWorldY + TILE_SIZE / 2;
            const harvest = worldSystem.tryHarvestNearest(playerCenterX, playerCenterY);
            if (harvest && inventory[harvest.resourceType] !== undefined) {
                inventory[harvest.resourceType] += 1;
                spawnHarvestFeedback(harvest.resourceType, harvest.tileX, harvest.tileY);
                updateHud();
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
        player.position.set(window.innerWidth / 2 - 16, window.innerHeight / 2 - 16);
        debugText.position.set(window.innerWidth - 360, 16);
        deathText.position.set(window.innerWidth / 2, window.innerHeight / 2);
        pauseText.position.set(window.innerWidth / 2, window.innerHeight / 2);
        updateVisibleWorld();
    });

    console.log('Purrmadeath initialized');
}

init();
