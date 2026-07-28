# ═══════════════════════════════════════════════════════════
#   SecureScore HQ — Federated Aggregation Server (Docker)
#   Security-hardened: non-root, read-only FS, no-new-privileges
# ═══════════════════════════════════════════════════════════
#
# Build:
#   docker build -t securescore-hq .
#
# Run:
#   docker run -p 5050:5050 \
#     --env-file .env \
#     -v ./hq_state:/app/hq_state \
#     -v ./certs:/app/certs:ro \
#     securescore-hq
# ═══════════════════════════════════════════════════════════

FROM python:3.13-slim

LABEL maintainer="SecureScore Team"
LABEL description="Federated Learning HQ Aggregation Server (Security Hardened)"
LABEL version="3.0.0"

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies (needed for XGBoost compilation on some platforms)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for Docker layer caching
COPY requirements-hq.txt .
RUN pip install --no-cache-dir -r requirements-hq.txt

# Copy the HQ server code + the local packages it imports
# (security.cert_monitor is imported unguarded; db/observability are required too).
COPY hq_server.py .
COPY .env.example .
COPY db ./db
COPY security ./security
COPY shared ./shared
COPY observability ./observability
COPY hq_service ./hq_service
COPY models ./models
# Optional dual-engine GNN pipeline. Its deps (torch, numpy) are already in
# requirements-hq.txt; without this COPY the import fails and /mu/status reports
# unavailable, which reads as a missing-requirements problem but is not one.
COPY mu_graph_coder ./mu_graph_coder

# ── Security: non-root user ──────────────────────────────
RUN groupadd -r securescore && \
    useradd -r -g securescore -d /app -s /usr/sbin/nologin securescore && \
    mkdir -p /app/hq_state/registry /app/hq_state/audit /app/edge_logs /tmp/hq && \
    chown -R securescore:securescore /app /tmp/hq

USER securescore

# Expose the default HQ port
EXPOSE 5050

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import requests; r=requests.get('http://localhost:5050/api/health'); exit(0 if r.status_code==200 else 1)"

# Default entrypoint
ENTRYPOINT ["python", "hq_server.py"]

# Default arguments — use --no-mtls for dev if certs not mounted
CMD ["--port", "5050", "--min-nodes", "3", "--round-interval", "60"]
