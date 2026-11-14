@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1" -LaunchArgs --diagnose
set "result=%errorlevel%"
echo.
echo This check does not install software, change settings, or read saves.
pause
exit /b %result%
