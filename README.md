# Purrmadeath

2D co-op roguelike survival - base building, procedural world, up to 4 players.

---

## Playing the Game

Download the latest installer from the [Releases](https://github.com/WickedSoda/Purrmadeath/releases) page.

- One player clicks **Host Game** to create a session and receives an invite code
- Other players enter the invite code and click **Join**
- The game automatically connects to the production server on launch - no IP entry needed

---

## Development

```bash
npm install
npm run dev        # Start Electron app + embedded local server
npm run server:dev # Start only the game server (with auto-reload)
```

The dev build connects to `localhost` automatically. To test the production server, type the server IP in the invite code field and click Join.

---

## Releasing a New Version

### 1. Build the installer

Ensure `.env.production` exists in the project root with the production server IP:

```
VITE_SERVER_IP=xx.xx.xx.xx
```

Then build:

```bash
npm run build:win
```

The installer is output to `dist/Purrmadeath Setup <version>.exe`.

### 2. Bump the version

Update `"version"` in `package.json` and `GAME_VERSION` in `shared/constants.ts` to match (e.g. `1.1.0`).

> The server uses `GAME_VERSION` to gate clients - bump both together so old clients are prompted to update.

### 3. Commit and push

```bash
git add -A
git commit -m "(release) vX.X.X"
git push
```

### 4. Create a GitHub Release

```bash
gh release create vX.X.X "dist/Purrmadeath Setup X.X.X.exe" --title "Purrmadeath vX.X.X" --notes "Release notes here"
```

Existing installs will auto-update in the background on next launch.

### 5. Deploy updated server code

SSH into the EC2 instance and pull the latest code:

```bash
ssh -i purrmadeath-key.pem ec2-user@YOUR_ELASTIC_IP
cd /opt/purrmadeath
sudo -u purrmadeath git fetch origin && sudo -u purrmadeath git reset --hard origin/main
sudo -u purrmadeath npm install --include=dev
sudo systemctl restart purrmadeath-server
sudo systemctl status purrmadeath-server
```

Or use the deploy script from your local machine (requires `purrmadeath-key.pem` in the project root):

```bash
bash deploy/deploy.sh YOUR_ELASTIC_IP
```

---

## AWS Instance Management

The game server runs on an EC2 `t3.micro` instance (`YOUR_INSTANCE_ID`) with Elastic IP `YOUR_ELASTIC_IP` in `eu-west-2`.

**The Elastic IP is free only while the instance is running.** Stop the instance when not in use to save costs - the IP stays reserved and reassociates automatically on next start.

### Start the instance

```bash
aws ec2 start-instances --instance-ids YOUR_INSTANCE_ID --region eu-west-2
```

Wait ~30 seconds, then the server starts automatically via systemd. Verify:

```bash
ssh -i purrmadeath-key.pem ec2-user@YOUR_ELASTIC_IP
sudo systemctl status purrmadeath-server
```

### Stop the instance (when not in use)

```bash
aws ec2 stop-instances --instance-ids YOUR_INSTANCE_ID --region eu-west-2
```

The Elastic IP stays allocated. The instance can be restarted at any time and the server IP will remain `YOUR_ELASTIC_IP`.

### Check instance state

```bash
aws ec2 describe-instances --instance-ids YOUR_INSTANCE_ID --region eu-west-2 --query "Reservations[0].Instances[0].State.Name"
```

### View server logs

```bash
ssh -i purrmadeath-key.pem ec2-user@YOUR_ELASTIC_IP
sudo journalctl -u purrmadeath-server -f
```

Use `-f` to follow live logs, or `-n 100` to see the last 100 lines.
