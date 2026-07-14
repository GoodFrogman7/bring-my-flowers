@echo off
title Bring My Flowers
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-BMF.ps1"
