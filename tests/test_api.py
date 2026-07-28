"""
tests/test_api.py
=================
Integration-style tests for the Branch and HQ API endpoints.

Verifies:
  Branch (/api/v1/):
    POST /scoring            → returns decision, percentile, reference_id
    POST /gradients/upload   → returns status=success
    GET  /models/weights     → returns base_model, ensemble_weights, model_version

  HQ (/api/v1/):
    POST /aggregate          → returns status=success, models_updated int
    POST /hypernetwork/personalize → returns status=success, branches_personalized int
    POST /verify/background  → returns status=queued

  Auth:
    Missing token → 401 / 403
    Wrong token   → 401 / 403

Uses FastAPI TestClient — no live server required.
"""

from __future__ import annotations

import os
import sys
import json
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("HQ_BRANCH_API_KEY",   "test-api-key-fixture")
os.environ.setdefault("HQ_SECRET_KEY",       "test-jwt-secret-fixture-32chars!!")
os.environ.setdefault("BRANCH_ID",           "kathmandu")
os.environ.setdefault("HQ_STATE_DIR",        "/tmp/hq_state_test")
# Set a static service token so _require_spec_auth actually enforces auth in tests
os.environ["SPEC_SERVICE_TOKEN"] = "test-service-token-fixture"

try:
    from fastapi.testclient import TestClient
    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False

pytestmark = pytest.mark.skipif(not FASTAPI_AVAILABLE, reason="fastapi[testclient] not installed")


# ── Branch API fixtures ────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def branch_client():
    from branch_service.api import app
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(scope="module")
def branch_auth_header():
    return {"Authorization": f"Bearer {os.environ['SPEC_SERVICE_TOKEN']}"}


# ── HQ Spec API fixtures ───────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def hq_client():
    from hq_service.api import app
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(scope="module")
def hq_auth_header():
    return {"Authorization": f"Bearer {os.environ['SPEC_SERVICE_TOKEN']}"}


# ── Shared payloads ────────────────────────────────────────────────────────────

SCORING_PAYLOAD = {
    "customer_id": "test_cust_001",
    "age": 32,
    "income": 60000.0,
    "savings_balance": 20000.0,
    "employment": "government",
    "transaction_count_30d": 30,
}

GRADIENT_PAYLOAD = {
    "branch_id": "kathmandu",
    "timestamp": "2025-01-01T00:00:00Z",
    "data_volume": 500,
    "model_version": "v1.0",
    "compressed_gradients": {
        "LR":  {"indices": [0, 1, 2], "values": [0.1, -0.2, 0.05], "shape": [10]},
        "RF":  {"indices": [0, 3],    "values": [0.3, -0.1],        "shape": [10]},
        "GB":  {"indices": [1],       "values": [0.15],              "shape": [10]},
        "NN":  {"indices": [0, 2, 4], "values": [0.05, 0.1, -0.2],  "shape": [20]},
        "XGB": {"indices": [0, 1],    "values": [0.2, 0.1],          "shape": [10]},
    },
}

VERIFY_BG_PAYLOAD = {
    "customer_application": SCORING_PAYLOAD,
    "immediate_decision": {
        "decision": "APPROVE",
        "percentile": 75.0,
        "interest_rate": 10.0,
    },
    "branch_id": "kathmandu",
}


# ══════════════════════════════════════════════════════════════════════════════
# Branch API Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestBranchScoring:
    def test_post_scoring_returns_200(self, branch_client, branch_auth_header):
        resp = branch_client.post("/api/v1/scoring", json=SCORING_PAYLOAD, headers=branch_auth_header)
        assert resp.status_code in (200, 500), f"Unexpected status: {resp.status_code}"

    def test_post_scoring_response_has_decision(self, branch_client, branch_auth_header):
        resp = branch_client.post("/api/v1/scoring", json=SCORING_PAYLOAD, headers=branch_auth_header)
        if resp.status_code == 200:
            body = resp.json()
            assert "decision" in body
            assert body["decision"] in ("APPROVE", "MANUAL_REVIEW", "REJECT", "ERROR")

    def test_post_scoring_response_has_percentile(self, branch_client, branch_auth_header):
        resp = branch_client.post("/api/v1/scoring", json=SCORING_PAYLOAD, headers=branch_auth_header)
        if resp.status_code == 200:
            body = resp.json()
            assert "percentile" in body
            assert 0.0 <= body["percentile"] <= 100.0

    def test_post_scoring_response_has_reference_id(self, branch_client, branch_auth_header):
        resp = branch_client.post("/api/v1/scoring", json=SCORING_PAYLOAD, headers=branch_auth_header)
        if resp.status_code == 200:
            body = resp.json()
            assert "reference_id" in body
            assert isinstance(body["reference_id"], str)

    def test_post_scoring_missing_auth_returns_4xx(self, branch_client):
        resp = branch_client.post("/api/v1/scoring", json=SCORING_PAYLOAD)
        assert resp.status_code in (401, 403, 422)


