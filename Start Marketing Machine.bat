@echo off
title Marketing Machine
cd /d "%~dp0"
echo.
echo  McCracken Marketing Machine
echo  Keep this window open while you use the app. Close it to stop the app.
echo.
where node >nul 2>nul || (echo Node.js is not installed. Install the LTS version from https://nodejs.org and try again. & pause & exit /b 1)
if not exist node_modules (
  echo  First run: installing, this takes about a minute...
  call npm.cmd install || (echo Install failed. Send a screenshot of this window. & pause & exit /b 1)
)
rem Open the dashboard in the browser once it has had a few seconds to start.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:5173"
call npm.cmd run dev
pause
