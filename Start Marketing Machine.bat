@echo off
title Marketing Machine
cd /d "%~dp0"
echo.
echo  McCracken Marketing Machine
echo  Keep this window open while you use the app. Close it to stop the app.
echo.
where node >nul 2>nul || (echo Node.js is not installed. Install the LTS version from https://nodejs.org and try again. & pause & exit /b 1)

rem Update in place from GitHub. The updater is fetched fresh each time so it can improve too; the local copy is the fallback.
echo  Checking for updates...
if not exist scripts mkdir scripts
powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest 'https://raw.githubusercontent.com/jrmccracken/mccrackenmarketingmachine/claude/mccracken-marketing-dashboard-jtitw7/scripts/update.ps1' -OutFile 'scripts\update.ps1' -UseBasicParsing } catch {}" >nul 2>nul
set NEEDS_INSTALL=
if exist scripts\update.ps1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\update.ps1"
  if errorlevel 10 set NEEDS_INSTALL=1
)
if not exist node_modules set NEEDS_INSTALL=1
if defined NEEDS_INSTALL (
  echo  Installing, this takes about a minute...
  call npm.cmd install || (echo Install failed. Send a screenshot of this window. & pause & exit /b 1)
)

rem Stop any older copy of the app still running (from another folder), so this one gets the usual addresses.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3001,5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 2 >nul

rem Open the dashboard in the browser once it has had a few seconds to start.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:5173"
call npm.cmd run dev
pause
