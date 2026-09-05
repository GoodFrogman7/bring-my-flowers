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

function Show-StartingDialog([scriptblock]$WaitLoop) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Bring My Flowers'
  $form.Size = New-Object System.Drawing.Size(420, 130)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.TopMost = $true
  $label = New-Object System.Windows.Forms.Label
  $label.AutoSize = $false
  $label.Size = New-Object System.Drawing.Size(380, 50)
  $label.Location = New-Object System.Drawing.Point(20, 24)
  $label.Text = 'Starting the bot...'
  $form.Controls.Add($label)
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 1000
  $script:waitSec = 0
  $timer.Add_Tick({
    $script:waitSec++
    $label.Text = "Starting the bot... ($script:waitSec s)`nPlease wait - first launch can take up to a minute."
    if (& $WaitLoop) {
      $timer.Stop()
      $form.Close()
    }
  })
  $form.Add_Shown({ $timer.Start() })
  [void]$form.ShowDialog()
  return $script:waitResult
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
  Show-Error "DASHBOARD_PORT=0 - the dashboard is disabled in .env.`n`nSet DASHBOARD_PORT=8787 and restart the bot."
  exit 1
}
$DashboardUrl = "http://127.0.0.1:$port"
$OverviewUrl = "$DashboardUrl/api/overview"
$HealthUrl = "$DashboardUrl/api/health"
$transport = Read-EnvValue 'BUSINESS_TRANSPORT' 'dashboard'
$dashboardMode = $transport -in @('dashboard', 'manual')
$linked = Test-Path (Join-Path $Root 'sessions\creds.json')
$openPath = if ($dashboardMode -or $linked) { $DashboardUrl } else { "$DashboardUrl/link" }

# Start the scheduled task if registered; otherwise start run-bot.ps1 in background.
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
} else {
  # Process command-line enumeration can be denied by Windows. A local health
  # probe is enough to avoid starting a second copy; run-bot.ps1 also checks
  # the app lock file before launching.
  $botRunning = $false
  try {
    Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2 | Out-Null
    $botRunning = $true
  } catch {}
  if (-not $botRunning) {
    Start-Process powershell -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-File', (Join-Path $Root 'run-bot.ps1') -WorkingDirectory $Root
  }
}

$ready = $false
$script:waitResult = $false
$ready = Show-StartingDialog {
  if ($script:waitSec -ge $MaxWaitSec) {
    $script:waitResult = $false
    return $true
  }
  try {
    Invoke-RestMethod -Uri $OverviewUrl -TimeoutSec 2 | Out-Null
    $script:waitResult = $true
    return $true
  } catch {
    return $false
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
