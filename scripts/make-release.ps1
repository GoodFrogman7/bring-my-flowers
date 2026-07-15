# Build a USB/Drive-ready release folder + zip for client delivery.
# Does NOT include .env, sessions/, or production data.
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
Set-Location $ProjectRoot

Write-Host '==> Building production bundle'
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$stamp = Get-Date -Format 'yyyyMMdd'
if (-not $OutDir) {
  $OutDir = Join-Path $ProjectRoot "release\BringMyFlowers-Console-$stamp"
}
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$copyItems = @(
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'Setup.bat',
  'Launch-BMF.bat',
  'Launch-BMF.ps1',
  'run-bot.ps1',
  'start-bot.bat',
  'README.md',
  'dist',
  'src',
  'scripts',
  'config',
  'docs'
)

foreach ($item in $copyItems) {
  $src = Join-Path $ProjectRoot $item
  if (-not (Test-Path $src)) { continue }
  $dest = Join-Path $OutDir $item
  Copy-Item $src $dest -Recurse -Force
}

foreach ($dir in @('data', 'sessions', 'logs', 'backups\whatsapp-session')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $OutDir $dir) | Out-Null
}

@(
  'Bring My Flowers - Owner Console',
  '================================',
  '',
  '1. Install Node.js 18+ LTS from https://nodejs.org/',
  '2. Unzip this folder anywhere (Desktop is fine)',
  '3. Double-click Setup.bat',
  '4. Edit .env - set UPDATES_GROUP_JID to your Updates WhatsApp group',
  '5. Open Bring My Flowers from the Desktop and scan the QR on the Link page',
  '',
  'Day-to-day: use the Desktop shortcut. Sheets on the dashboard + nightly in Updates group.',
  'Personal WhatsApp sheet DMs are OFF.',
  '',
  'Full guide: docs\OWNER-CONSOLE.md'
) | Set-Content (Join-Path $OutDir 'START-HERE.txt') -Encoding UTF8

$zipPath = "$OutDir.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$zipped = $false
if (Get-Command tar -ErrorAction SilentlyContinue) {
  Push-Location (Split-Path $OutDir -Parent)
  try {
    tar -a -c -f (Split-Path $zipPath -Leaf) (Split-Path $OutDir -Leaf)
    if (Test-Path $zipPath) { $zipped = $true }
  } finally {
    Pop-Location
  }
}

if (-not $zipped) {
  for ($i = 1; $i -le 3; $i++) {
    try {
      Compress-Archive -Path $OutDir -DestinationPath $zipPath -Force
      $zipped = $true
      break
    } catch {
      Start-Sleep -Seconds 2
    }
  }
}

Write-Host ''
if (-not $zipped) {
  Write-Host "Folder ready but zip failed - send the folder itself:"
  Write-Host "  $OutDir"
} else {
  Write-Host 'Release ready:'
  Write-Host "  Folder: $OutDir"
  Write-Host "  Zip:    $zipPath"
  Write-Host 'Copy the zip to USB / Google Drive for your uncle.'
}
