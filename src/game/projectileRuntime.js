// Projectile runtime handles pooling, combat projectiles, and replication-safe sync.
export function createProjectileRuntime(deps) {
    const {
        PIXI,
        projectileLayer,
        enemies,
        multiplayerClient,
        multiplayerPlayerRuntime,
        playerSystem,
        playerState,
        buildingSystem,
        civilianSystem,
        enemySpatialIndex,
        civilianSpatialIndex,
        querySpatialIndexInto,
        ensureRuntimePlayer,
        applyDamage,
        updateHud,
        constants
    } = deps;

    const {
        ENEMY_RADIUS,
        MAX_BULLETS,
        MAX_ENEMY_PROJECTILES,
        MAX_TOWER_PROJECTILES,
        PLAYER_COLLISION_RADIUS,
        PLAYER_RESPAWN_SECONDS,
        PROJECTILES,
        TILE_SIZE,
        WEAPONS
    } = constants;

    const projectiles = [];
    const towerProjectiles = [];
    const enemyProjectiles = [];
    const projectileObjectPool = [];
    const projectileSpritePools = {
        player: [],
        tower: [],
        enemy: []
    };
    let nextProjectileReplicationId = 1;

    function createBulletSprite(fillColor = 0xf7e56a, strokeColor = 0x2a2409, radius = 4) {
        const sprite = new PIXI.Graphics();
        sprite.circle(radius, radius, radius);
        sprite.fill(fillColor);
        sprite.stroke({ width: 1, color: strokeColor });
        return sprite;
    }

    function acquireProjectileSprite(team) {
        const pool = projectileSpritePools[team];
        if (pool && pool.length > 0) {
            const sprite = pool.pop();
            sprite.visible = true;
            return sprite;
        }
        if (team === 'tower') {
            return createBulletSprite(0xb08bff, 0x2f1c4f, 4);
        }
        if (team === 'enemy') {
            return createBulletSprite(0xff8d8d, 0x4f1b1b, 4);
        }
        return createBulletSprite(0xf7e56a, 0x2a2409, 4);
    }

    function releaseProjectileSprite(team, sprite) {
        if (!sprite) {
            return;
        }
        sprite.visible = false;
        sprite.position.set(-99999, -99999);
        const pool = projectileSpritePools[team];
        if (pool) {
            pool.push(sprite);
        } else {
            sprite.destroy();
        }
    }

    function acquireProjectileObject() {
        return projectileObjectPool.pop() ?? {
            replicationId: null,
            x: 0,
            y: 0,
            targetX: 0,
            targetY: 0,
            vx: 0,
            vy: 0,
            ttl: 0,
            damage: 0,
            radius: 4,
            team: 'player',
            ownerPlayerId: null,
            sprite: null
        };
    }

    function releaseProjectileObject(projectile) {
        projectile.replicationId = null;
        projectile.x = 0;
        projectile.y = 0;
        projectile.targetX = 0;
        projectile.targetY = 0;
        projectile.vx = 0;
        projectile.vy = 0;
        projectile.ttl = 0;
        projectile.damage = 0;
        projectile.radius = 4;
        projectile.team = 'player';
        projectile.ownerPlayerId = null;
        projectile.sprite = null;
        projectileObjectPool.push(projectile);
    }

    function spawnFriendlyProjectile(sourceList, maxCount, config) {
        if (sourceList.length >= maxCount) {
            return;
        }
        const bullet = acquireProjectileObject();
        const sprite = acquireProjectileSprite(config.team);
        bullet.replicationId = Number.isFinite(config.replicationId)
            ? Math.floor(config.replicationId)
            : nextProjectileReplicationId++;
        bullet.x = config.originX - (config.radius ?? 4);
        bullet.y = config.originY - (config.radius ?? 4);
        bullet.targetX = bullet.x;
        bullet.targetY = bullet.y;
        bullet.vx = config.dirX * config.speed;
        bullet.vy = config.dirY * config.speed;
        bullet.ttl = config.lifetimeFrames;
        bullet.damage = config.damage;
        bullet.radius = config.radius ?? 4;
        bullet.team = config.team;
        bullet.ownerPlayerId = config.ownerPlayerId ?? null;
        bullet.sprite = sprite;
        sprite.position.set(bullet.x, bullet.y);
        projectileLayer.addChild(sprite);
        sourceList.push(bullet);
    }

    function spawnPlayerBullet(playerCenterX, playerCenterY, dirX, dirY, ownerPlayerId = null, damageMultiplier = 1) {
        const cfg = WEAPONS.pistol;
        spawnFriendlyProjectile(projectiles, MAX_BULLETS, {
            originX: playerCenterX,
            originY: playerCenterY,
            dirX,
            dirY,
            speed: cfg.bulletSpeed,
            lifetimeFrames: cfg.bulletLifetimeFrames,
            damage: cfg.damage * damageMultiplier,
            team: 'player',
            ownerPlayerId,
            radius: 4
        });
    }

    function updateProjectileList(list, deltaMoveScale, snapshot) {
        for (let i = list.length - 1; i >= 0; i--) {
            const bullet = list[i];
            bullet.ttl -= (deltaMoveScale * 60);
            bullet.x += bullet.vx * deltaMoveScale;
            bullet.y += bullet.vy * deltaMoveScale;
            bullet.targetX = bullet.x;
            bullet.targetY = bullet.y;
            bullet.sprite.position.set(bullet.x, bullet.y);

            if (bullet.ttl <= 0) {
                releaseProjectileSprite(bullet.team, bullet.sprite);
                releaseProjectileObject(bullet);
                list.splice(i, 1);
                continue;
            }

            const bulletCenterX = bullet.x + bullet.radius;
            const bulletCenterY = bullet.y + bullet.radius;
            const bulletTileX = Math.floor(bulletCenterX / TILE_SIZE);
            const bulletTileY = Math.floor(bulletCenterY / TILE_SIZE);

            if (bullet.team === 'enemy') {
                if (snapshot.serverOwnsEnemyProjectileDamage) {
                    continue;
                }
                if (buildingSystem.isProjectileBlockedForTeam(bulletTileX, bulletTileY, 'enemy')) {
                    const result = buildingSystem.applyDamageAtTile(bulletTileX, bulletTileY, bullet.damage, 'enemy_projectile');
                    releaseProjectileSprite(bullet.team, bullet.sprite);
                    releaseProjectileObject(bullet);
                    list.splice(i, 1);
                    if (result?.destroyed) {
                        updateHud();
                    }
                    continue;
                }

                const playerTargets = Array.isArray(snapshot.playerTargets) ? snapshot.playerTargets : [];
                let hitPlayer = false;
                for (const playerTarget of playerTargets) {
                    if (playerTarget.isDead) {
                        continue;
                    }
                    const dxPlayer = playerTarget.x - bulletCenterX;
                    const dyPlayer = playerTarget.y - bulletCenterY;
                    const playerHitDistance = (playerTarget.radius ?? PLAYER_COLLISION_RADIUS) + bullet.radius;
                    if (dxPlayer * dxPlayer + dyPlayer * dyPlayer > playerHitDistance * playerHitDistance) {
                        continue;
                    }
                    snapshot.onPlayerHit?.(playerTarget.id, bullet.damage, 'enemy_projectile');
                    hitPlayer = true;
                    break;
                }
                if (hitPlayer) {
                    releaseProjectileSprite(bullet.team, bullet.sprite);
                    releaseProjectileObject(bullet);
                    list.splice(i, 1);
                    continue;
                }

                const civilians = snapshot.civilians;
                let hitCivilian = false;
                for (const civilian of civilians) {
                    if (civilian.isDead) {
                        continue;
                    }
                    const dxCivilian = civilian.x - bulletCenterX;
                    const dyCivilian = civilian.y - bulletCenterY;
                    const hitDistance = 8 + bullet.radius;
                    if (dxCivilian * dxCivilian + dyCivilian * dyCivilian <= hitDistance * hitDistance) {
                        civilianSystem.applyDamage(civilian.id, bullet.damage, 'enemy_projectile');
                        hitCivilian = true;
                        break;
                    }
                }
                if (hitCivilian) {
                    releaseProjectileSprite(bullet.team, bullet.sprite);
                    releaseProjectileObject(bullet);
                    list.splice(i, 1);
                }
                continue;
            }

            const blockingTeam = bullet.team === 'tower' ? 'tower' : 'friendly';
            if (buildingSystem.isProjectileBlockedForTeam(bulletTileX, bulletTileY, blockingTeam)) {
                releaseProjectileSprite(bullet.team, bullet.sprite);
                releaseProjectileObject(bullet);
                list.splice(i, 1);
                continue;
            }

            if (bullet.team === 'tower' && snapshot.serverOwnsTowerProjectileDamage) {
                continue;
            }

            let hitEnemy = false;
            for (const enemy of enemies) {
                if (enemy.isDead) {
                    continue;
                }
                const dx = (enemy.x + ENEMY_RADIUS) - bulletCenterX;
                const dy = (enemy.y + ENEMY_RADIUS) - bulletCenterY;
                const hitDistance = ENEMY_RADIUS + bullet.radius;
                if (dx * dx + dy * dy <= hitDistance * hitDistance) {
                    applyDamage(enemy, bullet.damage, `${bullet.team}_projectile`, bullet.ownerPlayerId ?? null);
                    hitEnemy = true;
                    break;
                }
            }

            if (hitEnemy) {
                releaseProjectileSprite(bullet.team, bullet.sprite);
                releaseProjectileObject(bullet);
                list.splice(i, 1);
            }
        }
    }

    function clearProjectileList(list) {
        for (let i = list.length - 1; i >= 0; i--) {
            releaseProjectileSprite(list[i].team, list[i].sprite);
            releaseProjectileObject(list[i]);
            list.splice(i, 1);
        }
    }

    function resetAllProjectiles() {
        clearProjectileList(projectiles);
        clearProjectileList(towerProjectiles);
        clearProjectileList(enemyProjectiles);
    }

    function syncReplicatedProjectileList(targetList, sourceEntries, team) {
        const source = Array.isArray(sourceEntries) ? sourceEntries : [];
        const byId = new Map();
        for (const projectile of targetList) {
            if (Number.isFinite(projectile.replicationId)) {
                byId.set(projectile.replicationId, projectile);
            }
        }
        const seenIds = new Set();
        for (let i = 0; i < source.length; i++) {
            const entry = source[i];
            const entryId = Number(entry?.id);
            const replicationId = Number.isFinite(entryId) && entryId > 0 ? Math.floor(entryId) : (i + 1);
            let projectile = byId.get(replicationId);
            if (!projectile) {
                projectile = acquireProjectileObject();
                const sprite = acquireProjectileSprite(team);
                projectile.replicationId = replicationId;
                projectile.x = 0;
                projectile.y = 0;
                projectile.targetX = 0;
                projectile.targetY = 0;
                projectile.vx = 0;
                projectile.vy = 0;
                projectile.ttl = 60;
                projectile.damage = 0;
                projectile.radius = 4;
                projectile.team = team;
                projectile.sprite = sprite;
                sprite.position.set(projectile.x, projectile.y);
                projectileLayer.addChild(sprite);
                targetList.push(projectile);
            }
            const nextX = Number(entry.x) || 0;
            const nextY = Number(entry.y) || 0;
            if (!Number.isFinite(projectile.x) || !Number.isFinite(projectile.y)) {
                projectile.x = nextX;
                projectile.y = nextY;
            }
            projectile.targetX = nextX;
            projectile.targetY = nextY;
            seenIds.add(replicationId);
        }
        for (let i = targetList.length - 1; i >= 0; i--) {
            if (seenIds.has(targetList[i].replicationId)) {
                continue;
            }
            releaseProjectileSprite(targetList[i].team, targetList[i].sprite);
            releaseProjectileObject(targetList[i]);
            targetList.splice(i, 1);
        }
    }

    function syncReplicatedProjectiles(projectileSnapshot) {
        const snapshot = projectileSnapshot ?? {};
        syncReplicatedProjectileList(projectiles, snapshot.player, 'player');
        syncReplicatedProjectileList(towerProjectiles, snapshot.tower, 'tower');
        syncReplicatedProjectileList(enemyProjectiles, snapshot.enemy, 'enemy');
    }

    function updateReplicatedProjectileList(list, deltaMoveScale) {
        const alpha = Math.max(0.05, Math.min(1, deltaMoveScale * 18));
        for (const projectile of list) {
            projectile.x += (projectile.targetX - projectile.x) * alpha;
            projectile.y += (projectile.targetY - projectile.y) * alpha;
            projectile.sprite.position.set(projectile.x, projectile.y);
        }
    }

    function updateReplicatedProjectiles(deltaMoveScale) {
        updateReplicatedProjectileList(projectiles, deltaMoveScale);
        updateReplicatedProjectileList(towerProjectiles, deltaMoveScale);
        updateReplicatedProjectileList(enemyProjectiles, deltaMoveScale);
    }

    function exportReplicatedProjectileList(sourceList) {
        const result = [];
        for (const projectile of sourceList) {
            result.push({
                id: Number.isFinite(projectile.replicationId) ? Math.floor(projectile.replicationId) : 0,
                x: projectile.x,
                y: projectile.y
            });
        }
        return result;
    }

    function exportReplicatedProjectiles() {
        return {
            player: exportReplicatedProjectileList(projectiles),
            tower: exportReplicatedProjectileList(towerProjectiles),
            enemy: exportReplicatedProjectileList(enemyProjectiles)
        };
    }

    function updateProjectiles(deltaMoveScale, civilianTargetsSnapshot = null) {
        const multiplayerStats = multiplayerClient.getStats();
        const serverOwnsEnemyProjectileDamage = multiplayerStats.connected && multiplayerStats.isAuthority;
        const serverOwnsTowerProjectileDamage = multiplayerStats.connected && multiplayerStats.isAuthority;
        let playerTargets = [];
        if (multiplayerStats.connected && multiplayerStats.isAuthority) {
            playerTargets = [...multiplayerPlayerRuntime.values()].map((runtime) => ({
                id: runtime.id,
                x: runtime.x,
                y: runtime.y,
                radius: PLAYER_COLLISION_RADIUS,
                isDead: runtime.isDead
            }));
        } else {
            const playerCenter = playerSystem.getCenter();
            playerTargets = [{
                id: multiplayerStats.playerId ?? 'local',
                x: playerCenter.x,
                y: playerCenter.y,
                radius: PLAYER_COLLISION_RADIUS,
                isDead: playerState.isDead
            }];
        }
        const snapshot = {
            serverOwnsEnemyProjectileDamage,
            serverOwnsTowerProjectileDamage,
            playerTargets,
            civilians: civilianTargetsSnapshot ?? civilianSystem.getTargets(),
            onPlayerHit: (playerId, amount, source) => {
                if (multiplayerStats.connected && multiplayerStats.isAuthority) {
                    const runtime = ensureRuntimePlayer(playerId ?? multiplayerStats.playerId);
                    applyDamage(runtime, amount, source);
                    if (runtime.isDead && runtime.respawnTimer <= 0) {
                        runtime.respawnTimer = PLAYER_RESPAWN_SECONDS;
                    }
                    if (String(multiplayerStats.playerId) === String(runtime.id)) {
                        playerState.hp = runtime.hp;
                        playerState.maxHp = runtime.maxHp;
                        playerState.isDead = runtime.isDead;
                        playerState.invulnFrames = runtime.invulnFrames ?? 0;
                    }
                    return;
                }
                applyDamage(playerState, amount, source);
            }
        };
        updateProjectileList(projectiles, deltaMoveScale, snapshot);
        updateProjectileList(towerProjectiles, deltaMoveScale, snapshot);
        updateProjectileList(enemyProjectiles, deltaMoveScale, snapshot);
    }

    function updateTowerCombat(aiDirectives = null, enemyQueryBuffer = []) {
        const towers = buildingSystem.getTowers?.() ?? [];
        if (towers.length === 0) {
            return;
        }
        for (const tower of towers) {
            if ((tower.towerCooldownRemainingFrames ?? 0) > 0) {
                continue;
            }
            const centerX = (tower.tileX + tower.footprintW * 0.5) * TILE_SIZE;
            const centerY = (tower.tileY + tower.footprintH * 0.5) * TILE_SIZE;
            const range = tower.towerRange || PROJECTILES.tower.range;
            const rangeSq = range * range;
            let targetEnemy = null;
            let bestHp = -1;
            let bestDistSq = rangeSq;
            const directedEnemyId = Number(aiDirectives?.towers?.[String(tower.id)] || 0);
            if (directedEnemyId > 0) {
                const directedEnemy = enemies.find((enemy) => Number(enemy.id) === directedEnemyId && !enemy.isDead);
                if (directedEnemy) {
                    const dx = (directedEnemy.x + ENEMY_RADIUS) - centerX;
                    const dy = (directedEnemy.y + ENEMY_RADIUS) - centerY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq <= rangeSq) {
                        targetEnemy = directedEnemy;
                    }
                }
            }
            if (!targetEnemy) {
                querySpatialIndexInto(enemySpatialIndex, centerX, centerY, range, enemyQueryBuffer);
                for (const enemy of enemyQueryBuffer) {
                    if (enemy.isDead) {
                        continue;
                    }
                    const dx = (enemy.x + ENEMY_RADIUS) - centerX;
                    const dy = (enemy.y + ENEMY_RADIUS) - centerY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq > rangeSq) {
                        continue;
                    }
                    if (enemy.hp > bestHp || (enemy.hp === bestHp && distSq < bestDistSq)) {
                        bestHp = enemy.hp;
                        bestDistSq = distSq;
                        targetEnemy = enemy;
                    }
                }
            }
            if (!targetEnemy) {
                continue;
            }
            const dx = (targetEnemy.x + ENEMY_RADIUS) - centerX;
            const dy = (targetEnemy.y + ENEMY_RADIUS) - centerY;
            const mag = Math.hypot(dx, dy);
            if (mag <= 0.001) {
                continue;
            }
            spawnFriendlyProjectile(towerProjectiles, MAX_TOWER_PROJECTILES, {
                originX: centerX,
                originY: centerY,
                dirX: dx / mag,
                dirY: dy / mag,
                speed: tower.towerProjectileSpeed || PROJECTILES.tower.speed,
                lifetimeFrames: tower.towerProjectileLifetimeFrames || PROJECTILES.tower.lifetimeFrames,
                damage: tower.towerProjectileDamage || PROJECTILES.tower.damage,
                team: 'tower',
                radius: 4
            });
            tower.towerCooldownRemainingFrames = tower.towerCooldownFrames || PROJECTILES.tower.cooldownFrames;
        }
    }

    function updateEnemyRangedCombat(deltaFrames, enemiesDisabled, aiDirectives = null, civilianQueryBuffer = []) {
        if (enemiesDisabled) {
            return;
        }
        const rangeSq = PROJECTILES.enemy.range * PROJECTILES.enemy.range;
        const multiplayerStats = multiplayerClient.getStats();
        const playerTargets = (multiplayerStats.connected && multiplayerStats.isAuthority)
            ? [...multiplayerPlayerRuntime.values()].map((runtime) => ({
                id: runtime.id,
                x: runtime.x,
                y: runtime.y,
                isDead: runtime.isDead
            }))
            : [{
                id: multiplayerStats.playerId ?? 'local',
                x: playerSystem.getCenter().x,
                y: playerSystem.getCenter().y,
                isDead: playerState.isDead
            }];
        for (const enemy of enemies) {
            if (enemy.isDead || !enemy.isRanged) {
                continue;
            }
            enemy.rangedCooldownFrames = Number.isFinite(enemy.rangedCooldownFrames)
                ? enemy.rangedCooldownFrames - deltaFrames
                : Math.floor(Math.random() * PROJECTILES.enemy.cooldownFrames);
            if (enemy.rangedCooldownFrames > 0) {
                continue;
            }
            const enemyCenterX = enemy.x + ENEMY_RADIUS;
            const enemyCenterY = enemy.y + ENEMY_RADIUS;
            let targetX = enemyCenterX;
            let targetY = enemyCenterY;
            let bestDistSq = Infinity;
            querySpatialIndexInto(civilianSpatialIndex, enemyCenterX, enemyCenterY, PROJECTILES.enemy.range, civilianQueryBuffer);
            const directedTarget = aiDirectives?.rangedEnemies?.[String(enemy.id)];
            if (directedTarget?.type === 'player') {
                const directedPlayerId = Number(directedTarget.id);
                const directedPlayer = playerTargets.find((entry) => Number(entry.id) === directedPlayerId && !entry.isDead);
                if (directedPlayer) {
                    targetX = directedPlayer.x;
                    targetY = directedPlayer.y;
                    bestDistSq = (targetX - enemyCenterX) ** 2 + (targetY - enemyCenterY) ** 2;
                }
            } else if (directedTarget?.type === 'civilian') {
                const directedCivilianId = Number(directedTarget.id);
                const directedCivilian = civilianQueryBuffer.find((entry) => Number(entry.id) === directedCivilianId && !entry.isDead);
                if (directedCivilian) {
                    targetX = directedCivilian.x;
                    targetY = directedCivilian.y;
                    bestDistSq = (targetX - enemyCenterX) ** 2 + (targetY - enemyCenterY) ** 2;
                }
            }
            for (const playerTarget of playerTargets) {
                if (playerTarget.isDead) {
                    continue;
                }
                const playerDistSq = (playerTarget.x - enemyCenterX) ** 2 + (playerTarget.y - enemyCenterY) ** 2;
                if (playerDistSq < bestDistSq) {
                    bestDistSq = playerDistSq;
                    targetX = playerTarget.x;
                    targetY = playerTarget.y;
                }
            }
            for (const civilian of civilianQueryBuffer) {
                if (civilian.isDead) {
                    continue;
                }
                const distSq = (civilian.x - enemyCenterX) ** 2 + (civilian.y - enemyCenterY) ** 2;
                if (distSq < bestDistSq) {
                    bestDistSq = distSq;
                    targetX = civilian.x;
                    targetY = civilian.y;
                }
            }
            if (bestDistSq > rangeSq) {
                continue;
            }
            const dx = targetX - enemyCenterX;
            const dy = targetY - enemyCenterY;
            const mag = Math.hypot(dx, dy);
            if (mag <= 0.001) {
                continue;
            }
            if (enemyProjectiles.length >= MAX_ENEMY_PROJECTILES) {
                break;
            }
            const projectile = acquireProjectileObject();
            const sprite = acquireProjectileSprite('enemy');
            projectile.replicationId = nextProjectileReplicationId++;
            projectile.x = enemyCenterX - 4;
            projectile.y = enemyCenterY - 4;
            projectile.vx = (dx / mag) * PROJECTILES.enemy.speed;
            projectile.vy = (dy / mag) * PROJECTILES.enemy.speed;
            projectile.ttl = PROJECTILES.enemy.lifetimeFrames;
            projectile.damage = PROJECTILES.enemy.damage;
            projectile.radius = 4;
            projectile.team = 'enemy';
            projectile.sprite = sprite;
            sprite.position.set(projectile.x, projectile.y);
            projectileLayer.addChild(sprite);
            enemyProjectiles.push(projectile);
            enemy.rangedCooldownFrames = PROJECTILES.enemy.cooldownFrames;
        }
    }

    return {
        lists: {
            projectiles,
            towerProjectiles,
            enemyProjectiles
        },
        resetAllProjectiles,
        spawnPlayerBullet,
        syncReplicatedProjectiles,
        updateReplicatedProjectiles,
        exportReplicatedProjectiles,
        updateProjectiles,
        updateTowerCombat,
        updateEnemyRangedCombat
    };
}
