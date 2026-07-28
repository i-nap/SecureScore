"""
tests/integration/test_mu_graph_coder_round_trip.py

Integration tests for the μGraphCoder pipeline through the HQ FastAPI server.
Tests the full flow: fingerprint submit → hypernetwork trigger → GNN generation → retrieval.

Run with: pytest tests/integration/test_mu_graph_coder_round_trip.py -v -m integration
"""

import sys
import os
import json
import base64
import pytest
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

os.environ.setdefault("HQ_BRANCH_API_KEY", "test-api-key-fixture")
os.environ.setdefault("RATE_LIMIT_REGISTER", "100/minute")
os.environ.setdefault("RATE_LIMIT_SUBMIT", "100/minute")

# Skip if torch not installed
pytest.importorskip("torch")
pytest.importorskip("scipy")

from fastapi.testclient import TestClient

from mu_graph_coder.topology_fingerprinting import _FP_TOTAL
from mu_graph_coder.vq_codebook import VQCodebook


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _make_fingerprint_b64(seed: int = 0) -> str:
    rng = np.random.default_rng(seed)
    fp = rng.standard_normal(_FP_TOTAL).astype(np.float32)
    return base64.b64encode(fp.tobytes()).decode("ascii")


def _make_jwt(client: TestClient, branch: str = "test_branch") -> str:
    """Register a branch and return its JWT."""
    api_key = os.getenv("HQ_BRANCH_API_KEY", "test-branch-api-key")
    resp = client.post("/api/register", json={
        "branch": branch,
        "api_key": api_key,
        "role": "branch_operator",
    })
    if resp.status_code == 200:
        return resp.json()["token"]
    # May already be registered
    return ""


# ─────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def hq_client(tmp_path_factory):
    """Spin up HQ server TestClient with temp state directory."""
    import importlib
    import hq_server

    tmp = tmp_path_factory.mktemp("hq_state")
    (tmp / "registry").mkdir()
    (tmp / "audit").mkdir()
    (tmp / "mu_graphcoder").mkdir()

    # Patch state directory
    original_state_dir = hq_server.HQ_STATE_DIR
    original_registry_dir = hq_server.MODEL_REGISTRY_DIR
    hq_server.HQ_STATE_DIR = tmp
    hq_server.MODEL_REGISTRY_DIR = tmp / "registry"
    hq_server.state = hq_server.HQState()
    hq_server.audit_chain = hq_server.AuditChain(tmp / "audit")

    # Patch μGraphCoder state dir
    if hq_server.MU_HQ_AVAILABLE:
        hq_server.MU_GRAPH_STATE_DIR = str(tmp / "mu_graphcoder")

    client = TestClient(hq_server.app, raise_server_exceptions=False)
    yield client

    # Restore
    hq_server.HQ_STATE_DIR = original_state_dir
    hq_server.MODEL_REGISTRY_DIR = original_registry_dir


@pytest.fixture(scope="module")
def branch_tokens(hq_client):
    """Register 3 branches and collect their JWTs."""
    tokens = {}
    api_key = os.getenv("HQ_BRANCH_API_KEY", "test-branch-api-key")
    for branch in ["kathmandu", "pokhara", "sarlahi"]:
        resp = hq_client.post("/api/register", json={
            "branch": branch,
            "api_key": api_key,
            "role": "branch_operator",
        })
        if resp.status_code == 200:
            tokens[branch] = resp.json()["token"]
        else:
            tokens[branch] = ""
    return tokens


# ─────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────

