/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Production server IP (set in .env.production, undefined in dev). */
  readonly VITE_SERVER_IP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  electronAPI: {
    platform: string;
    discoverSessions: () => Promise<{ code: string; ip: string; port: number; playerCount: number; maxPlayers: number }[]>;
    resolveSessionCode: (code: string) => Promise<{ ip: string; port: number } | null>;
    onUpdateAvailable: (cb: () => void) => void;
    onUpdateDownloaded: (cb: () => void) => void;
    installUpdate: () => Promise<void>;
    // Local server
    isLocalServerReady: () => Promise<boolean>;
    onLocalServerReady: (cb: () => void) => void;
    checkForUpdates?: () => Promise<void>;
    /** Send a log message to the main process log file. */
    log: (category: string, message: string) => void;
    // Save system
    getSaveSlots: (playerId: string) => Promise<import('@shared/SaveFormat').SaveSlotInfo[]>;
    loadSave: (playerId: string, slot: number) => Promise<import('@shared/SaveFormat').SaveData | null>;
    writeSave: (playerId: string, slot: number, data: import('@shared/SaveFormat').SaveData) => Promise<boolean>;
  };
}
