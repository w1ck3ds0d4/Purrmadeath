import { app, BrowserWindow, shell, session, ipcMain } from 'electron';
import { join } from 'path';
import { spawn, type ChildProcess } from 'node:child_process';
import * as dgram from 'node:dgram';
import { DISCOVERY_PORT } from '../../server/discovery';
import type { DiscoveryBeaconPayload } from '../../server/discovery';

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
      preload: join(__dirname, '../preload/index.cjs'),
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

  startEmbeddedServer();
  startDiscoveryListener();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopEmbeddedServer();
  if (process.platform !== 'darwin') app.quit();
});
