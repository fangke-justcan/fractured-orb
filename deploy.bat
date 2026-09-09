@echo off
rem 一键公网部署: 启动本地服务器 + pinggy 免费隧道(60分钟有效)
rem 关闭弹出的两个窗口即停止部署
cd /d "%~dp0"

echo [1/2] 启动本地服务器 (端口 8942)...
start "fractured-orb server" cmd /c "node server.js 8942"

timeout /t 1 /nobreak >nul
echo [2/2] 启动公网隧道, 稍等几秒会在新窗口显示 https://xxxx.free.pinggy.net 链接...
echo       把那个链接发给朋友即可 (免费隧道有效期 60 分钟)
start "pinggy tunnel" cmd /k "ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -p 443 -R0:localhost:8942 free.pinggy.io"

timeout /t 2 /nobreak >nul
start "" http://localhost:8942/
echo 完成! 本地预览已在浏览器打开, 公网链接在 "pinggy tunnel" 窗口里。
pause
