"""
observability/metrics.py — Prometheus metrics for SecureScore Bank Suite.

Provides custom federated-learning metrics + FastAPI instrumentation.

Usage:
    from observability.metrics import setup_metrics, FL_METRICS
    setup_metrics(app)   # adds /metrics endpoint

    # Record events
    FL_METRICS.federated_rounds_total.inc()
    FL_METRICS.aggregation_duration.observe(3.2)
    FL_METRICS.byzantine_rejections_total.inc()
"""

from __future__ import annotations

import time
import logging
from dataclasses import dataclass
from typing import Optional

try:
    from prometheus_client import (
        Counter,
        Gauge,
        Histogram,
        Summary,
        CollectorRegistry,
        generate_latest,
        CONTENT_TYPE_LATEST,
        multiprocess,
        REGISTRY,
    )
    from prometheus_fastapi_instrumentator import Instrumentator
    PROMETHEUS_AVAILABLE = True
except ImportError:
    PROMETHEUS_AVAILABLE = False
    logging.getLogger("observability").warning(
        "prometheus_client or prometheus_fastapi_instrumentator not installed. "
        "Metrics endpoint will be unavailable. Install: pip install prometheus-client prometheus-fastapi-instrumentator"
    )

logger = logging.getLogger("observability.metrics")


@dataclass
class FederatedLearningMetrics:
    """Custom Prometheus metrics for the SecureScore federated learning system."""

    # ── Counters ──────────────────────────────────────────
    federated_rounds_total: Optional[object] = None
    weight_submissions_total: Optional[object] = None
    byzantine_rejections_total: Optional[object] = None
    auth_failures_total: Optional[object] = None
    integrity_failures_total: Optional[object] = None
    rollbacks_total: Optional[object] = None

    # ── Gauges ────────────────────────────────────────────
    active_branches_count: Optional[object] = None
    global_model_version: Optional[object] = None
    last_aggregation_timestamp: Optional[object] = None
    last_round_total_samples: Optional[object] = None
    global_model_f1_score: Optional[object] = None
    global_model_accuracy: Optional[object] = None
    dp_epsilon_used: Optional[object] = None
    branch_last_submission_timestamp: Optional[object] = None

    # ── Histograms ────────────────────────────────────────
    aggregation_duration: Optional[object] = None
    weight_payload_size_bytes: Optional[object] = None

    def __post_init__(self):
        if not PROMETHEUS_AVAILABLE:
            return
        self._init_metrics()

    def _init_metrics(self):
        self.federated_rounds_total = Counter(
            "securescore_federated_rounds_total",
            "Total number of completed federated averaging rounds",
        )
        self.weight_submissions_total = Counter(
            "securescore_weight_submissions_total",
            "Total weight submissions accepted",
            ["branch", "branch_type"],
        )
        self.byzantine_rejections_total = Counter(
            "securescore_byzantine_rejections_total",
            "Total weight submissions rejected by Byzantine fault tolerance",
            ["branch"],
        )
        self.auth_failures_total = Counter(
            "securescore_auth_failures_total",
            "Total authentication failures",
            ["reason"],
        )
        self.integrity_failures_total = Counter(
            "securescore_integrity_failures_total",
            "Total SHA-256 integrity check failures",
            ["branch"],
        )
        self.rollbacks_total = Counter(
            "securescore_rollbacks_total",
            "Total model rollbacks performed",
        )
        self.active_branches_count = Gauge(
            "securescore_active_branches_count",
            "Number of currently registered active branches",
        )
        self.global_model_version = Gauge(
            "securescore_global_model_version",
            "Current active global model version number",
        )
        self.last_aggregation_timestamp = Gauge(
            "securescore_last_aggregation_timestamp",
            "Unix timestamp of the last successful aggregation",
        )
        self.last_round_total_samples = Gauge(
            "securescore_last_round_total_samples",
            "Total training samples used in the last federated round",
        )
        self.global_model_f1_score = Gauge(
            "securescore_global_model_f1_score",
            "Weighted-average F1 score of the last global model",
        )
        self.global_model_accuracy = Gauge(
            "securescore_global_model_accuracy",
            "Weighted-average accuracy of the last global model",
        )
        self.dp_epsilon_used = Gauge(
            "securescore_dp_epsilon_used",
            "Differential Privacy epsilon budget used in last submission",
            ["branch"],
        )
        self.branch_last_submission_timestamp = Gauge(
            "securescore_branch_last_submission_timestamp",
            "Unix timestamp of last weight submission per branch",
            ["branch"],
        )
        self.aggregation_duration = Histogram(
            "securescore_aggregation_duration_seconds",
            "Time taken to complete one FedAvg aggregation round",
            buckets=[0.5, 1, 2, 5, 10, 20, 30, 60, 120],
        )
        self.weight_payload_size_bytes = Histogram(
            "securescore_weight_payload_bytes",
            "Size of weight payloads received",
            buckets=[1024, 10240, 102400, 1048576, 5242880, 10485760, 52428800],
        )

    # ── Convenience recording methods ─────────────────────

    def record_submission(self, branch: str, branch_type: str, dp_epsilon: float, payload_bytes: int):
        if not PROMETHEUS_AVAILABLE:
            return
        self.weight_submissions_total.labels(branch=branch, branch_type=branch_type).inc()
        self.branch_last_submission_timestamp.labels(branch=branch).set(time.time())
        self.dp_epsilon_used.labels(branch=branch).set(dp_epsilon)
        self.weight_payload_size_bytes.observe(payload_bytes)

    def record_aggregation(self, version: int, duration_s: float, total_samples: int,
                            avg_f1: float, avg_accuracy: float, n_branches: int):
        if not PROMETHEUS_AVAILABLE:
            return
        self.federated_rounds_total.inc()
        self.global_model_version.set(version)
        self.last_aggregation_timestamp.set(time.time())
        self.last_round_total_samples.set(total_samples)
        self.global_model_f1_score.set(avg_f1)
        self.global_model_accuracy.set(avg_accuracy)
        self.active_branches_count.set(n_branches)
        self.aggregation_duration.observe(duration_s)

    def record_byzantine_rejection(self, branch: str):
        if not PROMETHEUS_AVAILABLE:
            return
        self.byzantine_rejections_total.labels(branch=branch).inc()

    def record_auth_failure(self, reason: str = "invalid_credentials"):
        if not PROMETHEUS_AVAILABLE:
            return
        self.auth_failures_total.labels(reason=reason).inc()

    def record_rollback(self):
        if not PROMETHEUS_AVAILABLE:
            return
        self.rollbacks_total.inc()


# Singleton instance
FL_METRICS = FederatedLearningMetrics()


def setup_metrics(app):
    """
    Attach Prometheus instrumentation to a FastAPI app.
    Adds /metrics endpoint with HTTP request metrics + custom FL metrics.
    """
    if not PROMETHEUS_AVAILABLE:
        logger.warning("Prometheus not available — skipping metrics setup")
        return

    # FastAPI HTTP instrumentation (request count, duration, status codes)
    Instrumentator(
        should_group_status_codes=False,
        should_ignore_untemplated=True,
        should_respect_env_var=False,
        should_instrument_requests_inprogress=True,
        excluded_handlers=["/metrics", "/api/health"],
        inprogress_name="http_requests_inprogress",
        inprogress_labels=True,
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

    logger.info("Prometheus metrics endpoint registered at /metrics")
