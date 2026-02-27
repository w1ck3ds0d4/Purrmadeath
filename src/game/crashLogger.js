const CRASH_LOG_KEY = 'purrmadeath_crash_logs';
const MAX_CRASH_LOGS = 50;

// Crash log controller keeps browser error/unhandled rejection capture
// out of index.js and centralizes persistence/export behavior.
export function createCrashLogger(crashLogs) {
    function load() {
        try {
            const raw = localStorage.getItem(CRASH_LOG_KEY);
            if (!raw) {
                return;
            }
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                crashLogs.push(...parsed.slice(-MAX_CRASH_LOGS));
            }
        } catch {
            // Ignore malformed persisted logs.
        }
    }

    function persist() {
        try {
            localStorage.setItem(CRASH_LOG_KEY, JSON.stringify(crashLogs.slice(-MAX_CRASH_LOGS)));
        } catch {
            // Ignore quota/storage failures.
        }
    }

    function record(kind, payload) {
        crashLogs.push({
            kind,
            at: new Date().toISOString(),
            payload
        });
        if (crashLogs.length > MAX_CRASH_LOGS) {
            crashLogs.shift();
        }
        persist();
    }

    function download() {
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

    function bindGlobalHandlers() {
        window.addEventListener('error', (event) => {
            record('error', {
                message: event.message,
                source: event.filename,
                line: event.lineno,
                column: event.colno,
                stack: event.error?.stack ?? null
            });
        });
        window.addEventListener('unhandledrejection', (event) => {
            record('unhandledrejection', {
                reason: typeof event.reason === 'string' ? event.reason : JSON.stringify(event.reason ?? null)
            });
        });
    }

    return {
        load,
        persist,
        record,
        download,
        bindGlobalHandlers
    };
}
