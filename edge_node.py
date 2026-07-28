"""
edge_node.py — Federated Learning Edge Node Service
=====================================================
Pure backend.  Zero Kivy imports.  Runs as a standalone daemon per branch.

Each edge node:
  1. Loads ONLY its own branch CSV  (data_branch_<name>.csv)
  2. Trains a *standardized* XGBoost model  (same hyper-params everywhere)
  3. Extracts model weights → serialises to JSON
  4. POSTs weights to the HQ aggregation server
  5. Polls / receives the new global-averaged model
  6. Overwrites local weights with the global model
  7. Provides SHAP-based XAI for local loan decisions
  8. Logs every step with Python logging + telemetry

Usage:
    # Run the Kathmandu edge node (one-shot train + send):
    python edge_node.py --branch kathmandu

    # Start the local Flask listener (receives global weights from HQ):
    python edge_node.py --branch kathmandu --serve

    # Full round: train → send → poll for global → overwrite → evaluate:
    python edge_node.py --branch kathmandu --full-round

    # Explain a specific customer:
    python edge_node.py --branch kathmandu --explain CUST100042
"""

import os
import sys
import ssl
import json
import time
import base64
import hashlib
import logging
import argparse
import warnings
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv
load_dotenv()  # ← secrets from .env, not hardcoded

import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix

import xgboost as xgb

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

try:
    from flask import Flask, request as flask_request, jsonify
    FLASK_AVAILABLE = True
except ImportError:
    FLASK_AVAILABLE = False

warnings.filterwarnings("ignore")

# ═══════════════════════════════════════════════════════════
#          PATHS & CONSTANTS
# ═══════════════════════════════════════════════════════════

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GENERATED_DIR = os.path.join(BASE_DIR, "generated_data")
ENRICHED_UCP_CSV = os.path.join(GENERATED_DIR, "enriched_ucp.csv")
EDGE_STATE_DIR = os.path.join(BASE_DIR, "edge_state")
os.makedirs(EDGE_STATE_DIR, exist_ok=True)

# ── Standardised model config (Task 3) ─────────────────
# Every edge node MUST use the exact same architecture so HQ can average weights.
FEDERATED_MODEL_CONFIG = {
    "n_estimators": 100,
    "max_depth": 5,
    "learning_rate": 0.1,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "reg_alpha": 0.1,
    "reg_lambda": 1.0,
    "objective": "binary:logistic",
    "eval_metric": "logloss",
    "use_label_encoder": False,
    "random_state": 42,
    "n_jobs": -1,
}

# Default HQ URL (override with --hq-url or .env)
DEFAULT_HQ_URL = os.getenv("EDGE_HQ_URL", "http://127.0.0.1:5050")

# Pre-shared API key for HQ registration — loaded from .env, NO hardcoded fallback
HQ_API_KEY = os.getenv("HQ_BRANCH_API_KEY", "")
if not HQ_API_KEY:
    print("WARNING: HQ_BRANCH_API_KEY not set in .env — registration will fail", file=sys.stderr)

# ── mTLS client cert paths (Task 2) ──────────────────────
MTLS_CA_CERT = os.getenv("MTLS_CA_CERT", "certs/ca.crt")
MTLS_BRANCH_CERT = os.getenv("MTLS_BRANCH_CERT", "")  # set per branch
MTLS_BRANCH_KEY = os.getenv("MTLS_BRANCH_KEY", "")    # set per branch

# ── Differential Privacy config (Task 3) ─────────────────
DP_EPSILON = float(os.getenv("DP_EPSILON", "1.0"))
DP_CLIP_NORM = float(os.getenv("DP_CLIP_NORM", "1.0"))

# ── RBAC role for this edge node ─────────────────────────
EDGE_ROLE = os.getenv("EDGE_ROLE", "branch_operator")

# Columns we never feed into the model
EXCLUDE_COLS = {
    "customer_id", "branch", "target", "alternative_credit_score",
    "cc_primary_card_type", "dw_primary_payment_method", "dw_primary_device",
    "gender", "property_ownership", "cc_expense_categories",
}

# Categorical columns that need label-encoding
CATEGORICAL_ENCODE = [
    "gender", "property_ownership", "cc_primary_card_type",
    "dw_primary_payment_method", "dw_primary_device",
]

# Branch type mapping
BRANCH_TYPE = {
    "Kathmandu": "urban", "Lalitpur": "urban", "Pokhara": "urban",
    "Bharatpur": "semi_urban", "Biratnagar": "semi_urban", "Butwal": "semi_urban",
    "Hetauda": "semi_urban", "Itahari": "semi_urban", "Dharan": "semi_urban",
    "Janakpur": "rural", "Birgunj": "rural", "Nepalgunj": "rural", "Sarlahi": "rural",
}

# ═══════════════════════════════════════════════════════════
#          LOGGING SETUP (Task 10)
# ═══════════════════════════════════════════════════════════

