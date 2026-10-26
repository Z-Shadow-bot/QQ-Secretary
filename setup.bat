@echo off
chcp 65001 >nul
title QQ群消息秘书 - 一键配置
cd /d "%~dp0"

echo ═══════════════════════════════════════
echo   QQ群消息秘书 - 一键配置
echo ═══════════════════════════════════════

echo.
echo [1/6] 检查 Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo   [X] 未找到 Node.js，请先安装 Node.js 18+
    echo       下载地址: https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do echo   [OK] Node.js %%i

echo.
echo [2/6] 检查 npm...
where npm >nul 2>nul
if errorlevel 1 (
    echo   [X] 未找到 npm
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version') do echo   [OK] npm %%i

echo.
echo [3/6] 检查 NapCat 连接 (localhost:3001)...
powershell -Command "try { $tcp = New-Object System.Net.Sockets.TcpClient; $tcp.Connect('127.0.0.1', 3001); $tcp.Close(); Write-Host '  [OK] NapCat 已运行' -ForegroundColor Green } catch { Write-Host '  [!] NapCat 未检测到，请确保已启动 NapCat 并配置 WebSocket 端口 3001' -ForegroundColor Yellow }"

echo.
echo [4/6] 安装项目依赖...
call npm install
if errorlevel 1 (
    echo   [X] 依赖安装失败
    pause
    exit /b 1
)
echo   [OK] 依赖安装完成

echo.
echo [5/6] 配置 Electron 原生模块...
call npm approve-scripts electron esbuild 2>nul
echo   [OK] Electron 配置完成

echo.
echo [6/6] 构建项目...
call npm run build
if errorlevel 1 (
    echo   [X] 构建失败
    pause
    exit /b 1
)
echo   [OK] 构建完成

echo.
echo ═══════════════════════════════════════
echo   配置完成！
echo ═══════════════════════════════════════
echo.
echo 如果尚未安装 NapCat:
echo   1. GitHub 搜索 NapCatQQ 并下载
echo   2. 以管理员身份运行 launcher.bat
echo   3. 登录 QQ 账号
echo   4. 在 WebUI (http://localhost:6099) 配置正向 WebSocket 端口 3001
echo.
echo 应用启动后，在「设置」中填写:
echo   - OneBot WebSocket 地址: ws://127.0.0.1:3001
echo   - LLM API 地址和 Key (默认 DeepSeek)
echo   - 目标群号 (留空则采集所有群)
echo.
echo 按任意键启动应用...
pause >nul

call npm run preview