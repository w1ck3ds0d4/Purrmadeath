/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Production server IP (set in .env.production, undefined in dev). */
  readonly VITE_SERVER_IP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
