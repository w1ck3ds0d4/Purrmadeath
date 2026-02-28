import * as PIXI from 'pixi.js';
import {
    BUILDING_TYPES,
    ENEMY_BLOCKED_REPATH_INTERVAL_FRAMES,
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
    ENEMY_REPATH_JITTER_FRAMES,
    ENEMY_REPATH_INTERVAL_FRAMES,
    ENEMY_SIZE,
    ENEMY_SPEED,
    ENEMY_SPAWN_INTERVAL_FRAMES,
    GOLD_PER_ENEMY_KILL,
    INVULN_FRAMES_ON_HIT,
    MAX_ENEMY_PROJECTILES,
    MAX_BULLETS,
    MAX_TOWER_PROJECTILES,
    PERFORMANCE_GOVERNOR,
    PERFORMANCE_PROFILES,
    PLAYER_COLLISION_RADIUS,
    PLAYER_INVULN_FRAMES,
    PLAYER_MAX_HP,
    PROJECTILES,
    TILE_SIZE,
    WEAPONS
} from '../config/constants.js';
import { createBuildingSystem } from '../systems/buildingSystem.js';
import { resolveDebugCommandView, ALLOWED_DEBUG_VIEWS } from '../ui/debugConsoleCommands.js';
import { createMultiplayerClient } from '../net/multiplayerClient.js';
import { computeBuildingStateHash } from '../net/replicationStateHash.js';
import { appendDebugLog, downloadDebugSessionLogs as exportDebugSessionLogs } from '../ui/debugConsoleLogs.js';
import { buildDebugOverlayLines, renderDebugOverlayPanel } from '../ui/debugConsoleOverlayRenderer.js';
import { ensureRuntimePlayer as ensureRuntimePlayerEntry, getRuntimePlayerCenterById, syncRuntimePlayersFromSnapshot as syncRuntimePlayersFromSnapshotEntries } from '../multiplayer/runtimePlayers.js';
import { createCivilianSystem } from '../systems/civilianSystem.js';
import { createEnemySystem } from '../systems/enemySystem.js';
import { createPlayerSystem } from '../systems/playerSystem.js';
import { createRemotePlayerSystem } from '../systems/remotePlayerSystem.js';
import { createWorldSystem } from '../systems/worldSystem.js';
import {
    addToSpatialIndex,
    clearSpatialIndex,
    formatGameClock,
    querySpatialIndexInto
} from './runtimeUtils.js';
import { createCrashLogger } from './crashLogger.js';
import { createPersistenceController } from './persistenceController.js';
import { createProjectileRuntime } from './projectileRuntime.js';
import { createSimulationLoopController } from './simulationLoopController.js';
import {
    updateBuildMenuPanel,
    updateClockAndSessionCard,
    updateHealthHudBar,
    updatePauseMenuTextForSession
} from './hudRenderer.js';

