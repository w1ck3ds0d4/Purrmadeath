export const ALLOWED_DEBUG_VIEWS = new Set(['core', 'perf', 'cheats', 'multiplayer', 'server', 'logs', 'all']);

export function resolveDebugCommandView(commandText) {
    const command = commandText.trim().toLowerCase();
    if (command === '/core') {
        return { view: 'core' };
    }
    if (command === '/perf') {
        return { view: 'perf' };
    }
    if (command === '/cheats') {
        return { view: 'cheats' };
    }
    if (command === '/multiplayer' || command === '/mp') {
        return { view: 'multiplayer' };
    }
    if (command === '/server' || command === '/sv') {
        return { view: 'server' };
    }
    if (command === '/logs') {
        return { view: 'logs' };
    }
    if (command === '/all') {
        return { view: 'all' };
    }
    if (command === '/help') {
        return { help: true };
    }
    return { unknown: command };
}
