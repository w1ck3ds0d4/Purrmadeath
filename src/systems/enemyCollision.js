export function resolveEnemyCollisions(options) {
    const {
        enemies,
        enemyRadius,
        tileSize,
        isTileWalkable,
        frameIndex,
        perfStats,
        highDensityThreshold = 120,
        highDensityStride = 2
    } = options;
    const minDistance = enemyRadius * 2;
    const minDistanceSq = minDistance * minDistance;
    const cellSize = minDistance;
    const separationPasses = 2;
    if (enemies.length >= highDensityThreshold && (frameIndex % highDensityStride) !== 0) {
        perfStats.collisionSkippedFrames += 1;
        return;
    }

    for (let pass = 0; pass < separationPasses; pass++) {
        const grid = new Map();
        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            const cx = Math.floor((enemy.x + enemyRadius) / cellSize);
            const cy = Math.floor((enemy.y + enemyRadius) / cellSize);
            const key = `${cx},${cy}`;
            if (!grid.has(key)) {
                grid.set(key, []);
            }
            grid.get(key).push(i);
        }

        for (let i = 0; i < enemies.length; i++) {
            const base = enemies[i];
            const bxCell = Math.floor((base.x + enemyRadius) / cellSize);
            const byCell = Math.floor((base.y + enemyRadius) / cellSize);
            for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    const neighborKey = `${bxCell + ox},${byCell + oy}`;
                    const bucket = grid.get(neighborKey);
                    if (!bucket) {
                        continue;
                    }
                    for (const j of bucket) {
                        if (j <= i) {
                            continue;
                        }
                        const a = enemies[i];
                        const b = enemies[j];
                        const ax = a.x + enemyRadius;
                        const ay = a.y + enemyRadius;
                        const bx = b.x + enemyRadius;
                        const by = b.y + enemyRadius;
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
                        const halfPushX = nx * overlap * 0.6;
                        const halfPushY = ny * overlap * 0.6;
                        const newAX = a.x - halfPushX;
                        const newAY = a.y - halfPushY;
                        const newBX = b.x + halfPushX;
                        const newBY = b.y + halfPushY;
                        const aTileX = Math.floor((newAX + enemyRadius) / tileSize);
                        const aTileY = Math.floor((newAY + enemyRadius) / tileSize);
                        const bTileX = Math.floor((newBX + enemyRadius) / tileSize);
                        const bTileY = Math.floor((newBY + enemyRadius) / tileSize);
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
        }
    }
}

export function resolvePlayerEnemyCollisions(options) {
    const {
        enemies,
        enemyRadius,
        tileSize,
        isTileWalkable,
        isPlayerDead,
        getPlayerCollisionRadius,
        getPlayerCenter,
        setPlayerWorldPosition,
        canMovePlayerTo
    } = options;
    if (isPlayerDead()) {
        return;
    }
    const minDistance = enemyRadius + getPlayerCollisionRadius();
    const minDistanceSq = minDistance * minDistance;
    let player = getPlayerCenter();
    for (const enemy of enemies) {
        const enemyCenterX = enemy.x + enemyRadius;
        const enemyCenterY = enemy.y + enemyRadius;
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
        const pushedPlayerX = (player.x - tileSize / 2) - nx * overlap;
        const pushedPlayerY = (player.y - tileSize / 2) - ny * overlap;
        if (canMovePlayerTo(pushedPlayerX, pushedPlayerY)) {
            setPlayerWorldPosition(pushedPlayerX, pushedPlayerY);
            player = getPlayerCenter();
        } else {
            const pushedEnemyX = enemy.x + nx * overlap;
            const pushedEnemyY = enemy.y + ny * overlap;
            const pushedEnemyTileX = Math.floor((pushedEnemyX + enemyRadius) / tileSize);
            const pushedEnemyTileY = Math.floor((pushedEnemyY + enemyRadius) / tileSize);
            if (isTileWalkable(pushedEnemyTileX, pushedEnemyTileY)) {
                enemy.x = pushedEnemyX;
                enemy.y = pushedEnemyY;
                enemy.sprite.position.set(enemy.x, enemy.y);
            }
        }
    }
}
