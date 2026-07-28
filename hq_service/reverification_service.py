"""
hq_service/reverification_service.py
===================================
Twilio-backed reverification call workflow.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from shared.decision_logic import make_decision_from_percentile

try:
    from db.models import get_session, ReverificationQueue
except Exception:
    get_session = None
    ReverificationQueue = None


class ReverificationCallService:
    def __init__(self, twilio_client=None, call_timeout: int = 60):
        self.twilio_client = twilio_client
        self.call_timeout = call_timeout
        self.logger = logging.getLogger("hq.reverify")

    async def reverification_caller_worker(self) -> None:
        if get_session is None:
            raise RuntimeError("Database is not available")

        while True:
            await asyncio.sleep(10)
            db = get_session()
            try:
                now = datetime.now(timezone.utc)
                tasks = (
                    db.query(ReverificationQueue)
                    .filter(
                        ReverificationQueue.status == "PENDING_CALL",
                        ReverificationQueue.deadline > now,
                    )
                    .all()
                )
                for task in tasks:
                    await self.make_reverification_call(task.id)
            finally:
                db.close()

    async def make_reverification_call(self, task_id: str) -> None:
        if get_session is None:
            return

        db = get_session()
        try:
            task = db.query(ReverificationQueue).filter(ReverificationQueue.id == task_id).one_or_none()
            if task is None:
                return

            retries = 0
            while retries < 3:
                task.status = "CALL_IN_PROGRESS"
                db.commit()

                decision = task.immediate_decision
                customer_confirmed = None

                try:
                    if self.twilio_client is not None:
                        self.twilio_client.calls.create(
                            to=task.phone_number,
                            from_="+0000000000",
                            twiml=(
                                f"<Response><Say>We need to verify your loan decision. "
                                f"Original: {task.immediate_decision}. Updated: {task.revised_decision}. "
                                "Press 1 to confirm, 2 to speak with manager.</Say></Response>"
                            ),
                        )
                        await asyncio.sleep(self.call_timeout)

                    db.refresh(task)
                    if task.customer_confirmed is True:
                        customer_confirmed = True
                        decision = task.immediate_decision
                    elif task.customer_confirmed is False:
                        customer_confirmed = False
                        decision = task.revised_decision or task.immediate_decision
                    else:
                        customer_confirmed = False
                        decision = task.revised_decision or task.immediate_decision

                    if self.twilio_client is not None:
                        try:
                            self.twilio_client.messages.create(
                                to=task.phone_number,
                                from_="+0000000000",
                                body=(
                                    f"BANK: Your loan decision verified. Status: {decision}. "
                                    "Contact us for details."
                                ),
                            )
                        except Exception:
                            pass

                    task.status = "CALL_COMPLETED"
                    task.called_at = datetime.now(timezone.utc)
                    task.customer_confirmed = customer_confirmed
                    task.final_decision = decision
                    db.commit()
                    return
                except Exception as exc:
                    retries += 1
                    task.error = str(exc)
                    db.commit()
                    self.logger.warning("Reverification call retry %d failed: %s", retries, exc)
                    await asyncio.sleep(2 ** retries)

            task.status = "CALL_FAILED"
            task.error = task.error or "Manager escalation required"
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
