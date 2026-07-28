# =============================================================================
# SecureScore Core Banking -- Demo Script (PowerShell / Windows)
# =============================================================================
# Starts the full banking stack, seeds data, and walks through every feature.
#
# Prerequisites:
#   Docker Desktop running (Linux containers), OpenSSL in PATH (Git for Windows)
#
# Usage:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\demo.ps1
#
# Reset everything:
#   docker compose -f docker-compose.banking.yml down -v
# =============================================================================

$ErrorActionPreference = "Stop"

$COMPOSE_FILE = "docker-compose.banking.yml"
$AUTH_URL     = "http://localhost"
$BANK_URL     = "http://localhost"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Log  { param($msg) Write-Host "[DEMO] $msg" -ForegroundColor Cyan }
function Ok   { param($msg) Write-Host "  + $msg"    -ForegroundColor Green }
function Info { param($msg) Write-Host "  > $msg"    -ForegroundColor Yellow }
function Warn { param($msg) Write-Host "  ! $msg"    -ForegroundColor Magenta }
function Fail { param($msg) Write-Host "  X $msg"    -ForegroundColor Red; exit 1 }

function Pause-Demo {
    Write-Host ""
    Read-Host "  Press ENTER to continue"
    Write-Host ""
}

function Invoke-Api {
    param(
        [string]$Method = "GET",
        [string]$Url,
        [hashtable]$Body = $null,
        [string]$Token = "",
        [string]$IdempKey = ""
    )
    $headers = @{ "Content-Type" = "application/json" }
    if ($Token)    { $headers["Authorization"]   = "Bearer $Token" }
    if ($IdempKey) { $headers["Idempotency-Key"] = $IdempKey }

    $params = @{ Method = $Method; Uri = $Url; Headers = $headers; ErrorAction = "Stop" }
    if ($Body) { $params["Body"] = ($Body | ConvertTo-Json -Depth 10 -Compress) }

    try {
        return Invoke-RestMethod @params
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        $msg  = $_.ErrorDetails.Message
        return [PSCustomObject]@{ _error = $true; _status = $code; _body = $msg }
    }
}

function Check-Error {
    param($r, $label)
    if ($r -is [hashtable] -and $r._error) {
        Warn "$label failed (HTTP $($r._status)): $($r._body)"
        return $true
    }
    if ($r -is [PSCustomObject] -and $r._error) {
        Warn "$label failed (HTTP $($r._status)): $($r._body)"
        return $true
    }
    return $false
}

# ---------------------------------------------------------------------------
# 0. Generate RSA-2048 keys and secret files
# ---------------------------------------------------------------------------

function Step-GenerateKeys {
    Log "Generating RSA-2048 key pair for JWT RS256..."
    if (-not (Test-Path "secrets")) {
        New-Item -ItemType Directory "secrets" | Out-Null
    }
    if (-not (Test-Path "secrets\jwt_private.pem")) {
        & openssl genrsa -out secrets\jwt_private.pem 2048 2>$null
        & openssl rsa -in secrets\jwt_private.pem -pubout -out secrets\jwt_public.pem 2>$null
        "demo_auth_pass"    | Out-File -Encoding utf8NoBOM "secrets\pg_auth_password.txt"
        "demo_banking_pass" | Out-File -Encoding utf8NoBOM "secrets\pg_banking_password.txt"
        Ok "RSA keys and DB secrets created in .\secrets\"
    } else {
        Info "Keys already present, skipping generation"
    }
}

# ---------------------------------------------------------------------------
# 1. Start the full stack
# ---------------------------------------------------------------------------

function Step-StartServices {
    Log "Starting banking stack (first run pulls/builds images -- ~3 min)..."
    docker compose -f $COMPOSE_FILE up --build -d

    Log "Waiting for auth service at $AUTH_URL ..."
    $n = 0
    while ($true) {
        try { Invoke-RestMethod "$AUTH_URL/auth/health" | Out-Null; break } catch {}
        $n++
        if ($n -gt 60) { Fail "Auth service did not become healthy in time" }
        Start-Sleep 3
        Write-Host -NoNewline "."
    }
    Write-Host ""; Ok "Auth service healthy"

    Log "Waiting for banking service at $BANK_URL ..."
    $n = 0
    while ($true) {
        try { Invoke-RestMethod "$BANK_URL/health" | Out-Null; break } catch {}
        $n++
        if ($n -gt 60) { Fail "Banking service did not become healthy in time" }
        Start-Sleep 3
        Write-Host -NoNewline "."
    }
    Write-Host ""; Ok "Banking service healthy"
}

