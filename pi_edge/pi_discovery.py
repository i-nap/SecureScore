"""
pi_edge/pi_discovery.py

UDP broadcast-based auto-discovery for Raspberry Pi branch nodes.

Pi side: broadcast SECURESCORE_HQ_DISCOVER, wait for HQ response.
HQ side: listen for broadcasts, reply with HQ URL.
"""

from __future__ import annotations

import json
import socket
import threading
import logging
from typing import Optional

from pi_edge.pi_config import (
    DISCOVERY_PORT, DISCOVERY_MESSAGE, DISCOVERY_TIMEOUT_SEC, DISCOVERY_BROADCAST
)

logger = logging.getLogger("pi_discovery")

VERSION = "1.0.0"


# ── Pi side: find HQ ─────────────────────────────────────────

def broadcast_discovery_request(
    discovery_port: int = DISCOVERY_PORT,
    timeout: float = DISCOVERY_TIMEOUT_SEC,
) -> Optional[str]:
    """
    Broadcast a discovery request on the local network.
    Returns the HQ URL string if a response is received within timeout, else None.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.settimeout(timeout)

    try:
        sock.sendto(DISCOVERY_MESSAGE, (DISCOVERY_BROADCAST, discovery_port))
        logger.info("Discovery broadcast sent on port %d", discovery_port)

        data, addr = sock.recvfrom(1024)
        response = json.loads(data.decode("utf-8"))
        hq_url = response.get("hq_url")
        if hq_url:
            logger.info("HQ discovered at %s (replied from %s)", hq_url, addr[0])
            return hq_url
    except socket.timeout:
        logger.warning("No HQ found within %.1f seconds", timeout)
    except Exception as exc:
        logger.error("Discovery error: %s", exc)
    finally:
        sock.close()

    return None


def write_discovered_env(hq_url: str, env_path: str) -> None:
    """Write the discovered HQ URL to a .env-compatible file."""
    import os
    os.makedirs(os.path.dirname(env_path) or ".", exist_ok=True)
    with open(env_path, "w") as f:
        f.write(f"HQ_URL={hq_url}\n")
    logger.info("Wrote discovered HQ_URL to %s", env_path)


# ── HQ side: respond to Pi discovery ─────────────────────────

def start_hq_discovery_listener(
    hq_url: str,
    discovery_port: int = DISCOVERY_PORT,
) -> None:
    """
    Daemon thread for HQ: listens for Pi discovery broadcasts and replies.
    Call this from hq_server.py startup in a daemon thread.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("", discovery_port))
    except OSError as exc:
        logger.warning("Cannot bind discovery port %d: %s", discovery_port, exc)
        return

    logger.info("HQ discovery listener started on UDP port %d", discovery_port)
    response_payload = json.dumps({
        "hq_url": hq_url,
        "version": VERSION,
        "service": "SecureScore HQ",
    }).encode("utf-8")

    while True:
        try:
            data, addr = sock.recvfrom(1024)
            if data == DISCOVERY_MESSAGE:
                sock.sendto(response_payload, addr)
                logger.info("Discovery reply sent to Pi at %s", addr[0])
        except Exception as exc:
            logger.debug("Discovery listener error: %s", exc)


# ── CLI entry for Pi use ──────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="SecureScore Pi HQ Discovery")
    parser.add_argument("--port", type=int, default=DISCOVERY_PORT)
    parser.add_argument("--timeout", type=float, default=DISCOVERY_TIMEOUT_SEC)
    parser.add_argument("--write-env", default="", help="Write discovered URL to this file")
    args = parser.parse_args()

    hq_url = broadcast_discovery_request(args.port, args.timeout)
    if hq_url:
        print(f"HQ_URL={hq_url}")
        if args.write_env:
            write_discovered_env(hq_url, args.write_env)
    else:
        print("HQ not found")
        exit(1)
