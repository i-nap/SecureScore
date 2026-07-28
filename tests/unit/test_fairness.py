"""Unit tests for fairness checking in the FL aggregation pipeline."""
from __future__ import annotations

from dataclasses import dataclass
from statistics import mean
from typing import Optional


BRANCH_TYPE: dict[str, str] = {
    "Kathmandu": "urban",
    "Lalitpur": "urban",
    "Pokhara": "urban",
    "Bharatpur": "semi_urban",
    "Biratnagar": "semi_urban",
    "Butwal": "semi_urban",
    "Janakpur": "rural",
    "Birgunj": "rural",
    "Sarlahi": "rural",
}

FAIRNESS_THRESHOLD = 0.05  # 5 percentage points


@dataclass
class FairnessReport:
    passed: bool
    dp_gap: float
    eo_gap: float
    message: str = ""


def check_fairness(metrics_by_branch: dict[str, dict]) -> FairnessReport:
    urban = [m for b, m in metrics_by_branch.items() if BRANCH_TYPE.get(b) == "urban"]
    rural = [m for b, m in metrics_by_branch.items() if BRANCH_TYPE.get(b) == "rural"]

    if not urban or not rural:
        return FairnessReport(passed=True, dp_gap=0.0, eo_gap=0.0, message="insufficient branches")

    dp_gap = abs(
        mean(m.get("false_positive_rate", 0) for m in urban) -
        mean(m.get("false_positive_rate", 0) for m in rural)
    )
    eo_gap = abs(
        mean(m.get("true_positive_rate", 0) for m in urban) -
        mean(m.get("true_positive_rate", 0) for m in rural)
    )

    passed = dp_gap <= FAIRNESS_THRESHOLD and eo_gap <= FAIRNESS_THRESHOLD
    return FairnessReport(passed=passed, dp_gap=dp_gap, eo_gap=eo_gap)


# ── Tests ────────────────────────────────────────────────────────────────────

def test_equal_metrics_pass():
    metrics = {
        "Kathmandu": {"false_positive_rate": 0.10, "true_positive_rate": 0.85},
        "Pokhara": {"false_positive_rate": 0.10, "true_positive_rate": 0.85},
        "Sarlahi": {"false_positive_rate": 0.10, "true_positive_rate": 0.85},
        "Janakpur": {"false_positive_rate": 0.10, "true_positive_rate": 0.85},
    }
    report = check_fairness(metrics)
    assert report.passed is True
    assert report.dp_gap == 0.0
    assert report.eo_gap == 0.0


def test_small_gap_within_threshold_passes():
    # 3pp gap — within 5pp threshold
    metrics = {
        "Kathmandu": {"false_positive_rate": 0.10, "true_positive_rate": 0.85},
        "Sarlahi": {"false_positive_rate": 0.13, "true_positive_rate": 0.82},
        "Janakpur": {"false_positive_rate": 0.13, "true_positive_rate": 0.82},
    }
    report = check_fairness(metrics)
    assert report.passed is True
    assert report.dp_gap <= FAIRNESS_THRESHOLD


def test_large_dp_gap_fails():
    # 8pp gap — exceeds 5pp threshold
    metrics = {
        "Kathmandu": {"false_positive_rate": 0.10, "true_positive_rate": 0.88},
        "Pokhara": {"false_positive_rate": 0.10, "true_positive_rate": 0.88},
        "Sarlahi": {"false_positive_rate": 0.18, "true_positive_rate": 0.88},
        "Janakpur": {"false_positive_rate": 0.18, "true_positive_rate": 0.88},
    }
    report = check_fairness(metrics)
    assert report.passed is False
    assert report.dp_gap > FAIRNESS_THRESHOLD


def test_large_eo_gap_fails():
    # TPR gap of 7pp
    metrics = {
        "Kathmandu": {"false_positive_rate": 0.10, "true_positive_rate": 0.90},
        "Sarlahi": {"false_positive_rate": 0.10, "true_positive_rate": 0.83},
        "Janakpur": {"false_positive_rate": 0.10, "true_positive_rate": 0.83},
    }
    report = check_fairness(metrics)
    assert report.passed is False
    assert report.eo_gap > FAIRNESS_THRESHOLD


def test_exactly_at_threshold_passes():
    # Exactly 5pp — should pass (≤ not <)
    metrics = {
        "Kathmandu": {"false_positive_rate": 0.10, "true_positive_rate": 0.85},
        "Sarlahi": {"false_positive_rate": 0.15, "true_positive_rate": 0.85},
        "Janakpur": {"false_positive_rate": 0.15, "true_positive_rate": 0.85},
    }
    report = check_fairness(metrics)
    assert abs(report.dp_gap - 0.05) < 1e-9
    assert report.passed is True


def test_insufficient_branches_returns_passed():
    # Only urban branches — no rural to compare
    metrics = {
        "Kathmandu": {"false_positive_rate": 0.10, "true_positive_rate": 0.85},
        "Pokhara": {"false_positive_rate": 0.12, "true_positive_rate": 0.83},
    }
    report = check_fairness(metrics)
    assert report.passed is True
    assert "insufficient" in report.message


def test_missing_metrics_default_to_zero():
    # Branches with missing keys should not raise
    metrics = {
        "Kathmandu": {},
        "Sarlahi": {},
    }
    report = check_fairness(metrics)
    assert report.passed is True  # 0 gap with defaults
    assert report.dp_gap == 0.0


def test_multiple_urban_averaged():
    metrics = {
        "Kathmandu": {"false_positive_rate": 0.08, "true_positive_rate": 0.87},
        "Pokhara": {"false_positive_rate": 0.12, "true_positive_rate": 0.83},
        # Urban average FPR = 0.10
        "Sarlahi": {"false_positive_rate": 0.10, "true_positive_rate": 0.85},
        "Janakpur": {"false_positive_rate": 0.10, "true_positive_rate": 0.85},
        # Rural average FPR = 0.10 → gap = 0
    }
    report = check_fairness(metrics)
    assert report.dp_gap < 1e-9
    assert report.passed is True