# ---------------------------------------------------------------------------
# 2. Bootstrap admin user (POST /auth/setup -- no auth required, one-time)
# ---------------------------------------------------------------------------

function Step-BootstrapAdmin {
    Log "=== STEP 2: Bootstrap admin user ==="
    $r = Invoke-Api -Method POST -Url "$AUTH_URL/auth/setup" -Body @{
        username    = "admin"
        email       = "admin@securescore.local"
        password    = "Admin@Secure123!"
        role        = "admin"
        branch_code = "KTM01"
    }
    if ($r._error -and $r._status -eq 403) {
        Info "Admin already exists (bootstrap sealed) -- continuing"
    } elseif (-not (Check-Error $r "Bootstrap")) {
        Ok "Admin created: $($r.id)"
    }
}

# ---------------------------------------------------------------------------
# 3. Login as admin and register remaining users
# ---------------------------------------------------------------------------

function Step-RegisterUsers {
    Log "=== STEP 3: Login admin and register demo users ==="

    $login = Invoke-Api -Method POST -Url "$AUTH_URL/auth/login" -Body @{
        username = "admin"; password = "Admin@Secure123!"
    }
    if (Check-Error $login "Admin login") { return }
    $script:ADMIN_TOKEN = $login.access_token
    Ok "Admin logged in"

    $users = @(
        @{ username="customer1"; email="c1@bank.local"; password="Customer@Secure123!"; role="customer";       branch_code="KTM01" },
        @{ username="teller1";   email="t1@bank.local"; password="Teller@Secure123!";   role="teller";         branch_code="KTM01" },
        @{ username="manager1";  email="m1@bank.local"; password="Manager@Secure123!";  role="branch_manager"; branch_code="KTM01" },
        @{ username="officer1";  email="o1@bank.local"; password="Officer@Secure123!";  role="credit_officer"; branch_code="KTM01" }
    )
    foreach ($u in $users) {
        Start-Sleep 1
        $r = Invoke-Api -Method POST -Url "$AUTH_URL/auth/register" -Body $u -Token $script:ADMIN_TOKEN
        if ($r._error -and $r._status -eq 409) {
            Info "$($u.username) already exists, skipping"
        } elseif (-not (Check-Error $r "Register $($u.username)")) {
            Ok "Registered: $($r.username) ($($r.role))"
        }
    }
}

# ---------------------------------------------------------------------------
# 4. Login all roles
# ---------------------------------------------------------------------------

function Step-LoginAll {
    Log "=== STEP 4: Login all users ==="
    $creds = @(
        @("admin",     "Admin@Secure123!",    "ADMIN"),
        @("customer1", "Customer@Secure123!", "CUSTOMER"),
        @("teller1",   "Teller@Secure123!",   "TELLER"),
        @("manager1",  "Manager@Secure123!",  "MANAGER"),
        @("officer1",  "Officer@Secure123!",  "OFFICER")
    )
    foreach ($c in $creds) {
        Start-Sleep 1
        $r = Invoke-Api -Method POST -Url "$AUTH_URL/auth/login" -Body @{
            username = $c[0]; password = $c[1]
        }
        if (Check-Error $r "Login $($c[0])") { continue }
        Set-Variable -Name "script:$($c[2])_TOKEN" -Value $r.access_token
        Ok "$($c[0]) logged in (expires $($r.expires_at))"
    }
}

# ---------------------------------------------------------------------------
# 5. Seed branch + products directly in Postgres (no admin HTTP endpoint yet)
# ---------------------------------------------------------------------------

