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
  };
}
