import { PLAYER_MAX_HP } from '../config/constants.js';

const SAVE_STORAGE_KEY = 'purrmadeath_save_v1';

function getMultiplayerCheckpointKey(sessionId) {
    return `purrmadeath_mp_checkpoint_${sessionId}`;
}

// Persistence controller encapsulates local save/checkpoint storage and keeps
// index.js focused on orchestration.
export function createPersistenceController(deps) {
    const {
        getGameTimeSeconds,
        setGameTimeSeconds,
        getPlayerWorldPosition,
        setPlayerWorldPosition,
        playerState,
        playerCombat,
        inventory,
        combatStats,
        worldSystem,
        buildingSystem,
        sharedSessionState,
        setPausedState,
        updateVisibleWorld,
        updateHud,
        updateHealthHud,
        updateClockHud
    } = deps;

    function buildSaveStateSnapshot() {
        const pos = getPlayerWorldPosition();
        return {
            savedAt: Date.now(),
            gameTimeSeconds: getGameTimeSeconds(),
            player: {
                worldX: pos.x,
                worldY: pos.y,
                hp: playerState.hp,
                maxHp: playerState.maxHp,
                invulnFrames: playerState.invulnFrames,
                weapon: playerCombat.weapon,
                cooldownFrames: playerCombat.cooldownFrames
            },
            inventory: { ...inventory },
            combatStats: { ...combatStats },
            world: worldSystem.exportState?.() ?? null,
            buildings: buildingSystem.exportState?.() ?? null
        };
    }

    function persistSaveState() {
        if (playerState.isDead) {
            return;
        }
        try {
            localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(buildSaveStateSnapshot()));
        } catch {
            // Ignore storage quota failures.
        }
    }

    function clearSavedGameState() {
        try {
            localStorage.removeItem(SAVE_STORAGE_KEY);
        } catch {
            // Ignore storage access failures.
        }
    }

    function clearMultiplayerCheckpointCache() {
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith('purrmadeath_mp_checkpoint_')) {
                    continue;
                }
                localStorage.removeItem(key);
            }
        } catch {
            // Ignore storage access failures.
        }
    }

    function restoreSavedGameState() {
        let saved = null;
        try {
            const raw = localStorage.getItem(SAVE_STORAGE_KEY);
            if (!raw) {
                return false;
            }
            saved = JSON.parse(raw);
        } catch {
            return false;
        }
        if (!saved || typeof saved !== 'object') {
            return false;
        }

        const playerSnapshot = saved.player ?? {};
        const inventorySnapshot = saved.inventory ?? {};
        const combatSnapshot = saved.combatStats ?? {};

        if (saved.world) {
            worldSystem.importState(saved.world);
        }
        if (saved.buildings) {
            buildingSystem.importState(saved.buildings);
        }

        inventory.wood = Number.isFinite(inventorySnapshot.wood) ? inventorySnapshot.wood : 0;
        inventory.stone = Number.isFinite(inventorySnapshot.stone) ? inventorySnapshot.stone : 0;
        inventory.iron = Number.isFinite(inventorySnapshot.iron) ? inventorySnapshot.iron : 0;
        inventory.gold = Number.isFinite(inventorySnapshot.gold) ? inventorySnapshot.gold : 0;
        combatStats.enemiesKilled = Number.isFinite(combatSnapshot.enemiesKilled) ? combatSnapshot.enemiesKilled : 0;

        playerState.hp = Number.isFinite(playerSnapshot.hp) ? playerSnapshot.hp : PLAYER_MAX_HP;
        playerState.maxHp = Number.isFinite(playerSnapshot.maxHp) ? playerSnapshot.maxHp : PLAYER_MAX_HP;
        playerState.invulnFrames = Number.isFinite(playerSnapshot.invulnFrames) ? playerSnapshot.invulnFrames : 0;
        playerState.isDead = false;
        playerCombat.weapon = playerSnapshot.weapon === 'pistol' ? 'pistol' : 'sword';
        playerCombat.cooldownFrames = Number.isFinite(playerSnapshot.cooldownFrames) ? playerSnapshot.cooldownFrames : 0;
        setGameTimeSeconds(Number.isFinite(saved.gameTimeSeconds) ? saved.gameTimeSeconds : 0);

        setPlayerWorldPosition({
            x: Number.isFinite(playerSnapshot.worldX) ? playerSnapshot.worldX : getPlayerWorldPosition().x,
            y: Number.isFinite(playerSnapshot.worldY) ? playerSnapshot.worldY : getPlayerWorldPosition().y
        });

        updateVisibleWorld();
        updateHud();
        updateHealthHud();
        return true;
    }

    function persistMultiplayerCheckpoint(sessionId) {
        if (!sessionId) {
            return;
        }
        try {
            const payload = {
                savedAt: Date.now(),
                gameTimeSeconds: getGameTimeSeconds(),
                inventory: { ...inventory },
                combatStats: { ...combatStats },
                sharedSessionState: { paused: Boolean(sharedSessionState.paused) },
                buildingState: buildingSystem.exportReplicationState()
            };
            localStorage.setItem(getMultiplayerCheckpointKey(sessionId), JSON.stringify(payload));
        } catch {
            // Ignore storage quota failures.
        }
    }

    function tryRestoreMultiplayerCheckpoint(sessionId) {
        if (!sessionId) {
            return false;
        }
        try {
            const raw = localStorage.getItem(getMultiplayerCheckpointKey(sessionId));
            if (!raw) {
                return false;
            }
            const checkpoint = JSON.parse(raw);
            if (!checkpoint || typeof checkpoint !== 'object') {
                return false;
            }
            setGameTimeSeconds(Math.max(0, Number(checkpoint.gameTimeSeconds) || 0));
            inventory.wood = Number(checkpoint.inventory?.wood) || 0;
            inventory.stone = Number(checkpoint.inventory?.stone) || 0;
            inventory.iron = Number(checkpoint.inventory?.iron) || 0;
            inventory.gold = Number(checkpoint.inventory?.gold) || 0;
            combatStats.enemiesKilled = Number(checkpoint.combatStats?.enemiesKilled) || 0;
            sharedSessionState.paused = Boolean(checkpoint.sharedSessionState?.paused);
            if (checkpoint.buildingState) {
                buildingSystem.importReplicationState(checkpoint.buildingState);
            }
            setPausedState(sharedSessionState.paused);
            updateHud();
            updateClockHud();
            return true;
        } catch {
            return false;
        }
    }

    return {
        clearMultiplayerCheckpointCache,
        clearSavedGameState,
        persistMultiplayerCheckpoint,
        persistSaveState,
        restoreSavedGameState,
        tryRestoreMultiplayerCheckpoint
    };
}
