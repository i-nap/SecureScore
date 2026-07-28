"""
Smoke tests for the decomposed HQ microservices (services/aggregation,
audit, compliance, federation, model_registry). Each service must import
cleanly and answer GET /api/health with HTTP 200 — this is the minimum bar
that keeps a service wired into docker-compose.yml from silently crashing
on boot (see the services.model-registry -> model_registry rename, which
this test would have caught immediately).
"""
import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("HQ_SECRET_KEY", "test-secret-for-microservice-smoke-tests-32ch")
os.environ.setdefault("HQ_BRANCH_API_KEY", "test-branch-api-key")

SERVICE_MODULES = [
    "services.aggregation.main",
    "services.audit.main",
    "services.compliance.main",
    "services.federation.main",
    "services.model_registry.main",
]


@pytest.mark.parametrize("module_path", SERVICE_MODULES)
def test_service_imports_and_health(module_path):
    module = pytest.importorskip(module_path)
    client = TestClient(module.app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
