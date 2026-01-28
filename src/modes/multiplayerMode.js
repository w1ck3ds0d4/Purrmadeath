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
    await startGame({
        mode: 'multiplayer',
        multiplayer: {
            host,
            port,
            joinToken,
            lanHostHint
        }
    });
}

