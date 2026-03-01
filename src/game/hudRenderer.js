// HUD rendering helpers keep bootstrap focused on simulation/orchestration.
export function updatePauseMenuTextForSession(pauseText, multiplayerConnected, restartVotes, restartEligiblePlayers) {
    if (!multiplayerConnected) {
        pauseText.text = 'Paused\nPress ESC to resume\nPress R to restart run\nPress T to Save & Exit | Q to Exit';
        return;
    }
    const votes = Math.max(0, Number(restartVotes) || 0);
    const eligible = Math.max(0, Number(restartEligiblePlayers) || 0);
    pauseText.text = `Paused\nPress ESC to vote pause/resume\nPress R to vote restart run\nRestart vote: ${votes}/${eligible}\nPress T to Leave Session | Q to Exit`;
}

export function formatBuildCost(cost) {
    return `W:${cost.wood ?? 0} S:${cost.stone ?? 0} I:${cost.iron ?? 0} G:${cost.gold ?? 0}`;
}

export function updateClockAndSessionCard(clockContext) {
    const {
        clockText,
        gameTimeText,
        windowWidth,
        sessionCardBackground,
        sessionCardText,
        multiplayerConnected,
        multiplayerIsAuthority,
        remotePlayerCount
    } = clockContext;

    clockText.text = gameTimeText;
    clockText.position.set(windowWidth - 150, 10);
    const showHostCard = multiplayerConnected && multiplayerIsAuthority;
    if (!showHostCard) {
        sessionCardBackground.visible = false;
        sessionCardText.visible = false;
        return;
    }

    const sessionPlayers = Math.max(1, Number(remotePlayerCount || 0) + 1);
    const maxPlayers = 4;
    const full = sessionPlayers >= maxPlayers;
    sessionCardText.text = `Host Session\nPlayers: ${sessionPlayers}/${maxPlayers}\nStatus: ${full ? 'FULL' : 'OPEN'}`;
    const cardPadding = 8;
    const cardWidth = Math.ceil(sessionCardText.width + cardPadding * 2);
    const cardHeight = Math.ceil(sessionCardText.height + cardPadding * 2);
    const cardX = Math.max(12, windowWidth - cardWidth - 165);
    const cardY = 4;
    sessionCardBackground.clear();
    sessionCardBackground.rect(cardX, cardY, cardWidth, cardHeight);
    sessionCardBackground.fill(0x101f17);
    sessionCardBackground.alpha = 0.86;
    sessionCardBackground.stroke({ width: 1, color: full ? 0xc46b6b : 0x2f7c42 });
    sessionCardBackground.visible = true;
    sessionCardText.position.set(cardX + cardPadding, cardY + cardPadding);
    sessionCardText.visible = true;
}

export function updateBuildMenuPanel(params) {
    const {
        buildingSystem,
        buildMenuText,
        buildMenuBackground,
        sidePanelTop,
        sidePanelMargin,
        windowWidth,
        windowHeight
    } = params;
    if (!buildingSystem) {
        buildMenuText.visible = false;
        return;
    }
    const buildUi = buildingSystem.getUiState();
    if (!buildUi.buildMode && !buildUi.selectedPlacedBuilding) {
        buildMenuBackground.visible = false;
        buildMenuText.visible = false;
        return;
    }

    const lines = [];
    if (buildUi.buildMode) {
        lines.push('Build Menu', 'Tab/Wheel: Select | LClick: Place | Del/X: Remove');
        for (const entry of buildingSystem.getMenuEntries()) {
            lines.push(`${entry.selected ? '> ' : '  '}${entry.label} [${formatBuildCost(entry.cost)}]`);
        }
    }

    if (buildUi.selectedPlacedBuilding) {
        if (lines.length > 0) {
            lines.push('');
        }
        lines.push(`Selected: ${buildUi.selectedPlacedBuilding.label}`);
        if ((buildUi.selectedPlacedBuilding.maxHp ?? 0) > 0) {
            lines.push(`HP: ${Math.max(0, Math.ceil(buildUi.selectedPlacedBuilding.hp ?? 0))}/${buildUi.selectedPlacedBuilding.maxHp}`);
        }
        if (buildUi.selectedPlacedBuilding.role === 'producer') {
            lines.push(`Stored: ${buildUi.selectedPlacedBuilding.storedOutput}/${buildUi.selectedPlacedBuilding.storageCap} ${buildUi.selectedPlacedBuilding.outputResource}`);
        }
    }

    const estimatedLineHeight = 18;
    const maxVisibleLines = Math.max(
        4,
        Math.floor((windowHeight - sidePanelTop - sidePanelMargin - 24) / estimatedLineHeight)
    );
    const visibleLines = lines.length > maxVisibleLines
        ? [...lines.slice(0, maxVisibleLines - 1), `... (${lines.length - maxVisibleLines + 1} more)`]
        : lines;
    buildMenuText.text = visibleLines.join('\n');
    const panelPadding = 12;
    const panelX = sidePanelMargin;
    const panelY = sidePanelTop;
    const maxPanelWidth = Math.max(280, Math.floor(windowWidth * 0.4));
    const panelWidth = Math.min(maxPanelWidth, Math.max(280, Math.ceil(buildMenuText.width + panelPadding * 2)));
    const requestedHeight = Math.max(46, Math.ceil(buildMenuText.height + panelPadding * 2));
    const maxPanelHeight = Math.max(80, windowHeight - panelY - sidePanelMargin);
    const panelHeight = Math.min(requestedHeight, maxPanelHeight);
    buildMenuText.position.set(panelX + panelPadding, panelY + panelPadding);
    buildMenuBackground.clear();
    buildMenuBackground.rect(panelX, panelY, panelWidth, panelHeight);
    buildMenuBackground.fill(0x141414);
    buildMenuBackground.alpha = 0.84;
    buildMenuBackground.stroke({ width: 1, color: 0x333333 });
    buildMenuBackground.visible = true;
    buildMenuText.visible = true;
}

export function updateHealthHudBar(params) {
    const {
        playerState,
        playerWeapon,
        healthBarBackground,
        healthBarFill,
        healthText,
        weaponText,
        windowWidth,
        windowHeight
    } = params;
    const barWidth = 260;
    const barHeight = 18;
    const barX = Math.floor((windowWidth - barWidth) / 2);
    const barY = windowHeight - 34;
    const ratio = Math.max(0, Math.min(1, playerState.hp / playerState.maxHp));

    healthBarBackground.clear();
    healthBarBackground.rect(barX, barY, barWidth, barHeight);
    healthBarBackground.fill(0x2a2a2a);
    healthBarBackground.stroke({ width: 1, color: 0x000000 });

    healthBarFill.clear();
    healthBarFill.rect(barX, barY, barWidth * ratio, barHeight);
    healthBarFill.fill(0xd94b4b);

    healthText.text = `HP: ${Math.max(0, Math.ceil(playerState.hp))}/${playerState.maxHp}`;
    healthText.position.set(barX + 8, barY + 1);
    weaponText.text = `Weapon: ${playerWeapon}`;
    let weaponX = barX + barWidth + 14;
    const maxWeaponX = windowWidth - weaponText.width - 16;
    if (weaponX > maxWeaponX) {
        weaponX = Math.max(16, maxWeaponX);
    }
    weaponText.position.set(weaponX, barY + 1);
}
