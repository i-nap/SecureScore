"""Contract tests for /api/customer/* — verifies response shapes match api.ts."""
from __future__ import annotations

import httpx
from .conftest import auth


def test_customer_score_shape(bff_client: httpx.Client, customer_token: str):
    r = bff_client.get("/api/customer/score", headers=auth(customer_token))
    assert r.status_code == 200
    b = r.json()
    assert isinstance(b["score"], (int, float))
    assert 0 <= b["score"] <= 100
    assert b["decision"] in ("APPROVE", "MANUAL_REVIEW", "REJECT")
    assert b["tier"] in ("LOW_RISK", "MEDIUM_RISK", "HIGH_RISK", "VERY_HIGH_RISK")
    assert isinstance(b.get("percentile", 0), (int, float))


def test_customer_score_explanation_shape(bff_client: httpx.Client, customer_token: str):
    r = bff_client.get("/api/customer/score_explanation", headers=auth(customer_token))
    assert r.status_code == 200
    b = r.json()
    assert "top_features" in b
    assert isinstance(b["top_features"], list)
    assert len(b["top_features"]) >= 1
    # Each feature should have at least a name and value
    feature = b["top_features"][0]
    assert "feature" in feature or "name" in feature


def test_customer_banking_accounts_shape(bff_client: httpx.Client, customer_token: str):
    r = bff_client.get("/api/banking/accounts", headers=auth(customer_token))
    assert r.status_code == 200
    b = r.json()
    assert isinstance(b, list)
    if b:
        account = b[0]
        assert "account_number" in account or "id" in account
        assert "balance" in account or "available_balance" in account


def test_customer_cannot_access_branch_endpoints(bff_client: httpx.Client, customer_token: str):
    r = bff_client.get("/api/branch/dashboard", headers=auth(customer_token))
    assert r.status_code in (403, 404)


def test_customer_cannot_access_hq_endpoints(bff_client: httpx.Client, customer_token: str):
    r = bff_client.get("/api/hq/analytics", headers=auth(customer_token))
    assert r.status_code in (403, 404)


def test_customer_kyc_submit_shape(bff_client: httpx.Client, customer_token: str):
    payload = {
        "full_name": "Test User",
        "date_of_birth": "1990-01-01",
        "national_id": "1234567890",
        "address": "Kathmandu, Nepal",
        "phone": "+977-9800000001",
        "occupation": "Software Engineer",
        "annual_income": 800000,
    }
    r = bff_client.post("/api/customer/kyc", json=payload, headers=auth(customer_token))
    assert r.status_code in (200, 201, 409)  # 409 if already submitted
    if r.status_code in (200, 201):
        b = r.json()
        assert "id" in b or "status" in b
