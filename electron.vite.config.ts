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
  // Force CJS output with .cjs extension so Electron can load it regardless
  // of "type": "module" in package.json (ESM preloads require sandbox:false).
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },

  // --- Renderer process (browser context - Pixi.js, game logic) ---
  renderer: {
    root: 'src/renderer',
    server: {
      // Bind to all interfaces so other machines on the LAN can open the dev server URL
      host: true,
    },
    resolve: {
      alias: {
        '@shared': resolve('shared'),
        '@client': resolve('src/renderer/src'),
      },
    },
  },
});