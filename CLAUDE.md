# Purrmadeath

A 2D co-op roguelike survival game (up to 4 players), Electron + PixiJS on the client, a Node/TS
server for multiplayer, shipped as a Windows desktop app via electron-builder with an
electron-updater auto-update channel. Public repo, GitHub Releases distribute installers.

## Commands

```bash
npm install
npm run dev          # electron-vite dev
npm run server:dev    # server with hot reload (nodemon + tsx)
npm run lint          # eslint src server shared
npm run typecheck     # tsc --noEmit
npm test              # vitest run
npm run build         # electron-vite build
npm run build:win     # full Windows build (version check + server bundle + electron-builder)
```

Run lint, typecheck and test before calling anything done. `build:win` is heavy: only run it when
actually cutting a release, not for a docs or small code change.

## Layout

| Path | What it is |
| --- | --- |
| `src/` | The Electron/React client (PixiJS rendering) |
| `server/` | The Node/TS multiplayer server |
| `shared/` | Types and logic shared between client and server |
| `tests/` | Vitest suite: server-side pathfinding, combat, enemy AI |
| `deploy/` | EC2 cloud deployment scripts (`npm run aws:*`) |
| `scripts/` | Build helpers, including `check-version.cjs` |
| `resources/`, `build/`, `out/` | Build output and electron-builder resources; do not read |

## Conventions

- Commits: `(type) lowercase summary` (feat, fix, chore, docs, refactor, test), no trailing
  period, no body.
- ASCII hyphens only, no em dashes or en dashes anywhere.
- Branch + PR per change; CI runs ESLint (non-blocking), a strict `tsc --noEmit`, and Vitest.
- The Dependabot Updates workflow opens most of the recent history: review patch/minor bumps,
  and treat major bumps and any security alert as a priority.

## Do not read

`node_modules/`, `build/`, `out/`, `resources/` (build artifacts and electron-builder output),
`package-lock.json`, `assets/` if it contains large binaries.
