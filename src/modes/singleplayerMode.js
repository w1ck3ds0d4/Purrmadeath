import { startGame } from '../game/bootstrap.js';

// Singleplayer mode keeps local save progression unless the player dies/restarts.
export async function launchSingleplayer() {
    await startGame({ mode: 'singleplayer' });
}

