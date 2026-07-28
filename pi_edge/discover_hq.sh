#!/bin/bash
# discover_hq.sh — Run before pi_api.py to auto-discover HQ on the LAN.
# Writes discovered HQ_URL to /etc/securescore/discovered.env.

VENV=/opt/securescore/venv
DISCOVERED=/etc/securescore/discovered.env
PI_DISCOVERY=/opt/securescore/pi_edge/pi_discovery.py

# Only run discovery if HQ_URL is not already set
if [ -n "$HQ_URL" ]; then
    echo "HQ_URL already set: $HQ_URL — skipping discovery"
    exit 0
fi

echo "Attempting HQ auto-discovery..."
"$VENV/bin/python" "$PI_DISCOVERY" --write-env "$DISCOVERED" || {
    echo "Discovery failed — HQ_URL must be set manually in /etc/securescore/pi.env"
    exit 1
}

echo "Discovery complete: $(cat $DISCOVERED)"
