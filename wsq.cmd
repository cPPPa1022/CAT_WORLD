@echo off
setlocal
title wsq query console
where node >nul 2>nul
if errorlevel 1 (
  echo [wsq] Node.js not found in PATH.
  echo [wsq] Install Node.js, then run this again.
  pause
  exit /b 1
)
echo [wsq] starting query console...
echo [wsq] a browser window will open. keep this window open.
echo.
node "%~dp0.dsh\tools\wsq\wsq-serve.mjs" %*
echo.
echo [wsq] server stopped. press any key to close.
pause >nul
