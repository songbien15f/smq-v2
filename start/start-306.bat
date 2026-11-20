@echo off
REM ============================================================================
REM  SmartQuote v2 - one click to start everything and open the browser.
REM
REM  Four processes. The ports come from start\ports.env - edit them there and
REM  nothing else, so the API's allow-list, the browser origins and the three
REM  front-ends all move together:
REM     API     http://localhost:<API_PORT>/api/v1
REM     Client  http://localhost:<CLIENT_PORT>   <- the workspace, opens automatically
REM     Admin   http://localhost:<ADMIN_PORT>    <- the vendor's control plane
REM     Site    http://localhost:<SITE_PORT>     <- the end-customer site
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

REM ---------------------------------------------------------------- ports
REM One file, read before anything else starts: the API's allow-list, the origins
REM the browser uses and the three front-ends must all agree, or a request is
REM refused as cross-origin with nothing in the log to say why.
if not exist "start\ports.env" (
  echo.
  echo  ERROR: start\ports.env is missing. It lists the four ports; restore it
  echo         from the repository.
  echo.
  pause
  exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("start\ports.env") do (
  REM A value already in the environment wins, so a one-off override works:
  REM   set CLIENT_PORT=3071  &&  start\start-306.bat
  if not "%%A"=="" if not defined %%A set "%%A=%%B"
)
if "%API_PORT%"==""    set API_PORT=3060
if "%CLIENT_PORT%"=="" set CLIENT_PORT=3061
if "%ADMIN_PORT%"==""  set ADMIN_PORT=3062
if "%SITE_PORT%"==""   set SITE_PORT=3063

REM Reject a typo before four services fail one after another. Two equal ports
REM would be an "address already in use" that reads like a stale process.
for %%P in (%API_PORT% %CLIENT_PORT% %ADMIN_PORT% %SITE_PORT%) do (
  echo %%P| findstr /r /c:"^[1-9][0-9][0-9]*$" >nul || (
    echo.
    echo  ERROR: "%%P" in start\ports.env is not a port number.
    echo.
    pause
    exit /b 1
  )
)
set SEEN=
set DUPE=
for %%P in (%API_PORT% %CLIENT_PORT% %ADMIN_PORT% %SITE_PORT%) do (
  REM `&&` does not work inside a for-block here; errorlevel does.
  echo !SEEN! | findstr /c:" %%P " >nul
  if not errorlevel 1 set DUPE=%%P
  set SEEN=!SEEN! %%P 
)
if defined DUPE (
  echo.
  echo  ERROR: port %DUPE% is listed twice in start\ports.env.
  echo.
  pause
  exit /b 1
)

REM Derived once, here, and passed to every child process. An explicit value
REM already in the environment (a one-off `set CLIENT_PORT=3071`) still wins,
REM because these lines only fill blanks.
if "%API_ORIGIN%"==""    set API_ORIGIN=http://localhost:%API_PORT%
if "%CLIENT_ORIGIN%"=="" set CLIENT_ORIGIN=http://localhost:%CLIENT_PORT%
if "%ADMIN_ORIGIN%"==""  set ADMIN_ORIGIN=http://localhost:%ADMIN_PORT%
if "%SITE_ORIGIN%"==""   set SITE_ORIGIN=http://localhost:%SITE_PORT%
if "%API_BASE_URL%"==""  set API_BASE_URL=%API_ORIGIN%/api/v1
if "%NEXT_PUBLIC_API_BASE%"=="" set NEXT_PUBLIC_API_BASE=%API_BASE_URL%

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
  echo        psql -U postgres -f scripts\postgres-setup.sql
  REM Parentheses inside an if-block must be escaped with ^ - a bare ")" ends the
  REM block early and everything after it (the pause and exit below) runs always.
  echo      ^(or, with Docker:  docker compose up -d^)
  echo.
  echo    Postgres is required: the application database has no SQLite fallback.
  echo.
  pause
  exit /b 1
)

REM ---------------------------------------------------------------- company
REM `--if-empty` so a second run is a no-op rather than an error.
REM COMPANY_CODE is what a person types at the sign-in screen alongside their
REM username; without it nobody can reach the workspace.
if "%COMPANY_NAME%"=="" set COMPANY_NAME=Demo Sheds Pty Ltd
if "%COMPANY_CODE%"=="" set COMPANY_CODE=DEMOSHEDS
if "%COMPANY_ADMIN_USERNAME%"=="" set COMPANY_ADMIN_USERNAME=owner
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
set COMPANY_CODE=%COMPANY_CODE%
set COMPANY_ADMIN_USERNAME=%COMPANY_ADMIN_USERNAME%
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

REM ------------------------------------------------------------ ports free?
REM A window closed without Ctrl+C leaves its Node processes alive. Starting again then
REM brings up only some of the four (the Next apps answer, the API does not), and the page
REM shows "fetch failed" with nothing pointing at the real cause. Stop here and say so.
set BUSY=
for %%P in (%API_PORT% %CLIENT_PORT% %ADMIN_PORT% %SITE_PORT%) do (
  netstat -ano | findstr /r /c:"^ *TCP.*:%%P .*LISTENING" >nul && set BUSY=!BUSY! %%P
)
if defined BUSY (
  echo.
  echo  ERROR: these ports are already in use:!BUSY!
  echo         A previous run is still alive. Run  start\stop-306.bat  first, then start again.
  echo.
  pause
  exit /b 1
)

REM ------------------------------------------------------------------ start
echo.
echo  ==========================================
echo    Starting. The browser opens in a moment.
echo  ==========================================
echo.
echo    Client   %CLIENT_ORIGIN%   (the workspace)
echo    Admin    %ADMIN_ORIGIN%
echo    Site     %SITE_ORIGIN%
echo    API      %API_BASE_URL%
echo.
echo    Client sign in:   code     %COMPANY_CODE%
echo                      username %COMPANY_ADMIN_USERNAME%
echo                      password %COMPANY_ADMIN_PASSWORD%
echo    Admin sign in:    email    %PLATFORM_ADMIN_EMAIL%
echo                      password %PLATFORM_ADMIN_PASSWORD%
echo.
echo    Ctrl+C here stops everything.
echo.

REM Wait for the client to answer before opening a tab, so the browser does not
REM land on a connection error and leave the operator reloading by hand. It polls rather than
REM sleeping a fixed time: the first start builds the packages and takes far longer than a
REM later one. Gives up after about three minutes and opens the tab anyway.
start "" powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest %CLIENT_ORIGIN% -UseBasicParsing -TimeoutSec 2 | Out-Null;break}catch{Start-Sleep 2}}; Start-Process %CLIENT_ORIGIN%"

call pnpm dev

echo.
echo  The services have stopped.
pause
