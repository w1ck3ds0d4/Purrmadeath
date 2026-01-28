import { getLatencyVerdict } from '../net/latencyHeuristics.js';
import { buildCheatsSectionLines, buildMultiplayerSectionLines, buildServerSectionLines } from './debugOverlaySections.js';

function pushSection(lines, name, sectionLines) {
    if (!Array.isArray(sectionLines) || sectionLines.length === 0) {
        return;
    }
    lines.push(`-- ${name} --`);
    for (const line of sectionLines) {
        lines.push(line);
    }
    lines.push('');
}

export function buildDebugOverlayLines(context) {
    const {
        debugOverlayView,
        smoothedFps,
        frameMs,
        playerState,
        playerCombat,
        playerWorldX,
        playerWorldY,
        tileSize,
        enemies,
        enemyMaxCount,
        enemiesDisabled,
        projectiles,
        towerProjectiles,
        enemyProjectiles,
        crashLogsLength,
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
        devLanHostHint,
        locationProtocol,
        locationPort,
        buildModeEnabled
    } = context;

    const lines = [
        'DEV CONSOLE (F4 or \\u00e7)',
        `View: ${debugOverlayView.toUpperCase()}`,
        `FPS: ${smoothedFps.toFixed(1)} | Frame: ${frameMs.toFixed(2)} ms`,
        ''
    ];

    const showAll = debugOverlayView === 'all';
    const showAllCompact = showAll;

    if (showAll || debugOverlayView === 'core') {
        pushSection(lines, 'Core', [
            `Player HP: ${Math.ceil(playerState.hp)}/${playerState.maxHp} | Weapon: ${playerCombat.weapon}`,
            `Coords: ${Math.floor(playerWorldX)}, ${Math.floor(playerWorldY)} | Tile: ${Math.floor((playerWorldX + tileSize / 2) / tileSize)}, ${Math.floor((playerWorldY + tileSize / 2) / tileSize)}`,
            `Enemies: ${enemies.length}/${enemyMaxCount} | Ranged: ${enemies.filter((enemy) => enemy.isRanged).length}`,
            `Enemies disabled: ${enemiesDisabled ? 'YES' : 'NO'} (K while console open)`,
            `Bullets P/T/E: ${projectiles.length}/${towerProjectiles.length}/${enemyProjectiles.length}`,
            `Buildings: ${buildingStats.buildingCount} | Producers: ${buildingStats.producerCount ?? 0}`,
            `Civilians: ${civilianStats.civilianCount}/${civilianStats.civilianCap} | Lost: ${civilianStats.civiliansKilled}`,
            `Crash logs stored: ${crashLogsLength}`,
            `Tiles cached: ${worldStats.tilesCached} | Resources active: ${worldStats.resourcesActive}`
        ]);
    }

    if (showAll || debugOverlayView === 'multiplayer') {
        const multiplayerLines = showAllCompact
            ? [
                `State: ${multiplayerStats.connected ? 'CONNECTED' : 'DISCONNECTED'} | Player: ${multiplayerStats.playerId ?? '-'} | Remote: ${multiplayerStats.remotePlayerCount ?? 0}`,
                `Ping: ${Math.round(multiplayerStats.pingMs)} ms | Tick: ${multiplayerStats.tickRate} | Jitter: ${Math.round(multiplayerStats.snapshotJitterMs ?? 0)} ms`,
                `Net in/out: ${Number(multiplayerStats.inboundKbps ?? 0).toFixed(2)} / ${Number(multiplayerStats.outboundKbps ?? 0).toFixed(2)} kB/s`,
                `Backpressure drops: ${multiplayerStats.droppedBackpressureInputs ?? 0}`
            ]
            : buildMultiplayerSectionLines(multiplayerStats, devLanHostHint, locationProtocol, locationPort);
        pushSection(lines, 'Multiplayer', multiplayerLines);
    }

    if (showAll || debugOverlayView === 'server') {
        const serverLines = showAllCompact
            ? [
                `Tick: ${serverPerfStats?.tickRate ?? 0} Hz | Sim: ${Number(serverPerfStats?.simMsAvg ?? 0).toFixed(2)} ms | Lag: ${Number(serverPerfStats?.loopLagMsAvg ?? 0).toFixed(2)} ms`,
                `Clients: ${serverPerfStats?.connectedClients ?? 0} | Actions fwd/rej: ${serverPerfStats?.forwardedPlayerActions ?? 0}/${serverPerfStats?.rejectedPlayerActions ?? 0}`,
                `Pause votes: ${serverPerfStats?.pauseVotes ?? 0}/${serverPerfStats?.pauseEligiblePlayers ?? 0} | Restart: ${serverPerfStats?.restartVotes ?? 0}/${serverPerfStats?.restartEligiblePlayers ?? 0}`,
                `AI ms/t/r/c: ${Number(serverPerfStats?.aiDirectiveMsAvg ?? 0).toFixed(3)}/${serverPerfStats?.aiTowerAssignments ?? 0}/${serverPerfStats?.aiRangedAssignments ?? 0}/${serverPerfStats?.aiCivilianAssignments ?? 0}`
            ]
            : buildServerSectionLines(serverPerfStats);
        pushSection(lines, 'Server', serverLines);
    }

    if (!showAllCompact && debugOverlayView === 'perf') {
        pushSection(lines, 'Performance', [
            `Perf profile: ${activePerfProfileKey} | Auto governor: ${autoPerfGovernorEnabled ? 'ON' : 'OFF'}`,
            `Governor streak O/S: ${overBudgetFrameStreak}/${stableFrameStreak}`,
            `Benchmark: ${benchmarkState.active ? 'RUNNING' : 'idle'} | Frames: ${benchmarkState.frameCount}`,
            `Path req/exe/def: ${pathStats.requests}/${pathStats.executed}/${pathStats.deferred} | Budget: ${pathStats.budget}`,
            `Path stride-skip: ${pathStats.skippedByStride ?? 0}`,
            `System ms B/C/E/T/R/P/UI: ${systemPerfMs.buildings.toFixed(2)}/${systemPerfMs.civilians.toFixed(2)}/${systemPerfMs.enemies.toFixed(2)}/${systemPerfMs.towerCombat.toFixed(2)}/${systemPerfMs.enemyRanged.toFixed(2)}/${systemPerfMs.projectiles.toFixed(2)}/${systemPerfMs.ui.toFixed(2)}`,
            `Budgets ms B/C/E/T/R/P/UI: ${activePerfProfile.budgetsMs.buildings.toFixed(1)}/${activePerfProfile.budgetsMs.civilians.toFixed(1)}/${activePerfProfile.budgetsMs.enemies.toFixed(1)}/${activePerfProfile.budgetsMs.towerCombat.toFixed(1)}/${activePerfProfile.budgetsMs.enemyRanged.toFixed(1)}/${activePerfProfile.budgetsMs.projectiles.toFixed(1)}/${activePerfProfile.budgetsMs.ui.toFixed(1)}`,
            `Deferred C/T/R: ${systemDeferred.civilianSkippedFrames}/${systemDeferred.towerSkippedFrames}/${systemDeferred.enemyRangedSkippedFrames}`,
            `Over budget B/C/E/T/R/P/UI: ${systemOverBudget.buildings}/${systemOverBudget.civilians}/${systemOverBudget.enemies}/${systemOverBudget.towerCombat}/${systemOverBudget.enemyRanged}/${systemOverBudget.projectiles}/${systemOverBudget.ui}`,
            `Civ update: ${civPerf.updateMs.toFixed(2)} ms | Assign ${civPerf.assignmentCalls} (${civPerf.assignmentSkippedByBudget} delayed)`,
            `Civ queries P/W: ${civPerf.producerQueries}/${civPerf.warehouseQueries} | Civ sep: ${civPerf.civiliansResolvedCollisions} in ${civPerf.collisionPasses} pass`
        ]);
    }

    if (!showAllCompact && debugOverlayView === 'cheats') {
        pushSection(lines, 'Cheats/Dev Actions', buildCheatsSectionLines(
            enemiesDisabled,
            activePerfProfileKey,
            autoPerfGovernorEnabled,
            buildModeEnabled
        ));
    }

    while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }

    const logLines = ['', '-- Logs --'];
    if (!context.debugLogs || context.debugLogs.length === 0) {
        logLines.push('(empty)');
    } else {
        for (const entry of context.debugLogs) {
            const label = entry.level === 'warn' ? 'WARN' : 'INFO';
            const rendered = `[${entry.ts}] [${label}] ${entry.message}`;
            logLines.push(rendered.length > 128 ? `${rendered.slice(0, 125)}...` : rendered);
        }
    }

    return { lines, logLines, showAll, showAllCompact };
}

