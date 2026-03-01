import { startGame } from '../game/bootstrap.js';

// Multiplayer mode uses explicit host/join connection settings and skips singleplayer save restore.
export async function launchMultiplayer(multiplayerSettings = {}) {
    const host = typeof multiplayerSettings.host === 'string' && multiplayerSettings.host
        ? multiplayerSettings.host
        : (window.location.hostname || 'localhost');
    const port = Number(multiplayerSettings.port) || 8080;
    const joinToken = typeof multiplayerSettings.joinToken === 'string' ? multiplayerSettings.joinToken : '';
    const lanHostHint = typeof multiplayerSettings.lanHostHint === 'string' && multiplayerSettings.lanHostHint
        ? multiplayerSettings.lanHostHint
        : host;
    const resumeCheckpoint = Boolean(multiplayerSettings.resumeCheckpoint);
    const saveSlot = Math.max(1, Math.min(3, Number(multiplayerSettings.saveSlot) || 1));
    if (port < 1 || port > 65535) {
        throw new Error(`Invalid multiplayer port: ${port} (must be 1–65535)`);
    }
    if (!host || /\s/.test(host)) {
        throw new Error(`Invalid multiplayer host: "${host}"`);
    }
    await startGame({
        mode: 'multiplayer',
        multiplayer: {
            host,
            port,
            joinToken,
            lanHostHint,
            resumeCheckpoint,
            saveSlot
        }
    });
}
