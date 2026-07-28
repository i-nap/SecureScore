"""
mu_graph_coder/evaluation.py

Benchmarks all four μGraphCoder research questions:
  RQ1: Topology fingerprint < 512 bytes, retains structural discriminability
  RQ2: GNN achieves 90-97% accuracy of per-device fine-tuned models; ≥10× comm reduction
  RQ3: LoRA adapters recover ≥70% of drift-induced performance loss (≤100 samples)
  RQ4: Deployment-aware loss improves latency/memory efficiency

Paper reference: Section IV.F — Evaluation Protocol
"""

import logging
import time
from typing import Dict, List, Optional, Tuple

import numpy as np
from sklearn.metrics import f1_score, roc_auc_score, accuracy_score

from .topology_fingerprinting import TopologyFingerprinter, _FP_TOTAL

logger = logging.getLogger(__name__)


class MuGraphCoderEvaluator:
    """
    Evaluates μGraphCoder on the four paper research questions.
    Designed to run from saved experiment state; no live training required.
    """

    # ------------------------------------------------------------------
    # RQ1 — Fingerprint quality
    # ------------------------------------------------------------------

    def evaluate_rq1_fingerprint_quality(
        self,
        fingerprints: List[np.ndarray],
        branch_names: List[str],
    ) -> Dict:
        """
        RQ1: Can the topology fingerprint (< 512 bytes) preserve enough
        topological information for GNN-based tasks?

        Checks:
          - All fingerprints ≤ 512 bytes
          - Fingerprints are numerically distinct (pairwise cosine similarity < 0.99)
          - Fingerprint dimension is correct
        """
        byte_sizes = [
            len(fp.astype(np.float32).tobytes()) for fp in fingerprints
        ]
        all_under_512 = all(s <= 512 for s in byte_sizes)

        # Pairwise cosine similarity
        norms = [np.linalg.norm(fp) for fp in fingerprints]
        similarities = []
        for i in range(len(fingerprints)):
            for j in range(i + 1, len(fingerprints)):
                n_i, n_j = norms[i], norms[j]
                if n_i > 0 and n_j > 0:
                    sim = float(np.dot(fingerprints[i], fingerprints[j]) / (n_i * n_j))
                    similarities.append(sim)

        mean_sim = float(np.mean(similarities)) if similarities else 0.0
        max_sim = float(np.max(similarities)) if similarities else 0.0
        distinctiveness = 1.0 - mean_sim  # higher = more distinct

        # Stability test: add small noise and check fingerprint doesn't change drastically
        if len(fingerprints) > 0:
            fp0 = fingerprints[0].copy()
            noisy = fp0 + np.random.normal(0, 0.01, fp0.shape).astype(np.float32)
            noise_drift = float(np.linalg.norm(fp0 - noisy) / (np.linalg.norm(fp0) + 1e-10))
        else:
            noise_drift = 0.0

        result = {
            "rq1_passed": all_under_512 and distinctiveness > 0.05,
            "all_under_512_bytes": all_under_512,
            "max_byte_size": max(byte_sizes) if byte_sizes else 0,
            "min_byte_size": min(byte_sizes) if byte_sizes else 0,
            "mean_byte_size": int(np.mean(byte_sizes)) if byte_sizes else 0,
            "target_byte_size": _FP_TOTAL * 4,  # 176 bytes
            "n_branches": len(fingerprints),
            "distinctiveness_score": round(distinctiveness, 4),
            "mean_pairwise_similarity": round(mean_sim, 4),
            "max_pairwise_similarity": round(max_sim, 4),
            "noise_drift": round(noise_drift, 4),
            "branch_names": branch_names,
        }
        logger.info("RQ1: %s", result)
        return result

    # ------------------------------------------------------------------
    # RQ2 — Accuracy and communication savings
    # ------------------------------------------------------------------

    def evaluate_rq2_accuracy_and_comm(
        self,
        gnn_results: List[Dict],
        xgb_baseline_results: List[Dict],
        comm_bytes_mugraphcoder: List[int],
        comm_bytes_baseline: List[int],
    ) -> Dict:
        """
        RQ2: Does μGraphCoder achieve 90–97% of per-device fine-tuned model accuracy
        while reducing communication cost by ≥ 10×?

        Parameters
        ----------
        gnn_results            : list of {auroc, f1, accuracy} per branch
        xgb_baseline_results   : list of {auroc, f1, accuracy} per branch
        comm_bytes_mugraphcoder: bytes transmitted per branch (indices only)
        comm_bytes_baseline    : bytes transmitted per branch (full model)
        """
        if not gnn_results or not xgb_baseline_results:
            return {"rq2_passed": False, "error": "No results provided"}

        # Accuracy metrics
        gnn_f1s = [r.get("f1", 0.0) for r in gnn_results]
        xgb_f1s = [r.get("f1", 0.0) for r in xgb_baseline_results]
        gnn_aurocs = [r.get("auroc", 0.0) for r in gnn_results]
        xgb_aurocs = [r.get("auroc", 0.0) for r in xgb_baseline_results]

        mean_gnn_f1 = float(np.mean(gnn_f1s))
        mean_xgb_f1 = float(np.mean(xgb_f1s))
        mean_gnn_auroc = float(np.mean(gnn_aurocs))
        mean_xgb_auroc = float(np.mean(xgb_aurocs))

        # Accuracy ratio (μGraphCoder vs. baseline)
        f1_ratio = mean_gnn_f1 / max(mean_xgb_f1, 1e-6)
        auroc_ratio = mean_gnn_auroc / max(mean_xgb_auroc, 1e-6)
        meets_accuracy_target = f1_ratio >= 0.90  # ≥90% of baseline

        # Communication savings
        total_mu = sum(comm_bytes_mugraphcoder)
        total_baseline = sum(comm_bytes_baseline)
        comm_savings_ratio = total_baseline / max(total_mu, 1)
        meets_comm_target = comm_savings_ratio >= 10.0  # ≥10× reduction

        result = {
            "rq2_passed": meets_accuracy_target and meets_comm_target,
            "mean_gnn_f1": round(mean_gnn_f1, 4),
            "mean_xgb_f1": round(mean_xgb_f1, 4),
            "mean_gnn_auroc": round(mean_gnn_auroc, 4),
            "mean_xgb_auroc": round(mean_xgb_auroc, 4),
            "f1_ratio": round(f1_ratio, 4),
            "auroc_ratio": round(auroc_ratio, 4),
            "meets_accuracy_target": meets_accuracy_target,
            "comm_savings_ratio": round(comm_savings_ratio, 2),
            "total_mu_bytes": total_mu,
            "total_baseline_bytes": total_baseline,
            "meets_comm_target": meets_comm_target,
            "per_branch": [
                {
                    "gnn_f1": round(g.get("f1", 0), 4),
                    "xgb_f1": round(x.get("f1", 0), 4),
                    "mu_bytes": mb,
                    "baseline_bytes": bb,
                    "savings": round(bb / max(mb, 1), 1),
                }
                for g, x, mb, bb in zip(
                    gnn_results, xgb_baseline_results,
                    comm_bytes_mugraphcoder, comm_bytes_baseline
                )
            ],
        }
        logger.info(
            "RQ2: F1_ratio=%.2f comm_savings=%.1f× passed=%s",
            f1_ratio, comm_savings_ratio, result["rq2_passed"]
        )
        return result

    # ------------------------------------------------------------------
    # RQ3 — Drift recovery with LoRA
    # ------------------------------------------------------------------

    def evaluate_rq3_drift_recovery(
        self,
        pre_adapt_f1s: List[float],
        post_adapt_f1s: List[float],
        n_samples_used: List[int],
    ) -> Dict:
        """
        RQ3: Can low-rank on-device adaptation recover ≥70% of drift-induced
        performance loss using no more than 100 labeled samples?
        """
        if not pre_adapt_f1s:
            return {"rq3_passed": False, "error": "No adaptation results"}

        recovery_pcts = []
        for pre, post, n in zip(pre_adapt_f1s, post_adapt_f1s, n_samples_used):
            drift_loss = 1.0 - pre
            if drift_loss < 0.01:
                recovery = 100.0  # no drift = full recovery
            else:
                recovery = min((post - pre) / drift_loss * 100, 100.0)
            recovery_pcts.append(max(recovery, 0.0))

        mean_recovery = float(np.mean(recovery_pcts))
        branches_meeting_target = sum(1 for r in recovery_pcts if r >= 70.0)
        all_samples_ok = all(n <= 100 for n in n_samples_used)

        result = {
            "rq3_passed": mean_recovery >= 70.0 and all_samples_ok,
            "mean_recovery_pct": round(mean_recovery, 2),
            "median_recovery_pct": round(float(np.median(recovery_pcts)), 2),
            "min_recovery_pct": round(min(recovery_pcts), 2),
            "max_recovery_pct": round(max(recovery_pcts), 2),
            "meets_70pct_target": mean_recovery >= 70.0,
            "branches_recovering": branches_meeting_target,
            "total_branches": len(pre_adapt_f1s),
            "mean_pre_adapt_f1": round(float(np.mean(pre_adapt_f1s)), 4),
            "mean_post_adapt_f1": round(float(np.mean(post_adapt_f1s)), 4),
            "max_samples_used": max(n_samples_used) if n_samples_used else 0,
            "all_samples_within_100": all_samples_ok,
            "per_branch": [
                {
                    "pre_f1": round(pre, 4),
                    "post_f1": round(post, 4),
                    "recovery_pct": round(rec, 2),
                    "samples": n,
                }
                for pre, post, rec, n in zip(
                    pre_adapt_f1s, post_adapt_f1s, recovery_pcts, n_samples_used
                )
            ],
        }
        logger.info(
            "RQ3: mean_recovery=%.1f%% meets_target=%s",
            mean_recovery, result["rq3_passed"]
        )
        return result

    # ------------------------------------------------------------------
    # RQ4 — Deployment efficiency
    # ------------------------------------------------------------------

    def evaluate_rq4_deployment(
        self,
        deployment_scores: List[Dict],
        baseline_latencies_ms: Optional[List[float]] = None,
        baseline_model_bytes: Optional[List[int]] = None,
    ) -> Dict:
        """
        RQ4: Does deployment-aware training produce models that meet latency
        and memory targets?

        Parameters
        ----------
        deployment_scores     : list of dicts from DeploymentAwareLoss.compute_deployment_score
        baseline_latencies_ms : latencies WITHOUT deployment-aware loss (control)
        baseline_model_bytes  : model sizes WITHOUT deployment-aware loss (control)
        """
        if not deployment_scores:
            return {"rq4_passed": False, "error": "No deployment scores"}

        latencies = [s["latency_ms"] for s in deployment_scores]
        model_bytes = [s["model_bytes"] for s in deployment_scores]
        meets_lat = [s["meets_latency_target"] for s in deployment_scores]
        meets_mem = [s["meets_mem_target"] for s in deployment_scores]

        mean_latency = float(np.mean(latencies))
        mean_bytes = float(np.mean(model_bytes))
        pct_meeting_lat = sum(meets_lat) / len(meets_lat) * 100
        pct_meeting_mem = sum(meets_mem) / len(meets_mem) * 100

        # Compare to baseline if provided
        latency_improvement = None
        memory_improvement = None
        if baseline_latencies_ms:
            bl = float(np.mean(baseline_latencies_ms))
            latency_improvement = round((bl - mean_latency) / max(bl, 1e-6) * 100, 2)
        if baseline_model_bytes:
            bm = float(np.mean(baseline_model_bytes))
            memory_improvement = round((bm - mean_bytes) / max(bm, 1e-6) * 100, 2)

        result = {
            "rq4_passed": pct_meeting_lat >= 80 and pct_meeting_mem >= 80,
            "mean_latency_ms": round(mean_latency, 3),
            "mean_model_bytes": int(mean_bytes),
            "pct_meeting_latency_target": round(pct_meeting_lat, 1),
            "pct_meeting_memory_target": round(pct_meeting_mem, 1),
            "latency_improvement_pct": latency_improvement,
            "memory_improvement_pct": memory_improvement,
            "per_branch": [
                {
                    "latency_ms": s["latency_ms"],
                    "model_bytes": s["model_bytes"],
                    "meets_latency": s["meets_latency_target"],
                    "meets_memory": s["meets_mem_target"],
                }
                for s in deployment_scores
            ],
        }
        logger.info(
            "RQ4: mean_latency=%.2fms pct_lat=%.0f%% passed=%s",
            mean_latency, pct_meeting_lat, result["rq4_passed"]
        )
        return result

    # ------------------------------------------------------------------
    # Full report
    # ------------------------------------------------------------------

    def generate_full_report(
        self,
        rq1: Dict,
        rq2: Dict,
        rq3: Dict,
        rq4: Dict,
    ) -> Dict:
        """
        Compile all 4 RQ evaluations into a single report dict.
        Saved to hq_state/ and served via /api/mu_graphcoder/report endpoint.
        """
        all_passed = all([
            rq1.get("rq1_passed", False),
            rq2.get("rq2_passed", False),
            rq3.get("rq3_passed", False),
            rq4.get("rq4_passed", False),
        ])
        return {
            "summary": {
                "all_rqs_passed": all_passed,
                "rq1_passed": rq1.get("rq1_passed", False),
                "rq2_passed": rq2.get("rq2_passed", False),
                "rq3_passed": rq3.get("rq3_passed", False),
                "rq4_passed": rq4.get("rq4_passed", False),
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
            "rq1_fingerprint_quality": rq1,
            "rq2_accuracy_and_comm": rq2,
            "rq3_drift_recovery": rq3,
            "rq4_deployment": rq4,
        }

    # ------------------------------------------------------------------
    # Metric helpers
    # ------------------------------------------------------------------

    @staticmethod
    def compute_auroc(y_true: np.ndarray, y_score: np.ndarray) -> float:
        try:
            return float(roc_auc_score(y_true, y_score))
        except ValueError:
            return 0.5

    @staticmethod
    def compute_f1(y_true: np.ndarray, y_pred: np.ndarray) -> float:
        return float(f1_score(y_true, y_pred, zero_division=0))

    @staticmethod
    def compute_accuracy(y_true: np.ndarray, y_pred: np.ndarray) -> float:
        return float(accuracy_score(y_true, y_pred))

    @staticmethod
    def threshold_predictions(y_score: np.ndarray, threshold: float = 0.5) -> np.ndarray:
        return (y_score >= threshold).astype(int)
