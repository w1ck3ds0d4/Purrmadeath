import { app, BrowserWindow, shell, session } from 'electron';
import { join } from 'path';

// Only suppress Chromium sandbox warnings in dev — never in packaged builds.
if (!app.isPackaged) {
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'Purrmadeath',
    backgroundColor: '#0a0a0f', // matches CSS body background, avoids white flash
    webPreferences: {
      // Preload runs in the renderer but has access to Node APIs.
      // It bridges safe APIs to the game via contextBridge.
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,  // never expose Node directly to renderer
      contextIsolation: true,  // isolate preload from renderer JS context
    },
  });

  // electron-vite sets ELECTRON_RENDERER_URL in dev mode (points to Vite dev server)
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Only open https:// links in the system browser.
  // Blocking file://, javascript:, and other schemes prevents the renderer
  // from triggering unintended local file access or code execution.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' }; // always deny Electron from opening a new window
  });
}

app.whenReady().then(() => {
  // Apply a Content-Security-Policy to all renderer responses.
  // Restricts what content the renderer can load, mitigating XSS impact.
  // 'unsafe-eval' is required by Vite and Pixi.js in dev; tighten for prod if needed.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self' 'unsafe-eval'",   // Vite HMR + Pixi.js WebGL shaders
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",          // Pixi.js uses blob: for textures
            "connect-src 'self' ws://localhost:*", // WebSocket to local game server
          ].join('; '),
        ],
      },
    });
  });

  createWindow();

  // macOS: re-create the window when the dock icon is clicked with no windows open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
