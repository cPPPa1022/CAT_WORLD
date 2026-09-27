@echo off
setlocal
title AI traffic console - catworld
where node >nul 2>nul
if errorlevel 1 (
  echo [llm] Node.js not found in PATH.
  echo [llm] Install Node.js, then run this again.
  pause
  exit /b 1
)
echo [llm] starting AI traffic console...
echo [llm] a browser window will open. keep this window open.
echo [llm] note: traffic is IN-MEMORY only - restarting the simulator clears it.
echo.
node "%~dp0.dsh\tools\llm\llm-serve.mjs" %*
echo.
echo [llm] server stopped. press any key to close.
pause >nul
