# SecureScore Bank Suite

Privacy-preserving federated credit scoring + core banking for Nepali banks.  
Branch data never leaves the branch. HQ aggregates model weights only.

> **Final Year Project — Virinchi College, 2025**  
> For complete setup instructions see **[HOWTORUN.md](HOWTORUN.md)**

---

## What the system does

SecureScore combines two stacks in one launch:

| Stack | Purpose | Technology |
|---|---|---|
| **Core Banking** | Accounts, transfers, FDs, loans, EOD/BOD | Docker (Nginx, PostgreSQL, Kafka, Redis) |
| **Federated Learning** | Credit scoring, fraud, AML, risk — privacy-preserving | Python (HQ + Edge) + **Go BFF** + Next.js |

The two stacks share a single Next.js frontend accessible at `http://localhost:3000`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Next.js Frontend  :3000                │
│     Customer │ Branch Manager │ HQ Admin portals         │
└────────────────────────┬────────────────────────────────┘
                         │ JWT (HS256)
                         ▼
┌────────────────────────────────────────────────────────┐
│              Go BFF Gateway  :4000                     │
│  JWT auth · CORS · IDS · WebSocket · SQLite banking    │
└──────┬──────────────────────────────────┬─────────────┘
       │                                  │
       ▼                                  ▼