export function renderDebugOverlayPanel(renderContext) {
    const {
        panelElements,
        viewport,
        debugOverlayView,
        lines,
        logLines,
        showAll,
        serverPerfStats,
        multiplayerStats,
        debugCommandActive,
        debugCommandBuffer
    } = renderContext;
    const {
        debugText,
        debugNavText,
        debugInputBackground,
        debugInputText,
        debugVerdictText,
        debugPanelBackground
    } = panelElements;
    const {
        windowWidth,
        windowHeight,
        sidePanelMargin,
        sidePanelTop,
        debugPanelMargin
    } = viewport;

    const maxPanelWidth = Math.max(320, Math.floor(windowWidth * 0.45));
    debugText.style.wordWrap = false;
    debugText.text = lines.join('\n');
    const measuredWidth = Math.ceil(debugText.width + 28);
    const panelWidth = Math.max(300, Math.min(maxPanelWidth, measuredWidth));
    const panelX = windowWidth - panelWidth - sidePanelMargin;
    debugText.style.wordWrap = true;
    debugText.style.wordWrapWidth = panelWidth - 24;
    debugText.text = lines.join('\n');
    debugNavText.style.wordWrapWidth = panelWidth - 24;
    const maxPanelHeight = windowHeight - sidePanelTop - debugPanelMargin;
    let panelHeight = Math.ceil(debugText.height + 78);
    panelHeight = Math.max(170, Math.min(maxPanelHeight, panelHeight));
    const headerHeight = 62;
    const inputHeight = 26;
    const navTop = sidePanelTop + 8;
    const inputTop = sidePanelTop + 28;
    const dividerY = sidePanelTop + headerHeight - 6;
    const verdictState = getLatencyVerdict(serverPerfStats, multiplayerStats);
    const shouldShowVerdict = showAll || debugOverlayView === 'server';
    const verdictHeight = shouldShowVerdict ? 18 : 0;
    const contentTop = sidePanelTop + headerHeight + verdictHeight;
    const contentHeight = Math.max(80, panelHeight - headerHeight - verdictHeight - 12);
    const maxLines = Math.max(6, Math.floor(contentHeight / 16));
    const minBodyLines = debugOverlayView === 'logs' ? 5 : 8;
    const maxLogLinesForView = (showAll || debugOverlayView === 'logs')
        ? Math.max(3, Math.floor(maxLines * 0.5))
        : 4;
    const reservedForLogs = Math.min(
        logLines.length,
        Math.max(2, Math.min(maxLogLinesForView, maxLines - minBodyLines))
    );
    const bodyBudget = Math.max(0, maxLines - reservedForLogs);
    let bodyLines = lines;
    if (bodyLines.length > bodyBudget) {
        const headKeep = Math.min(3, bodyBudget);
        const tailKeep = Math.max(0, bodyBudget - headKeep - 1);
        bodyLines = bodyLines
            .slice(0, headKeep)
            .concat('... (truncated)')
            .concat(tailKeep > 0 ? bodyLines.slice(-tailKeep) : []);
    }
    const clampedLines = [...bodyLines, ...logLines.slice(-reservedForLogs)];

    debugText.position.set(panelX + 12, contentTop);
    debugNavText.position.set(panelX + 12, navTop);
    debugNavText.text = `View: ${debugOverlayView.toUpperCase()} | Tab or / to type`;

    debugPanelBackground.clear();
    debugPanelBackground.rect(panelX, sidePanelTop, panelWidth, panelHeight);
    debugPanelBackground.fill(0x101010);
    debugPanelBackground.alpha = 0.84;
    debugPanelBackground.stroke({ width: 1, color: 0x2f2f2f });
    debugPanelBackground.visible = true;

    debugPanelBackground.rect(panelX + 10, dividerY, panelWidth - 20, 1);
    debugPanelBackground.fill(0x2b2b2b);
    debugInputBackground.clear();
    debugInputBackground.rect(panelX + 10, inputTop, panelWidth - 20, inputHeight);
    debugInputBackground.fill(0x06140a);
    debugInputBackground.alpha = 1;
    debugInputBackground.stroke({ width: 1, color: 0x3fa35e });
    debugInputBackground.visible = true;
    debugInputText.text = debugCommandActive ? `> ${debugCommandBuffer}_` : '> type /help';
    debugInputText.position.set(panelX + 16, inputTop + 4);
    debugInputText.visible = true;
    if (shouldShowVerdict) {
        debugVerdictText.text = verdictState.text;
        debugVerdictText.style.fill = verdictState.color;
        debugVerdictText.position.set(panelX + 12, sidePanelTop + headerHeight + 1);
        debugVerdictText.visible = true;
    } else {
        debugVerdictText.visible = false;
    }
    debugNavText.visible = false;
    debugText.text = clampedLines.join('\n');
    debugText.visible = true;
}
