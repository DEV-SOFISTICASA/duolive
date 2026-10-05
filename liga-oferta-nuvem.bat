@echo off
chcp 65001 >nul
title DuoLive - Oferta Relampago (sempre da NUVEM)
rem ============================================================
rem  DuoLive - liga o robo da OFERTA RELAMPAGO puxando a versao
rem  MAIS NOVA direto da nuvem (o conector). Funciona em QUALQUER
rem  PC, sem copiar arquivo na mao - todos ficam sempre iguais.
rem
rem  - Coloque este arquivo na PASTA DO PROJETO (a que tem a pasta conector).
rem  - A cada vez que liga (e se cair e religar), ele RE-BAIXA da nuvem.
rem  - Para PARAR de verdade: feche esta janela.
rem ============================================================
cd /d "%~dp0conector"
:liga
echo.
echo  ====================================================
echo    DuoLive - Oferta Relampago: atualizando da nuvem...
echo  ====================================================
node baixa-oferta.js
echo.
echo    Ligando o robo (ele abre a janela do TikTok)...
echo.
node robo-oferta-relampago.js --rodadas
echo.
echo  ====================================================
echo    O robo parou. Religando (e re-baixando da nuvem)
echo    em 15 segundos... (feche a janela para parar de vez)
echo  ====================================================
timeout /t 15 /nobreak >nul
goto liga
