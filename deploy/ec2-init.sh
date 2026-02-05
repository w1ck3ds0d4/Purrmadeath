#!/bin/bash
# ─── EC2 User-Data Script ────────────────────────────────────────────────────
# Runs once on first boot (Amazon Linux 2023).
# Installs Node.js 20, clones the repo, installs deps, and starts the server.
# All output is logged to /var/log/user-data.log.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail
exec > >(tee /var/log/user-data.log) 2>&1

echo "=== Purrmadeath EC2 init — $(date) ==="

# ── System packages ──────────────────────────────────────────────────────────

dnf update -y
dnf install -y git

# ── Node.js 20 via NodeSource ────────────────────────────────────────────────

curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

echo "Node: $(node -v)  npm: $(npm -v)"

# ── Application user ─────────────────────────────────────────────────────────

useradd -r -m -s /bin/bash purrmadeath || true

# ── Clone repository ─────────────────────────────────────────────────────────

APP_DIR=/opt/purrmadeath

if [ ! -d "$APP_DIR" ]; then
  git clone https://github.com/WickedSoda/Purrmadeath.git "$APP_DIR"
fi

cd "$APP_DIR"
chown -R purrmadeath:purrmadeath "$APP_DIR"

# ── Install deps ─────────────────────────────────────────────────────────────

sudo -u purrmadeath npm install --include=dev

# ── Install systemd service ──────────────────────────────────────────────────

cp deploy/purrmadeath-server.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable purrmadeath-server
systemctl start purrmadeath-server

echo "=== Purrmadeath server is running — $(date) ==="
