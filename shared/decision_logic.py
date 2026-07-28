"""
shared/decision_logic.py
========================
Decision utilities shared across branch + HQ services.
"""

from __future__ import annotations

from bisect import bisect_left
from typing import Iterable, Sequence


def make_decision_from_percentile(percentile: float) -> dict:
    if percentile >= 70:
        return {
            "decision": "APPROVE",
            "tier": "LOW_RISK",
            "interest_rate": 10.0,
            "loan_amount_multiplier": 1.0,
            "message": "Your loan has been approved!",
        }
    if percentile >= 50:
        return {
            "decision": "APPROVE",
            "tier": "MEDIUM_RISK",
            "interest_rate": 12.5,
            "loan_amount_multiplier": 0.8,
            "message": "Your loan has been approved (reduced amount).",
        }
    if percentile >= 30:
        return {
            "decision": "MANUAL_REVIEW",
            "tier": "HIGH_RISK",
            "interest_rate": None,
            "loan_amount_multiplier": None,
            "message": "Your application is under review. You will be contacted within 2 hours.",
        }
    return {
        "decision": "REJECT",
        "tier": "VERY_HIGH_RISK",
        "interest_rate": None,
        "loan_amount_multiplier": None,
        "message": "We cannot approve this loan. You may reapply after 6 months.",
    }


def should_reverify(immediate_percentile: float, hq_percentile: float) -> bool:
    divergence = abs(immediate_percentile - hq_percentile)
    return divergence > 15


def percentile_rank(score: float, distribution: Sequence[float] | None) -> float:
    if distribution is None:
        return float(score) * 100.0

    # Convert to list for bisect; expect distribution in ascending order.
    values = list(distribution)
    if not values:
        return float(score) * 100.0

    values.sort()
    idx = bisect_left(values, score)
    return round((idx / max(len(values), 1)) * 100.0, 4)
