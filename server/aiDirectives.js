// AI targeting and directive computation.
// Pure functions — all mutable state is passed as arguments so this module has no side effects.

'use strict';

function getBuildingFootprint(type, BUILDING_RULES) {
    const rule = BUILDING_RULES[type] ?? { footprint: { w: 1, h: 1 } };
    return {
        w: Math.max(1, Math.floor(Number(rule.footprint?.w) || 1)),
        h: Math.max(1, Math.floor(Number(rule.footprint?.h) || 1))
    };
}

function getBuildingCenterFromSnapshot(building, BUILDING_RULES, SERVER_TILE_SIZE) {
    const fp = getBuildingFootprint(building?.type, BUILDING_RULES);
    const tileX = Math.floor(Number(building?.tileX) || 0);
    const tileY = Math.floor(Number(building?.tileY) || 0);
    return {
        x: (tileX + fp.w * 0.5) * SERVER_TILE_SIZE,
        y: (tileY + fp.h * 0.5) * SERVER_TILE_SIZE
    };
}

// Compute AI directives for towers (target enemy), ranged enemies (target player/civilian),
// and civilians (haul from producer to warehouse). Returns a directives object.
// consts: { SERVER_ENEMY_RADIUS, SERVER_TILE_SIZE }
function computeServerAiDirectives(nonPlayerState, currentTick, BUILDING_RULES, consts) {
    const { SERVER_ENEMY_RADIUS, SERVER_TILE_SIZE } = consts;
    const directives = {
        tick: currentTick,
        towers: {},
        rangedEnemies: {},
        civilians: {}
    };
    const enemies = Array.isArray(nonPlayerState.enemies) ? nonPlayerState.enemies : [];
    const buildings = Array.isArray(nonPlayerState.buildingsState?.buildings) ? nonPlayerState.buildingsState.buildings : [];
    const civilians = Array.isArray(nonPlayerState.civilians) ? nonPlayerState.civilians : [];
    const playerStates = Array.isArray(nonPlayerState.playerStates) ? nonPlayerState.playerStates : [];

    const aliveEnemies = enemies.filter((enemy) => (Number(enemy?.hp) || 0) > 0);
    const towers = buildings.filter((building) => building?.type === 'combatTower');
    for (const tower of towers) {
        const towerId = Math.floor(Number(tower?.id) || 0);
        if (towerId <= 0) {
            continue;
        }
        const center = getBuildingCenterFromSnapshot(tower, BUILDING_RULES, SERVER_TILE_SIZE);
        const rangeSq = 260 * 260;
        let bestEnemyId = null;
        let bestHp = -1;
        let bestDistSq = rangeSq;
        for (const enemy of aliveEnemies) {
            const enemyId = Math.floor(Number(enemy?.id) || 0);
            if (enemyId <= 0) {
                continue;
            }
            const dx = (Number(enemy.x) + SERVER_ENEMY_RADIUS) - center.x;
            const dy = (Number(enemy.y) + SERVER_ENEMY_RADIUS) - center.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > rangeSq) {
                continue;
            }
            const hp = Math.max(0, Number(enemy.hp) || 0);
            if (hp > bestHp || (hp === bestHp && distSq < bestDistSq)) {
                bestHp = hp;
                bestDistSq = distSq;
                bestEnemyId = enemyId;
            }
        }
        if (bestEnemyId !== null) {
            directives.towers[String(towerId)] = bestEnemyId;
        }
    }

    const alivePlayers = playerStates.filter((entry) => !entry?.isDead);
    const aliveCivilians = civilians.filter((entry) => !entry?.isDead);
    for (const enemy of aliveEnemies) {
        if (!enemy?.isRanged) {
            continue;
        }
        const enemyId = Math.floor(Number(enemy?.id) || 0);
        if (enemyId <= 0) {
            continue;
        }
        const enemyX = Number(enemy.x) + SERVER_ENEMY_RADIUS;
        const enemyY = Number(enemy.y) + SERVER_ENEMY_RADIUS;
        let best = null;
        let bestDistSq = Infinity;
        for (const player of alivePlayers) {
            const playerId = Math.floor(Number(player?.playerId) || 0);
            if (playerId <= 0) {
                continue;
            }
            const dx = Number(player.x) - enemyX;
            const dy = Number(player.y) - enemyY;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                best = { type: 'player', id: playerId };
            }
        }
        for (const civilian of aliveCivilians) {
            const civilianId = Math.floor(Number(civilian?.id) || 0);
            if (civilianId <= 0) {
                continue;
            }
            const dx = Number(civilian.x) - enemyX;
            const dy = Number(civilian.y) - enemyY;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                best = { type: 'civilian', id: civilianId };
            }
        }
        if (best) {
            directives.rangedEnemies[String(enemyId)] = best;
        }
    }

    const producers = buildings.filter((building) => {
        if (!building) {
            return false;
        }
        if (building.type !== 'lumberMill' && building.type !== 'stoneQuarry' && building.type !== 'ironMine') {
            return false;
        }
        return (Number(building.storedOutput) || 0) > 0;
    });
    const warehouses = buildings.filter((building) => building?.type === 'warehouse');
    if (producers.length > 0 && warehouses.length > 0) {
        const producerLoad = new Map();
        for (const civilian of aliveCivilians) {
            const civilianId = Math.floor(Number(civilian?.id) || 0);
            if (civilianId <= 0) {
                continue;
            }
            const cx = Number(civilian.x) || 0;
            const cy = Number(civilian.y) || 0;
            let bestProducer = null;
            let bestScore = -Infinity;
            for (const producer of producers) {
                const producerId = Math.floor(Number(producer?.id) || 0);
                if (producerId <= 0) {
                    continue;
                }
                const pCenter = getBuildingCenterFromSnapshot(producer, BUILDING_RULES, SERVER_TILE_SIZE);
                const dx = pCenter.x - cx;
                const dy = pCenter.y - cy;
                const dist = Math.hypot(dx, dy);
                const output = Math.max(0, Number(producer.storedOutput) || 0);
                const load = producerLoad.get(producerId) ?? 0;
                const score = output * 1000 - dist - load * 240;
                if (score > bestScore) {
                    bestScore = score;
                    bestProducer = producer;
                }
            }
            if (!bestProducer) {
                continue;
            }
            const bestProducerId = Math.floor(Number(bestProducer.id) || 0);
            producerLoad.set(bestProducerId, (producerLoad.get(bestProducerId) ?? 0) + 1);
            let bestWarehouseId = null;
            let bestWarehouseDist = Infinity;
            for (const warehouse of warehouses) {
                const warehouseId = Math.floor(Number(warehouse?.id) || 0);
                if (warehouseId <= 0) {
                    continue;
                }
                const wCenter = getBuildingCenterFromSnapshot(warehouse, BUILDING_RULES, SERVER_TILE_SIZE);
                const dx = wCenter.x - cx;
                const dy = wCenter.y - cy;
                const dist = dx * dx + dy * dy;
                if (dist < bestWarehouseDist) {
                    bestWarehouseDist = dist;
                    bestWarehouseId = warehouseId;
                }
            }
            if (bestWarehouseId !== null) {
                directives.civilians[String(civilianId)] = {
                    producerId: bestProducerId,
                    warehouseId: bestWarehouseId
                };
            }
        }
    }

    return directives;
}

