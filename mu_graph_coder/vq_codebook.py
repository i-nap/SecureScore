"""
mu_graph_coder/vq_codebook.py

Vector-Quantized (VQ) Codebook trained with Exponential Moving Average (EMA)
updates. The codebook C = {e_1, ..., e_K} stores shared weight fragments.
The hypernetwork encodes branch fingerprints into sequences of discrete indices
into this codebook; edge devices reconstruct GNN weights from these indices.

Paper reference: Section IV.C — "vector-quantized codebook ... codebook-based
weight reconstruction ... straight-through estimators for the discrete codes"

Based on: van den Oord et al. (2017) "Neural Discrete Representation Learning"
"""

import os
import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple

_LOG2 = math.log(2)


class VQCodebook(nn.Module):
    """
    Shared codebook of K weight-fragment vectors, each of dimension d_code.

    Training: EMA updates (more stable than pure commitment loss).
    Inference: nearest-neighbour lookup → discrete indices transmitted to device.
    Reconstruction: device looks up indices in local codebook copy to rebuild weights.

    Communication cost: n_indices × ⌈log2(K)/8⌉ bytes vs. full float32 model.
    """

    def __init__(
        self,
        K: int = 256,
        d_code: int = 64,
        ema_decay: float = 0.99,
        ema_epsilon: float = 1e-5,
        commitment_cost: float = 0.25,
    ):
        super().__init__()
        self.K = K
        self.d_code = d_code
        self.ema_decay = ema_decay
        self.ema_epsilon = ema_epsilon
        self.commitment_cost = commitment_cost

        # Learnable codebook entries
        self.codebook = nn.Embedding(K, d_code)
        nn.init.uniform_(self.codebook.weight, -1.0 / K, 1.0 / K)

        # EMA buffers (not gradients — updated in-place)
        self.register_buffer("ema_cluster_size", torch.zeros(K))
        self.register_buffer("ema_dw", self.codebook.weight.data.clone())

        # Track codebook usage for collapse detection
        self.register_buffer("_usage_count", torch.zeros(K))

    # ------------------------------------------------------------------
    # Forward pass
    # ------------------------------------------------------------------

    def forward(
        self, z_e: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Vector-quantize the encoder output.

        Parameters
        ----------
        z_e : (B, d_code)  continuous codes from the hypernetwork encoder

        Returns
        -------
        z_q_st  : (B, d_code) quantised codes with straight-through gradient
        indices : (B,)        discrete code indices — transmitted to edge device
        vq_loss : scalar      commitment + codebook loss
        """
        # Flatten for distance computation
        flat_z = z_e.view(-1, self.d_code)  # (B, d_code)

        # Efficient L2 distance: ||z_e - e_k||^2 = ||z_e||^2 - 2*z_e·C^T + ||C||^2
        z_sq = (flat_z ** 2).sum(dim=1, keepdim=True)     # (B, 1)
        c_sq = (self.codebook.weight ** 2).sum(dim=1)     # (K,)
        dot = flat_z @ self.codebook.weight.T              # (B, K)
        distances = z_sq - 2 * dot + c_sq.unsqueeze(0)    # (B, K)

        # Nearest-neighbour lookup
        indices = distances.argmin(dim=1)                  # (B,)
        z_q = self.codebook(indices)                       # (B, d_code)

        # Straight-through estimator: pass gradients through as if z_q == z_e
        z_q_st = z_e + (z_q - z_e).detach()               # (B, d_code)

        # VQ loss = commitment + codebook alignment
        vq_loss = (
            self.commitment_cost * F.mse_loss(z_e, z_q.detach())
            + F.mse_loss(z_e.detach(), z_q)
        )

        # EMA update during training
        if self.training:
            self._ema_update(flat_z, indices)

        # Track usage
        with torch.no_grad():
            self._usage_count.scatter_add_(
                0, indices, torch.ones_like(indices, dtype=torch.float)
            )

        return z_q_st, indices, vq_loss

    # ------------------------------------------------------------------
    # Reconstruction (edge device side)
    # ------------------------------------------------------------------

    def decode_indices(self, indices: torch.Tensor) -> torch.Tensor:
        """
        Reconstruct weight fragments from a sequence of indices.

        Parameters
        ----------
        indices : (L,) long   sequence of codebook indices from hypernetwork

        Returns
        -------
        fragments : (L, d_code) float32  weight fragments to reshape into GNN weights
        """
        return self.codebook(indices)

    # ------------------------------------------------------------------
    # Communication cost utilities
    # ------------------------------------------------------------------

    def communication_bytes(self, n_indices: int) -> int:
        """
        Bytes needed to transmit n_indices codebook indices.
        Each index fits in ⌈log2(K)/8⌉ bytes.
        """
        bits_per_index = math.ceil(math.log2(max(self.K, 2)))
        bytes_per_index = math.ceil(bits_per_index / 8)
        return n_indices * bytes_per_index

    def baseline_bytes(self, n_params: int) -> int:
        """Bytes to transmit the same parameters as float32."""
        return n_params * 4

    def savings_ratio(self, n_indices: int, n_params: int) -> float:
        """Compression ratio: baseline_bytes / comm_bytes (higher = better)."""
        cb = self.communication_bytes(n_indices)
        bb = self.baseline_bytes(n_params)
        return bb / max(cb, 1)

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def codebook_usage(self) -> dict:
        """Return codebook utilization statistics."""
        total = self._usage_count.sum().item()
        active = (self._usage_count > 0).sum().item()
        perplexity = torch.exp(
            -((self._usage_count / max(total, 1))
              * torch.log((self._usage_count / max(total, 1)).clamp(min=1e-10)))
            .sum()
        ).item()
        return {
            "active_codes": active,
            "total_codes": self.K,
            "utilization_pct": 100 * active / self.K,
            "perplexity": perplexity,
        }

    def reset_usage_stats(self) -> None:
        self._usage_count.zero_()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
        torch.save({
            "state_dict": self.state_dict(),
            "K": self.K,
            "d_code": self.d_code,
            "ema_decay": self.ema_decay,
            "commitment_cost": self.commitment_cost,
        }, path)

    @classmethod
    def load(cls, path: str) -> "VQCodebook":
        ckpt = torch.load(path, map_location="cpu")
        codebook = cls(
            K=ckpt["K"],
            d_code=ckpt["d_code"],
            ema_decay=ckpt["ema_decay"],
            commitment_cost=ckpt["commitment_cost"],
        )
        codebook.load_state_dict(ckpt["state_dict"])
        return codebook

    # ------------------------------------------------------------------
    # Internal EMA update
    # ------------------------------------------------------------------

    def _ema_update(self, z_e: torch.Tensor, indices: torch.Tensor) -> None:
        """
        EMA update of codebook vectors (van den Oord et al. 2017, Appendix A.1).
        Updates cluster size and centroid estimates in-place.
        """
        with torch.no_grad():
            K = self.K
            # One-hot encode: (B, K)
            one_hot = torch.zeros(z_e.size(0), K, device=z_e.device)
            one_hot.scatter_(1, indices.unsqueeze(1), 1.0)

            # Update cluster sizes (exponential moving average)
            cluster_size = one_hot.sum(0)  # (K,)
            self.ema_cluster_size.mul_(self.ema_decay).add_(
                cluster_size * (1 - self.ema_decay)
            )

            # Update sum-of-encodings per cluster
            dw = one_hot.T @ z_e  # (K, d_code)
            self.ema_dw.mul_(self.ema_decay).add_(dw * (1 - self.ema_decay))

            # Laplace smoothing to avoid dead codes
            n = self.ema_cluster_size.sum()
            smoothed = (
                (self.ema_cluster_size + self.ema_epsilon)
                / (n + K * self.ema_epsilon)
                * n
            )

            # Update codebook weights
            self.codebook.weight.data.copy_(self.ema_dw / smoothed.unsqueeze(1))
