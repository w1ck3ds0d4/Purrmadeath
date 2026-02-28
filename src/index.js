import { showMainMenu } from './menu/mainMenu.js';
import { launchSingleplayer } from './modes/singleplayerMode.js';
import { launchMultiplayer } from './modes/multiplayerMode.js';

function hasDirectMultiplayerParams() {
    const params = new URLSearchParams(window.location.search);
    return params.get('mp') === '1' || params.get('multiplayer') === '1';
}

async function run() {
    if (hasDirectMultiplayerParams()) {
        await launchMultiplayer();
        return;
    }
    const selection = await showMainMenu();
    if (selection?.mode === 'multiplayer') {
        await launchMultiplayer(selection.multiplayer ?? {});
        return;
    }
    await launchSingleplayer();
}

// Entry bootstrap delegates to mode-specific launchers to keep singleplayer and multiplayer paths isolated.
run();