function Step-SeedData {
    Log "=== STEP 5: Seed branch and account products ==="
    $sql = @"
INSERT INTO branches (branch_code, name)
VALUES ('KTM01','Kathmandu Branch') ON CONFLICT (branch_code) DO NOTHING;

INSERT INTO account_products (id, product_code, product_name, account_type, interest_rate, minimum_balance)
VALUES ('00000000-0000-0000-0000-000000000001','SAV001','Standard Savings','savings',8.0,1000)
ON CONFLICT (product_code) DO NOTHING;

INSERT INTO account_products (id, product_code, product_name, account_type, interest_rate, minimum_balance)
VALUES ('00000000-0000-0000-0000-000000000002','CUR001','Standard Current','current',0.0,0)
ON CONFLICT (product_code) DO NOTHING;
"@
    docker exec banking-postgres-banking psql -U banking_svc -d securescore_banking -c $sql 2>&1 | Out-Null
    Ok "Branch KTM01 and 2 account products seeded"

    # Retrieve customer UUID from auth DB for use in account creation
    $raw = docker exec banking-postgres-auth psql -U auth_svc -d securescore_auth -t -c "SELECT id FROM users WHERE username='customer1';"
    $script:CUSTOMER_ID = [string](($raw | Where-Object { $_ -match '[0-9a-f-]{36}' } | Select-Object -First 1) -replace '\s','')
    Ok "Customer UUID: $($script:CUSTOMER_ID)"
}

# ---------------------------------------------------------------------------
# 6. Account operations
# ---------------------------------------------------------------------------

