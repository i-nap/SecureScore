"""
tests/unit/test_mu_graph_coder.py

Unit tests for all μGraphCoder components.
Run with: pytest tests/unit/test_mu_graph_coder.py -v
"""

import sys
import os
import pytest
import numpy as np
import pandas as pd

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

# Skip entire module if torch/scipy not installed
torch = pytest.importorskip("torch")
pytest.importorskip("scipy")

from mu_graph_coder.topology_fingerprinting import TopologyFingerprinter, _FP_TOTAL
from mu_graph_coder.tiny_gnn import TinyGNN, score_customers, count_model_bytes
from mu_graph_coder.vq_codebook import VQCodebook
from mu_graph_coder.hypernetwork import Hypernetwork, train_hypernetwork
from mu_graph_coder.lora_adapter import LoRAAdapter
from mu_graph_coder.deployment_aware_loss import DeploymentAwareLoss
from mu_graph_coder.evaluation import MuGraphCoderEvaluator


# ─────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────

@pytest.fixture
def sample_ucp():
    """50-customer UCP DataFrame with required columns."""
    rng = np.random.default_rng(42)
    N = 50
    return pd.DataFrame({
        "customer_id": [f"C{i:04d}" for i in range(N)],
        "income": rng.uniform(20000, 100000, N),
        "age": rng.integers(22, 65, N).astype(float),
        "credit_utilization": rng.uniform(0.1, 0.9, N),
        "debt_to_income_ratio": rng.uniform(0.1, 0.6, N),
        "total_transaction_volume": rng.uniform(5000, 200000, N),
        "digital_engagement_score": rng.uniform(10, 90, N),
        "alternative_credit_score": rng.uniform(300, 900, N),
        "tx_count": rng.integers(1, 40, N).astype(float),
    })


@pytest.fixture
def fingerprinter():
    return TopologyFingerprinter(max_nodes=50, cosine_sim_threshold=0.7)


@pytest.fixture
def graph_data(fingerprinter, sample_ucp):
    node_features, edge_index, edge_features = fingerprinter.build_graph(sample_ucp)
    fp = fingerprinter.compute_fingerprint(node_features, edge_index, edge_features)
    return node_features, edge_index, edge_features, fp


@pytest.fixture
def tiny_gnn():
    return TinyGNN(in_dim=8, hidden_dim=32, n_layers=2, edge_dim=3)


@pytest.fixture
def codebook():
    return VQCodebook(K=64, d_code=32)


@pytest.fixture
def hypernetwork(codebook):
    return Hypernetwork(
        codebook=codebook,
        gnn_config={"in_dim": 8, "hidden_dim": 32, "n_layers": 2, "edge_dim": 3},
        n_codes_per_layer=4,
    )


# ─────────────────────────────────────────────────────────────
# RQ1 — Topology fingerprinting
# ─────────────────────────────────────────────────────────────

def test_fingerprint_under_512_bytes(fingerprinter, sample_ucp):
    """Fingerprint must be ≤ 512 bytes (paper constraint)."""
    nf, ei, ef = fingerprinter.build_graph(sample_ucp)
    fp = fingerprinter.compute_fingerprint(nf, ei, ef)
    fp_bytes = fingerprinter.fingerprint_to_bytes(fp)
    assert len(fp_bytes) <= 512, f"Fingerprint is {len(fp_bytes)} bytes, exceeds 512"
    assert len(fp_bytes) == _FP_TOTAL * 4  # 44 × 4 = 176 bytes


def test_fingerprint_correct_dimension(graph_data):
    """Fingerprint vector must have exactly _FP_TOTAL = 44 elements."""
    _, _, _, fp = graph_data
    assert len(fp) == _FP_TOTAL, f"Expected {_FP_TOTAL}, got {len(fp)}"
    assert fp.dtype == np.float32


def test_fingerprint_deterministic(fingerprinter, sample_ucp):
    """Same input must produce identical fingerprints."""
    nf, ei, ef = fingerprinter.build_graph(sample_ucp)
    fp1 = fingerprinter.compute_fingerprint(nf, ei, ef)
    fp2 = fingerprinter.compute_fingerprint(nf, ei, ef)
    np.testing.assert_array_almost_equal(fp1, fp2, decimal=5)


