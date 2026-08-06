@echo off
title Riders Miami CRM + Bot
cd /d "%~dp0"
echo ============================================
echo   Riders Miami - CRM + Bot de Telegram
echo ============================================
echo.
echo   Abri el CRM en:  http://localhost:8790
echo   Escribile al bot en Telegram: @RidersCRM_bot
echo.
echo   (No cierres esta ventana mientras uses el CRM)
echo ============================================
echo.
node server.js
pause