function Step-Accounts {
    Log "=== STEP 6: Account operations ==="

    Info "Creating savings account..."
    $s = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/accounts" `
        -Token $script:CUSTOMER_TOKEN -IdempKey "ps-sav-1" `
        -Body @{
            idempotency_key = "ps-sav-1"
            customer_id     = $script:CUSTOMER_ID
            product_id      = "00000000-0000-0000-0000-000000000001"
            account_type    = "savings"
            currency        = "NPR"
            branch_code     = "KTM01"
        }
    if (-not (Check-Error $s "Create savings")) {
        $script:SAVINGS_ID = $s.ID
        Ok "Savings account: $($s.AccountNumber) (ID: $($s.ID))"
    }

    Info "Creating current account..."
    $c = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/accounts" `
        -Token $script:CUSTOMER_TOKEN -IdempKey "ps-cur-1" `
        -Body @{
            idempotency_key = "ps-cur-1"
            customer_id     = $script:CUSTOMER_ID
            product_id      = "00000000-0000-0000-0000-000000000002"
            account_type    = "current"
            currency        = "NPR"
            branch_code     = "KTM01"
        }
    if (-not (Check-Error $c "Create current")) {
        $script:CURRENT_ID = $c.ID
        Ok "Current account: $($c.AccountNumber) (ID: $($c.ID))"
    }

    Info "Idempotency test -- same key should return same account..."
    $s2 = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/accounts" `
        -Token $script:CUSTOMER_TOKEN -IdempKey "ps-sav-1" `
        -Body @{
            idempotency_key = "ps-sav-1"
            customer_id     = $script:CUSTOMER_ID
            product_id      = "00000000-0000-0000-0000-000000000001"
            account_type    = "savings"
            currency        = "NPR"
            branch_code     = "KTM01"
        }
    if ($s2.ID -eq $script:SAVINGS_ID) {
        Ok "Idempotency confirmed -- same account returned"
    } else {
        Warn "Idempotency mismatch: $($s2.ID) vs $($script:SAVINGS_ID)"
    }
}

# ---------------------------------------------------------------------------
# 7. Transactions
# ---------------------------------------------------------------------------

function Step-Transactions {
    Log "=== STEP 7: Transactions ==="

    Info "Crediting NPR 500,000 to savings (admin)..."
    $c1 = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/transactions/credit" `
        -Token $script:ADMIN_TOKEN -IdempKey "ps-credit-sav-1" `
        -Body @{ idempotency_key="ps-credit-sav-1"; account_id=$script:SAVINGS_ID; amount="500000"; type="credit"; description="Initial deposit" }
    if (-not (Check-Error $c1 "Credit savings")) { Ok "Savings credited -- status: $($c1.Status)" }

    Info "Crediting NPR 100,000 to current (admin)..."
    $c2 = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/transactions/credit" `
        -Token $script:ADMIN_TOKEN -IdempKey "ps-credit-cur-1" `
        -Body @{ idempotency_key="ps-credit-cur-1"; account_id=$script:CURRENT_ID; amount="100000"; type="credit"; description="Initial deposit" }
    if (-not (Check-Error $c2 "Credit current")) { Ok "Current credited -- status: $($c2.Status)" }

    Info "Internal transfer: savings -> current (NPR 50,000)..."
    $tf = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/transactions/transfer" `
        -Token $script:CUSTOMER_TOKEN -IdempKey "ps-transfer-1" `
        -Body @{ idempotency_key="ps-transfer-1"; source_account_id=$script:SAVINGS_ID; dest_account_id=$script:CURRENT_ID; amount="50000"; description="Self transfer" }
    if (-not (Check-Error $tf "Transfer")) {
        $script:TXN_ID = $tf.TransactionID
        Ok "Transfer completed -- txn: $($script:TXN_ID)"
    }

    Info "NEFT outward transfer (mocked)..."
    $neft = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/transactions/neft" `
        -Token $script:TELLER_TOKEN -IdempKey "ps-neft-1" `
        -Body @{
            idempotency_key    = "ps-neft-1"
            source_account_id  = $script:CURRENT_ID
            beneficiary_name   = "Ram Bahadur"
            beneficiary_ifsc   = "NABIL0001234"
            beneficiary_account = "1234567890"
            beneficiary_bank   = "Nabil Bank"
            amount             = "5000"
            remarks            = "School fees"
        }
    if (-not (Check-Error $neft "NEFT")) { Ok "NEFT: $($neft.note)" }

    Info "Reversing the transfer (admin)..."
    $rev = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/transactions/$($script:TXN_ID)/reverse" `
        -Token $script:ADMIN_TOKEN -IdempKey "ps-rev-1" `
        -Body @{ reason = "Demo reversal test" }
    if (-not (Check-Error $rev "Reversal")) { Ok "Reversal -- status: $($rev.Status)" }
}

# ---------------------------------------------------------------------------
# 8. Fixed Deposits
# ---------------------------------------------------------------------------

function Step-FD {
    Log "=== STEP 8: Fixed Deposits ==="

    Info "Opening 1-year simple-interest FD (NPR 200,000)..."
    $fd = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/fd" `
        -Token $script:CUSTOMER_TOKEN -IdempKey "ps-fd-1" `
        -Body @{
            idempotency_key   = "ps-fd-1"
            linked_account_id = $script:SAVINGS_ID
            principal         = "200000"
            tenure_days       = 365
            interest_type     = "simple"
            on_maturity_action = "credit"
            branch_code       = "KTM01"
        }
    if (-not (Check-Error $fd "FD simple")) {
        $script:FD_ID = $fd.ID
        Ok "FD opened: $($fd.FDNumber) | matures $($fd.MaturityDate) | NPR $($fd.MaturityAmount)"
    }

    Info "Opening 6-month compound-interest FD with auto-renew (NPR 100,000)..."
    $fd2 = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/fd" `
        -Token $script:CUSTOMER_TOKEN -IdempKey "ps-fd-2" `
        -Body @{
            idempotency_key    = "ps-fd-2"
            linked_account_id  = $script:SAVINGS_ID
            principal          = "100000"
            tenure_days        = 180
            interest_type      = "compound"
            compound_frequency = "quarterly"
            on_maturity_action = "renew"
            branch_code        = "KTM01"
        }
    if (-not (Check-Error $fd2 "FD compound")) {
        $script:FD2_ID = $fd2.ID
        Ok "FD2 opened: $($fd2.FDNumber) with auto-renew on maturity"
    }

    Info "Premature withdrawal of FD2 (penalty applied)..."
    $pw = Invoke-Api -Method PUT -Url "$BANK_URL/api/banking/fd/$($script:FD2_ID)/withdraw" `
        -Token $script:CUSTOMER_TOKEN -IdempKey "ps-fd-withdraw-2"
    if (-not (Check-Error $pw "Premature withdraw")) {
        Ok "Premature withdrawal -- status: $($pw.Status), penalty rate: $($pw.PrematurePenaltyRate)%"
    }
}

# ---------------------------------------------------------------------------
# 9. Loans -- full state machine
# ---------------------------------------------------------------------------

