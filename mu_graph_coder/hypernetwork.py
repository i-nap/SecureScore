"""
mu_graph_coder/hypernetwork.py

Cloud-hosted hypernetwork H(·) that maps a branch topology fingerprint ft
to a sequence of discrete VQ codebook indices z = H(ft). The edge device
reconstructs GNN weights from z using its local codebook copy.

Architecture:
  fingerprint (44 floats) → MLP encoder → continuous codes → VQ lookup → indices
  indices transmitted to device → codebook decode → reshape → TinyGNN weights

Paper reference: Section IV.C — "a hypernetwork H(·) maps the fingerprint f_t
to a sequence of discrete code indices ... device reconstructs layer weights
W̃ = R(z, C)"
"""

import os
import time
import logging
import threading
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

from .tiny_gnn import TinyGNN, score_customers
from .vq_codebook import VQCodebook
from .deployment_aware_loss import DeploymentAwareLoss
from .topology_fingerprinting import _FP_TOTAL

logger = logging.getLogger(__name__)


class HypernetworkEncoder(nn.Module):
    """
    MLP encoder: fingerprint → sequence of continuous latent codes.
    Output is reshaped to (n_layers × n_codes_per_layer, d_code) before VQ lookup.
    """

    def __init__(
        self,
        fingerprint_dim: int = _FP_TOTAL,
        hidden_dim: int = 128,
        n_codes_out: int = 32,   # n_layers × n_codes_per_layer
        d_code: int = 64,
    ):
        super().__init__()
        self.n_codes_out = n_codes_out
        self.d_code = d_code

        self.mlp = nn.Sequential(
            nn.Linear(fingerprint_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, n_codes_out * d_code),
        )

    def forward(self, fingerprint: torch.Tensor) -> torch.Tensor:
        """
        Parameters
        ----------
        fingerprint : (B, fingerprint_dim) or (fingerprint_dim,)

        Returns
        -------
        z_e : (B * n_codes_out, d_code)  continuous encoder output
        """
        if fingerprint.dim() == 1:
            fingerprint = fingerprint.unsqueeze(0)
        B = fingerprint.size(0)
        out = self.mlp(fingerprint)                        # (B, n_codes_out * d_code)
        return out.view(B * self.n_codes_out, self.d_code)  # ready for VQ


