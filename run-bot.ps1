# Keeps the flower bot alive: starts Ollama if needed, restarts the bot if it
# ever exits (crash, lost connection past max reconnects, etc.).
# Runs headless as the "BringMyFlowersBot" scheduled task; launcher events go
# to logs\launcher.log. To stop it: Stop-ScheduledTask BringMyFlowersBot.
$ErrorActionPreference = 'Continue'
Set-Location C:\bring_my_flowers
New-Item -ItemType Directory -Force -Path 'logs', 'backups\whatsapp-session' | Out-Null

function Log-Launcher($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path 'logs\launcher.log' -Value $line
}

# Single-instance guard: bail if another copy of the bot is already running.
$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'src[\\/]index\.ts' }
if ($existing) {
  Log-Launcher "Flower bot already running (pid $($existing.ProcessId)) - not starting a second copy."
  Start-Sleep 10
  exit
}

# Make sure Ollama is up (bot works without it, but falls back to dumb keyword matching).
try {
  Invoke-RestMethod http://localhost:11434/api/tags -TimeoutSec 3 | Out-Null
  Write-Host "Ollama is already running."
} catch {
  Write-Host "Starting Ollama..."
  Start-Process "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" -ArgumentList 'serve' -WindowStyle Hidden
  foreach ($i in 1..15) {
    Start-Sleep 2
    try { Invoke-RestMethod http://localhost:11434/api/tags -TimeoutSec 2 | Out-Null; Write-Host "Ollama is up."; break } catch {}
  }
}

while ($true) {
  # Preserve the linked-device credentials before every launch. Keep the seven
  # newest snapshots so a corrupt or accidentally deleted session can be
  # restored without asking the account owner to scan another QR.
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
  npm run dev:business
  Log-Launcher "Bot exited - restarting in 15s"
  Start-Sleep 15
}