function Step-Loans {
    Log "=== STEP 9: Loan -- full state machine ==="

    Info "Applying for personal loan NPR 300,000 / 24 months..."
    $loan = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/loans" `
        -Token $script:CUSTOMER_TOKEN -IdempKey "ps-loan-1" `
        -Body @{
            idempotency_key  = "ps-loan-1"
            linked_account_id = $script:SAVINGS_ID
            loan_type        = "personal"
            amount           = "300000"
            tenure_months    = 24
            purpose          = "Home renovation"
            branch_code      = "KTM01"
        }
    if (Check-Error $loan "Loan apply") { return }
    $script:LOAN_ID = $loan.ID
    Ok "Applied: $($loan.LoanNumber) -- status: $($loan.Status)"

    Start-Sleep 1
    Info "Credit officer: send to under_review..."
    $rv = Invoke-Api -Method PUT -Url "$BANK_URL/api/banking/loans/$($script:LOAN_ID)/review" `
        -Token $script:OFFICER_TOKEN -IdempKey "ps-review-$($script:LOAN_ID)"
    if (-not (Check-Error $rv "Review")) { Ok "Status: $($rv.Status)" }

    Start-Sleep 1
    Info "Branch manager: approve at 12% interest..."
    $ap = Invoke-Api -Method PUT -Url "$BANK_URL/api/banking/loans/$($script:LOAN_ID)/approve" `
        -Token $script:MANAGER_TOKEN -IdempKey "ps-approve-$($script:LOAN_ID)" `
        -Body @{ interest_rate = "12" }
    if (-not (Check-Error $ap "Approve")) { Ok "Status: $($ap.Status)" }

    Start-Sleep 1
    Info "Branch manager: disburse to savings account..."
    $disb = Invoke-Api -Method PUT -Url "$BANK_URL/api/banking/loans/$($script:LOAN_ID)/disburse" `
        -Token $script:MANAGER_TOKEN -IdempKey "ps-disburse-$($script:LOAN_ID)"
    if (Check-Error $disb "Disburse") { return }
    $script:LOAN_EMI = $disb.EMIAmount
    Ok "Disbursed -- status: $($disb.Status) | EMI: NPR $($script:LOAN_EMI)"

    Info "Fetching 24-installment repayment schedule..."
    $sched = Invoke-Api -Url "$BANK_URL/api/banking/loans/$($script:LOAN_ID)/schedule" `
        -Token $script:CUSTOMER_TOKEN
    if (-not (Check-Error $sched "Schedule")) {
        $first3 = $sched.schedule | Select-Object -First 3
        $first3 | Format-Table @{L="Inst#";E={$_.InstallmentNumber}}, @{L="Due";E={($_.DueDate -split 'T')[0]}}, @{L="EMI";E={$_.EMIAmount}}, @{L="Principal";E={$_.PrincipalComponent}}, @{L="Interest";E={$_.InterestComponent}}
        Ok "Full 24-installment schedule stored in DB"
    }

    Start-Sleep 1
    Info "Teller: process first EMI repayment (NPR $($script:LOAN_EMI))..."
    $ikey = "ps-repay1-$($script:LOAN_ID)"
    $rep = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/loans/$($script:LOAN_ID)/repayment" `
        -Token $script:TELLER_TOKEN -IdempKey $ikey `
        -Body @{ amount = $script:LOAN_EMI; idempotency_key = $ikey }
    if (-not (Check-Error $rep "Repayment")) {
        Ok "Installment $($rep.InstallmentNumber) -- status: $($rep.Status) | paid: NPR $($rep.AmountPaid)"
    }

    Info "Manager: attempt close with outstanding balance (expect HTTP 400)..."
    $cl = Invoke-Api -Method POST -Url "$BANK_URL/api/banking/loans/$($script:LOAN_ID)/close" `
        -Token $script:MANAGER_TOKEN -IdempKey "ps-close-$($script:LOAN_ID)"
    if ($cl._status -eq 400) {
        Ok "Correctly rejected -- outstanding balance exists (HTTP 400)"
    } elseif (-not $cl._error) {
        Warn "Unexpected success on close"
    }
}

# ---------------------------------------------------------------------------
# 10. Auth -- JWT rotation + revocation
# ---------------------------------------------------------------------------