// consts: { SERVER_SWORD_RANGE, SERVER_SWORD_ARC_RADIANS, SERVER_ENEMY_RADIUS }
function findPlausibleSwordTarget(action, enemies, consts) {
    const { SERVER_SWORD_RANGE, SERVER_SWORD_ARC_RADIANS, SERVER_ENEMY_RADIUS } = consts;
    if (!Array.isArray(enemies) || enemies.length === 0) {
        return null;
    }
    const originX = Number(action.originX);
    const originY = Number(action.originY);
    const dirX = Number(action.dirX);
    const dirY = Number(action.dirY);
    const mag = Math.hypot(dirX, dirY);
    if (!Number.isFinite(originX) || !Number.isFinite(originY) || mag <= 0.0001) {
        return null;
    }
    const nx = dirX / mag;
    const ny = dirY / mag;
    const cosHalfArc = Math.cos(SERVER_SWORD_ARC_RADIANS / 2);
    const maxDist = SERVER_SWORD_RANGE + SERVER_ENEMY_RADIUS;
    let best = null;
    let bestDist = Infinity;

    for (const enemy of enemies) {
        const enemyId = Math.floor(Number(enemy?.id) || 0);
        const enemyCenterX = Number(enemy?.x) + SERVER_ENEMY_RADIUS;
        const enemyCenterY = Number(enemy?.y) + SERVER_ENEMY_RADIUS;
        if (enemyId <= 0 || !Number.isFinite(enemyCenterX) || !Number.isFinite(enemyCenterY)) {
            continue;
        }
        const dx = enemyCenterX - originX;
        const dy = enemyCenterY - originY;
        const dist = Math.hypot(dx, dy);
        if (dist > maxDist || dist <= 0.001) {
            continue;
        }
        const tx = dx / dist;
        const ty = dy / dist;
        const dot = tx * nx + ty * ny;
        if (dot < cosHalfArc) {
            continue;
        }
        if (dist < bestDist) {
            bestDist = dist;
            best = { enemyId };
        }
    }
    return best;
}

// consts: { SERVER_PISTOL_RANGE, SERVER_PISTOL_AIM_COS, SERVER_ENEMY_RADIUS }
function findPlausiblePistolTarget(action, enemies, consts) {
    const { SERVER_PISTOL_RANGE, SERVER_PISTOL_AIM_COS, SERVER_ENEMY_RADIUS } = consts;
    if (!Array.isArray(enemies) || enemies.length === 0) {
        return null;
    }
    const originX = Number(action.originX);
    const originY = Number(action.originY);
    const dirX = Number(action.dirX);
    const dirY = Number(action.dirY);
    const mag = Math.hypot(dirX, dirY);
    if (!Number.isFinite(originX) || !Number.isFinite(originY) || mag <= 0.0001) {
        return null;
    }
    const nx = dirX / mag;
    const ny = dirY / mag;
    let best = null;
    let bestDist = Infinity;

    for (const enemy of enemies) {
        const enemyId = Math.floor(Number(enemy?.id) || 0);
        const enemyCenterX = Number(enemy?.x) + SERVER_ENEMY_RADIUS;
        const enemyCenterY = Number(enemy?.y) + SERVER_ENEMY_RADIUS;
        if (enemyId <= 0 || !Number.isFinite(enemyCenterX) || !Number.isFinite(enemyCenterY)) {
            continue;
        }
        const dx = enemyCenterX - originX;
        const dy = enemyCenterY - originY;
        const dist = Math.hypot(dx, dy);
        if (dist <= 0.001 || dist > SERVER_PISTOL_RANGE) {
            continue;
        }
        const tx = dx / dist;
        const ty = dy / dist;
        const dot = tx * nx + ty * ny;
        if (dot < SERVER_PISTOL_AIM_COS) {
            continue;
        }
        if (dist < bestDist) {
            bestDist = dist;
            best = { enemyId };
        }
    }
    return best;
}

module.exports = {
    getBuildingFootprint,
    getBuildingCenterFromSnapshot,
    computeServerAiDirectives,
    findPlausibleSwordTarget,
    findPlausiblePistolTarget
};
