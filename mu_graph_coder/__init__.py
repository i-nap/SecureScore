"""
mu_graph_coder — μGraphCoder: On-Device Generative GNNs for Dynamic Topologies
Implements the full paper pipeline as a dual-engine alongside the existing XGBoost FL system.

Components:
  TopologyFingerprinter  — builds customer transaction graph + <512B fingerprint
  TinyGNN                — 2-4 layer GNN for credit default prediction
  VQCodebook             — vector-quantized shared codebook (EMA training)
  Hypernetwork           — maps fingerprint → code indices → GNN weights
  LoRAAdapter            — on-device low-rank adaptation for concept drift
  DeploymentAwareLoss    — L = L_task + λ1*L_lat + λ2*L_mem
  MuGraphCoderEvaluator  — benchmarks all 4 paper research questions
"""

from .topology_fingerprinting import TopologyFingerprinter
from .tiny_gnn import TinyGNN, quantize_to_int8, score_customers
from .vq_codebook import VQCodebook
from .hypernetwork import Hypernetwork, train_hypernetwork, HypernetworkTrainer
from .lora_adapter import LoRAAdapter, LoRALinear
from .deployment_aware_loss import DeploymentAwareLoss
from .evaluation import MuGraphCoderEvaluator

__version__ = "1.0.0"
__all__ = [
    "TopologyFingerprinter",
    "TinyGNN",
    "quantize_to_int8",
    "score_customers",
    "VQCodebook",
    "Hypernetwork",
    "train_hypernetwork",
    "HypernetworkTrainer",
    "LoRAAdapter",
    "LoRALinear",
    "DeploymentAwareLoss",
    "MuGraphCoderEvaluator",
]
