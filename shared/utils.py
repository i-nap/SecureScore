"""
shared/utils.py
===============
General utility functions shared across branch + HQ services.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

import numpy as np

logger = logging.getLogger(__name__)


# ── Reference ID generation ────────────────────────────────────────────

def generate_reference_id(prefix: str = "SS") -> str:
    """Generate a short, URL-safe reference ID (e.g. SS-A3F2C1D9)."""
    uid = uuid.uuid4().hex[:8].upper()
    return f"{prefix}-{uid}"


# ── Feature engineering ────────────────────────────────────────────────

FEATURE_NAMES: List[str] = [
    "age",
    "income",
    "savings_balance",
    "transaction_count_30d",
    "loan_amount",
    "loan_tenure_months",
    "existing_emis",
    "credit_score",
    "dti_ratio",
    "employment_encoded",
]

EMPLOYMENT_MAP: Dict[str, float] = {
    "government": 1.0,
    "private": 0.8,
    "self_employed": 0.6,
    "contract": 0.5,
    "unemployed": 0.0,
    "retired": 0.4,
}


def engineer_features(application: dict) -> np.ndarray:
    """
    Convert a raw customer application dict into a fixed-length feature vector.

    Missing numeric fields default to 0. Employment is label-encoded.
    The DTI ratio is computed as (existing_emis + emi_estimate) / max(income, 1).

    Returns:
        np.ndarray of shape (len(FEATURE_NAMES),)
    """
    income = float(application.get("income", 0) or 0)
    loan_amount = float(application.get("loan_amount", 0) or 0)
    tenure = float(application.get("loan_tenure_months", 12) or 12)
    existing_emis = float(application.get("existing_emis", 0) or 0)

    emi_estimate = (loan_amount / max(tenure, 1)) * 1.05  # rough 5% interest factor
    dti = (existing_emis + emi_estimate) / max(income, 1)

    emp_str = str(application.get("employment", "")).lower().strip()
    emp_enc = EMPLOYMENT_MAP.get(emp_str, 0.5)

    features = np.array([
        float(application.get("age", 30) or 30),
        income,
        float(application.get("savings_balance", 0) or 0),
        float(application.get("transaction_count_30d", 0) or 0),
        loan_amount,
        tenure,
        existing_emis,
        float(application.get("credit_score", application.get("cibil_score", 600)) or 600),
        dti,
        emp_enc,
    ], dtype=float)

    return features


# ── Timing utilities ───────────────────────────────────────────────────

class Timer:
    """Context manager that measures elapsed wall-clock time in milliseconds."""

    def __init__(self) -> None:
        self.elapsed_ms: float = 0.0
        self._start: float = 0.0

    def __enter__(self) -> "Timer":
        self._start = time.monotonic()
        return self

    def __exit__(self, *_: Any) -> None:
        self.elapsed_ms = (time.monotonic() - self._start) * 1000.0


# ── Serialisation helpers ──────────────────────────────────────────────

class NumpyEncoder(json.JSONEncoder):
    """JSON encoder that handles numpy scalars and arrays."""

    def default(self, obj: Any) -> Any:
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


def to_json(obj: Any) -> str:
    return json.dumps(obj, cls=NumpyEncoder)


# ── Logging setup ──────────────────────────────────────────────────────

def configure_logging(level: str = "INFO") -> None:
    """Configure root logger with a consistent format."""
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )


# ── Validation helpers ─────────────────────────────────────────────────

def validate_ensemble_weights(weights: Sequence[float], tol: float = 1e-4) -> bool:
    """Return True if weights sum to 1.0 within tolerance."""
    return abs(sum(weights) - 1.0) <= tol


def clamp(value: float, lo: float, hi: float) -> float:
    """Clamp value to [lo, hi]."""
    return max(lo, min(hi, value))


# ── Nepal-specific helpers ─────────────────────────────────────────────

NEPAL_PHONE_PREFIX = "+977"


def format_phone_number(phone: str) -> str:
    """Normalise a Nepali phone number to +977XXXXXXXXXX format."""
    digits = "".join(c for c in phone if c.isdigit())
    if digits.startswith("977"):
        digits = digits[3:]
    if digits.startswith("0"):
        digits = digits[1:]
    return f"{NEPAL_PHONE_PREFIX}{digits}"


REGION_LABELS: Dict[str, str] = {
    "mountain": "Mountain Region",
    "hill": "Hill Region",
    "valley": "Kathmandu Valley",
    "plain": "Terai Plain",
    "semi_urban": "Semi-Urban",
    "urban": "Urban",
    "rural": "Rural",
}


def region_display(region_key: str) -> str:
    return REGION_LABELS.get(region_key.lower(), region_key.title())
