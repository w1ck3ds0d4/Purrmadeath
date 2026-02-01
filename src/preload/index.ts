import { contextBridge, ipcRenderer } from 'electron';

// The preload script runs in the renderer process but has access to Node/Electron APIs.
// Expose only the minimal safe surface via contextBridge — the renderer cannot call
// Electron APIs directly (contextIsolation: true in main).
//
// Expand this file in later phases for:
//   - File I/O (save games)
//   - Native dialogs (load/save session)
//   - IPC for server process management

contextBridge.exposeInMainWorld('electronAPI', {
  /** The OS platform string — useful for platform-specific keybinds in the UI. */
  platform: process.platform,

  /** Returns all sessions discovered via LAN UDP beacon. */
  discoverSessions: () => ipcRenderer.invoke('discover-sessions'),

  /**
   * Resolves a 4-letter session code to { ip, port } by checking the LAN
   * beacon cache in the main process. Returns null if not found.
   */
  resolveSessionCode: (code: string) => ipcRenderer.invoke('resolve-session-code', code),
});