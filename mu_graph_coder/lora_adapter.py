"""
mu_graph_coder/lora_adapter.py

On-device Low-Rank Adaptation (LoRA) for TinyGNN.
Augments each frozen Linear weight with trainable low-rank matrices:
    W' = W_frozen + A @ B^T
where A ∈ R^{d_out × r}, B ∈ R^{d_in × r}, rank r ≤ 4.

Adapters are trained on ≤ 100 labeled samples to recover from concept drift
between hypernetwork regeneration cycles.

Paper reference: Section IV.D — "W' = W̃ + AB^T, A ∈ R^{d×r}, B ∈ R^{d×r},
rank r ≤ 4 ... trained on-device using at most 100 labeled samples"
"""

import os
import logging
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.optim as optim
import torch.nn.functional as F
from sklearn.metrics import f1_score

from .tiny_gnn import TinyGNN

logger = logging.getLogger(__name__)


class LoRALinear(nn.Module):
    """
    Wraps a frozen Linear weight with low-rank adaptation.
    Only A and B are trained; W_frozen is not updated.
    """

    def __init__(
        self,
        frozen_weight: torch.Tensor,   # (d_out, d_in)
        frozen_bias: Optional[torch.Tensor],
        rank: int = 4,
        alpha: float = 16.0,           # scaling factor (LoRA convention: alpha/rank)
    ):
        super().__init__()
        d_out, d_in = frozen_weight.shape

        self.register_buffer("W_frozen", frozen_weight.detach().clone())
        if frozen_bias is not None:
            self.register_buffer("b_frozen", frozen_bias.detach().clone())
        else:
            self.b_frozen = None

        self.rank = rank
        self.scale = alpha / rank

        # Low-rank matrices: A ~ N(0, 0.02), B = 0 (standard LoRA init)
        self.A = nn.Parameter(torch.randn(d_out, rank) * 0.02)
        self.B = nn.Parameter(torch.zeros(rank, d_in))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # W'x = (W_frozen + A @ B) x + b
        W_adapted = self.W_frozen + self.scale * (self.A @ self.B)
        out = F.linear(x, W_adapted, self.b_frozen)
        return out

    def get_merged_weight(self) -> torch.Tensor:
        """Return W' = W_frozen + scale * A @ B for baking into model."""
        return self.W_frozen + self.scale * (self.A @ self.B)

    def adapter_parameters(self) -> List[nn.Parameter]:
        return [self.A, self.B]