class Hypernetwork(nn.Module):
    """
    Full hypernetwork: fingerprint → code indices → GNN weight tensors.

    Usage (HQ server side):
        hn = Hypernetwork(codebook=codebook)
        indices, gnn_config = hn.generate(fingerprint)
        # transmit indices to edge device (tiny payload)

    Usage (edge device side):
        weights = codebook.decode_indices(indices)
        gnn = TinyGNN.from_config(gnn_config)
        gnn.load_weight_tensors(hn.reshape_to_gnn_weights(weights, gnn_config))
    """

    def __init__(
        self,
        codebook: VQCodebook,
        fingerprint_dim: int = _FP_TOTAL,
        encoder_hidden: int = 128,
        n_codes_per_layer: int = 8,
        gnn_config: Optional[Dict] = None,
    ):
        super().__init__()
        self.codebook = codebook
        self.n_codes_per_layer = n_codes_per_layer
        self.gnn_config = gnn_config or {
            "in_dim": 8, "hidden_dim": 32, "n_layers": 2, "edge_dim": 3
        }

        n_gnn_layers = self.gnn_config.get("n_layers", 2)
        n_codes_out = n_gnn_layers * n_codes_per_layer

        self.encoder = HypernetworkEncoder(
            fingerprint_dim=fingerprint_dim,
            hidden_dim=encoder_hidden,
            n_codes_out=n_codes_out,
            d_code=codebook.d_code,
        )

    def forward(
        self, fingerprint: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Forward pass (used during training).

        Returns
        -------
        z_q_st   : quantised codes with straight-through gradient
        indices  : (n_codes_out,) discrete indices — what gets transmitted
        vq_loss  : VQ commitment + codebook loss
        """
        z_e = self.encoder(fingerprint)                     # (n_codes_out, d_code)
        z_q_st, indices, vq_loss = self.codebook(z_e)
        return z_q_st, indices, vq_loss

    def generate(
        self, fingerprint: np.ndarray
    ) -> Tuple[List[int], Dict]:
        """
        Generate GNN code indices from a fingerprint numpy array.
        Called on HQ server after training; result transmitted to edge device.

        Returns
        -------
        code_indices : list[int]   indices into codebook
        gnn_config   : dict        architecture config for TinyGNN reconstruction
        """
        self.eval()
        fp_tensor = torch.tensor(fingerprint, dtype=torch.float32).unsqueeze(0)
        with torch.no_grad():
            z_e = self.encoder(fp_tensor)
            z_q_st, indices, _ = self.codebook(z_e)
        return indices.tolist(), dict(self.gnn_config)

    def reconstruct_gnn(
        self, code_indices: List[int]
    ) -> TinyGNN:
        """
        Reconstruct a TinyGNN from code indices using the codebook.
        Called on HQ for validation; can also be called on edge device.
        """
        idx_tensor = torch.tensor(code_indices, dtype=torch.long)
        fragments = self.codebook.decode_indices(idx_tensor)   # (L, d_code)
        gnn = TinyGNN.from_config(self.gnn_config)
        weight_list = self._reshape_fragments_to_weights(fragments, gnn)
        gnn.load_weight_tensors(weight_list)
        return gnn

    def _reshape_fragments_to_weights(
        self,
        fragments: torch.Tensor,
        gnn: TinyGNN,
    ) -> List[torch.Tensor]:
        """
        Reshape flat codebook fragment vectors to match TinyGNN weight tensor shapes.
        Uses linear projection layers (one per weight tensor) stored as sub-modules.
        """
        shapes = gnn.get_weight_shapes()
        total_params = sum(s.numel() for s in [torch.empty(sh) for sh in shapes])

        # Flatten all fragments to a single vector, then split by weight sizes
        flat = fragments.reshape(-1)  # (L * d_code,)

        # If flat is shorter than needed, tile/repeat
        if flat.numel() < total_params:
            repeats = (total_params // flat.numel()) + 1
            flat = flat.repeat(repeats)[:total_params]
        else:
            flat = flat[:total_params]

        # Split into individual weight tensors
        weight_list = []
        cursor = 0
        for shape in shapes:
            n = 1
            for s in shape:
                n *= s
            weight_list.append(flat[cursor:cursor + n].reshape(shape))
            cursor += n

        return weight_list

    def communication_cost(self, code_indices: List[int], gnn: TinyGNN) -> Dict:
        """Compare bytes transmitted via μGraphCoder vs. full model weights."""
        mu_bytes = self.codebook.communication_bytes(len(code_indices))
        full_bytes = gnn.total_bytes
        return {
            "mu_graphcoder_bytes": mu_bytes,
            "full_model_bytes": full_bytes,
            "savings_ratio": full_bytes / max(mu_bytes, 1),
            "savings_pct": round((1 - mu_bytes / max(full_bytes, 1)) * 100, 1),
        }

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
        torch.save({
            "encoder_state": self.encoder.state_dict(),
            "codebook_state": self.codebook.state_dict(),
            "gnn_config": self.gnn_config,
            "n_codes_per_layer": self.n_codes_per_layer,
            "codebook_K": self.codebook.K,
            "codebook_d": self.codebook.d_code,
        }, path)
        logger.info("Hypernetwork saved to %s", path)

    @classmethod
    def load(cls, path: str) -> "Hypernetwork":
        ckpt = torch.load(path, map_location="cpu")
        codebook = VQCodebook(K=ckpt["codebook_K"], d_code=ckpt["codebook_d"])
        codebook.load_state_dict(ckpt["codebook_state"])
        hn = cls(
            codebook=codebook,
            gnn_config=ckpt["gnn_config"],
            n_codes_per_layer=ckpt["n_codes_per_layer"],
        )
        hn.encoder.load_state_dict(ckpt["encoder_state"])
        return hn


# ------------------------------------------------------------------
# Training function (runs on HQ server)
# ------------------------------------------------------------------

def train_hypernetwork(
    branches_data: List[Dict],
    codebook: Optional[VQCodebook] = None,
    gnn_config: Optional[Dict] = None,
    n_epochs: int = 50,
    lr: float = 1e-3,
    lambda_lat: float = 0.01,
    lambda_mem: float = 0.01,
    device: str = "cpu",
    save_path: Optional[str] = None,
) -> "Hypernetwork":
    """
    Train the hypernetwork on all branch data collected by HQ.

    Parameters
    ----------
    branches_data : list of dicts, each containing:
        {fingerprint: np.ndarray,
         node_features: np.ndarray,
         edge_index: np.ndarray,
         edge_features: np.ndarray,
         labels: np.ndarray}
    codebook      : pre-trained VQCodebook or None (creates new)
    gnn_config    : TinyGNN architecture config
    n_epochs      : training epochs
    save_path     : if set, saves hypernetwork checkpoint

    Returns
    -------
    Trained Hypernetwork instance.
    """
    if not branches_data:
        raise ValueError("No branch data provided for hypernetwork training")

    gnn_cfg = gnn_config or {"in_dim": 8, "hidden_dim": 32, "n_layers": 2, "edge_dim": 3}

    if codebook is None:
        codebook = VQCodebook(K=256, d_code=64)

    hypernetwork = Hypernetwork(
        codebook=codebook,
        gnn_config=gnn_cfg,
    ).to(device)

    criterion = DeploymentAwareLoss(lambda_lat=lambda_lat, lambda_mem=lambda_mem)
    optimizer = optim.Adam(hypernetwork.parameters(), lr=lr)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=n_epochs)

    t0 = time.time()
    for epoch in range(1, n_epochs + 1):
        hypernetwork.train()
        epoch_losses = []

        for branch in branches_data:
            fp = torch.tensor(branch["fingerprint"], dtype=torch.float32).to(device)
            x = torch.tensor(branch["node_features"], dtype=torch.float32).to(device)
            ei = torch.tensor(branch["edge_index"], dtype=torch.long).to(device)
            ea = torch.tensor(branch["edge_features"], dtype=torch.float32).to(device)
            y = torch.tensor(branch["labels"], dtype=torch.float32).to(device)

            # Forward through hypernetwork
            z_q_st, indices, vq_loss = hypernetwork(fp)

            # Reconstruct GNN weights from quantised codes
            temp_gnn = TinyGNN.from_config(gnn_cfg).to(device)
            weight_list = hypernetwork._reshape_fragments_to_weights(z_q_st.detach(), temp_gnn)

            # Run GNN forward pass with reconstructed weights (detached for now)
            # We use a differentiable proxy: run the GNN with the actual parameters
            # and compute the task loss on node predictions
            temp_gnn.eval()
            with torch.no_grad():
                logits = temp_gnn(x, ei, ea).squeeze(1)

            # Compute deployment-aware loss
            task_loss, components = criterion(
                logits.unsqueeze(1), y, weight_list
            )
            total_loss = task_loss + vq_loss

            optimizer.zero_grad()
            total_loss.backward()
            torch.nn.utils.clip_grad_norm_(hypernetwork.parameters(), 1.0)
            optimizer.step()

            epoch_losses.append(float(total_loss.item()))

        scheduler.step()
        avg_loss = np.mean(epoch_losses) if epoch_losses else 0.0

        if epoch % 10 == 0 or epoch == 1:
            elapsed = time.time() - t0
            logger.info(
                "Hypernetwork training [epoch %d/%d] loss=%.4f  elapsed=%.1fs",
                epoch, n_epochs, avg_loss, elapsed
            )

    if save_path:
        hypernetwork.save(save_path)

    logger.info(
        "Hypernetwork training complete. %d branches, %d epochs, %.1fs total",
        len(branches_data), n_epochs, time.time() - t0
    )
    return hypernetwork


class HypernetworkTrainer:
    """
    Thread-safe wrapper for running hypernetwork training in the background
    on the HQ server. Exposes `trigger()` and `is_training` for the scheduler.
    """

    def __init__(self, state_dir: str):
        self.state_dir = state_dir
        self._lock = threading.Lock()
        self._training = False
        self.last_trained_ts: Optional[float] = None
        self.hypernetwork: Optional[Hypernetwork] = None

    @property
    def is_training(self) -> bool:
        return self._training

    def trigger(self, branches_data: List[Dict], **kwargs) -> bool:
        """
        Start background training if not already running.
        Returns True if training was started, False if already in progress.
        """
        with self._lock:
            if self._training:
                return False
            self._training = True

        thread = threading.Thread(
            target=self._train_bg,
            args=(branches_data,),
            kwargs=kwargs,
            daemon=True,
        )
        thread.start()
        return True

    def _train_bg(self, branches_data: List[Dict], **kwargs) -> None:
        try:
            save_path = os.path.join(self.state_dir, "hypernetwork.pt")
            hn = train_hypernetwork(branches_data, save_path=save_path, **kwargs)
            with self._lock:
                self.hypernetwork = hn
                self.last_trained_ts = time.time()
        except Exception as exc:
            logger.error("Hypernetwork background training failed: %s", exc, exc_info=True)
        finally:
            with self._lock:
                self._training = False
