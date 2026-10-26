@echo off
chcp 65001 >nul
title QQ群消息秘书 - 开发模式
cd /d "%~dp0"
echo 开发模式启动中 (支持热更新)...
call npm run dev