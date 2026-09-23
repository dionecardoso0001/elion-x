@echo off
chcp 65001 >nul
title E-L-I-O-N X  -  AI Command Center
cd /d "%~dp0"
echo.
echo   ============================================
echo     E-L-I-O-N  X   -   AI COMMAND CENTER
echo     http://localhost:3001
echo   ============================================
echo.

rem  Se o ELION ja estiver no ar, apenas abre o navegador (evita erro de porta em uso)
powershell -NoProfile -Command "try{ Invoke-WebRequest http://localhost:3001/api/status -UseBasicParsing -TimeoutSec 2 ^| Out-Null; exit 0 }catch{ exit 1 }"
if %errorlevel%==0 (
  echo   ELION-X ja esta em execucao. Abrindo o navegador...
  start "" http://localhost:3001
  timeout /t 2 >nul
  exit /b
)

rem  ── MODO NASA: sobe o SIGNAL-X (rastreio de antenas) numa janela propria ──
rem  O ELION tambem sabe inicia-lo sozinho ao varrer, mas subir aqui deixa o
rem  console NASA pronto desde o primeiro clique, sem os segundos de compilacao.
if not defined SIGNALX_DIR set "SIGNALX_DIR=C:\SIGNAL-X"
if exist "%SIGNALX_DIR%\package.json" (
  powershell -NoProfile -Command "try{ Invoke-WebRequest http://localhost:4477/api/health -UseBasicParsing -TimeoutSec 2 ^| Out-Null; exit 0 }catch{ exit 1 }"
  if errorlevel 1 (
    echo   Iniciando SIGNAL-X ^(rastreio de antenas^) em %SIGNALX_DIR%...
    start "SIGNAL-X - Rastreio de Espectro" /min cmd /c "cd /d ""%SIGNALX_DIR%"" && npm run dev"
  ) else (
    echo   SIGNAL-X ja esta em execucao.
  )
) else (
  echo   [aviso] SIGNAL-X nao encontrado em %SIGNALX_DIR% - o modo NASA ficara indisponivel.
)
echo.

echo   Iniciando o nucleo neural... mantenha esta janela aberta.
echo   ^(Para desligar o ELION-X, basta fechar esta janela.^)
echo.
start "" http://localhost:3001
node server.js

echo.
echo   O servidor foi encerrado. Se houve erro, ele aparece acima.
pause
