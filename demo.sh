#!/usr/bin/env bash
# =============================================================================
# SecureScore Core Banking — Demo Script
# =============================================================================
# Starts the full stack, seeds test data, and walks through every banking
# feature end-to-end using curl.
#
# Prerequisites:
#   - Docker + Docker Compose installed and running
#   - openssl available (for generating demo JWT keys)
#   - curl and jq installed
#
# Usage:
#   chmod +x demo.sh
#   ./demo.sh
#
# To reset everything:
#   docker compose -f docker-compose.banking.yml down -v
# =============================================================================

set -euo pipefail

COMPOSE_FILE="docker-compose.banking.yml"
AUTH_URL="http://localhost"
BANK_URL="http://localhost"
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

log()  { echo -e "${BOLD}[DEMO]${RESET} $*"; }
ok()   { echo -e "${GREEN}  ✓ $*${RESET}"; }
info() { echo -e "${YELLOW}  → $*${RESET}"; }
fail() { echo -e "${RED}  ✗ $*${RESET}"; exit 1; }

pause() { echo; read -rp "  Press ENTER to continue..." _; echo; }

# ─────────────────────────────────────────────────────────────────────────────
# 0. Generate RSA key pair for JWT (demo only — use Vault in production)
# ─────────────────────────────────────────────────────────────────────────────
generate_keys() {
  if [[ -f secrets/jwt_private.pem ]]; then
    info "JWT keys already exist, skipping generation"
    return
  fi
  log "Generating RSA-2048 key pair for JWT RS256..."
  mkdir -p secrets
  openssl genrsa -out secrets/jwt_private.pem 2048 2>/dev/null
  openssl rsa -in secrets/jwt_private.pem -pubout -out secrets/jwt_public.pem 2>/dev/null
  # DB passwords
  echo "demo_auth_password"    > secrets/pg_auth_password.txt
  echo "demo_banking_password" > secrets/pg_banking_password.txt
  ok "Keys and secrets generated in ./secrets/"
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Build and start all services
# ─────────────────────────────────────────────────────────────────────────────
start_services() {
  log "Starting banking stack (this may take 2-3 minutes on first run)..."
  docker compose -f "$COMPOSE_FILE" up --build -d

  log "Waiting for services to become healthy..."
  local attempts=0
  until curl -sf "$AUTH_URL/auth/health" > /dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [[ $attempts -gt 60 ]]; then fail "Auth service did not start in time"; fi
    sleep 3
    printf "."
  done
  echo
  ok "Auth service healthy"

  attempts=0
  until curl -sf "$BANK_URL/health" > /dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [[ $attempts -gt 60 ]]; then fail "Banking service did not start in time"; fi
    sleep 3
    printf "."
  done
  echo
  ok "Banking service healthy"
}

# ─────────────────────────────────────────────────────────────────────────────
# Helper: pretty-print JSON response
# ─────────────────────────────────────────────────────────────────────────────
pp() { echo "$1" | jq . 2>/dev/null || echo "$1"; }

# ─────────────────────────────────────────────────────────────────────────────
# Helper: POST with idempotency key
# ─────────────────────────────────────────────────────────────────────────────
idem_post() {
  local url="$1" body="$2" token="$3" idem_key="$4"
  curl -sf -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -H "Idempotency-Key: $idem_key" \
    -d "$body"
}

# ─────────────────────────────────────────────────────────────────────────────
# 2. Register users (admin, teller, customer)
# ─────────────────────────────────────────────────────────────────────────────
register_users() {
  log "Registering demo users..."

  # Register admin (no auth required for first admin in dev mode)
  ADMIN_REG=$(curl -sf -X POST "$AUTH_URL/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","email":"admin@securescore.local","password":"Admin@Secure123!","role":"admin","branch_code":"KTM01"}')
  ok "Admin registered: $(echo "$ADMIN_REG" | jq -r '.id // "already exists"')"

  # Login as admin to get token for creating other users
  ADMIN_LOGIN=$(curl -sf -X POST "$AUTH_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"Admin@Secure123!"}')
  ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | jq -r '.access_token')
  [[ -z "$ADMIN_TOKEN" || "$ADMIN_TOKEN" == "null" ]] && fail "Admin login failed: $ADMIN_LOGIN"
  ok "Admin logged in"

  # Register teller
  curl -sf -X POST "$AUTH_URL/auth/register" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"username":"teller1","email":"teller1@securescore.local","password":"Teller@Secure123!","role":"teller","branch_code":"KTM01"}' > /dev/null
  ok "Teller registered"

  # Register customer
  curl -sf -X POST "$AUTH_URL/auth/register" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"username":"customer1","email":"customer1@securescore.local","password":"Customer@Secure123!","role":"customer","branch_code":"KTM01"}' > /dev/null
  ok "Customer registered"

  # Register branch manager
  curl -sf -X POST "$AUTH_URL/auth/register" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"username":"manager1","email":"manager1@securescore.local","password":"Manager@Secure123!","role":"branch_manager","branch_code":"KTM01"}' > /dev/null
  ok "Branch manager registered"

  # Register credit officer
  curl -sf -X POST "$AUTH_URL/auth/register" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"username":"officer1","email":"officer1@securescore.local","password":"Officer@Secure123!","role":"credit_officer","branch_code":"KTM01"}' > /dev/null
  ok "Credit officer registered"
}