┌─────────────┐                  ┌────────────────────┐
│  HQ Server  │                  │  Edge API (Python) │
│  Python     │                  │  :7050 Kathmandu   │
│  :5050      │                  │  :7257 Pokhara     │
│  FedAvg+DP  │◄─── mTLS ───────│  :7115 Sarlahi     │
│  Audit chain│                  │  XGBoost + SHAP    │
└─────────────┘                  └────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              Docker Banking Stack  :80 (Nginx)          │
│  Auth Service · Banking Service · PostgreSQL            │
│  Kafka · Redis · Nginx reverse proxy                    │
└─────────────────────────────────────────────────────────┘
```

---

## Services & Ports

| Service | Port | Language | Role |
|---|---|---|---|
| Next.js Frontend | 3000 | TypeScript | All three portals |
| **Go BFF Gateway** | 4000 | **Go** | Auth, routing, banking API |
| HQ Aggregation Server | 5050 | Python | FedAvg, DP, audit, RBAC |
| HQ Spec Service | 6051 | Python | `/api/v1` spec endpoints |
| Branch Spec Service | 6050 | Python | Branch spec endpoints |
| Edge API — Kathmandu | 7050 | Python | ML inference, SHAP |
| Edge API — Pokhara | 7257 | Python | ML inference, SHAP |
| Edge API — Sarlahi | 7115 | Python | ML inference, SHAP |
| Nginx (banking) | 80 | Docker | Reverse proxy for core banking |
| Auth Service | 80/auth | Docker | JWT RS256, user management |
| Banking Service | 80/api | Docker | Accounts, loans, transactions |
| PostgreSQL (auth) | 5432 | Docker | User store |
| PostgreSQL (banking) | 5433 | Docker | Banking transactions |
| Kafka | 9092 | Docker | Event streaming |
| Redis | 6379 | Docker | Token revocation |

---

## Demo Login Accounts

All seven RBAC roles are seeded out of the box (admin can create more via `/hq/users`).
Each customer self-seeds a savings account + ~6 months of transactions on first run, so
spending insights, statements, and notifications are live immediately.

| Username | Password | Role | Branch | Lands on |
|---|---|---|---|---|
| `admin` | `admin123` | HQ Admin (superuser) | HQ | `/hq/dashboard` |
| `ceo` | `ceo123` | CEO (read-only exec) | HQ | `/hq/executive` |
| `it_admin` | `it123` | IT department | HQ | `/hq/it-console` |
| `kathmandu_mgr` | `branch123` | Branch Manager | Kathmandu | `/branch/dashboard` |
| `pokhara_mgr` | `branch123` | Branch Manager | Pokhara | `/branch/dashboard` |
| `sarlahi_mgr` | `branch123` | Branch Manager | Sarlahi | `/branch/dashboard` |
| `cashier1` | `cashier123` | Cashier / Teller | Kathmandu | `/cashier/teller` |
| `cust001` | `customer123` | Customer | Kathmandu | `/customer/dashboard` |
| `cust002` | `customer123` | Customer | Sarlahi | `/customer/dashboard` |
| `cust003` | `customer123` | Customer | Pokhara | `/customer/dashboard` |

Permissions are not hard-coded to roles — they come from an editable role→permission
matrix (`/hq/roles`) plus per-user overrides, so access can be re-wired with no code change.

---

## Key Features

### Federated Learning
- 13 Nepal branches — urban (Kathmandu), semi-urban (Pokhara), rural (Sarlahi)
- XGBoost models trained locally; only weights aggregated at HQ
- Differential Privacy (ε configurable) on weight updates
- Byzantine fault tolerance — cosine-similarity outlier detection
- mTLS branch-to-HQ communication
- SHAP-based XAI explanations for every credit decision
- μGraphCoder GNN for cross-branch topology fingerprints

### AI Models (6 live + 4 extended)
| Model | Algorithm | Purpose |
|---|---|---|
| Fraud Detection | IsolationForest + XGBoost | Behavioral anomaly scoring |
| Loan Default | XGBoost | NRB-compliant risk grading A–F |
| Churn Predictor | Random Forest | 30-day churn probability |
| AML Monitor | IsolationForest | Structuring & round-amount detection |
| Cash Flow Forecaster | ES + MA Ensemble | 3-month forecast with CI |
| Unified Risk Engine | Weighted Ensemble | 5-dimension composite score |
| Collateral Estimator | Gradient Boosting | Property valuation |
| Rate Optimizer | Bayesian Optimization | Branch interest rate recommendation |
| Remittance Analyzer | LSTM + IsolationForest | Cross-border flow anomaly |
| HQ Fingerprint | Federated XGBoost | Global model, zero branch compute |

### Core Banking + NEO Banking (Go BFF + SQLite)
- Account applications → branch approval workflow; Savings / Current / Salary accounts
- Fixed Deposits with maturity processing; fund transfers with fee calculation
- Account statements (date-range) with Merkle-anchored audit proof
- EOD/BOD batch processing (interest posting, dormant marking, FD maturity, maturity preview)
- **Double-entry General Ledger** + live trial balance (`/hq/trial-balance`)
- **Maker-checker (4-eyes)** approval queue for high-value teller cash-out (maker ≠ checker)
- **Cashier / teller portal** — deposits, withdrawals, cheque deposit, enquiry, cash position
- **Cards** — debit + USD/forex card, PIN-at-use POS/ATM, online/POS/ATM channel controls
- **Capital markets (Nepal)** — MeroShare/CDS demat, IPO (ASBA) application + allotment, portfolio
- **NEO customer banking** — bill pay, real-ledger spending insights, loan eligibility self-check,
  in-app notifications (live bell), command palette (⌘K)
- **CEO** (read-only KPIs) and **IT** (system health, IDS) consoles

### Security Hardening
- JWT RS256 (banking Docker) + HS256 (FL stack)
- IP-based IDS with brute-force banning
- Behavioural threat detection
- Tamper-evident SHA-256 audit chain
- Honeypot endpoints
- TOTP MFA support
- JWT key rotation
- mTLS with cert monitoring and auto-rotation
- **Dynamic RBAC** — 7 roles (admin / ceo / it_admin / branch_manager / cashier / customer / viewer)
  over an editable permission matrix + per-user overrides; Argon2id for new accounts

---

## Repository Layout

```
.
├── go_bff/                  Go BFF Gateway (compiled binary here)
│   ├── main.go
│   └── bff_gateway.exe      Compiled binary (Windows)
├── hq_server.py             HQ Aggregation Server (FastAPI)
├── edge_api.py              Edge Node REST API (FastAPI)
├── edge_node.py             Edge training daemon (XGBoost + SHAP)
├── bff_gateway.py           Legacy Python BFF (superseded by go_bff/)
├── start.py                 FL stack launcher (starts HQ + Edges + BFF + Frontend)
├── launch.ps1               Complete system launcher (banking + FL, Windows)
├── seed_banking_data.py     Demo data seed script
├── frontend/                Next.js 14 + TypeScript + Tailwind
│   └── app/(dashboard)/
│       ├── branch/          Branch manager pages
│       ├── customer/        Customer pages
│       └── hq/              HQ admin pages
├── db/
│   └── models.py            SQLAlchemy models (SQLite dev / PostgreSQL prod)
├── models/                  6 AI sub-model implementations
├── security/                IDS, threat detector, cert monitor, TOTP, audit
├── pi_edge/                 ARM64 Raspberry Pi edge package
├── mu_graph_coder/          μGraphCoder GNN implementation
├── observability/           Prometheus metrics, OpenTelemetry tracing, structured logs
├── monitoring/              Prometheus config, Grafana dashboards, alert rules
├── helm/                    Helm charts for Kubernetes deployment
├── tests/                   Unit + integration test suite (pytest)
├── load_tests/              Locust load tests
├── docs/                    Full documentation
└── HOWTORUN.md              Complete setup and run guide
```

---

## Quick Start

See **[HOWTORUN.md](HOWTORUN.md)** for complete instructions.

**TL;DR (Windows):**
```powershell
# 1. One-time setup
python seed_banking_data.py

# 2. Launch everything
Set-ExecutionPolicy -Scope Process Bypass
.\launch.ps1
```

---
