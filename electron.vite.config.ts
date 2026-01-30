import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  // --- Electron main process (Node.js context) ---
  // externalizeDepsPlugin prevents node_modules from being bundled;
  // they stay as require() calls resolved at runtime by Electron's Node.
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('shared') },
    },
  },

  // --- Preload script (bridge between main and renderer) ---
  preload: {
    plugins: [externalizeDepsPlugin()],
  },

  // --- Renderer process (browser context — Pixi.js, game logic) ---
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': resolve('shared'),
        '@client': resolve('src/renderer/src'),
      },
    },
  },
});