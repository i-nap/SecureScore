# =============================================================================
#  SecureScore Bank Suite - Complete System Launcher (local, no Docker)
#
#  Brings up the full working stack as local processes:
#    HQ (Python/FastAPI :5050)  |  3 Edge nodes (Python/XGBoost)
#    Go BFF Gateway (:4000)     |  Next.js desktop UI (:3000)
#
#  Banking + auth run INLINE in the Go BFF - the services/ microservices are a
#  parked future path and are intentionally NOT launched here.
#
#  Usage:
#    Set-ExecutionPolicy -Scope Process Bypass
#    .\launch.ps1                 start everything
#    .\launch.ps1 -SkipData       skip data/cert generation (faster restarts)
#    .\launch.ps1 -NoBrowser      don't open the browser
#    .\launch.ps1 -Teardown       stop everything started by a previous run
#
#  Full containerized stack (Prometheus/Grafana/13 branches) is still available:
#    docker compose -f docker-compose.yml --profile edges up --build
# =============================================================================

param(
    [switch]$SkipData,
    [switch]$NoBrowser,
    [switch]$Teardown,
    [switch]$NoWait,
    [int]$DemoRounds = 3,   # auto-run this many FedAvg rounds after startup (0 to skip)
    [switch]$NoPi           # skip the Raspberry Pi demo edge node
)

$ErrorActionPreference = "Continue"
$ROOT = $PSScriptRoot

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

# --- Paths / config ----------------------------------------------------------
$ENV_FILE     = Join-Path $ROOT ".env"
$ENV_EXAMPLE  = Join-Path $ROOT ".env.example"
$PID_FILE     = Join-Path $ROOT ".launch_pids"
$LOG_DIR      = Join-Path $ROOT "edge_logs"
# Probe over 127.0.0.1: on Win11 "localhost" resolves to IPv6 ::1 first, but the
# services bind IPv4 0.0.0.0, so Invoke-WebRequest to localhost gets refused even
# while the service is up. The browser is dual-stack, so it still opens localhost.
$FRONTEND_URL    = "http://127.0.0.1:3000"
$FRONTEND_BROWSE = "http://localhost:3000"
$BFF_URL         = "http://127.0.0.1:4000"
$HQ_URL          = "http://127.0.0.1:5050"

# branch -> local edge port. The BFF is told these via EDGE_URL_* so it never
# has to guess the hashed port.
$EDGES = [ordered]@{ kathmandu = 7050; pokhara = 7051; sarlahi = 7052 }

# Raspberry Pi demo edge --- a 4th node, run as the Pi-optimised edge so the demo
# shows a heterogeneous ARM device participating in federation alongside the
# branch servers. Uses the lalitpur dataset (urban) so it has data to train on.
$PI = [ordered]@{ branch = "lalitpur"; port = 7060 }

# --- Process tracking helpers ------------------------------------------------
function Add-Pid { param($ProcId) Add-Content -Path $PID_FILE -Value $ProcId }

function Stop-Tracked {
    if (Test-Path $PID_FILE) {
        foreach ($line in Get-Content $PID_FILE) {
            $procId = 0
            if ([int]::TryParse($line.Trim(), [ref]$procId)) {
                try { Stop-Process -Id $procId -Force -ErrorAction Stop; Ok "Stopped PID $procId" } catch {}
            }
        }
        Remove-Item $PID_FILE -ErrorAction SilentlyContinue
    }
    # Belt-and-suspenders: free the well-known ports.
    foreach ($port in @(3000, 4000, 5050, 7060) + $EDGES.Values) {
        try {
            Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
                Select-Object -ExpandProperty OwningProcess -Unique |
                ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
        } catch {}
    }
}

# --- Teardown mode -----------------------------------------------------------
if ($Teardown) {
    Banner "SecureScore - Teardown"
    Stop-Tracked
    Ok "All launched services stopped."
    exit 0
}

# --- Wait-for-HTTP -----------------------------------------------------------
function Wait-Http {
    param([string]$Url, [int]$Timeout = 120, [string]$Label = "service")
    $deadline = (Get-Date).AddSeconds($Timeout)
    Write-Host -NoNewline "  [>] Waiting for $Label "
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($r.StatusCode -lt 500) { Write-Host " OK" -ForegroundColor Green; return $true }
        } catch {}
        Start-Sleep 2; Write-Host -NoNewline "."
    }
    Write-Host " TIMEOUT" -ForegroundColor Red
    return $false
}

