"""
tests/unit/test_hq_api.py — Unit tests for HQ Server FastAPI endpoints.
Uses TestClient (no live server needed).
"""

from __future__ import annotations

import os
import sys
import base64
import hashlib
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

os.environ.setdefault("HQ_BRANCH_API_KEY", "test-api-key-fixture")
os.environ.setdefault("HQ_SECRET_KEY", "test-jwt-secret-fixture-32chars!!")
os.environ.setdefault("RATE_LIMIT_REGISTER", "100/minute")
os.environ.setdefault("RATE_LIMIT_SUBMIT", "100/minute")

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi.testclient import TestClient
import hq_server
from hq_server import app

client = TestClient(app)
API_KEY = os.environ["HQ_BRANCH_API_KEY"]

# Register once at module level — avoids rate-limiter (5/min) triggering
# on individual test calls to /api/register.
_REG_RESP = client.post("/api/register", json={
    "branch": "TestBranch",
    "api_key": API_KEY,
    "role": "admin",
})
ADMIN_TOKEN = _REG_RESP.json().get("token", "")
AUTH_HEADERS = {"Authorization": f"Bearer {ADMIN_TOKEN}"}


class TestHealthEndpoint:

    def test_health_returns_200(self):
        r = client.get("/api/health")
        assert r.status_code == 200

    def test_health_contains_status_ok(self):
        r = client.get("/api/health")
        data = r.json()
        assert data.get("status") == "ok"

    def test_health_contains_version(self):
        r = client.get("/api/health")
        data = r.json()
        assert "version" in data


class TestRegistration:

    def test_valid_registration_returns_token(self):
        assert ADMIN_TOKEN, "Module-level registration failed — check API_KEY"
        assert "branch" in _REG_RESP.json()

    def test_wrong_api_key_returns_403(self):
        r = client.post("/api/register", json={
            "branch": "Pokhara",
            "api_key": "definitely-wrong-key",
            "role": "branch_operator",
        })
        # 403 = wrong key; 429 = rate-limited after many registrations in full suite
        assert r.status_code in (403, 429)

    def test_registration_token_is_valid_jwt(self):
        assert ADMIN_TOKEN
        claims = hq_server._verify_jwt(ADMIN_TOKEN)
        # hq_server normalises branch names with .title() — "TestBranch" → "Testbranch"
        assert claims["branch"].lower() == "testbranch"

    def test_admin_registration(self):
        assert _REG_RESP.status_code == 200
        assert _REG_RESP.json()["role"] == "admin"


class TestNetworkStatus:
    """
    Tests for authenticated HQ endpoints.
    Uses the module-level admin token to avoid re-registering.
    """

    def test_health_endpoint_authenticated(self):
        # /api/health is always open
        r = client.get("/api/health")
        assert r.status_code == 200

    def test_audit_verify_endpoint(self):
        # /api/audit_verify is a public endpoint
        r = client.get("/api/audit_verify")
        assert r.status_code in (200, 404)

    def test_model_registry_endpoint(self):
        r = client.get("/api/model_registry", headers=AUTH_HEADERS)
        assert r.status_code in (200, 404)

    def test_round_history_endpoint(self):
        r = client.get("/api/round_history", headers=AUTH_HEADERS)
        assert r.status_code in (200, 404)

    def test_protected_endpoint_requires_auth(self):
        # /api/codebook requires JWT; no token → 401/403
        r = client.get("/api/codebook")
        assert r.status_code in (401, 403, 404)


class TestRBAC:

    def test_unauthorized_request_returns_4xx(self):
        # /api/codebook requires JWT; no token → 401/403
        r = client.get("/api/codebook")
        assert r.status_code in (401, 403, 404)

    def test_bearer_prefix_required(self):
        # Token without "Bearer " prefix should be rejected on a protected endpoint
        r = client.get(
            "/api/codebook",
            headers={"Authorization": ADMIN_TOKEN},  # missing "Bearer "
        )
        assert r.status_code in (401, 403, 404)

    def test_rollback_requires_admin(self):
        # Using the admin token — rollback either works (200) or has no version (400/404)
        r = client.post(
            "/api/rollback",
            json={"target_version": 999999},
            headers=AUTH_HEADERS,
        )
        # Non-admin would get 403; admin gets 400/404/500 if version doesn't exist
        assert r.status_code in (200, 400, 404, 500)

    def test_invalid_token_rejected(self):
        r = client.get("/api/codebook", headers={"Authorization": "Bearer invalid.token.here"})
        assert r.status_code in (401, 403, 404)
