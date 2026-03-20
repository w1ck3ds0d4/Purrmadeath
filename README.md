# Purrmadeath

2D co-op roguelike survival - base building, procedural world, up to 4 players.

---

## Playing the Game

Download the latest installer from the [Releases](https://github.com/WickedSoda/Purrmadeath/releases) page.

### Game Modes

- **Singleplayer** - Play offline with a local embedded server. Saves are stored locally. Works without internet.
- **Host Game** - Create an online session. Other players join with the invite code.
- **Join** - Enter an invite code or server IP to join an existing session.

### Controls

| Action | Key |
|---|---|
| Move | W A S D |
| Attack | Left Mouse Button |
| Interact / Upgrade | E |
| Sprint | Shift (hold) |
| Dodge Roll | Space |
| Ability 1 / 2 / 3 | 1 / 2 / 3 |
| Use Potion | 4 |
| Build Mode | Q |
| Rotate building | Scroll wheel (in build mode) |
| Place building | Left Mouse Button (in build mode) |
| Select building | Right Mouse Button |
| Repair building | R |
| Demolish building | X |
| Civilian Panel | C |
| Skill Tree | K |
| Chat | Enter |
| Pause / Close | Escape |
| Toggle Controls | F1 |
| Debug console | F4 |

### Buildings

Buildings are organized by category in the build menu (Q):

**Defense**: Wall, Gate, Arrow Turret, Cannon Turret, Ballista, Laser Tower, Tesla Coil, Flame Tower, Catapult, Moat, Spike Trap

**Production**: Lumbermill, Quarry, Mine, Farm, Workshop

**Military**: Training Center (trains civilians into Warrior/Ranger/Mage guards)

**Housing**: Cat House (provides housing for additional civilians)

**Utility**: Warehouse, Bridge, Light Tower, Healing Shrine, Repair Station, Teleporter Pad

**Shops**: Potion Shop, Tavern (hire hero NPCs)

Campfire is auto-placed at the start and serves as respawn point + initial housing.

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

- **F4** - Debug console with 3-column stats view: Core (FPS, entities, position), Server (wave, enemies, tick profile), Game (class, HP, kills)
- **F12** / **Ctrl+Shift+I** - Electron DevTools (dev mode only)
- **Debug commands** (type in debug console): `/spawn [n]`, `/skipwave`, `/pause`, `/give`, `/sp [n]`, `/card [id]`, `/night`, `/day`, `/time [s]`, `/mod [id]`, `/event [id]`, `/ability [id]`
- **Session logs** - Server writes timestamped logs to `logs/` directory (ability activations, damage, buffs, wave events, saves)
- **Client logs** - Production builds write startup/connection logs to `%AppData%/purrmadeath/logs/`
- **Rate monitor** - Localhost connections log average/peak message rates every 30 seconds

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
server/                    Game server (Node.js + ws)
  core/                    Core orchestration
    GameSession.ts           Session logic, tick loop, combat, waves
    GameLogger.ts            Persistent file-based session logging
    SessionManager.ts        Session management, reconnection, meta stats
  systems/                 ECS systems (combat, enemies, movement, projectiles)
  abilities/               Ability execution (AbilityExecutor.ts)
shared/                    Shared between client and server
  components/              ECS component definitions
  constants.ts             Game balance, version, building costs
  protocol.ts              WebSocket message types
  definitions/             Data definitions
    skills/                Per-class skill trees (WarriorSkills, RangerSkills, MageSkills)
    SkillDefinitions.ts    Skill types, allocation logic, buff computation
    ClassDefinitions.ts    Class stats (Warrior, Ranger, Mage)
  world/                   Tile registry, world generation
  SaveFormat.ts            Save file data structures
src/
  main/index.ts            Electron main process, embedded server, auto-updater
  preload/index.ts         Electron preload (IPC bridge)
  renderer/src/            Client (Pixi.js)
    game.ts                  Main game loop, state management
    input/                   Input manager, keybindings
    net/                     WebSocket client, message handlers, reconciliation
    systems/                 Rendering systems (players, projectiles, VFX)
    ui/                      HUD, overlays (build menu, skill tree, civilian panel)
    render/                  Camera, tile renderer, build ghost
```
