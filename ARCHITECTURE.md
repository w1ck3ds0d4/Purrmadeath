# ARCHITECTURE - Purrmadeath

Purrmadeath is a 2D top-down co-op roguelike with base building, served by a server-authoritative architecture and rendered in an Electron desktop client. This document covers the tech stack, the major components, and how data flows between them.

## Tech Stack

- **Language**: TypeScript (strict, ESM in source, CJS bundle for the embedded server).
- **Client**: Electron (`src/main/index.ts`, `src/preload/index.ts`, `src/renderer/`) + Pixi.js 8 for canvas rendering.
- **Server**: Node.js with the `ws` WebSocket library (`server/server.ts`, `server/net/ServerSocket.ts`).
- **Build**: `electron-vite` for renderer/main, `esbuild` for the bundled CJS server (`resources/server/server.cjs`), `electron-builder` for the Windows NSIS installer.
- **Tests**: Vitest, primarily on server-side systems (`server/systems/*.test.ts`).
- **Auto-update**: `electron-updater` against GitHub Releases.
- **CI/CD**: GitHub Actions builds the installer and SSH-deploys the server to EC2.
- **World generation**: `simplex-noise` for elevation/moisture biome assignment.

## High-Level Components

### 1. Embedded / Hosted Game Server (`server/`)
- `server/server.ts`: entry point. Wires `ServerSocket`, `DiscoveryBeacon`, `SessionManager`, and a fixed-rate `GameLoop`.
- `server/net/ServerSocket.ts`: `ws`-based transport. Enforces `MAX_CONNECTIONS`, per-IP cap (4 in production), 64 KB payload limit, per-client rate limit (`MAX_MESSAGES_PER_SECOND`, bypassed for localhost), heartbeat sweep, and message-type validation before dispatch.
- `server/discovery.ts`: UDP beacon broadcast for LAN session discovery on port 7778.
- `server/core/SessionManager.ts`: routes messages to the right `GameSession`, manages invite codes, UUID-based player identity, meta stats persistence, and reconnection grace.
- `server/core/GameSession.ts`: the heart. ~4000 lines orchestrating the tick loop, ECS systems, combat, waves, save/load, and snapshot/delta broadcast.
- `server/core/GameLogger.ts`: timestamped per-session log files in `logs/` (categories: ability, damage, buff, wave, save, etc.).
- `server/systems/`: the ECS systems (`CombatSystem`, `EnemySystem`, `MovementSystem`, `BuildingSystem`, `ProjectileSystem`, `CivilianSystem`, `SkillSystem`, `WaveController`, `BossSystem`, `WorldEventController`, `DayNightController`, `RespawnManager`, `SaveManager`, `CardDispenser`).
- `server/abilities/AbilityExecutor.ts`: executes activated abilities (meteor, blizzard, blood drain, sniper shot, etc.).

### 2. Shared Code (`shared/`)
- `shared/protocol.ts`: 60+ typed `MessageType` values plus payload interfaces. The single source of truth for the wire protocol.
- `shared/components/`: ECS component interfaces and the `C` enum used as component keys.
- `shared/ecs/`: isomorphic World/Entity primitives.
- `shared/constants.ts`: `GAME_VERSION`, network ports, tick rate, balance constants, building costs, rate limits.
- `shared/definitions/`: data tables (skills per class, cards, achievements, enemy variants, wave milestones, world events).
- `shared/world/`: tile registry, biome/world generation helpers.
- `shared/SaveFormat.ts`: persisted save schema (`formatVersion`, seed, wave, players, etc.).

### 3. Electron Main (`src/main/index.ts`)
- Spawns the embedded server (`tsx` in dev, forked `server.cjs` in production after extracting from asar to `userData`).
- Listens on UDP for LAN discovery beacons and exposes IPC handlers (`resolve-session-code`, `discover-sessions`).
- Runs `electron-updater` on launch in packaged builds.
- Mediates save IO via IPC handlers `get-save-slots`, `load-save`, `write-save` against `userData/saves/`.
- Sets a Content Security Policy allowing only `self`, `data:`, `blob:`, and `ws:`/`wss:`.

