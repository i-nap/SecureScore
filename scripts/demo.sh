#!/usr/bin/env bash
# =============================================================
#  SecureScore Bank Suite — Full System Demo Script
#  Spins up all services, seeds data, runs one federated round,
#  and opens the browser to the dashboard.
#
#  Usage:
#    ./scripts/demo.sh              # full demo (requires Docker)
#    ./scripts/demo.sh --local      # run without Docker (bare Python)
#    ./scripts/demo.sh --ci         # headless mode for CI
# =============================================================

set -euo pipefail

RESET='\033[0m'; BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'

MODE="docker"
CI_MODE=false
for arg in "$@"; do
  case $arg in
    --local) MODE="local" ;;
    --ci)    CI_MODE=true ;;
  esac
done

log()  { echo -e "${BLUE}[demo]${RESET} $*"; }
ok()   { echo -e "${GREEN}[  OK ]${RESET} $*"; }
warn() { echo -e "${YELLOW}[ WARN]${RESET} $*"; }
fail() { echo -e "${RED}[FAIL ]${RESET} $*"; exit 1; }

banner() {
  echo ""
  echo -e "${BOLD}╔═══════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}║   SecureScore Bank Suite — Federated Learning Demo    ║${RESET}"
  echo -e "${BOLD}║   Privacy-Preserving Credit Scoring · Nepal Banking   ║${RESET}"
  echo -e "${BOLD}╚═══════════════════��═══════════════════════════════════╝${RESET}"
  echo ""
}

check_deps() {
  log "Checking dependencies…"
  for cmd in python3 pip; do
    command -v "$cmd" &>/dev/null || fail "$cmd not found"
  done
  if [ "$MODE" = "docker" ]; then
    command -v docker &>/dev/null || fail "docker not found"
    command -v docker-compose &>/dev/null || docker compose version &>/dev/null || fail "docker compose not found"
  fi
  ok "All dependencies present"
}

setup_env() {
  log "Setting up environment…"
  if [ ! -f .env ]; then
    cp .env.example .env
    # Generate random secrets for demo
    python3 -c "
import secrets, os
lines = open('.env').readlines()
out = []
for line in lines:
    if line.startswith('HQ_BRANCH_API_KEY=') and '=' == line.strip()[-1]:
        out.append(f'HQ_BRANCH_API_KEY={secrets.token_urlsafe(32)}\n')
    elif line.startswith('HQ_SECRET_KEY=') and '=' == line.strip()[-1]:
        out.append(f'HQ_SECRET_KEY={secrets.token_urlsafe(48)}\n')
    elif line.startswith('BFF_SECRET_KEY=') and '=' == line.strip()[-1]:
        out.append(f'BFF_SECRET_KEY={secrets.token_urlsafe(48)}\n')
    else:
        out.append(line)
open('.env', 'w').writelines(out)
print('  Secrets generated from .env.example')
"
    ok ".env created with random secrets"
  else
    ok ".env already exists"
  fi
}

generate_data() {
  log "Generating synthetic branch data (13 branches)…"
  python3 generate_data.py && ok "Branch datasets ready in generated_data/"
}

generate_certs() {
  log "Generating mTLS certificates…"
  if [ ! -f certs/ca.crt ]; then
    python3 generate_certs.py && ok "mTLS certs generated in certs/"
  else
    ok "mTLS certs already exist"
  fi
}

start_docker() {
  log "Starting services with Docker Compose…"
  docker compose up --build --detach hq-server hq-dashboard bff-gateway postgres prometheus grafana
  log "Waiting for HQ server to be healthy…"
  for i in $(seq 1 30); do
    if curl -sf http://localhost:5050/api/health > /dev/null 2>&1; then
      ok "HQ server is healthy"
      break
    fi
    sleep 2
    [ "$i" -eq 30 ] && fail "HQ server failed to start after 60s"
  done
}

start_local() {
  log "Starting services locally (background processes)…"
  log "Installing dependencies…"
  pip install -r requirements-hq.txt -q

  log "Starting HQ server on :5050…"
  python3 hq_server.py --no-mtls --port 5050 --min-nodes 1 > edge_logs/hq_server.log 2>&1 &
  HQ_PID=$!
  echo $HQ_PID > /tmp/securescore_hq.pid

  sleep 3

  log "Starting Edge API for Kathmandu on :7050…"
  python3 edge_api.py --branch kathmandu --port 7050 > edge_logs/edge_kathmandu.log 2>&1 &
  EDGE_PID=$!
  echo $EDGE_PID > /tmp/securescore_edge.pid

  log "Building & starting Go BFF Gateway on :4000…"
  ( cd go_bff && go build -o bff_gateway . ) || fail "Go BFF build failed"
  ./go_bff/bff_gateway --port 4000 > edge_logs/bff_gateway.log 2>&1 &
  BFF_PID=$!
  echo $BFF_PID > /tmp/securescore_bff.pid

  sleep 3

  # Health check
  curl -sf http://localhost:5050/api/health > /dev/null || fail "HQ server not responding"
  ok "All local services started"
}