# --- Start a background service ----------------------------------------------
function Start-Svc {
    param([string]$File, [string[]]$ArgList, [string]$Log, [string]$WorkDir = $ROOT)
    $out = Join-Path $LOG_DIR $Log
    $p = Start-Process -FilePath $File -ArgumentList $ArgList -WorkingDirectory $WorkDir `
        -RedirectStandardOutput $out -RedirectStandardError "$out.err" `
        -PassThru -WindowStyle Hidden
    Add-Pid $p.Id
    return $p
}

# --- Auto-run a few FedAvg rounds so the demo has federation history ----------
# Each round: every edge (incl. the Pi) trains + submits its DP-noised weights,
# then HQ aggregates via FedAvg. Populates round history, model versions, and
# the convergence / leaderboard pages so the full FL story is visible on open.
function Invoke-DemoRounds {
    param([int]$Rounds)
    if ($Rounds -le 0) { return }
    Hdr "Running $Rounds FedAvg demo round(s)..."

    try {
        $body  = @{ username = "admin"; password = "admin123" } | ConvertTo-Json
        $login = Invoke-RestMethod "$BFF_URL/api/auth/login" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 15
        $hdr   = @{ Authorization = "Bearer $($login.token)" }
    } catch {
        Err "Demo rounds: admin login failed --- skipping (start them later from the HQ Federation page)"
        return
    }

    $submitUrls = @()
    foreach ($b in $EDGES.Keys) { $submitUrls += "http://127.0.0.1:$($EDGES[$b])/api/fl_submit" }
    if (-not $NoPi) { $submitUrls += "http://127.0.0.1:$($PI.port)/api/fl_submit" }

    for ($i = 1; $i -le $Rounds; $i++) {
        $submitted = 0
        foreach ($u in $submitUrls) {
            try { Invoke-RestMethod $u -Method Post -TimeoutSec 120 | Out-Null; $submitted++ } catch {}
        }
        try {
            $r = Invoke-RestMethod "$BFF_URL/api/hq/trigger_aggregation" -Method Post -Headers $hdr -TimeoutSec 60
            Ok "Round $i --- $submitted node(s) submitted, aggregated (round $($r.current_round), v$($r.active_version))"
        } catch {
            Info "Round $i --- aggregation call errored (continuing)"
        }
        Start-Sleep 2
    }
}

# =============================================================================
Banner "SecureScore Bank Suite  |  Local Launcher"

# --- Prerequisites -----------------------------------------------------------
Hdr "Checking prerequisites..."
$ok = $true
foreach ($cmd in @("python", "go", "npm")) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { Ok "$cmd found" }
    else { Err "$cmd not found - install it and retry"; $ok = $false }
}
if (-not $ok) { exit 1 }

# Clean up anything a previous run left behind (stale processes / held ports),
# so a re-launch doesn't fail on a locked exe or an occupied port.
Stop-Tracked

# Fresh PID file for this run.
Remove-Item $PID_FILE -ErrorAction SilentlyContinue
if (-not (Test-Path $LOG_DIR)) { New-Item -ItemType Directory $LOG_DIR | Out-Null }

# --- .env + dev secrets ------------------------------------------------------
Hdr "Checking .env secrets..."
if (-not (Test-Path $ENV_FILE) -and (Test-Path $ENV_EXAMPLE)) {
    Copy-Item $ENV_EXAMPLE $ENV_FILE; Info "Created .env from .env.example"
}
if (-not (Test-Path $ENV_FILE)) { New-Item -ItemType File $ENV_FILE | Out-Null }

function New-Secret { -join (1..32 | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }) }

function Ensure-EnvKey {
    param([string]$Key, [string]$Value)
    $lines = @(Get-Content $ENV_FILE -ErrorAction SilentlyContinue)
    $hit = $lines | Where-Object { $_ -match "^\s*$Key\s*=\s*\S" }
    if ($hit) { Ok "$Key present"; return }
    $lines = $lines | Where-Object { $_ -notmatch "^\s*$Key\s*=" }
    $lines += "$Key=$Value"
    Set-Content -Path $ENV_FILE -Value $lines -Encoding utf8
    Info "$Key generated"
}
Ensure-EnvKey "BFF_SECRET_KEY"     (New-Secret)
Ensure-EnvKey "HQ_SECRET_KEY"      (New-Secret)
Ensure-EnvKey "HQ_BRANCH_API_KEY"  (New-Secret)