### 4. Renderer Client (`src/renderer/src/`)
- `game.ts`: client entry point and game loop. Owns module-level state (skills, inventory, buffs).
- `net/NetworkClient.ts`: WebSocket lifecycle and reconnection.
- `net/NetworkHandler.ts`: handlers for every inbound `MessageType`.
- `net/Reconciler.ts`: client-side prediction with replay on server correction.
- `systems/PlayerRendererSystem.ts`, `ProjectileRendererSystem.ts`, `AbilityVFXSystem.ts`, `BuildController.ts`, `DamageNumberSystem.ts`: Pixi.js rendering and build mode.
- `render/Camera.ts`, `render/BuildGhostRenderer.ts`: camera follow, screen shake, building ghost.
- `ui/`: HTML overlays (skill tree, build menu, civilian panel, lobby, menu, card picker, chat, stats, death, game over) and HUD (health, hotbar, wave, minimap, inventory).

## Data Flow

1. **Boot**: Electron main starts the embedded server (`startEmbeddedServer`) and a UDP discovery listener. The renderer process loads, connects via `NetworkClient` to `localhost:7777`, and receives `HANDSHAKE_ACK` with a clientId, server version, and optional last display name.
2. **Lobby**: the player picks Singleplayer / Host / Join. Host or Join sends `SESSION_CREATE` or `SESSION_JOIN`. `SessionManager` either spins up a new `GameSession` or attaches the player to an existing one and replies with session metadata.
3. **Game start**: host triggers `SESSION_START`. `GameSession.start()` transitions from lobby to playing, generates the world (chunked simplex noise), spawns players, and begins the tick loop.
4. **Tick (server-authoritative)**: every tick at `TICK_RATE` TPS, `GameSession.tick_()` runs all ECS systems in order (movement, combat, projectiles, enemies, buildings, civilians, world events, respawn, save), then builds a delta against the previous snapshot and broadcasts it to all connected clients.
5. **Client prediction**: input messages (`MoveUp`, `Attack`, etc.) are applied locally for instant feel via `MovementSystem`, while sequence-numbered inputs queue in the `Reconciler`. On a `DELTA` from the server, the reconciler snaps to authoritative position if the error exceeds threshold and replays unacknowledged inputs.
6. **Persistence**: saves are written to disk on each wave clear and on host exit (`server/systems/SaveManager.ts`). Local singleplayer saves go to `%AppData%/purrmadeath/saves/`; production server saves go to `/opt/purrmadeath/saves/`. Meta stats are merged into `metastats/` on run end.
7. **Auto-update**: in packaged builds, `autoUpdater` polls GitHub Releases on launch. The renderer shows a banner and calls IPC `install-update` to apply.

## Key Patterns

- **Server is truth**: damage, building placement, pickups, and ability activations are validated server-side before applying.
- **ECS**: every entity is a numeric id with components keyed by the `C` enum. Systems are stateless functions over the world.
- **Factory pattern**: server systems use `createXxx(deps) -> publicAPI` with callback injection for cross-system communication.
- **Delta sync**: full snapshots only on join; subsequent ticks send only changed entities.
- **Spatial hash** (`shared/SpatialHash.ts`): O(1) proximity for turrets, traps, laser beams, ghost vision.
- **Lazy getters**: `getProjectileRuntime = () => projectileRuntime` to break system init cycles.
- **Transport / session split**: WebSocket connection is up at startup; session identity is taken on Host or Join.

## Repo Layout

```
server/      Game server (Node.js + ws)
shared/      Code shared between client and server (protocol, components, definitions, constants)
src/main/    Electron main: window, embedded server, auto-updater, IPC, save IO
src/preload/ Electron preload (IPC bridge)
src/renderer/src/ Pixi.js client (game loop, net, UI, rendering)
scripts/     check-version.cjs, aws.mjs (AWS CLI helpers)
deploy/      EC2 deploy.sh, systemd unit, AWS setup scripts
build/       Installer icons
.github/workflows/release.yml CI/CD pipeline
```
