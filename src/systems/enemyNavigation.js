export function findPathAStar(startX, startY, goalX, goalY, options) {
    const {
        isTileWalkable,
        gridRadius,
        maxSteps
    } = options;
    if (startX === goalX && startY === goalY) {
        return [];
    }

    const minX = Math.min(startX, goalX) - gridRadius;
    const maxX = Math.max(startX, goalX) + gridRadius;
    const minY = Math.min(startY, goalY) - gridRadius;
    const maxY = Math.max(startY, goalY) + gridRadius;

    const estimatePathCost = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);
    const reconstructPath = (cameFrom, endKey) => {
        const path = [];
        let currentKey = endKey;
        while (currentKey) {
            const [x, y] = currentKey.split(',').map(Number);
            path.push({ x, y });
            currentKey = cameFrom.get(currentKey);
        }
        path.reverse();
        return path.slice(1);
    };

    const startKey = `${startX},${startY}`;
    const goalKey = `${goalX},${goalY}`;
    const open = [{ key: startKey, x: startX, y: startY, f: estimatePathCost(startX, startY, goalX, goalY) }];
    const openKeys = new Set([startKey]);
    const closedKeys = new Set();
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);

    let steps = 0;
    while (open.length > 0 && steps < maxSteps) {
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

export function tryGetOffscreenSpawnTile(options) {
    const {
        getWorldPosition,
        getViewportSize,
        tileSize,
        offscreenMarginTiles,
        getPlayerTile,
        minPlayerDistanceTiles,
        isTileWalkable
    } = options;
    const worldPos = getWorldPosition();
    const viewport = getViewportSize();
    const startTileX = Math.floor(-worldPos.x / tileSize);
    const startTileY = Math.floor(-worldPos.y / tileSize);
    const endTileX = startTileX + Math.ceil(viewport.width / tileSize);
    const endTileY = startTileY + Math.ceil(viewport.height / tileSize);
    const minX = startTileX - offscreenMarginTiles;
    const maxX = endTileX + offscreenMarginTiles;
    const minY = startTileY - offscreenMarginTiles;
    const maxY = endTileY + offscreenMarginTiles;
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
        const inView = tileX >= startTileX && tileX <= endTileX && tileY >= startTileY && tileY <= endTileY;
        if (inView || !isTileWalkable(tileX, tileY)) {
            continue;
        }
        const dx = tileX - playerTile.x;
        const dy = tileY - playerTile.y;
        if ((dx * dx + dy * dy) < minPlayerDistanceTiles * minPlayerDistanceTiles) {
            continue;
        }
        return { x: tileX, y: tileY };
    }
    return null;
}

export function findPathToNearestWall(enemyTileX, enemyTileY, enemyId, getWalls, isTileWalkable, pathfinder) {
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

    const maxWallsToProbe = Math.min(4, rankedWalls.length);
    const wallOffset = Math.abs(enemyId) % Math.max(1, maxWallsToProbe);
    for (let wi = 0; wi < maxWallsToProbe; wi++) {
        const wall = rankedWalls[(wi + wallOffset) % maxWallsToProbe].wall;
        for (const tile of wall.tiles) {
            const candidates = [
                { x: tile.x + 1, y: tile.y },
                { x: tile.x - 1, y: tile.y },
                { x: tile.x, y: tile.y + 1 },
                { x: tile.x, y: tile.y - 1 }
            ];
            const candidateOffset = Math.abs(enemyId + tile.x * 31 + tile.y * 17) % candidates.length;
            for (let ci = 0; ci < candidates.length; ci++) {
                const candidate = candidates[(ci + candidateOffset) % candidates.length];
                if (!isTileWalkable(candidate.x, candidate.y)) {
                    continue;
                }
                const path = pathfinder(enemyTileX, enemyTileY, candidate.x, candidate.y);
                if (path.length > 0) {
                    return { path, targetTile: candidate };
                }
            }
        }
    }
    return { path: [], targetTile: null };
}
