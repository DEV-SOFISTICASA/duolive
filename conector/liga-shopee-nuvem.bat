@echo off
chcp 65001 >nul
cd /d "%~dp0"
set LOJA=%1
if not "%LOJA%"=="" goto rodaloja

rem ============================================================
rem  DuoLive - Shopee SEMPRE DA NUVEM (Monaco + Bellini).
rem  Baixa a versao mais nova do robo da Shopee do conector e sobe as 2 lojas.
rem  Funciona em QUALQUER PC, sem copiar arquivo na mao.
rem  Pra ATUALIZAR da nuvem: feche tudo e rode este atalho de novo.
rem ============================================================
title DuoLive - Shopee da NUVEM: Monaco + Bellini
echo.
echo  ====================================================
echo    DuoLive - Shopee (sempre da NUVEM): baixando robo...
echo  ====================================================
node baixa-shopee.js
echo.
echo    Subindo Monaco + Bellini (2 janelinhas - pode minimizar)...
start "DuoLive Shopee Monaco"  "%~f0" monaco
start "DuoLive Shopee Bellini" "%~f0" bellini
echo.
echo    Prontas! Pode FECHAR esta janela (as outras 2 seguem rodando).
timeout /t 6 >nul
goto fim

:rodaloja
title DuoLive - Shopee NUVEM - %LOJA%
set DUOLIVE_SHOPEE_HEADLESS=1
:liga
echo.
echo  ============================================
echo   DuoLive - Shopee (nuvem) - %LOJA%
echo  ============================================
node robo-shopee-live.js %LOJA%
echo.
echo  O robo parou. Religando em 15s... (feche a janela pra parar)
timeout /t 15 /nobreak >nul
goto liga

:fim
