@echo off
setlocal
title prompt workbench - catworld
where node >nul 2>nul
if errorlevel 1 (
  echo [prompt] Node.js not found in PATH.
  echo [prompt] Install Node.js, then run this again.
  pause
  exit /b 1
)
echo [prompt] starting prompt workbench...
echo [prompt] a browser window will open. keep this window open.
echo.
node "%~dp0.dsh\tools\prompt\prompt-serve.mjs" %*
echo.
echo [prompt] server stopped. press any key to close.
pause >nul
