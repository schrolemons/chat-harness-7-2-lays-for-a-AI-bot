@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0remove-chat-bridge-data.ps1"
set "CHAT_BRIDGE_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %CHAT_BRIDGE_EXIT%
