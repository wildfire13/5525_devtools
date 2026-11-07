@echo off
setlocal
cd /d "%~dp0"
if defined SAVE_LAB_NODE (
  "%SAVE_LAB_NODE%" launch.cjs --diagnose
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found. Set SAVE_LAB_NODE to an existing node.exe.
    pause
    exit /b 2
  )
  node launch.cjs --diagnose
)
echo.
echo This check does not install software, change settings, or read saves.
pause
