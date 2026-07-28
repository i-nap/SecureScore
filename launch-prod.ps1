# =============================================================================
#  SecureScore Bank Suite - PRODUCTION Stack Launcher (Docker Compose)
#
#  Brings up the full containerized system in one command:
#    PostgreSQL  |  HQ (FastAPI)  |  Go BFF  |  Next.js desktop UI
#    13 Edge branches  |  Prometheus  |  Grafana  |  Jaeger  |  Loki/Promtail
#    MLflow  |  Streamlit CRO dashboard  |  Postgres exporter
#
#  Usage:
#    Set-ExecutionPolicy -Scope Process Bypass
#    .\launch-prod.ps1               full stack, all 13 branches (--profile edges)
#    .\launch-prod.ps1 -Core         lighter: only the 3 wired branches
#    .\launch-prod.ps1 -NoBrowser    don't open browser tabs
#    .\launch-prod.ps1 -Teardown     stop the stack (keeps data volumes)
#    .\launch-prod.ps1 -Teardown -Wipe   stop AND delete all data volumes
#
#  First build is slow (HQ image pulls torch/xgboost): budget 15-25 min once.
#  Subsequent starts reuse the built images and come up in ~1-2 min.
# =============================================================================

param(
    [switch]$Core,
    [switch]$NoBrowser,
    [switch]$Teardown,
    [switch]$Wipe
)

$ErrorActionPreference = "Continue"
$ROOT = $PSScriptRoot
Set-Location $ROOT

# --- Output helpers ----------------------------------------------------------
function Hdr  { param($t) Write-Host $t          -ForegroundColor Cyan }
function Ok   { param($t) Write-Host "  [+] $t"  -ForegroundColor Green }
function Info { param($t) Write-Host "  [>] $t"  -ForegroundColor Yellow }
function Err  { param($t) Write-Host "  [X] $t"  -ForegroundColor Red }
function Banner {
    param($t)
    $line = "=" * 70
    Write-Host ""; Write-Host $line -ForegroundColor Magenta
    Write-Host "  $t" -ForegroundColor White
    Write-Host $line -ForegroundColor Magenta; Write-Host ""
}

$ENV_FILE    = Join-Path $ROOT ".env"
$ENV_EXAMPLE = Join-Path $ROOT ".env.example"
# All 13 edges unless -Core. Compose runs kathmandu/pokhara/sarlahi without a
# profile; the other 10 are gated behind the "edges" profile.
$ProfileArgs = if ($Core) { @() } else { @("--profile", "edges") }

# --- Teardown ----------------------------------------------------------------
if ($Teardown) {
    Banner "SecureScore - Production Teardown"
    if ($Wipe) {
        Info "Stopping stack and deleting data volumes..."
        docker compose --profile edges down -v
    } else {
        Info "Stopping stack (data volumes preserved)..."
        docker compose --profile edges down
    }
    Ok "Stack stopped."
    exit 0
}

# --- Docker present? ---------------------------------------------------------
Banner "SecureScore Bank Suite  |  Production Stack"
Hdr "Checking Docker..."
docker version --format '{{.Server.Version}}' > $null 2>&1
if (-not $?) {
    Err "Docker is not running. Start Docker Desktop and retry."
    exit 1
}
Ok "Docker engine reachable"

# --- .env secrets ------------------------------------------------------------
Hdr "Checking .env secrets..."
if (-not (Test-Path $ENV_FILE) -and (Test-Path $ENV_EXAMPLE)) {
    Copy-Item $ENV_EXAMPLE $ENV_FILE; Info "Created .env from .env.example"
}
if (-not (Test-Path $ENV_FILE)) { New-Item -ItemType File $ENV_FILE | Out-Null }

function New-Secret { -join (1..32 | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }) }
function Ensure-EnvKey {
    param([string]$Key, [string]$Value)
    $lines = @(Get-Content $ENV_FILE -ErrorAction SilentlyContinue)
    if ($lines | Where-Object { $_ -match "^\s*$Key\s*=\s*\S" }) { Ok "$Key present"; return }
    $lines = $lines | Where-Object { $_ -notmatch "^\s*$Key\s*=" }
    $lines += "$Key=$Value"
    Set-Content -Path $ENV_FILE -Value $lines -Encoding utf8
    Info "$Key generated"
}
Ensure-EnvKey "BFF_SECRET_KEY"    (New-Secret)
Ensure-EnvKey "HQ_SECRET_KEY"     (New-Secret)
Ensure-EnvKey "HQ_BRANCH_API_KEY" (New-Secret)