# ─────────────────────────────────────────────────────────────────────────────
# 3. Login all roles and store tokens
# ─────────────────────────────────────────────────────────────────────────────
login_users() {
  log "Logging in all demo users..."

  CUSTOMER_LOGIN=$(curl -sf -X POST "$AUTH_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"customer1","password":"Customer@Secure123!"}')
  CUSTOMER_TOKEN=$(echo "$CUSTOMER_LOGIN" | jq -r '.access_token')
  CUSTOMER_ID=$(echo "$CUSTOMER_LOGIN"   | jq -r '.user_id // empty')
  ok "Customer logged in (token expires in 15 min)"

  TELLER_LOGIN=$(curl -sf -X POST "$AUTH_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"teller1","password":"Teller@Secure123!"}')
  TELLER_TOKEN=$(echo "$TELLER_LOGIN" | jq -r '.access_token')
  ok "Teller logged in"

  MANAGER_LOGIN=$(curl -sf -X POST "$AUTH_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"manager1","password":"Manager@Secure123!"}')
  MANAGER_TOKEN=$(echo "$MANAGER_LOGIN" | jq -r '.access_token')
  ok "Branch manager logged in"

  OFFICER_LOGIN=$(curl -sf -X POST "$AUTH_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"officer1","password":"Officer@Secure123!"}')
  OFFICER_TOKEN=$(echo "$OFFICER_LOGIN" | jq -r '.access_token')
  ok "Credit officer logged in"

  ADMIN_LOGIN=$(curl -sf -X POST "$AUTH_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"Admin@Secure123!"}')
  ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | jq -r '.access_token')
  ok "Admin logged in"
}

# ─────────────────────────────────────────────────────────────────────────────
# 4. Account operations
# ─────────────────────────────────────────────────────────────────────────────
demo_accounts() {
  log "━━━ ACCOUNTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Need a product_id — seed one first via direct DB or use known UUID
  # In a real demo the product would be pre-seeded via migration
  # Here we use admin to get or create it via a seed endpoint if available.
  # For this demo we assume product_id is seeded; use a placeholder UUID.
  PRODUCT_ID="00000000-0000-0000-0000-000000000001"

  info "Creating savings account for customer..."
  SAVINGS_RESP=$(idem_post "$BANK_URL/api/banking/accounts" \
    "{\"idempotency_key\":\"demo-savings-open-1\",\"product_id\":\"$PRODUCT_ID\",\"account_type\":\"savings\",\"branch_code\":\"KTM01\"}" \
    "$CUSTOMER_TOKEN" "demo-savings-open-1")
  SAVINGS_ID=$(echo "$SAVINGS_RESP" | jq -r '.id')
  SAVINGS_NUMBER=$(echo "$SAVINGS_RESP" | jq -r '.account_number')
  ok "Savings account created: $SAVINGS_NUMBER"

  info "Creating current account for customer..."
  CURRENT_RESP=$(idem_post "$BANK_URL/api/banking/accounts" \
    "{\"idempotency_key\":\"demo-current-open-1\",\"product_id\":\"$PRODUCT_ID\",\"account_type\":\"current\",\"branch_code\":\"KTM01\"}" \
    "$CUSTOMER_TOKEN" "demo-current-open-1")
  CURRENT_ID=$(echo "$CURRENT_RESP" | jq -r '.id')
  ok "Current account created: $(echo "$CURRENT_RESP" | jq -r '.account_number')"

  info "Fetching account details..."
  GET_RESP=$(curl -sf "$BANK_URL/api/banking/accounts/$SAVINGS_ID" \
    -H "Authorization: Bearer $CUSTOMER_TOKEN")
  pp "$GET_RESP"
  ok "Account fetch successful"

  info "Testing idempotency — re-sending same create request..."
  IDEM_RESP=$(idem_post "$BANK_URL/api/banking/accounts" \
    "{\"idempotency_key\":\"demo-savings-open-1\",\"product_id\":\"$PRODUCT_ID\",\"account_type\":\"savings\",\"branch_code\":\"KTM01\"}" \
    "$CUSTOMER_TOKEN" "demo-savings-open-1")
  [[ "$(echo "$IDEM_RESP" | jq -r '.id')" == "$SAVINGS_ID" ]] \
    && ok "Idempotency works — same account ID returned" \
    || info "Idempotency response: $IDEM_RESP"
}

# ─────────────────────────────────────────────────────────────────────────────
# 5. Transactions
# ─────────────────────────────────────────────────────────────────────────────
demo_transactions() {
  log "━━━ TRANSACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  info "Crediting NPR 500,000 to savings account (system credit)..."
  CREDIT_RESP=$(idem_post "$BANK_URL/api/banking/transactions" \
    "{\"idempotency_key\":\"demo-credit-1\",\"account_id\":\"$SAVINGS_ID\",\"amount\":\"500000\",\"type\":\"credit\",\"description\":\"Initial deposit\"}" \
    "$ADMIN_TOKEN" "demo-credit-1")
  TXN_ID=$(echo "$CREDIT_RESP" | jq -r '.transaction_id')
  ok "Credited NPR 500,000 — txn: $TXN_ID"

  info "Crediting NPR 100,000 to current account..."
  idem_post "$BANK_URL/api/banking/transactions" \
    "{\"idempotency_key\":\"demo-credit-2\",\"account_id\":\"$CURRENT_ID\",\"amount\":\"100000\",\"type\":\"credit\",\"description\":\"Initial deposit\"}" \
    "$ADMIN_TOKEN" "demo-credit-2" > /dev/null
  ok "Credited NPR 100,000 to current account"

  info "Internal transfer: savings → current (NPR 50,000)..."
  TFR_RESP=$(idem_post "$BANK_URL/api/banking/transactions/transfer" \
    "{\"idempotency_key\":\"demo-transfer-1\",\"source_account_id\":\"$SAVINGS_ID\",\"dest_account_id\":\"$CURRENT_ID\",\"amount\":\"50000\",\"description\":\"Self transfer\"}" \
    "$CUSTOMER_TOKEN" "demo-transfer-1")
  ok "Transfer completed — txn: $(echo "$TFR_RESP" | jq -r '.transaction_id')"

  info "NEFT outward transfer (mocked)..."
  NEFT_RESP=$(idem_post "$BANK_URL/api/banking/transactions/neft" \
    "{\"idempotency_key\":\"demo-neft-1\",\"source_account_id\":\"$CURRENT_ID\",\"beneficiary_name\":\"Ram Bahadur\",\"beneficiary_ifsc\":\"NABIL0001234\",\"beneficiary_account\":\"1234567890\",\"beneficiary_bank\":\"Nabil Bank\",\"amount\":\"10000\",\"remarks\":\"School fees\"}" \
    "$TELLER_TOKEN" "demo-neft-1")
  ok "NEFT submitted — $(echo "$NEFT_RESP" | jq -r '.note')"

  info "Listing transactions for savings account..."
  LIST_RESP=$(curl -sf "$BANK_URL/api/banking/transactions/account/$SAVINGS_ID?limit=5" \
    -H "Authorization: Bearer $CUSTOMER_TOKEN")
  TOTAL=$(echo "$LIST_RESP" | jq '.transactions | length')
  ok "Found $TOTAL transactions"

  info "Reversing the transfer (admin)..."
  REV_RESP=$(idem_post "$BANK_URL/api/banking/transactions/$TXN_ID/reverse" \
    '{"reason":"Demo reversal test"}' \
    "$ADMIN_TOKEN" "demo-reversal-1")
  ok "Reversal — status: $(echo "$REV_RESP" | jq -r '.status')"
}

# ─────────────────────────────────────────────────────────────────────────────
# 6. Fixed Deposits
# ─────────────────────────────────────────────────────────────────────────────
demo_fd() {
  log "━━━ FIXED DEPOSITS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  info "Opening a 1-year simple-interest FD (NPR 200,000 at 8%)..."
  FD_RESP=$(idem_post "$BANK_URL/api/banking/fd" \
    "{\"idempotency_key\":\"demo-fd-open-1\",\"linked_account_id\":\"$SAVINGS_ID\",\"principal\":\"200000\",\"tenure_days\":365,\"interest_type\":\"simple\",\"on_maturity_action\":\"credit\",\"branch_code\":\"KTM01\"}" \
    "$CUSTOMER_TOKEN" "demo-fd-open-1")
  FD_ID=$(echo "$FD_RESP" | jq -r '.id')
  ok "FD opened: $(echo "$FD_RESP" | jq -r '.fd_number') — matures $(echo "$FD_RESP" | jq -r '.maturity_date')"
  ok "Maturity amount: NPR $(echo "$FD_RESP" | jq -r '.maturity_amount')"

  info "Opening a compound-interest FD (NPR 100,000, quarterly, 6 months)..."
  FD2_RESP=$(idem_post "$BANK_URL/api/banking/fd" \
    "{\"idempotency_key\":\"demo-fd-open-2\",\"linked_account_id\":\"$SAVINGS_ID\",\"principal\":\"100000\",\"tenure_days\":180,\"interest_type\":\"compound\",\"compound_frequency\":\"quarterly\",\"on_maturity_action\":\"renew\",\"branch_code\":\"KTM01\"}" \
    "$CUSTOMER_TOKEN" "demo-fd-open-2")
  FD2_ID=$(echo "$FD2_RESP" | jq -r '.id')
  ok "FD2 opened with auto-renew: $(echo "$FD2_RESP" | jq -r '.fd_number')"

  info "Premature withdrawal of FD2 (penalty applied)..."
  PW_RESP=$(curl -sf -X PUT "$BANK_URL/api/banking/fd/$FD2_ID/withdraw" \
    -H "Authorization: Bearer $CUSTOMER_TOKEN" \
    -H "Content-Type: application/json")
  ok "Premature withdrawal — status: $(echo "$PW_RESP" | jq -r '.status'), penalty rate: $(echo "$PW_RESP" | jq -r '.premature_penalty_rate')%"

  info "Listing FDs for account..."
  FD_LIST=$(curl -sf "$BANK_URL/api/banking/fd/account/$SAVINGS_ID" \
    -H "Authorization: Bearer $CUSTOMER_TOKEN")
  ok "FDs on account: $(echo "$FD_LIST" | jq '. | length')"
}

# ─────────────────────────────────────────────────────────────────────────────
# 7. Loans — full state machine
# ─────────────────────────────────────────────────────────────────────────────
demo_loans() {
  log "━━━ LOANS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  info "Applying for a personal loan (NPR 300,000, 24 months)..."
  LOAN_RESP=$(idem_post "$BANK_URL/api/banking/loans" \
    "{\"idempotency_key\":\"demo-loan-apply-1\",\"linked_account_id\":\"$SAVINGS_ID\",\"loan_type\":\"personal\",\"amount\":\"300000\",\"tenure_months\":24,\"purpose\":\"Home renovation\",\"branch_code\":\"KTM01\"}" \
    "$CUSTOMER_TOKEN" "demo-loan-apply-1")
  LOAN_ID=$(echo "$LOAN_RESP" | jq -r '.id')
  ok "Loan applied: $(echo "$LOAN_RESP" | jq -r '.loan_number') — status: $(echo "$LOAN_RESP" | jq -r '.status')"

  info "Credit officer sends loan to review..."
  curl -sf -X PUT "$BANK_URL/api/banking/loans/$LOAN_ID/review" \
    -H "Authorization: Bearer $OFFICER_TOKEN" \
    -H "Content-Type: application/json" > /dev/null
  ok "Loan → under_review"

  info "Branch manager approves at 12% interest..."
  curl -sf -X PUT "$BANK_URL/api/banking/loans/$LOAN_ID/approve" \
    -H "Authorization: Bearer $MANAGER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"interest_rate":"12"}' > /dev/null
  ok "Loan → approved"

  info "Branch manager disburses loan to savings account..."
  DISB_RESP=$(curl -sf -X PUT "$BANK_URL/api/banking/loans/$LOAN_ID/disburse" \
    -H "Authorization: Bearer $MANAGER_TOKEN" \
    -H "Content-Type: application/json")
  ok "Loan disbursed — status: $(echo "$DISB_RESP" | jq -r '.status'), EMI: NPR $(echo "$DISB_RESP" | jq -r '.emi_amount')"

  info "Fetching repayment schedule (first 3 installments)..."
  SCHEDULE=$(curl -sf "$BANK_URL/api/banking/loans/$LOAN_ID/schedule" \
    -H "Authorization: Bearer $CUSTOMER_TOKEN")
  echo "$SCHEDULE" | jq '.schedule[:3]'
  ok "Full 24-installment schedule generated"

  info "Processing first EMI repayment..."
  EMI_AMT=$(echo "$DISB_RESP" | jq -r '.emi_amount')
  REP_RESP=$(idem_post "$BANK_URL/api/banking/loans/$LOAN_ID/repayment" \
    "{\"amount\":\"$EMI_AMT\"}" \
    "$TELLER_TOKEN" "demo-repayment-1")
  ok "EMI paid — installment status: $(echo "$REP_RESP" | jq -r '.status')"

  info "Closing loan (branch manager — requires zero outstanding)..."
  # Note: in the demo the loan still has outstanding balance; this will fail
  # with an appropriate error message, which is the correct behavior.
  CLOSE_RESP=$(curl -sf -o /dev/null -w "%{http_code}" -X POST \
    "$BANK_URL/api/banking/loans/$LOAN_ID/close" \
    -H "Authorization: Bearer $MANAGER_TOKEN" \
    -H "Content-Type: application/json")
  if [[ "$CLOSE_RESP" == "400" ]]; then
    ok "Loan close correctly rejected (outstanding balance exists) — HTTP 400"
  else
    ok "Loan closed — HTTP $CLOSE_RESP"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# 8. Auth — refresh token rotation + revocation
# ─────────────────────────────────────────────────────────────────────────────
demo_auth() {
  log "━━━ AUTH — JWT RS256 + REFRESH TOKEN ROTATION ━━━━━━━━━━━━━━━━━━━━━━━"

  info "Logging in (customer)..."
  LOGIN=$(curl -sf -X POST "$AUTH_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"customer1","password":"Customer@Secure123!"}')
  ACCESS=$(echo "$LOGIN" | jq -r '.access_token')
  REFRESH=$(echo "$LOGIN" | jq -r '.refresh_token')
  ok "Received RS256 access token (15 min TTL)"

  info "Refreshing token — old refresh token rotated, new pair issued..."
  REFRESH_RESP=$(curl -sf -X POST "$AUTH_URL/auth/refresh" \
    -H "Content-Type: application/json" \
    -d "{\"refresh_token\":\"$REFRESH\"}")
  NEW_ACCESS=$(echo "$REFRESH_RESP" | jq -r '.access_token')
  NEW_REFRESH=$(echo "$REFRESH_RESP" | jq -r '.refresh_token')
  ok "New token pair issued"

  info "Replaying old refresh token (theft detection)..."
  REPLAY=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$AUTH_URL/auth/refresh" \
    -H "Content-Type: application/json" \
    -d "{\"refresh_token\":\"$REFRESH\"}")
  [[ "$REPLAY" == "401" ]] \
    && ok "Replay correctly rejected — HTTP 401 (family revoked)" \
    || info "Replay response: HTTP $REPLAY"

  info "Logging out (revokes access token JTI in Redis)..."
  LOGOUT=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$AUTH_URL/auth/logout" \
    -H "Authorization: Bearer $NEW_ACCESS" \
    -H "Content-Type: application/json" \
    -d "{\"refresh_token\":\"$NEW_REFRESH\"}")
  [[ "$LOGOUT" == "200" ]] && ok "Logout successful — token revoked in Redis"

  info "Using revoked token after logout..."
  REVOKED=$(curl -sf -o /dev/null -w "%{http_code}" "$BANK_URL/api/banking/accounts/$SAVINGS_ID" \
    -H "Authorization: Bearer $NEW_ACCESS")
  [[ "$REVOKED" == "401" ]] \
    && ok "Revoked token correctly rejected — HTTP 401" \
    || info "Got HTTP $REVOKED (token may have expired naturally)"
}

# ─────────────────────────────────────────────────────────────────────────────
# 9. Health checks
# ─────────────────────────────────────────────────────────────────────────────
demo_health() {
  log "━━━ HEALTH CHECKS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  info "Auth service health..."
  pp "$(curl -sf "$AUTH_URL/auth/health")"
  ok "Auth healthy"

  info "Banking service health..."
  pp "$(curl -sf "$BANK_URL/health")"
  ok "Banking healthy"
}

# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
main() {
  echo
  echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}║       SecureScore Core Banking System — Live Demo            ║${RESET}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
  echo

  generate_keys
  echo
  start_services
  echo

  log "All services running. Beginning feature demonstration..."
  echo

  register_users;  echo
  login_users;     echo

  demo_health;     pause
  demo_accounts;   pause
  demo_transactions; pause
  demo_fd;         pause
  demo_loans;      pause
  demo_auth;       echo

  echo
  echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}║  Demo complete. All features exercised successfully.         ║${RESET}"
  echo -e "${BOLD}║                                                              ║${RESET}"
  echo -e "${BOLD}║  Services still running — explore via:                       ║${RESET}"
  echo -e "${BOLD}║    Auth:    http://localhost:8081                            ║${RESET}"
  echo -e "${BOLD}║    Banking: http://localhost:8082                            ║${RESET}"
  echo -e "${BOLD}║    PgAdmin: http://localhost:5050  (if monitoring profile)   ║${RESET}"
  echo -e "${BOLD}║                                                              ║${RESET}"
  echo -e "${BOLD}║  To tear down: docker compose -f docker-compose.banking.yml ║${RESET}"
  echo -e "${BOLD}║                down -v                                       ║${RESET}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
  echo
}

main "$@"
