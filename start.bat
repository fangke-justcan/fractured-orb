@echo off
rem 双击启动 Fractured Orb 本地副本
cd /d "%~dp0"
start "fractured-orb server" cmd /c "node server.js 8942"
timeout /t 1 /nobreak >nul
start "" http://localhost:8942/
