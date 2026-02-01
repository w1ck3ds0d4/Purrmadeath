import { app, BrowserWindow, shell, session, ipcMain } from 'electron';
import { join } from 'path';
import * as dgram from 'node:dgram';
import { DISCOVERY_PORT } from '../../server/discovery';
import type { DiscoveryBeaconPayload } from '../../server/discovery';

if (!app.isPackaged) {
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
}

// ─── LAN Session Discovery ─────────────────────────────────────────────────────
// Listens for UDP beacon broadcasts from game servers on the LAN.
// The renderer resolves a 4-letter code → host IP via IPC instead of typing IPs.

interface DiscoveredSession {
  code: string;
  ip: string;
  port: number;
  playerCount: number;
  maxPlayers: number;
  lastSeen: number;
}

const discoveredSessions = new Map<string, DiscoveredSession>(); // key: `ip:code`
const SESSION_EXPIRY_MS = 8_000;

function startDiscoveryListener(): void {
  const sock = dgram.createSocket('udp4');

  sock.on('message', (buf, rinfo) => {
    try {
      const payload = JSON.parse(buf.toString()) as DiscoveryBeaconPayload;
      if (payload.v !== 1 || !payload.code) return;

      const key = `${rinfo.address}:${payload.code}`;
      discoveredSessions.set(key, {
        code: payload.code,
        ip: rinfo.address,
        port: payload.port,
        playerCount: payload.playerCount,
        maxPlayers: payload.maxPlayers,
        lastSeen: Date.now(),
      });
    } catch {
      // malformed packet — ignore
    }
  });

  sock.on('error', (err) => {
    console.warn('[Discovery] Listener error:', err.message);
  });

  sock.bind(DISCOVERY_PORT, '0.0.0.0', () => {
    console.log(`[Main] LAN discovery listening on UDP ${DISCOVERY_PORT}`);
  });

  // Prune stale sessions every 4 s
  setInterval(() => {
    const cutoff = Date.now() - SESSION_EXPIRY_MS;
    for (const [key, s] of discoveredSessions) {
      if (s.lastSeen < cutoff) discoveredSessions.delete(key);
    }
  }, 4_000);
}

// IPC: renderer → list of active sessions
ipcMain.handle('discover-sessions', () => [...discoveredSessions.values()]);

// IPC: renderer resolves code → { ip, port } or null
ipcMain.handle('resolve-session-code', (_event, code: string) => {
  const upper = (code ?? '').toUpperCase().trim();
  for (const s of discoveredSessions.values()) {
    if (s.code === upper) return { ip: s.ip, port: s.port };
  }
  return null;
});

// ─── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'Purrmadeath',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            // ws: allows WebSocket to any IP (required for LAN play to non-localhost)
            "connect-src 'self' ws: wss:",
          ].join('; '),
        ],
      },
    });
  });

  startDiscoveryListener();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
