@echo off
setlocal EnableExtensions
title Smart Solutions Australia - Local Dev Server
cd /d "%~dp0.."

set "APPPORT=3065"

rem Pass "public" as the first argument to also expose the site through a
rem temporary Cloudflare quick tunnel. Start\START-WEBSITE-PUBLIC.bat does that.
set "PUBLIC=0"
if /i "%~1"=="public" set "PUBLIC=1"

echo ==========================================================
echo   Smart Solutions Australia - Local Development Server
echo ==========================================================
echo   Project : %CD%
echo   Port    : %APPPORT%
if "%PUBLIC%"=="1" echo   Mode    : local + public tunnel
if "%PUBLIC%"=="0" echo   Mode    : local only
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo         Install Node.js 20.9 or newer from https://nodejs.org
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"
echo [OK] Node %NODEVER%

if not exist "node_modules" (
  echo [..] node_modules is missing - installing dependencies ^(this can take a few minutes^) ...
  call npm install
  if errorlevel 1 goto :fail
)

echo [..] Checking PostgreSQL on port 5432 ...
netstat -ano | findstr ":5432" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo [ERROR] PostgreSQL is not listening on port 5432.
  echo         Start the service, then run this file again:
  echo             net start postgresql-x64-18
  echo         ^(run that line in an Administrator command prompt^)
  echo.
  pause
  exit /b 1
)
echo [OK] PostgreSQL is listening on 5432

echo [..] Checking that port %APPPORT% is free ...
netstat -ano | findstr ":%APPPORT% " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [ERROR] Port %APPPORT% is already in use.
  echo         Close the other server, or run Start\STOP-WEBSITE.bat first.
  echo.
  pause
  exit /b 1
)
echo [OK] Port %APPPORT% is free

echo [..] Applying database migrations ...
call npm run migrate
if errorlevel 1 goto :fail

echo [..] Ensuring demo content exists ^(safe to re-run^) ...
call npm run seed
if errorlevel 1 goto :fail

if "%PUBLIC%"=="1" call :startTunnel

echo.
echo ==========================================================
echo   Local website : http://localhost:%APPPORT%
echo   Local admin   : http://localhost:%APPPORT%/admin
if defined PUBLICURL echo   PUBLIC site   : %PUBLICURL%
if defined PUBLICURL echo   PUBLIC admin  : %PUBLICURL%/admin
echo   Login         : admin@example.com  /  Admin12345!
echo                   ^(full details in Start\USER-INFO.md^)
echo ==========================================================
if defined PUBLICURL (
  echo   WARNING: the public URL is reachable by anyone who has it,
  echo            including the admin login. Share it only with your
  echo            tester, and stop the tunnel when the test is over.
  echo.
)
echo   Keep this window open while testing.
echo   Press Ctrl+C to stop the server.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 12; Start-Process 'http://localhost:%APPPORT%/admin'"

set "PORT=%APPPORT%"
if defined PUBLICURL (
  set "NEXT_PUBLIC_SERVER_URL=%PUBLICURL%"
) else (
  set "NEXT_PUBLIC_SERVER_URL=http://localhost:%APPPORT%"
)
call npm run dev

echo.
echo Server stopped.
if defined PUBLICURL (
  echo Closing the Cloudflare tunnel ...
  taskkill /IM cloudflared.exe /F >nul 2>nul
)
pause
exit /b 0

rem ---------------------------------------------------------------------------
rem Cloudflare quick tunnel
rem
rem A quick tunnel needs no Cloudflare account and prints a random
rem *.trycloudflare.com hostname. We start it before the app so the hostname can
rem be used as NEXT_PUBLIC_SERVER_URL: canonical URLs, the sitemap and robots.txt
rem then match the address the tester actually opens.
rem ---------------------------------------------------------------------------
:startTunnel
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [WARN] cloudflared was not found in PATH, so no public URL will be created.
  echo        Install it with:  winget install --id Cloudflare.cloudflared
  echo.
  exit /b 0
)

echo [..] Starting Cloudflare quick tunnel on port %APPPORT% ...
set "TUNNELLOG=%TEMP%\smartcoa-tunnel.log"
if exist "%TUNNELLOG%" del /q "%TUNNELLOG%" >nul 2>nul
start "Cloudflare Tunnel - close this window to stop it" /min cmd /c "cloudflared tunnel --url http://localhost:%APPPORT% --no-autoupdate > "%TUNNELLOG%" 2>&1"

set "PUBLICURL="
set /a TUNNELTRY=0
:tunnelWait
set /a TUNNELTRY+=1
if %TUNNELTRY% GTR 45 goto :tunnelTimeout
"%SystemRoot%\System32\timeout.exe" /t 1 >nul 2>nul
for /f "usebackq delims=" %%u in (`powershell -NoProfile -Command "$m=[regex]::Match((Get-Content -Raw -ErrorAction SilentlyContinue '%TUNNELLOG%'),'https://[a-z0-9-]+\.trycloudflare\.com'); if($m.Success){$m.Value}"`) do set "PUBLICURL=%%u"
if not defined PUBLICURL goto :tunnelWait

echo [OK] Public URL: %PUBLICURL%
echo %PUBLICURL%>"%~dp0PUBLIC-URL.txt"
exit /b 0

:tunnelTimeout
echo [WARN] Could not read a tunnel URL within 45 seconds.
echo        The local site still works. Tunnel log: %TUNNELLOG%
echo.
exit /b 0

:fail
echo.
echo [ERROR] Startup stopped. Read the messages above.
if "%PUBLIC%"=="1" taskkill /IM cloudflared.exe /F >nul 2>nul
echo.
pause
exit /b 1
