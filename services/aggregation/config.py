from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BRANCH_API_KEY = os.getenv("HQ_BRANCH_API_KEY")
if not BRANCH_API_KEY:
    print("FATAL: HQ_BRANCH_API_KEY not set", file=sys.stderr)
    sys.exit(1)

JWT_SECRET = os.getenv("HQ_SECRET_KEY")
if not JWT_SECRET:
    print("FATAL: HQ_SECRET_KEY not set", file=sys.stderr)
    sys.exit(1)

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_SECONDS = int(os.getenv("JWT_EXPIRY_SECONDS", "900"))

DP_EPSILON = float(os.getenv("DP_EPSILON", "1.0"))
DP_CLIP_NORM = float(os.getenv("DP_CLIP_NORM", "1.0"))

RATE_LIMIT_SUBMIT = os.getenv("RATE_LIMIT_SUBMIT", "10/minute")

MAX_PAYLOAD_BYTES = 50 * 1024 * 1024
MAX_BASE64_CHARS = 40 * 1024 * 1024

EXPECTED_N_ESTIMATORS = int(os.getenv("EXPECTED_N_ESTIMATORS", "100"))
EXPECTED_MAX_DEPTH = int(os.getenv("EXPECTED_MAX_DEPTH", "5"))

MIN_NODES = int(os.getenv("MIN_NODES", "3"))
BYZANTINE_SIGMA = float(os.getenv("HQ_BYZANTINE_SIGMA", "2.0"))
FAIRNESS_THRESHOLD = float(os.getenv("FAIRNESS_THRESHOLD", "0.05"))

BASE_DIR = Path(__file__).resolve().parent.parent.parent
HQ_STATE_DIR = BASE_DIR / "hq_state"
MODEL_REGISTRY_DIR = HQ_STATE_DIR / "registry"
HQ_STATE_DIR.mkdir(exist_ok=True)
MODEL_REGISTRY_DIR.mkdir(exist_ok=True)

BRANCH_TYPE: dict[str, str] = {
    "Kathmandu": "urban", "Lalitpur": "urban", "Pokhara": "urban",
    "Bharatpur": "semi_urban", "Biratnagar": "semi_urban", "Butwal": "semi_urban",
    "Hetauda": "semi_urban", "Itahari": "semi_urban", "Dharan": "semi_urban",
    "Janakpur": "rural", "Birgunj": "rural", "Nepalgunj": "rural", "Sarlahi": "rural",
}
ALL_BRANCHES = list(BRANCH_TYPE.keys())
