# Purrmadeath

## Setup

```bash
npm install
```

## Run Modes

### Singleplayer (local)

```bash
npm start
```

- Opens the game locally at `http://localhost:3001`.

### Multiplayer (LAN host)

On the host machine:

```bash
npm run multiplayer:server
npm run start:lan
```

- Game host page runs on `http://<HOST_LAN_IP>:3001`.
- Multiplayer server runs on `ws://<HOST_LAN_IP>:8080`.

On another device in the same LAN:

- Open:
  - `http://<HOST_LAN_IP>:3001/?mp=1&mpHost=<HOST_LAN_IP>`

Example with your current host IP:

- `http://192.168.4.31:3001/?mp=1&mpHost=192.168.4.31`

## Multiplayer Notes

- `0.0.0.0` is only a bind/listen address; clients should use the host LAN IP (for example `192.168.4.31`).
- Open firewall access for TCP `3001` and `8080` on the host.
- In-game dev console (`F4` or `ç`) shows multiplayer status and LAN join hint.
