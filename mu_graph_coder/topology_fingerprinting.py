"""
mu_graph_coder/topology_fingerprinting.py

Builds a customer transaction graph from branch data and computes a compact
topology fingerprint vector (<=512 bytes) summarising the branch's graph structure.

Paper reference: Section IV.B — Topology Fingerprinting
  ft components: degree histograms, Laplacian eigenvalue sketch,
                 edge weight statistics, node churn & entropy measures
"""

import base64
import hashlib
import logging
import warnings
from typing import Optional, Tuple

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix, csr_matrix
from scipy.sparse.linalg import eigsh
from sklearn.preprocessing import StandardScaler
from sklearn.metrics.pairwise import cosine_similarity

logger = logging.getLogger(__name__)

# 8 node features used consistently across all branches
NODE_FEATURE_COLS = [
    "income",
    "age",
    "credit_utilization",
    "debt_to_income_ratio",
    "total_transaction_volume",
    "digital_engagement_score",
    "alternative_credit_score",
    "tx_count",
]

# Fallback aliases if canonical names are absent (generated_data column variants)
_COL_ALIASES = {
    "income": ["annual_income", "monthly_income", "income_estimate"],
    "age": ["customer_age", "applicant_age"],
    "credit_utilization": ["utilization_rate", "credit_utilization_ratio"],
    "debt_to_income_ratio": ["dti_ratio", "dti"],
    "total_transaction_volume": ["total_spent", "dw_total_spent", "total_tx_amount"],
    "digital_engagement_score": ["digital_score", "engagement_score"],
    "alternative_credit_score": ["alt_credit_score", "behavioral_score"],
    "tx_count": ["transaction_count", "dw_tx_count", "num_transactions"],
}

# Fingerprint layout (44 floats × 4 bytes = 176 bytes << 512 byte limit)
_FP_DEGREE_BINS = 16       # degree histogram
_FP_EIGENVALUES = 10       # Laplacian eigenvalue sketch
_FP_EDGE_STATS = 4         # [mean, std, max, entropy]
_FP_NODE_STATS = 8         # mean of each node feature
_FP_GRAPH_SUMMARY = 4      # [density, n_nodes_norm, n_edges_norm, clustering_approx]
_FP_CHURN = 2              # [node_churn_rate, edge_churn_rate]
_FP_TOTAL = (_FP_DEGREE_BINS + _FP_EIGENVALUES + _FP_EDGE_STATS +
             _FP_NODE_STATS + _FP_GRAPH_SUMMARY + _FP_CHURN)  # = 44