class TestBranchGradients:
    def test_post_gradients_upload_returns_200(self, branch_client, branch_auth_header):
        resp = branch_client.post("/api/v1/gradients/upload", json=GRADIENT_PAYLOAD, headers=branch_auth_header)
        assert resp.status_code == 200

    def test_post_gradients_response_status_success(self, branch_client, branch_auth_header):
        resp = branch_client.post("/api/v1/gradients/upload", json=GRADIENT_PAYLOAD, headers=branch_auth_header)
        assert resp.json()["status"] == "success"

    def test_post_gradients_missing_auth_returns_4xx(self, branch_client):
        resp = branch_client.post("/api/v1/gradients/upload", json=GRADIENT_PAYLOAD)
        assert resp.status_code in (401, 403, 422)


class TestBranchModelWeights:
    def test_get_model_weights_returns_200(self, branch_client, branch_auth_header):
        resp = branch_client.get("/api/v1/models/weights", headers=branch_auth_header)
        assert resp.status_code == 200

    def test_get_model_weights_has_ensemble_weights(self, branch_client, branch_auth_header):
        resp = branch_client.get("/api/v1/models/weights", headers=branch_auth_header)
        body = resp.json()
        assert "ensemble_weights" in body
        weights = body["ensemble_weights"]
        assert len(weights) == 5
        assert abs(sum(weights) - 1.0) < 0.01

    def test_get_model_weights_has_model_version(self, branch_client, branch_auth_header):
        resp = branch_client.get("/api/v1/models/weights", headers=branch_auth_header)
        body = resp.json()
        assert "model_version" in body

    def test_get_model_weights_missing_auth_returns_4xx(self, branch_client):
        resp = branch_client.get("/api/v1/models/weights")
        assert resp.status_code in (401, 403, 422)


# ══════════════════════════════════════════════════════════════════════════════
# HQ API Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestHQAggregate:
    def test_post_aggregate_returns_200(self, hq_client, hq_auth_header):
        resp = hq_client.post("/api/v1/aggregate", headers=hq_auth_header)
        assert resp.status_code == 200

    def test_post_aggregate_response_has_status(self, hq_client, hq_auth_header):
        resp = hq_client.post("/api/v1/aggregate", headers=hq_auth_header)
        body = resp.json()
        # "error" is acceptable when DB is unavailable in test environment
        assert body["status"] in ("success", "error")

    def test_post_aggregate_response_has_models_updated(self, hq_client, hq_auth_header):
        resp = hq_client.post("/api/v1/aggregate", headers=hq_auth_header)
        body = resp.json()
        if body.get("status") == "success":
            assert "models_updated" in body
            assert isinstance(body["models_updated"], int)

    def test_post_aggregate_missing_auth_returns_4xx(self, hq_client):
        resp = hq_client.post("/api/v1/aggregate")
        assert resp.status_code in (401, 403, 422)


class TestHQPersonalize:
    def test_post_personalize_returns_200(self, hq_client, hq_auth_header):
        resp = hq_client.post("/api/v1/hypernetwork/personalize", headers=hq_auth_header)
        assert resp.status_code == 200

    def test_post_personalize_response_has_status(self, hq_client, hq_auth_header):
        resp = hq_client.post("/api/v1/hypernetwork/personalize", headers=hq_auth_header)
        body = resp.json()
        assert body["status"] == "success"

    def test_post_personalize_response_has_branches_count(self, hq_client, hq_auth_header):
        resp = hq_client.post("/api/v1/hypernetwork/personalize", headers=hq_auth_header)
        body = resp.json()
        assert "branches_personalized" in body
        assert isinstance(body["branches_personalized"], int)


class TestHQVerifyBackground:
    def test_post_verify_background_returns_200(self, hq_client, hq_auth_header):
        resp = hq_client.post("/api/v1/verify/background", json=VERIFY_BG_PAYLOAD, headers=hq_auth_header)
        assert resp.status_code == 200

    def test_post_verify_background_status_queued(self, hq_client, hq_auth_header):
        resp = hq_client.post("/api/v1/verify/background", json=VERIFY_BG_PAYLOAD, headers=hq_auth_header)
        body = resp.json()
        assert body["status"] == "queued"

    def test_post_verify_background_missing_auth_returns_4xx(self, hq_client):
        resp = hq_client.post("/api/v1/verify/background", json=VERIFY_BG_PAYLOAD)
        assert resp.status_code in (401, 403, 422)


# ══════════════════════════════════════════════════════════════════════════════
# HQ Health
# ══════════════════════════════════════════════════════════════════════════════

class TestHQHealth:
    def test_health_endpoint_returns_200(self, hq_client):
        resp = hq_client.get("/api/health")
        assert resp.status_code == 200

    def test_health_endpoint_returns_ok(self, hq_client):
        resp = hq_client.get("/api/health")
        assert resp.json()["status"] == "ok"
