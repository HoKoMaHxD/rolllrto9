@echo off
cd /d "%~dp0"
if not exist .env (
  echo Copy .env.example to .env and set BOT_TOKEN first.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b 1
)
call npm start
pause
