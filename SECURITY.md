# SECURITY - Purrmadeath

This document covers the threat model, current hardening, known limitations, and the disclosure process. Purrmadeath is a co-op game; the realistic threats are griefing, cheating, denial of service against the public server, and supply-chain risk on the client.

## Reporting a Vulnerability

Email **daniel.svs@outlook.com** with a description, reproduction steps, potential impact, and (optionally) a suggested fix. Do **not** open a public GitHub issue for security reports.

Response targets:
- Acknowledgment within 48 hours.
- Initial assessment within 5 business days.
- Fix timeline by severity: critical 24 to 72 hours, high about 1 week, medium about 2 weeks.

Out of scope: social engineering, physical attacks, DoS / DDoS at the network layer, and issues in third-party dependencies (please report those upstream).

## Threat Model

Assets to protect:
- Integrity of the public game server (`server.ts` running on EC2 in `eu-west-2`).
- Player save files and meta stats stored on disk.
- The Electron client running on a player's machine (capability isolation, code-execution surface).
- The release artifacts shipped via GitHub Releases and `electron-updater`.

Assumed adversaries:
- A malicious connected client (modified renderer or hand-rolled WebSocket attacker).
- A network attacker between client and server (LAN or internet).
- Someone tampering with local files (saves, meta stats).
- Supply-chain compromise of an `npm` dependency.

## Server Hardening

Implemented in `server/net/ServerSocket.ts` and surrounding code:
- **Hard connection cap**: refuses connections beyond `MAX_CONNECTIONS` with code 1013.
- **Per-IP cap in production**: maximum 4 concurrent connections per source IP (close code 1008).
- **Payload size limit**: `maxPayload: MAX_MESSAGE_BYTES` (64 KB) at the WebSocketServer level.
- **Per-client rate limiting**: `MAX_MESSAGES_PER_SECOND` window. Localhost and link-local IPv6 (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) are exempted to keep singleplayer responsive. Flooders are disconnected (close code 1008).
- **Heartbeat sweep**: every 30 s, clients past `HEARTBEAT_TIMEOUT_MS` since last PING are terminated. Disabled for localhost.
- **Message-type validation**: `isValidType` rejects non-string types and types longer than 64 bytes before dispatch.
- **JSON parse guard**: malformed messages are logged and dropped, never crashing the dispatch loop.
- **Server-authoritative game logic**: damage, attack arcs (~120 deg, `MELEE_RANGE`), facing-angle sanity, attack position tolerance (~80 px), downed-state guards on all actions, and building placement walkability/overlap/cost are validated server-side before applying (see `GameSession.ts` and `BuildingSystem.ts`).
- **Version gating**: `GAME_VERSION` is sent in `HANDSHAKE_ACK`; clients on the wrong version are rejected by the join flow.
- **Path safety on saves**: server `SaveManager` and `SessionManager` key files by sanitized UUIDs.

## Client Hardening (Electron)

Implemented in `src/main/index.ts`:
- **`contextIsolation: true`** and **`nodeIntegration: false`** on the `BrowserWindow`. The renderer cannot reach Node APIs directly.
- **Preload bridge** (`src/preload/index.ts`): only the explicitly exposed IPC channels are reachable from the renderer.
- **Content Security Policy** set via `session.defaultSession.webRequest.onHeadersReceived`:
  - `default-src 'self'`
  - `script-src 'self' 'unsafe-eval'` (Pixi.js requires `unsafe-eval`)
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data: blob:`
  - `connect-src 'self' ws: wss:` (so LAN play to non-localhost works)
- **Window-open handler**: external `https://` URLs are forwarded to `shell.openExternal`; everything else is denied.
- **Save IO via IPC** (`get-save-slots`, `load-save`, `write-save`): file paths are derived from sanitized player UUIDs (`/[^a-zA-Z0-9-]/g` removed) to prevent path traversal. Writes validate `formatVersion`, `seed`, `currentWave`, and slot range (1 to 3) before touching disk.
- **XSS prevention in HUD**: `CardToast` and `WaveHUD` were rewritten to use `textContent` and DOM APIs instead of `innerHTML` with server-supplied strings (Phase 9.5 hardening).

## Update and Release Integrity

- Releases are built by GitHub Actions from a tag push (`release.yml`) and published as a GitHub Release with `latest.yml`, the `.exe`, and a `.blockmap`. `electron-updater` verifies the blockmap on download.
- `electron-builder` `nsis` target is `oneClick: true` with installer-directory locked.
- Server deploys SSH into the EC2 instance using the `EC2_SSH_KEY` GitHub Secret. The deploy script `git fetch / reset --hard origin/main` then restarts the systemd unit.
- No code-signing certificate is configured; users see the Windows SmartScreen warning on first install.

## Known Limitations

- **No code signing**: installers are unsigned. SmartScreen will warn on first run.
- **Plain-text saves**: local save JSON has schema validation but no integrity check or encryption. Editing a save is trivial.
- **Achievements in singleplayer are local**: meta stats live in the client's `userData`. A determined player can edit them.
- **Anti-cheat is shallow**: server validates physics and ranges, but has no behavioral detection.
- **Single-region online play**: one EC2 instance. A targeted DoS would take it offline; rate limiting is in place but there is no upstream WAF.
- **Dependency surface**: Pixi.js, `ws`, `electron`, `electron-updater`, `simplex-noise`. Updates are manual; there is no Dependabot config in the repo.
- **Logging is local**: `GameLogger` writes to disk only; there is no remote crash or telemetry pipeline.

## Hardening Roadmap

- Code-sign the Windows installer.
- Sign or HMAC save files to detect tampering.
- Add Dependabot or Renovate for automated dependency PRs.
- Region failover or read-only fallback for the public server.
- Optional account-bound progression to reduce save-edit motivation.
