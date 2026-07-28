"""
pi_edge/pi_config.py

Raspberry Pi-specific configuration constants.
Uses fewer estimators and shallower trees to fit within Pi memory/CPU budget.
"""

from pathlib import Path

# ── Lightweight XGBoost config (Pi-optimised) ────────────────
PI_MODEL_CONFIG = {
    "n_estimators":      30,    # vs 100 on PC — ~3× faster training
    "max_depth":         3,     # vs 5 — smaller trees
    "learning_rate":     0.1,
    "subsample":         0.8,
    "colsample_bytree":  0.8,
    "objective":         "binary:logistic",
    "eval_metric":       "logloss",
    "use_label_encoder": False,
    "n_jobs":            2,     # Pi 4 has 4 cores; leave 2 for OS
    "random_state":      42,
}

# ── Network discovery ────────────────────────────────────────
DISCOVERY_PORT          = 5051
DISCOVERY_MESSAGE       = b"SECURESCORE_HQ_DISCOVER"
DISCOVERY_TIMEOUT_SEC   = 5.0
DISCOVERY_BROADCAST     = "255.255.255.255"

# ── Offline buffering ────────────────────────────────────────
OFFLINE_BUFFER_PATH = Path("/tmp/securescore/offline_weights.json")
WEIGHT_BUFFER_MAX   = 5      # keep at most 5 rounds while offline

# ── Heartbeat ────────────────────────────────────────────────
HQ_HEARTBEAT_INTERVAL = 30  # seconds

# ── Edge node defaults ────────────────────────────────────────
DEFAULT_EDGE_PORT    = 7050
DEFAULT_BRANCH_NAME  = "kathmandu"
PI_STATE_DIR         = Path("/tmp/securescore")
