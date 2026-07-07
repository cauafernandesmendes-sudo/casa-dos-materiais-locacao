@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale o Node.js 22.5 ou superior.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias...
  call npm.cmd install
  if errorlevel 1 (
    echo Nao foi possivel instalar as dependencias.
    pause
    exit /b 1
  )
)
echo Iniciando Casa dos materiais...
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000/index.html?v=46"
call npm.cmd start
pause
