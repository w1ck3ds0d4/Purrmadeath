#!/bin/bash
# ─── AWS EC2 Setup Script ────────────────────────────────────────────────────
# Creates a security group, key pair, and launches an EC2 instance for
# the Purrmadeath game server.
#
# Prerequisites:
#   1. AWS CLI installed and configured (aws configure)
#   2. A default VPC in your chosen region
#
# Usage:
#   bash deploy/setup-aws.sh [region]
#   Example: bash deploy/setup-aws.sh us-east-1
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REGION="${1:-us-east-1}"
INSTANCE_TYPE="t3.micro"        # 2 vCPU, 1 GB — plenty for 4 players @ 20 TPS
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

# ── Create key pair (saves .pem locally) ─────────────────────────────────────

if aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "Key pair '$KEY_NAME' already exists — skipping creation."
else
  echo "Creating key pair '$KEY_NAME'..."
  aws ec2 create-key-pair \
    --key-name "$KEY_NAME" \
    --region "$REGION" \
    --query "KeyMaterial" \
    --output text > "${KEY_NAME}.pem"
  chmod 400 "${KEY_NAME}.pem"
  echo "Saved private key to ${KEY_NAME}.pem — keep this safe!"
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
    --description "Purrmadeath game server — SSH + WebSocket" \
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

# ── Launch instance ──────────────────────────────────────────────────────────

echo ""
echo "Launching EC2 instance..."

INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --user-data file://deploy/ec2-init.sh \
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
echo "  Purrmadeath Server Ready!"
echo "============================================"
echo "  Instance:  $INSTANCE_ID"
echo "  Public IP: $PUBLIC_IP"
echo "  Region:    $REGION"
echo ""
echo "  SSH:       ssh -i ${KEY_NAME}.pem ec2-user@${PUBLIC_IP}"
echo "  Game:      ws://${PUBLIC_IP}:7777"
echo ""
echo "  NOTE: The user-data script takes ~2-3 min to"
echo "  install Node.js and start the server."
echo "  Check progress:"
echo "    ssh -i ${KEY_NAME}.pem ec2-user@${PUBLIC_IP} 'tail -f /var/log/user-data.log'"
echo "============================================"