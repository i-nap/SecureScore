"""
observability/logging_config.py — Structured JSON logging for all SecureScore services.

Replaces plain-text log format with machine-parseable JSON logs suitable for
ELK Stack, Datadog, Splunk, or any log aggregation pipeline.

Each log entry has:
  - timestamp (ISO-8601)
  - level (DEBUG/INFO/WARNING/ERROR/CRITICAL)
  - service (hq_server / bff_gateway / edge_api)
  - message
  - plus any extra kwargs passed to the logger

Usage:
    from observability.logging_config import configure_structured_logging
    logger = configure_structured_logging("hq_server", log_file="edge_logs/hq_server.log")
    logger.info("Branch registered", extra={"branch": "Kathmandu", "role": "branch_operator"})
"""

from __future__ import annotations

import json
import logging
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


class JSONFormatter(logging.Formatter):
    """
    Formats log records as single-line JSON objects.
    Compatible with ELK, Datadog, Splunk, and Loki.
    """

    SERVICE_NAME: str = "securescore"

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "service": getattr(record, "service", self.SERVICE_NAME),
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }

        # Include extra fields passed via extra={}
        standard_keys = {
            "name", "msg", "args", "levelname", "levelno", "pathname",
            "filename", "module", "exc_info", "exc_text", "stack_info",
            "lineno", "funcName", "created", "msecs", "relativeCreated",
            "thread", "threadName", "processName", "process", "message",
            "taskName",
        }
        for key, value in record.__dict__.items():
            if key not in standard_keys and not key.startswith("_"):
                try:
                    json.dumps(value)  # test serializability
                    log_entry[key] = value
                except (TypeError, ValueError):
                    log_entry[key] = str(value)

        # Exception info
        if record.exc_info:
            log_entry["exception"] = {
                "type": record.exc_info[0].__name__ if record.exc_info[0] else None,
                "message": str(record.exc_info[1]),
                "traceback": traceback.format_exception(*record.exc_info),
            }

        return json.dumps(log_entry, ensure_ascii=False)


def configure_structured_logging(
    service_name: str,
    log_file: Optional[str] = None,
    level: int = logging.INFO,
    json_output: bool = True,
) -> logging.Logger:
    """
    Configure a service logger with structured JSON output.

    Args:
        service_name: Name of the service (e.g., 'hq_server')
        log_file: Optional file path to write logs to
        level: Logging level (default: INFO)
        json_output: Use JSON formatter (default: True)

    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(service_name)
    logger.setLevel(level)
    logger.handlers.clear()
    logger.propagate = False

    if json_output:
        formatter = JSONFormatter()
    else:
        formatter = logging.Formatter(
            "[%(asctime)s] %(levelname)-8s %(name)s — %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    # Console handler (stdout for Docker log collection)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # File handler (for local debugging)
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(str(log_path), encoding="utf-8")
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)

    # Suppress noisy third-party loggers
    for noisy in ["uvicorn.access", "apscheduler", "slowapi"]:
        logging.getLogger(noisy).setLevel(logging.WARNING)

    return logger


class RequestLogger:
    """
    Middleware-compatible structured request logger.
    Logs every HTTP request with method, path, status, and duration.
    """

    def __init__(self, logger: logging.Logger):
        self.logger = logger

    def log_request(
        self,
        method: str,
        path: str,
        status_code: int,
        duration_ms: float,
        branch: Optional[str] = None,
        user_role: Optional[str] = None,
    ):
        level = logging.WARNING if status_code >= 400 else logging.INFO
        self.logger.log(
            level,
            f"{method} {path} → {status_code} ({duration_ms:.1f}ms)",
            extra={
                "http_method": method,
                "http_path": path,
                "http_status": status_code,
                "duration_ms": round(duration_ms, 2),
                "branch": branch,
                "role": user_role,
            },
        )
