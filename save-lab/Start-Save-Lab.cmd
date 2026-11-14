@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1"
if errorlevel 1 (
  echo.
  echo Launch failed. Run Diagnose-Save-Lab.cmd for details.
  pause
  exit /b 2
)
