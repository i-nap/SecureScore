#!/bin/bash
# setup_pi.sh — One-command setup for SecureScore on Raspberry Pi 4/5
set -e

echo "======================================================="
echo "  SecureScore Bank Suite — Raspberry Pi Setup"
echo "======================================================="

# 1. System dependencies
apt-get update && apt-get install -y --no-install-recommends \
    python3-pip python3-venv libgomp1 git curl

# 2. Virtual environment
VENV=/opt/securescore/venv
mkdir -p /opt/securescore
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip
"$VENV/bin/pip" install -r /opt/securescore/requirements-pi.txt

# 3. Config directory
mkdir -p /etc/securescore

if [ ! -f /etc/securescore/pi.env ]; then
    cat > /etc/securescore/pi.env << 'EOF'
BRANCH_NAME=kathmandu
HQ_BRANCH_API_KEY=changeme
EDGE_PORT=7050
HQ_URL=
EOF
    echo "Created /etc/securescore/pi.env — please fill in HQ_BRANCH_API_KEY and BRANCH_NAME"
fi

# 4. Systemd service
cp /opt/securescore/pi_edge/securescore-pi.service /etc/systemd/system/

# 5. Create service user
if ! id -u securescore &>/dev/null; then
    useradd --system --no-create-home --shell /bin/false securescore
fi

chown -R securescore:securescore /opt/securescore

# 6. Enable + start
systemctl daemon-reload
systemctl enable securescore-pi
systemctl start securescore-pi

echo ""
echo "Setup complete. Check status with:"
echo "  systemctl status securescore-pi"
echo "  journalctl -u securescore-pi -f"
