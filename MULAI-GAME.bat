@echo off
title IMOS Ichiban Game Center
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js belum terpasang. Install dulu dari https://nodejs.org (versi LTS). & pause & exit /b)
if not exist node_modules (echo Memasang komponen pertama kali... & call npm install)
call npm start
pause
