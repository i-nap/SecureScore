from __future__ import annotations

from pydantic import BaseModel, Field


class WeightPayload(BaseModel):
    format: str = "xgboost_raw_b64"
    n_estimators: int
    max_depth: int
    raw_model_b64: str
    byte_size: int
    sha256_hash: str = ""
    dp_epsilon: float = 0.0
    dp_noise_std: float = 0.0


class MetricsPayload(BaseModel):
    accuracy: float = 0.0
    f1: float = 0.0
    tn: int = 0
    fp: int = 0
    fn: int = 0
    tp: int = 0
    train_size: int = 0
    test_size: int = 0
    timestamp: str = ""


class SubmitWeightsRequest(BaseModel):
    branch: str
    branch_type: str = ""
    weights: WeightPayload
    metrics: MetricsPayload
    submitted_at: str = ""


class RollbackRequest(BaseModel):
    target_version: int = Field(..., ge=1)


class TriggerRequest(BaseModel):
    force: bool = False


class ByzantineInjectRequest(BaseModel):
    branch: str
    attack_type: str = "label_flip"


class ByzantineInjectResponse(BaseModel):
    detected: bool
    branch: str
    attack_type: str
    reason: str
    cosine_similarity: float
    sigma_threshold: float
