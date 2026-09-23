# Create a source-complete, sanitized handoff for Claude.
# This intentionally excludes secrets, live data, sessions, and Git metadata.
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$rootPath = [System.IO.Path]::GetFullPath((Resolve-Path $ProjectRoot).Path).TrimEnd('\')

if (-not $OutDir) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $OutDir = Join-Path $rootPath "release\BringMyFlowers-Claude-Handoff-$stamp"
}

$outPath = [System.IO.Path]::GetFullPath($OutDir).TrimEnd('\')
$rootPrefix = $rootPath + '\'
if (-not $outPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Output must be inside the project root: $rootPath"
}
if (Test-Path $outPath) {
  throw "Output already exists; choose a new OutDir: $outPath"
}

New-Item -ItemType Directory -Force -Path $outPath | Out-Null

$copyItems = @(
  '.cursorrules',
  '.env.example',
  '.gitignore',
  'CLAUDE.md',
  'LICENSE',
  'README.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  'configure-twilio.bat',
  'Launch-BMF.bat',
  'Launch-BMF.ps1',
  'open_pwsh.bat',
  'run-bot.ps1',
  'Setup.bat',
  'show-qr.bat',
  'start-bot.bat',
  'config',
  'docs',
  'dist',
  'scripts',
  'src',
  'tests'
)

foreach ($item in $copyItems) {
  $source = Join-Path $rootPath $item
  if (-not (Test-Path $source)) { continue }
  $destination = Join-Path $outPath $item
  Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

@(
  'Bring My Flowers - sanitized Claude handoff',
  '============================================',
  '',
  'Open CLAUDE.md first.',
  'Read docs/PROJECT-HANDOFF.md and docs/WHATSAPP-STRATEGY.md next.',
  'This archive intentionally excludes .env, .git, .claude, data, sandbox,',
  'sessions, logs, backups, node_modules, and previous release artifacts.',
  'The original workspace retains the live runtime state and full Git history.',
  '',
  'Recommended checks:',
  '  npm.cmd run build',
  '  npm.cmd test',
  '  npm.cmd run test:sandbox',
  '  npm.cmd run verify -- --mode=business'
) | Set-Content (Join-Path $outPath 'TRANSFER-TO-CLAUDE.txt') -Encoding UTF8

$zipPath = "$outPath.zip"
$zipped = $false
if (Get-Command tar -ErrorAction SilentlyContinue) {
  Push-Location (Split-Path $outPath -Parent)
  try {
    tar -a -c -f (Split-Path $zipPath -Leaf) (Split-Path $outPath -Leaf)
    if (Test-Path $zipPath) { $zipped = $true }
  } finally {
    Pop-Location
  }
}

if (-not $zipped) {
  Compress-Archive -Path $outPath -DestinationPath $zipPath -Force
  $zipped = Test-Path $zipPath
}

Write-Host "Claude handoff folder: $outPath"
if ($zipped) {
  Write-Host "Claude handoff ZIP:    $zipPath"
} else {
  Write-Host 'ZIP creation failed; use the folder directly.'
}
