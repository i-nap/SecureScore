"""
mu_graph_coder/tiny_gnn.py

TinyGNN: 2–4 layer Graph Neural Network for credit default prediction.
No external GNN library required — message-passing implemented via manual
scatter operations on edge_index (torch_geometric NOT required).

Paper reference: Section IV.C — "small GNN with 2–4 layers and 32–64 hidden
units per layer, quantized to 8-bit integers"
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, List, Dict

try:
    from torch.quantization import quantize_dynamic
    _QUANT_AVAILABLE = True
except ImportError:
    _QUANT_AVAILABLE = False


class TinyGNNLayer(nn.Module):
    """
    Single message-passing layer using GraphSAGE-style mean aggregation.
    Edge features are gated into the neighbourhood aggregation.
    """

    def __init__(self, in_dim: int, out_dim: int, edge_dim: int = 3, dropout: float = 0.1):
        super().__init__()
        self.self_proj = nn.Linear(in_dim, out_dim, bias=True)
        self.neigh_proj = nn.Linear(in_dim, out_dim, bias=False)
        self.edge_gate = nn.Linear(edge_dim, out_dim, bias=False)
        self.norm = nn.LayerNorm(out_dim)
        self.dropout = nn.Dropout(dropout)

    def forward(
        self,
        x: torch.Tensor,           # (N, in_dim)
        edge_index: torch.Tensor,  # (2, E)  long
        edge_attr: torch.Tensor,   # (E, edge_dim) float
    ) -> torch.Tensor:
        N = x.size(0)
        if edge_index.numel() == 0 or edge_index.shape[1] == 0:
            # No edges — self-projection only
            return self.norm(F.relu(self.self_proj(x)))

        src, dst = edge_index[0], edge_index[1]  # src→dst messages

        # Message: neighbour projection + edge gate
        msg = self.neigh_proj(x[src]) + self.edge_gate(edge_attr)  # (E, out_dim)

        # Aggregate: scatter mean over destination nodes
        agg = torch.zeros(N, msg.size(1), device=x.device, dtype=x.dtype)
        agg.scatter_add_(0, dst.unsqueeze(1).expand_as(msg), msg)

        # Count neighbours per node for mean aggregation
        count = torch.zeros(N, 1, device=x.device, dtype=x.dtype)
        ones = torch.ones(src.size(0), 1, device=x.device, dtype=x.dtype)
        count.scatter_add_(0, dst.unsqueeze(1), ones)
        count = count.clamp(min=1.0)

        agg = agg / count  # mean aggregation

        h = self.self_proj(x) + agg
        h = self.norm(F.relu(h))
        return self.dropout(h)


class TinyGNN(nn.Module):
    """
    Tiny Graph Neural Network for per-node binary classification (credit default).

    Hypernetwork loads weight tensors into this architecture after reconstruction
    from the VQ codebook. The architecture is fixed; only weights vary per branch.
    """

    def __init__(
        self,
        in_dim: int = 8,
        hidden_dim: int = 32,
        out_dim: int = 1,
        n_layers: int = 2,
        dropout: float = 0.1,
        edge_dim: int = 3,
    ):
        super().__init__()
        assert 2 <= n_layers <= 4, "TinyGNN supports 2–4 layers (paper constraint)"
        assert hidden_dim in (32, 64), "TinyGNN uses 32 or 64 hidden units (paper constraint)"

        self.in_dim = in_dim
        self.hidden_dim = hidden_dim
        self.out_dim = out_dim
        self.n_layers = n_layers
        self.edge_dim = edge_dim

        # Build layer list
        dims = [in_dim] + [hidden_dim] * n_layers
        self.layers = nn.ModuleList([
            TinyGNNLayer(dims[i], dims[i + 1], edge_dim=edge_dim, dropout=dropout)
            for i in range(n_layers)
        ])
        self.head = nn.Linear(hidden_dim, out_dim)

    def forward(
        self,
        x: torch.Tensor,
        edge_index: torch.Tensor,
        edge_attr: torch.Tensor,
        batch: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """
        Parameters
        ----------
        x          : (N, in_dim)
        edge_index : (2, E)
        edge_attr  : (E, edge_dim)
        batch      : (N,) optional — graph-level pooling index

        Returns
        -------
        logits : (N, 1) per-node logits  [or (B, 1) if batch supplied]
        """
        h = x
        for layer in self.layers:
            h = layer(h, edge_index, edge_attr)

        if batch is not None:
            # Global mean pooling for graph-level tasks
            B = int(batch.max().item()) + 1
            pooled = torch.zeros(B, h.size(1), device=h.device, dtype=h.dtype)
            pooled.scatter_add_(0, batch.unsqueeze(1).expand_as(h), h)
            count = torch.bincount(batch, minlength=B).float().unsqueeze(1).clamp(min=1)
            h = pooled / count

        return self.head(h)  # (N, 1) or (B, 1)

    # ------------------------------------------------------------------
    # Weight tensor access — used by hypernetwork for reconstruction
    # ------------------------------------------------------------------

    def get_all_weight_tensors(self) -> List[torch.Tensor]:
        """Return all parameter tensors in a consistent, ordered list."""
        tensors = []
        for layer in self.layers:
            tensors.append(layer.self_proj.weight)
            tensors.append(layer.self_proj.bias)
            tensors.append(layer.neigh_proj.weight)
            tensors.append(layer.edge_gate.weight)
            tensors.append(layer.norm.weight)
            tensors.append(layer.norm.bias)
        tensors.append(self.head.weight)
        tensors.append(self.head.bias)
        return tensors

    def get_weight_shapes(self) -> List[tuple]:
        return [t.shape for t in self.get_all_weight_tensors()]

    def load_weight_tensors(self, tensors: List[torch.Tensor]) -> None:
        """Load externally generated weight tensors into this model."""
        own = self.get_all_weight_tensors()
        if len(tensors) != len(own):
            raise ValueError(
                f"Expected {len(own)} weight tensors, got {len(tensors)}"
            )
        with torch.no_grad():
            for param, new_w in zip(own, tensors):
                if param.shape != new_w.shape:
                    raise ValueError(
                        f"Shape mismatch: expected {param.shape}, got {new_w.shape}"
                    )
                param.copy_(new_w)

    @property
    def total_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters())

    @property
    def total_bytes(self) -> int:
        return self.total_parameters * 4  # float32

    @staticmethod
    def from_config(config: Dict) -> "TinyGNN":
        """Factory from hypernetwork-generated config dict."""
        return TinyGNN(
            in_dim=config.get("in_dim", 8),
            hidden_dim=config.get("hidden_dim", 32),
            out_dim=config.get("out_dim", 1),
            n_layers=config.get("n_layers", 2),
            dropout=config.get("dropout", 0.1),
            edge_dim=config.get("edge_dim", 3),
        )

    def to_config(self) -> Dict:
        return {
            "in_dim": self.in_dim,
            "hidden_dim": self.hidden_dim,
            "out_dim": self.out_dim,
            "n_layers": self.n_layers,
            "dropout": 0.1,
            "edge_dim": self.edge_dim,
        }


# ------------------------------------------------------------------
# Quantization helpers
# ------------------------------------------------------------------

def quantize_to_int8(model: TinyGNN) -> nn.Module:
    """
    Post-training dynamic quantisation to INT8.
    Uses torch.quantization.quantize_dynamic on all Linear layers.
    Returns a quantized copy (original model unchanged).
    """
    if not _QUANT_AVAILABLE:
        return model
    return quantize_dynamic(model, {nn.Linear}, dtype=torch.qint8)


def count_model_bytes(model: nn.Module) -> int:
    """Return total parameter bytes (float32 = 4 bytes each)."""
    return sum(p.numel() * p.element_size() for p in model.parameters())


def score_customers(
    gnn: TinyGNN,
    node_features: torch.Tensor,
    edge_index: torch.Tensor,
    edge_attr: torch.Tensor,
) -> torch.Tensor:
    """
    Convenience wrapper: run GNN inference and return per-node probabilities.
    Returns shape (N,) float32 probabilities in [0, 1].
    """
    gnn.eval()
    with torch.no_grad():
        logits = gnn(node_features, edge_index, edge_attr)  # (N, 1)
        probs = torch.sigmoid(logits).squeeze(1)            # (N,)
    return probs
