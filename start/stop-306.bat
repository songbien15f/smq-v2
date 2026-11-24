@echo off
REM ============================================================================
REM  SmartQuote v2 - stop whatever is listening on this project's ports.
REM
REM  The ports come from start\ports.env, the same file the launcher reads, so a
REM  changed port is stopped too. Use this when the window that started the
REM  services was closed without Ctrl+C: the Node processes survive that, and
REM  the next start then fails with "address already in use". This includes the
REM  intro site, which runs in a window of its own.
REM ============================================================================

SETLOCAL EnableDelayedExpansion
cd /d "%~dp0"

set PORTS_FILE=ports.env
if not exist "%PORTS_FILE%" (
  echo.
  echo  ERROR: %PORTS_FILE% is missing. It lists the ports; restore it from
  echo         the repository.
  echo.
  pause
  exit /b 1
)

REM Read KEY=VALUE lines, ignoring blank lines and '#' comments.
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%PORTS_FILE%") do (
  REM A value already in the environment wins, so a one-off override works:
  REM   set CLIENT_PORT=3071  &&  start\start-306.bat
  if not "%%A"=="" if not defined %%A set "%%A=%%B"
)

if "%API_PORT%"==""    set API_PORT=3060
if "%CLIENT_PORT%"=="" set CLIENT_PORT=3061
if "%ADMIN_PORT%"==""  set ADMIN_PORT=3062
if "%SITE_PORT%"==""   set SITE_PORT=3063
if "%INTRO_PORT%"==""  set INTRO_PORT=3065

echo.
echo  Stopping anything on ports %API_PORT%, %CLIENT_PORT%, %ADMIN_PORT%, %SITE_PORT%, %INTRO_PORT%...

set FOUND=0

for %%P in (%API_PORT% %CLIENT_PORT% %ADMIN_PORT% %SITE_PORT% %INTRO_PORT%) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /r /c:"^ *TCP.*:%%P .*LISTENING"') do (
    if not "%%A"=="0" (
      REM A process that listens on both IPv4 and IPv6 appears twice; kill it once.
      if not defined SEEN_%%A (
        set SEEN_%%A=1
        echo    port %%P  -^>  process %%A
        taskkill /F /PID %%A >nul 2>nul
        set FOUND=1
      )
    )
  )
)

if "!FOUND!"=="0" (
  echo    Nothing was listening.
) else (
  echo.
  echo  Stopped.
)

echo.
pause
