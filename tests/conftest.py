"""
tests/conftest.py
=================
Session-scoped setup: ensure all DB tables exist before any test runs.
This prevents OperationalError("no such table") when tests are collected
in an order where test_banking.py sets DATABASE_URL=memory before
hq_service/api.py gets to call init_db().
"""

import os
import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("HQ_BRANCH_API_KEY", "test-key")
os.environ.setdefault("BFF_SECRET_KEY", "test-bff-secret-key-32chars-test!!")
os.environ.setdefault("SPEC_SERVICE_TOKEN", "test-service-token-fixture")


@pytest.fixture(scope="session", autouse=True)
def _ensure_db_tables():
    """Create all ORM tables once per test session."""
    try:
        from db.models import init_db
        init_db()
    except Exception:
        pass  # non-fatal; tests that need the DB will fail with clear messages
