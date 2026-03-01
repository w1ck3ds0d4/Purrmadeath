// Session state controller: full run resets, combat entity cleanup, and force reset.
// Extracted from bootstrap.js to isolate world-state transitions from the main simulation loop.
export function createSessionStateController({
    // Mutable shared state — passed by reference so mutations propagate back to bootstrap
    playerState,
    playerCombat,
    inventory,
    combatStats,
    sharedSessionState,
    multiplayerPlayerRuntime,
    floatingTexts,
    // Game systems
    playerSystem,
    worldSystem,
    buildingSystem,
    civilianSystem,
    enemySystem,
    remotePlayerSystem,
    // Persistence/diagnostics
    crashLogger,
    crashLogs,
    persistenceController,
    // Game constants
    TILE_SIZE,
    PLAYER_MAX_HP,
    // Callbacks into bootstrap
    onFindSafeSpawnPosition,        // () => { x, y }
    onGetProjectileRuntime,         // () => projectileRuntime (lazy, may be null)
    onReleaseFloatingTextEntry,     // (entry) => void
    onUpdateVisibleWorld,
    onUpdateHud,
    onUpdateHealthHud,
    onClearSavedGameState,
    onResetBootstrapState,          // () => void — resets all primitives that live in bootstrap's closure
    onSetPlayerWorldPos,            // (x, y) => void — updates playerWorldX/Y and playerSystem position
    onLog
}) {
    function resetCombatEntities() {
        enemySystem.resetEnemies();
        remotePlayerSystem.clear();
        onGetProjectileRuntime()?.resetAllProjectiles();
    }

    // Full run reset: player, world, buildings, civilians, enemies, and resources.
    function resetRunState() {
        playerState.hp = PLAYER_MAX_HP;
        playerState.invulnFrames = 0;
        playerState.isDead = false;
        playerCombat.weapon = 'sword';
        playerCombat.cooldownFrames = 0;
        combatStats.enemiesKilled = 0;
        inventory.wood = 0;
        inventory.stone = 0;
        inventory.iron = 0;
        inventory.gold = 0;
        sharedSessionState.paused = false;
        sharedSessionState.restartVersion = 0;
        sharedSessionState.restartVotes = 0;
        sharedSessionState.restartEligiblePlayers = 0;

        // Reset all primitives owned by bootstrap's closure (timers, perf counters, UI flags, etc.)
        onResetBootstrapState();

        const respawn = onFindSafeSpawnPosition();
        onSetPlayerWorldPos(respawn.x, respawn.y);

        worldSystem.reset();
        buildingSystem.reset();
        civilianSystem.reset();
        resetCombatEntities();

        for (const runtime of multiplayerPlayerRuntime.values()) {
            runtime.hp = runtime.maxHp;
            runtime.isDead = false;
            runtime.invulnFrames = 0;
            runtime.respawnTimer = 0;
            runtime.kills = 0;
            runtime.x = respawn.x + TILE_SIZE / 2;
            runtime.y = respawn.y + TILE_SIZE / 2;
        }

        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            onReleaseFloatingTextEntry(floatingTexts[i]);
            floatingTexts.splice(i, 1);
        }

        onUpdateVisibleWorld();
        onUpdateHud();
        onUpdateHealthHud();
        onClearSavedGameState();
    }

    function executeForceReset() {
        crashLogs.length = 0;
        crashLogger?.persist();
        persistenceController?.clearSavedGameState();
        persistenceController?.clearMultiplayerCheckpointCache();
        resetRunState();
        onLog('Force reset executed (world regenerated, save/checkpoint cache cleared)');
    }

    return { resetRunState, executeForceReset, resetCombatEntities };
}
