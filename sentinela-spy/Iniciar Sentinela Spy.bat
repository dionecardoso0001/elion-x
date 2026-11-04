@echo off
chcp 65001 >nul
title SENTINELA SPY
cd /d "%~dp0"
echo.
echo   ============================================
echo     SENTINELA SPY  -  inteligencia de video
echo     http://localhost:4040
echo   ============================================
echo.
where node >nul 2>nul || (echo   Node.js nao encontrado. Instale a versao LTS em nodejs.org e rode de novo. & goto fim)
if not exist node_modules (
  echo   Instalando dependencias ^(primeira vez^)...
  call npm ci --no-audit --no-fund || goto erro
)
if not exist plataforma.json (
  echo   Preparando runtime de visao, SDK e modelos ^(primeira vez, ~30 MB^)...
  call npm run preparar || goto erro
)
if not exist .env echo   [dica] sem .env: o agente pedira a chave da API no navegador. Veja .env.example.
echo.
echo   Mantenha esta janela aberta. Para desligar, feche-a.
echo.
start "" http://localhost:4040
node server.mjs
goto fim
:erro
echo.
echo   A preparacao falhou. A mensagem acima diz o motivo.
:fim
echo.
pause
