import { app, BrowserWindow, shell, session, ipcMain } from 'electron';
import { join } from 'path';
import { spawn, type ChildProcess } from 'node:child_process';
import * as dgram from 'node:dgram';
import * as fs from 'node:fs';
import { DISCOVERY_PORT } from '../../server/discovery';
import type { DiscoveryBeaconPayload } from '../../server/discovery';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;

if (!app.isPackaged) {
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
}

// ─── Embedded Game Server ─────────────────────────────────────────────────────
// Auto-start the game server so every device running the Electron app can host.
// If the port is already bound (e.g. `npm start` concurrently script), we detect
// the EADDRINUSE error and silently fall back to the existing server.

let serverProcess: ChildProcess | null = null;

function startEmbeddedServer(): void {
  const serverScript = join(__dirname, '../../server/server.ts');
  serverProcess = spawn('npx', ['tsx', serverScript], {
    shell: true,
    stdio: 'pipe',
    cwd: join(__dirname, '../..'),
  });

  serverProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[EmbeddedServer] ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg.includes('EADDRINUSE')) {
      console.log('[Main] Server port already in use, using existing server');
      serverProcess = null;
    } else if (msg) {
      console.error(`[EmbeddedServer] ${msg}`);
    }
  });

  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`[EmbeddedServer] Server exited with code ${code}`);
    }
    serverProcess = null;
  });
}

function stopEmbeddedServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
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
      // malformed packet - ignore
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

// IPC: renderer requests update install
ipcMain.handle('install-update', () => autoUpdater.quitAndInstall());

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

// ─── Save System (Electron userData) ─────────────────────────────────────────

function getSavesDir(): string {
  const dir = join(app.getPath('userData'), 'saves');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSavePath(playerId: string, slot: number): string {
  // Sanitize playerId (UUID format) to prevent path traversal
  const safe = playerId.replace(/[^a-zA-Z0-9-]/g, '');
  return join(getSavesDir(), `${safe}_slot${slot}.json`);
}

ipcMain.handle('get-save-slots', (_event, playerId: string) => {
  const slots = [];
  for (let i = 1; i <= 3; i++) {
    const path = getSavePath(playerId, i);
    if (fs.existsSync(path)) {
      try {
        const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
        slots.push({
          slot: i,
          exists: true,
          wave: data.currentWave,
          elapsedTime: data.elapsedTime,
          enemiesKilled: data.enemiesKilled,
          playerCount: data.players?.length ?? 0,
          timestamp: data.timestamp,
        });
      } catch {
        slots.push({ slot: i, exists: false });
      }
    } else {
      slots.push({ slot: i, exists: false });
    }
  }
  return slots;
});

ipcMain.handle('load-save', (_event, playerId: string, slot: number) => {
  const path = getSavePath(playerId, slot);
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
});

ipcMain.handle('write-save', (_event, playerId: string, slot: number, data: unknown) => {
  // Basic schema validation before writing to disk
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (d.formatVersion !== 1 || typeof d.seed !== 'number' || typeof d.currentWave !== 'number') return false;
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) return false;
  const path = getSavePath(playerId, slot);
  fs.writeFileSync(path, JSON.stringify(data), 'utf-8');
  return true;
});

// ─── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Purrmadeath',
    backgroundColor: '#0a0a0f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setMenuBarVisibility(false);

  win.maximize();
  win.show();

  // Enable DevTools shortcut in dev mode (F12 or Ctrl+Shift+I)
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
        win.webContents.toggleDevTools();
      }
    });
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
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

  // Dev: start local server + LAN discovery. Production: connect to remote server.
  if (!app.isPackaged) {
    startEmbeddedServer();
    startDiscoveryListener();
  } else {
    autoUpdater.on('update-available', () => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('update-available');
    });
    autoUpdater.on('update-downloaded', () => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('update-downloaded');
    });
    autoUpdater.checkForUpdates();
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!app.isPackaged) stopEmbeddedServer();
  if (process.platform !== 'darwin') app.quit();
});
