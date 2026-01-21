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
    MAX_BULLETS,
    PLAYER_COLLISION_RADIUS,
    PLAYER_INVULN_FRAMES,
    PLAYER_MAX_HP,
    TILE_SIZE,
    WEAPONS
} from './config/constants.js';
import { createBuildingSystem } from './systems/buildingSystem.js';
import { createCivilianSystem } from './systems/civilianSystem.js';
import { createEnemySystem } from './systems/enemySystem.js';
import { createPlayerSystem } from './systems/playerSystem.js';
import { createWorldSystem } from './systems/worldSystem.js';

async function init() {
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
    const enemyLayer = new PIXI.Container();
    const projectileLayer = new PIXI.Container();
    world.addChild(tileLayer);
    world.addChild(resourceLayer);
    world.addChild(buildingLayer);
    world.addChild(civilianLayer);
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
    const projectiles = [];
    let enemySpawnTimer = 0;
    let enemyIdCounter = 0;
    let uiRefreshTimer = 0;
    let gameTimeSeconds = 0;
    const debugLogs = [];
    // Browser-side crash records are persisted in localStorage for post-mortem checks.
    const crashLogs = [];
    let debugOverlayEnabled = false;
    let smoothedFps = 60;
    let isPaused = false;
    let enemiesDisabled = false;
    let buildingSystem = null;
    let civilianSystem = null;
    let enemySystem = null;
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
        text: 'Paused\nPress ESC to resume',
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

    const debugText = new PIXI.Text({
        text: '',
        style: {
            fill: '#8df7ff',
            fontFamily: 'monospace',
            fontSize: 13
        }
    });
    debugText.visible = false;
    // Keep debug panel below the top HUD bar to avoid overlap.
    debugText.position.set(window.innerWidth - 360, 52);
    app.stage.addChild(debugText);

    function updateHud() {
        const buildUi = buildingSystem?.getUiState();
        const buildMode = buildUi?.buildMode ? 'ON' : 'OFF';
        const buildType = buildUi?.selectedLabel ?? 'None';
        const civStats = civilianSystem?.getStats() ?? { civilianCount: 0, civilianCap: 0 };
        hudText.text = `Wood: ${inventory.wood}   Stone: ${inventory.stone}   Iron: ${inventory.iron}   Gold: ${inventory.gold}   Kills: ${combatStats.enemiesKilled}   Civilians: ${civStats.civilianCount}/${civStats.civilianCap}   Build: ${buildMode} (${buildType})`;
        topBarBackground.clear();
        topBarBackground.rect(0, 0, window.innerWidth, 40);
        topBarBackground.fill(0x111111);
        topBarBackground.alpha = 0.85;
        updateClockHud();
        updateBuildMenu();
        updateHealthHud();
    }

    function formatGameClock(totalSeconds) {
        const seconds = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function updateClockHud() {
        clockText.text = `Time ${formatGameClock(gameTimeSeconds)}`;
        clockText.position.set(window.innerWidth - 150, 10);
    }

    function formatCost(cost) {
        return `W:${cost.wood ?? 0} S:${cost.stone ?? 0} I:${cost.iron ?? 0} G:${cost.gold ?? 0}`;
    }

    function updateBuildMenu() {
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
                lines.push(`${entry.selected ? '> ' : '  '}${entry.label} [${formatCost(entry.cost)}]`);
            }
        }

        if (buildUi.selectedPlacedBuilding) {
            if (lines.length > 0) {
                lines.push('');
            }
            lines.push(`Selected: ${buildUi.selectedPlacedBuilding.label}`);
            if (buildUi.selectedPlacedBuilding.role === 'producer') {
                lines.push(`Stored: ${buildUi.selectedPlacedBuilding.storedOutput}/${buildUi.selectedPlacedBuilding.storageCap} ${buildUi.selectedPlacedBuilding.outputResource}`);
            }
        }
        buildMenuText.text = lines.join('\n');
        const panelPadding = 12;
        const panelX = 12;
        const panelY = 52;
        const panelWidth = Math.min(440, Math.max(280, Math.ceil(buildMenuText.width + panelPadding * 2)));
        const panelHeight = Math.max(46, Math.ceil(buildMenuText.height + panelPadding * 2));
        buildMenuText.position.set(panelX + panelPadding, panelY + panelPadding);
        buildMenuBackground.clear();
        buildMenuBackground.rect(panelX, panelY, panelWidth, panelHeight);
        buildMenuBackground.fill(0x141414);
        buildMenuBackground.alpha = 0.84;
        buildMenuBackground.stroke({ width: 1, color: 0x333333 });
        buildMenuBackground.visible = true;
        buildMenuText.visible = true;
    }

    function updateHealthHud() {
        const barWidth = 260;
        const barHeight = 18;
        const barX = Math.floor((window.innerWidth - barWidth) / 2);
        const barY = window.innerHeight - 34;
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
        weaponText.text = `Weapon: ${playerCombat.weapon}`;
        let weaponX = barX + barWidth + 14;
        const maxWeaponX = window.innerWidth - weaponText.width - 16;
        if (weaponX > maxWeaponX) {
            weaponX = Math.max(16, maxWeaponX);
        }
        weaponText.position.set(weaponX, barY + 1);
    }

    function logDebug(message) {
        const stamp = new Date().toLocaleTimeString();
        debugLogs.push(`[${stamp}] ${message}`);
        if (debugLogs.length > 6) {
            debugLogs.shift();
        }
    }

    function updateDebugOverlay(frameMs) {
        if (!debugOverlayEnabled) {
            return;
        }
        const worldStats = worldSystem.getStats();
        const buildingStats = buildingSystem?.getStats() ?? { buildingCount: 0 };
        const civilianStats = civilianSystem?.getStats() ?? { civilianCount: 0, civilianCap: 0, civiliansKilled: 0 };
        const pathStats = enemySystem?.getPathStats() ?? { requests: 0, executed: 0, deferred: 0, budget: ENEMY_MAX_REPATHS_PER_FRAME };

        const lines = [
            'DEV CONSOLE (F4 or ç)',
            'Shortcuts: F8 export crashes | H +100 resources | K enemy toggle',
            `FPS: ${smoothedFps.toFixed(1)} | Frame: ${frameMs.toFixed(2)} ms`,
            `Player HP: ${Math.ceil(playerState.hp)}/${playerState.maxHp} | Weapon: ${playerCombat.weapon}`,
            `Enemies: ${enemies.length}/${ENEMY_MAX_COUNT}`,
            `Enemies disabled: ${enemiesDisabled ? 'YES' : 'NO'} (Toggle: K while dev console open)`,
            `Bullets: ${projectiles.length}/${MAX_BULLETS}`,
            `Buildings: ${buildingStats.buildingCount} | Producers: ${buildingStats.producerCount ?? 0}`,
            `Civilians: ${civilianStats.civilianCount}/${civilianStats.civilianCap} | Lost: ${civilianStats.civiliansKilled}`,
            `Producer output: ${(buildingStats.producedPerSecond ?? 0).toFixed(2)}/s`,
            `Crash logs stored: ${crashLogs.length}`,
            `Path req/exe/def: ${pathStats.requests}/${pathStats.executed}/${pathStats.deferred}`,
            `Path budget/frame: ${pathStats.budget}`,
            `Tiles cached: ${worldStats.tilesCached}`,
            `Resources active: ${worldStats.resourcesActive}`,
            `Water feature regions: ${worldStats.waterFeatureRegions}`
        ];

        if (debugLogs.length > 0) {
            lines.push('Logs:');
            for (const entry of debugLogs) {
                lines.push(entry);
            }
        }

        debugText.text = lines.join('\n');
        // Right-align by content width so text never renders off-screen.
        debugText.position.set(Math.max(16, window.innerWidth - debugText.width - 16), 52);
    }

    function removeProjectileAt(index) {
        const projectile = projectiles[index];
        projectile.sprite.destroy();
        projectiles.splice(index, 1);
    }

    function resetCombatEntities() {
        enemySystem.resetEnemies();
        for (let i = projectiles.length - 1; i >= 0; i--) {
            removeProjectileAt(i);
        }
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
        gameTimeSeconds = 0;

        deathText.visible = false;
        const respawn = findSafeSpawnPosition();
        playerWorldX = respawn.x;
        playerWorldY = respawn.y;
        playerSystem.setWorldPosition(playerWorldX, playerWorldY);

        worldSystem.reset();
        buildingSystem.reset();
        civilianSystem.reset();
        resetCombatEntities();

        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            floatingTexts[i].sprite.destroy();
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
    }

    function applyDamage(target, amount, source) {
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
                logDebug(`Player defeated by ${source}`);
            } else {
                combatStats.enemiesKilled += 1;
                inventory.gold += GOLD_PER_ENEMY_KILL;
                updateHud();
            }
        }

        return true;
    }

    function performSwordAttack(playerCenterX, playerCenterY, dirX, dirY) {
        const cfg = WEAPONS.sword;
        const cosHalfArc = Math.cos(cfg.arcRadians / 2);
        playerSystem.triggerSwordSwing(dirX, dirY);

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

            const hit = applyDamage(enemy, cfg.damage, 'sword');
            if (hit) {
                enemy.knockbackVX += nx * cfg.knockbackSpeed;
                enemy.knockbackVY += ny * cfg.knockbackSpeed;
            }
        }
    }

    function createBulletSprite() {
        const sprite = new PIXI.Graphics();
        sprite.circle(4, 4, 4);
        sprite.fill(0xf7e56a);
        sprite.stroke({ width: 1, color: 0x2a2409 });
        return sprite;
    }

    function spawnBullet(playerCenterX, playerCenterY, dirX, dirY) {
        if (projectiles.length >= MAX_BULLETS) {
            return;
        }

        const cfg = WEAPONS.pistol;
        const sprite = createBulletSprite();
        const bullet = {
            x: playerCenterX - 4,
            y: playerCenterY - 4,
            vx: dirX * cfg.bulletSpeed,
            vy: dirY * cfg.bulletSpeed,
            ttl: cfg.bulletLifetimeFrames,
            damage: cfg.damage,
            sprite
        };
        sprite.position.set(bullet.x, bullet.y);
        projectileLayer.addChild(sprite);
        projectiles.push(bullet);
    }

    function performAttack(playerCenterX, playerCenterY) {
        const mag = Math.hypot(playerCombat.facingX, playerCombat.facingY);
        const dirX = mag > 0.001 ? playerCombat.facingX / mag : 1;
        const dirY = mag > 0.001 ? playerCombat.facingY / mag : 0;

        if (playerCombat.weapon === 'sword') {
            performSwordAttack(playerCenterX, playerCenterY, dirX, dirY);
            playerCombat.cooldownFrames = WEAPONS.sword.cooldownFrames;
        } else {
            spawnBullet(playerCenterX, playerCenterY, dirX, dirY);
            playerCombat.cooldownFrames = WEAPONS.pistol.cooldownFrames;
        }
    }

    function updateProjectiles(deltaMoveScale) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const bullet = projectiles[i];
            bullet.ttl -= (deltaMoveScale * 60);
            bullet.x += bullet.vx * deltaMoveScale;
            bullet.y += bullet.vy * deltaMoveScale;
            bullet.sprite.position.set(bullet.x, bullet.y);

            if (bullet.ttl <= 0) {
                removeProjectileAt(i);
                continue;
            }

            const bulletCenterX = bullet.x + 4;
            const bulletCenterY = bullet.y + 4;
            const bulletTileX = Math.floor(bulletCenterX / TILE_SIZE);
            const bulletTileY = Math.floor(bulletCenterY / TILE_SIZE);
            // Projectiles pass over water; only solid buildings can block them.
            if (buildingSystem.isProjectileBlocked(bulletTileX, bulletTileY)) {
                removeProjectileAt(i);
                continue;
            }

            let hitEnemy = false;
            for (const enemy of enemies) {
                if (enemy.isDead) {
                    continue;
                }
                const dx = (enemy.x + ENEMY_RADIUS) - bulletCenterX;
                const dy = (enemy.y + ENEMY_RADIUS) - bulletCenterY;
                const hitDistance = ENEMY_RADIUS + 4;
                if (dx * dx + dy * dy <= hitDistance * hitDistance) {
                    applyDamage(enemy, bullet.damage, 'bullet');
                    hitEnemy = true;
                    break;
                }
            }

            if (hitEnemy) {
                removeProjectileAt(i);
            }
        }
    }

    function spawnHarvestFeedback(resourceType, tileX, tileY) {
        const text = new PIXI.Text({
            text: `+1 ${resourceType}`,
            style: {
                fill: '#ffffff',
                fontFamily: 'monospace',
                fontSize: 14
            }
        });

        text.anchor.set(0.5);
        text.position.set(tileX * TILE_SIZE + TILE_SIZE / 2, tileY * TILE_SIZE + 6);
        resourceLayer.addChild(text);
        floatingTexts.push({
            sprite: text,
            ttl: 75 // Frames to keep harvest text visible.
        });
    }

    let playerWorldX = spawnWorldPos.x;
    let playerWorldY = spawnWorldPos.y;

    const keys = {};
    let harvestRequested = false;
    let placeRequested = false;
    let inspectRequested = false;
    let deleteBuildingRequested = false;
    let leftMouseDown = false;
    let mouseScreenX = window.innerWidth / 2;
    let mouseScreenY = window.innerHeight / 2;
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

    function loadCrashLogs() {
        try {
            const raw = localStorage.getItem('purrmadeath_crash_logs');
            if (!raw) {
                return;
            }
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                crashLogs.push(...parsed.slice(-50));
            }
        } catch {
            // Ignore malformed persisted logs.
        }
    }

    function persistCrashLogs() {
        try {
            localStorage.setItem('purrmadeath_crash_logs', JSON.stringify(crashLogs.slice(-50)));
        } catch {
            // Ignore quota/storage failures.
        }
    }

    function recordCrash(kind, payload) {
        crashLogs.push({
            kind,
            at: new Date().toISOString(),
            payload
        });
        if (crashLogs.length > 50) {
            crashLogs.shift();
        }
        persistCrashLogs();
    }

    function downloadCrashLogs() {
        const blob = new Blob([JSON.stringify(crashLogs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `purrmadeath-crash-logs-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    loadCrashLogs();
    window.addEventListener('error', (event) => {
        recordCrash('error', {
            message: event.message,
            source: event.filename,
            line: event.lineno,
            column: event.colno,
            stack: event.error?.stack ?? null
        });
    });
    window.addEventListener('unhandledrejection', (event) => {
        recordCrash('unhandledrejection', {
            reason: typeof event.reason === 'string' ? event.reason : JSON.stringify(event.reason ?? null)
        });
    });

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
        onPlayerContactDamage: (amount, source) => applyDamage(playerState, amount, source),
        getWalls: () => buildingSystem.getWalls(),
        getCivilianTargets: () => civilianSystem?.getTargets() ?? [],
        onCivilianContactDamage: (civilianId, amount, source) => civilianSystem?.applyDamage(civilianId, amount, source)
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

    updateHud();
    updateHealthHud();
    updateVisibleWorld();

    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        keys[key] = true;
        // Global gameplay keybinds are handled in this block.
        if (key === 'escape') {
            isPaused = !isPaused;
            pauseText.visible = isPaused;
            placeRequested = false;
            logDebug(`Game ${isPaused ? 'paused' : 'resumed'}`);
            e.preventDefault();
            return;
        }
        // Dev console keybind is F4 or c-cedilla (ç).
        if (key === 'f4' || key === '\u00e7') {
            debugOverlayEnabled = !debugOverlayEnabled;
            debugText.visible = debugOverlayEnabled;
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
        if (key === 'f8') {
            downloadCrashLogs();
            logDebug('Crash logs exported');
        }
        if ((key === 'h') && debugOverlayEnabled) {
            inventory.wood += 100;
            inventory.stone += 100;
            inventory.iron += 100;
            inventory.gold += 100;
            updateHud();
            logDebug('Dev resources added (+100 each)');
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
        if (key === 'r' && playerState.isDead) {
            resetRunState();
            logDebug('Player restarted');
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

    app.ticker.add((delta) => {
        const frameMs = delta.deltaMS;
        const fps = frameMs > 0 ? 1000 / frameMs : 0;
        smoothedFps = smoothedFps * 0.9 + fps * 0.1;
        enemySystem.beginFramePathBudget();

        playerSystem.updateFacingFromMouse(mouseScreenX, mouseScreenY, window.innerWidth, window.innerHeight);
        playerSystem.updateScreenVisuals();
        buildingSystem.updatePlacementGhost();

        if (isPaused) {
            updateDebugOverlay(frameMs);
            return;
        }

        gameTimeSeconds += (delta.deltaMS / 1000);

        const deltaMoveScale = delta.deltaTime / 60;
        buildingSystem.updateProduction(delta.deltaTime);
        civilianSystem.update(delta.deltaTime, deltaMoveScale);
        uiRefreshTimer -= delta.deltaTime;
        if (uiRefreshTimer <= 0) {
            updateBuildMenu();
            updateClockHud();
            uiRefreshTimer = 12;
        }

        playerSystem.tickCombatTimers(delta.deltaTime);
        playerSystem.updateMovement(keys, deltaMoveScale, (nextX, nextY) => {
            const tileX = Math.floor((nextX + TILE_SIZE / 2) / TILE_SIZE);
            const tileY = Math.floor((nextY + TILE_SIZE / 2) / TILE_SIZE);
            return isTileWalkable(tileX, tileY);
        });
        const playerWorld = playerSystem.getWorldPosition();
        playerWorldX = playerWorld.x;
        playerWorldY = playerWorld.y;

        world.position.x = window.innerWidth / 2 - playerWorldX - 16;
        world.position.y = window.innerHeight / 2 - playerWorldY - 16;

        updateVisibleWorld();
        if (!playerState.isDead && !enemiesDisabled) {
            enemySystem.spawnTick();
        }
        if (!enemiesDisabled) {
            enemySystem.update(deltaMoveScale);
        }
        updateProjectiles(deltaMoveScale);

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
            const removed = buildingSystem.removeSelectedPlacedBuilding();
            if (removed) {
                updateHud();
            }
            deleteBuildingRequested = false;
        }
        if (!playerState.isDead && buildUi.buildMode && placeRequested) {
            const placed = buildingSystem.tryPlaceSelectedAtMouse();
            if (placed) {
                updateHud();
            }
            placeRequested = false;
        }

        if (!playerState.isDead && !buildUi.buildMode && (keys.attack || leftMouseDown) && playerCombat.cooldownFrames <= 0) {
            const center = playerSystem.getCenter();
            performAttack(center.x, center.y);
        }
        if (!buildUi.buildMode) {
            placeRequested = false;
        }

        if (!playerState.isDead && harvestRequested) {
            harvestRequested = false;

            const playerCenterX = playerWorldX + TILE_SIZE / 2;
            const playerCenterY = playerWorldY + TILE_SIZE / 2;
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

        // Lightweight floating text update for harvest feedback.
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            const entry = floatingTexts[i];
            entry.ttl -= 1;
            entry.sprite.y -= 0.4;
            entry.sprite.alpha = Math.max(0, entry.ttl / 75);

            if (entry.ttl <= 0) {
                entry.sprite.destroy();
                floatingTexts.splice(i, 1);
            }
        }

        playerSystem.updateHitVisual();

        updateDebugOverlay(frameMs);
    });

    window.addEventListener('resize', () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        playerSystem.handleResize(window.innerWidth, window.innerHeight);
        debugText.position.set(Math.max(16, window.innerWidth - debugText.width - 16), 52);
        deathText.position.set(window.innerWidth / 2, window.innerHeight / 2);
        pauseText.position.set(window.innerWidth / 2, window.innerHeight / 2);
        updateVisibleWorld();
        updateHud();
    });

    console.log('Purrmadeath initialized');
}

init();
