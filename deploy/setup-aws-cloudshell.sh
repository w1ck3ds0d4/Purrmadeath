#!/bin/bash
# ─── Self-contained AWS Setup (for CloudShell) ───────────────────────────────
# Paste this entire script into AWS CloudShell.
# It embeds the EC2 user-data inline so no local files are needed.
#
# Usage: paste into CloudShell (region auto-detected from your CloudShell tab)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-eu-west-2}"
INSTANCE_TYPE="t3.micro"
KEY_NAME="purrmadeath-key"
SG_NAME="purrmadeath-server-sg"
AMI_SSM_PARAM="/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"

echo "=== Purrmadeath AWS Setup ==="
echo "Region:   $REGION"
echo "Instance: $INSTANCE_TYPE"
echo ""

# ── Resolve latest Amazon Linux 2023 AMI ─────────────────────────────────────

echo "Resolving latest Amazon Linux 2023 AMI..."
AMI_ID=$(aws ssm get-parameters \
  --names "$AMI_SSM_PARAM" \
  --region "$REGION" \
  --query "Parameters[0].Value" \
  --output text)

echo "AMI: $AMI_ID"

# ── Create key pair (saves .pem to CloudShell home) ──────────────────────────

if aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "Key pair '$KEY_NAME' already exists - skipping creation."
else
  echo "Creating key pair '$KEY_NAME'..."
  aws ec2 create-key-pair \
    --key-name "$KEY_NAME" \
    --region "$REGION" \
    --query "KeyMaterial" \
    --output text > ~/"${KEY_NAME}.pem"
  chmod 400 ~/"${KEY_NAME}.pem"
  echo "Saved private key to ~/${KEY_NAME}.pem"
fi

# ── Create security group ────────────────────────────────────────────────────

EXISTING_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$SG_NAME" \
  --region "$REGION" \
  --query "SecurityGroups[0].GroupId" \
  --output text 2>/dev/null || echo "None")

if [ "$EXISTING_SG" != "None" ] && [ "$EXISTING_SG" != "null" ]; then
  SG_ID="$EXISTING_SG"
  echo "Security group '$SG_NAME' already exists: $SG_ID"
else
  echo "Creating security group '$SG_NAME'..."
  SG_ID=$(aws ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "Purrmadeath game server - SSH and WebSocket" \
    --region "$REGION" \
    --query "GroupId" \
    --output text)

  # SSH (port 22)
  aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" --region "$REGION" \
    --protocol tcp --port 22 --cidr 0.0.0.0/0

  # Game server WebSocket (port 7777)
  aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" --region "$REGION" \
    --protocol tcp --port 7777 --cidr 0.0.0.0/0

  echo "Security group created: $SG_ID (SSH + WS:7777)"
fi

# ── Write user-data script inline ────────────────────────────────────────────

cat > /tmp/purrmadeath-userdata.sh <<'USERDATA'
#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/user-data.log) 2>&1

echo "=== Purrmadeath EC2 init (Phase 1) - $(date) ==="

dnf update -y
dnf install -y git

curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

echo "Node: $(node -v)  npm: $(npm -v)"

useradd -r -m -s /bin/bash purrmadeath || true

DEPLOY_KEY="/home/purrmadeath/.ssh/id_ed25519"

if [ ! -f "$DEPLOY_KEY" ]; then
  sudo -u purrmadeath mkdir -p /home/purrmadeath/.ssh
  sudo -u purrmadeath ssh-keygen -t ed25519 -f "$DEPLOY_KEY" -N "" -C "purrmadeath-deploy"
  chmod 700 /home/purrmadeath/.ssh
  chmod 600 "$DEPLOY_KEY"
  chmod 644 "${DEPLOY_KEY}.pub"

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

cat > /opt/finish-setup.sh <<'FINISH'
#!/bin/bash
set -euo pipefail

APP_DIR=/opt/purrmadeath

echo "=== Purrmadeath finish-setup (Phase 2) ==="

if [ ! -d "$APP_DIR" ]; then
  sudo -u purrmadeath git clone git@github.com:w1ck3ds0d4/Purrmadeath.git "$APP_DIR"
else
  echo "Repo already cloned, pulling latest..."
  cd "$APP_DIR"
  sudo -u purrmadeath git pull
fi

cd "$APP_DIR"
chown -R purrmadeath:purrmadeath "$APP_DIR"

sudo -u purrmadeath npm install --include=dev

cat > /etc/systemd/system/purrmadeath-server.service <<'SVC'
[Unit]
Description=Purrmadeath Game Server
After=network.target

[Service]
Type=simple
User=purrmadeath
Group=purrmadeath
WorkingDirectory=/opt/purrmadeath
ExecStart=/usr/bin/npx tsx server/server.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal
SyslogIdentifier=purrmadeath
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/purrmadeath /tmp

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable purrmadeath-server
systemctl start purrmadeath-server

echo "=== Purrmadeath server is running! ==="
echo "Check status: systemctl status purrmadeath-server"
FINISH

chmod +x /opt/finish-setup.sh

echo "=== Phase 1 complete - $(date) ==="
echo ""
echo "Next steps:"
echo "  1. Copy the deploy key above"
echo "  2. Add it at: https://github.com/w1ck3ds0d4/Purrmadeath/settings/keys"
echo "  3. Run: sudo /opt/finish-setup.sh"
USERDATA

# ── Launch instance ──────────────────────────────────────────────────────────

echo ""
echo "Launching EC2 instance..."

INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --user-data file:///tmp/purrmadeath-userdata.sh \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=purrmadeath-server}]" \
  --region "$REGION" \
  --query "Instances[0].InstanceId" \
  --output text)

echo "Instance launched: $INSTANCE_ID"
echo "Waiting for instance to enter running state..."

aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"

# ── Get public IP ────────────────────────────────────────────────────────────

PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --region "$REGION" \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text)

echo ""
echo "============================================"
echo "  Purrmadeath Server Launched!"
echo "============================================"
echo "  Instance:  $INSTANCE_ID"
echo "  Public IP: $PUBLIC_IP"
echo "  Region:    $REGION"
echo ""
echo "  SSH into the server:"
echo "    ssh -i ~/${KEY_NAME}.pem ec2-user@${PUBLIC_IP}"
echo ""
echo "  Wait ~2-3 min for Phase 1, then:"
echo "    1. SSH in"
echo "    2. sudo cat /home/purrmadeath/.ssh/id_ed25519.pub"
echo "    3. Add that key at: https://github.com/w1ck3ds0d4/Purrmadeath/settings/keys"
echo "    4. sudo /opt/finish-setup.sh"
echo ""
echo "  Game server: ws://${PUBLIC_IP}:7777"
echo "============================================"