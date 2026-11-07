@echo off
setlocal
cd /d "%~dp0"
if defined SAVE_LAB_NODE (
  "%SAVE_LAB_NODE%" launch.cjs --gui
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js 18 or newer is required.
    echo Set SAVE_LAB_NODE to your existing node.exe path. See README.md.
    pause
    exit /b 2
  )
  node launch.cjs --gui
)
if errorlevel 1 (
  echo.
  echo Launch failed. Run Diagnose-Save-Lab.cmd for details.
  pause
  exit /b 2
)
