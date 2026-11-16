@echo off
title IMOS Game Center - ONLINE (Cloudflare Tunnel)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js belum terpasang. Install dulu dari https://nodejs.org ^(versi LTS^). & pause & exit /b)
if not exist cloudflare-token.txt (
  echo File cloudflare-token.txt belum ada.
  echo Ikuti panduan docs\online-cloudflare.md langkah 2, lalu simpan token tunnel di file cloudflare-token.txt
  pause & exit /b
)
set /p CF_TOKEN=<cloudflare-token.txt

set CFD=cloudflared
where cloudflared >nul 2>nul || (
  if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" (set CFD="%ProgramFiles(x86)%\cloudflared\cloudflared.exe") else if exist "%ProgramFiles%\cloudflared\cloudflared.exe" (set CFD="%ProgramFiles%\cloudflared\cloudflared.exe") else (
    echo Memasang cloudflared...
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
    set CFD="%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
  )
)

if not exist node_modules (echo Memasang komponen pertama kali... & call npm install)
start "IMOS Game Server" cmd /k npm start
echo.
echo Menyambungkan ke Cloudflare... biarkan kedua jendela ini tetap terbuka selama event.
%CFD% tunnel --no-autoupdate run --token %CF_TOKEN%
pause
