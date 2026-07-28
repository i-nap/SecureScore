"""Contract tests for /api/auth/* — verifies Go BFF response shapes match api.ts."""
from __future__ import annotations

import httpx
from .conftest import auth


def test_login_success_shape(bff_client: httpx.Client):
    r = bff_client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200
    b = r.json()
    assert isinstance(b["token"], str) and len(b["token"]) > 20
    assert isinstance(b["refresh_token"], str) and len(b["refresh_token"]) > 10
    u = b["user"]
    assert isinstance(u["username"], str)
    assert u["role"] in ("admin", "branch_manager", "customer")
    assert isinstance(u["branch_id"], str)
    assert isinstance(u["full_name"], str)
    assert "customer_id" in u  # may be None for non-customer roles


def test_login_wrong_password(bff_client: httpx.Client):
    r = bff_client.post("/api/auth/login", json={"username": "admin", "password": "wrongpass"})
    assert r.status_code == 401
    assert "error" in r.json()


def test_login_unknown_user(bff_client: httpx.Client):
    r = bff_client.post("/api/auth/login", json={"username": "nobody", "password": "x"})
    assert r.status_code == 401
    assert "error" in r.json()


def test_login_missing_fields(bff_client: httpx.Client):
    r = bff_client.post("/api/auth/login", json={"username": "admin"})
    assert r.status_code in (400, 401)


def test_refresh_token_valid(bff_client: httpx.Client):
    login = bff_client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    refresh_token = login.json()["refresh_token"]
    r = bff_client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert r.status_code == 200
    b = r.json()
    assert isinstance(b["token"], str) and len(b["token"]) > 20


def test_refresh_with_bad_token(bff_client: httpx.Client):
    r = bff_client.post("/api/auth/refresh", json={"refresh_token": "invalid.token.here"})
    assert r.status_code == 401


def test_protected_route_without_token(bff_client: httpx.Client):
    r = bff_client.get("/api/customer/score")
    assert r.status_code == 401


def test_protected_route_with_bad_token(bff_client: httpx.Client):
    r = bff_client.get("/api/customer/score", headers={"Authorization": "Bearer bad.token"})
    assert r.status_code == 401


def test_health_endpoint_shape(bff_client: httpx.Client):
    r = bff_client.get("/api/health")
    assert r.status_code in (200, 503)
    b = r.json()
    assert b["status"] in ("ok", "degraded")
    assert "version" in b
    assert "db" in b
    assert "hq" in b
