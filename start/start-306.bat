@echo off
REM ============================================================================
REM  SmartQuote v2 - one click to start everything and open the browser.
REM
REM  Four processes, on the 306x ports:
REM     API     http://localhost:3060/api/v1
REM     Client  http://localhost:3061   <- the workspace, opens automatically
REM     Admin   http://localhost:3062   <- the vendor's control plane
REM     Site    http://localhost:3063   <- the end-customer site
REM
REM  Ctrl+C in this window stops all four.
REM
REM  This file does the first-run setup itself: dependencies, the database, the
REM  company, and the price book. On a later run each step finds its work already
REM  done and is skipped, so it stays a single click either way.
REM ============================================================================

SETLOCAL EnableDelayedExpansion
REM The batch file lives in start\, so step up to the project root before anything
REM else: every path below (node_modules, .env, scripts) is relative to that.
cd /d "%~dp0.."

echo.
echo  ==========================================
echo    SmartQuote v2
echo  ==========================================
echo.

REM ------------------------------------------------------------------ Node
where node >nul 2>nul
if errorlevel 1 (
  echo  ERROR: Node.js was not found on PATH.
  echo         Install Node 22 or newer from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo  Node %NODE_VERSION%

where pnpm >nul 2>nul
if errorlevel 1 (
  echo  ERROR: pnpm was not found on PATH.
  echo         Run:  corepack enable
  echo         Then run this again.
  echo.
  pause
  exit /b 1
)

REM ------------------------------------------------------------- first run
if not exist ".env" (
  echo.
  echo  First run: creating .env from .env.example
  copy /y ".env.example" ".env" >nul
)

if not exist "node_modules" (
  echo.
  echo  Installing dependencies. The first run takes a few minutes...
  call pnpm install
  if errorlevel 1 (
    echo.
    echo  ERROR: pnpm install failed. The output above says why.
    pause
    exit /b 1
  )
)

REM --------------------------------------------------------------- database
REM Postgres is the target. If it is not reachable, this stops with a clear
REM message rather than half starting: an API that cannot open its database
REM answers 503 to everything, and a browser showing that looks like a bug in
REM the app rather than a missing service.
echo.
echo  Checking the database...
call pnpm db:migrate
if errorlevel 1 (
  echo.
  echo  ERROR: the database could not be reached or migrated.
  echo.
  echo    - Is PostgreSQL running on port 5432?
  echo    - Have you created the role and database? Run this once, as a superuser:
  echo        scripts\postgres-setup.sql
  echo.
  echo    To run without Postgres instead, edit .env and set:
  echo        DB_DRIVER=sqlite
  echo        DB_FILE=./data/app.db
  echo.
  pause
  exit /b 1
)

REM ---------------------------------------------------------------- company
REM `--if-empty` so a second run is a no-op rather than an error. The installer
REM refuses a second company on purpose; this flag is how the launcher asks it
REM to skip instead of fail.
if "%COMPANY_NAME%"=="" set COMPANY_NAME=Demo Sheds Pty Ltd
if "%COMPANY_ADMIN_EMAIL%"=="" set COMPANY_ADMIN_EMAIL=owner@demo-sheds.local
if "%COMPANY_ADMIN_PASSWORD%"=="" set COMPANY_ADMIN_PASSWORD=a-long-enough-password
if "%COMPANY_SLUG%"=="" set COMPANY_SLUG=demo-sheds

REM The admin site needs its own administrator or it is unreachable, and the
REM installer does not create one unless asked. A demo where half the screens
REM cannot be opened is a worse demo, so the launcher provides one.
if "%PLATFORM_ADMIN_EMAIL%"=="" set PLATFORM_ADMIN_EMAIL=ops@smartquote.local
if "%PLATFORM_ADMIN_PASSWORD%"=="" set PLATFORM_ADMIN_PASSWORD=platform-password-change-me

echo.
echo  Preparing the company...
set COMPANY_NAME=%COMPANY_NAME%
set COMPANY_ADMIN_EMAIL=%COMPANY_ADMIN_EMAIL%
set COMPANY_ADMIN_PASSWORD=%COMPANY_ADMIN_PASSWORD%
set COMPANY_SLUG=%COMPANY_SLUG%
set PLATFORM_ADMIN_EMAIL=%PLATFORM_ADMIN_EMAIL%
set PLATFORM_ADMIN_PASSWORD=%PLATFORM_ADMIN_PASSWORD%
call pnpm install:company -- --if-empty
if errorlevel 1 (
  echo.
  echo  WARNING: the company could not be prepared. The services still start.
  echo.
)

REM ------------------------------------------------------------- price book
REM Published only when none is active, so an operator's own book is never
REM replaced by the sample. Missing entirely on a fresh clone: it is licensed
REM supplier data and is not in the repository.
echo.
echo  Checking the price book...
call pnpm publish-book -- --if-empty
if errorlevel 1 (
  echo.
  echo  NOTE: no price book is active, so the editor will refuse to price anything
  echo        and say so. That is expected on a fresh clone: the book is licensed
  echo        supplier data. Publish one from the admin screen, or put a dump in
  echo        tools\price-dump\out and run:  pnpm publish-book
  echo.
)

REM ------------------------------------------------------------------ start
echo.
echo  ==========================================
echo    Starting. The browser opens in a moment.
echo  ==========================================
echo.
echo    Client   http://localhost:3061   (the workspace)
echo    Admin    http://localhost:3062
echo    Site     http://localhost:3063
echo    API      http://localhost:3060/api/v1
echo.
echo    Client sign in:   %COMPANY_ADMIN_EMAIL%
echo                      %COMPANY_ADMIN_PASSWORD%
echo    Admin sign in:    %PLATFORM_ADMIN_EMAIL%
echo                      %PLATFORM_ADMIN_PASSWORD%
echo.
echo    Ctrl+C here stops everything.
echo.

REM Wait for the client to answer before opening a tab, so the browser does not
REM land on a connection error and leave the operator reloading by hand.
start "" cmd /c "timeout /t 12 >nul & start http://localhost:3061"

call pnpm dev

echo.
echo  The services have stopped.
pause
