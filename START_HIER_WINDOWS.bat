@echo off
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte Node.js 18 oder neuer installieren und diese Datei danach erneut starten.
  pause
  exit /b 1
)
start "Gelber Zwerg Server" cmd /k "cd /d %~dp0 && node server.js"
timeout /t 1 /nobreak >nul
start "" http://localhost:3000
echo Gelber Zwerg wurde im Browser geoeffnet.
echo Dieses Fenster kannst du schliessen. Das Server-Fenster muss waehrend des Spiels offen bleiben.
pause
