#!/bin/bash
# ─── Deploy / Update Script ──────────────────────────────────────────────────
# Pushes the latest code to the running EC2 instance and restarts the server.
#
# Usage:
#   bash deploy/deploy.sh <server-ip>
#   Example: bash deploy/deploy.sh 54.123.45.67
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SERVER_IP="${1:?Usage: deploy.sh <server-ip>}"
KEY_FILE="purrmadeath-key.pem"
SSH_USER="ec2-user"
APP_DIR="/opt/purrmadeath"

SSH_CMD="ssh -i $KEY_FILE -o StrictHostKeyChecking=no $SSH_USER@$SERVER_IP"

echo "=== Deploying to $SERVER_IP ==="

# ── Sync code via rsync (excludes node_modules, out, etc.) ───────────────────

echo "Syncing code..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'out' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude '*.pem' \
  --exclude '.env*' \
  -e "ssh -i $KEY_FILE -o StrictHostKeyChecking=no" \
  . "$SSH_USER@$SERVER_IP:$APP_DIR/"

# ── Install deps if package.json changed ─────────────────────────────────────

echo "Installing dependencies..."
$SSH_CMD "cd $APP_DIR && sudo -u purrmadeath npm install --include=dev"

# ── Restart the server ───────────────────────────────────────────────────────

echo "Restarting game server..."
$SSH_CMD "sudo systemctl restart purrmadeath-server"

# ── Verify ───────────────────────────────────────────────────────────────────

sleep 2
echo "Checking server status..."
$SSH_CMD "sudo systemctl status purrmadeath-server --no-pager -l" || true

echo ""
echo "=== Deploy complete! Game server: ws://${SERVER_IP}:7777 ==="