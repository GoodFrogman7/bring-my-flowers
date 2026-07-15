# One-time setup: install the Bring My Flowers owner console on this Windows PC.
# Registers a logon scheduled task (bot runs 24/7), builds the project, and
# creates desktop + Start Menu shortcuts to open the dashboard app window.
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$TaskName = 'BringMyFlowersBot'
Set-Location $ProjectRoot

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Host "Missing: $Name" -ForegroundColor Red
    Write-Host $InstallHint
    exit 1
  }
}

function Write-ConsoleStatus([hashtable]$Data) {
  $dir = Join-Path $ProjectRoot 'data'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $payload = $Data + @{ updatedAt = (Get-Date).ToString('o'); projectRoot = $ProjectRoot }
  ($payload | ConvertTo-Json -Depth 4) | Set-Content -Path (Join-Path $dir 'console-status.json') -Encoding UTF8
}

Write-Step "Checking prerequisites"
Require-Command 'node' "Install Node.js 18+ from https://nodejs.org/ then re-run Setup.bat."
Require-Command 'npm' "npm should ship with Node.js — reinstall Node if missing."

$nodeMajor = [int](node -v).TrimStart('v').Split('.')[0]
if ($nodeMajor -lt 18) {
  Write-Host "Node.js 18+ required (found $(node -v))." -ForegroundColor Red
  exit 1
}
Write-Host "Node $(node -v) OK"

try {
  Invoke-RestMethod http://localhost:11434/api/tags -TimeoutSec 2 | Out-Null
  Write-Host "Ollama is running (optional)."
} catch {
  Write-Host "Ollama not detected — fine if Claude or local tools are configured."
}

Write-Step "Preparing environment"
New-Item -ItemType Directory -Force -Path 'logs', 'data', 'backups\whatsapp-session', 'sessions' | Out-Null

$envTemplate = Join-Path $ProjectRoot 'config\business.env.template'
if (-not (Test-Path '.env')) {
  if (Test-Path $envTemplate) {
    Copy-Item $envTemplate '.env'
  } else {
    Copy-Item '.env.example' '.env'
  }
  Write-Host "Created .env — fill UPDATES_GROUP_JID before going live."
} else {
  Write-Host ".env already exists — keeping your settings."
}

function Ensure-EnvLine([string]$Key, [string]$Value) {
  $path = Join-Path $ProjectRoot '.env'
  $lines = @(Get-Content $path -ErrorAction SilentlyContinue)
  if ($null -eq $lines) { $lines = @() }
  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=") {
      $found = $true
      $line
    } else {
      $line
    }
  }
  if (-not $found) {
    $updated += "$Key=$Value"
    Set-Content -Path $path -Value $updated -Encoding UTF8
    Write-Host "Added $Key to .env"
  }
}
Ensure-EnvLine 'BOT_MODE' 'business'
Ensure-EnvLine 'DASHBOARD_PORT' '8787'
Ensure-EnvLine 'OWNER_SHEET_DM' '0'
Ensure-EnvLine 'GROUP_SHEET_SEND' '1'

Write-Step "Installing dependencies and building"
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path 'dist\index.js')) {
  Write-Host "Build did not produce dist\index.js" -ForegroundColor Red
  exit 1
}

Write-Step "Registering scheduled task ($TaskName)"
$runBot = Join-Path $ProjectRoot 'run-bot.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runBot`"" -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Scheduled task registered — bot starts automatically at Windows login."

Write-Step "Creating shortcuts"
$launcher = Join-Path $ProjectRoot 'Launch-BMF.bat'
$wsh = New-Object -ComObject WScript.Shell

$desktop = [Environment]::GetFolderPath('Desktop')
$desktopLink = $wsh.CreateShortcut((Join-Path $desktop 'Bring My Flowers.lnk'))
$desktopLink.TargetPath = $launcher
$desktopLink.WorkingDirectory = $ProjectRoot
$desktopLink.Description = 'Bring My Flowers owner dashboard'
$desktopLink.Save()

$startMenu = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
$startLink = $wsh.CreateShortcut((Join-Path $startMenu 'Bring My Flowers.lnk'))
$startLink.TargetPath = $launcher
$startLink.WorkingDirectory = $ProjectRoot
$startLink.Description = 'Bring My Flowers owner dashboard'
$startLink.Save()
Write-Host "Shortcuts created on Desktop and Start Menu."

Write-ConsoleStatus @{
  installed = $true
  taskName = $TaskName
  dashboardPort = 8787
  linked = (Test-Path 'sessions\creds.json')
}

Write-Step "Starting bot for the first time"
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

$envJid = ''
foreach ($line in Get-Content '.env') {
  if ($line -match '^\s*UPDATES_GROUP_JID\s*=\s*(.+)$') { $envJid = $Matches[1].Trim() }
}

if (-not (Test-Path 'sessions\creds.json')) {
  Write-Host ""
  Write-Host "WhatsApp is not linked yet." -ForegroundColor Yellow
  Write-Host "1. Double-click Bring My Flowers on the Desktop (or wait for the browser window)."
  Write-Host "2. Open the Link page and scan the QR with the business phone"
  Write-Host "   (WhatsApp > Linked Devices > Link a Device)."
} else {
  Write-Host "WhatsApp session found — bot should reconnect automatically."
}

if (-not $envJid) {
  Write-Host ""
  Write-Host "UPDATES_GROUP_JID is empty in .env — set it to the Updates group JID." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "  Daily use: double-click 'Bring My Flowers' on the Desktop"
Write-Host "  Dashboard: http://localhost:8787"
Write-Host "  Docs: docs/OWNER-CONSOLE.md"
Write-Host ""
Write-Host "Opening dashboard now..."
Start-Process -FilePath $launcher -WorkingDirectory $ProjectRoot
