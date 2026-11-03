@echo off
REM ============================================================================
REM  SmartQuote v2 - stop whatever is listening on the 306x ports.
REM
REM  Use this when the window that started the services was closed without
REM  Ctrl+C: the four Node processes survive that, and the next start then fails
REM  with "address already in use".
REM ============================================================================

SETLOCAL EnableDelayedExpansion
echo.
echo  Stopping anything on ports 3060, 3061, 3062, 3063...

set FOUND=0

for %%P in (3060 3061 3062 3063) do (
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
