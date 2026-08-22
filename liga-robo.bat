@echo off
chcp 65001 >nul
title DuoLive - Robo de vendas (NAO FECHE - minimize)
rem ============================================================
rem  DuoLive - liga o robo de vendas com 2 cliques.
rem  - Coloque este arquivo na PASTA DO PROJETO (a que tem a pasta conector).
rem  - Se o robo cair por qualquer motivo, ele RELIGA sozinho em 15 segundos.
rem  - Para PARAR de verdade: feche esta janela.
rem ============================================================
cd /d "%~dp0conector"
:liga
echo.
echo  ============================================
echo   DuoLive - ligando o robo de vendas...
echo  ============================================
echo.
node robo-vendas.js
echo.
echo  ============================================
echo   O robo parou. Religando em 15 segundos...
echo   (feche esta janela se quiser parar de vez)
echo  ============================================
timeout /t 15 /nobreak >nul
goto liga
