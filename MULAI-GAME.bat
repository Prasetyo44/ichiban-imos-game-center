@echo off
title IMOS Ichiban Game Center
cd /d "%~dp0"
echo.
echo  === IMOS Ichiban Game Center ===
echo  Folder: %CD%
echo.

if not exist "server.js" goto nofolder

where node >nul 2>nul
if errorlevel 1 goto nonode

for /f "delims=" %%v in ('node -v') do echo  Node.js %%v terpasang.

if exist "node_modules\express" goto run
echo  Memasang komponen pertama kali (butuh internet, sekitar 1 menit)...
call npm install --no-audit --no-fund
if errorlevel 1 goto npmfail

:run
echo.
echo  Menjalankan server game... JANGAN tutup jendela ini selama game dipakai.
echo.
node server.js
echo.
echo  Server berhenti. Kalau ada pesan error di atas, foto layar ini dan kirim ke panitia IT.
pause
exit /b

:nofolder
echo  File server.js tidak ditemukan di folder ini.
echo  Pastikan zip sudah DIEKSTRAK dulu (klik kanan zip, pilih "Extract All"),
echo  lalu jalankan MULAI-GAME.bat dari folder hasil ekstrak.
pause
exit /b

:nonode
echo  Node.js belum terpasang atau belum terbaca.
echo  Install versi LTS dari https://nodejs.org lalu restart laptop.
pause
exit /b

:npmfail
echo.
echo  Gagal memasang komponen. Pastikan laptop terhubung ke internet, lalu coba lagi.
pause
exit /b
