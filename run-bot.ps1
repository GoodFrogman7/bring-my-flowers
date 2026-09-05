# Keeps the flower bot alive: starts Ollama if needed, restarts the bot if it
# ever exits (crash, lost connection past max reconnects, etc.).
# Runs headless as the "BringMyFlowersBot" scheduled task; launcher events go
# to logs\launcher.log. To stop it: Stop-ScheduledTask BringMyFlowersBot.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
New-Item -ItemType Directory -Force -Path 'logs', 'backups\whatsapp-session', 'data', 'dist' | Out-Null

function Log-Launcher($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path 'logs\launcher.log' -Value $line
}

function Read-EnvPort {
  $port = '8787'
  if (Test-Path '.env') {
    foreach ($line in Get-Content '.env') {
      if ($line -match '^\s*DASHBOARD_PORT\s*=\s*(\d+)') { $port = $Matches[1] }
    }
  }
  return $port
}

function Read-EnvFlag([string]$Key, [bool]$Default) {
  if (-not (Test-Path '.env')) { return $Default }
  foreach ($line in Get-Content '.env') {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.+)$") {
      return $Matches[1].Trim().ToLower() -in @('1', 'true', 'yes')
    }
  }
  return $Default
}

function Read-EnvValue([string]$Key, [string]$Default) {
  if (-not (Test-Path '.env')) { return $Default }
  foreach ($line in Get-Content '.env') {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.+)$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $Default
}

$businessTransport = Read-EnvValue 'BUSINESS_TRANSPORT' 'dashboard'
$whatsappEnabled = $businessTransport -notin @('dashboard', 'manual')

# Single-instance guard. Use the dashboard and the app's own lock file instead
# of enumerating every process command line (which can be denied by Windows).
$dashPort = Read-EnvPort
$existing = $false
if ($dashPort -ne '0') {
  try {
    Invoke-RestMethod "http://127.0.0.1:$dashPort/api/health" -TimeoutSec 2 | Out-Null
    $existing = $true
  } catch {}
}
if (-not $existing -and (Test-Path 'data\business.lock')) {
  try {
    $lock = Get-Content 'data\business.lock' -Raw | ConvertFrom-Json
    Get-Process -Id ([int]$lock.pid) -ErrorAction Stop | Out-Null
    $existing = $true
  } catch {}
}
if ($existing) {
  Log-Launcher "Flower bot already running - not starting a second copy."
  Start-Sleep 10
  exit 0
}

# Ollama is optional in business mode. Deterministic rules and local database
# tools are the default so the owner does not need a second 4 GB service.
if (Read-EnvFlag 'BUSINESS_USE_OLLAMA' $false) {
  try {
    Invoke-RestMethod http://localhost:11434/api/tags -TimeoutSec 3 | Out-Null
    Write-Host "Ollama is already running."
  } catch {
    Write-Host "Starting Ollama..."
    $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    if (Test-Path $ollama) {
      Start-Process $ollama -ArgumentList 'serve' -WindowStyle Hidden
      foreach ($i in 1..15) {
        Start-Sleep 2
        try { Invoke-RestMethod http://localhost:11434/api/tags -TimeoutSec 2 | Out-Null; Write-Host "Ollama is up."; break } catch {}
      }
    }
  }
} else {
  Write-Host "Ollama disabled for business mode; using deterministic rules and read-only tools."
}

while ($true) {
  # Preserve linked-device credentials before every launch. Keep seven newest.
  if ($whatsappEnabled -and (Test-Path 'sessions\creds.json')) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $snapshot = "backups\whatsapp-session\$stamp"
    Copy-Item 'sessions' $snapshot -Recurse -Force
    Get-ChildItem 'backups\whatsapp-session' -Directory |
      Sort-Object LastWriteTime -Descending |
      Select-Object -Skip 7 |
      Remove-Item -Recurse -Force
    Log-Launcher "WhatsApp session backed up to $snapshot"
  }

  Log-Launcher "===== Starting flower bot ====="
  Log-Launcher "Owner dashboard: http://localhost:$dashPort (use Launch-BMF.bat to open)"

  # Prefer compiled production entry; fall back to ts-node for developers.
  # Console output (incl. crash stack traces) goes to logs\bot-console.log.
  if (Test-Path 'dist\index.js') {
    $env:BOT_MODE = 'business'
    cmd /c "node dist\index.js business >> logs\bot-console.log 2>&1"
  } else {
    Log-Launcher "dist/ missing - running ts-node (run npm run build for production)"
    cmd /c "npm.cmd run dev:business >> logs\bot-console.log 2>&1"
  }
  Log-Launcher "node exit code: $LASTEXITCODE"

  Log-Launcher "Bot exited - restarting in 15s"
  Start-Sleep 15
}
