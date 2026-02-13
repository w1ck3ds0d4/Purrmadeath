import { contextBridge, ipcRenderer } from 'electron';

// The preload script runs in the renderer process but has access to Node/Electron APIs.
// Expose only the minimal safe surface via contextBridge - the renderer cannot call
// Electron APIs directly (contextIsolation: true in main).
//
// Expand this file in later phases for:
//   - File I/O (save games)
//   - Native dialogs (load/save session)
//   - IPC for server process management

contextBridge.exposeInMainWorld('electronAPI', {
  /** The OS platform string - useful for platform-specific keybinds in the UI. */
  platform: process.platform,

  /** Returns all sessions discovered via LAN UDP beacon. */
  discoverSessions: () => ipcRenderer.invoke('discover-sessions'),

  /**
   * Resolves a 4-letter session code to { ip, port } by checking the LAN
   * beacon cache in the main process. Returns null if not found.
   */
  resolveSessionCode: (code: string) => ipcRenderer.invoke('resolve-session-code', code),

  /** Calls back when a new update is available and downloading. */
  onUpdateAvailable: (cb: () => void) => ipcRenderer.on('update-available', cb),

  /** Calls back when the update has been downloaded and is ready to install. */
  onUpdateDownloaded: (cb: () => void) => ipcRenderer.on('update-downloaded', cb),

  /** Quits the app and installs the downloaded update. */
  installUpdate: () => ipcRenderer.invoke('install-update'),
});