export async function startGame(startOptions = {}) {
    const TOP_BAR_HEIGHT = 40;
    const SIDE_PANEL_MARGIN = 12;
    const SIDE_PANEL_TOP = TOP_BAR_HEIGHT + 12;
    const DEBUG_PANEL_MARGIN = 12;
    const DEBUG_PANEL_WIDTH = 360;

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
    const buildingLayer = new PIXI.Container();
    const civilianLayer = new PIXI.Container();
    const remotePlayerLayer = new PIXI.Container();
    const enemyLayer = new PIXI.Container();
    const projectileLayer = new PIXI.Container();
    world.addChild(tileLayer);
    world.addChild(resourceLayer);
    world.addChild(buildingLayer);
    world.addChild(civilianLayer);
    world.addChild(remotePlayerLayer);
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
    const spawnWorldPos = { x: TILE_SIZE / 2, y: TILE_SIZE / 2 };
    const playerSystem = createPlayerSystem({
        stage: app.stage,
        spawnWorldX: spawnWorldPos.x,
        spawnWorldY: spawnWorldPos.y,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight
    });
    const playerState = playerSystem.state;
    playerState.hp = PLAYER_MAX_HP;
    playerState.maxHp = PLAYER_MAX_HP;
    const playerCombat = playerSystem.combat;
    const floatingTexts = [];
    const enemies = [];
    const floatingTextPool = [];
    const floatingTextEntryPool = [];
    const queryBufferA = [];
    const queryBufferB = [];
    const benchmarkState = {
        active: false,
        elapsedMs: 0,
        frameCount: 0,
        frameMsAccum: 0
    };
    let enemySpawnTimer = 0;
    let enemyIdCounter = 0;
    let uiRefreshTimer = 0;
    let saveTimerFrames = 0;
    let gameTimeSeconds = 0;
    const sharedSessionState = {
        paused: false,
        restartVersion: 0,
        restartVotes: 0,
        restartEligiblePlayers: 0
    };
    let lastAppliedRestartVersion = 0;
    let sessionStateInitialized = false;
    let multiplayerCheckpointLoadedForSession = null;
    let multiplayerCheckpointTimerMs = 10000;
    let nextClientActionId = 1;
    const pendingActionAcks = new Map();
    const debugLogs = [];
    // Browser-side crash records are persisted in localStorage for post-mortem checks.
    const crashLogs = [];
    let crashLogger = null;
    let persistenceController = null;
    let debugOverlayEnabled = false;
    let debugOverlayView = 'all';
    let debugCommandActive = false;
    let debugCommandBuffer = '';
    let smoothedFps = 60;
    let isPaused = false;
    let enemiesDisabled = false;
    let simFrameIndex = 0;
    let activePerfProfileKey = 'quality';
    let activePerfProfile = PERFORMANCE_PROFILES[activePerfProfileKey];
    let autoPerfGovernorEnabled = PERFORMANCE_GOVERNOR.autoEnabledByDefault;
    let overBudgetFrameStreak = 0;
    let stableFrameStreak = 0;
    const systemPerfMs = {
        buildings: 0,
        civilians: 0,
        enemies: 0,
        towerCombat: 0,
        enemyRanged: 0,
        projectiles: 0,
        ui: 0
    };
    const systemDeferred = {
        civilianSkippedFrames: 0,
        towerSkippedFrames: 0,
        enemyRangedSkippedFrames: 0
    };
    const systemOverBudget = {
        buildings: 0,
        civilians: 0,
        enemies: 0,
        towerCombat: 0,
        enemyRanged: 0,
        projectiles: 0,
        ui: 0
    };
    const enemySpatialIndex = {
        cellSize: TILE_SIZE * 8,
        grid: new Map()
    };
    const civilianSpatialIndex = {
        cellSize: TILE_SIZE * 8,
        grid: new Map()
    };
    let buildingSystem = null;
    let civilianSystem = null;
    let enemySystem = null;
    let projectileRuntime = null;
    let projectiles = [];
    let towerProjectiles = [];
    let enemyProjectiles = [];
    let lastAppliedMultiplayerSnapshotTick = -1;
    let lastAppliedNonPlayerSnapshotSeq = -1;
    let lastAppliedBuildingsRevision = -1;
    let outboundEntitySnapshotSeq = 0;
    let outboundEntitySnapshotTimerMs = 0;
    let outboundBuildingSyncTimerMs = 0;
    let outboundBuildingRevision = 0;
    let lastOutboundBuildingStateHash = '';
    let lastKnownRemotePlayerCount = 0;
    let latestServerAiDirectives = null;
    // Multiplayer sync tuning knobs (host authority side).
    const ENTITY_SNAPSHOT_INTERVAL_MS = 50;
    const BUILDING_SYNC_INTERVAL_MS = 250;
    // Reconciliation tuning for local player correction against server snapshots.
    const PLAYER_RECONCILE_HARD_SNAP_DISTANCE = TILE_SIZE * 10;
    const PLAYER_RECONCILE_DEADZONE = TILE_SIZE * 0.18;
    const PLAYER_RECONCILE_BLEND = 0.24;
    const PLAYER_RECONCILE_MAX_STEP = TILE_SIZE * 0.6;
    const remotePlayerSystem = createRemotePlayerSystem({ layer: remotePlayerLayer });
    const urlParams = new URLSearchParams(window.location.search);
    const optionsMode = typeof startOptions.mode === 'string' ? startOptions.mode : '';
    const multiplayerQueryEnabled = optionsMode === 'multiplayer'
        || urlParams.get('multiplayer') === '1'
        || urlParams.get('mp') === '1';
    // LAN host hint for dev console sharing. Defaults to a placeholder to avoid
    // committing personal/local network addresses into source control.
    const DEV_LAN_HOST_HINT = startOptions.multiplayer?.lanHostHint
        || urlParams.get('lanHostHint')
        || (window.location.hostname !== 'localhost' && window.location.hostname !== '0.0.0.0' ? window.location.hostname : '<HOST_LAN_IP>');
    const multiplayerProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // Multiplayer host override for LAN join testing (example: ?mp=1&mpHost=192.168.1.10).
    // `0.0.0.0` is a bind address, not a routable destination for clients.
    const defaultMultiplayerHost = (window.location.hostname === '0.0.0.0' || window.location.hostname === '::')
        ? 'localhost'
        : window.location.hostname;
    const multiplayerHost = startOptions.multiplayer?.host || urlParams.get('mpHost') || defaultMultiplayerHost;
    const multiplayerPort = Number(startOptions.multiplayer?.port ?? urlParams.get('mpPort')) || 8080;
    const multiplayerJoinToken = startOptions.multiplayer?.joinToken || urlParams.get('joinToken') || '';
    const multiplayerUrl = `${multiplayerProtocol}://${multiplayerHost}:${multiplayerPort}`;
    const multiplayerClient = createMultiplayerClient({
        url: multiplayerUrl,
        joinToken: multiplayerJoinToken,
        onLog: (message) => logDebug(message)
    });
    // World streaming/resource system; owns terrain cache and node spawning.
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

    // Shared walkability rule used by player/enemies/projectiles.
    function isTileWalkable(tileX, tileY) {
        const hasBridge = buildingSystem?.hasBridgeAt(tileX, tileY) ?? false;
        const terrainWalkable = worldSystem.isTileWalkable(tileX, tileY) || hasBridge;
        return terrainWalkable && !(buildingSystem?.isTileBlocked(tileX, tileY) ?? false);
    }
    // Enemy runtime logic is managed in `systems/enemySystem.js`.
    function findSafeSpawnPosition() {
        return { x: TILE_SIZE / 2, y: TILE_SIZE / 2 };
    }
    const player = playerSystem.sprite;

    const hudText = new PIXI.Text({
        text: '',
        style: {
            fill: '#ffffff',
            fontFamily: 'monospace',
            fontSize: 16
        }
    });
    hudText.position.set(16, 10);
    app.stage.addChild(hudText);
    const clockText = new PIXI.Text({
        text: '',
        style: {
            fill: '#ffffff',
            fontFamily: 'monospace',
            fontSize: 16
        }
    });
    app.stage.addChild(clockText);
    const sessionCardText = new PIXI.Text({
        text: '',
        style: {
            fill: '#bfffd1',
            fontFamily: 'monospace',
            fontSize: 12
        }
    });
    sessionCardText.visible = false;
    app.stage.addChild(sessionCardText);
    const sessionCardBackground = new PIXI.Graphics();
    sessionCardBackground.visible = false;
    app.stage.addChildAt(sessionCardBackground, app.stage.getChildIndex(sessionCardText));
    const topBarBackground = new PIXI.Graphics();
    app.stage.addChildAt(topBarBackground, app.stage.getChildIndex(hudText));

    const buildMenuText = new PIXI.Text({
        text: '',
        style: {
            fill: '#f0e4c2',
            fontFamily: 'monospace',
            fontSize: 14
        }
    });
    buildMenuText.position.set(28, 72);
    buildMenuText.visible = false;
    app.stage.addChild(buildMenuText);
    const buildMenuBackground = new PIXI.Graphics();
    buildMenuBackground.visible = false;
    app.stage.addChildAt(buildMenuBackground, app.stage.getChildIndex(buildMenuText));

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
    const weaponText = new PIXI.Text({
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
    app.stage.addChild(weaponText);

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
        text: 'Paused\nPress ESC to resume\nPress R to restart run',
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

    function updatePauseMenuText() {
        const multiplayerStats = multiplayerClient.getStats();
        updatePauseMenuTextForSession(
            pauseText,
            multiplayerStats.connected,
            sharedSessionState.restartVotes,
            sharedSessionState.restartEligiblePlayers
        );
    }

    const debugText = new PIXI.Text({
        text: '',
        style: {
            fill: '#8df7ff',
            fontFamily: 'monospace',
            fontSize: 13,
            wordWrap: true,
            wordWrapWidth: DEBUG_PANEL_WIDTH - 24,
            breakWords: true
        }
    });
    debugText.visible = false;
    debugText.position.set(window.innerWidth - DEBUG_PANEL_WIDTH + 12 - SIDE_PANEL_MARGIN, SIDE_PANEL_TOP + 54);
    const debugNavText = new PIXI.Text({
        text: '',
        style: {
            fill: '#9fffa8',
            fontFamily: 'monospace',
            fontSize: 12,
            wordWrap: false
        }
    });
    debugNavText.visible = false;
    debugNavText.position.set(window.innerWidth - DEBUG_PANEL_WIDTH + 12 - SIDE_PANEL_MARGIN, SIDE_PANEL_TOP + 10);
    const debugInputBackground = new PIXI.Graphics();
    debugInputBackground.visible = false;
    const debugInputText = new PIXI.Text({
        text: '',
        style: {
            fill: '#d7f4ff',
            fontFamily: 'monospace',
            fontSize: 12
        }
    });
    debugInputText.visible = false;
    const debugVerdictText = new PIXI.Text({
        text: '',
        style: {
            fill: '#8df7ff',
            fontFamily: 'monospace',
            fontSize: 12
        }
    });
    debugVerdictText.visible = false;
    const debugPanelBackground = new PIXI.Graphics();
    debugPanelBackground.visible = false;
    app.stage.addChild(debugPanelBackground);
    app.stage.addChild(debugText);
    app.stage.addChild(debugNavText);
    app.stage.addChild(debugInputBackground);
    app.stage.addChild(debugInputText);
    app.stage.addChild(debugVerdictText);

    function updateHud() {
        const buildUi = buildingSystem?.getUiState();
        const buildMode = buildUi?.buildMode ? 'ON' : 'OFF';
        const buildType = buildUi?.selectedLabel ?? 'None';
        const civStats = civilianSystem?.getStats() ?? { civilianCount: 0, civilianCap: 0 };
        hudText.text = `Wood: ${inventory.wood}   Stone: ${inventory.stone}   Iron: ${inventory.iron}   Gold: ${inventory.gold}   Kills: ${combatStats.enemiesKilled}   Civilians: ${civStats.civilianCount}/${civStats.civilianCap}   Build: ${buildMode} (${buildType})`;
        topBarBackground.clear();
        topBarBackground.rect(0, 0, window.innerWidth, TOP_BAR_HEIGHT);
        topBarBackground.fill(0x111111);
        topBarBackground.alpha = 0.85;
        updateClockHud();
        updateBuildMenu();
        updateHealthHud();
    }

    function updateClockHud() {
        const multiplayerStats = multiplayerClient.getStats();
        updateClockAndSessionCard({
            clockText,
            gameTimeText: `Time ${formatGameClock(gameTimeSeconds)}`,
            windowWidth: window.innerWidth,
            sessionCardBackground,
            sessionCardText,
            multiplayerConnected: multiplayerStats.connected,
            multiplayerIsAuthority: multiplayerStats.isAuthority,
            remotePlayerCount: multiplayerStats.remotePlayerCount
        });
    }

    function rebuildRuntimeSpatialIndexes(civilianTargets = null) {
        clearSpatialIndex(enemySpatialIndex);
        clearSpatialIndex(civilianSpatialIndex);
        for (const enemy of enemies) {
            if (enemy.isDead) {
                continue;
            }
            addToSpatialIndex(enemySpatialIndex, enemy.x + ENEMY_RADIUS, enemy.y + ENEMY_RADIUS, enemy);
        }
        const civilians = civilianTargets ?? (civilianSystem?.getTargets() ?? []);
        for (const civilian of civilians) {
            if (civilian.isDead) {
                continue;
            }
            addToSpatialIndex(civilianSpatialIndex, civilian.x, civilian.y, civilian);
        }
    }

    function updateBuildMenu() {
        updateBuildMenuPanel({
            buildingSystem,
            buildMenuText,
            buildMenuBackground,
            sidePanelTop: SIDE_PANEL_TOP,
            sidePanelMargin: SIDE_PANEL_MARGIN,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight
        });
    }

    function updateHealthHud() {
        updateHealthHudBar({
            playerState,
            playerWeapon: playerCombat.weapon,
            healthBarBackground,
            healthBarFill,
            healthText,
            weaponText,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight
        });
    }

    function logDebug(message, level = null) {
        appendDebugLog(debugLogs, message, level, 300);
    }

    function downloadDebugSessionLogs() {
        exportDebugSessionLogs(debugLogs);
    }

    function setDebugOverlayView(view) {
        if (!ALLOWED_DEBUG_VIEWS.has(view)) {
            return false;
        }
        debugOverlayView = view;
        logDebug(`Debug view: ${debugOverlayView}`);
        return true;
    }

    function executeDebugCommand(commandText) {
        const resolved = resolveDebugCommandView(commandText);
        if (resolved.view) {
            return setDebugOverlayView(resolved.view);
        }
        if (resolved.action === 'force_reset') {
            const multiplayerStats = multiplayerClient.getStats();
            if (multiplayerStats.connected && !multiplayerStats.isAuthority) {
                multiplayerClient.sendPlayerAction({ type: 'force_reset_session' });
                logDebug('Force reset requested from host authority');
                return true;
            }
            executeForceReset();
            return true;
        }
        if (resolved.action === 'export_logs') {
            downloadDebugSessionLogs();
            logDebug('Info/warn logs exported');
            return true;
        }
        if (resolved.help) {
            logDebug('Commands: /core /perf /cheats /multiplayer /server /logs /all /force-reset /export-logs');
            return true;
        }
        logDebug(`Unknown command: ${resolved.unknown ?? commandText.trim().toLowerCase()}`);
        return false;
    }

    function updatePerformanceGovernor(frameOverBudget) {
        if (!autoPerfGovernorEnabled) {
            return;
        }
        const multiplayerStats = multiplayerClient.getStats();
        const serverPerfStats = multiplayerStats.serverPerf ?? null;
        const serverUnderLoad = Boolean(
            multiplayerStats.connected &&
            serverPerfStats &&
            Number(serverPerfStats.connectedClients || 0) > 1 &&
            (
                Number(serverPerfStats.simMsAvg || 0) >= Number(serverPerfStats.targetTickMs || 0) * 0.85 ||
                Number(serverPerfStats.loopLagMsAvg || 0) >= 8
            )
        );
        if (frameOverBudget) {
            overBudgetFrameStreak += 1;
            stableFrameStreak = 0;
        } else {
            stableFrameStreak += 1;
            overBudgetFrameStreak = 0;
        }

        if (
            activePerfProfileKey === 'quality' &&
            (
                overBudgetFrameStreak >= PERFORMANCE_GOVERNOR.downgradeOverBudgetFrames ||
                serverUnderLoad
            )
        ) {
            activePerfProfileKey = 'stress';
            activePerfProfile = PERFORMANCE_PROFILES[activePerfProfileKey];
            overBudgetFrameStreak = 0;
            stableFrameStreak = 0;
            logDebug(serverUnderLoad ? 'Auto governor switched to stress profile (server load)' : 'Auto governor switched to stress profile');
            return;
        }

        if (
            activePerfProfileKey === 'stress' &&
            stableFrameStreak >= PERFORMANCE_GOVERNOR.recoverStableFrames &&
            smoothedFps >= PERFORMANCE_GOVERNOR.recoverMinFps
        ) {
            activePerfProfileKey = 'quality';
            activePerfProfile = PERFORMANCE_PROFILES[activePerfProfileKey];
            overBudgetFrameStreak = 0;
            stableFrameStreak = 0;
            logDebug('Auto governor restored quality profile');
        }
    }

    function startStressBenchmark() {
        // Developer-only benchmark: force stress profile and spawn a burst,
        // then collect a 10-second FPS/over-budget summary in the main loop.
        benchmarkState.active = true;
        benchmarkState.elapsedMs = 0;
        benchmarkState.frameCount = 0;
        benchmarkState.frameMsAccum = 0;
        activePerfProfileKey = 'stress';
        activePerfProfile = PERFORMANCE_PROFILES[activePerfProfileKey];
        overBudgetFrameStreak = 0;
        stableFrameStreak = 0;
        outboundEntitySnapshotTimerMs = 0;
        outboundEntitySnapshotSeq = 0;
        outboundBuildingSyncTimerMs = 0;
        outboundBuildingRevision = 0;
        lastOutboundBuildingStateHash = '';
        lastKnownRemotePlayerCount = 0;
        lastAppliedBuildingsRevision = -1;
        pendingActionAcks.clear();
        lastAppliedNonPlayerSnapshotSeq = -1;
        const spawned = enemySystem.spawnBurst(200);
        logDebug(`Benchmark started (spawned ${spawned} enemies)`);
    }

    function updateDebugOverlay(frameMs) {
        if (!debugOverlayEnabled) {
            return;
        }
        const worldStats = worldSystem.getStats();
        const buildingStats = buildingSystem?.getStats() ?? { buildingCount: 0 };
        const civilianStats = civilianSystem?.getStats() ?? { civilianCount: 0, civilianCap: 0, civiliansKilled: 0 };
        const pathStats = enemySystem?.getPathStats() ?? { requests: 0, executed: 0, deferred: 0, budget: ENEMY_MAX_REPATHS_PER_FRAME };
        const multiplayerStats = multiplayerClient.getStats();
        const serverPerfStats = multiplayerStats.serverPerf ?? null;
        const civPerf = civilianStats.perf ?? {
            updateMs: 0,
            assignmentCalls: 0,
            assignmentSkippedByBudget: 0,
            producerQueries: 0,
            warehouseQueries: 0,
            collisionPasses: 0,
            civiliansResolvedCollisions: 0
        };
        const buildUi = buildingSystem?.getUiState?.() ?? { buildMode: false };
        const overlayLines = buildDebugOverlayLines({
            debugOverlayView,
            smoothedFps,
            frameMs,
            playerState,
            playerCombat,
            playerWorldX,
            playerWorldY,
            tileSize: TILE_SIZE,
            enemies,
            enemyMaxCount: ENEMY_MAX_COUNT,
            enemiesDisabled,
            projectiles,
            towerProjectiles,
            enemyProjectiles,
            crashLogsLength: crashLogs.length,
            worldStats,
            buildingStats,
            civilianStats,
            pathStats,
            multiplayerStats,
            serverPerfStats,
            civPerf,
            activePerfProfileKey,
            autoPerfGovernorEnabled,
            benchmarkState,
            overBudgetFrameStreak,
            stableFrameStreak,
            systemPerfMs,
            activePerfProfile,
            systemDeferred,
            systemOverBudget,
            devLanHostHint: DEV_LAN_HOST_HINT,
            locationProtocol: window.location.protocol,
            locationPort: window.location.port,
            buildModeEnabled: Boolean(buildUi.buildMode),
            debugLogs
        });

        renderDebugOverlayPanel({
            panelElements: {
                debugText,
                debugNavText,
                debugInputBackground,
                debugInputText,
                debugVerdictText,
                debugPanelBackground
            },
            viewport: {
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight,
                sidePanelMargin: SIDE_PANEL_MARGIN,
                sidePanelTop: SIDE_PANEL_TOP,
                debugPanelMargin: DEBUG_PANEL_MARGIN
            },
            debugOverlayView,
            lines: overlayLines.lines,
            logLines: overlayLines.logLines,
            showAll: overlayLines.showAll,
            serverPerfStats,
            multiplayerStats,
            debugCommandActive,
            debugCommandBuffer
        });
    }

    function resetCombatEntities() {
        enemySystem.resetEnemies();
        remotePlayerSystem.clear();
        lastAppliedMultiplayerSnapshotTick = -1;
        lastAppliedNonPlayerSnapshotSeq = -1;
        projectileRuntime?.resetAllProjectiles();
    }

    // Full run reset: player, world, buildings, civilians, enemies, and resources.
    function resetRunState() {
        playerState.hp = playerState.maxHp;
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
        gameTimeSeconds = 0;
        simFrameIndex = 0;
        systemDeferred.civilianSkippedFrames = 0;
        systemDeferred.towerSkippedFrames = 0;
        systemDeferred.enemyRangedSkippedFrames = 0;
        systemOverBudget.buildings = 0;
        systemOverBudget.civilians = 0;
        systemOverBudget.enemies = 0;
        systemOverBudget.towerCombat = 0;
        systemOverBudget.enemyRanged = 0;
        systemOverBudget.projectiles = 0;
        systemOverBudget.ui = 0;
        overBudgetFrameStreak = 0;
        stableFrameStreak = 0;
        outboundEntitySnapshotTimerMs = 0;
        outboundEntitySnapshotSeq = 0;
        outboundBuildingSyncTimerMs = 0;
        outboundBuildingRevision = 0;
        lastOutboundBuildingStateHash = '';
        lastKnownRemotePlayerCount = 0;
        lastAppliedBuildingsRevision = -1;

        deathText.visible = false;
        const respawn = findSafeSpawnPosition();
        playerWorldX = respawn.x;
        playerWorldY = respawn.y;
        playerSystem.setWorldPosition(playerWorldX, playerWorldY);

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
            releaseFloatingTextEntry(floatingTexts[i]);
            floatingTexts.splice(i, 1);
        }

        harvestRequested = false;
        placeRequested = false;
        inspectRequested = false;
        deleteBuildingRequested = false;
        keys.attack = false;

        updateVisibleWorld();
        updateHud();
        updateHealthHud();
        clearSavedGameState();
    }

    function executeForceReset() {
        crashLogs.length = 0;
        crashLogger?.persist();
        persistenceController?.clearSavedGameState();
        persistenceController?.clearMultiplayerCheckpointCache();
        resetRunState();
        logDebug('Force reset executed (world regenerated, save/checkpoint cache cleared)');
    }

    function registerEnemyKill(attackerPlayerId = null) {
        const multiplayerStats = multiplayerClient.getStats();
        if (multiplayerStats.connected && multiplayerStats.isAuthority) {
            let creditedPlayerId = Math.floor(Number(attackerPlayerId) || 0);
            if (creditedPlayerId <= 0) {
                creditedPlayerId = Math.floor(Number(multiplayerStats.playerId) || 0);
            }
            if (creditedPlayerId > 0) {
                const runtime = ensureRuntimePlayer(creditedPlayerId);
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
        updateHud();
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
            updateHealthHud();
        } else if (enemySystem?.isEnemyEntity(target)) {
            enemySystem.updateEnemyHealthBar(target);
        }

        if (target.hp <= 0) {
            target.isDead = true;
            if (target === playerState) {
                deathText.visible = true;
                clearSavedGameState();
                logDebug(`Player defeated by ${source}`);
            } else if (enemySystem?.isEnemyEntity(target)) {
                registerEnemyKill(attackerPlayerId);
            }
        }

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
        projectileRuntime?.spawnPlayerBullet(playerCenterX, playerCenterY, dirX, dirY, ownerPlayerId, damageMultiplier);
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
        spawnFloatingFeedback('*', muzzleX, muzzleY, '#ffd166', 16);
    }

    function updateProjectiles(deltaMoveScale, civilianTargetsSnapshot = null) {
        projectileRuntime?.updateProjectiles(deltaMoveScale, civilianTargetsSnapshot);
    }

    function updateTowerCombat(aiDirectives = null) {
        projectileRuntime?.updateTowerCombat(aiDirectives, queryBufferA);
    }

    function updateEnemyRangedCombat(deltaFrames, aiDirectives = null) {
        projectileRuntime?.updateEnemyRangedCombat(deltaFrames, enemiesDisabled, aiDirectives, queryBufferB);
    }

    function spawnFloatingFeedback(textValue, worldX, worldY, color = '#ffffff', ttlFrames = 75) {
        const text = floatingTextPool.pop() ?? new PIXI.Text({
            text: '',
            style: {
                fill: color,
                fontFamily: 'monospace',
                fontSize: 14
            }
        });
        text.style.fill = color;
        text.text = textValue;
        text.alpha = 1;
        text.anchor.set(0.5);
        text.position.set(worldX, worldY);
        text.visible = true;
        resourceLayer.addChild(text);
        const entry = floatingTextEntryPool.pop() ?? { sprite: text, ttl: 0 };
        entry.sprite = text;
        entry.ttl = ttlFrames;
        floatingTexts.push(entry);
    }

    function spawnHarvestFeedback(resourceType, tileX, tileY) {
        spawnFloatingFeedback(`+1 ${resourceType}`, tileX * TILE_SIZE + TILE_SIZE / 2, tileY * TILE_SIZE + 6, '#ffffff', 75);
    }

    function releaseFloatingTextEntry(entry) {
        if (!entry || !entry.sprite) {
            return;
        }
        entry.sprite.visible = false;
        entry.sprite.position.set(-99999, -99999);
        floatingTextPool.push(entry.sprite);
        entry.sprite = null;
        entry.ttl = 0;
        floatingTextEntryPool.push(entry);
    }

    let playerWorldX = spawnWorldPos.x;
    let playerWorldY = spawnWorldPos.y;
    const multiplayerPlayerRuntime = new Map();
    const PLAYER_RESPAWN_SECONDS = 15;

    const keys = {};
    let harvestRequested = false;
    let placeRequested = false;
    let inspectRequested = false;
    let deleteBuildingRequested = false;
    let leftMouseDown = false;
    let mouseScreenX = window.innerWidth / 2;
    let mouseScreenY = window.innerHeight / 2;

    function getMovementInputVector() {
        const moveX = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
        const moveY = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
        const magnitude = Math.hypot(moveX, moveY);
        if (magnitude <= 0.0001) {
            return { x: 0, y: 0 };
        }
        return { x: moveX / magnitude, y: moveY / magnitude };
    }

    function screenToWorldTile(screenX, screenY) {
        return {
            tileX: Math.floor((screenX - world.position.x) / TILE_SIZE),
            tileY: Math.floor((screenY - world.position.y) / TILE_SIZE)
        };
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
                updateHud();
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
                updateHud();
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
                updateHud();
                return { actionType: 'harvest', accepted: true, reason: '' };
            }
            const collected = buildingSystem.collectNearestOutput(centerX, centerY, TILE_SIZE * 3);
            if (collected && inventory[collected.resourceType] !== undefined) {
                inventory[collected.resourceType] += collected.amount;
                updateHud();
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
                updateHud();
            }
            return { actionType: 'revive', accepted: revived, reason: revived ? '' : 'no_target' };
        }
        if (action.type === 'toggle_pause') {
            sharedSessionState.paused = !sharedSessionState.paused;
            isPaused = sharedSessionState.paused;
            updatePauseMenuText();
            pauseText.visible = isPaused;
            return { actionType: 'toggle_pause', accepted: true, reason: '' };
        }
        if (action.type === 'restart_session') {
            sharedSessionState.paused = false;
            isPaused = false;
            pauseText.visible = false;
            resetRunState();
            return { actionType: 'restart_session', accepted: true, reason: '' };
        }
        if (action.type === 'force_reset_session') {
            executeForceReset();
            return { actionType: 'force_reset_session', accepted: true, reason: '' };
        }
        if (action.type === 'dev_add_resources') {
            inventory.wood += 100;
            inventory.stone += 100;
            inventory.iron += 100;
            inventory.gold += 100;
            updateHud();
            return { actionType: 'dev_add_resources', accepted: true, reason: '' };
        }
        return { actionType: action.type, accepted: false, reason: 'unsupported' };
    }

    function getMultiplayerPlayerCenterById(playerId) {
        return getRuntimePlayerCenterById(multiplayerClient.getSnapshotState().players, playerId, TILE_SIZE);
    }

    function ensureRuntimePlayer(playerId) {
        return ensureRuntimePlayerEntry(multiplayerPlayerRuntime, playerId, {
            maxHp: PLAYER_MAX_HP,
            centerX: playerWorldX + TILE_SIZE / 2,
            centerY: playerWorldY + TILE_SIZE / 2
        });
    }

    function syncRuntimePlayersFromSnapshot(multiplayerSnapshot) {
        syncRuntimePlayersFromSnapshotEntries(
            multiplayerPlayerRuntime,
            multiplayerSnapshot.players,
            TILE_SIZE,
            { x: playerWorldX + TILE_SIZE / 2, y: playerWorldY + TILE_SIZE / 2 },
            PLAYER_MAX_HP
        );
    }
    // Building placement + production system.
    buildingSystem = createBuildingSystem({
        buildingLayer,
        getWorldPosition: () => ({ x: world.position.x, y: world.position.y }),
        getMouseScreenPosition: () => ({ x: mouseScreenX, y: mouseScreenY }),
        isTileWalkableBase: (tileX, tileY) => worldSystem.isTileWalkable(tileX, tileY),
        isTileWaterBase: (tileX, tileY) => worldSystem.isTileWater(tileX, tileY),
        getPlayerCenter: () => playerSystem.getCenter(),
        getEnemies: () => enemySystem?.getEnemies() ?? enemies,
        inventory,
        buildingTypes: BUILDING_TYPES,
        onLog: (message) => logDebug(message)
    });
    // Persistence/diagnostics controllers extracted from index.js keep core loop smaller.
    persistenceController = createPersistenceController({
        getGameTimeSeconds: () => gameTimeSeconds,
        setGameTimeSeconds: (value) => {
            gameTimeSeconds = value;
        },
        getPlayerWorldPosition: () => ({ x: playerWorldX, y: playerWorldY }),
        setPlayerWorldPosition: ({ x, y }) => {
            playerWorldX = x;
            playerWorldY = y;
            playerSystem.setWorldPosition(playerWorldX, playerWorldY);
        },
        playerState,
        playerCombat,
        inventory,
        combatStats,
        worldSystem,
        buildingSystem,
        sharedSessionState,
        setPausedState: (value) => {
            isPaused = value;
            pauseText.visible = isPaused;
        },
        updateVisibleWorld,
        updateHud,
        updateHealthHud,
        updateClockHud
    });
    const persistSaveState = () => persistenceController?.persistSaveState();
    const clearSavedGameState = () => persistenceController?.clearSavedGameState();
    const clearMultiplayerCheckpointCache = () => persistenceController?.clearMultiplayerCheckpointCache();
    const restoreSavedGameState = () => Boolean(persistenceController?.restoreSavedGameState());
    const persistMultiplayerCheckpoint = (sessionId) => persistenceController?.persistMultiplayerCheckpoint(sessionId);
    const tryRestoreMultiplayerCheckpoint = (sessionId) => Boolean(persistenceController?.tryRestoreMultiplayerCheckpoint(sessionId));

    crashLogger = createCrashLogger(crashLogs);
    const downloadCrashLogs = () => crashLogger?.download();
    crashLogger.load();
    crashLogger.bindGlobalHandlers();

    // Enemy AI/spawn/pathfinding system.
    enemySystem = createEnemySystem({
        enemyList: enemies,
        enemyLayer,
        isTileWalkable,
        getWorldPosition: () => ({ x: world.position.x, y: world.position.y }),
        getViewportSize: () => ({ width: window.innerWidth, height: window.innerHeight }),
        getPlayerCenter: () => playerSystem.getCenter(),
        getPlayerTile: () => playerSystem.getTile(),
        isPlayerDead: () => playerState.isDead,
        getPlayerCollisionRadius: () => PLAYER_COLLISION_RADIUS,
        setPlayerWorldPosition: (x, y) => {
            playerWorldX = x;
            playerWorldY = y;
            playerSystem.setWorldPosition(x, y);
        },
        canMovePlayerTo: (x, y) => {
            const tileX = Math.floor((x + TILE_SIZE / 2) / TILE_SIZE);
            const tileY = Math.floor((y + TILE_SIZE / 2) / TILE_SIZE);
            return isTileWalkable(tileX, tileY);
        },
        getPlayerTargets: () => {
            const stats = multiplayerClient.getStats();
            if (!stats.connected || !stats.isAuthority) {
                const center = playerSystem.getCenter();
                return [{
                    id: stats.playerId ?? 'local',
                    x: center.x,
                    y: center.y,
                    radius: PLAYER_COLLISION_RADIUS,
                    isDead: playerState.isDead
                }];
            }
            const targets = [];
            for (const runtime of multiplayerPlayerRuntime.values()) {
                targets.push({
                    id: runtime.id,
                    x: runtime.x,
                    y: runtime.y,
                    radius: PLAYER_COLLISION_RADIUS,
                    isDead: runtime.isDead
                });
            }
            return targets;
        },
        onPlayerContactDamage: (amount, source, playerId) => {
            const stats = multiplayerClient.getStats();
            if (stats.connected && stats.isAuthority) {
                // Dedicated server authority resolves enemy melee contact damage in multiplayer.
                return;
            }
            if (!stats.connected || !stats.isAuthority) {
                applyDamage(playerState, amount, source);
                return;
            }
            const runtime = ensureRuntimePlayer(playerId ?? stats.playerId);
            applyDamage(runtime, amount, source);
            if (runtime.isDead) {
                runtime.respawnTimer = PLAYER_RESPAWN_SECONDS;
            }
            if (String(stats.playerId) === String(runtime.id)) {
                playerState.hp = runtime.hp;
                playerState.isDead = runtime.isDead;
                playerState.invulnFrames = runtime.invulnFrames ?? 0;
                if (playerState.isDead) {
                    deathText.text = `You are down\nRespawn in ${Math.ceil(runtime.respawnTimer)}s`;
                    deathText.visible = true;
                }
                updateHealthHud();
            }
        },
        getWalls: () => buildingSystem.getWalls(),
        getCivilianTargets: () => civilianSystem?.getTargets() ?? [],
        onCivilianContactDamage: (civilianId, amount, source) => {
            const stats = multiplayerClient.getStats();
            if (stats.connected && stats.isAuthority) {
                // Dedicated server authority resolves enemy melee contact damage in multiplayer.
                return false;
            }
            return civilianSystem?.applyDamage(civilianId, amount, source);
        }
    });

    // Civilian logistics system: workers haul producer output into global warehouse stock.
    civilianSystem = createCivilianSystem({
        civilianLayer,
        buildingSystem,
        isTileWalkable,
        onDepositResource: (resourceType, amount) => {
            if (inventory[resourceType] !== undefined) {
                inventory[resourceType] += amount;
                updateHud();
            }
        },
        onLog: (message) => logDebug(message)
    });
    projectileRuntime = createProjectileRuntime({
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
        constants: {
            ENEMY_RADIUS,
            MAX_BULLETS,
            MAX_ENEMY_PROJECTILES,
            MAX_TOWER_PROJECTILES,
            PLAYER_COLLISION_RADIUS,
            PLAYER_RESPAWN_SECONDS,
            PROJECTILES,
            TILE_SIZE,
            WEAPONS
        }
    });
    projectiles = projectileRuntime.lists.projectiles;
    towerProjectiles = projectileRuntime.lists.towerProjectiles;
    enemyProjectiles = projectileRuntime.lists.enemyProjectiles;

    updateHud();
    updateHealthHud();
    updateVisibleWorld();
    if (!multiplayerQueryEnabled && restoreSavedGameState()) {
        logDebug('Saved game restored');
    }
    if (multiplayerQueryEnabled) {
        multiplayerClient.connect();
    }

    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        keys[key] = true;
        if (debugOverlayEnabled && key === 'tab') {
            debugCommandActive = true;
            if (!debugCommandBuffer.startsWith('/')) {
                debugCommandBuffer = '/';
            }
            e.preventDefault();
            return;
        }
        if (debugOverlayEnabled && !debugCommandActive && key === '/') {
            debugCommandActive = true;
            debugCommandBuffer = '/';
            e.preventDefault();
            return;
        }
        if (debugOverlayEnabled && debugCommandActive) {
            if (key === 'enter') {
                executeDebugCommand(debugCommandBuffer);
                debugCommandActive = false;
                debugCommandBuffer = '';
                e.preventDefault();
                return;
            }
            if (key === 'escape') {
                debugCommandActive = false;
                debugCommandBuffer = '';
                e.preventDefault();
                return;
            }
            if (key === 'backspace') {
                if (debugCommandBuffer.length > 0) {
                    debugCommandBuffer = debugCommandBuffer.slice(0, -1);
                }
                e.preventDefault();
                return;
            }
            if (key.length === 1) {
                debugCommandBuffer += key;
                e.preventDefault();
                return;
            }
        }
        // Global gameplay keybinds are handled in this block.
        if (key === 'escape') {
            const multiplayerStats = multiplayerClient.getStats();
            if (multiplayerStats.connected) {
                multiplayerClient.sendPlayerAction({ type: 'toggle_pause' });
                logDebug('Pause vote toggled');
            } else {
                isPaused = !isPaused;
                updatePauseMenuText();
                pauseText.visible = isPaused;
                sharedSessionState.paused = isPaused;
                logDebug(`Game ${isPaused ? 'paused' : 'resumed'}`);
            }
            placeRequested = false;
            e.preventDefault();
            return;
        }
        // Dev console keybind is F4 or Ç (\u00e7).
        if (key === 'f4' || key === '\u00e7') {
            debugOverlayEnabled = !debugOverlayEnabled;
            debugText.visible = debugOverlayEnabled;
            debugNavText.visible = debugOverlayEnabled;
            debugPanelBackground.visible = debugOverlayEnabled;
            debugInputBackground.visible = debugOverlayEnabled;
            debugInputText.visible = debugOverlayEnabled;
            debugVerdictText.visible = debugOverlayEnabled && (debugOverlayView === 'all' || debugOverlayView === 'server');
            debugCommandActive = false;
            debugCommandBuffer = '';
            worldSystem.refreshVisibleTileGridlines();
            logDebug(`Debug console ${debugOverlayEnabled ? 'enabled' : 'disabled'}`);
        }
        if ((key === 'k') && debugOverlayEnabled) {
            enemiesDisabled = !enemiesDisabled;
            if (enemiesDisabled) {
                enemySystem.resetEnemies();
            }
            logDebug(`Enemies ${enemiesDisabled ? 'disabled' : 'enabled'} (dev toggle)`);
        }
        if (key === 'f7') {
            downloadDebugSessionLogs();
            logDebug('Info/warn logs exported');
        }
        if (key === 'f8') {
            downloadCrashLogs();
            logDebug('Crash logs exported');
        }
        if ((key === 'h') && debugOverlayEnabled) {
            const multiplayerStats = multiplayerClient.getStats();
            if (multiplayerStats.connected && !multiplayerStats.isAuthority) {
                multiplayerClient.sendPlayerAction({ type: 'dev_add_resources' });
                logDebug('Dev resources request sent (+100 each)');
            } else {
                inventory.wood += 100;
                inventory.stone += 100;
                inventory.iron += 100;
                inventory.gold += 100;
                updateHud();
                logDebug('Dev resources added (+100 each)');
            }
        }
        if ((key === 'l') && debugOverlayEnabled) {
            activePerfProfileKey = activePerfProfileKey === 'quality' ? 'stress' : 'quality';
            activePerfProfile = PERFORMANCE_PROFILES[activePerfProfileKey];
            overBudgetFrameStreak = 0;
            stableFrameStreak = 0;
            logDebug(`Performance profile: ${activePerfProfileKey}`);
        }
        if ((key === 'o') && debugOverlayEnabled) {
            autoPerfGovernorEnabled = !autoPerfGovernorEnabled;
            overBudgetFrameStreak = 0;
            stableFrameStreak = 0;
            logDebug(`Auto governor ${autoPerfGovernorEnabled ? 'enabled' : 'disabled'}`);
        }
        if ((key === 'u') && debugOverlayEnabled) {
            startStressBenchmark();
        }
        if ((key === 'c') && debugOverlayEnabled) {
            setDebugOverlayView('perf');
        }
        if ((key === 'v') && debugOverlayEnabled) {
            setDebugOverlayView('cheats');
        }
        if ((key === 'm') && debugOverlayEnabled) {
            setDebugOverlayView('multiplayer');
            return;
        }
        if ((key === 'y') && debugOverlayEnabled) {
            setDebugOverlayView('server');
            return;
        }
        if ((key === 'n') && debugOverlayEnabled) {
            setDebugOverlayView('logs');
            return;
        }
        if ((key === 'g') && debugOverlayEnabled) {
            setDebugOverlayView('core');
        }
        if ((key === 'p') && debugOverlayEnabled) {
            const multiplayerStats = multiplayerClient.getStats();
            if (multiplayerStats.connected) {
                multiplayerClient.disconnect();
            } else {
                multiplayerClient.connect();
            }
        }
        if (key === 'b') {
            // Build mode toggle keybind.
            const enabled = buildingSystem.toggleBuildMode();
            updateHud();
            logDebug(`Build mode ${enabled ? 'enabled' : 'disabled'}`);
        }
        if (key === 'tab' && buildingSystem.getUiState().buildMode) {
            e.preventDefault();
            buildingSystem.cycleSelectedBuilding(1);
            updateHud();
        }
        if (key === 'e') {
            harvestRequested = true;
        }
        if (key === 'delete' || key === 'backspace' || key === 'x') {
            deleteBuildingRequested = true;
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
        if (key === 'r' && (playerState.isDead || isPaused)) {
            const multiplayerStats = multiplayerClient.getStats();
            if (multiplayerStats.connected) {
                multiplayerClient.sendPlayerAction({ type: 'restart_session' });
                logDebug('Restart vote toggled');
            } else {
                isPaused = false;
                pauseText.visible = false;
                resetRunState();
                logDebug('Player restarted');
            }
        }
        if (key === 'j' && debugOverlayEnabled) {
            const multiplayerStats = multiplayerClient.getStats();
            if (multiplayerStats.connected) {
                multiplayerClient.sendPlayerAction({ type: 'force_reset_session' });
                logDebug('Force reset requested from server');
            } else {
                executeForceReset();
            }
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

    app.canvas.addEventListener('wheel', (e) => {
        if (!buildingSystem.getUiState().buildMode) {
            return;
        }
        e.preventDefault();
        buildingSystem.cycleSelectedBuilding(e.deltaY > 0 ? 1 : -1);
        updateHud();
    }, { passive: false });

    app.canvas.addEventListener('mousedown', (e) => {
        mouseScreenX = e.clientX;
        mouseScreenY = e.clientY;
        if (e.button === 2) {
            e.preventDefault();
            return;
        }
        if (e.button === 0) {
            leftMouseDown = true;
            // LMB is used for both attack and building placement, depending on mode.
            placeRequested = true;
            inspectRequested = true;
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
            leftMouseDown = false;
        }
    });

    const FRAME_MAX_STEP_MS = 125;

    function runGameStep(frameMs, isBackgroundTick = false) {
        simFrameIndex += 1;
        const clampedFrameMs = Math.max(0, Math.min(FRAME_MAX_STEP_MS, frameMs));
        const deltaFrames = clampedFrameMs * 0.06;
        const deltaMoveScale = clampedFrameMs / 1000;
        let frameOverBudget = false;
        const movementInput = getMovementInputVector();

        multiplayerClient.update(clampedFrameMs);
        const multiplayerStats = multiplayerClient.getStats();
        const multiplayerSnapshot = multiplayerClient.getSnapshotState();
        const replicatedAuthority = multiplayerStats.connected && multiplayerStats.isAuthority;
        const replicatedFollower = multiplayerStats.connected && !multiplayerStats.isAuthority;
        if (replicatedAuthority && multiplayerStats.sessionId && multiplayerCheckpointLoadedForSession !== multiplayerStats.sessionId) {
            const restored = tryRestoreMultiplayerCheckpoint(multiplayerStats.sessionId);
            multiplayerCheckpointLoadedForSession = multiplayerStats.sessionId;
            if (restored) {
                logDebug('Multiplayer checkpoint restored');
            }
        }
        if (multiplayerStats.connected) {
            const timeSnapshot = multiplayerClient.getNonPlayerSnapshotState();
            if (Number.isFinite(Number(timeSnapshot.sessionTimeSeconds))) {
                gameTimeSeconds = Math.max(0, Number(timeSnapshot.sessionTimeSeconds));
            }
            if (timeSnapshot.sharedResources && typeof timeSnapshot.sharedResources === 'object') {
                inventory.wood = Number(timeSnapshot.sharedResources.wood) || 0;
                inventory.stone = Number(timeSnapshot.sharedResources.stone) || 0;
                inventory.iron = Number(timeSnapshot.sharedResources.iron) || 0;
                inventory.gold = Number(timeSnapshot.sharedResources.gold) || 0;
                updateHud();
            }
            if (timeSnapshot.sessionState && typeof timeSnapshot.sessionState === 'object') {
                sharedSessionState.paused = Boolean(timeSnapshot.sessionState.paused);
                sharedSessionState.restartVersion = Math.max(0, Number(timeSnapshot.sessionState.restartVersion) || 0);
                sharedSessionState.restartVotes = Math.max(0, Number(timeSnapshot.sessionState.restartVotes) || 0);
                sharedSessionState.restartEligiblePlayers = Math.max(0, Number(timeSnapshot.sessionState.restartEligiblePlayers) || 0);
                isPaused = sharedSessionState.paused;
                updatePauseMenuText();
                pauseText.visible = isPaused;
                if (!sessionStateInitialized) {
                    sessionStateInitialized = true;
                    lastAppliedRestartVersion = sharedSessionState.restartVersion;
                } else if (sharedSessionState.restartVersion > lastAppliedRestartVersion) {
                    lastAppliedRestartVersion = sharedSessionState.restartVersion;
                    isPaused = false;
                    pauseText.visible = false;
                    resetRunState();
                    logDebug('Session restarted');
                }
            }
            latestServerAiDirectives = timeSnapshot.aiDirectives && typeof timeSnapshot.aiDirectives === 'object'
                ? timeSnapshot.aiDirectives
                : null;
            civilianSystem.setServerAiDirectives?.(latestServerAiDirectives);
        }
        if (multiplayerStats.connected && multiplayerStats.playerId !== null) {
            syncRuntimePlayersFromSnapshot(multiplayerSnapshot);
            const localRuntime = ensureRuntimePlayer(multiplayerStats.playerId);
            const localCenter = playerSystem.getCenter();
            localRuntime.x = localCenter.x;
            localRuntime.y = localCenter.y;
            const localServerPlayer = multiplayerSnapshot.players.find(
                (entry) => String(entry.playerId) === String(multiplayerStats.playerId)
            );
            if (replicatedFollower && localServerPlayer) {
                const localDx = localServerPlayer.x - playerWorldX;
                const localDy = localServerPlayer.y - playerWorldY;
                const correctionDistSq = localDx * localDx + localDy * localDy;
                const hardSnapDistanceSq = PLAYER_RECONCILE_HARD_SNAP_DISTANCE * PLAYER_RECONCILE_HARD_SNAP_DISTANCE;
                const deadzoneSq = PLAYER_RECONCILE_DEADZONE * PLAYER_RECONCILE_DEADZONE;
                if (correctionDistSq > deadzoneSq) {
                    let candidateX = playerWorldX;
                    let candidateY = playerWorldY;
                    if (correctionDistSq > hardSnapDistanceSq) {
                        candidateX = localServerPlayer.x;
                        candidateY = localServerPlayer.y;
                    } else {
                        candidateX += localDx * PLAYER_RECONCILE_BLEND;
                        candidateY += localDy * PLAYER_RECONCILE_BLEND;
                        const stepDx = candidateX - playerWorldX;
                        const stepDy = candidateY - playerWorldY;
                        const stepDist = Math.hypot(stepDx, stepDy);
                        const reconcileStepLimit = Math.max(
                            PLAYER_RECONCILE_MAX_STEP,
                            Math.max(4, Number(multiplayerStats.snapshotJitterMs) || 0) * 0.35
                        );
                        if (stepDist > reconcileStepLimit && stepDist > 0.001) {
                            const scale = reconcileStepLimit / stepDist;
                            candidateX = playerWorldX + stepDx * scale;
                            candidateY = playerWorldY + stepDy * scale;
                        }
                    }
                    const combinedTileX = Math.floor((candidateX + TILE_SIZE / 2) / TILE_SIZE);
                    const combinedTileY = Math.floor((candidateY + TILE_SIZE / 2) / TILE_SIZE);
                    if (isTileWalkable(combinedTileX, combinedTileY)) {
                        playerWorldX = candidateX;
                        playerWorldY = candidateY;
                    } else {
                        const xOnlyTileX = Math.floor((candidateX + TILE_SIZE / 2) / TILE_SIZE);
                        const xOnlyTileY = Math.floor((playerWorldY + TILE_SIZE / 2) / TILE_SIZE);
                        if (isTileWalkable(xOnlyTileX, xOnlyTileY)) {
                            playerWorldX = candidateX;
                        }
                        const yOnlyTileX = Math.floor((playerWorldX + TILE_SIZE / 2) / TILE_SIZE);
                        const yOnlyTileY = Math.floor((candidateY + TILE_SIZE / 2) / TILE_SIZE);
                        if (isTileWalkable(yOnlyTileX, yOnlyTileY)) {
                            playerWorldY = candidateY;
                        }
                    }
                    playerSystem.setWorldPosition(playerWorldX, playerWorldY);
                }
            }
            if (multiplayerSnapshot.tick !== lastAppliedMultiplayerSnapshotTick) {
                lastAppliedMultiplayerSnapshotTick = multiplayerSnapshot.tick;
                remotePlayerSystem.sync(multiplayerSnapshot.players, multiplayerStats.playerId);
            }
            remotePlayerSystem.update(clampedFrameMs);
            if (replicatedAuthority) {
                const peerActions = multiplayerClient.drainPeerActions();
                for (const pending of peerActions) {
                    const outcome = runPlayerAction(
                        pending.action,
                        getMultiplayerPlayerCenterById(pending.actorPlayerId),
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
            if (replicatedFollower || replicatedAuthority) {
                const nonPlayerSnapshot = multiplayerClient.getNonPlayerSnapshotState();
                if (nonPlayerSnapshot.seq !== lastAppliedNonPlayerSnapshotSeq) {
                    lastAppliedNonPlayerSnapshotSeq = nonPlayerSnapshot.seq;
                    enemySystem.syncReplicatedState(nonPlayerSnapshot.enemies);
                    projectileRuntime?.syncReplicatedProjectiles(nonPlayerSnapshot.projectiles);
                    if (Array.isArray(nonPlayerSnapshot.playerStates) && nonPlayerSnapshot.playerStates.length > 0) {
                        for (const replicatedPlayerState of nonPlayerSnapshot.playerStates) {
                            const replicatedPlayerId = Number(replicatedPlayerState.playerId);
                            if (!Number.isFinite(replicatedPlayerId)) {
                                continue;
                            }
                            const runtime = ensureRuntimePlayer(replicatedPlayerId);
                            runtime.hp = Number(replicatedPlayerState.hp) || 0;
                            runtime.maxHp = Number(replicatedPlayerState.maxHp) || PLAYER_MAX_HP;
                            runtime.isDead = Boolean(replicatedPlayerState.isDead);
                            runtime.respawnTimer = Math.max(0, Number(replicatedPlayerState.respawnTimer) || 0);
                            runtime.kills = Number(replicatedPlayerState.kills) || 0;
                        }
                        const localState = nonPlayerSnapshot.playerStates.find(
                            (entry) => String(entry.playerId) === String(multiplayerStats.playerId)
                        );
                        if (localState) {
                            playerState.hp = Number(localState.hp) || 0;
                            playerState.maxHp = Number(localState.maxHp) || PLAYER_MAX_HP;
                            playerState.isDead = Boolean(localState.isDead);
                            combatStats.enemiesKilled = Number(localState.kills) || 0;
                            if (playerState.isDead) {
                                deathText.text = `You are down\nRespawn in ${Math.ceil(Number(localState.respawnTimer) || 0)}s`;
                                deathText.visible = true;
                            } else {
                                deathText.visible = false;
                            }
                            updateHealthHud();
                        }
                    }
                    if (
                        replicatedFollower &&
                        nonPlayerSnapshot.buildingsState &&
                        Number(nonPlayerSnapshot.buildingsRevision || 0) !== lastAppliedBuildingsRevision
                    ) {
                        lastAppliedBuildingsRevision = Number(nonPlayerSnapshot.buildingsRevision || 0);
                        buildingSystem.importReplicationState(nonPlayerSnapshot.buildingsState);
                        updateHud();
                    }
                    if (Array.isArray(nonPlayerSnapshot.civilians)) {
                        civilianSystem.syncReplicatedState(nonPlayerSnapshot.civilians, nonPlayerSnapshot.houseTimers);
                        updateHud();
                    }
                }
            }
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
                        logDebug(`${actionType} rejected by authority (${reason})`);
                    }
                }
                const now = performance.now();
                for (const [actionId, meta] of pendingActionAcks) {
                    if (now - meta.at <= 1500) {
                        continue;
                    }
                    pendingActionAcks.delete(actionId);
                    logDebug(`${meta.type} request timed out; waiting for next authoritative sync`);
                }
            }
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
                if (alivePlayers === 0 && multiplayerPlayerRuntime.size > 0) {
                    resetRunState();
                }
                playerState.hp = localRuntime.hp;
                playerState.maxHp = localRuntime.maxHp;
                playerState.isDead = localRuntime.isDead;
                playerState.invulnFrames = localRuntime.invulnFrames ?? 0;
                combatStats.enemiesKilled = Number(localRuntime.kills) || 0;
                if (playerState.isDead) {
                    deathText.text = `You are down\nRespawn in ${Math.ceil(localRuntime.respawnTimer)}s`;
                    deathText.visible = true;
                } else {
                    deathText.visible = false;
                }
                updateHealthHud();
            }
        } else {
            remotePlayerSystem.clear();
            lastAppliedMultiplayerSnapshotTick = -1;
            lastAppliedNonPlayerSnapshotSeq = -1;
            lastAppliedBuildingsRevision = -1;
            lastKnownRemotePlayerCount = 0;
            multiplayerPlayerRuntime.clear();
            pendingActionAcks.clear();
            latestServerAiDirectives = null;
            civilianSystem.setServerAiDirectives?.(null);
            sharedSessionState.restartVotes = 0;
            sharedSessionState.restartEligiblePlayers = 0;
            lastAppliedRestartVersion = 0;
            sessionStateInitialized = false;
        }
        enemySystem.beginFramePathBudget();

        playerSystem.updateFacingFromMouse(mouseScreenX, mouseScreenY, window.innerWidth, window.innerHeight);
        playerSystem.updateScreenVisuals();
        buildingSystem.updatePlacementGhost();

        if (isPaused) {
            if (replicatedAuthority) {
                outboundEntitySnapshotTimerMs -= clampedFrameMs;
                if (outboundEntitySnapshotTimerMs <= 0) {
                    outboundEntitySnapshotTimerMs = ENTITY_SNAPSHOT_INTERVAL_MS;
                    outboundEntitySnapshotSeq += 1;
                    multiplayerClient.sendEntitySnapshot(outboundEntitySnapshotSeq, {
                        enemies: enemySystem.exportReplicatedState(),
                        projectiles: projectileRuntime?.exportReplicatedProjectiles() ?? { player: [], tower: [], enemy: [] },
                        playerStates: [...multiplayerPlayerRuntime.values()].map((runtime) => ({
                            playerId: Number(runtime.id),
                            x: runtime.x - TILE_SIZE / 2,
                            y: runtime.y - TILE_SIZE / 2,
                            hp: runtime.hp,
                            maxHp: runtime.maxHp,
                            isDead: runtime.isDead,
                            respawnTimer: runtime.respawnTimer,
                            kills: runtime.kills ?? 0
                        })),
                        civilians: civilianSystem.getTargets(),
                        houseTimers: civilianSystem.getHouseTimerReplication(),
                        sessionTimeSeconds: gameTimeSeconds,
                        sessionState: {
                            paused: sharedSessionState.paused,
                            restartVersion: sharedSessionState.restartVersion,
                            restartVotes: sharedSessionState.restartVotes,
                            restartEligiblePlayers: sharedSessionState.restartEligiblePlayers
                        },
                        sharedResources: { ...inventory },
                        buildingsState: null,
                        buildingsRevision: outboundBuildingRevision
                    });
                }
            }
            if (!isBackgroundTick) {
                updateDebugOverlay(clampedFrameMs);
            }
            return;
        }

        if (!multiplayerStats.connected) {
            gameTimeSeconds += (clampedFrameMs / 1000);
            multiplayerCheckpointLoadedForSession = null;
        }

        if (!replicatedFollower) {
            const tBuildStart = performance.now();
            buildingSystem.updateProduction(deltaFrames);
            systemPerfMs.buildings = performance.now() - tBuildStart;
            if (systemPerfMs.buildings > activePerfProfile.budgetsMs.buildings) {
                systemOverBudget.buildings += 1;
                frameOverBudget = true;
            }
        } else {
            systemPerfMs.buildings = 0;
        }

        const civilianStride = Math.max(1, activePerfProfile.civilianUpdateStride ?? 1);
        if (!replicatedFollower && simFrameIndex % civilianStride === 0) {
            const tCivilianStart = performance.now();
            civilianSystem.update(deltaFrames, deltaMoveScale);
            systemPerfMs.civilians = performance.now() - tCivilianStart;
            if (systemPerfMs.civilians > activePerfProfile.budgetsMs.civilians) {
                systemOverBudget.civilians += 1;
                frameOverBudget = true;
            }
        } else {
            systemPerfMs.civilians = 0;
            systemDeferred.civilianSkippedFrames += 1;
        }
        uiRefreshTimer -= deltaFrames;
        if (uiRefreshTimer <= 0) {
            const tUiStart = performance.now();
            updateBuildMenu();
            updateClockHud();
            systemPerfMs.ui = performance.now() - tUiStart;
            if (systemPerfMs.ui > activePerfProfile.budgetsMs.ui) {
                systemOverBudget.ui += 1;
                frameOverBudget = true;
            }
            uiRefreshTimer = 12;
        } else {
            systemPerfMs.ui = 0;
        }

        playerSystem.tickCombatTimers(deltaFrames);
        playerSystem.updateMovement(keys, deltaMoveScale, (nextX, nextY) => {
            const tileX = Math.floor((nextX + TILE_SIZE / 2) / TILE_SIZE);
            const tileY = Math.floor((nextY + TILE_SIZE / 2) / TILE_SIZE);
            return isTileWalkable(tileX, tileY);
        });
        const playerWorld = playerSystem.getWorldPosition();
        playerWorldX = playerWorld.x;
        playerWorldY = playerWorld.y;
        multiplayerClient.sendInput(movementInput.x, movementInput.y, playerWorldX, playerWorldY);
        const playerCenterAfterMove = playerSystem.getCenter();
        civilianSystem.resolvePlayerCollision(
            playerCenterAfterMove.x,
            playerCenterAfterMove.y,
            PLAYER_COLLISION_RADIUS,
            (pushX, pushY) => {
                const candidateX = playerWorldX + pushX;
                const candidateY = playerWorldY + pushY;
                const tileX = Math.floor((candidateX + TILE_SIZE / 2) / TILE_SIZE);
                const tileY = Math.floor((candidateY + TILE_SIZE / 2) / TILE_SIZE);
                if (!isTileWalkable(tileX, tileY)) {
                    return;
                }
                playerWorldX = candidateX;
                playerWorldY = candidateY;
                playerSystem.setWorldPosition(candidateX, candidateY);
            }
        );

        world.position.x = window.innerWidth / 2 - playerWorldX - 16;
        world.position.y = window.innerHeight / 2 - playerWorldY - 16;

        updateVisibleWorld();
        if (!replicatedFollower && !playerState.isDead && !enemiesDisabled) {
            const activePlayerCount = multiplayerStats.connected && replicatedAuthority
                ? Math.max(1, [...multiplayerPlayerRuntime.values()].filter((runtime) => !runtime.isDead).length)
                : 1;
            const enemyScale = 1 + (activePlayerCount - 1) * 0.55;
            enemySystem.spawnTick({
                maxCount: Math.floor(ENEMY_MAX_COUNT * enemyScale),
                spawnIntervalFrames: Math.max(8, Math.floor(ENEMY_SPAWN_INTERVAL_FRAMES / enemyScale))
            });
        }
        if (!replicatedFollower && !enemiesDisabled) {
            const tEnemyStart = performance.now();
            enemySystem.update(deltaMoveScale, {
                nearTiles: activePerfProfile.enemyNearTiles,
                midTiles: activePerfProfile.enemyMidTiles,
                midStride: activePerfProfile.enemyMidStride,
                farStride: activePerfProfile.enemyFarStride,
                collisionHighDensityThreshold: activePerfProfile.enemyCollisionHighDensityThreshold,
                collisionHighDensityStride: activePerfProfile.enemyCollisionHighDensityStride
            });
            systemPerfMs.enemies = performance.now() - tEnemyStart;
            if (systemPerfMs.enemies > activePerfProfile.budgetsMs.enemies) {
                systemOverBudget.enemies += 1;
                frameOverBudget = true;
            }
        } else {
            systemPerfMs.enemies = 0;
        }
        const civilianTargetsSnapshot = civilianSystem.getTargets();
        rebuildRuntimeSpatialIndexes(civilianTargetsSnapshot);
        const towerStride = Math.max(1, activePerfProfile.towerUpdateStride ?? 1);
        if (!replicatedFollower && simFrameIndex % towerStride === 0) {
            const tTowerStart = performance.now();
            updateTowerCombat(latestServerAiDirectives);
            systemPerfMs.towerCombat = performance.now() - tTowerStart;
            if (systemPerfMs.towerCombat > activePerfProfile.budgetsMs.towerCombat) {
                systemOverBudget.towerCombat += 1;
                frameOverBudget = true;
            }
        } else {
            systemPerfMs.towerCombat = 0;
            systemDeferred.towerSkippedFrames += 1;
        }
        const enemyRangedStride = Math.max(1, activePerfProfile.enemyRangedUpdateStride ?? 1);
        if (!replicatedFollower && simFrameIndex % enemyRangedStride === 0) {
            const tEnemyRangedStart = performance.now();
            updateEnemyRangedCombat(deltaFrames, latestServerAiDirectives);
            systemPerfMs.enemyRanged = performance.now() - tEnemyRangedStart;
            if (systemPerfMs.enemyRanged > activePerfProfile.budgetsMs.enemyRanged) {
                systemOverBudget.enemyRanged += 1;
                frameOverBudget = true;
            }
        } else {
            systemPerfMs.enemyRanged = 0;
            systemDeferred.enemyRangedSkippedFrames += 1;
        }
        if (!replicatedFollower) {
            const tProjStart = performance.now();
            updateProjectiles(deltaMoveScale, civilianTargetsSnapshot);
            systemPerfMs.projectiles = performance.now() - tProjStart;
            if (systemPerfMs.projectiles > activePerfProfile.budgetsMs.projectiles) {
                systemOverBudget.projectiles += 1;
                frameOverBudget = true;
            }
        } else {
            const tProjStart = performance.now();
            enemySystem.updateReplicatedInterpolation(deltaMoveScale);
            projectileRuntime?.updateReplicatedProjectiles(deltaMoveScale);
            systemPerfMs.projectiles = performance.now() - tProjStart;
        }

        // Re-apply camera in case enemy collision resolution pushed the player.
        world.position.x = window.innerWidth / 2 - playerWorldX - 16;
        world.position.y = window.innerHeight / 2 - playerWorldY - 16;

        const buildUi = buildingSystem.getUiState();
        if (inspectRequested) {
            buildingSystem.selectBuildingAtMouse();
            updateHud();
            inspectRequested = false;
        }
        if (deleteBuildingRequested) {
            if (replicatedFollower) {
                const targetTile = screenToWorldTile(mouseScreenX, mouseScreenY);
                const clientActionId = nextClientActionId++;
                multiplayerClient.sendPlayerAction({
                    type: 'remove',
                    clientActionId,
                    tileX: targetTile.tileX,
                    tileY: targetTile.tileY
                });
                pendingActionAcks.set(clientActionId, { type: 'remove', at: performance.now() });
                spawnFloatingFeedback('remove...', targetTile.tileX * TILE_SIZE + TILE_SIZE / 2, targetTile.tileY * TILE_SIZE + 8, '#ff9c9c', 24);
            } else {
                const removed = buildingSystem.removeSelectedPlacedBuilding();
                if (removed) {
                    updateHud();
                }
            }
            deleteBuildingRequested = false;
        }
        if (!playerState.isDead && buildUi.buildMode && placeRequested) {
            if (replicatedFollower) {
                const targetTile = screenToWorldTile(mouseScreenX, mouseScreenY);
                if (buildUi.selectedBuildingType) {
                    const clientActionId = nextClientActionId++;
                    multiplayerClient.sendPlayerAction({
                        type: 'build',
                        clientActionId,
                        buildingType: buildUi.selectedBuildingType,
                        tileX: targetTile.tileX,
                        tileY: targetTile.tileY
                    });
                    pendingActionAcks.set(clientActionId, { type: 'build', at: performance.now() });
                    spawnFloatingFeedback('build...', targetTile.tileX * TILE_SIZE + TILE_SIZE / 2, targetTile.tileY * TILE_SIZE + 8, '#9ce9a0', 24);
                }
            } else {
                const placed = buildingSystem.tryPlaceSelectedAtMouse();
                if (placed) {
                    updateHud();
                }
            }
            placeRequested = false;
        }

        if (!replicatedFollower && !playerState.isDead && !buildUi.buildMode && (keys.attack || leftMouseDown) && playerCombat.cooldownFrames <= 0) {
            const center = playerSystem.getCenter();
            performAttack(center.x, center.y);
        } else if (replicatedFollower && !playerState.isDead && !buildUi.buildMode && (keys.attack || leftMouseDown) && playerCombat.cooldownFrames <= 0) {
            const center = playerSystem.getCenter();
            multiplayerClient.sendPlayerAction({
                type: 'attack',
                weapon: playerCombat.weapon,
                originX: center.x,
                originY: center.y,
                dirX: playerCombat.facingX,
                dirY: playerCombat.facingY
            });
            performPredictedAttackVisual(center.x, center.y);
            playerCombat.cooldownFrames = playerCombat.weapon === 'sword'
                ? WEAPONS.sword.cooldownFrames
                : WEAPONS.pistol.cooldownFrames;
        }
        if (!buildUi.buildMode) {
            placeRequested = false;
        }

        if (!replicatedFollower && !playerState.isDead && harvestRequested) {
            harvestRequested = false;

            const playerCenterX = playerWorldX + TILE_SIZE / 2;
            const playerCenterY = playerWorldY + TILE_SIZE / 2;
            if (multiplayerStats.connected && replicatedAuthority) {
                const revived = tryReviveNearestPlayer(multiplayerStats.playerId, { x: playerCenterX, y: playerCenterY });
                if (revived) {
                    updateHud();
                    spawnFloatingFeedback('Revive!', playerCenterX, playerCenterY - 10, '#9ce9a0', 32);
                    return;
                }
            }
            const harvest = worldSystem.tryHarvestNearest(playerCenterX, playerCenterY);
            if (harvest && inventory[harvest.resourceType] !== undefined) {
                inventory[harvest.resourceType] += 1;
                spawnHarvestFeedback(harvest.resourceType, harvest.tileX, harvest.tileY);
                updateHud();
            } else {
                const collected = buildingSystem.collectNearestOutput(playerCenterX, playerCenterY, TILE_SIZE * 3);
                if (collected && inventory[collected.resourceType] !== undefined) {
                    inventory[collected.resourceType] += collected.amount;
                    updateHud();
                }
            }
        }
        if (replicatedFollower && !playerState.isDead && harvestRequested) {
            const center = playerSystem.getCenter();
            const clientActionId = nextClientActionId++;
            multiplayerClient.sendPlayerAction({
                type: 'revive',
                originX: center.x,
                originY: center.y
            });
            multiplayerClient.sendPlayerAction({
                type: 'harvest',
                clientActionId,
                originX: center.x,
                originY: center.y
            });
            pendingActionAcks.set(clientActionId, { type: 'harvest', at: performance.now() });
        }
        if (replicatedFollower) {
            harvestRequested = false;
            placeRequested = false;
            inspectRequested = false;
            deleteBuildingRequested = false;
        }

        // Lightweight floating text update for harvest feedback.
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            const entry = floatingTexts[i];
            entry.ttl -= deltaFrames;
            entry.sprite.y -= 0.4 * (deltaFrames / 1);
            entry.sprite.alpha = Math.max(0, entry.ttl / 75);

            if (entry.ttl <= 0) {
                releaseFloatingTextEntry(entry);
                floatingTexts.splice(i, 1);
            }
        }

        playerSystem.updateHitVisual();

        if (replicatedAuthority) {
            outboundEntitySnapshotTimerMs -= clampedFrameMs;
            outboundBuildingSyncTimerMs -= clampedFrameMs;
            const hasFollowers = (multiplayerStats.remotePlayerCount ?? 0) > 0;
            const remoteCount = multiplayerStats.remotePlayerCount ?? 0;
            const forceFullBuildingSync = remoteCount !== lastKnownRemotePlayerCount;
            lastKnownRemotePlayerCount = remoteCount;
            let buildingsState = null;
            if (hasFollowers && outboundBuildingSyncTimerMs <= 0) {
                outboundBuildingSyncTimerMs = BUILDING_SYNC_INTERVAL_MS;
                const candidateState = buildingSystem.exportReplicationState();
                const candidateHash = computeBuildingStateHash(candidateState);
                if (forceFullBuildingSync || candidateHash !== lastOutboundBuildingStateHash) {
                    lastOutboundBuildingStateHash = candidateHash;
                    outboundBuildingRevision += 1;
                    buildingsState = candidateState;
                }
            }
            if (outboundEntitySnapshotTimerMs <= 0) {
                outboundEntitySnapshotTimerMs = ENTITY_SNAPSHOT_INTERVAL_MS;
                outboundEntitySnapshotSeq += 1;
                multiplayerClient.sendEntitySnapshot(outboundEntitySnapshotSeq, {
                    enemies: enemySystem.exportReplicatedState(),
                    projectiles: projectileRuntime?.exportReplicatedProjectiles() ?? { player: [], tower: [], enemy: [] },
                    playerStates: [...multiplayerPlayerRuntime.values()].map((runtime) => ({
                        playerId: Number(runtime.id),
                        x: runtime.x - TILE_SIZE / 2,
                        y: runtime.y - TILE_SIZE / 2,
                        hp: runtime.hp,
                        maxHp: runtime.maxHp,
                        isDead: runtime.isDead,
                        respawnTimer: runtime.respawnTimer,
                        kills: runtime.kills ?? 0
                    })),
                    civilians: civilianSystem.getTargets(),
                    houseTimers: civilianSystem.getHouseTimerReplication(),
                    sessionTimeSeconds: gameTimeSeconds,
                    sessionState: {
                        paused: sharedSessionState.paused,
                        restartVersion: sharedSessionState.restartVersion,
                        restartVotes: sharedSessionState.restartVotes,
                        restartEligiblePlayers: sharedSessionState.restartEligiblePlayers
                    },
                    sharedResources: { ...inventory },
                    buildingsState,
                    buildingsRevision: outboundBuildingRevision
                });
            }
        }

        updatePerformanceGovernor(frameOverBudget);
        if (benchmarkState.active && !isBackgroundTick) {
            benchmarkState.elapsedMs += clampedFrameMs;
            benchmarkState.frameCount += 1;
            benchmarkState.frameMsAccum += clampedFrameMs;
            if (benchmarkState.elapsedMs >= 10000) {
                const avgFrameMs = benchmarkState.frameCount > 0 ? benchmarkState.frameMsAccum / benchmarkState.frameCount : 0;
                const avgFps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;
                logDebug(
                    `Benchmark complete: avg ${avgFps.toFixed(1)} FPS, over-budget E:${systemOverBudget.enemies} P:${systemOverBudget.projectiles}`
                );
                benchmarkState.active = false;
            }
        }

        saveTimerFrames -= deltaFrames;
        if (saveTimerFrames <= 0) {
            if (replicatedAuthority && multiplayerStats.sessionId) {
                persistMultiplayerCheckpoint(multiplayerStats.sessionId);
            } else if (!multiplayerStats.connected) {
                persistSaveState();
            }
            saveTimerFrames = 120;
        }

        if (!isBackgroundTick) {
            updateDebugOverlay(clampedFrameMs);
        }
    }

    const simulationLoop = createSimulationLoopController({
        app,
        multiplayerClient,
        runGameStep,
        logDebug,
        onFpsSample: (fps) => {
            smoothedFps = smoothedFps * 0.9 + fps * 0.1;
        }
    });
    simulationLoop.bind();

    window.addEventListener('beforeunload', () => {
        persistSaveState();
        multiplayerClient.disconnect();
    });

    window.addEventListener('resize', () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        playerSystem.handleResize(window.innerWidth, window.innerHeight);
        debugText.position.set(window.innerWidth - DEBUG_PANEL_WIDTH + 12 - SIDE_PANEL_MARGIN, SIDE_PANEL_TOP + 44);
        debugNavText.position.set(window.innerWidth - DEBUG_PANEL_WIDTH + 12 - SIDE_PANEL_MARGIN, SIDE_PANEL_TOP + 10);
        deathText.position.set(window.innerWidth / 2, window.innerHeight / 2);
        pauseText.position.set(window.innerWidth / 2, window.innerHeight / 2);
        updateVisibleWorld();
        updateHud();
    });

    console.log('Purrmadeath initialized');
}
