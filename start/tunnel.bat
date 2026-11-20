@echo off
REM ============================================================================
REM  SmartQuote v2 - public links for a QA session (Cloudflare quick tunnels).
REM
REM  Starts one tunnel per service and prints the https://*.trycloudflare.com
REM  address for each, then tells you what to export before `pnpm dev` restarts
REM  - the API's allow-list and Next's dev-origin check both need the public
REM  host, and neither can learn it after the fact.
REM
REM  Usage:
REM    start\tunnel.bat            every service
REM    start\tunnel.bat site       only the public site (what QA usually wants)
REM    start\tunnel.bat site api   site + API
REM
REM  WARNING: a tunnel is an open door. Anyone with the link can load whatever
REM  that port serves. Tunnelling the client or admin app puts a sign-in screen
REM  on the public internet, where it can be password-guessed from anywhere.
REM  The public site is the one QA normally needs.
REM
REM  Requires cloudflared:  winget install Cloudflare.cloudflared
REM ============================================================================

SETLOCAL EnableDelayedExpansion
cd /d "%~dp0.."

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ERROR: cloudflared was not found on PATH.
  echo         Install it with:  winget install Cloudflare.cloudflared
  echo.
  pause
  exit /b 1
)

if not exist "start\ports.env" (
  echo.
  echo  ERROR: start\ports.env is missing - it lists the ports the tunnels point at.
  echo.
  pause
  exit /b 1
)

REM The tunnels must point at the ports actually in use, so read the same file.
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("start\ports.env") do (
  if not "%%A"=="" if not defined %%A set "%%A=%%B"
)
if "%API_PORT%"==""    set API_PORT=3060
if "%CLIENT_PORT%"=="" set CLIENT_PORT=3061
if "%ADMIN_PORT%"==""  set ADMIN_PORT=3062
if "%SITE_PORT%"==""   set SITE_PORT=3063

if "%~1"=="" goto :all
echo.
echo  Tunnelling: %*
echo  Remember this is public. Tunnelling client or admin exposes a sign-in page.
echo.
node scripts\tunnel.mjs %*
goto :done

:all
echo.
echo  No service named, so this will tunnel ALL FOUR:
echo    API, Client (sign-in), Admin (sign-in), Site (public)
echo.
echo  For a QA session that only needs the quote page, close this and run:
echo      start\tunnel.bat site
echo.
set /p CONFIRM=Type YES to tunnel all four: 
if /i not "%CONFIRM%"=="YES" (
  echo.
  echo  Cancelled. Nothing was exposed.
  echo.
  pause
  exit /b 1
)
node scripts\tunnel.mjs

:done
echo.
pause
