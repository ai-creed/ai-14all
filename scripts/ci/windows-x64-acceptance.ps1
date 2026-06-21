#!/usr/bin/env pwsh
# Windows x64 acceptance gate, shared by build-windows.yml (branch CI, runs on
# push) and release-windows.yml (runs on a release tag). It encodes the spec §5
# Windows-native acceptance criteria so they are verified on a native Windows
# runner without a human:
#
#   1. The x64 NSIS build emitted the exact accepted asset set
#      (ai-14all-<ver>-x64-Setup.exe + .blockmap, latest.yml, zip) and latest.yml
#      references the installer electron-updater will fetch.
#   2. A clean silent install runs and the installed app launches and stays up
#      (catches crash-on-launch, e.g. a bad native-module ABI that the afterPack
#      guard cannot see).
#
# Reaching this script means electron-builder + the afterPack guards already
# passed. The SmartScreen click-through is intentionally NOT covered: it is a
# Mark-of-the-Web reputation prompt shown only to end users downloading the
# unsigned file from the internet, so CI-built local files never trigger it (see
# docs/windows-distribution.md). Run from the repo root; release/ is relative.

param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"

# --- 1. Verify the x64 artifact set ---
$setup = "release/ai-14all-$Version-x64-Setup.exe"
foreach ($f in @($setup, "$setup.blockmap", "release/latest.yml")) {
  if (-not (Test-Path $f)) { throw "missing expected artifact: $f" }
}
if (-not (Get-ChildItem release/*.zip)) { throw "missing x64 zip" }
$manifest = Get-Content release/latest.yml -Raw
if ($manifest -notmatch [regex]::Escape("ai-14all-$Version-x64-Setup.exe")) {
  throw "latest.yml does not reference ai-14all-$Version-x64-Setup.exe"
}
Write-Host "x64 artifacts verified: installer + blockmap + latest.yml + zip"

# --- 2. Silent install + launch smoke ---
$setupPath = (Resolve-Path $setup).Path
Write-Host "Silent-installing $setupPath"
Start-Process -FilePath $setupPath -ArgumentList "/S" -Wait
$exe = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Programs") -Recurse -Filter "ai-14all.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { throw "installed ai-14all.exe not found under %LOCALAPPDATA%\Programs" }
Write-Host "Installed: $($exe.FullName)"
$proc = Start-Process -FilePath $exe.FullName -PassThru
Start-Sleep -Seconds 12
if ($proc.HasExited) { throw "app exited within 12s (exit code $($proc.ExitCode)) - crash on launch" }
Write-Host "App launched and stayed alive; stopping it"
Stop-Process -Id $proc.Id -Force
