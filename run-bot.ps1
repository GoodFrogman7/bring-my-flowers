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

# Kill any leftover/hung bot process before we start managing a new one. Belt-and-braces
# against the watchdog looping forever while a stale-but-alive process (e.g. one that got
# stuck instead of crashing) still holds the WhatsApp session lock and port 8787.
function Stop-StaleBotProcess {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'index\.(ts|js)\s+business|dist[\\/]index\.js\s+business' } |
    ForEach-Object {
      Log-Launcher "Stopping stale flower bot process (pid $($_.ProcessId)) before restart."
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

# Make sure Ollama is up (bot works without it - local tools + cloud Q&A cover gaps).
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

$dashPort = Read-EnvPort
while ($true) {
  Stop-StaleBotProcess

  # Preserve linked-device credentials before every launch. Keep seven newest.
  if (Test-Path 'sessions\creds.json') {
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
    cmd /c "npm run dev:business >> logs\bot-console.log 2>&1"
  }
  Log-Launcher "node exit code: $LASTEXITCODE"

  Log-Launcher "Bot exited - restarting in 15s"
  Start-Sleep 15
}
