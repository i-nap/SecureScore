"""
services/audit/archival.py
==========================
NRB-compliant 7-year audit log archival job.

Runs daily at 02:00 UTC via APScheduler. Archives audit_events rows older than
1 year to S3-compatible object storage. Entries are never deleted — archived=True
marks them as moved but they remain in the DB for fast recent-event queries.

Required env vars:
  ARCHIVE_S3_BUCKET   — destination bucket name
  AWS_REGION          — e.g. ap-south-1
  AWS_ACCESS_KEY_ID   — IAM key (or use instance profile / IRSA)
  AWS_SECRET_ACCESS_KEY

Optional:
  ARCHIVE_CUTOFF_DAYS — days before today to archive (default 365)
  ARCHIVE_DRY_RUN     — set to "true" to log without uploading
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

BUCKET = os.getenv("ARCHIVE_S3_BUCKET", "securescore-audit-archive")
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
CUTOFF_DAYS = int(os.getenv("ARCHIVE_CUTOFF_DAYS", "365"))
DRY_RUN = os.getenv("ARCHIVE_DRY_RUN", "false").lower() == "true"


def _get_s3_client():
    """Returns a boto3 S3 client. Import deferred so service starts without boto3 if unused."""
    import boto3  # type: ignore
    return boto3.client("s3", region_name=AWS_REGION)


def archive_old_audit_entries(db_session_factory) -> dict:
    """
    Archive audit_events rows older than CUTOFF_DAYS to S3.

    Returns summary: {archived: int, skipped: int, error: str|None}
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=CUTOFF_DAYS)
    cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        with db_session_factory() as session:
            # Fetch entries older than cutoff that haven't been archived yet
            rows = session.execute(
                "SELECT id, seq, event_type, branch, payload_hash, prev_hash, entry_hash, "
                "details_summary, created_at FROM audit_events "
                "WHERE created_at < :cutoff AND (archived IS NULL OR archived = 0) "
                "ORDER BY seq ASC",
                {"cutoff": cutoff_str},
            ).fetchall()

            if not rows:
                logger.info("[Archival] No audit entries to archive (cutoff=%s)", cutoff_str)
                return {"archived": 0, "skipped": 0, "error": None}

            entries = [dict(r) for r in rows]
            ids = [e["id"] for e in entries]

            # Group by year/month for S3 key organisation
            by_month: dict[str, list] = {}
            for entry in entries:
                ts = entry.get("created_at", "")[:7]  # "YYYY-MM"
                by_month.setdefault(ts, []).append(entry)

            if DRY_RUN:
                logger.info("[Archival] DRY RUN — would archive %d entries to s3://%s", len(entries), BUCKET)
                return {"archived": 0, "skipped": len(entries), "error": None}

            s3 = _get_s3_client()
            uploaded = 0
            for month_key, month_entries in by_month.items():
                year, month = month_key.split("-")
                s3_key = f"audit/{year}/{month}/audit_events_{cutoff.strftime('%Y%m%d')}.jsonl"
                body = "\n".join(json.dumps(e, default=str) for e in month_entries).encode()
                s3.put_object(
                    Bucket=BUCKET,
                    Key=s3_key,
                    Body=body,
                    ContentType="application/x-ndjson",
                    Metadata={
                        "archived_at": datetime.now(timezone.utc).isoformat(),
                        "entry_count": str(len(month_entries)),
                        "retention_years": "7",
                    },
                )
                uploaded += len(month_entries)
                logger.info("[Archival] Uploaded %d entries → s3://%s/%s", len(month_entries), BUCKET, s3_key)

            # Mark archived in DB (never DELETE — immutable audit trail)
            session.execute(
                f"UPDATE audit_events SET archived = 1, archived_at = :now WHERE id IN ({','.join('?' for _ in ids)})",
                [cutoff_str] + ids,
            )
            session.commit()

            logger.info("[Archival] Archived %d entries (cutoff=%s)", uploaded, cutoff_str)
            return {"archived": uploaded, "skipped": 0, "error": None}

    except Exception as exc:
        logger.error("[Archival] Failed to archive audit entries: %s", exc, exc_info=True)
        return {"archived": 0, "skipped": 0, "error": str(exc)}


def register_archival_job(scheduler, db_session_factory) -> None:
    """Register the daily 02:00 UTC archival job with APScheduler."""
    scheduler.add_job(
        func=archive_old_audit_entries,
        args=[db_session_factory],
        trigger="cron",
        hour=2,
        minute=0,
        timezone="UTC",
        id="audit_archival",
        replace_existing=True,
        misfire_grace_time=3600,  # allow up to 1h late start
    )
    logger.info("[Archival] Registered daily audit archival job (02:00 UTC, cutoff=%d days)", CUTOFF_DAYS)