run_demo_round() {
  log "Running demo federated round…"
  python3 -c "
import os, sys, json, base64, hashlib, time, requests
import numpy as np

API_KEY = open('.env').read()
API_KEY = next(l.split('=',1)[1].strip() for l in open('.env') if l.startswith('HQ_BRANCH_API_KEY='))

HQ = 'http://localhost:5050'

# Register 3 demo branches
branches = ['Kathmandu', 'Pokhara', 'Sarlahi']
tokens = {}
for b in branches:
    r = requests.post(f'{HQ}/api/register', json={'branch': b, 'api_key': API_KEY, 'role': 'branch_operator'})
    tokens[b] = r.json()['token']
    print(f'  ✓ {b} registered')

# Build a tiny demo model
try:
    import xgboost as xgb
    X = np.random.rand(200, 8).astype(np.float32)
    y = (X[:,0] > 0.5).astype(int)
    booster = xgb.train({'max_depth': 5, 'n_estimators': 100, 'objective': 'binary:logistic'}, xgb.DMatrix(X, label=y), num_boost_round=100, verbose_eval=False)
    raw = booster.save_raw()
    b64 = base64.b64encode(raw).decode()
    sha = hashlib.sha256(raw).hexdigest()
    n_est, max_d = 100, 5
except ImportError:
    b64 = base64.b64encode(b'\\x00'*512).decode()
    sha = hashlib.sha256(b'\\x00'*512).hexdigest()
    n_est, max_d = 100, 5

# Submit weights from each branch
for i, b in enumerate(branches):
    payload = {
        'branch': b, 'branch_type': 'urban',
        'weights': {'format': 'xgboost_raw_b64', 'n_estimators': n_est, 'max_depth': max_d,
                    'raw_model_b64': b64, 'byte_size': len(base64.b64decode(b64)),
                    'sha256_hash': sha, 'dp_epsilon': 1.0, 'dp_noise_std': 0.1},
        'metrics': {'accuracy': 0.87 + i*0.01, 'f1': 0.85 + i*0.01,
                    'train_size': 1000 + i*200, 'test_size': 250, 'tn': 80, 'fp': 10, 'fn': 12, 'tp': 98, 'timestamp': ''}
    }
    r = requests.post(f'{HQ}/api/submit_weights', json=payload, headers={'Authorization': f'Bearer {tokens[b]}'})
    print(f'  ✓ {b} weights submitted (status={r.status_code})')

print()
print('  Waiting for auto-aggregation (up to 90s)...')
for _ in range(45):
    time.sleep(2)
    r = requests.get(f'{HQ}/api/health')
    status = requests.get(f'{HQ}/api/status').json()
    if status.get('global_model_ready'):
        print(f'  ✓ Global model v{status[\"active_version\"]} published!')
        break
else:
    print('  ⚠ Auto-aggregation not triggered yet (normal if min-nodes > 3)')
"
  ok "Demo round complete"
}

print_urls() {
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}  Service URLs${RESET}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "  ${GREEN}Frontend (Next.js)${RESET}        http://localhost:3000"
  echo -e "  ${GREEN}BFF Gateway${RESET}               http://localhost:4000/docs"
  echo -e "  ${GREEN}HQ Server API${RESET}             http://localhost:5050/docs"
  echo -e "  ${GREEN}HQ Dashboard (Streamlit)${RESET}  http://localhost:8501"
  echo -e "  ${GREEN}MLflow Experiments${RESET}        http://localhost:5001"
  echo -e "  ${GREEN}Grafana${RESET}                   http://localhost:3001  (admin / securescore_grafana)"
  echo -e "  ${GREEN}Prometheus${RESET}                http://localhost:9090"
  echo ""
  echo -e "  ${YELLOW}Demo login:${RESET}  customer@securescore.np / demo123  (Customer portal)"
  echo -e "  ${YELLOW}Demo login:${RESET}  manager@kathmandu.securescore.np / demo123  (Branch Manager)"
  echo -e "  ${YELLOW}Demo login:${RESET}  hq@securescore.np / demo123  (HQ Admin)"
  echo ""
}

open_browser() {
  if $CI_MODE; then return; fi
  URL="http://localhost:3000"
  log "Opening browser at $URL…"
  case "$(uname -s)" in
    Darwin)  open "$URL" ;;
    Linux)   xdg-open "$URL" 2>/dev/null || true ;;
    MINGW*|MSYS*|CYGWIN*) start "$URL" ;;
  esac
}

cleanup() {
  log "Demo complete. To stop services:"
  if [ "$MODE" = "docker" ]; then
    echo "  docker compose down"
  else
    echo "  kill \$(cat /tmp/securescore_*.pid 2>/dev/null)"
  fi
}

# ── Main ─────────────────────────────────────────────────
banner
check_deps
setup_env
generate_data
generate_certs

if [ "$MODE" = "docker" ]; then
  start_docker
else
  start_local
fi

run_demo_round
print_urls
open_browser
cleanup
