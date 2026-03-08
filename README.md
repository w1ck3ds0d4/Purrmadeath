# Purrmadeath

2D co-op roguelike survival - base building, procedural world, up to 4 players.

---

## Playing the Game

Download the latest installer from the [Releases](https://github.com/WickedSoda/Purrmadeath/releases) page.

- One player clicks **Host Game** to create a session and receives an invite code
- Other players enter the invite code and click **Join**
- The game automatically connects to the production server on launch - no IP entry needed

### Controls

| Action | Key |
|---|---|
| Move | W A S D / Arrow keys |
| Attack | Left Mouse Button |
| Interact / Harvest | E |
| Sprint | Shift (hold) |
| Ability 1 / 2 / 3 | 1 / 2 / 3 |
| Use Potion | Q |
| Build Mode | B |
| Rotate building | Scroll wheel (in build mode) |
| Place building | Left Mouse Button (in build mode) |
| Upgrade building | F (while selecting building) |
| Repair building | R (while selecting building) |
| Demolish building | X (while selecting building) |
| Civilian Panel | C |
| Skill Tree | K |
| Dodge Roll | Space |
| Pause / Menu | Escape |
| Debug console | F4 |

### Buildings

| Building | Cost | Description |
|---|---|---|
| Wall | Wood 5 | Blocks enemy movement |
| Gate | Wood 8, Stone 5 | Auto-opens for allies, blocks enemies |
| Bridge | Wood 5, Stone 2 | Allows walking over water |
| Moat | Stone 3 | Indestructible trench that slows enemies by 50% |
| Arrow Turret | Wood 10, Stone 5, Iron 5 | Fires arrows at nearest enemy |
| Cannon Turret | Wood 15, Stone 15, Iron 10 | Slow cannon with splash damage |
| Ballista | Stone 8, Iron 8 | Piercing bolts that hit all enemies in a line |
| Laser Tower | Stone 10, Iron 10, Diamond 1 | Continuous beam DPS |
| Tesla Coil | Stone 8, Iron 8, Diamond 1 | Zaps all enemies in range with chain lightning |
| Flame Tower | Stone 6, Iron 6 | Sprays fire in a cone |
| Catapult | Stone 15, Iron 10, Diamond 3 | Long-range heavy AOE damage |
| Spike Trap | Wood 5, Stone 5 | Damages enemies that walk over it |
| Warehouse | Wood 15, Stone 10 | Shared resource storage depot |
| Lumbermill | Wood 10 | Produces wood over time |
| Quarry | Wood 10, Stone 10 | Produces stone over time |
| Mine | Wood 15, Stone 15, Iron 5 | Produces iron and diamonds |
| Farm | Wood 10 | Produces food over time |
| Workshop | Wood 15, Iron 10, Diamond 2 | Produces weapons for training guards |
| Training Center | Wood 20, Iron 15, Diamond 3 | Trains civilians into guards (Warrior/Ranger/Mage) |
| Light Tower | Stone 8, Iron 3 | Reveals fog of war in a radius |
| Healing Shrine | Stone 10, Iron 5 | Heals nearby players and allies |
| Potion Shop | Wood 15, Stone 10, Food 5 | Brew and equip combat potions |
| Cat House | Wood 10, Stone 5 | Provides housing for additional civilians |
| Campfire | (auto-placed) | Respawn point, upgradeable, houses civilians |

---

## Development

### Prerequisites

- Node.js 20+
- npm
- Developer Mode enabled on Windows (required for electron-builder symlink extraction)

### Setup

```bash
npm install
```

### Running

```bash
npm run dev          # Start Electron app + embedded local server
npm run server:dev   # Start only the game server (with auto-reload)
```

The dev build connects to `localhost` automatically. To test the production server, type the server IP in the invite code field and click Join.

### Testing

Tests use [Vitest](https://vitest.dev/) and cover server-side systems (pathfinding, combat, enemy AI).

```bash
npm run test          # Run all tests once
npm run test:watch    # Run tests in watch mode
```

Test files live alongside their source in `server/systems/` (e.g. `Pathfinding.test.ts`, `CombatSystem.test.ts`, `EnemySystem.test.ts`). Shared test helpers are in `server/systems/__testutil.ts`.

### Debug Tools

- **F4** - Debug console with views: `/core`, `/net`, `/server`, `/all`, `/logs`, `/help`
- **F12** / **Ctrl+Shift+I** - Electron DevTools (dev mode only)
- **Debug commands** - `/spawn [n]`, `/skipwave`, `/pausewave` (type in debug console)

---

## Releasing a New Version

### Automated (GitHub Actions - recommended)

The CI/CD pipeline handles building, publishing, and server deployment automatically.

**Steps:**

1. Bump the version in both `package.json` and `GAME_VERSION` in `shared/constants.ts` (must match)
2. Commit and tag:

```bash
git add -A
git commit -m "(release) vX.X.X"
git tag vX.X.X
git push && git push --tags
```

3. The `release.yml` workflow will automatically:
   - Build the Windows installer on GitHub Actions
   - Create a GitHub Release with the installer and auto-updater files
   - SSH into the EC2 server and deploy the updated code
   - Restart the game server

**Required GitHub Secrets:**

| Secret | Description |
|---|---|
| `VITE_SERVER_IP` | Elastic IP of the EC2 instance |
| `EC2_HOST` | Same as VITE_SERVER_IP (SSH host) |
| `EC2_SSH_KEY` | Private SSH key for the `ec2-user` account |

Existing installs will auto-update in the background on next launch.

### Manual

If you need to release manually (e.g. CI is down):

#### 1. Build the installer

Ensure `.env.production` exists in the project root:

```
VITE_SERVER_IP=xx.xx.xx.xx
```

```bash
npm run build:win
```

The installer is output to `dist/Purrmadeath Setup <version>.exe`.

#### 2. Create a GitHub Release

```bash
gh release create vX.X.X "dist/Purrmadeath Setup X.X.X.exe" "dist/Purrmadeath Setup X.X.X.exe.blockmap" dist/latest.yml --title "Purrmadeath vX.X.X"
```

> `latest.yml` and `.blockmap` must be included for the auto-updater to work.

#### 3. Deploy updated server code

SSH into the EC2 instance:

```bash
ssh -i purrmadeath-key.pem ec2-user@YOUR_ELASTIC_IP
cd /opt/purrmadeath
sudo -u purrmadeath git fetch origin && sudo -u purrmadeath git reset --hard origin/main
sudo -u purrmadeath npm install --include=dev
sudo systemctl restart purrmadeath-server
sudo systemctl status purrmadeath-server
```

Or use the deploy script (requires `purrmadeath-key.pem` in the project root):

```bash
bash deploy/deploy.sh YOUR_ELASTIC_IP
```

---

## AWS Instance Management

The game server runs on an EC2 `t3.micro` instance in `eu-west-2` with an Elastic IP.

**The Elastic IP is free only while the instance is running.** Stop the instance when not in use to save costs.

### Start / Stop

```bash
# Start
aws ec2 start-instances --instance-ids YOUR_INSTANCE_ID --region eu-west-2

# Stop
aws ec2 stop-instances --instance-ids YOUR_INSTANCE_ID --region eu-west-2

# Check state
aws ec2 describe-instances --instance-ids YOUR_INSTANCE_ID --region eu-west-2 \
  --query "Reservations[0].Instances[0].State.Name"
```

### Server Management

```bash
ssh -i purrmadeath-key.pem ec2-user@YOUR_ELASTIC_IP

# Service control
sudo systemctl status purrmadeath-server
sudo systemctl restart purrmadeath-server

# View logs (live)
sudo journalctl -u purrmadeath-server -f

# View last 100 lines
sudo journalctl -u purrmadeath-server -n 100
```

### Save Data

Player saves are stored on the server at `/opt/purrmadeath/saves/` as JSON files. They persist across server restarts and redeployments. Back up this directory before wiping the instance.

---

## Project Structure

```
server/               Game server (Node.js + ws)
  GameSession.ts        Session logic, building spawn, waves, saves
  SessionManager.ts     Session management, reconnection, save persistence
  systems/              ECS systems (combat, enemies, movement, projectiles)
shared/                Shared between client and server
  components/           ECS component definitions
  constants.ts          Game balance, version, building costs
  protocol.ts           WebSocket message types
  world/                Tile registry, world generation
  SaveFormat.ts         Save file data structures
src/
  main/                Electron main process
  renderer/src/        Client (Pixi.js)
    game.ts              Main game loop, network handlers
    input/               Input manager, keybindings
    systems/             Rendering systems (players, projectiles, buildings)
    ui/                  HUD (minimap, wave timer, menus, debug)
    render/              Tile renderer, build ghost
```
