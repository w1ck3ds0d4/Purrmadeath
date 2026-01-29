function getDefaultHost() {
    if (window.location.hostname && window.location.hostname !== '0.0.0.0' && window.location.hostname !== '::') {
        return window.location.hostname;
    }
    return 'localhost';
}

const STORAGE_LAST_MULTIPLAYER = 'purrmadeath:lastMultiplayer';
const STORAGE_JOIN_HISTORY = 'purrmadeath:joinHistory';
const SINGLEPLAYER_SLOT_KEYS = [1, 2, 3].map((slot) => `purrmadeath_save_slot_${slot}`);
const MULTIPLAYER_HOST_SLOT_KEYS = [1, 2, 3].map((slot) => `purrmadeath_mp_checkpoint_host_slot_${slot}`);

function encodeSessionCode(payload) {
    const raw = JSON.stringify(payload);
    const base64 = btoa(unescape(encodeURIComponent(raw)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeSessionCode(code) {
    const normalized = String(code || '')
        .trim()
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    if (!normalized) {
        return null;
    }
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    try {
        const decoded = decodeURIComponent(escape(atob(padded)));
        const parsed = JSON.parse(decoded);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function parseInviteInput(inviteOrCode) {
    const raw = String(inviteOrCode || '').trim();
    if (!raw) {
        return null;
    }
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        try {
            const url = new URL(raw);
            const host = url.searchParams.get('mpHost');
            let port = Number(url.searchParams.get('mpPort') || 8080) || 8080;
            if (port < 1 || port > 65535) port = 8080;
            const joinToken = url.searchParams.get('joinToken') || '';
            if (!host) {
                return null;
            }
            return { host, port, joinToken };
        } catch {
            return null;
        }
    }
    const decoded = decodeSessionCode(raw);
    if (!decoded) {
        return null;
    }
    const host = typeof decoded.h === 'string' ? decoded.h : '';
    let port = Number(decoded.p || 8080) || 8080;
    if (port < 1 || port > 65535) port = 8080;
    const joinToken = typeof decoded.t === 'string' ? decoded.t : '';
    if (!host) {
        return null;
    }
    return { host, port, joinToken };
}

function buildInviteUrl({ host, port, joinToken }) {
    const base = `${window.location.protocol}//${window.location.host}/`;
    const url = new URL(base);
    url.searchParams.set('mp', '1');
    url.searchParams.set('mpHost', host);
    url.searchParams.set('mpPort', String(port));
    if (joinToken) {
        url.searchParams.set('joinToken', joinToken);
    }
    return url.toString();
}

function createButton(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.width = '100%';
    button.style.padding = '10px 12px';
    button.style.fontFamily = 'monospace';
    button.style.fontSize = '14px';
    button.style.cursor = 'pointer';
    button.style.border = '1px solid #2f7c42';
    button.style.background = '#102616';
    button.style.color = '#c5ffd7';
    return button;
}

function createInput(placeholder, value = '') {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = value;
    input.style.width = '100%';
    input.style.padding = '10px 12px';
    input.style.fontFamily = 'monospace';
    input.style.fontSize = '13px';
    input.style.border = '1px solid #2d6240';
    input.style.background = '#0a1910';
    input.style.color = '#d6ffe3';
    return input;
}

function clearElement(el) {
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
}

function safeReadJson(key, fallback) {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
            return fallback;
        }
        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignore persistence failures in private mode/storage-constrained browsers.
    }
}

function saveLastMultiplayer(settings) {
    const payload = {
        host: String(settings.host || ''),
        port: Number(settings.port) || 8080,
        joinToken: String(settings.joinToken || '')
    };
    if (!payload.host) {
        return;
    }
    writeJson(STORAGE_LAST_MULTIPLAYER, payload);
}

function getLastMultiplayer() {
    const parsed = safeReadJson(STORAGE_LAST_MULTIPLAYER, null);
    if (!parsed || typeof parsed !== 'object') {
        return null;
    }
    const host = typeof parsed.host === 'string' ? parsed.host : '';
    const port = Number(parsed.port) || 8080;
    const joinToken = typeof parsed.joinToken === 'string' ? parsed.joinToken : '';
    if (!host) {
        return null;
    }
    return { host, port, joinToken };
}

function pushJoinHistory(entry) {
    const host = String(entry.host || '').trim();
    const port = Number(entry.port) || 8080;
    const joinToken = String(entry.joinToken || '');
    if (!host) {
        return;
    }
    const current = safeReadJson(STORAGE_JOIN_HISTORY, []);
    const list = Array.isArray(current) ? current : [];
    const normalizedKey = `${host}:${port}:${joinToken}`;
    const deduped = list.filter((item) => `${item.host}:${item.port}:${item.joinToken || ''}` !== normalizedKey);
    deduped.unshift({
        host,
        port,
        joinToken,
        usedAt: Date.now()
    });
    writeJson(STORAGE_JOIN_HISTORY, deduped.slice(0, 6));
}

function getJoinHistory() {
    const current = safeReadJson(STORAGE_JOIN_HISTORY, []);
    if (!Array.isArray(current)) {
        return [];
    }
    return current
        .filter((item) => item && typeof item.host === 'string' && item.host)
        .slice(0, 6)
        .map((item) => ({
            host: item.host,
            port: Number(item.port) || 8080,
            joinToken: typeof item.joinToken === 'string' ? item.joinToken : ''
        }));
}

function readSaveSlotMeta(storageKey) {
    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        const savedAt = Number(parsed.savedAt) || 0;
        return {
            exists: true,
            savedAt,
            label: savedAt > 0 ? new Date(savedAt).toLocaleString() : 'Existing save'
        };
    } catch {
        return null;
    }
}

async function copyToClipboard(text) {
    const value = String(text || '');
    if (!value) {
        return false;
    }
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        area.remove();
        return ok;
    }
}

