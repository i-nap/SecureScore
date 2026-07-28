"""Contract tests for /api/branch/* — verifies response shapes match api.ts."""
from __future__ import annotations

import httpx
from .conftest import auth


def test_branch_dashboard_shape(bff_client: httpx.Client, branch_token: str):
    r = bff_client.get("/api/branch/dashboard", headers=auth(branch_token))
    assert r.status_code == 200
    b = r.json()
    assert isinstance(b, dict)


def test_branch_score_shape(bff_client: httpx.Client, branch_token: str):
    payload = {
        "annual_income": 600000,
        "debt_to_income": 0.35,
        "employment_months": 24,
        "credit_history_months": 36,
        "existing_loans": 1,
        "loan_amount": 200000,
        "collateral_value": 300000,
        "repayment_history": 0.95,
    }
    r = bff_client.post("/api/branch/score", json=payload, headers=auth(branch_token))
    assert r.status_code == 200
    b = r.json()
    assert isinstance(b["score"], (int, float))
    assert 0 <= b["score"] <= 100
    assert b["decision"] in ("APPROVE", "MANUAL_REVIEW", "REJECT")
    assert b["tier"] in ("LOW_RISK", "MEDIUM_RISK", "HIGH_RISK", "VERY_HIGH_RISK")
    assert "shap_values" in b or "explanation" in b


def test_branch_kyc_applications_shape(bff_client: httpx.Client, branch_token: str):
    r = bff_client.get("/api/branch/kyc_applications", headers=auth(branch_token))
    assert r.status_code == 200
    body = r.json()
    applications = body if isinstance(body, list) else body.get("applications", body.get("items", []))
    assert isinstance(applications, list)


def test_branch_cannot_access_hq_trigger(bff_client: httpx.Client, branch_token: str):
    r = bff_client.post("/api/hq/trigger_aggregation", json={}, headers=auth(branch_token))
    assert r.status_code == 403


def test_branch_eod_preview_shape(bff_client: httpx.Client, branch_token: str):
    r = bff_client.get("/api/banking/eod/preview", headers=auth(branch_token))
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        b = r.json()
        assert isinstance(b, dict)


def test_branch_clients_shape(bff_client: httpx.Client, branch_token: str):
    r = bff_client.get("/api/branch/clients", headers=auth(branch_token))
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        body = r.json()
        clients = body if isinstance(body, list) else body.get("clients", body.get("items", []))
        assert isinstance(clients, list)


def test_branch_endpoint_requires_auth(bff_client: httpx.Client):
    r = bff_client.get("/api/branch/dashboard")
    assert r.status_code == 401


def test_customer_cannot_access_branch_score(bff_client: httpx.Client, customer_token: str):
    r = bff_client.post("/api/branch/score", json={}, headers=auth(customer_token))
    assert r.status_code in (403, 404)
