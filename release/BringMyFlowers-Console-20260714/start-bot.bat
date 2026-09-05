@echo off
title Bring My Flowers bot - close this window to stop the bot
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-bot.ps1"
pause
