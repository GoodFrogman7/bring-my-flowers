# Keeps the flower bot alive: starts Ollama if needed, restarts the bot if it
# ever exits (crash, lost connection past max reconnects, etc.).
# Close the window (or Ctrl+C) to stop it.
$ErrorActionPreference = 'Continue'
Set-Location C:\bring_my_flowers

# Single-instance guard: bail if another copy of the bot is already running.
$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'src[\\/]index\.ts' }
if ($existing) {
  Write-Host "Flower bot already running (pid $($existing.ProcessId)) - not starting a second copy."
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
  Write-Host ""
  Write-Host ("===== Starting flower bot at {0} =====" -f (Get-Date))
  npm run dev:business
  Write-Host ("Bot exited at {0} - restarting in 15s (close this window to stop for good)" -f (Get-Date))
  Start-Sleep 15
}