class LoRAAdapter:
    """
    Wraps all Linear layers in a TinyGNN with LoRA layers.
    Provides few-shot on-device adaptation to handle concept drift.

    Usage
    -----
    adapter = LoRAAdapter(gnn, rank=4)
    metrics = adapter.adapt(x, edge_index, edge_attr, labels, n_steps=100)
    adapted_gnn = adapter.get_adapted_gnn()
    """

    def __init__(self, gnn: TinyGNN, rank: int = 4, alpha: float = 16.0):
        assert 1 <= rank <= 4, "Paper constraint: rank r ≤ 4"
        self.rank = rank
        self.alpha = alpha
        self.gnn = gnn
        self._lora_layers: Dict[str, LoRALinear] = {}
        self._patched = False
        self._patch_gnn()

    def _patch_gnn(self) -> None:
        """Replace Linear layers inside TinyGNNLayer with LoRALinear wrappers."""
        for layer_idx, gnn_layer in enumerate(self.gnn.layers):
            for proj_name in ("self_proj", "neigh_proj", "edge_gate"):
                linear = getattr(gnn_layer, proj_name, None)
                if linear is None or not hasattr(linear, "weight"):
                    continue
                key = f"layer{layer_idx}.{proj_name}"
                lora = LoRALinear(
                    linear.weight, linear.bias,
                    rank=self.rank, alpha=self.alpha
                )
                self._lora_layers[key] = lora
                setattr(gnn_layer, proj_name, lora)

        # Also patch the classification head
        head = self.gnn.head
        key = "head"
        lora = LoRALinear(head.weight, head.bias, rank=self.rank, alpha=self.alpha)
        self._lora_layers[key] = lora
        self.gnn.head = lora
        self._patched = True

    def _adapter_params(self) -> List[nn.Parameter]:
        params = []
        for lora in self._lora_layers.values():
            params.extend(lora.adapter_parameters())
        return params

    def adapt(
        self,
        node_features: torch.Tensor,
        edge_index: torch.Tensor,
        edge_attr: torch.Tensor,
        labels: torch.Tensor,
        n_steps: int = 100,
        lr: float = 1e-3,
        max_samples: int = 100,
    ) -> Dict:
        """
        Fine-tune only the LoRA A, B matrices on ≤ max_samples labeled nodes.

        Parameters
        ----------
        node_features : (N, in_dim)
        edge_index    : (2, E)
        edge_attr     : (E, 3)
        labels        : (N,) binary float labels
        n_steps       : adaptation gradient steps (≤ 100 in paper)
        max_samples   : maximum labeled samples to use (paper: ≤ 100)

        Returns
        -------
        dict with pre_adapt_f1, post_adapt_f1, drift_recovery_pct, steps, samples_used
        """
        if not self._patched:
            raise RuntimeError("LoRAAdapter not patched onto GNN")

        # Subsample labeled nodes if necessary
        N = node_features.size(0)
        labeled_idx = torch.where(labels >= 0)[0]
        if len(labeled_idx) > max_samples:
            perm = torch.randperm(len(labeled_idx))[:max_samples]
            labeled_idx = labeled_idx[perm]
        samples_used = len(labeled_idx)

        if samples_used == 0:
            logger.warning("No labeled samples available for LoRA adaptation")
            return {"pre_adapt_f1": 0.0, "post_adapt_f1": 0.0,
                    "drift_recovery_pct": 0.0, "steps": 0, "samples_used": 0}

        # Pre-adaptation F1
        pre_f1 = self._eval_f1(node_features, edge_index, edge_attr, labels)

        # Freeze base weights, train only A and B
        for param in self.gnn.parameters():
            param.requires_grad_(False)
        adapter_params = self._adapter_params()
        for p in adapter_params:
            p.requires_grad_(True)

        optimizer = optim.Adam(adapter_params, lr=lr)
        pos_weight = self._compute_pos_weight(labels[labeled_idx])
        criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

        self.gnn.train()
        for step in range(n_steps):
            optimizer.zero_grad()
            logits = self.gnn(node_features, edge_index, edge_attr)  # (N, 1)
            logits_labeled = logits[labeled_idx].squeeze(1)
            loss = criterion(logits_labeled, labels[labeled_idx].float())
            loss.backward()
            nn.utils.clip_grad_norm_(adapter_params, 1.0)
            optimizer.step()

        self.gnn.eval()
        post_f1 = self._eval_f1(node_features, edge_index, edge_attr, labels)

        # Restore base parameters to non-trainable
        for param in self.gnn.parameters():
            param.requires_grad_(False)

        # Drift recovery = improvement relative to loss (1 - pre_f1)
        drift_loss = 1.0 - pre_f1
        recovery = (post_f1 - pre_f1) / max(drift_loss, 1e-6)
        recovery_pct = round(min(recovery * 100, 100.0), 2)

        logger.info(
            "LoRA adaptation: pre_f1=%.3f post_f1=%.3f recovery=%.1f%% samples=%d steps=%d",
            pre_f1, post_f1, recovery_pct, samples_used, n_steps
        )
        return {
            "pre_adapt_f1": round(pre_f1, 4),
            "post_adapt_f1": round(post_f1, 4),
            "drift_recovery_pct": recovery_pct,
            "steps": n_steps,
            "samples_used": samples_used,
        }

    def get_adapted_gnn(self, bake_weights: bool = True) -> TinyGNN:
        """
        Return the adapted GNN. If bake_weights=True, fuse A@B back into
        frozen weights and return a clean TinyGNN (no LoRALinear wrappers).
        """
        if not bake_weights:
            return self.gnn

        # Create a fresh TinyGNN and copy merged weights
        adapted = TinyGNN.from_config(self.gnn.to_config())
        src_tensors = []
        for layer_idx, gnn_layer in enumerate(self.gnn.layers):
            for proj_name in ("self_proj", "neigh_proj", "edge_gate"):
                lora = getattr(gnn_layer, proj_name, None)
                if isinstance(lora, LoRALinear):
                    src_tensors.append(lora.get_merged_weight())
                    if lora.b_frozen is not None:
                        src_tensors.append(lora.b_frozen.detach().clone())
                    # norm and dropout layers are not LoRA-patched
                elif isinstance(lora, nn.Linear):
                    src_tensors.append(lora.weight.detach())
                    if lora.bias is not None:
                        src_tensors.append(lora.bias.detach())

        # Load into adapted model using the same tensor order as get_all_weight_tensors
        adapted_tensors = self._collect_adapted_tensors()
        adapted.load_weight_tensors(adapted_tensors)
        return adapted

    def _collect_adapted_tensors(self) -> List[torch.Tensor]:
        """Collect weight tensors in the same order as TinyGNN.get_all_weight_tensors."""
        tensors = []
        for gnn_layer in self.gnn.layers:
            # self_proj
            sp = gnn_layer.self_proj
            if isinstance(sp, LoRALinear):
                tensors.append(sp.get_merged_weight().detach())
                if sp.b_frozen is not None:
                    tensors.append(sp.b_frozen.detach())
                else:
                    tensors.append(torch.zeros(sp.get_merged_weight().shape[0]))
            else:
                tensors.append(sp.weight.detach())
                tensors.append(sp.bias.detach() if sp.bias is not None else torch.zeros(sp.out_features))

            # neigh_proj (no bias in plan)
            np_ = gnn_layer.neigh_proj
            if isinstance(np_, LoRALinear):
                tensors.append(np_.get_merged_weight().detach())
            else:
                tensors.append(np_.weight.detach())

            # edge_gate (no bias)
            eg = gnn_layer.edge_gate
            if isinstance(eg, LoRALinear):
                tensors.append(eg.get_merged_weight().detach())
            else:
                tensors.append(eg.weight.detach())

            # LayerNorm (not LoRA-patched)
            tensors.append(gnn_layer.norm.weight.detach())
            tensors.append(gnn_layer.norm.bias.detach())

        # Head
        head = self.gnn.head
        if isinstance(head, LoRALinear):
            tensors.append(head.get_merged_weight().detach())
            if head.b_frozen is not None:
                tensors.append(head.b_frozen.detach())
            else:
                tensors.append(torch.zeros(head.get_merged_weight().shape[0]))
        else:
            tensors.append(head.weight.detach())
            tensors.append(head.bias.detach() if head.bias is not None else torch.zeros(head.out_features))

        return tensors

    def save(self, path: str) -> None:
        """Save LoRA A, B parameters only (not frozen weights — those are in GNN checkpoint)."""
        os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
        state = {k: {"A": l.A.data, "B": l.B.data} for k, l in self._lora_layers.items()}
        torch.save({"lora_state": state, "rank": self.rank, "alpha": self.alpha}, path)

    def load(self, path: str) -> None:
        ckpt = torch.load(path, map_location="cpu")
        for key, ab in ckpt["lora_state"].items():
            if key in self._lora_layers:
                self._lora_layers[key].A.data.copy_(ab["A"])
                self._lora_layers[key].B.data.copy_(ab["B"])

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _eval_f1(
        self,
        x: torch.Tensor,
        ei: torch.Tensor,
        ea: torch.Tensor,
        labels: torch.Tensor,
    ) -> float:
        self.gnn.eval()
        with torch.no_grad():
            logits = self.gnn(x, ei, ea).squeeze(1)
            probs = torch.sigmoid(logits).cpu().numpy()
            preds = (probs >= 0.5).astype(int)
            y_true = labels.cpu().numpy().astype(int)
        return float(f1_score(y_true, preds, zero_division=0))

    @staticmethod
    def _compute_pos_weight(labels: torch.Tensor) -> Optional[torch.Tensor]:
        n_pos = labels.sum().item()
        n_neg = len(labels) - n_pos
        if n_pos == 0 or n_neg == 0:
            return None
        return torch.tensor([n_neg / n_pos], dtype=torch.float32)
