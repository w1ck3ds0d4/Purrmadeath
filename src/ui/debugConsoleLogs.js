// Debug-log helpers are centralized so bootstrap can stay focused on runtime flow.
export function inferDebugLogLevel(message) {
    const text = String(message || '').toLowerCase();
    if (
        text.includes('rejected')
        || text.includes('error')
        || text.includes('timeout')
        || text.includes('invalid')
        || text.includes('failed')
        || text.includes('mismatch')
        || text.includes('blocked')
    ) {
        return 'warn';
    }
    return 'info';
}

export function appendDebugLog(debugLogs, message, level = null, maxEntries = 300) {
    const stamp = new Date().toLocaleTimeString();
    const resolvedLevel = level || inferDebugLogLevel(message);
    debugLogs.push({
        ts: stamp,
        level: resolvedLevel === 'warn' ? 'warn' : 'info',
        message: String(message)
    });
    if (debugLogs.length > maxEntries) {
        debugLogs.splice(0, debugLogs.length - maxEntries);
    }
}

export function downloadDebugSessionLogs(debugLogs) {
    const payload = {
        exportedAt: new Date().toISOString(),
        entries: debugLogs
            .filter((entry) => entry.level === 'info' || entry.level === 'warn')
            .map((entry) => ({
                ts: entry.ts,
                level: entry.level,
                message: entry.message
            }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `purrmadeath-session-logs-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
