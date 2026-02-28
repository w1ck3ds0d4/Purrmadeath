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
- Progress is resumed from local save (unless you died or reset)

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
- Host can create a session and share invite link/code
- Supports up to 4 players (host + 3)

## Build

```bash
npm run build
```

## Useful Scripts

```bash
npm start
npm run start:lan
npm run multiplayer:server
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
- `F4` (or `ç`): dev console
- `F7`: export info/warn logs
- `F8`: export crash logs

## Troubleshooting

- If LAN clients cannot connect, verify host firewall allows ports `3001` and `8080`.
- If `8080` is already in use, close the old server process and restart `npm run multiplayer:server`.
