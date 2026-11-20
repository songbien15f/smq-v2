@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Stop Smart Solutions Australia dev server

set "APPPORT=3065"

echo Stopping processes listening on port %APPPORT% ...
echo.

set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%APPPORT% " ^| findstr "LISTENING"') do (
  if not defined SEEN_%%p (
    set "SEEN_%%p=1"
    echo   Killing PID %%p
    taskkill /PID %%p /T /F >nul 2>nul
    set "FOUND=1"
  )
)

if not defined FOUND echo   Nothing was listening on port %APPPORT%.

echo.
echo Stopping the Cloudflare tunnel ^(if one is running^) ...
taskkill /IM cloudflared.exe /F >nul 2>nul && echo   Tunnel stopped. || echo   No tunnel was running.

echo.
echo Done. You can close this window.
"%SystemRoot%\System32\timeout.exe" /t 3 >nul 2>nul
exit /b 0
