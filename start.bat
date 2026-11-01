@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this machine.
  echo   Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:5177
node serve.mjs 5177
endlocal
