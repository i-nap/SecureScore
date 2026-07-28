"""
hq_service/worker.py
====================
Runs background verification + reverification workers.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from branch_service.models import EnsembleModel
from hq_service.background_verification import BackgroundVerificationService
from hq_service.reverification_service import ReverificationCallService

MODEL_PATH = os.getenv("HQ_GLOBAL_MODEL_PATH", "hq_state/global_ensemble.pkl")


def _load_model() -> EnsembleModel:
    if Path(MODEL_PATH).exists():
        return EnsembleModel.load_model(MODEL_PATH)
    return EnsembleModel()


def _load_branch_weights(branch_id: str) -> list[float]:
    return [0.2] * 5


async def main() -> None:
    verifier = BackgroundVerificationService(
        model_loader=_load_model,
        branch_weights_loader=_load_branch_weights,
    )
    caller = ReverificationCallService(twilio_client=None)

    await asyncio.gather(
        verifier.background_verification_worker(),
        caller.reverification_caller_worker(),
    )


if __name__ == "__main__":
    asyncio.run(main())