class TopologyFingerprinter:
    """
    Constructs a customer transaction graph from branch tabular data and computes
    a deterministic, fixed-length topology fingerprint vector.

    Graph:
        Nodes  = customers (node features = 8 financial metrics)
        Edges  = shared merchants | temporal co-occurrence | spending similarity
        Weight = normalized overlap/similarity score
    """

    def __init__(
        self,
        cosine_sim_threshold: float = 0.8,
        temporal_window_days: int = 7,
        max_nodes: int = 500,
        n_eigenvalues: int = _FP_EIGENVALUES,
        degree_bins: int = _FP_DEGREE_BINS,
        random_seed: int = 42,
    ):
        self.cosine_sim_threshold = cosine_sim_threshold
        self.temporal_window_days = temporal_window_days
        self.max_nodes = max_nodes
        self.n_eigenvalues = n_eigenvalues
        self.degree_bins = degree_bins
        self.random_seed = random_seed
        self._prev_fingerprint: Optional[np.ndarray] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def build_graph(
        self,
        ucp_df: pd.DataFrame,
        tx_df: Optional[pd.DataFrame] = None,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Build the customer transaction graph.

        Returns
        -------
        node_features : np.ndarray  shape (N, 8)   float32
        edge_index    : np.ndarray  shape (2, E)   int64
        edge_features : np.ndarray  shape (E, 3)   float32
            columns: [tx_count_norm, log1p_volume_norm, merchant_overlap_norm]
        """
        ucp = ucp_df.copy().reset_index(drop=True)

        # Deterministic ordering
        if "customer_id" in ucp.columns:
            ucp = ucp.sort_values("customer_id").reset_index(drop=True)

        # Subsample if too large
        if len(ucp) > self.max_nodes:
            rng = np.random.default_rng(self.random_seed)
            idx = rng.choice(len(ucp), self.max_nodes, replace=False)
            idx.sort()
            ucp = ucp.iloc[idx].reset_index(drop=True)

        N = len(ucp)
        node_features = self._extract_node_features(ucp)   # (N, 8)

        # Build edge sets
        rows, cols, weights_tx, weights_sim, weights_time = [], [], [], [], []

        # 1. Spending-similarity edges
        sim_src, sim_dst, sim_vals = self._similarity_edges(node_features)
        rows.extend(sim_src); cols.extend(sim_dst)
        weights_sim.extend(sim_vals)
        weights_tx.extend([0.0] * len(sim_src))
        weights_time.extend([0.0] * len(sim_src))

        # 2. Merchant co-occurrence edges (from transaction data)
        if tx_df is not None and len(tx_df) > 0:
            m_src, m_dst, m_tx, m_vol = self._merchant_edges(ucp, tx_df)
            rows.extend(m_src); cols.extend(m_dst)
            weights_tx.extend(m_tx)
            weights_sim.extend([0.0] * len(m_src))
            weights_time.extend(m_vol)

        if len(rows) == 0:
            # Isolated graph — return empty edges
            edge_index = np.zeros((2, 0), dtype=np.int64)
            edge_features = np.zeros((0, 3), dtype=np.float32)
            return node_features, edge_index, edge_features

        # Combine into arrays and deduplicate (keep max weight per pair)
        edge_index, edge_features = self._build_edge_tensors(
            rows, cols, weights_tx, weights_sim, weights_time, N
        )
        return node_features, edge_index, edge_features

    def compute_fingerprint(
        self,
        node_features: np.ndarray,
        edge_index: np.ndarray,
        edge_features: np.ndarray,
    ) -> np.ndarray:
        """
        Compute a deterministic fingerprint vector of exactly _FP_TOTAL floats.
        Layout: [degree_hist(16) | eigenvalues(10) | edge_stats(4) |
                 node_means(8) | graph_summary(4) | churn(2)]
        """
        N = node_features.shape[0]
        E = edge_index.shape[1] if edge_index.ndim == 2 else 0

        fp = np.zeros(_FP_TOTAL, dtype=np.float32)
        cursor = 0

        # --- Degree histogram (16 bins) ---
        if E > 0:
            degrees = np.bincount(edge_index[0], minlength=N).astype(np.float32)
            max_deg = max(degrees.max(), 1.0)
            hist, _ = np.histogram(degrees / max_deg, bins=self.degree_bins, range=(0, 1))
            fp[cursor:cursor + self.degree_bins] = hist / max(hist.sum(), 1.0)
        cursor += self.degree_bins

        # --- Laplacian eigenvalue sketch (10 values) ---
        evals = self._laplacian_eigenvalues(edge_index, E, N)
        n_ev = min(len(evals), self.n_eigenvalues)
        fp[cursor:cursor + n_ev] = evals[:n_ev]
        cursor += self.n_eigenvalues

        # --- Edge weight statistics (4 values) ---
        if E > 0:
            # Use first edge feature channel (tx_count_norm) as primary weight
            w = edge_features[:, 0]
            w_mean = float(w.mean())
            w_std = float(w.std())
            w_max = float(w.max())
            # Shannon entropy of discretized weights
            hist_w, _ = np.histogram(w, bins=16, range=(0, 1))
            prob = hist_w / max(hist_w.sum(), 1)
            prob = prob[prob > 0]
            w_entropy = float(-np.sum(prob * np.log(prob + 1e-10)))
            fp[cursor:cursor + 4] = [w_mean, w_std, w_max, w_entropy]
        cursor += _FP_EDGE_STATS

        # --- Node feature means (8 values) ---
        node_means = node_features.mean(axis=0)[:_FP_NODE_STATS]
        fp[cursor:cursor + _FP_NODE_STATS] = node_means.astype(np.float32)
        cursor += _FP_NODE_STATS

        # --- Graph summary (4 values) ---
        density = (2 * E) / max(N * (N - 1), 1)
        n_nodes_norm = N / self.max_nodes
        n_edges_norm = E / max(N * 5, 1)  # normalise by expected ~5 edges/node
        # Approximate clustering coefficient: triangle density proxy
        clustering_approx = min(E / max(N * 2, 1), 1.0)
        fp[cursor:cursor + 4] = [density, n_nodes_norm, n_edges_norm, clustering_approx]
        cursor += _FP_GRAPH_SUMMARY

        # --- Churn metrics (2 values) ---
        if self._prev_fingerprint is not None:
            prev = self._prev_fingerprint
            node_churn = float(np.abs(fp[cursor - 4] - prev[cursor - 4]))
            edge_churn = float(np.abs(fp[cursor - 3] - prev[cursor - 3]))
        else:
            node_churn, edge_churn = 0.0, 0.0
        fp[cursor:cursor + 2] = [node_churn, edge_churn]

        # Store for next call
        self._prev_fingerprint = fp.copy()

        assert len(fp) == _FP_TOTAL, f"Fingerprint length mismatch: {len(fp)} != {_FP_TOTAL}"
        return fp

    def fingerprint_to_bytes(self, fp: np.ndarray) -> bytes:
        """Serialise fingerprint to bytes (float32 = 4 bytes × 44 = 176 bytes)."""
        return fp.astype(np.float32).tobytes()

    def fingerprint_from_bytes(self, b: bytes) -> np.ndarray:
        return np.frombuffer(b, dtype=np.float32).copy()

    def serialize_b64(self, fp: np.ndarray) -> str:
        return base64.b64encode(self.fingerprint_to_bytes(fp)).decode("ascii")

    def deserialize_b64(self, s: str) -> np.ndarray:
        return self.fingerprint_from_bytes(base64.b64decode(s))

    def fingerprint_hash(self, fp: np.ndarray) -> str:
        return hashlib.sha256(self.fingerprint_to_bytes(fp)).hexdigest()[:16]

    @staticmethod
    def fingerprint_dim() -> int:
        return _FP_TOTAL

    @staticmethod
    def fingerprint_byte_size() -> int:
        return _FP_TOTAL * 4  # float32

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _extract_node_features(self, ucp: pd.DataFrame) -> np.ndarray:
        """Extract and normalise the 8 node feature columns."""
        feature_matrix = np.zeros((len(ucp), len(NODE_FEATURE_COLS)), dtype=np.float32)
        for i, col in enumerate(NODE_FEATURE_COLS):
            if col in ucp.columns:
                vals = pd.to_numeric(ucp[col], errors="coerce").fillna(0.0).values
            else:
                # Try aliases
                found = False
                for alias in _COL_ALIASES.get(col, []):
                    if alias in ucp.columns:
                        vals = pd.to_numeric(ucp[alias], errors="coerce").fillna(0.0).values
                        found = True
                        break
                if not found:
                    vals = np.zeros(len(ucp), dtype=np.float32)
            feature_matrix[:, i] = vals.astype(np.float32)

        # StandardScaler (local branch only — preserves data isolation)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            scaler = StandardScaler()
            feature_matrix = scaler.fit_transform(feature_matrix).astype(np.float32)
        return feature_matrix

    def _similarity_edges(
        self, node_features: np.ndarray
    ) -> Tuple[list, list, list]:
        """
        Add edges between customers with cosine similarity > threshold.
        Returns (src_list, dst_list, sim_values).
        """
        N = node_features.shape[0]
        if N < 2:
            return [], [], []

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            sim_matrix = cosine_similarity(node_features)  # (N, N)

        # Zero out diagonal and lower triangle (undirected)
        np.fill_diagonal(sim_matrix, 0.0)
        src, dst = np.where(
            (sim_matrix > self.cosine_sim_threshold) & (np.triu(np.ones((N, N)), k=1) > 0)
        )
        vals = sim_matrix[src, dst].tolist()
        # Add both directions for undirected graph
        src_all = list(src) + list(dst)
        dst_all = list(dst) + list(src)
        vals_all = vals + vals
        return src_all, dst_all, vals_all

    def _merchant_edges(
        self,
        ucp: pd.DataFrame,
        tx_df: pd.DataFrame,
    ) -> Tuple[list, list, list, list]:
        """
        Add edges between customers who share top merchants.
        Returns (src, dst, tx_count_norm, log_volume_norm).
        """
        if "customer_id" not in ucp.columns or "customer_id" not in tx_df.columns:
            return [], [], [], []
        if "merchant" not in tx_df.columns and "merchant_name" not in tx_df.columns:
            return [], [], [], []

        merchant_col = "merchant" if "merchant" in tx_df.columns else "merchant_name"
        amount_col = next(
            (c for c in ["amount", "transaction_amount", "tx_amount"] if c in tx_df.columns),
            None
        )

        cid_to_idx = {cid: i for i, cid in enumerate(ucp["customer_id"].values)}

        # Top-5 merchants per customer
        tx_local = tx_df[tx_df["customer_id"].isin(cid_to_idx)]
        merchant_map: dict = {}  # merchant → list of customer indices
        for cid, grp in tx_local.groupby("customer_id"):
            if cid not in cid_to_idx:
                continue
            top_merchants = grp[merchant_col].value_counts().head(5).index.tolist()
            for m in top_merchants:
                merchant_map.setdefault(m, []).append(cid_to_idx[cid])

        src_list, dst_list, tx_list, vol_list = [], [], [], []
        seen = set()
        for merchant, cust_idxs in merchant_map.items():
            if len(cust_idxs) < 2:
                continue
            for i in range(len(cust_idxs)):
                for j in range(i + 1, len(cust_idxs)):
                    a, b = cust_idxs[i], cust_idxs[j]
                    key = (min(a, b), max(a, b))
                    if key in seen:
                        continue
                    seen.add(key)
                    # Edge weight: normalised by merchant count
                    overlap = 1.0 / max(len(cust_idxs), 1)
                    if amount_col:
                        vol = float(tx_local[tx_local["customer_id"].isin(
                            [ucp.iloc[a]["customer_id"], ucp.iloc[b]["customer_id"]]
                        )][amount_col].sum())
                    else:
                        vol = 1.0
                    src_list += [a, b]; dst_list += [b, a]
                    tx_list += [overlap, overlap]
                    vol_list += [np.log1p(vol), np.log1p(vol)]

        return src_list, dst_list, tx_list, vol_list

    def _build_edge_tensors(
        self,
        rows: list, cols: list,
        weights_tx: list, weights_sim: list, weights_time: list,
        N: int,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Deduplicate edges and build (2, E) edge_index + (E, 3) edge_features."""
        if not rows:
            return np.zeros((2, 0), dtype=np.int64), np.zeros((0, 3), dtype=np.float32)

        r = np.array(rows, dtype=np.int64)
        c = np.array(cols, dtype=np.int64)
        tx = np.array(weights_tx, dtype=np.float32)
        sim = np.array(weights_sim, dtype=np.float32)
        time = np.array(weights_time, dtype=np.float32)

        # Clip to valid node indices
        valid = (r >= 0) & (r < N) & (c >= 0) & (c < N)
        r, c, tx, sim, time = r[valid], c[valid], tx[valid], sim[valid], time[valid]

        if len(r) == 0:
            return np.zeros((2, 0), dtype=np.int64), np.zeros((0, 3), dtype=np.float32)

        # Deduplicate by keeping first occurrence (stable)
        keys = r * N + c
        _, unique_idx = np.unique(keys, return_index=True)
        r = r[unique_idx]; c = c[unique_idx]
        tx = tx[unique_idx]; sim = sim[unique_idx]; time = time[unique_idx]

        # Normalize each channel to [0, 1]
        def _norm(v):
            vmax = v.max()
            return v / vmax if vmax > 0 else v

        edge_features = np.stack([_norm(tx), _norm(sim), _norm(time)], axis=1).astype(np.float32)
        edge_index = np.stack([r, c], axis=0).astype(np.int64)
        return edge_index, edge_features

    def _laplacian_eigenvalues(
        self, edge_index: np.ndarray, E: int, N: int
    ) -> np.ndarray:
        """Compute top-k smallest eigenvalues of the normalised graph Laplacian."""
        if E == 0 or N < 3:
            return np.zeros(self.n_eigenvalues, dtype=np.float32)

        try:
            src = edge_index[0]; dst = edge_index[1]
            data = np.ones(len(src), dtype=np.float64)
            A = csr_matrix((data, (src, dst)), shape=(N, N))
            A = A + A.T  # make symmetric (undirected)
            A.data = np.ones_like(A.data)  # binarize

            degrees = np.asarray(A.sum(axis=1)).flatten()
            safe_deg = np.where(degrees > 0, degrees, 1.0)
            d_inv_sqrt = np.where(degrees > 0, 1.0 / np.sqrt(safe_deg), 0.0)
            D_inv_sqrt = csr_matrix(
                (d_inv_sqrt, (np.arange(N), np.arange(N))), shape=(N, N)
            )
            L_norm = (
                csr_matrix(np.eye(N))
                - D_inv_sqrt @ A @ D_inv_sqrt
            )

            k = min(self.n_eigenvalues, N - 2)
            if k < 1:
                return np.zeros(self.n_eigenvalues, dtype=np.float32)

            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                evals, _ = eigsh(L_norm, k=k, which="SM", tol=1e-3, maxiter=1000)

            evals = np.sort(np.real(evals)).astype(np.float32)
            # Pad to n_eigenvalues
            result = np.zeros(self.n_eigenvalues, dtype=np.float32)
            result[:len(evals)] = evals
            return result

        except Exception as exc:
            logger.debug("Eigenvalue computation failed: %s", exc)
            return np.zeros(self.n_eigenvalues, dtype=np.float32)