# --- Build + start -----------------------------------------------------------
$scope = if ($Core) { "core (3 branches)" } else { "full (13 branches)" }
Banner "Building + starting $scope"
Info "First build pulls torch/xgboost - this can take 15-25 min. Grab a coffee."
docker compose @ProfileArgs up --build -d
if (-not $?) {
    Err "Compose failed to start. Inspect: docker compose logs"
    exit 1
}
Ok "Containers started"

# --- Wait for the user-facing services (probe 127.0.0.1, not localhost) ------
function Wait-Http {
    param([string]$Url, [int]$Timeout, [string]$Label)
    $deadline = (Get-Date).AddSeconds($Timeout)
    Write-Host -NoNewline "  [>] Waiting for $Label "
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($r.StatusCode -lt 500) { Write-Host " OK" -ForegroundColor Green; return $true }
        } catch {}
        Start-Sleep 3; Write-Host -NoNewline "."
    }
    Write-Host " not ready yet" -ForegroundColor DarkYellow
    return $false
}

Banner "Waiting for services to become healthy"
Wait-Http "http://127.0.0.1:5050/api/health" 180 "HQ Server      " | Out-Null
Wait-Http "http://127.0.0.1:4000/api/health" 120 "BFF Gateway    " | Out-Null
$uiOk = Wait-Http "http://127.0.0.1:3000"     240 "Desktop UI     "
Wait-Http "http://127.0.0.1:3001/api/health" 120 "Grafana        " | Out-Null

# --- Browser tabs (the demo wow surface) -------------------------------------
$tabs = [ordered]@{
    "Desktop UI" = "http://localhost:3000"
    "Grafana"    = "http://localhost:3001"
    "Jaeger"     = "http://localhost:16686"
    "MLflow"     = "http://localhost:5001"
}
if (-not $NoBrowser) {
    Start-Sleep 2
    foreach ($u in $tabs.Values) { Start-Process $u; Start-Sleep 1 }
    Ok "Opened demo tabs"
}

# --- Cheat sheet -------------------------------------------------------------
Banner "PRODUCTION STACK READY  |  SecureScore"
Write-Host "  +-- ENDPOINTS --------------------------------------------------------+" -ForegroundColor Magenta
Write-Host "  |  Desktop UI    http://localhost:3000   (sign in to open desktop)    |" -ForegroundColor White
Write-Host "  |  Grafana       http://localhost:3001   admin / securescore_grafana  |" -ForegroundColor White
Write-Host "  |  Jaeger trace  http://localhost:16686                               |" -ForegroundColor White
Write-Host "  |  MLflow        http://localhost:5001                                |" -ForegroundColor White
Write-Host "  |  Prometheus    http://localhost:9090                                |" -ForegroundColor White
Write-Host "  |  BFF API       http://localhost:4000/api/health   [Go]              |" -ForegroundColor White
Write-Host "  |  HQ API        http://localhost:5050/api/health                     |" -ForegroundColor White
Write-Host "  +---------------------------------------------------------------------+" -ForegroundColor Magenta
Write-Host ""
Write-Host "  +-- LOGINS -----------------------------------------------------------+" -ForegroundColor Green
Write-Host "  |  admin         / admin123      -> HQ desktop (federation, compliance)|" -ForegroundColor Green
Write-Host "  |  kathmandu_mgr / branch123     -> Branch desktop                    |" -ForegroundColor Green
Write-Host "  |  cust001       / customer123   -> Customer desktop                  |" -ForegroundColor Green
Write-Host "  +---------------------------------------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host "  Live status : docker compose ps" -ForegroundColor DarkGray
Write-Host "  Logs        : docker compose logs -f hq-server   (or bff-gateway, etc.)" -ForegroundColor DarkGray
Write-Host "  Stop        : .\launch-prod.ps1 -Teardown" -ForegroundColor DarkGray
Write-Host ""
if (-not $uiOk) {
    Info "Desktop UI not answering yet - it may still be compiling. Give it a minute,"
    Info "then refresh http://localhost:3000 . Check: docker compose logs -f frontend"
}
docker compose ps
