"""Shared fixtures for BFF API contract tests."""
from __future__ import annotations

import pytest
import httpx

BFF_BASE = "http://localhost:4000"


@pytest.fixture(scope="session")
def bff_client():
    with httpx.Client(base_url=BFF_BASE, timeout=15) as client:
        yield client


@pytest.fixture(scope="session")
def admin_token(bff_client: httpx.Client) -> str:
    r = bff_client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def branch_token(bff_client: httpx.Client) -> str:
    r = bff_client.post("/api/auth/login", json={"username": "kathmandu_mgr", "password": "branch123"})
    assert r.status_code == 200, f"Branch login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def customer_token(bff_client: httpx.Client) -> str:
    r = bff_client.post("/api/auth/login", json={"username": "cust001", "password": "customer123"})
    assert r.status_code == 200, f"Customer login failed: {r.text}"
    return r.json()["token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
