@echo off
title Flower-bot QR - scan with WhatsApp
powershell -NoProfile -Command "Get-Content 'C:\bring_my_flowers\bot-live.log' -Tail 40 -Wait"
