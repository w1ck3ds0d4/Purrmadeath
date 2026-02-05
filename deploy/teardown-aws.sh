#!/bin/bash
# ─── Teardown Script ─────────────────────────────────────────────────────────
# Terminates the EC2 instance and cleans up AWS resources to stop charges.
#
# Usage:
#   bash deploy/teardown-aws.sh [region]
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REGION="${1:-us-east-1}"

echo "=== Purrmadeath AWS Teardown ==="
echo "Region: $REGION"
echo ""

# ── Find the instance ────────────────────────────────────────────────────────

INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=purrmadeath-server" "Name=instance-state-name,Values=running,stopped" \
  --region "$REGION" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text 2>/dev/null || echo "None")

if [ "$INSTANCE_ID" = "None" ] || [ "$INSTANCE_ID" = "null" ] || [ -z "$INSTANCE_ID" ]; then
  echo "No running purrmadeath-server instance found."
else
  echo "Terminating instance: $INSTANCE_ID"
  aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION" > /dev/null
  echo "Instance termination initiated."
fi

echo ""
echo "NOTE: Security group and key pair are kept for future use."
echo "To fully clean up, delete them manually:"
echo "  aws ec2 delete-key-pair --key-name purrmadeath-key --region $REGION"
echo "  aws ec2 delete-security-group --group-name purrmadeath-server-sg --region $REGION"
echo ""
echo "=== Teardown complete ==="