# Load .env into this session's environment so every child process inherits it.
# The Go BFF runs with its working dir set to go_bff, so godotenv would look for
# go_bff/.env and miss the root .env --- without this it aborts on a missing secret.
foreach ($line in Get-Content $ENV_FILE -ErrorAction SilentlyContinue) {
    if ($line -match "^\s*#" -or $line -notmatch "=") { continue }
    $k, $v = $line -split "=", 2
    Set-Item "env:$($k.Trim())" $v.Trim()
}

# Tell the BFF where each local edge lives (overrides the hashed-port default).
foreach ($b in $EDGES.Keys) {
    Set-Item "env:EDGE_URL_$($b.ToUpper())" "http://127.0.0.1:$($EDGES[$b])"
}

# --- Python deps (idempotent; fast when already satisfied) --------------------
Hdr "Ensuring Python dependencies..."
python -m pip install -q -r (Join-Path $ROOT "requirements-hq.txt") -r (Join-Path $ROOT "requirements-edge.txt") 2>&1 | Out-Null
Ok "Python deps ready"

# --- Data + certs ------------------------------------------------------------
if (-not $SkipData) {
    Hdr "Generating data + certs (first run only)..."
    if (-not (Test-Path (Join-Path $ROOT "generated_data\data_branch_kathmandu.csv"))) {
        Info "Generating branch training data..."
        python (Join-Path $ROOT "generate.py") train 2>&1 | Out-Null
    }
    if (-not (Test-Path (Join-Path $ROOT "certs\ca.crt"))) {
        Info "Generating mTLS certs..."
        python (Join-Path $ROOT "generate.py") certs 2>&1 | Out-Null
    }
    Ok "Data + certs ready"
}

# =============================================================================
Banner "Starting services"

# --- HQ ----------------------------------------------------------------------
Info "Starting HQ aggregation server (:5050)..."
Start-Svc "python" @("hq_server.py", "--no-mtls", "--port", "5050", "--min-nodes", "1") "hq_server.log" | Out-Null
if (-not (Wait-Http "$HQ_URL/api/health" 90 "HQ Server")) {
    Err "HQ did not start - see edge_logs\hq_server.log.err"
}

# --- Edges -------------------------------------------------------------------
foreach ($b in $EDGES.Keys) {
    $port = $EDGES[$b]
    Info "Starting edge $b (:$port)..."
    Start-Svc "python" @("edge_api.py", "--branch", $b, "--port", "$port") "edge_$b.log" | Out-Null
}

# --- Raspberry Pi demo edge node ---------------------------------------------
# Run as a module (python -m) so `import edge_node` and `from pi_edge...` both
# resolve against the project root. Best-effort: if it fails to boot the demo
# still runs on the 3 branch edges.
if (-not $NoPi) {
    Info "Starting Raspberry Pi edge node ($($PI.branch)) (:$($PI.port))..."
    Start-Svc "python" @("-m", "pi_edge.pi_api", "--branch", $PI.branch, "--port", "$($PI.port)", "--hq-url", $HQ_URL, "--api-key", $env:HQ_BRANCH_API_KEY) "pi_edge.log" | Out-Null
}

# --- Go BFF (build, then run) ------------------------------------------------
Hdr "Building Go BFF gateway..."
$goBff = Join-Path $ROOT "go_bff"
$exe   = Join-Path $goBff "bff_gateway.exe"
$buildLog = Join-Path $LOG_DIR "go_build.log"
Remove-Item $exe -Force -ErrorAction SilentlyContinue
# Build from inside go_bff: the module (go.mod) lives there, so running from the
# project root fails with "cannot find main module".
Push-Location $goBff
& go build -o "bff_gateway.exe" . 2>&1 | Tee-Object -FilePath $buildLog | Out-Null
$buildExit = $LASTEXITCODE
Pop-Location
if ($buildExit -ne 0 -or -not (Test-Path $exe)) {
    Err "Go BFF build failed - see $buildLog"
    Stop-Tracked
    exit 1
}
Ok "Go BFF built"
Info "Starting Go BFF (:4000)..."
Start-Svc $exe @("--port", "4000") "bff_gateway.log" $goBff | Out-Null
if (-not (Wait-Http "$BFF_URL/api/health" 60 "BFF Gateway")) {
    Err "BFF did not start - see edge_logs\bff_gateway.log.err"
}