function Step-Auth {
    Log "=== STEP 10: Auth -- JWT RS256 + refresh rotation ==="

    Info "Customer logs in..."
    $l = Invoke-Api -Method POST -Url "$AUTH_URL/auth/login" -Body @{
        username = "customer1"; password = "Customer@Secure123!"
    }
    if (Check-Error $l "Login for refresh test") { return }
    $acc1 = $l.access_token
    $ref1 = $l.refresh_token
    Ok "RS256 access token issued (TTL: $($l.expires_at))"

    Start-Sleep 1
    Info "Rotate refresh token..."
    $r2 = Invoke-Api -Method POST -Url "$AUTH_URL/auth/refresh" -Body @{ refresh_token = $ref1 }
    if (Check-Error $r2 "Refresh") { return }
    $newAcc = $r2.access_token
    $newRef = $r2.refresh_token
    Ok "New token pair issued"

    Start-Sleep 1
    Info "Replay old refresh token (theft detection) -- expect HTTP 401..."
    $replay = Invoke-Api -Method POST -Url "$AUTH_URL/auth/refresh" -Body @{ refresh_token = $ref1 }
    if ($replay._status -eq 401) {
        Ok "Replay rejected -- token family revoked (HTTP 401)"
    } elseif ($replay._error) {
        Warn "Unexpected error on replay: $($replay._status)"
    } else {
        Warn "Unexpected success on replay -- theft detection may not have fired"
    }

    Start-Sleep 1
    Info "Logout (revokes JTI in Redis)..."
    $lo = Invoke-Api -Method POST -Url "$AUTH_URL/auth/logout" `
        -Token $newAcc -Body @{ refresh_token = $newRef }
    if (-not (Check-Error $lo "Logout")) { Ok "Logged out" }

    Start-Sleep 1
    Info "Use revoked token after logout -- expect HTTP 401..."
    $rvk = Invoke-Api -Url "$BANK_URL/api/banking/accounts/$($script:SAVINGS_ID)" -Token $newAcc
    if ($rvk._status -eq 401) {
        Ok "Revoked token rejected (HTTP 401)"
    } else {
        Warn "Token accepted after logout (may have expired naturally)"
    }
}

# ---------------------------------------------------------------------------
# 11. Print final DB state
# ---------------------------------------------------------------------------

function Step-Summary {
    Log "=== STEP 11: Final system state ==="

    Write-Host ""
    Write-Host "-- Accounts --" -ForegroundColor Cyan
    docker exec banking-postgres-banking psql -U banking_svc -d securescore_banking `
        -c "SELECT account_number, account_type, ROUND(balance,2) AS balance, status FROM accounts ORDER BY created_at;"

    Write-Host ""
    Write-Host "-- Loans --" -ForegroundColor Cyan
    docker exec banking-postgres-banking psql -U banking_svc -d securescore_banking `
        -c "SELECT loan_number, loan_type, status, ROUND(outstanding_principal,2) AS outstanding, ROUND(emi_amount,2) AS emi FROM loans ORDER BY created_at;"

    Write-Host ""
    Write-Host "-- Fixed Deposits --" -ForegroundColor Cyan
    docker exec banking-postgres-banking psql -U banking_svc -d securescore_banking `
        -c "SELECT fd_number, status, ROUND(principal,2) AS principal, ROUND(maturity_amount,2) AS maturity, maturity_date::date FROM fixed_deposits ORDER BY created_at;"

    Write-Host ""
    Write-Host "-- Recent Transactions --" -ForegroundColor Cyan
    docker exec banking-postgres-banking psql -U banking_svc -d securescore_banking `
        -c "SELECT reference_number, type, ROUND(amount,2) AS amount, status FROM transactions ORDER BY created_at DESC LIMIT 8;"
}

# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  SecureScore Core Banking System -- Live Demo (Windows)    " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Step-GenerateKeys;  Write-Host ""
Step-StartServices; Write-Host ""
Step-BootstrapAdmin
Step-RegisterUsers; Write-Host ""
Step-LoginAll;      Write-Host ""
Step-SeedData;      Pause-Demo

Step-Accounts;      Pause-Demo
Step-Transactions;  Pause-Demo
Step-FD;            Pause-Demo
Step-Loans;         Pause-Demo
Step-Auth;          Write-Host ""
Step-Summary

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Demo complete. All features exercised.                    " -ForegroundColor Green
Write-Host "                                                            " -ForegroundColor Green
Write-Host "  Auth service:    http://localhost:8081                    " -ForegroundColor Green
Write-Host "  Banking service: http://localhost:8082                    " -ForegroundColor Green
Write-Host "  Via Nginx:       http://localhost                         " -ForegroundColor Green
Write-Host "                                                            " -ForegroundColor Green
Write-Host "  To tear down:                                             " -ForegroundColor Green
Write-Host "  docker compose -f docker-compose.banking.yml down -v     " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