def test_fingerprint_distinct_branches():
    """Different branch data must produce distinct fingerprints."""
    rng = np.random.default_rng(0)
    fp_obj = TopologyFingerprinter(max_nodes=50)

    fingerprints = []
    for seed in [10, 20, 30]:
        rng2 = np.random.default_rng(seed)
        ucp = pd.DataFrame({
            "customer_id": [f"C{i}" for i in range(50)],
            "income": rng2.uniform(20000 * (seed // 10), 80000 * (seed // 10), 50),
            "age": rng2.uniform(25, 60, 50),
            "credit_utilization": rng2.uniform(0.1, 0.9, 50),
            "debt_to_income_ratio": rng2.uniform(0.1, 0.5, 50),
            "total_transaction_volume": rng2.uniform(1000, 50000, 50),
            "digital_engagement_score": rng2.uniform(5, 95, 50),
            "alternative_credit_score": rng2.uniform(300, 900, 50),
            "tx_count": rng2.uniform(1, 30, 50),
        })
        nf, ei, ef = fp_obj.build_graph(ucp)
        fp = fp_obj.compute_fingerprint(nf, ei, ef)
        fingerprints.append(fp)

    # All fingerprints must be distinct (not identical)
    assert not np.allclose(fingerprints[0], fingerprints[1])
    assert not np.allclose(fingerprints[0], fingerprints[2])


def test_fingerprint_serialization(graph_data, fingerprinter):
    """Round-trip: bytes → array → bytes must be lossless."""
    _, _, _, fp = graph_data
    fp_bytes = fingerprinter.fingerprint_to_bytes(fp)
    fp_back = fingerprinter.fingerprint_from_bytes(fp_bytes)
    np.testing.assert_array_equal(fp, fp_back)

    b64 = fingerprinter.serialize_b64(fp)
    fp_back2 = fingerprinter.deserialize_b64(b64)
    np.testing.assert_array_equal(fp, fp_back2)


# ─────────────────────────────────────────────────────────────
# TinyGNN
# ─────────────────────────────────────────────────────────────

def test_tiny_gnn_forward_pass(graph_data):
    """GNN forward pass must produce (N, 1) logits without error."""
    node_features, edge_index, edge_features, _ = graph_data
    gnn = TinyGNN(in_dim=8, hidden_dim=32, n_layers=2, edge_dim=3)

    x = torch.tensor(node_features, dtype=torch.float32)
    ei = torch.tensor(edge_index, dtype=torch.long)
    ea = torch.tensor(edge_features, dtype=torch.float32)

    logits = gnn(x, ei, ea)
    assert logits.shape == (len(node_features), 1), f"Expected ({len(node_features)}, 1), got {logits.shape}"
    assert not torch.isnan(logits).any(), "NaN in GNN output"


def test_tiny_gnn_isolated_nodes():
    """GNN must handle graphs with no edges (all isolated nodes)."""
    gnn = TinyGNN(in_dim=8, hidden_dim=32, n_layers=2, edge_dim=3)
    N = 10
    x = torch.randn(N, 8)
    ei = torch.zeros(2, 0, dtype=torch.long)
    ea = torch.zeros(0, 3, dtype=torch.float32)
    logits = gnn(x, ei, ea)
    assert logits.shape == (N, 1)
    assert not torch.isnan(logits).any()


def test_tiny_gnn_parameter_count():
    """TinyGNN parameter count must be reasonable for edge deployment."""
    gnn = TinyGNN(in_dim=8, hidden_dim=32, n_layers=2, edge_dim=3)
    assert gnn.total_parameters < 50_000, f"Too many params: {gnn.total_parameters}"
    assert gnn.total_bytes < 200_000, f"Too large: {gnn.total_bytes} bytes"


def test_tiny_gnn_weight_tensor_roundtrip():
    """Weight tensors extracted and reloaded must yield identical outputs."""
    gnn = TinyGNN(in_dim=8, hidden_dim=32, n_layers=2, edge_dim=3)
    x = torch.randn(5, 8)
    ei = torch.zeros(2, 0, dtype=torch.long)
    ea = torch.zeros(0, 3, dtype=torch.float32)

    out1 = gnn(x, ei, ea)
    tensors = [t.clone() for t in gnn.get_all_weight_tensors()]
    gnn2 = TinyGNN(in_dim=8, hidden_dim=32, n_layers=2, edge_dim=3)
    gnn2.load_weight_tensors(tensors)
    out2 = gnn2(x, ei, ea)

    torch.testing.assert_close(out1, out2)


# ─────────────────────────────────────────────────────────────
# VQ Codebook
# ─────────────────────────────────────────────────────────────

def test_vq_codebook_quantisation(codebook):
    """VQ forward must return correct shapes and valid indices."""
    B = 16
    z_e = torch.randn(B, codebook.d_code)
    z_q_st, indices, vq_loss = codebook(z_e)

    assert z_q_st.shape == (B, codebook.d_code)
    assert indices.shape == (B,)
    assert indices.min() >= 0
    assert indices.max() < codebook.K
    assert float(vq_loss.detach()) >= 0.0


def test_vq_codebook_ema_update(codebook):
    """EMA update must change codebook weights during training."""
    codebook.train()
    weights_before = codebook.codebook.weight.data.clone()
    z_e = torch.randn(32, codebook.d_code)
    codebook(z_e)
    weights_after = codebook.codebook.weight.data
    # Weights should have changed due to EMA
    assert not torch.allclose(weights_before, weights_after), "EMA did not update codebook"


def test_vq_codebook_decode_indices(codebook):
    """decode_indices must reconstruct tensors matching codebook entry shapes."""
    indices = torch.randint(0, codebook.K, (8,))
    fragments = codebook.decode_indices(indices)
    assert fragments.shape == (8, codebook.d_code)


def test_vq_codebook_communication_bytes(codebook):
    """Communication bytes must be much less than float32 baseline."""
    n_idx = 32
    cb = codebook.communication_bytes(n_idx)
    baseline = codebook.baseline_bytes(n_idx * codebook.d_code)
    assert cb < baseline, f"comm_bytes ({cb}) not less than baseline ({baseline})"
    assert codebook.savings_ratio(n_idx, n_idx * codebook.d_code) >= 2.0


# ─────────────────────────────────────────────────────────────
# Hypernetwork
# ─────────────────────────────────────────────────────────────

def test_hypernetwork_generate(hypernetwork):
    """Hypernetwork generate() must return non-empty code indices."""
    fp = np.random.randn(_FP_TOTAL).astype(np.float32)
    code_indices, gnn_config = hypernetwork.generate(fp)
    assert len(code_indices) > 0
    assert "in_dim" in gnn_config
    assert "hidden_dim" in gnn_config


def test_hypernetwork_reconstruct_weights(hypernetwork):
    """Reconstructed GNN must forward-pass without error."""
    fp = np.random.randn(_FP_TOTAL).astype(np.float32)
    code_indices, gnn_config = hypernetwork.generate(fp)
    gnn = hypernetwork.reconstruct_gnn(code_indices)

    x = torch.randn(10, 8)
    ei = torch.zeros(2, 0, dtype=torch.long)
    ea = torch.zeros(0, 3, dtype=torch.float32)
    logits = gnn(x, ei, ea)
    assert logits.shape == (10, 1)
    assert not torch.isnan(logits).any()


def test_hypernetwork_communication_savings(hypernetwork):
    """μGraphCoder must transmit fewer bytes than full model weights."""
    fp = np.random.randn(_FP_TOTAL).astype(np.float32)
    code_indices, gnn_config = hypernetwork.generate(fp)
    gnn = TinyGNN.from_config(gnn_config)
    cost = hypernetwork.communication_cost(code_indices, gnn)
    assert cost["mu_graphcoder_bytes"] < cost["full_model_bytes"]
    assert cost["savings_ratio"] >= 1.0


# ─────────────────────────────────────────────────────────────
# LoRA Adapter
# ─────────────────────────────────────────────────────────────

def test_lora_adapter_adaptation(graph_data):
    """LoRA adaptation must run without error and return required metrics."""
    node_features, edge_index, edge_features, _ = graph_data
    gnn = TinyGNN(in_dim=8, hidden_dim=32, n_layers=2, edge_dim=3)
    adapter = LoRAAdapter(gnn, rank=2)

    x = torch.tensor(node_features, dtype=torch.float32)
    ei = torch.tensor(edge_index, dtype=torch.long)
    ea = torch.tensor(edge_features, dtype=torch.float32)
    labels = torch.randint(0, 2, (len(node_features),)).float()

    metrics = adapter.adapt(x, ei, ea, labels, n_steps=5, max_samples=20)
    assert "pre_adapt_f1" in metrics
    assert "post_adapt_f1" in metrics
    assert "drift_recovery_pct" in metrics
    assert "samples_used" in metrics
    assert metrics["samples_used"] <= 20


def test_lora_rank_constraint():
    """LoRAAdapter must enforce rank ≤ 4 (paper constraint)."""
    gnn = TinyGNN(in_dim=8, hidden_dim=32, n_layers=2, edge_dim=3)
    with pytest.raises(AssertionError):
        LoRAAdapter(gnn, rank=5)


# ─────────────────────────────────────────────────────────────
# Deployment-aware loss
# ─────────────────────────────────────────────────────────────

def test_deployment_loss_components(graph_data):
    """Loss must return all three components and total = sum."""
    node_features, edge_index, edge_features, _ = graph_data
    gnn = TinyGNN(in_dim=8, hidden_dim=32, n_layers=2, edge_dim=3)

    x = torch.tensor(node_features, dtype=torch.float32)
    ei = torch.tensor(edge_index, dtype=torch.long)
    ea = torch.tensor(edge_features, dtype=torch.float32)
    labels = torch.randint(0, 2, (len(node_features),)).float()

    criterion = DeploymentAwareLoss(lambda_lat=0.01, lambda_mem=0.01)
    logits = gnn(x, ei, ea)
    weights = gnn.get_all_weight_tensors()

    total_loss, components = criterion(logits, labels, weights)
    assert "task_loss" in components
    assert "lat_loss" in components
    assert "mem_loss" in components
    assert "total_loss" in components
    assert components["total_loss"] == pytest.approx(
        components["task_loss"]
        + 0.01 * components["lat_loss"]
        + 0.01 * components["mem_loss"],
        abs=1e-4,
    )


# ─────────────────────────────────────────────────────────────
# Evaluator
# ─────────────────────────────────────────────────────────────

def test_evaluator_rq1():
    """RQ1 evaluator must correctly identify fingerprints under 512 bytes."""
    fp_obj = TopologyFingerprinter(max_nodes=50)
    fps = [np.random.randn(_FP_TOTAL).astype(np.float32) for _ in range(5)]
    evaluator = MuGraphCoderEvaluator()
    result = evaluator.evaluate_rq1_fingerprint_quality(fps, [f"branch_{i}" for i in range(5)])
    assert result["all_under_512_bytes"] is True
    assert result["target_byte_size"] == 176
    assert result["n_branches"] == 5


def test_evaluator_rq2_comm_savings():
    """RQ2 evaluator must detect ≥10× communication savings."""
    evaluator = MuGraphCoderEvaluator()
    gnn_r = [{"f1": 0.85, "auroc": 0.88}] * 5
    xgb_r = [{"f1": 0.87, "auroc": 0.90}] * 5
    mu_bytes = [200] * 5
    full_bytes = [2_100_000] * 5
    result = evaluator.evaluate_rq2_accuracy_and_comm(gnn_r, xgb_r, mu_bytes, full_bytes)
    assert result["comm_savings_ratio"] >= 10.0
    assert result["meets_comm_target"] is True
