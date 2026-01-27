import { TILE_SIZE } from '../config/constants.js';

// Collision helper module for civilian crowd movement and player-crowd interactions.
export function resolveCivilianCollisions(options) {
    const {
        civilians,
        isTileWalkable,
        civilianRadius,
        separationPadding,
        separationPasses,
        denseThreshold,
        perfStats
    } = options;
    if (civilians.length <= 1) {
        return;
    }
    const denseMode = civilians.length >= denseThreshold;
    const minDistance = civilianRadius * 2 + separationPadding;
    const minDistanceSq = minDistance * minDistance;
    const cellSize = minDistance;
    const maxPasses = denseMode ? 2 : separationPasses;
    let separatedCount = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
        const grid = new Map();
        for (let i = 0; i < civilians.length; i++) {
            const civilian = civilians[i];
            if (civilian.isDead) {
                continue;
            }
            const cx = Math.floor((civilian.x + civilianRadius) / cellSize);
            const cy = Math.floor((civilian.y + civilianRadius) / cellSize);
            const key = `${cx},${cy}`;
            if (!grid.has(key)) {
                grid.set(key, []);
            }
            grid.get(key).push(i);
        }

        for (let i = 0; i < civilians.length; i++) {
            const base = civilians[i];
            if (base.isDead) {
                continue;
            }
            const bxCell = Math.floor((base.x + civilianRadius) / cellSize);
            const byCell = Math.floor((base.y + civilianRadius) / cellSize);
            for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    const bucket = grid.get(`${bxCell + ox},${byCell + oy}`);
                    if (!bucket) {
                        continue;
                    }
                    for (const j of bucket) {
                        if (j <= i) {
                            continue;
                        }
                        const a = civilians[i];
                        const b = civilians[j];
                        if (a.isDead || b.isDead) {
                            continue;
                        }
                        const ax = a.x + civilianRadius;
                        const ay = a.y + civilianRadius;
                        const bx = b.x + civilianRadius;
                        const by = b.y + civilianRadius;
                        let dx = bx - ax;
                        let dy = by - ay;
                        let distSq = dx * dx + dy * dy;
                        if (distSq >= minDistanceSq) {
                            continue;
                        }
                        if (distSq < 0.0001) {
                            const angle = (a.id * 0.43 + b.id * 0.79) % (Math.PI * 2);
                            dx = Math.cos(angle);
                            dy = Math.sin(angle);
                            distSq = 1;
                        }
                        const dist = Math.sqrt(distSq);
                        const overlap = minDistance - dist;
                        const nx = dx / dist;
                        const ny = dy / dist;
                        separatedCount += 1;
                        const halfPushX = nx * overlap * 0.65;
                        const halfPushY = ny * overlap * 0.65;
                        const newAX = a.x - halfPushX;
                        const newAY = a.y - halfPushY;
                        const newBX = b.x + halfPushX;
                        const newBY = b.y + halfPushY;
                        const aTileX = Math.floor((newAX + civilianRadius) / TILE_SIZE);
                        const aTileY = Math.floor((newAY + civilianRadius) / TILE_SIZE);
                        const bTileX = Math.floor((newBX + civilianRadius) / TILE_SIZE);
                        const bTileY = Math.floor((newBY + civilianRadius) / TILE_SIZE);
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
    perfStats.collisionPasses = maxPasses;
    perfStats.civiliansResolvedCollisions = separatedCount;
    for (const civilian of civilians) {
        civilian.sprite.position.set(civilian.x, civilian.y);
    }
}

export function resolvePlayerCivilianCollision(options) {
    const {
        civilians,
        isTileWalkable,
        civilianRadius,
        playerCenterX,
        playerCenterY,
        playerRadius,
        applyPlayerPush
    } = options;
    const minDistance = playerRadius + civilianRadius;
    const minDistanceSq = minDistance * minDistance;
    let collisions = 0;

    for (const civilian of civilians) {
        if (civilian.isDead) {
            continue;
        }
        const cx = civilian.x + civilianRadius;
        const cy = civilian.y + civilianRadius;
        let dx = cx - playerCenterX;
        let dy = cy - playerCenterY;
        let distSq = dx * dx + dy * dy;
        if (distSq >= minDistanceSq) {
            continue;
        }
        if (distSq < 0.0001) {
            const angle = (civilian.id * 0.53) % (Math.PI * 2);
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distSq = 1;
        }

        collisions += 1;
        const dist = Math.sqrt(distSq);
        const overlap = minDistance - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        const pushCivilian = overlap * 0.85;
        const targetCivilianX = civilian.x + nx * pushCivilian;
        const targetCivilianY = civilian.y + ny * pushCivilian;
        const civilianTileX = Math.floor((targetCivilianX + civilianRadius) / TILE_SIZE);
        const civilianTileY = Math.floor((targetCivilianY + civilianRadius) / TILE_SIZE);
        if (isTileWalkable(civilianTileX, civilianTileY)) {
            civilian.x = targetCivilianX;
            civilian.y = targetCivilianY;
            civilian.sprite.position.set(civilian.x, civilian.y);
        } else {
            applyPlayerPush(-nx * overlap * 0.6, -ny * overlap * 0.6);
        }
    }

    return collisions;
}