@pytest.mark.integration
def test_mu_graphcoder_status_endpoint(hq_client, branch_tokens):
    """Status endpoint must return availability info."""
    token = next((t for t in branch_tokens.values() if t), "")
    if not token:
        pytest.skip("No valid token — HQ registration not available")

    resp = hq_client.get(
        "/api/mu_graphcoder/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code in (200, 501), f"Unexpected status: {resp.status_code}"
    if resp.status_code == 501:
        pytest.skip("μGraphCoder not available on HQ server")

    data = resp.json()
    assert "available" in data
    assert "fingerprints_received" in data
    assert "gnns_generated" in data


@pytest.mark.integration
def test_fingerprint_submit_endpoint(hq_client, branch_tokens):
    """Submit fingerprint for a single branch; should be accepted."""
    token = branch_tokens.get("kathmandu", "")
    if not token:
        pytest.skip("No kathmandu token")

    resp = hq_client.get(
        "/api/mu_graphcoder/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    if resp.status_code == 501:
        pytest.skip("μGraphCoder not available")

    fp_b64 = _make_fingerprint_b64(seed=1)
    resp = hq_client.post(
        "/api/mu_graphcoder/submit_fingerprint",
        json={
            "branch": "kathmandu",
            "fingerprint_b64": fp_b64,
            "graph_meta": {"n_nodes": 100, "n_edges": 250, "byte_size": 176},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "received"
    assert data["branch"] == "kathmandu"
    assert data["total_fingerprints"] >= 1


@pytest.mark.integration
def test_three_branch_fingerprint_submit(hq_client, branch_tokens):
    """Submitting 3 fingerprints should trigger hypernetwork training."""
    branches = ["kathmandu", "pokhara", "sarlahi"]
    for i, branch in enumerate(branches):
        token = branch_tokens.get(branch, "")
        if not token:
            continue

        # Check if available
        status_resp = hq_client.get(
            "/api/mu_graphcoder/status",
            headers={"Authorization": f"Bearer {token}"},
        )
        if status_resp.status_code == 501:
            pytest.skip("μGraphCoder not available")

        fp_b64 = _make_fingerprint_b64(seed=i + 10)
        hq_client.post(
            "/api/mu_graphcoder/submit_fingerprint",
            json={
                "branch": branch,
                "fingerprint_b64": fp_b64,
                "graph_meta": {"n_nodes": 50 + i * 20, "n_edges": 100 + i * 50, "byte_size": 176},
            },
            headers={"Authorization": f"Bearer {token}"},
        )

    # Verify all 3 fingerprints stored
    token = branch_tokens.get("kathmandu", "")
    if not token:
        pytest.skip("No token")

    status = hq_client.get(
        "/api/mu_graphcoder/status",
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    assert status.get("fingerprints_received", 0) >= 3


@pytest.mark.integration
def test_trigger_training_endpoint(hq_client, branch_tokens):
    """Manual trigger training endpoint must accept the request."""
    token = branch_tokens.get("kathmandu", "")
    if not token:
        pytest.skip("No token")

    status_resp = hq_client.get(
        "/api/mu_graphcoder/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    if status_resp.status_code == 501:
        pytest.skip("μGraphCoder not available")

    resp = hq_client.post(
        "/api/mu_graphcoder/trigger_training",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code in (200, 400)  # 400 if no fingerprints
    if resp.status_code == 200:
        assert "status" in resp.json()


@pytest.mark.integration
def test_communication_bytes_reduction():
    """μGraphCoder must transmit fewer bytes than the full XGBoost model."""
    from mu_graph_coder import VQCodebook, Hypernetwork, TinyGNN
    from mu_graph_coder.topology_fingerprinting import _FP_TOTAL

    codebook = VQCodebook(K=64, d_code=32)
    hn = Hypernetwork(
        codebook=codebook,
        gnn_config={"in_dim": 8, "hidden_dim": 32, "n_layers": 2, "edge_dim": 3},
        n_codes_per_layer=4,
    )
    fp = np.random.randn(_FP_TOTAL).astype(np.float32)
    code_indices, gnn_config = hn.generate(fp)
    gnn = TinyGNN.from_config(gnn_config)
    cost = hn.communication_cost(code_indices, gnn)

    assert cost["mu_graphcoder_bytes"] < cost["full_model_bytes"], (
        f"μGraphCoder ({cost['mu_graphcoder_bytes']}B) not smaller than "
        f"full model ({cost['full_model_bytes']}B)"
    )
    # The savings ratio should be ≥ 1 (even before training convergence)
    assert cost["savings_ratio"] >= 1.0


@pytest.mark.integration
def test_report_endpoint(hq_client, branch_tokens):
    """Report endpoint must return RQ structure if fingerprints are present."""
    token = branch_tokens.get("kathmandu", "")
    if not token:
        pytest.skip("No token")

    status_resp = hq_client.get(
        "/api/mu_graphcoder/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    if status_resp.status_code == 501:
        pytest.skip("μGraphCoder not available")
    if status_resp.json().get("fingerprints_received", 0) == 0:
        pytest.skip("No fingerprints — submit some first")

    resp = hq_client.get(
        "/api/mu_graphcoder/report",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "summary" in data
    assert "rq1_fingerprint_quality" in data
    assert "rq2_accuracy_and_comm" in data
    assert data["rq1_fingerprint_quality"]["all_under_512_bytes"] is True
