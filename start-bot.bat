@echo off
title Bring My Flowers bot - close this window to stop the bot
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\bring_my_flowers\run-bot.ps1"
pause
