import { startGame } from '../game/bootstrap.js';

// Singleplayer mode keeps local save progression unless the player dies/restarts.
export async function launchSingleplayer(singleplayerSettings = {}) {
    const saveSlot = Math.max(1, Math.min(3, Number(singleplayerSettings.saveSlot) || 1));
    await startGame({
        mode: 'singleplayer',
        singleplayer: {
            saveSlot,
            startFresh: Boolean(singleplayerSettings.startFresh)
        }
    });
}
