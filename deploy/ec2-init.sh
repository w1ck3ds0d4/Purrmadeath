#!/bin/bash
# ─── EC2 User-Data Script (Phase 1) ──────────────────────────────────────────
# Runs once on first boot (Amazon Linux 2023).
# Installs Node.js 20, creates app user, generates a deploy key.
# The repo clone happens in Phase 2 (finish-setup.sh) after you add the
# deploy key to GitHub.
# All output is logged to /var/log/user-data.log.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail
exec > >(tee /var/log/user-data.log) 2>&1

echo "=== Purrmadeath EC2 init (Phase 1) — $(date) ==="

# ── System packages ──────────────────────────────────────────────────────────

dnf update -y
dnf install -y git

# ── Node.js 20 via NodeSource ────────────────────────────────────────────────

curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

echo "Node: $(node -v)  npm: $(npm -v)"

# ── Application user ─────────────────────────────────────────────────────────

useradd -r -m -s /bin/bash purrmadeath || true

# ── Generate deploy key ──────────────────────────────────────────────────────

DEPLOY_KEY="/home/purrmadeath/.ssh/id_ed25519"

if [ ! -f "$DEPLOY_KEY" ]; then
  sudo -u purrmadeath mkdir -p /home/purrmadeath/.ssh
  sudo -u purrmadeath ssh-keygen -t ed25519 -f "$DEPLOY_KEY" -N "" -C "purrmadeath-deploy"
  chmod 700 /home/purrmadeath/.ssh
  chmod 600 "$DEPLOY_KEY"
  chmod 644 "${DEPLOY_KEY}.pub"

  # Configure SSH to use this key for github.com
  cat > /home/purrmadeath/.ssh/config <<'SSHCFG'
Host github.com
  IdentityFile ~/.ssh/id_ed25519
  StrictHostKeyChecking accept-new
SSHCFG
  chown purrmadeath:purrmadeath /home/purrmadeath/.ssh/config
  chmod 600 /home/purrmadeath/.ssh/config
fi

echo ""
echo "============================================"
echo "  DEPLOY KEY (add this to GitHub):"
echo "============================================"
cat "${DEPLOY_KEY}.pub"
echo "============================================"
echo ""

# ── Copy finish-setup script ─────────────────────────────────────────────────

cat > /opt/finish-setup.sh <<'FINISH'
#!/bin/bash
set -euo pipefail

APP_DIR=/opt/purrmadeath

echo "=== Purrmadeath finish-setup (Phase 2) ==="

# Clone repo as purrmadeath user
if [ ! -d "$APP_DIR" ]; then
  sudo -u purrmadeath git clone git@github.com:WickedSoda/Purrmadeath.git "$APP_DIR"
else
  echo "Repo already cloned, pulling latest..."
  cd "$APP_DIR"
  sudo -u purrmadeath git pull
fi

cd "$APP_DIR"
chown -R purrmadeath:purrmadeath "$APP_DIR"

# Install deps
sudo -u purrmadeath npm install --include=dev

# Install systemd service
cp deploy/purrmadeath-server.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable purrmadeath-server
systemctl start purrmadeath-server

echo "=== Purrmadeath server is running! ==="
echo "Check status: systemctl status purrmadeath-server"
FINISH

chmod +x /opt/finish-setup.sh

echo "=== Phase 1 complete — $(date) ==="
echo ""
echo "Next steps:"
echo "  1. Copy the deploy key above"
echo "  2. Add it at: https://github.com/WickedSoda/Purrmadeath/settings/keys"
echo "  3. Run: sudo /opt/finish-setup.sh"
