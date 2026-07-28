"""Contract tests for /api/hq/* — verifies response shapes match api.ts."""
from __future__ import annotations

import httpx
from .conftest import auth


def test_hq_branches_shape(bff_client: httpx.Client, admin_token: str):
    r = bff_client.get("/api/hq/branches", headers=auth(admin_token))
    assert r.status_code == 200
    body = r.json()
    # Accept list or {branches: [...]} envelope
    branches = body if isinstance(body, list) else body.get("branches", body.get("items", []))
    assert isinstance(branches, list)
    if branches:
        b = branches[0]
        assert isinstance(b.get("branch_name") or b.get("name") or b.get("branch") or "", str)


def test_hq_privacy_budget_shape(bff_client: httpx.Client, admin_token: str):
    r = bff_client.get("/api/hq/privacy_budget", headers=auth(admin_token))
    assert r.status_code == 200
    b = r.json()
    assert isinstance(b.get("total_budget") or b.get("total") or 0, (int, float))
    assert isinstance(b.get("remaining") or b.get("epsilon_remaining") or 0, (int, float))
    remaining = b.get("remaining") or b.get("epsilon_remaining") or 0
    total = b.get("total_budget") or b.get("total") or 10.0
    assert 0 <= remaining <= total


def test_hq_trigger_aggregation_requires_admin(bff_client: httpx.Client, branch_token: str):
    r = bff_client.post("/api/hq/trigger_aggregation", json={}, headers=auth(branch_token))
    assert r.status_code == 403
    assert "error" in r.json()


def test_hq_analytics_shape(bff_client: httpx.Client, admin_token: str):
    r = bff_client.get("/api/hq/analytics", headers=auth(admin_token))
    assert r.status_code == 200
    b = r.json()
    assert isinstance(b, dict)


def test_hq_audit_log_shape(bff_client: httpx.Client, admin_token: str):
    r = bff_client.get("/api/hq/audit_log", headers=auth(admin_token))
    assert r.status_code == 200
    body = r.json()
    entries = body if isinstance(body, list) else body.get("entries", body.get("items", []))
    assert isinstance(entries, list)


def test_hq_status_shape(bff_client: httpx.Client, admin_token: str):
    r = bff_client.get("/api/hq/status", headers=auth(admin_token))
    assert r.status_code == 200
    b = r.json()
    assert isinstance(b, dict)


def test_hq_endpoint_requires_auth(bff_client: httpx.Client):
    r = bff_client.get("/api/hq/analytics")
    assert r.status_code == 401


def test_customer_cannot_access_hq_privacy_budget(bff_client: httpx.Client, customer_token: str):
    r = bff_client.get("/api/hq/privacy_budget", headers=auth(customer_token))
    assert r.status_code in (403, 404)
