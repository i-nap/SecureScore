"""
observability/tracing.py — OpenTelemetry distributed tracing for SecureScore.

Instruments FastAPI apps with OTLP trace export.
Each federated round, weight submission, and aggregation gets a traced span.

Usage:
    from observability.tracing import setup_tracing, trace_span

    setup_tracing(app, service_name="hq-server")

    with trace_span("fedavg_aggregation", attributes={"n_branches": 5}):
        result = federated_average(submissions)
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Optional

logger = logging.getLogger("observability.tracing")

try:
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.sdk.resources import Resource, SERVICE_NAME
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

    try:
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        OTLP_AVAILABLE = True
    except ImportError:
        OTLP_AVAILABLE = False

    OTEL_AVAILABLE = True
except ImportError:
    OTEL_AVAILABLE = False
    logger.info(
        "OpenTelemetry not installed — distributed tracing disabled. "
        "Install: pip install opentelemetry-sdk opentelemetry-instrumentation-fastapi "
        "opentelemetry-exporter-otlp"
    )


_tracer: Optional[object] = None


def setup_tracing(
    app,
    service_name: str = "securescore-hq",
    otlp_endpoint: str = "http://otel-collector:4317",
):
    """
    Configure OpenTelemetry tracing for a FastAPI application.
    Exports traces to an OTLP endpoint (Jaeger, Tempo, Honeycomb, etc.)
    """
    global _tracer

    if not OTEL_AVAILABLE:
        logger.info("OpenTelemetry not available — skipping tracing setup")
        return

    resource = Resource(attributes={SERVICE_NAME: service_name})
    provider = TracerProvider(resource=resource)

    if OTLP_AVAILABLE:
        try:
            otlp_exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
            provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
            logger.info("OpenTelemetry traces → %s", otlp_endpoint)
        except Exception as e:
            logger.warning("Failed to set up OTLP exporter: %s", e)
    else:
        logger.info("OTLP exporter not available — spans will be dropped")

    trace.set_tracer_provider(provider)
    _tracer = trace.get_tracer(service_name)

    # Auto-instrument FastAPI
    FastAPIInstrumentor.instrument_app(app)

    # Auto-instrument httpx (used by BFF gateway)
    try:
        HTTPXClientInstrumentor().instrument()
    except Exception:
        pass

    logger.info("OpenTelemetry instrumentation active for %s", service_name)


@contextmanager
def trace_span(name: str, attributes: Optional[dict] = None):
    """
    Context manager for creating a traced span around a block of code.

    Usage:
        with trace_span("fedavg", {"n_branches": 5, "round": 3}):
            result = federated_average(submissions)
    """
    if not OTEL_AVAILABLE or _tracer is None:
        yield
        return

    with _tracer.start_as_current_span(name) as span:
        if attributes:
            for k, v in attributes.items():
                try:
                    span.set_attribute(k, v)
                except Exception:
                    span.set_attribute(k, str(v))
        yield span


def add_span_event(name: str, attributes: Optional[dict] = None):
    """Add an event to the current active span."""
    if not OTEL_AVAILABLE:
        return
    current_span = trace.get_current_span()
    if current_span and current_span.is_recording():
        current_span.add_event(name, attributes=attributes or {})
