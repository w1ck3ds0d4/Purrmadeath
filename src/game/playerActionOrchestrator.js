// Player action orchestration: combat resolution, building actions, harvest/revive, and session control.
// Extracted from bootstrap.js to isolate action-dispatch logic from the main simulation loop.
export function createPlayerActionOrchestrator({
    // Mutable shared state — passed by reference so mutations propagate back to bootstrap
    playerState,
    playerCombat,
    inventory,
    combatStats,
    sharedSessionState,
    multiplayerPlayerRuntime,
    enemies,
    // Game systems
    playerSystem,
    enemySystem,
    buildingSystem,
    worldSystem,
    multiplayerClient,
    getProjectileRuntime,       // () => projectileRuntime — lazy getter avoids init-order issue
    // Game constants
    WEAPONS,
    TILE_SIZE,
    ENEMY_RADIUS,
    PLAYER_INVULN_FRAMES,
    INVULN_FRAMES_ON_HIT,
    GOLD_PER_ENEMY_KILL,
    // Callbacks into bootstrap for UI / cross-module side effects
    onUpdateHud,
    onUpdateHealthHud,
    onSetPauseOverlayVisible,
    onUpdatePauseMenuText,
    onSyncIsPaused,             // () => void — syncs bootstrap's isPaused from sharedSessionState.paused
    onResetRunState,
    onExecuteForceReset,
    onPlayerDefeated,           // (source: string) => void — shows death overlay in bootstrap
    onEnsureRuntimePlayer,      // (playerId) => runtime
    onSpawnFloatingFeedback,    // (text, x, y, color, ttlFrames) => void
    onLog
}) {
    function registerEnemyKill(attackerPlayerId = null) {
        const multiplayerStats = multiplayerClient.getStats();
        if (multiplayerStats.connected && multiplayerStats.isAuthority) {
            let creditedPlayerId = Math.floor(Number(attackerPlayerId) || 0);
            if (creditedPlayerId <= 0) {
                creditedPlayerId = Math.floor(Number(multiplayerStats.playerId) || 0);
            }
            if (creditedPlayerId > 0) {
                const runtime = onEnsureRuntimePlayer(creditedPlayerId);
                runtime.kills = (runtime.kills ?? 0) + 1;
                if (String(multiplayerStats.playerId) === String(runtime.id)) {
                    combatStats.enemiesKilled = runtime.kills;
                }
            } else {
                combatStats.enemiesKilled += 1;
            }
        } else {
            combatStats.enemiesKilled += 1;
        }
        inventory.gold += GOLD_PER_ENEMY_KILL;
        onUpdateHud();
    }

    function applyDamage(target, amount, source, attackerPlayerId = null) {
        if (!target || target.isDead || amount <= 0) {
            return false;
        }
        if ((target.invulnFrames ?? 0) > 0) {
            return false;
        }

        target.hp = Math.max(0, target.hp - amount);
        target.invulnFrames = target === playerState ? PLAYER_INVULN_FRAMES : INVULN_FRAMES_ON_HIT;

        if (target === playerState) {
            playerSystem.flashOnHit(8);
            onUpdateHealthHud();
        } else if (enemySystem?.isEnemyEntity(target)) {
            enemySystem.updateEnemyHealthBar(target);
        }

        if (target.hp <= 0) {
            target.isDead = true;
            if (target === playerState) {
                onPlayerDefeated(source);
            } else if (enemySystem?.isEnemyEntity(target)) {
                registerEnemyKill(attackerPlayerId);
            }
        }

        return true;
    }

    function tryReviveNearestPlayer(actorPlayerId, actorCenter) {
        if (!actorCenter || actorPlayerId === null || actorPlayerId === undefined) {
            return false;
        }
        const reviveRange = TILE_SIZE * 2;
        const reviveRangeSq = reviveRange * reviveRange;
        let best = null;
        let bestDistSq = reviveRangeSq;
        for (const runtime of multiplayerPlayerRuntime.values()) {
            if (!runtime.isDead || String(runtime.id) === String(actorPlayerId)) {
                continue;
            }
            const dx = runtime.x - actorCenter.x;
            const dy = runtime.y - actorCenter.y;
            const distSq = dx * dx + dy * dy;
            if (distSq <= bestDistSq) {
                bestDistSq = distSq;
                best = runtime;
            }
        }
        if (!best) {
            return false;
        }
        best.isDead = false;
        best.respawnTimer = 0;
        best.invulnFrames = 60;
        best.hp = Math.ceil(best.maxHp * 0.45);
        return true;
    }

    function performSwordAttack(playerCenterX, playerCenterY, dirX, dirY, options = {}) {
        const cfg = WEAPONS.sword;
        const cosHalfArc = Math.cos(cfg.arcRadians / 2);
        if (options.showVisual !== false) {
            playerSystem.triggerSwordSwing(dirX, dirY);
        }

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

            const hit = applyDamage(enemy, cfg.damage, 'sword', options.attackerPlayerId ?? null);
            if (hit) {
                enemy.knockbackVX += nx * cfg.knockbackSpeed;
                enemy.knockbackVY += ny * cfg.knockbackSpeed;
            }
        }
    }

    function spawnBullet(playerCenterX, playerCenterY, dirX, dirY, ownerPlayerId = null, damageMultiplier = 1) {
        getProjectileRuntime()?.spawnPlayerBullet(playerCenterX, playerCenterY, dirX, dirY, ownerPlayerId, damageMultiplier);
    }

    function performAttack(playerCenterX, playerCenterY) {
        const mag = Math.hypot(playerCombat.facingX, playerCombat.facingY);
        const dirX = mag > 0.001 ? playerCombat.facingX / mag : 1;
        const dirY = mag > 0.001 ? playerCombat.facingY / mag : 0;
        const localPlayerId = multiplayerClient.getStats().playerId;

        if (playerCombat.weapon === 'sword') {
            performSwordAttack(playerCenterX, playerCenterY, dirX, dirY, {
                showVisual: true,
                attackerPlayerId: localPlayerId
            });
            playerCombat.cooldownFrames = WEAPONS.sword.cooldownFrames;
        } else {
            spawnBullet(playerCenterX, playerCenterY, dirX, dirY, localPlayerId, 1);
            playerCombat.cooldownFrames = WEAPONS.pistol.cooldownFrames;
        }
    }

    function performPredictedAttackVisual(playerCenterX, playerCenterY) {
        const mag = Math.hypot(playerCombat.facingX, playerCombat.facingY);
        const dirX = mag > 0.001 ? playerCombat.facingX / mag : 1;
        const dirY = mag > 0.001 ? playerCombat.facingY / mag : 0;
        if (playerCombat.weapon === 'sword') {
            playerSystem.triggerSwordSwing(dirX, dirY);
            return;
        }
        const muzzleX = playerCenterX + dirX * 18;
        const muzzleY = playerCenterY + dirY * 18;
        onSpawnFloatingFeedback('*', muzzleX, muzzleY, '#ffd166', 16);
    }

    function runPlayerAction(action, actorCenter = null, actorPlayerId = null) {
        if (!action || typeof action.type !== 'string') {
            return { actionType: 'unknown', accepted: false, reason: 'invalid_action' };
        }
        if (action.type === 'attack') {
            const dirX = Number(action.dirX);
            const dirY = Number(action.dirY);
            const originX = Number(action.originX);
            const originY = Number(action.originY);
            if (!Number.isFinite(dirX) || !Number.isFinite(dirY)) {
                return { actionType: 'attack', accepted: false, reason: 'invalid_direction' };
            }
            const centerX = Number.isFinite(originX) ? originX : (actorCenter?.x ?? playerSystem.getCenter().x);
            const centerY = Number.isFinite(originY) ? originY : (actorCenter?.y ?? playerSystem.getCenter().y);
            const mag = Math.hypot(dirX, dirY) || 1;
            const nx = dirX / mag;
            const ny = dirY / mag;
            if (action.weapon === 'sword') {
                const localPlayerId = multiplayerClient.getStats().playerId;
                const showVisual = String(actorPlayerId) === String(localPlayerId);
                // When server already applied sword damage, authority only replays visual to avoid double hits.
                if (action.serverDamageApplied) {
                    if (showVisual) {
                        playerSystem.triggerSwordSwing(nx, ny);
                    }
                } else {
                    performSwordAttack(centerX, centerY, nx, ny, {
                        showVisual,
                        attackerPlayerId: actorPlayerId
                    });
                }
            } else {
                // Dedicated server can pre-apply follower pistol hit damage; keep host replay visual-only.
                const damageMultiplier = action.serverDamageApplied ? 0 : 1;
                spawnBullet(centerX, centerY, nx, ny, actorPlayerId, damageMultiplier);
            }
            return { actionType: 'attack', accepted: true, reason: '' };
        }
        if (action.type === 'build') {
            const tileX = Number(action.tileX);
            const tileY = Number(action.tileY);
            const buildingType = action.buildingType;
            if (!Number.isFinite(tileX) || !Number.isFinite(tileY) || typeof buildingType !== 'string') {
                return { actionType: 'build', accepted: false, reason: 'invalid_payload' };
            }
            const placed = buildingSystem.tryPlaceByTypeAtTile(buildingType, Math.floor(tileX), Math.floor(tileY));
            if (placed) {
                onUpdateHud();
                return { actionType: 'build', accepted: true, reason: '' };
            }
            return { actionType: 'build', accepted: false, reason: 'rejected' };
        }
        if (action.type === 'remove') {
            const tileX = Number(action.tileX);
            const tileY = Number(action.tileY);
            if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
                return { actionType: 'remove', accepted: false, reason: 'invalid_payload' };
            }
            const removed = buildingSystem.removeBuildingAtTile(Math.floor(tileX), Math.floor(tileY));
            if (removed) {
                onUpdateHud();
                return { actionType: 'remove', accepted: true, reason: '' };
            }
            return { actionType: 'remove', accepted: false, reason: 'rejected' };
        }
        if (action.type === 'harvest') {
            const originX = Number(action.originX);
            const originY = Number(action.originY);
            const centerX = Number.isFinite(originX) ? originX : (actorCenter?.x ?? playerSystem.getCenter().x);
            const centerY = Number.isFinite(originY) ? originY : (actorCenter?.y ?? playerSystem.getCenter().y);
            const harvest = worldSystem.tryHarvestNearest(centerX, centerY);
            if (harvest && inventory[harvest.resourceType] !== undefined) {
                inventory[harvest.resourceType] += 1;
                onUpdateHud();
                return { actionType: 'harvest', accepted: true, reason: '' };
            }
            const collected = buildingSystem.collectNearestOutput(centerX, centerY, TILE_SIZE * 3);
            if (collected && inventory[collected.resourceType] !== undefined) {
                inventory[collected.resourceType] += collected.amount;
                onUpdateHud();
                return { actionType: 'harvest', accepted: true, reason: '' };
            }
            return { actionType: 'harvest', accepted: false, reason: 'no_resource' };
        }
        if (action.type === 'revive') {
            const originX = Number(action.originX);
            const originY = Number(action.originY);
            const centerX = Number.isFinite(originX) ? originX : (actorCenter?.x ?? playerSystem.getCenter().x);
            const centerY = Number.isFinite(originY) ? originY : (actorCenter?.y ?? playerSystem.getCenter().y);
            const revived = tryReviveNearestPlayer(actorPlayerId, { x: centerX, y: centerY });
            if (revived) {
                onUpdateHud();
            }
            return { actionType: 'revive', accepted: revived, reason: revived ? '' : 'no_target' };
        }
        if (action.type === 'toggle_pause') {
            sharedSessionState.paused = !sharedSessionState.paused;
            onSyncIsPaused();
            onUpdatePauseMenuText();
            onSetPauseOverlayVisible(sharedSessionState.paused);
            return { actionType: 'toggle_pause', accepted: true, reason: '' };
        }
        if (action.type === 'restart_session') {
            sharedSessionState.paused = false;
            onSyncIsPaused();
            onSetPauseOverlayVisible(false);
            onResetRunState();
            return { actionType: 'restart_session', accepted: true, reason: '' };
        }
        if (action.type === 'force_reset_session') {
            onExecuteForceReset();
            return { actionType: 'force_reset_session', accepted: true, reason: '' };
        }
        if (action.type === 'dev_add_resources') {
            inventory.wood += 100;
            inventory.stone += 100;
            inventory.iron += 100;
            inventory.gold += 100;
            onUpdateHud();
            return { actionType: 'dev_add_resources', accepted: true, reason: '' };
        }
        return { actionType: action.type, accepted: false, reason: 'unsupported' };
    }

    return {
        registerEnemyKill,
        applyDamage,
        tryReviveNearestPlayer,
        performSwordAttack,
        spawnBullet,
        performAttack,
        performPredictedAttackVisual,
        runPlayerAction
    };
}