# --- Frontend ----------------------------------------------------------------
$frontend = Join-Path $ROOT "frontend"
if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Hdr "Installing frontend dependencies (first run)..."
    Push-Location $frontend; & npm install 2>&1 | Out-Null; Pop-Location
}
Info "Starting Next.js desktop UI (:3000)..."
Start-Svc "npm.cmd" @("run", "dev") "frontend.log" $frontend | Out-Null
$uiOk = Wait-Http $FRONTEND_URL 150 "Frontend UI"

# --- Seed federation history with a few live FedAvg rounds -------------------
Invoke-DemoRounds $DemoRounds

# --- Browser -----------------------------------------------------------------
if (-not $NoBrowser -and $uiOk) {
    Start-Sleep 2
    Start-Process $FRONTEND_BROWSE
    Ok "Opened $FRONTEND_BROWSE"
}

# =============================================================================
Banner "System Ready  |  SecureScore"

Write-Host "  +-- ENDPOINTS --------------------------------------------------------+" -ForegroundColor Magenta
Write-Host "  |  Desktop UI:   http://localhost:3000                                |" -ForegroundColor White
Write-Host "  |  BFF Gateway:  http://localhost:4000/api/health   [Go]              |" -ForegroundColor White
Write-Host "  |  HQ Server:    http://localhost:5050/api/health                     |" -ForegroundColor White
Write-Host "  |  Edges:        :7050 kathmandu  :7051 pokhara  :7052 sarlahi        |" -ForegroundColor White
Write-Host "  |  Pi Edge:      :7060 lalitpur  [Raspberry Pi demo node]             |" -ForegroundColor White
Write-Host "  +---------------------------------------------------------------------+" -ForegroundColor Magenta
Write-Host ""
Write-Host "  +-- LOGINS (desktop opens after sign-in) -----------------------------+" -ForegroundColor Green
Write-Host "  |  admin         / admin123      -> HQ desktop                        |" -ForegroundColor Green
Write-Host "  |  kathmandu_mgr / branch123     -> Branch desktop (Kathmandu)        |" -ForegroundColor Green
Write-Host "  |  pokhara_mgr   / branch123     -> Branch desktop (Pokhara)          |" -ForegroundColor Green
Write-Host "  |  sarlahi_mgr   / branch123     -> Branch desktop (Sarlahi)          |" -ForegroundColor Green
Write-Host "  |  cust001       / customer123   -> Customer desktop (Aarav Thapa)    |" -ForegroundColor Green
Write-Host "  +---------------------------------------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host "  Logs: edge_logs\*.log (.err for errors)" -ForegroundColor DarkGray
Write-Host "  Press Enter to recheck status   |   Type Q + Enter to quit (stops all)" -ForegroundColor DarkGray
Write-Host ""

# --- Keep-alive + status loop ------------------------------------------------
$checks = @(
    @{ url = "$HQ_URL/api/health";  label = "HQ       " },
    @{ url = "$BFF_URL/api/health"; label = "BFF      " },
    @{ url = "$FRONTEND_URL";       label = "Frontend " }
)
foreach ($b in $EDGES.Keys) {
    $checks += @{ url = "http://127.0.0.1:$($EDGES[$b])/api/health"; label = ("Edge {0,-8}" -f $b) }
}
if (-not $NoPi) {
    $checks += @{ url = "http://127.0.0.1:$($PI.port)/api/health"; label = ("Pi   {0,-8}" -f $PI.branch) }
}
if ($NoWait) {
    # Headless: services keep running detached. Stop them with -Teardown.
    Write-Host "  Services are running in the background." -ForegroundColor Cyan
    Write-Host "  Stop them with:  .\launch.ps1 -Teardown" -ForegroundColor DarkGray
    Write-Host ""
    foreach ($c in $checks) {
        try {
            Invoke-WebRequest $c.url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null
            Write-Host "    [UP] $($c.label) $($c.url)" -ForegroundColor Green
        } catch {
            Write-Host "    [--] $($c.label) $($c.url)" -ForegroundColor DarkGray
        }
    }
} else {
    try {
        while ($true) {
            $key = Read-Host
            if ($key -match '^[qQ]$') { break }
            Write-Host ""; Write-Host "  Service status:" -ForegroundColor Cyan
            foreach ($c in $checks) {
                try {
                    Invoke-WebRequest $c.url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null
                    Write-Host "    [UP] $($c.label) $($c.url)" -ForegroundColor Green
                } catch {
                    Write-Host "    [--] $($c.label) $($c.url)" -ForegroundColor DarkGray
                }
            }
            Write-Host ""
        }
    } finally {
        Banner "Stopping all services..."
        Stop-Tracked
        Ok "All services stopped. Goodbye!"
    }
}

