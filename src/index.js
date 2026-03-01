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
    await launchSingleplayer(selection?.singleplayer ?? {});
}

// Entry bootstrap delegates to mode-specific launchers to keep singleplayer and multiplayer paths isolated.
run().catch((err) => {
    console.error('[purrmadeath] fatal startup error:', err);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:#111;color:#f55;display:flex;align-items:center;justify-content:center;font:16px monospace;z-index:9999;padding:24px;text-align:center;white-space:pre-wrap';
    overlay.textContent = `Failed to start\n\n${err?.message ?? String(err)}`;
    document.body.appendChild(overlay);
});
