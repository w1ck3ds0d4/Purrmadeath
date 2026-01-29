# Purrmadeath

Purrmadeath is a 2D co-op survival/base-building game built with Pixi.js.
You gather resources, build defenses, fight enemies, and manage civilians.

## Requirements

- Node.js 18+ (recommended: latest LTS)
- npm 9+

## Install

```bash
npm install
```

## Run

### Singleplayer

```bash
npm start
```

- Open `http://localhost:3001`
- In the main menu, choose `Singleplayer`
- Select one of 3 save slots and choose:
  - `Start New` (overwrite that slot with a new run), or
  - `Load` (resume existing save from that slot)
- Autosave runs every 5 minutes to the selected slot

### Multiplayer (LAN)

On the host machine, run two terminals:

```bash
npm run multiplayer:server
```

```bash
npm run start:lan
```

- Open `http://<HOST_LAN_IP>:3001`
- In the main menu, choose `Multiplayer`
- Host chooses one of 3 host-save slots before starting:
  - `Start New Hosted Session` (fresh world for that slot), or
  - `Load Existing Host Save` (resume saved host checkpoint from that slot)
- Host can share invite link/code
- Supports up to 4 players (host + 3)
- Host autosaves checkpoint every 5 minutes to the selected host slot
- If all players are down, clients return to main menu (host can restart fresh or load the latest host-slot save)

## Build

```bash
npm run build
```

## Useful Scripts

```bash
npm start
npm run start:lan
npm run multiplayer:server
npm run clean:parcel
npm run build:clean
npm run multiplayer:test:sync
npm run multiplayer:test:load
npm run multiplayer:test:fault
npm run build
```

## Core Controls

- `WASD` / Arrows: move
- `LMB` / `Space`: attack
- `1` / `2`: switch weapon
- `B`: toggle build mode
- `Tab` / Mouse wheel: cycle building
- `E`: interact/harvest/revive
- `Delete` / `X`: remove selected building
- `ESC`: pause menu
- `T`: save and exit (while pause menu is open)
- `Q`: exit without save (while pause menu is open)
- `F4` (or `ç`): dev console
- `F7`: export info/warn logs
- `F8`: export crash logs

## Troubleshooting

- If LAN clients cannot connect, verify host firewall allows ports `3001` and `8080`.
- If `8080` is already in use, close the old server process and restart `npm run multiplayer:server`.
- If build fails with Parcel cache/hash errors, run `npm run build:clean`.
- If multiplayer shows a blank screen with no connection, the client will timeout after 15 seconds and log `connection_timeout` in the dev console (F4). Verify the server is running and the host/port are correct.
- If the server exits immediately on start with "invalid PORT", check that the `PORT` environment variable is a valid integer (1–65535).
- If a startup error prevents the game from loading, a red overlay will display the error message directly on the page.