def _setup_logger(branch_name: str) -> logging.Logger:
    """One file-logger per branch, plus console output."""
    log_dir = os.path.join(BASE_DIR, "edge_logs")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, f"edge_{branch_name}.log")

    logger = logging.getLogger(f"edge.{branch_name}")
    logger.setLevel(logging.DEBUG)
    # Remove old handlers (e.g. re-runs in same process)
    logger.handlers.clear()

    fmt = logging.Formatter(
        "[%(asctime)s] %(levelname)-8s %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    return logger


# ═══════════════════════════════════════════════════════════
#          DATA INGESTION — STRICTLY LOCAL (Task 2)
# ═══════════════════════════════════════════════════════════

def load_branch_data(branch_name: str, logger: logging.Logger):
    """
    Load ONLY this branch's data.  If someone accidentally points
    to the wrong file the function raises immediately.
    """
    slug = branch_name.lower().replace(" ", "_")
    tx_path = os.path.join(GENERATED_DIR, f"data_branch_{slug}.csv")
    if not os.path.isfile(tx_path):
        logger.error("Transaction file NOT FOUND: %s", tx_path)
        raise FileNotFoundError(
            f"No transaction file for branch '{branch_name}'.  "
            f"Expected: {tx_path}\n"
            "Run  python generate_data.py  first."
        )

    tx_df = pd.read_csv(tx_path)

    # Paranoid check: every row must belong to this branch
    if "branch" in tx_df.columns:
        foreign = tx_df[tx_df["branch"].str.lower() != slug]
        if len(foreign) > 0:
            logger.error(
                "DATA INTEGRITY VIOLATION — %d rows belong to a different branch!",
                len(foreign),
            )
            raise ValueError(
                f"Loaded file contains {len(foreign)} rows for other branches.  "
                "This breaks federated isolation."
            )

    logger.info("Loaded %d transactions from %s", len(tx_df), os.path.basename(tx_path))

    # Load the enriched UCP and filter to this branch's customers only
    if not os.path.isfile(ENRICHED_UCP_CSV):
        logger.error("Enriched UCP not found: %s", ENRICHED_UCP_CSV)
        raise FileNotFoundError(ENRICHED_UCP_CSV)

    ucp = pd.read_csv(ENRICHED_UCP_CSV)
    branch_title = branch_name.title()
    ucp_local = ucp[ucp["branch"] == branch_title].copy()
    if ucp_local.empty:
        logger.warning("No UCP rows matched branch='%s'", branch_title)
    else:
        logger.info("Loaded %d UCP customers for %s", len(ucp_local), branch_title)

    # Merge transaction aggregates into UCP
    tx_agg = (
        tx_df.groupby("user_id")
        .agg(
            dw_tx_count_real=("product_amount", "count"),
            dw_total_spent_real=("product_amount", "sum"),
            dw_avg_amount_real=("product_amount", "mean"),
            dw_std_amount_real=("product_amount", "std"),
            dw_max_amount_real=("product_amount", "max"),
            dw_fee_total_real=("transaction_fee", "sum"),
            dw_cashback_total_real=("cashback", "sum"),
        )
        .reset_index()
    )
    tx_agg["dw_std_amount_real"] = tx_agg["dw_std_amount_real"].fillna(0)
    ucp_local = ucp_local.merge(
        tx_agg, left_on="customer_id", right_on="user_id", how="left",
    )
    ucp_local.drop(columns=["user_id"], errors="ignore", inplace=True)

    return ucp_local, tx_df


# ═══════════════════════════════════════════════════════════
#          PREPROCESSING
# ═══════════════════════════════════════════════════════════

def preprocess(ucp_local: pd.DataFrame, logger: logging.Logger):
    """
    Prepare X, y, feature_cols, scaler from branch-local UCP.
    Target: alternative_credit_score >= 600  →  creditworthy (1/0).
    """
    df = ucp_local.copy()
    df["target"] = (df["alternative_credit_score"] >= 600).astype(int)

    # Label-encode categoricals
    label_encoders = {}
    for col in CATEGORICAL_ENCODE:
        if col in df.columns:
            le = LabelEncoder()
            df[col] = le.fit_transform(df[col].astype(str))
            label_encoders[col] = le

    feature_cols = [
        c for c in df.columns
        if c not in EXCLUDE_COLS
        and df[c].dtype in [np.float64, np.int64, float, int]
        and df[c].notna().any()
    ]

    X = df[feature_cols].fillna(0).values
    y = df["target"].values

    scaler = StandardScaler()
    X = scaler.fit_transform(X)

    logger.info(
        "Preprocessed: %d samples, %d features, %.1f%% positive",
        len(X), len(feature_cols), y.mean() * 100,
    )
    return X, y, feature_cols, scaler, label_encoders


# ═══════════════════════════════════════════════════════════
#       TASK 4 — LOCAL TRAINING PIPELINE
# ═══════════════════════════════════════════════════════════

def train_local_model(X, y, logger: logging.Logger, existing_model=None):
    """
    Train the standardised XGBoost model on local branch data.
    If existing_model is supplied (e.g. after receiving global weights),
    it is used as the starting point (warm-start).
    Returns (model, metrics_dict).
    """
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y,
    )

    model = xgb.XGBClassifier(**FEDERATED_MODEL_CONFIG)

    # If we have an existing model (e.g. global weights), warm-start from it
    if existing_model is not None:
        model = existing_model  # already has global weights loaded
        model.fit(
            X_train, y_train,
            eval_set=[(X_test, y_test)],
            verbose=False,
        )
    else:
        model.fit(
            X_train, y_train,
            eval_set=[(X_test, y_test)],
            verbose=False,
        )

    preds = model.predict(X_test)
    acc = accuracy_score(y_test, preds)
    f1 = f1_score(y_test, preds, zero_division=0)
    cm = confusion_matrix(y_test, preds, labels=[0, 1])
    tn, fp, fn, tp = cm.ravel() if cm.size == 4 else (0, 0, 0, 0)

    metrics = {
        "accuracy": round(acc, 4),
        "f1": round(f1, 4),
        "tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp),
        "train_size": len(X_train),
        "test_size": len(X_test),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    logger.info(
        "Local training complete — Acc=%.4f  F1=%.4f  (train=%d, test=%d)",
        acc, f1, len(X_train), len(X_test),
    )
    logger.debug("Confusion matrix: TN=%d FP=%d FN=%d TP=%d", tn, fp, fn, tp)

    return model, metrics


# ═══════════════════════════════════════════════════════════
#       TASK 5 — WEIGHT EXTRACTION (The "Fingerprint")
# ═══════════════════════════════════════════════════════════

def _apply_differential_privacy(
    model: xgb.XGBClassifier,
    epsilon: float,
    clip_norm: float,
    logger: logging.Logger,
) -> tuple[xgb.XGBClassifier, float]:
    """
    Task 3 — Differential Privacy on model weights.

    Injects calibrated Gaussian noise into every leaf value of the XGBoost
    model before transmission.  This prevents Model Inversion attacks where
    an adversary reverse-engineers private customer data from the weights.

    Mechanism:
      1. Extract leaf values from every tree
      2. Clip leaf values to [-clip_norm, +clip_norm]  (L2 sensitivity bound)
      3. Add Gaussian noise ~ N(0, σ²) where σ = clip_norm / ε
      4. Write the noised leaves back into the model

    Returns (noised_model, noise_std).
    """
    if epsilon <= 0:
        logger.info("DP disabled (epsilon=%.2f) — sending raw weights", epsilon)
        return model, 0.0

    sigma = clip_norm / epsilon
    booster = model.get_booster()
    model_json = json.loads(booster.save_raw("json"))

    noised_leaves = 0
    try:
        trees = model_json["learner"]["gradient_booster"]["model"]["trees"]
        for tree in trees:
            noised_leaves += _dp_noise_tree(tree, sigma, clip_norm)
    except KeyError:
        logger.warning("Cannot parse JSON tree structure for DP — sending raw")
        return model, 0.0

    # Rebuild the booster from the noised JSON
    noised_json_str = json.dumps(model_json)
    noised_booster = xgb.Booster()
    noised_booster.load_model(bytearray(noised_json_str.encode("utf-8")))
    model.get_booster().load_model(bytearray(noised_json_str.encode("utf-8")))

    logger.info(
        "DP applied — ε=%.2f, σ=%.4f, clip=%.2f, %d leaves noised",
        epsilon, sigma, clip_norm, noised_leaves,
    )
    return model, sigma


def _dp_noise_tree(tree_node: dict, sigma: float, clip_norm: float) -> int:
    """Recursively add Gaussian noise to leaf values in an XGBoost JSON tree."""
    count = 0
    if "leaf" in tree_node:
        original = tree_node["leaf"]
        clipped = float(np.clip(original, -clip_norm, clip_norm))
        noise = float(np.random.normal(0, sigma))
        tree_node["leaf"] = clipped + noise
        count += 1
    if "children" in tree_node:
        for child in tree_node["children"]:
            count += _dp_noise_tree(child, sigma, clip_norm)
    return count


def extract_weights(
    model: xgb.XGBClassifier,
    logger: logging.Logger,
    apply_dp: bool = True,
) -> dict:
    """
    Pull the raw booster weights, apply Differential Privacy (if enabled),
    compute SHA-256 integrity hash, and serialise to JSON-safe dict.

    Security: NO pickle anywhere.  Pure base64(xgboost.save_raw()) + SHA-256.
    """
    dp_epsilon_used = 0.0
    dp_noise_std = 0.0

    if apply_dp and DP_EPSILON > 0:
        model, dp_noise_std = _apply_differential_privacy(
            model, DP_EPSILON, DP_CLIP_NORM, logger,
        )
        dp_epsilon_used = DP_EPSILON

    booster = model.get_booster()
    raw_bytes: bytes = booster.save_raw()
    encoded = base64.b64encode(raw_bytes).decode("ascii")

    # Task 1: SHA-256 integrity hash (tamper detection)
    sha256_hash = hashlib.sha256(raw_bytes).hexdigest()

    payload = {
        "format": "xgboost_raw_b64",
        "n_estimators": FEDERATED_MODEL_CONFIG["n_estimators"],
        "max_depth": FEDERATED_MODEL_CONFIG["max_depth"],
        "raw_model_b64": encoded,
        "byte_size": len(raw_bytes),
        "sha256_hash": sha256_hash,
        "dp_epsilon": dp_epsilon_used,
        "dp_noise_std": dp_noise_std,
    }

    logger.info(
        "Extracted weights: %d bytes (base64: %d chars, SHA-256: %s…, DP ε=%.2f)",
        len(raw_bytes), len(encoded), sha256_hash[:16], dp_epsilon_used,
    )
    return payload


def weights_to_bytes(payload: dict) -> bytes:
    """Decode a weight payload back to raw XGBoost bytes."""
    return base64.b64decode(payload["raw_model_b64"])


# ═══════════════════════════════════════════════════════════
#  TASK 2 — mTLS SESSION HELPER
# ═══════════════════════════════════════════════════════════

def _get_mtls_session(branch_name: str, logger: logging.Logger) -> requests.Session:
    """
    Build a requests.Session with mTLS client cert attached.
    If cert files are missing, falls back to plain HTTPS/HTTP with a warning.
    """
    session = requests.Session()

    # Resolve branch-specific cert paths
    slug = branch_name.lower().replace(" ", "_")
    cert_path = MTLS_BRANCH_CERT or f"certs/branch_{slug}.crt"
    key_path = MTLS_BRANCH_KEY or f"certs/branch_{slug}.key"
    ca_path = MTLS_CA_CERT

    if os.path.isfile(cert_path) and os.path.isfile(key_path):
        session.cert = (cert_path, key_path)
        logger.debug("mTLS client cert: %s", cert_path)
    else:
        logger.warning("mTLS cert not found (%s) — connecting without client cert", cert_path)

    if os.path.isfile(ca_path):
        session.verify = ca_path
        logger.debug("mTLS CA verify: %s", ca_path)
    else:
        # Disable SSL verify only if no CA cert (dev mode)
        session.verify = False

    return session


# ═══════════════════════════════════════════════════════════
#       TASK 6 — API CLIENT (The Sender)
# ═══════════════════════════════════════════════════════════

def register_with_hq(branch_name: str, hq_url: str, logger: logging.Logger) -> str | None:
    """
    Authenticate with HQ using the pre-shared API key.
    Returns a JWT session token, or None on failure.
    """
    if not REQUESTS_AVAILABLE:
        logger.error("'requests' library not installed")
        return None

    url = f"{hq_url}/api/register"
    body = {"branch": branch_name.title(), "api_key": HQ_API_KEY, "role": EDGE_ROLE}

    logger.info("Registering with HQ at %s …", url)
    session = _get_mtls_session(branch_name, logger)
    try:
        resp = session.post(url, json=body, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("token", "")
            logger.info("Registered with HQ - token expires %s (role=%s)", data.get("expires_at", "?"), data.get("role", "?"))
            return token
        else:
            logger.warning("Registration failed HTTP %d: %s", resp.status_code, resp.text[:200])
            return None
    except requests.ConnectionError:
        logger.error("CONNECTION FAILED to %s — is hq_server.py running?", url)
        return None
    except Exception as exc:
        logger.error("Registration failed: %s", exc)
        return None


def send_weights_to_hq(
    branch_name: str,
    weight_payload: dict,
    metrics: dict,
    hq_url: str,
    logger: logging.Logger,
    token: str | None = None,
) -> bool:
    """
    POST the local model weights + telemetry to the HQ server.
    Endpoint: POST {hq_url}/api/submit_weights
    Requires a valid JWT token from register_with_hq().
    """
    if not REQUESTS_AVAILABLE:
        logger.error("'requests' library not installed — cannot send weights")
        return False

    url = f"{hq_url}/api/submit_weights"
    body = {
        "branch": branch_name.title(),
        "branch_type": BRANCH_TYPE.get(branch_name.title(), "unknown"),
        "weights": weight_payload,
        "metrics": metrics,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    }
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    logger.info("Sending weights to HQ at %s …", url)
    session = _get_mtls_session(branch_name, logger)
    try:
        resp = session.post(url, json=body, headers=headers, timeout=30)
        if resp.status_code == 200:
            resp_data = resp.json()
            logger.info(
                "HQ accepted weights ✓  (response: %s, integrity: %s)",
                resp_data.get("status", "ok"),
                resp_data.get("integrity_check", "n/a"),
            )
            return True
        else:
            logger.warning(
                "HQ returned HTTP %d: %s", resp.status_code, resp.text[:200],
            )
            return False
    except requests.ConnectionError:
        logger.error("CONNECTION FAILED to %s — is hq_server.py running?", url)
        return False
    except Exception as exc:
        logger.error("Send failed: %s", exc)
        return False


# ═══════════════════════════════════════════════════════════
#       TASK 7a — POLL HQ FOR GLOBAL MODEL
# ═══════════════════════════════════════════════════════════

def poll_global_model(hq_url: str, logger: logging.Logger, token: str | None = None) -> dict | None:
    """
    GET the latest aggregated global model from HQ.
    Endpoint: GET {hq_url}/api/latest_model
    Returns the weight payload dict, or None if unavailable.
    """
    if not REQUESTS_AVAILABLE:
        logger.error("'requests' not installed")
        return None

    url = f"{hq_url}/api/latest_model"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    logger.info("Polling HQ for global model at %s …", url)
    session = _get_mtls_session("hq_client", logger)
    try:
        resp = session.get(url, headers=headers, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") == "ready":
                logger.info(
                    "Received global model (round %s, %d bytes)",
                    data.get("round", "?"),
                    data.get("weights", {}).get("byte_size", 0),
                )
                return data
            else:
                logger.info("HQ says no global model ready yet: %s", data.get("status"))
                return None
        else:
            logger.warning("HQ returned HTTP %d", resp.status_code)
            return None
    except requests.ConnectionError:
        logger.error("CONNECTION FAILED to %s", url)
        return None
    except Exception as exc:
        logger.error("Poll failed: %s", exc)
        return None


# ═══════════════════════════════════════════════════════════
#       TASK 7b — LOCAL FLASK LISTENER (receives pushes)
# ═══════════════════════════════════════════════════════════

_LATEST_GLOBAL: dict | None = None   # in-memory cache

def start_listener(branch_name: str, port: int, logger: logging.Logger):
    """
    Start a lightweight Flask server that HQ can push global weights to.
    Endpoint: POST /api/receive_global
    """
    if not FLASK_AVAILABLE:
        logger.error("Flask not installed — cannot start listener")
        return

    app = Flask(f"edge_{branch_name}")
    app.logger.setLevel(logging.WARNING)  # suppress Flask noise

    @app.route("/api/receive_global", methods=["POST"])
    def receive_global():
        global _LATEST_GLOBAL
        data = flask_request.get_json(force=True)
        _LATEST_GLOBAL = data
        logger.info(
            "Received PUSH of global model (round %s) from HQ",
            data.get("round", "?"),
        )
        return jsonify({"status": "accepted"}), 200

    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify({
            "branch": branch_name.title(),
            "status": "alive",
            "has_global_model": _LATEST_GLOBAL is not None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }), 200

    logger.info("Starting listener on port %d …", port)
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)


# ═══════════════════════════════════════════════════════════
#       TASK 8 — WEIGHT OVERWRITE LOGIC
# ═══════════════════════════════════════════════════════════

def apply_global_weights(
    local_model: xgb.XGBClassifier,
    global_payload: dict,
    logger: logging.Logger,
) -> xgb.XGBClassifier:
    """
    Replace the local model's booster with the global-averaged one
    received from HQ.  Returns the updated model instance.
    """
    raw_bytes = weights_to_bytes(global_payload["weights"])

    # Build a new booster from the raw bytes
    booster = xgb.Booster()
    booster.load_model(bytearray(raw_bytes))

    # Inject the booster into the sklearn-API wrapper
    local_model.get_booster().load_model(bytearray(raw_bytes))

    logger.info(
        "Local model overwritten with global weights (round %s)",
        global_payload.get("round", "?"),
    )
    return local_model


# ═══════════════════════════════════════════════════════════
#       TASK 9 — LOCALISED XAI / SHAP ENGINE
# ═══════════════════════════════════════════════════════════

def explain_customer(
    customer_id: str,
    model: xgb.XGBClassifier,
    ucp_local: pd.DataFrame,
    feature_cols: list,
    scaler: StandardScaler,
    logger: logging.Logger,
) -> dict | None:
    """
    Generate a SHAP-based explanation for a single customer's
    credit decision, using the CURRENT local model state.
    """
    if not SHAP_AVAILABLE:
        logger.error("SHAP not installed — pip install shap")
        return None

    row = ucp_local[ucp_local["customer_id"] == customer_id]
    if row.empty:
        logger.warning("Customer %s not found in local data", customer_id)
        return None

    # Encode categoricals the same way preprocess() does
    df = row.copy()
    for col in CATEGORICAL_ENCODE:
        if col in df.columns:
            df[col] = LabelEncoder().fit_transform(df[col].astype(str))

    available_cols = [c for c in feature_cols if c in df.columns]
    x = df[available_cols].fillna(0).values
    x_scaled = scaler.transform(x)

    prediction = model.predict(x_scaled)[0]
    probability = model.predict_proba(x_scaled)[0]

    # SHAP values (Tree explainer for XGBoost is fast)
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(x_scaled)

    # Build human-readable explanation
    importance = list(zip(available_cols, shap_values[0].tolist()))
    importance.sort(key=lambda t: abs(t[1]), reverse=True)

    top_n = 10
    explanation = {
        "customer_id": customer_id,
        "prediction": "creditworthy" if prediction == 1 else "not_creditworthy",
        "probability_creditworthy": round(float(probability[1]), 4),
        "probability_not_creditworthy": round(float(probability[0]), 4),
        "top_factors": [
            {"feature": feat, "shap_value": round(val, 4)}
            for feat, val in importance[:top_n]
        ],
        "model_state": "local",  # always explain from LOCAL model
        "explained_at": datetime.now(timezone.utc).isoformat(),
    }

    logger.info(
        "Explained %s → %s (prob=%.3f), top factor: %s (%.4f)",
        customer_id,
        explanation["prediction"],
        explanation["probability_creditworthy"],
        importance[0][0] if importance else "N/A",
        importance[0][1] if importance else 0,
    )
    return explanation


# ═══════════════════════════════════════════════════════════
#       FULL FEDERATED ROUND
# ═══════════════════════════════════════════════════════════

def full_round(branch_name: str, hq_url: str, logger: logging.Logger):
    """
    Execute one complete federated round:
      0. Register with HQ (auth handshake)
      1. Load local data
      2. Preprocess
      3. Train local model
      4. Extract weights
      5. Send to HQ
      6. Poll for global model
      7. Overwrite local weights
      8. Re-evaluate
    """
    logger.info("═" * 60)
    logger.info("FULL FEDERATED ROUND — Branch: %s", branch_name.title())
    logger.info("═" * 60)

    # 0. Register (auth handshake)
    token = register_with_hq(branch_name, hq_url, logger)

    # 1. Load
    ucp_local, tx_df = load_branch_data(branch_name, logger)

    # 2. Preprocess
    X, y, feature_cols, scaler, label_encoders = preprocess(ucp_local, logger)

    # 3. Train
    model, metrics = train_local_model(X, y, logger)
    logger.info("Local metrics: %s", json.dumps(metrics, indent=2))

    # 4. Extract
    weight_payload = extract_weights(model, logger)

    # 5. Send
    sent = send_weights_to_hq(branch_name, weight_payload, metrics, hq_url, logger, token=token)
    if not sent:
        logger.warning("Could not send to HQ — saving weights locally as fallback")
        fallback_path = os.path.join(
            EDGE_STATE_DIR, f"weights_{branch_name.lower()}_pending.json",
        )
        with open(fallback_path, "w") as f:
            json.dump({"branch": branch_name, "weights": weight_payload, "metrics": metrics}, f)
        logger.info("Saved pending weights to %s", fallback_path)

    # 6. Poll for global
    global_data = poll_global_model(hq_url, logger, token=token)

    # 7. Overwrite if available
    if global_data and global_data.get("weights"):
        model = apply_global_weights(model, global_data, logger)

        # 8. Re-evaluate after overwrite
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y,
        )
        preds = model.predict(X_test)
        new_acc = accuracy_score(y_test, preds)
        new_f1 = f1_score(y_test, preds, zero_division=0)
        logger.info(
            "Post-global-overwrite metrics — Acc=%.4f  F1=%.4f",
            new_acc, new_f1,
        )
    else:
        logger.info("No global model available yet — using local-only weights")

    # Save local model state to disk
    model_path = os.path.join(EDGE_STATE_DIR, f"model_{branch_name.lower()}.json")
    model.get_booster().save_model(model_path)
    logger.info("Saved local model to %s", model_path)

    # Save scaler & feature_cols for later XAI
    meta_path = os.path.join(EDGE_STATE_DIR, f"meta_{branch_name.lower()}.json")
    with open(meta_path, "w") as f:
        json.dump({
            "feature_cols": feature_cols,
            "scaler_mean": scaler.mean_.tolist(),
            "scaler_scale": scaler.scale_.tolist(),
        }, f)
    logger.info("Saved metadata to %s", meta_path)

    return model, ucp_local, feature_cols, scaler


# ═══════════════════════════════════════════════════════════
#  μGRAPHCODER — Dual-engine GNN path (optional, graceful fallback)
# ═══════════════════════════════════════════════════════════

MU_GRAPH_AVAILABLE = False
try:
    from mu_graph_coder import TopologyFingerprinter, TinyGNN, LoRAAdapter
    MU_GRAPH_AVAILABLE = True
except ImportError:
    pass  # μGraphCoder optional — XGBoost path always available

MU_GRAPH_STATE_DIR = os.path.join(EDGE_STATE_DIR, "mu_graphcoder")
os.makedirs(MU_GRAPH_STATE_DIR, exist_ok=True)


def build_topology_graph(
    ucp_local,
    tx_df,
    logger,
):
    """
    Construct the customer transaction graph and compute a topology fingerprint.

    Returns dict with keys: node_features, edge_index, edge_features,
    fingerprint_bytes, fingerprint_array, fingerprint_b64, n_nodes, n_edges, byte_size
    Returns None if μGraphCoder is not available.
    """
    if not MU_GRAPH_AVAILABLE:
        return None
    try:
        fingerprinter = TopologyFingerprinter(
            cosine_sim_threshold=float(os.getenv("MU_COSINE_THRESHOLD", "0.8")),
            temporal_window_days=int(os.getenv("MU_TEMPORAL_WINDOW_DAYS", "7")),
            max_nodes=int(os.getenv("MU_MAX_NODES", "500")),
        )
        node_features, edge_index, edge_features = fingerprinter.build_graph(
            ucp_local, tx_df
        )
        fp_array = fingerprinter.compute_fingerprint(node_features, edge_index, edge_features)
        fp_bytes = fingerprinter.fingerprint_to_bytes(fp_array)
        fp_b64 = fingerprinter.serialize_b64(fp_array)

        logger.info(
            "μGraph: N=%d nodes, E=%d edges, fingerprint=%d bytes",
            node_features.shape[0],
            edge_index.shape[1] if edge_index.ndim == 2 else 0,
            len(fp_bytes),
        )
        return {
            "node_features": node_features,
            "edge_index": edge_index,
            "edge_features": edge_features,
            "fingerprint_bytes": fp_bytes,
            "fingerprint_array": fp_array,
            "fingerprint_b64": fp_b64,
            "n_nodes": int(node_features.shape[0]),
            "n_edges": int(edge_index.shape[1]) if edge_index.ndim == 2 else 0,
            "byte_size": len(fp_bytes),
        }
    except Exception as exc:
        logger.warning("μGraphCoder graph build failed: %s", exc)
        return None


def submit_fingerprint_to_hq(
    branch_name,
    jwt_token,
    fingerprint_b64,
    graph_meta,
    hq_base_url,
    mtls_session=None,
    logger=None,
):
    """POST branch topology fingerprint to HQ μGraphCoder endpoint."""
    if logger is None:
        import logging as _log
        logger = _log.getLogger(__name__)
    try:
        import requests
        session = mtls_session or requests.Session()
        url = f"{hq_base_url.rstrip('/')}/api/mu_graphcoder/submit_fingerprint"
        payload = {
            "branch": branch_name,
            "fingerprint_b64": fingerprint_b64,
            "graph_meta": graph_meta,
        }
        headers = {"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"}
        resp = session.post(url, json=payload, headers=headers, timeout=30)
        if resp.status_code == 200:
            logger.info("μGraphCoder fingerprint submitted for branch %s", branch_name)
            return True
        logger.warning("Fingerprint submit returned %d: %s", resp.status_code, resp.text[:200])
    except Exception as exc:
        logger.warning("Fingerprint submit failed (non-blocking): %s", exc)
    return False


def poll_generated_gnn_from_hq(
    branch_name,
    jwt_token,
    hq_base_url,
    mtls_session=None,
    logger=None,
):
    """
    Poll HQ for the generated GNN code indices for this branch.
    Downloads code_indices + gnn_config, reconstructs TinyGNN, saves to disk.
    Returns True if a new GNN was saved.
    """
    if not MU_GRAPH_AVAILABLE:
        return False
    if logger is None:
        import logging as _log
        logger = _log.getLogger(__name__)
    try:
        import requests
        import json
        import torch
        from mu_graph_coder import Hypernetwork, VQCodebook, TinyGNN

        session = mtls_session or requests.Session()
        url = f"{hq_base_url.rstrip('/')}/api/mu_graphcoder/generated_gnn/{branch_name}"
        headers = {"Authorization": f"Bearer {jwt_token}"}
        resp = session.get(url, headers=headers, timeout=30)
        if resp.status_code != 200:
            logger.debug("No generated GNN available yet for %s (%d)", branch_name, resp.status_code)
            return False

        data = resp.json()
        code_indices = data.get("code_indices", [])
        gnn_config = data.get("gnn_config", {})

        if not code_indices:
            return False

        # Fetch codebook from HQ (needed once; cached locally)
        codebook_path = os.path.join(MU_GRAPH_STATE_DIR, "codebook.pt")
        if not os.path.exists(codebook_path):
            cb_url = f"{hq_base_url.rstrip('/')}/api/mu_graphcoder/codebook"
            cb_resp = session.get(cb_url, headers=headers, timeout=60)
            if cb_resp.status_code == 200:
                with open(codebook_path, "wb") as f:
                    f.write(cb_resp.content)
            else:
                logger.warning("Could not fetch codebook from HQ")
                return False

        codebook = VQCodebook.load(codebook_path)
        hn_path = os.path.join(MU_GRAPH_STATE_DIR, "hypernetwork.pt")

        if os.path.exists(hn_path):
            hn = Hypernetwork.load(hn_path)
        else:
            hn = Hypernetwork(codebook=codebook, gnn_config=gnn_config)

        gnn = hn.reconstruct_gnn(code_indices)
        gnn_path = os.path.join(MU_GRAPH_STATE_DIR, f"gnn_{branch_name.lower()}.pt")
        torch.save(gnn, gnn_path)

        # Save config alongside
        cfg_path = os.path.join(MU_GRAPH_STATE_DIR, f"gnn_config_{branch_name.lower()}.json")
        with open(cfg_path, "w") as f:
            json.dump({
                "gnn_config": gnn_config,
                "code_indices": code_indices,
                "comm_bytes": data.get("comm_bytes", 0),
                "comm_savings_ratio": data.get("comm_savings_ratio", 0),
                "version": data.get("version", 0),
            }, f, indent=2)

        logger.info(
            "μGraphCoder GNN saved for branch %s (v%d, %d bytes vs %d baseline, %.1f× savings)",
            branch_name, data.get("version", 0),
            data.get("comm_bytes", 0), data.get("full_model_bytes", 0),
            data.get("comm_savings_ratio", 0),
        )
        return True

    except Exception as exc:
        logger.warning("GNN poll failed (non-blocking): %s", exc)
        return False


def score_with_gnn(customer_id, graph_data, ucp_local, branch_name, logger):
    """
    Score a single customer using the locally cached TinyGNN.
    Returns a score dict compatible with the existing XGBoost score schema,
    or None if no GNN is available.
    """
    if not MU_GRAPH_AVAILABLE or graph_data is None:
        return None
    try:
        import torch
        gnn_path = os.path.join(MU_GRAPH_STATE_DIR, f"gnn_{branch_name.lower()}.pt")
        if not os.path.isfile(gnn_path):
            return None

        gnn = torch.load(gnn_path, map_location="cpu", weights_only=False)
        gnn.eval()

        cid_col = "customer_id" if "customer_id" in ucp_local.columns else ucp_local.columns[0]
        matches = ucp_local[ucp_local[cid_col] == customer_id]
        if len(matches) == 0:
            return None
        node_idx = ucp_local.index.get_loc(matches.index[0])

        x = torch.tensor(graph_data["node_features"], dtype=torch.float32)
        ei = torch.tensor(graph_data["edge_index"], dtype=torch.long)
        ea = torch.tensor(graph_data["edge_features"], dtype=torch.float32)

        with torch.no_grad():
            logits = gnn(x, ei, ea)
            prob_default = float(torch.sigmoid(logits[node_idx]).item())

        credit_score = round((1.0 - prob_default) * 850 + 300, 1)  # map to 300-1150 range
        return {
            "customer_id": customer_id,
            "gnn_probability_default": round(prob_default, 4),
            "gnn_credit_score": credit_score,
            "model_type": "mu_graphcoder_gnn",
            "n_nodes_in_graph": graph_data["n_nodes"],
            "fingerprint_bytes": graph_data["byte_size"],
        }
    except Exception as exc:
        logger.debug("GNN scoring failed for %s: %s", customer_id, exc)
        return None


def run_lora_adaptation(branch_name, graph_data, ucp_local, logger):
    """
    Run LoRA on-device adaptation to recover from concept drift.
    Uses the current branch data as both graph and labels.
    Returns adaptation metrics dict.
    """
    if not MU_GRAPH_AVAILABLE or graph_data is None:
        return {"available": False}
    try:
        import torch
        gnn_path = os.path.join(MU_GRAPH_STATE_DIR, f"gnn_{branch_name.lower()}.pt")
        if not os.path.isfile(gnn_path):
            return {"available": False, "reason": "No GNN cached"}

        gnn = torch.load(gnn_path, map_location="cpu", weights_only=False)

        # Prepare tensors
        x = torch.tensor(graph_data["node_features"], dtype=torch.float32)
        ei = torch.tensor(graph_data["edge_index"], dtype=torch.long)
        ea = torch.tensor(graph_data["edge_features"], dtype=torch.float32)

        # Labels from UCP alternative_credit_score threshold
        if "alternative_credit_score" in ucp_local.columns:
            scores = ucp_local["alternative_credit_score"].fillna(500).values
            labels = torch.tensor((scores >= 600).astype(float), dtype=torch.float32)
        elif "target" in ucp_local.columns:
            labels = torch.tensor(ucp_local["target"].fillna(0).values, dtype=torch.float32)
        else:
            return {"available": False, "reason": "No label column"}

        adapter = LoRAAdapter(gnn, rank=4)
        metrics = adapter.adapt(
            x, ei, ea, labels,
            n_steps=int(os.getenv("MU_LORA_STEPS", "100")),
            max_samples=100,
        )
        adapted_gnn = adapter.get_adapted_gnn(bake_weights=True)

        # Save adapted GNN
        adapted_path = os.path.join(MU_GRAPH_STATE_DIR, f"gnn_{branch_name.lower()}_adapted.pt")
        torch.save(adapted_gnn, adapted_path)

        # Also save LoRA checkpoint
        lora_path = os.path.join(MU_GRAPH_STATE_DIR, f"lora_{branch_name.lower()}.pt")
        adapter.save(lora_path)

        logger.info(
            "LoRA adaptation complete for %s: pre_f1=%.3f post_f1=%.3f recovery=%.1f%%",
            branch_name,
            metrics["pre_adapt_f1"], metrics["post_adapt_f1"], metrics["drift_recovery_pct"]
        )
        return {"available": True, **metrics}

    except Exception as exc:
        logger.warning("LoRA adaptation failed (non-blocking): %s", exc)
        return {"available": False, "error": str(exc)}


# ═══════════════════════════════════════════════════════════
#       CLI ENTRY POINT
# ═══════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="SecureScore Federated Learning — Edge Node",
    )
    parser.add_argument(
        "--branch", required=True,
        help="Branch name (e.g. kathmandu, sarlahi, pokhara)",
    )
    parser.add_argument(
        "--hq-url", default=DEFAULT_HQ_URL,
        help=f"HQ server URL (default: {DEFAULT_HQ_URL})",
    )
    parser.add_argument(
        "--serve", action="store_true",
        help="Start Flask listener to receive global model pushes",
    )
    parser.add_argument(
        "--port", type=int, default=0,
        help="Port for --serve (default: auto based on branch)",
    )
    parser.add_argument(
        "--full-round", action="store_true",
        help="Run a complete federated round (train → send → poll → overwrite)",
    )
    parser.add_argument(
        "--explain", type=str, default=None,
        help="Explain a customer ID using local SHAP (e.g. CUST100042)",
    )
    parser.add_argument(
        "--train-only", action="store_true",
        help="Just train locally and print metrics (no HQ communication)",
    )
    args = parser.parse_args()

    branch = args.branch.lower().replace(" ", "_")
    logger = _setup_logger(branch)
    logger.info("Edge node starting for branch: %s", branch.title())

    # ── Mode: Flask listener ──────────────────────────────
    if args.serve:
        # Auto-assign port from branch name hash if not specified
        port = args.port or (6000 + hash(branch) % 1000)
        start_listener(branch, port, logger)
        return

    # ── Mode: Full federated round ────────────────────────
    if args.full_round:
        model, ucp_local, feature_cols, scaler = full_round(
            branch, args.hq_url, logger,
        )

        # If --explain was also given, run XAI
        if args.explain:
            explanation = explain_customer(
                args.explain, model, ucp_local, feature_cols, scaler, logger,
            )
            if explanation:
                print(json.dumps(explanation, indent=2))
        return

    # ── Mode: Train-only (offline) ────────────────────────
    if args.train_only:
        ucp_local, tx_df = load_branch_data(branch, logger)
        X, y, feature_cols, scaler, label_encoders = preprocess(ucp_local, logger)
        model, metrics = train_local_model(X, y, logger)
        print(json.dumps(metrics, indent=2))

        # Also extract weights to show they work
        payload = extract_weights(model, logger)
        print(f"\nWeight payload: {payload['byte_size']} bytes")

        # Save model
        model_path = os.path.join(EDGE_STATE_DIR, f"model_{branch}.json")
        model.get_booster().save_model(model_path)
        logger.info("Model saved to %s", model_path)

        if args.explain:
            explanation = explain_customer(
                args.explain, model, ucp_local, feature_cols, scaler, logger,
            )
            if explanation:
                print(json.dumps(explanation, indent=2))
        return

    # ── Mode: Explain-only (needs existing model) ─────────
    if args.explain:
        model_path = os.path.join(EDGE_STATE_DIR, f"model_{branch}.json")
        meta_path = os.path.join(EDGE_STATE_DIR, f"meta_{branch}.json")
        if not os.path.isfile(model_path) or not os.path.isfile(meta_path):
            logger.error("No saved model/meta found. Run --train-only or --full-round first.")
            return

        # Load saved model
        model = xgb.XGBClassifier(**FEDERATED_MODEL_CONFIG)
        booster = xgb.Booster()
        booster.load_model(model_path)
        model.get_booster().load_model(model_path)
        # We need to fit once to set internal sklearn state
        # Load UCP for this branch
        ucp_local, _ = load_branch_data(branch, logger)

        with open(meta_path) as f:
            meta = json.load(f)
        feature_cols = meta["feature_cols"]
        scaler = StandardScaler()
        scaler.mean_ = np.array(meta["scaler_mean"])
        scaler.scale_ = np.array(meta["scaler_scale"])
        scaler.n_features_in_ = len(feature_cols)

        explanation = explain_customer(
            args.explain, model, ucp_local, feature_cols, scaler, logger,
        )
        if explanation:
            print(json.dumps(explanation, indent=2))
        return

    # ── Default: one-shot train + send ────────────────────
    token = register_with_hq(branch, args.hq_url, logger)

    ucp_local, tx_df = load_branch_data(branch, logger)
    X, y, feature_cols, scaler, label_encoders = preprocess(ucp_local, logger)
    model, metrics = train_local_model(X, y, logger)
    payload = extract_weights(model, logger)

    sent = send_weights_to_hq(branch, payload, metrics, args.hq_url, logger, token=token)
    if not sent:
        logger.warning("Failed to reach HQ. Weights saved locally.")
        fallback = os.path.join(EDGE_STATE_DIR, f"weights_{branch}_pending.json")
        with open(fallback, "w") as f:
            json.dump({"branch": branch, "weights": payload, "metrics": metrics}, f)

    # Save model + meta
    model_path = os.path.join(EDGE_STATE_DIR, f"model_{branch}.json")
    model.get_booster().save_model(model_path)
    meta_path = os.path.join(EDGE_STATE_DIR, f"meta_{branch}.json")
    with open(meta_path, "w") as f:
        json.dump({
            "feature_cols": feature_cols,
            "scaler_mean": scaler.mean_.tolist(),
            "scaler_scale": scaler.scale_.tolist(),
        }, f)
    logger.info("Done.")


if __name__ == "__main__":
    main()
