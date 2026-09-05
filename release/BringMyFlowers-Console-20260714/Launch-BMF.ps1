# Opens the Bring My Flowers owner dashboard in a Chrome/Edge app window.
# Ensures the background bot is running first (via the BringMyFlowersBot task).
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$TaskName = 'BringMyFlowersBot'
$MaxWaitSec = 90

function Read-EnvValue([string]$Key, [string]$Default) {
  if (-not (Test-Path (Join-Path $Root '.env'))) { return $Default }
  foreach ($line in Get-Content (Join-Path $Root '.env')) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.+)$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $Default
}

function Show-Error([string]$Message) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($Message, 'Bring My Flowers', 'OK', 'Warning') | Out-Null
}

function Find-BrowserApp {
  $candidates = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($path in $candidates) {
    if (Test-Path $path) { return $path }
  }
  return $null
}

$port = Read-EnvValue 'DASHBOARD_PORT' '8787'
if ($port -eq '0') {
  Show-Error "DASHBOARD_PORT=0 — the dashboard is disabled in .env.`n`nSet DASHBOARD_PORT=8787 and restart the bot."
  exit 1
}
$DashboardUrl = "http://127.0.0.1:$port"
$OverviewUrl = "$DashboardUrl/api/overview"
$linked = Test-Path (Join-Path $Root 'sessions\creds.json')
$openPath = if ($linked) { $DashboardUrl } else { "$DashboardUrl/link" }

# Start the scheduled task if registered; otherwise start run-bot.ps1 in background.
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
} else {
  $botRunning = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'index\.(ts|js)\s+business|dist[\\/]index\.js\s+business' }
  if (-not $botRunning) {
    Start-Process powershell -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-File', (Join-Path $Root 'run-bot.ps1') -WorkingDirectory $Root
  }
}

$ready = $false
for ($i = 0; $i -lt $MaxWaitSec; $i++) {
  try {
    Invoke-RestMethod -Uri $OverviewUrl -TimeoutSec 2 | Out-Null
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $ready) {
  Show-Error "The bot is still starting.`n`nWait a minute and try again.`n`nIf this keeps happening, open logs\launcher.log"
  exit 1
}

$browser = Find-BrowserApp
if (-not $browser) {
  Show-Error "Chrome or Edge is required to open the dashboard.`n`nInstall Google Chrome, then try again."
  exit 1
}

Start-Process -FilePath $browser -ArgumentList "--app=$openPath"
