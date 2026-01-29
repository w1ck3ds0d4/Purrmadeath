// Multiplayer snapshot orchestration: checkpoint restore, time/resource sync, player reconciliation,
// peer action relay (authority), non-player state application, action ack management, and respawn.
// Extracted from bootstrap.js to isolate the replication/reconciliation path from the main loop.
export function createMultiplayerSnapshotOrchestrator({
    // Mutable shared state — passed by reference so mutations propagate
    playerState,
    playerCombat,
    combatStats,
    inventory,
    sharedSessionState,
    multiplayerPlayerRuntime,
    // Game systems
    playerSystem,
    buildingSystem,
    civilianSystem,
    enemySystem,
    remotePlayerSystem,
    multiplayerClient,
    getProjectileRuntime,           // () => projectileRuntime
    // Tracking object — wraps all primitives that this module owns/mutates.
    // Bootstrap creates this object; orchestrator mutates fields; bootstrap reads them for dev console.
    snapshotTracking,
    // { lastAppliedMultiplayerSnapshotTick, lastAppliedNonPlayerSnapshotSeq,
    //   lastAppliedBuildingsRevision, lastAppliedRestartVersion,
    //   sessionStateInitialized, multiplayerCheckpointLoadedForSession,
    //   multiplayerDefeatHandled, latestServerAiDirectives }
    // Pending action acks map — bootstrap adds entries when sending follower actions; we drain them here
    pendingActionAcks,
    // Helpers
    isTileWalkable,                 // (tileX, tileY) => boolean
    onSyncRuntimePlayers,           // (multiplayerSnapshot) => void
    onEnsureRuntimePlayer,          // (playerId) => runtime
    onGetPlayerWorldPos,            // () => { x, y }
    // Constants
    TILE_SIZE,
    PLAYER_MAX_HP,
    PLAYER_RESPAWN_SECONDS,
    // Reconciliation tuning
    PLAYER_RECONCILE_HARD_SNAP_DISTANCE,
    PLAYER_RECONCILE_DEADZONE,
    PLAYER_RECONCILE_BLEND,
    PLAYER_RECONCILE_MAX_STEP,
    // Multiplayer restore
    shouldRestoreMultiplayerCheckpoint,
    multiplayerCheckpointKey,
    onTryRestoreMultiplayerCheckpoint,  // (key) => boolean
    // Cross-module action/reset delegates
    onRunPlayerAction,              // (action, actorCenter, actorPlayerId) => outcome
    onGetMultiplayerPlayerCenterById, // (playerId) => { x, y } | null
    onResetRunState,
    // Callbacks for bootstrap-owned UI state
    onSetPlayerWorldPos,            // (x, y) => void
    onSetIsPaused,                  // (value) => void — sets bootstrap's isPaused
    onUpdateHealthHud,
    onUpdatePauseMenuText,
    onSetPauseOverlayVisible,
    onUpdateDeathText,              // (text, visible) => void — updates deathText sprite
    onUpdateHud,
    onExitToMainMenu,               // (saveBeforeExit) => void
    onLog
}) {
    // Apply the full multiplayer snapshot block for one game frame.
    // Called from runGameStep when multiplayerStats.connected is true or just disconnected.
    function applySnapshot({
        replicatedAuthority,
        replicatedFollower,
        multiplayerStats,
        multiplayerSnapshot,
        clampedFrameMs,
        deltaFrames,
        deltaMoveScale
    }) {
        // --- Checkpoint restore (authority only, once per session) ---
        if (replicatedAuthority && multiplayerStats.sessionId &&
            snapshotTracking.multiplayerCheckpointLoadedForSession !== multiplayerCheckpointKey) {
            const restored = shouldRestoreMultiplayerCheckpoint
                ? onTryRestoreMultiplayerCheckpoint(multiplayerCheckpointKey)
                : false;
            snapshotTracking.multiplayerCheckpointLoadedForSession = multiplayerCheckpointKey;
            if (restored) {
                onLog('Multiplayer checkpoint restored');
            } else if (!shouldRestoreMultiplayerCheckpoint) {
                onLog('Multiplayer session started fresh (checkpoint restore disabled)');
            }
        }

        // --- Time, shared resources, and session state sync ---
        const timeSnapshot = multiplayerClient.getNonPlayerSnapshotState();
        if (Number.isFinite(Number(timeSnapshot.sessionTimeSeconds))) {
            // gameTimeSeconds is a bootstrap primitive — returned so bootstrap can apply it
            snapshotTracking.pendingSessionTimeSeconds = Math.max(0, Number(timeSnapshot.sessionTimeSeconds));
        }
        if (timeSnapshot.sharedResources && typeof timeSnapshot.sharedResources === 'object') {
            inventory.wood = Number(timeSnapshot.sharedResources.wood) || 0;
            inventory.stone = Number(timeSnapshot.sharedResources.stone) || 0;
            inventory.iron = Number(timeSnapshot.sharedResources.iron) || 0;
            inventory.gold = Number(timeSnapshot.sharedResources.gold) || 0;
            onUpdateHud();
        }
        if (timeSnapshot.sessionState && typeof timeSnapshot.sessionState === 'object') {
            sharedSessionState.paused = Boolean(timeSnapshot.sessionState.paused);
            sharedSessionState.restartVersion = Math.max(0, Number(timeSnapshot.sessionState.restartVersion) || 0);
            sharedSessionState.restartVotes = Math.max(0, Number(timeSnapshot.sessionState.restartVotes) || 0);
            sharedSessionState.restartEligiblePlayers = Math.max(0, Number(timeSnapshot.sessionState.restartEligiblePlayers) || 0);
            onSetIsPaused(sharedSessionState.paused);
            onUpdatePauseMenuText();
            onSetPauseOverlayVisible(sharedSessionState.paused);
            if (!snapshotTracking.sessionStateInitialized) {
                snapshotTracking.sessionStateInitialized = true;
                snapshotTracking.lastAppliedRestartVersion = sharedSessionState.restartVersion;
            } else if (sharedSessionState.restartVersion > snapshotTracking.lastAppliedRestartVersion) {
                snapshotTracking.lastAppliedRestartVersion = sharedSessionState.restartVersion;
                onSetIsPaused(false);
                onSetPauseOverlayVisible(false);
                onResetRunState();
                onLog('Session restarted');
            }
        }
        snapshotTracking.latestServerAiDirectives =
            timeSnapshot.aiDirectives && typeof timeSnapshot.aiDirectives === 'object'
                ? timeSnapshot.aiDirectives
                : null;
        civilianSystem.setServerAiDirectives?.(snapshotTracking.latestServerAiDirectives);

        // --- Player sync and local position reconciliation ---
        if (multiplayerStats.playerId !== null) {
            onSyncRuntimePlayers(multiplayerSnapshot);
            const localRuntime = onEnsureRuntimePlayer(multiplayerStats.playerId);
            const localCenter = playerSystem.getCenter();
            localRuntime.x = localCenter.x;
            localRuntime.y = localCenter.y;
            const localServerPlayer = multiplayerSnapshot.players.find(
                (entry) => String(entry.playerId) === String(multiplayerStats.playerId)
            );
            if (replicatedFollower && localServerPlayer) {
                const pos = onGetPlayerWorldPos();
                const localDx = localServerPlayer.x - pos.x;
                const localDy = localServerPlayer.y - pos.y;
                const correctionDistSq = localDx * localDx + localDy * localDy;
                const hardSnapDistanceSq = PLAYER_RECONCILE_HARD_SNAP_DISTANCE * PLAYER_RECONCILE_HARD_SNAP_DISTANCE;
                const deadzoneSq = PLAYER_RECONCILE_DEADZONE * PLAYER_RECONCILE_DEADZONE;
                if (correctionDistSq > deadzoneSq) {
                    let candidateX = pos.x;
                    let candidateY = pos.y;
                    if (correctionDistSq > hardSnapDistanceSq) {
                        candidateX = localServerPlayer.x;
                        candidateY = localServerPlayer.y;
                    } else {
                        candidateX += localDx * PLAYER_RECONCILE_BLEND;
                        candidateY += localDy * PLAYER_RECONCILE_BLEND;
                        const stepDx = candidateX - pos.x;
                        const stepDy = candidateY - pos.y;
                        const stepDist = Math.hypot(stepDx, stepDy);
                        const reconcileStepLimit = Math.max(
                            PLAYER_RECONCILE_MAX_STEP,
                            Math.max(4, Number(multiplayerStats.snapshotJitterMs) || 0) * 0.35
                        );
                        if (stepDist > reconcileStepLimit && stepDist > 0.001) {
                            const scale = reconcileStepLimit / stepDist;
                            candidateX = pos.x + stepDx * scale;
                            candidateY = pos.y + stepDy * scale;
                        }
                    }
                    const combinedTileX = Math.floor((candidateX + TILE_SIZE / 2) / TILE_SIZE);
                    const combinedTileY = Math.floor((candidateY + TILE_SIZE / 2) / TILE_SIZE);
                    if (isTileWalkable(combinedTileX, combinedTileY)) {
                        onSetPlayerWorldPos(candidateX, candidateY);
                    } else {
                        const newPos = onGetPlayerWorldPos();
                        const xOnlyTileX = Math.floor((candidateX + TILE_SIZE / 2) / TILE_SIZE);
                        const xOnlyTileY = Math.floor((newPos.y + TILE_SIZE / 2) / TILE_SIZE);
                        if (isTileWalkable(xOnlyTileX, xOnlyTileY)) {
                            onSetPlayerWorldPos(candidateX, newPos.y);
                        }
                        const updatedPos = onGetPlayerWorldPos();
                        const yOnlyTileX = Math.floor((updatedPos.x + TILE_SIZE / 2) / TILE_SIZE);
                        const yOnlyTileY = Math.floor((candidateY + TILE_SIZE / 2) / TILE_SIZE);
                        if (isTileWalkable(yOnlyTileX, yOnlyTileY)) {
                            onSetPlayerWorldPos(updatedPos.x, candidateY);
                        }
                    }
                }
            }

            if (multiplayerSnapshot.tick !== snapshotTracking.lastAppliedMultiplayerSnapshotTick) {
                snapshotTracking.lastAppliedMultiplayerSnapshotTick = multiplayerSnapshot.tick;
                remotePlayerSystem.sync(multiplayerSnapshot.players, multiplayerStats.playerId);
            }
            remotePlayerSystem.update(clampedFrameMs);

            // --- Authority: process peer actions and send results ---
            if (replicatedAuthority) {
                const peerActions = multiplayerClient.drainPeerActions();
                for (const pending of peerActions) {
                    const outcome = onRunPlayerAction(
                        pending.action,
                        onGetMultiplayerPlayerCenterById(pending.actorPlayerId),
                        pending.actorPlayerId
                    );
                    const actionType = pending.action?.type;
                    if (actionType !== 'build' && actionType !== 'remove') {
                        multiplayerClient.sendPlayerActionResult(pending.actorPlayerId, {
                            actionType: outcome?.actionType ?? actionType ?? 'unknown',
                            clientActionId: Number(pending.action?.clientActionId) || 0,
                            accepted: Boolean(outcome?.accepted),
                            reason: outcome?.reason ?? ''
                        });
                    }
                }
            }

            // --- Apply non-player snapshot (enemies, projectiles, player states, buildings, civilians) ---
            if (replicatedFollower || replicatedAuthority) {
                const nonPlayerSnapshot = multiplayerClient.getNonPlayerSnapshotState();
                if (nonPlayerSnapshot.seq !== snapshotTracking.lastAppliedNonPlayerSnapshotSeq) {
                    snapshotTracking.lastAppliedNonPlayerSnapshotSeq = nonPlayerSnapshot.seq;
                    enemySystem.syncReplicatedState(nonPlayerSnapshot.enemies);
                    getProjectileRuntime()?.syncReplicatedProjectiles(nonPlayerSnapshot.projectiles);
                    if (Array.isArray(nonPlayerSnapshot.playerStates) && nonPlayerSnapshot.playerStates.length > 0) {
                        let alivePlayerCount = 0;
                        for (const replicatedPlayerState of nonPlayerSnapshot.playerStates) {
                            const replicatedPlayerId = Number(replicatedPlayerState.playerId);
                            if (!Number.isFinite(replicatedPlayerId)) {
                                continue;
                            }
                            const runtime = onEnsureRuntimePlayer(replicatedPlayerId);
                            runtime.hp = Number(replicatedPlayerState.hp) || 0;
                            runtime.maxHp = Number(replicatedPlayerState.maxHp) || PLAYER_MAX_HP;
                            runtime.isDead = Boolean(replicatedPlayerState.isDead);
                            if (!runtime.isDead) {
                                alivePlayerCount += 1;
                            }
                            runtime.respawnTimer = Math.max(0, Number(replicatedPlayerState.respawnTimer) || 0);
                            runtime.kills = Number(replicatedPlayerState.kills) || 0;
                        }
                        const localState = nonPlayerSnapshot.playerStates.find(
                            (entry) => String(entry.playerId) === String(multiplayerStats.playerId)
                        );
                        if (localState) {
                            const prevLocalHp = playerState.hp;
                            playerState.hp = Number(localState.hp) || 0;
                            playerState.maxHp = Number(localState.maxHp) || PLAYER_MAX_HP;
                            playerState.isDead = Boolean(localState.isDead);
                            playerState.invulnFrames = Number(localState.invulnFrames) || 0;
                            if (playerState.hp < prevLocalHp) {
                                playerSystem.flashOnHit(8);
                            }
                            combatStats.enemiesKilled = Number(localState.kills) || 0;
                            if (playerState.isDead) {
                                onUpdateDeathText(`You are down\nRespawn in ${Math.ceil(Number(localState.respawnTimer) || 0)}s`, true);
                            } else {
                                onUpdateDeathText('', false);
                            }
                            onUpdateHealthHud();
                        }
                        if (alivePlayerCount === 0 && !snapshotTracking.multiplayerDefeatHandled) {
                            snapshotTracking.multiplayerDefeatHandled = true;
                            onLog('All players are down. Returning to main menu.');
                            onExitToMainMenu(Boolean(multiplayerStats.isAuthority));
                            return true; // Signal to caller to abort the frame
                        }
                    }
                    if (
                        replicatedFollower &&
                        nonPlayerSnapshot.buildingsState &&
                        Number(nonPlayerSnapshot.buildingsRevision || 0) !== snapshotTracking.lastAppliedBuildingsRevision
                    ) {
                        snapshotTracking.lastAppliedBuildingsRevision = Number(nonPlayerSnapshot.buildingsRevision || 0);
                        buildingSystem.importReplicationState(nonPlayerSnapshot.buildingsState);
                        onUpdateHud();
                    }
                    if (Array.isArray(nonPlayerSnapshot.civilians)) {
                        civilianSystem.syncReplicatedState(nonPlayerSnapshot.civilians, nonPlayerSnapshot.houseTimers);
                        onUpdateHud();
                    }
                }
            }

            // --- Follower: drain action results and timeout stale acks ---
            if (replicatedFollower) {
                const actionResults = multiplayerClient.drainActionResults();
                for (const result of actionResults) {
                    const actionId = Math.floor(Number(result?.clientActionId) || 0);
                    if (actionId > 0) {
                        pendingActionAcks.delete(actionId);
                    }
                    if (!result?.accepted) {
                        const actionType = typeof result?.actionType === 'string' ? result.actionType : 'action';
                        const reason = typeof result?.reason === 'string' && result.reason ? result.reason : 'rejected';
                        onLog(`${actionType} rejected by authority (${reason})`);
                    }
                }
                const now = performance.now();
                for (const [actionId, meta] of pendingActionAcks) {
                    if (now - meta.at <= 1500) {
                        continue;
                    }
                    pendingActionAcks.delete(actionId);
                    onLog(`${meta.type} request timed out; waiting for next authoritative sync`);
                }
            }

            // --- Authority: tick invuln/respawn timers and sync local player state ---
            if (replicatedAuthority) {
                let alivePlayers = 0;
                for (const runtime of multiplayerPlayerRuntime.values()) {
                    if ((runtime.invulnFrames ?? 0) > 0) {
                        runtime.invulnFrames = Math.max(0, runtime.invulnFrames - deltaFrames);
                    }
                    if (runtime.isDead) {
                        runtime.respawnTimer = Math.max(0, runtime.respawnTimer - deltaMoveScale);
                        if (runtime.respawnTimer <= 0) {
                            runtime.hp = runtime.maxHp;
                            runtime.isDead = false;
                            runtime.invulnFrames = 60;
                        }
                    }
                    if (!runtime.isDead) {
                        alivePlayers += 1;
                    }
                }
                const prevLocalHp = playerState.hp;
                // Dedicated sessions should not auto-reset on player death; restart is server-vote driven.
                playerState.hp = localRuntime.hp;
                playerState.maxHp = localRuntime.maxHp;
                playerState.isDead = localRuntime.isDead;
                playerState.invulnFrames = localRuntime.invulnFrames ?? 0;
                if (playerState.hp < prevLocalHp) {
                    playerSystem.flashOnHit(8);
                }
                combatStats.enemiesKilled = Number(localRuntime.kills) || 0;
                if (playerState.isDead) {
                    onUpdateDeathText(`You are down\nRespawn in ${Math.ceil(localRuntime.respawnTimer)}s`, true);
                } else {
                    onUpdateDeathText('', false);
                }
                onUpdateHealthHud();
            }
        }

        return false; // Frame continues normally
    }

    // Clean up multiplayer tracking state when client is not connected.
    function resetDisconnectedState() {
        remotePlayerSystem.clear();
        snapshotTracking.lastAppliedMultiplayerSnapshotTick = -1;
        snapshotTracking.lastAppliedNonPlayerSnapshotSeq = -1;
        snapshotTracking.lastAppliedBuildingsRevision = -1;
        snapshotTracking.lastAppliedRestartVersion = 0;
        snapshotTracking.sessionStateInitialized = false;
        snapshotTracking.multiplayerDefeatHandled = false;
        snapshotTracking.latestServerAiDirectives = null;
        snapshotTracking.multiplayerCheckpointLoadedForSession = null;
        multiplayerPlayerRuntime.clear();
        pendingActionAcks.clear();
        civilianSystem.setServerAiDirectives?.(null);
        sharedSessionState.restartVotes = 0;
        sharedSessionState.restartEligiblePlayers = 0;
    }

    return { applySnapshot, resetDisconnectedState };
}
