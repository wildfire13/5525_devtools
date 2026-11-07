@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. See README.md.
  pause
  exit /b 1
)
if defined SAVE_LAB_PYTHON (
  "%SAVE_LAB_PYTHON%" save_lab.py gui
  if errorlevel 1 pause
  exit /b
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 save_lab.py gui
) else (
  python save_lab.py gui
)
if errorlevel 1 pause
