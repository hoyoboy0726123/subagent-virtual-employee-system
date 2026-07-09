@echo off
REM ============================================================
REM  Virtual Employee System - one-click start
REM  Double-click to run. First run: installs dependencies,
REM  builds the web UI, seeds the default team (9 AI employees
REM  with background knowledge), then opens the app.
REM  Later runs: skips finished steps and starts immediately.
REM  (ASCII only on purpose - cmd.exe parses batch files with
REM   the ANSI codepage; UTF-8 Chinese breaks the parser.)
REM ============================================================
setlocal
pushd "%~dp0"
title Virtual Employee System

echo.
echo   ============================================
echo    Virtual Employee System  ^|  One-Click Start
echo   ============================================
echo.

REM ---- 1) Node.js check ---------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js not found. This app needs Node.js 22.5 or newer.
  echo       Opening the official download page - install it, then
  echo       run this file again.
  start "" "https://nodejs.org/"
  pause
  goto :end
)
node -e "const [M,m]=process.versions.node.split('.').map(Number);process.exit(M>22||(M===22&&m>=5)?0:1)" >nul 2>nul
if errorlevel 1 (
  for /f "delims=" %%v in ('node -v') do echo   [X] Node.js %%v is too old. Need 22.5 or newer.
  echo       Opening the official download page - upgrade, then
  echo       run this file again.
  start "" "https://nodejs.org/"
  pause
  goto :end
)
for /f "delims=" %%v in ('node -v') do echo   [OK] Node.js %%v

REM ---- 2) First run: install dependencies ----------------------
if not exist "node_modules" (
  echo   [..] First run - installing dependencies, takes 1-3 minutes...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
) else (
  echo   [OK] Dependencies installed
)

REM ---- 3) First run: build the web UI --------------------------
if not exist "client\dist\index.html" (
  echo   [..] Building the web UI...
  call npm run build
  if errorlevel 1 goto :fail
) else (
  echo   [OK] Web UI built
)

REM ---- 4) First run: seed the default team ---------------------
if not exist "server\data\app.db" (
  echo   [..] Creating the default team - 9 AI employees with
  echo        background knowledge...
  call npm run seed
  if errorlevel 1 goto :fail
) else (
  echo   [OK] Database exists - your employees and data are kept
)

REM ---- 4b) First run: PDF/DOCX parsing (optional, needs Python) -
REM  MarkItDown is optional - NO goto :fail here. If Python is missing
REM  or the install fails, we just skip it and still launch the app
REM  (TXT/MD/HTML upload works regardless). Same graceful degrade as
REM  the packaged exe's auto-setup.
if not exist ".venv" (
  echo   [..] Setting up PDF/DOCX parsing - optional, needs Python 3.11-3.13...
  call npm run setup:markitdown
  if errorlevel 1 (
    echo   [!] Skipped PDF/DOCX parsing ^(no compatible Python found^).
    echo       Install Python from https://www.python.org/ then run:
    echo       npm run setup:markitdown
    echo       TXT/MD/HTML upload works without it.
  ) else (
    echo   [OK] PDF/DOCX parsing ready
  )
) else (
  echo   [OK] PDF/DOCX parsing configured
)

REM ---- 5) Start the server and open the browser ----------------
echo.
echo   [..] Starting...  http://localhost:3001
echo        Close this window to stop the app.
echo.
start "" cmd /c "ping -n 4 127.0.0.1 >nul & start "" http://localhost:3001"
node server\src\index.js
goto :end

:fail
echo.
echo   [X] Setup failed. Please screenshot the messages above and
echo       open an issue.
pause

:end
popd
endlocal
