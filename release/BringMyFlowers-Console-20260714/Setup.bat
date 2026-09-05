@echo off
title Bring My Flowers — Setup
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Bring My Flowers — Owner Console Setup
echo  ======================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-business-console.ps1"
if errorlevel 1 (
  echo.
  echo Setup failed. See messages above.
  pause
  exit /b 1
)
echo.
pause