// Main menu gateway separating singleplayer and multiplayer startup paths.
export function showMainMenu() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(5, 12, 8, 0.95)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '9999';

        const panel = document.createElement('div');
        panel.style.width = 'min(560px, calc(100vw - 40px))';
        panel.style.background = '#0b1f12';
        panel.style.border = '1px solid #2f7c42';
        panel.style.padding = '18px';
        panel.style.color = '#d6ffe3';
        panel.style.fontFamily = 'monospace';
        panel.style.boxSizing = 'border-box';
        overlay.appendChild(panel);

        const title = document.createElement('h1');
        title.textContent = 'Purrmadeath';
        title.style.margin = '0 0 8px 0';
        title.style.fontSize = '22px';
        title.style.color = '#a9ffd0';
        panel.appendChild(title);

        const subtitle = document.createElement('div');
        subtitle.textContent = 'Select game mode';
        subtitle.style.fontSize = '13px';
        subtitle.style.opacity = '0.9';
        subtitle.style.marginBottom = '14px';
        panel.appendChild(subtitle);

        const content = document.createElement('div');
        content.style.display = 'grid';
        content.style.gap = '10px';
        panel.appendChild(content);

        const status = document.createElement('div');
        status.style.minHeight = '18px';
        status.style.fontSize = '12px';
        status.style.color = '#ffd88a';
        panel.appendChild(status);

        function finish(result) {
            overlay.remove();
            resolve(result);
        }

        function renderRoot() {
            clearElement(content);
            status.textContent = '';
            const singleBtn = createButton('Singleplayer');
            const multiBtn = createButton('Multiplayer');
            const reconnect = getLastMultiplayer();
            let reconnectBtn = null;
            const note = document.createElement('div');
            note.style.fontSize = '12px';
            note.style.opacity = '0.85';
            note.textContent = 'Singleplayer auto-resumes save. Multiplayer supports host/join by invite link or code.';
            singleBtn.onclick = () => renderSingleplayerSlots();
            multiBtn.onclick = () => renderMultiplayerMenu();
            if (reconnect) {
                reconnectBtn = createButton(`Reconnect (${reconnect.host}:${reconnect.port})`);
                reconnectBtn.onclick = () => finish({
                    mode: 'multiplayer',
                    multiplayer: {
                        host: reconnect.host,
                        port: reconnect.port,
                        joinToken: reconnect.joinToken,
                        lanHostHint: reconnect.host
                    }
                });
            }
            if (reconnectBtn) {
                content.append(singleBtn, multiBtn, reconnectBtn, note);
            } else {
                content.append(singleBtn, multiBtn, note);
            }
        }

        function renderSingleplayerSlots() {
            clearElement(content);
            status.textContent = '';
            const title = document.createElement('div');
            title.style.fontSize = '12px';
            title.style.opacity = '0.9';
            title.textContent = 'Singleplayer slots: load existing or create new run.';
            content.append(title);
            for (let slot = 1; slot <= 3; slot++) {
                const key = SINGLEPLAYER_SLOT_KEYS[slot - 1];
                const meta = readSaveSlotMeta(key);
                const slotCard = document.createElement('div');
                slotCard.style.border = '1px solid #355b42';
                slotCard.style.background = '#0f1e15';
                slotCard.style.padding = '8px';
                slotCard.style.display = 'grid';
                slotCard.style.gap = '8px';
                const slotLabel = document.createElement('div');
                slotLabel.style.fontSize = '12px';
                slotLabel.textContent = `Slot ${slot}: ${meta?.exists ? `Saved (${meta.label})` : 'Empty'}`;
                const newBtn = createButton(`Start New (Slot ${slot})`);
                const loadBtn = createButton(`Load Slot ${slot}`);
                loadBtn.disabled = !meta?.exists;
                loadBtn.style.opacity = meta?.exists ? '1' : '0.5';
                newBtn.onclick = () => finish({
                    mode: 'singleplayer',
                    singleplayer: { saveSlot: slot, startFresh: true }
                });
                loadBtn.onclick = () => finish({
                    mode: 'singleplayer',
                    singleplayer: { saveSlot: slot, startFresh: false }
                });
                slotCard.append(slotLabel, newBtn, loadBtn);
                content.append(slotCard);
            }
            const backBtn = createButton('Back');
            backBtn.onclick = () => renderRoot();
            content.append(backBtn);
        }

        function renderMultiplayerMenu() {
            clearElement(content);
            status.textContent = '';
            const hostBtn = createButton('Host Session');
            const joinBtn = createButton('Join Session');
            const backBtn = createButton('Back');
            hostBtn.onclick = () => renderHostMenu();
            joinBtn.onclick = () => renderJoinMenu();
            backBtn.onclick = () => renderRoot();
            content.append(hostBtn, joinBtn, backBtn);
        }

        function renderHostMenu() {
            clearElement(content);
            const defaultHost = getDefaultHost();
            const hostInput = createInput('Host/IP (LAN)', defaultHost);
            const portInput = createInput('Port', '8080');
            const tokenInput = createInput('Join token (optional)', '');
            const startNewBtn = createButton('Start New Hosted Session');
            const loadExistingBtn = createButton('Load Existing Host Save');
            const backBtn = createButton('Back');
            const copyUrlBtn = createButton('Copy Invite URL');
            const copyCodeBtn = createButton('Copy Session Code');
            copyUrlBtn.style.padding = '8px 10px';
            copyCodeBtn.style.padding = '8px 10px';
            const shareLabel = document.createElement('div');
            shareLabel.style.fontSize = '12px';
            shareLabel.style.whiteSpace = 'pre-wrap';
            shareLabel.style.opacity = '0.95';
            let latestInviteUrl = '';
            let latestInviteCode = '';

            const hostCard = document.createElement('div');
            hostCard.style.fontSize = '12px';
            hostCard.style.border = '1px solid #355b42';
            hostCard.style.background = '#0f1e15';
            hostCard.style.padding = '8px';
            hostCard.style.whiteSpace = 'pre-wrap';
            hostCard.textContent = 'Host Session Card\nPlayers: 1/4 (you)\nStatus: OPEN';
            const slotInput = createInput('Host save slot (1-3)', '1');
            const slotInfo = document.createElement('div');
            slotInfo.style.fontSize = '12px';
            slotInfo.style.opacity = '0.9';

            function updateSlotInfo() {
                const slot = Math.max(1, Math.min(3, Number(slotInput.value) || 1));
                const slotMeta = readSaveSlotMeta(MULTIPLAYER_HOST_SLOT_KEYS[slot - 1]);
                slotInfo.textContent = slotMeta?.exists
                    ? `Host Slot ${slot}: Saved (${slotMeta.label})`
                    : `Host Slot ${slot}: Empty`;
                loadExistingBtn.disabled = !slotMeta?.exists;
                loadExistingBtn.style.opacity = slotMeta?.exists ? '1' : '0.5';
            }
            slotInput.oninput = () => {
                updateSlotInfo();
            };

            function updateSharePreview() {
                const host = hostInput.value.trim() || defaultHost;
                const port = Number(portInput.value) || 8080;
                const joinToken = tokenInput.value.trim();
                latestInviteUrl = buildInviteUrl({ host, port, joinToken });
                latestInviteCode = encodeSessionCode({ h: host, p: port, t: joinToken });
                shareLabel.textContent = `Invite URL:\n${latestInviteUrl}\n\nSession code:\n${latestInviteCode}`;
            }

            hostInput.oninput = updateSharePreview;
            portInput.oninput = updateSharePreview;
            tokenInput.oninput = updateSharePreview;
            updateSharePreview();

            copyUrlBtn.onclick = async () => {
                const ok = await copyToClipboard(latestInviteUrl);
                status.textContent = ok ? 'Invite URL copied.' : 'Failed to copy invite URL.';
            };
            copyCodeBtn.onclick = async () => {
                const ok = await copyToClipboard(latestInviteCode);
                status.textContent = ok ? 'Session code copied.' : 'Failed to copy session code.';
            };

            function finishHostSelection(resumeCheckpoint) {
                const host = hostInput.value.trim() || defaultHost;
                const port = Number(portInput.value) || 8080;
                const joinToken = tokenInput.value.trim();
                const saveSlot = Math.max(1, Math.min(3, Number(slotInput.value) || 1));
                saveLastMultiplayer({ host, port, joinToken });
                finish({
                    mode: 'multiplayer',
                    multiplayer: {
                        host,
                        port,
                        joinToken,
                        lanHostHint: host,
                        saveSlot,
                        resumeCheckpoint
                    }
                });
            }
            startNewBtn.onclick = () => finishHostSelection(false);
            loadExistingBtn.onclick = () => finishHostSelection(true);
            backBtn.onclick = () => renderMultiplayerMenu();
            updateSlotInfo();
            content.append(
                hostCard,
                slotInput,
                slotInfo,
                hostInput,
                portInput,
                tokenInput,
                shareLabel,
                copyUrlBtn,
                copyCodeBtn,
                startNewBtn,
                loadExistingBtn,
                backBtn
            );
        }

        function renderJoinMenu() {
            clearElement(content);
            const inviteInput = createInput('Paste invite link or session code', '');
            const joinBtn = createButton('Join Session');
            const backBtn = createButton('Back');
            const history = getJoinHistory();
            if (history.length > 0) {
                const historyLabel = document.createElement('div');
                historyLabel.style.fontSize = '12px';
                historyLabel.style.opacity = '0.9';
                historyLabel.textContent = 'Recent sessions:';
                content.append(historyLabel);
                for (const entry of history) {
                    const optionBtn = createButton(`${entry.host}:${entry.port}${entry.joinToken ? ' (token)' : ''}`);
                    optionBtn.style.padding = '7px 10px';
                    optionBtn.onclick = () => {
                        const url = buildInviteUrl(entry);
                        inviteInput.value = url;
                    };
                    content.append(optionBtn);
                }
            }
            joinBtn.onclick = () => {
                const parsed = parseInviteInput(inviteInput.value);
                if (!parsed) {
                    status.textContent = 'Invalid invite link or code.';
                    return;
                }
                saveLastMultiplayer(parsed);
                pushJoinHistory(parsed);
                finish({
                    mode: 'multiplayer',
                    multiplayer: {
                        host: parsed.host,
                        port: parsed.port,
                        joinToken: parsed.joinToken,
                        lanHostHint: parsed.host
                    }
                });
            };
            backBtn.onclick = () => renderMultiplayerMenu();
            content.append(inviteInput, joinBtn, backBtn);
        }

        document.body.appendChild(overlay);
        renderRoot();
    });
}
