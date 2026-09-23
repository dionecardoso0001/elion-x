@echo off
chcp 65001 >nul
title E-L-I-O-N X  -  Acesso Mobile (tunel HTTPS)
cd /d "%~dp0"
echo.
echo   Preparando o acesso do ELION-X pelo smartphone...
echo.
node scripts\mobile.mjs
echo.
echo   Tunel encerrado. Feche esta janela.
pause
