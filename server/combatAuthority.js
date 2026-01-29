// Combat authority — server-side hit resolution, kill tracking, and gold reconciliation.
// All mutable state is encapsulated; callers receive a plain object with methods.

'use strict';

// Internal helper — same footprint logic as aiDirectives but used for projectile-hit detection.
function getBuildingIndexAtTile(state, tileX, tileY, BUILDING_RULES) {
    if (!state || !Array.isArray(state.buildings)) {
        return -1;
    }
    for (let i = 0; i < state.buildings.length; i++) {
        const building = state.buildings[i];
        if (!building) {
            continue;
        }
        const rule = BUILDING_RULES[building.type] ?? { footprint: { w: 1, h: 1 } };
        const bx = Math.floor(Number(building.tileX) || 0);
        const by = Math.floor(Number(building.tileY) || 0);
        const bw = Math.max(1, Math.floor(Number(rule.footprint?.w) || 1));
        const bh = Math.max(1, Math.floor(Number(rule.footprint?.h) || 1));
        if (tileX >= bx && tileX < (bx + bw) && tileY >= by && tileY < (by + bh)) {
            return i;
        }
    }
    return -1;
}

function createCombatAuthority({
    serverPerf,
    getAuthorityPlayerId,
    bumpBuildingRevision,
    BUILDING_RULES,
    GOLD_PER_ENEMY_KILL,
    AUTHORITY_SNAPSHOT_STALL_MS,
    SERVER_ENEMY_RADIUS,
    SERVER_ENEMY_PROJECTILE_DAMAGE,
    SERVER_ENEMY_PROJECTILE_RADIUS,
    SERVER_ENEMY_CONTACT_DAMAGE,
    SERVER_ENEMY_CONTACT_COOLDOWN_MS,
    SERVER_TOWER_PROJECTILE_DAMAGE,
    SERVER_TOWER_PROJECTILE_RADIUS,
    SERVER_PLAYER_RADIUS,
    SERVER_CIVILIAN_RADIUS,
    SERVER_PLAYER_RESPAWN_SECONDS,
    SERVER_TILE_SIZE
}) {
    const authoritativeKillsByPlayerId = new Map();
    let authoritativeNonKillGoldOffset = 0;
    let authoritativeCombatBaselineReady = false;
    const pendingServerEnemyHits = [];
    const consumedEnemyProjectileIds = new Map();
    const consumedTowerProjectileIds = new Map();
    const enemyContactCooldownByTarget = new Map();
    let lastAuthoritySnapshotAt = 0;

    function reset() {
        authoritativeKillsByPlayerId.clear();
        authoritativeNonKillGoldOffset = 0;
        authoritativeCombatBaselineReady = false;
        pendingServerEnemyHits.length = 0;
        consumedEnemyProjectileIds.clear();
        consumedTowerProjectileIds.clear();
        enemyContactCooldownByTarget.clear();
    }

    function getSnapshotAgeMs(now = Date.now()) {
        if (getAuthorityPlayerId() === null || lastAuthoritySnapshotAt <= 0) {
            return Number.POSITIVE_INFINITY;
        }
        return Math.max(0, now - lastAuthoritySnapshotAt);
    }

    function isFrozen(now = Date.now()) {
        return getSnapshotAgeMs(now) > AUTHORITY_SNAPSHOT_STALL_MS;
    }

    function setLastSnapshotAt(ts) {
        lastAuthoritySnapshotAt = ts;
    }

    function getLastSnapshotAt() {
        return lastAuthoritySnapshotAt;
    }

    function reconcile(playerStates, sharedResources) {
        const sanitizedStates = Array.isArray(playerStates) ? playerStates : [];
        const nextKills = new Map();
        for (const state of sanitizedStates) {
            const playerId = Math.floor(Number(state?.playerId) || 0);
            if (playerId <= 0) {
                continue;
            }
            const incomingKills = Math.max(0, Math.floor(Number(state.kills) || 0));
            const previousKills = authoritativeKillsByPlayerId.get(playerId) ?? 0;
            const canonicalKills = Math.max(previousKills, incomingKills);
            if (canonicalKills !== incomingKills) {
                serverPerf.killCorrections += 1;
            }
            nextKills.set(playerId, canonicalKills);
        }
        authoritativeKillsByPlayerId.clear();
        for (const [playerId, killCount] of nextKills) {
            authoritativeKillsByPlayerId.set(playerId, killCount);
        }

        let totalKills = 0;
        for (const kills of authoritativeKillsByPlayerId.values()) {
            totalKills += kills;
        }
        const expectedGoldFromKills = totalKills * GOLD_PER_ENEMY_KILL;
        if (sharedResources) {
            const payloadGold = Math.max(0, Math.floor(Number(sharedResources.gold) || 0));
            if (!authoritativeCombatBaselineReady) {
                authoritativeNonKillGoldOffset = Math.max(0, payloadGold - expectedGoldFromKills);
                authoritativeCombatBaselineReady = true;
            } else {
                const observedOffset = Math.max(0, payloadGold - expectedGoldFromKills);
                if (observedOffset > authoritativeNonKillGoldOffset) {
                    authoritativeNonKillGoldOffset = observedOffset;
                }
            }
            const canonicalGold = Math.max(0, expectedGoldFromKills + authoritativeNonKillGoldOffset);
            if (sharedResources.gold !== canonicalGold) {
                serverPerf.goldCorrections += 1;
            }
            sharedResources.gold = canonicalGold;
        }

        for (const state of sanitizedStates) {
            const playerId = Math.floor(Number(state?.playerId) || 0);
            if (playerId <= 0) {
                continue;
            }
            state.kills = authoritativeKillsByPlayerId.get(playerId) ?? 0;
        }
    }

    function queueEnemyHit(attackerPlayerId, enemyId, damage) {
        const normalizedAttackerId = Math.floor(Number(attackerPlayerId) || 0);
        const normalizedEnemyId = Math.floor(Number(enemyId) || 0);
        if (normalizedAttackerId <= 0 || normalizedEnemyId <= 0) {
            return;
        }
        pendingServerEnemyHits.push({
            attackerPlayerId: normalizedAttackerId,
            enemyId: normalizedEnemyId,
            damage: Math.max(1, Math.floor(Number(damage) || 1))
        });
    }

    function drainQueuedHits() {
        if (pendingServerEnemyHits.length > 0) {
            serverPerf.droppedQueuedEnemyHits += pendingServerEnemyHits.length;
            pendingServerEnemyHits.length = 0;
        }
    }

    function applyQueuedEnemyHits(enemyEntries) {
        if (!Array.isArray(enemyEntries) || enemyEntries.length === 0 || pendingServerEnemyHits.length === 0) {
            pendingServerEnemyHits.length = 0;
            return;
        }
        const byId = new Map();
        for (const enemy of enemyEntries) {
            const enemyId = Math.floor(Number(enemy?.id) || 0);
            if (enemyId > 0) {
                byId.set(enemyId, enemy);
            }
        }
        for (const hit of pendingServerEnemyHits) {
            const enemy = byId.get(hit.enemyId);
            if (!enemy) {
                continue;
            }
            const currentHp = Math.max(0, Number(enemy.hp) || 0);
            if (currentHp <= 0) {
                continue;
            }
            const nextHp = Math.max(0, currentHp - hit.damage);
            enemy.hp = nextHp;
            if (nextHp <= 0) {
                const previousKills = authoritativeKillsByPlayerId.get(hit.attackerPlayerId) ?? 0;
                authoritativeKillsByPlayerId.set(hit.attackerPlayerId, previousKills + 1);
            }
        }
        pendingServerEnemyHits.length = 0;
    }

    function applyEnemyProjectileDamage(enemyProjectiles, playerStates, civilians, buildingsState, currentTick) {
        if (!Array.isArray(enemyProjectiles) || enemyProjectiles.length === 0) {
            return enemyProjectiles;
        }
        const minAliveTick = currentTick - 1200;
        for (const [projectileId, hitTick] of consumedEnemyProjectileIds) {
            if (hitTick < minAliveTick) {
                consumedEnemyProjectileIds.delete(projectileId);
            }
        }

        const survivors = [];
        for (const projectile of enemyProjectiles) {
            const projectileId = Math.floor(Number(projectile?.id) || 0);
            if (projectileId > 0 && consumedEnemyProjectileIds.has(projectileId)) {
                continue;
            }
            const centerX = Number(projectile?.x) + SERVER_ENEMY_PROJECTILE_RADIUS;
            const centerY = Number(projectile?.y) + SERVER_ENEMY_PROJECTILE_RADIUS;
            if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
                continue;
            }

            let consumed = false;
            const tileX = Math.floor(centerX / SERVER_TILE_SIZE);
            const tileY = Math.floor(centerY / SERVER_TILE_SIZE);
            const buildingIndex = getBuildingIndexAtTile(buildingsState, tileX, tileY, BUILDING_RULES);
            if (buildingIndex >= 0) {
                const building = buildingsState.buildings[buildingIndex];
                if (building && !building.unbreakable) {
                    building.hp = Math.max(0, Math.floor(Number(building.hp) || 0) - SERVER_ENEMY_PROJECTILE_DAMAGE);
                    serverPerf.enemyProjectileBuildingHits += 1;
                    if (building.hp <= 0) {
                        buildingsState.buildings.splice(buildingIndex, 1);
                        bumpBuildingRevision();
                    }
                    consumed = true;
                }
            }

            if (!consumed && Array.isArray(playerStates)) {
                for (const playerState of playerStates) {
                    if (!playerState || playerState.isDead) {
                        continue;
                    }
                    const px = Number(playerState.x);
                    const py = Number(playerState.y);
                    if (!Number.isFinite(px) || !Number.isFinite(py)) {
                        continue;
                    }
                    const dx = px - centerX;
                    const dy = py - centerY;
                    const hitDistance = SERVER_PLAYER_RADIUS + SERVER_ENEMY_PROJECTILE_RADIUS;
                    if ((dx * dx + dy * dy) > (hitDistance * hitDistance)) {
                        continue;
                    }
                    playerState.hp = Math.max(0, Math.floor(Number(playerState.hp) || 0) - SERVER_ENEMY_PROJECTILE_DAMAGE);
                    if (playerState.hp <= 0) {
                        playerState.isDead = true;
                        playerState.respawnTimer = Math.max(SERVER_PLAYER_RESPAWN_SECONDS, Number(playerState.respawnTimer) || 0);
                    }
                    serverPerf.enemyProjectilePlayerHits += 1;
                    consumed = true;
                    break;
                }
            }

            if (!consumed && Array.isArray(civilians)) {
                for (const civilian of civilians) {
                    if (!civilian || civilian.isDead) {
                        continue;
                    }
                    const cx = Number(civilian.x);
                    const cy = Number(civilian.y);
                    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
                        continue;
                    }
                    const dx = cx - centerX;
                    const dy = cy - centerY;
                    const hitDistance = SERVER_CIVILIAN_RADIUS + SERVER_ENEMY_PROJECTILE_RADIUS;
                    if ((dx * dx + dy * dy) > (hitDistance * hitDistance)) {
                        continue;
                    }
                    civilian.hp = Math.max(0, Math.floor(Number(civilian.hp) || 0) - SERVER_ENEMY_PROJECTILE_DAMAGE);
                    if (civilian.hp <= 0) {
                        civilian.isDead = true;
                    }
                    serverPerf.enemyProjectileCivilianHits += 1;
                    consumed = true;
                    break;
                }
            }

            if (consumed) {
                serverPerf.enemyProjectileDamageApplied += 1;
                if (projectileId > 0) {
                    consumedEnemyProjectileIds.set(projectileId, currentTick);
                }
                continue;
            }
            survivors.push(projectile);
        }
        return survivors;
    }

    function applyTowerProjectileDamage(towerProjectiles, enemyEntries, currentTick) {
        if (!Array.isArray(towerProjectiles) || towerProjectiles.length === 0 || !Array.isArray(enemyEntries)) {
            return towerProjectiles;
        }
        const minAliveTick = currentTick - 1200;
        for (const [projectileId, hitTick] of consumedTowerProjectileIds) {
            if (hitTick < minAliveTick) {
                consumedTowerProjectileIds.delete(projectileId);
            }
        }
        const survivors = [];
        for (const projectile of towerProjectiles) {
            const projectileId = Math.floor(Number(projectile?.id) || 0);
            if (projectileId > 0 && consumedTowerProjectileIds.has(projectileId)) {
                continue;
            }
            const centerX = Number(projectile?.x) + SERVER_TOWER_PROJECTILE_RADIUS;
            const centerY = Number(projectile?.y) + SERVER_TOWER_PROJECTILE_RADIUS;
            if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
                continue;
            }
            let consumed = false;
            for (const enemy of enemyEntries) {
                if (!enemy) {
                    continue;
                }
                const enemyHp = Math.max(0, Number(enemy.hp) || 0);
                if (enemyHp <= 0) {
                    continue;
                }
                const ex = Number(enemy.x) + SERVER_ENEMY_RADIUS;
                const ey = Number(enemy.y) + SERVER_ENEMY_RADIUS;
                if (!Number.isFinite(ex) || !Number.isFinite(ey)) {
                    continue;
                }
                const dx = ex - centerX;
                const dy = ey - centerY;
                const hitDistance = SERVER_ENEMY_RADIUS + SERVER_TOWER_PROJECTILE_RADIUS;
                if ((dx * dx + dy * dy) > (hitDistance * hitDistance)) {
                    continue;
                }
                enemy.hp = Math.max(0, enemyHp - SERVER_TOWER_PROJECTILE_DAMAGE);
                consumed = true;
                serverPerf.towerProjectileDamageApplied += 1;
                serverPerf.towerProjectileEnemyHits += 1;
                if (projectileId > 0) {
                    consumedTowerProjectileIds.set(projectileId, currentTick);
                }
                break;
            }
            if (!consumed) {
                survivors.push(projectile);
            }
        }
        return survivors;
    }

    function applyEnemyMeleeContactDamage(enemyEntries, playerStates, civilians, now = Date.now()) {
        if (!Array.isArray(enemyEntries) || enemyEntries.length === 0) {
            return;
        }
        const staleBefore = now - 30000;
        for (const [key, ts] of enemyContactCooldownByTarget) {
            if (ts < staleBefore) {
                enemyContactCooldownByTarget.delete(key);
            }
        }

        for (const enemy of enemyEntries) {
            if (!enemy || (Number(enemy.hp) || 0) <= 0) {
                continue;
            }
            const enemyId = Math.floor(Number(enemy.id) || 0);
            if (enemyId <= 0) {
                continue;
            }
            const ex = Number(enemy.x) + SERVER_ENEMY_RADIUS;
            const ey = Number(enemy.y) + SERVER_ENEMY_RADIUS;
            if (!Number.isFinite(ex) || !Number.isFinite(ey)) {
                continue;
            }

            let consumedContact = false;
            if (Array.isArray(playerStates)) {
                for (const playerState of playerStates) {
                    if (!playerState || playerState.isDead) {
                        continue;
                    }
                    const playerId = Math.floor(Number(playerState.playerId) || 0);
                    if (playerId <= 0) {
                        continue;
                    }
                    const px = Number(playerState.x);
                    const py = Number(playerState.y);
                    if (!Number.isFinite(px) || !Number.isFinite(py)) {
                        continue;
                    }
                    const key = `e:${enemyId}:p:${playerId}`;
                    const lastHitAt = Number(enemyContactCooldownByTarget.get(key) || 0);
                    if (now - lastHitAt < SERVER_ENEMY_CONTACT_COOLDOWN_MS) {
                        continue;
                    }
                    const dx = px - ex;
                    const dy = py - ey;
                    const hitDistance = SERVER_ENEMY_RADIUS + SERVER_PLAYER_RADIUS;
                    if ((dx * dx + dy * dy) > (hitDistance * hitDistance)) {
                        continue;
                    }
                    playerState.hp = Math.max(0, Math.floor(Number(playerState.hp) || 0) - SERVER_ENEMY_CONTACT_DAMAGE);
                    if (playerState.hp <= 0) {
                        playerState.isDead = true;
                        playerState.respawnTimer = Math.max(SERVER_PLAYER_RESPAWN_SECONDS, Number(playerState.respawnTimer) || 0);
                    }
                    enemyContactCooldownByTarget.set(key, now);
                    serverPerf.enemyMeleeDamageApplied += 1;
                    serverPerf.enemyMeleePlayerHits += 1;
                    consumedContact = true;
                    break;
                }
            }
            if (consumedContact || !Array.isArray(civilians)) {
                continue;
            }
            for (const civilian of civilians) {
                if (!civilian || civilian.isDead) {
                    continue;
                }
                const civilianId = Math.floor(Number(civilian.id) || 0);
                if (civilianId <= 0) {
                    continue;
                }
                const cx = Number(civilian.x);
                const cy = Number(civilian.y);
                if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
                    continue;
                }
                const key = `e:${enemyId}:c:${civilianId}`;
                const lastHitAt = Number(enemyContactCooldownByTarget.get(key) || 0);
                if (now - lastHitAt < SERVER_ENEMY_CONTACT_COOLDOWN_MS) {
                    continue;
                }
                const dx = cx - ex;
                const dy = cy - ey;
                const hitDistance = SERVER_ENEMY_RADIUS + SERVER_CIVILIAN_RADIUS;
                if ((dx * dx + dy * dy) > (hitDistance * hitDistance)) {
                    continue;
                }
                civilian.hp = Math.max(0, Math.floor(Number(civilian.hp) || 0) - SERVER_ENEMY_CONTACT_DAMAGE);
                if (civilian.hp <= 0) {
                    civilian.isDead = true;
                }
                enemyContactCooldownByTarget.set(key, now);
                serverPerf.enemyMeleeDamageApplied += 1;
                serverPerf.enemyMeleeCivilianHits += 1;
                break;
            }
        }
    }

    return {
        reset,
        isFrozen,
        getSnapshotAgeMs,
        setLastSnapshotAt,
        getLastSnapshotAt,
        reconcile,
        queueEnemyHit,
        drainQueuedHits,
        applyQueuedEnemyHits,
        applyEnemyProjectileDamage,
        applyTowerProjectileDamage,
        applyEnemyMeleeContactDamage
    };
}

module.exports = { createCombatAuthority };
