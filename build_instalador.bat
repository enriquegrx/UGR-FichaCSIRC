@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Construir instalador FichaCSIRC

REM Necesita los .exe ya construidos (ejecuta antes build_exe.bat) e Inno Setup 6.
if not exist "dist\FichaCSIRC.exe" echo Falta dist\FichaCSIRC.exe. Ejecuta primero build_exe.bat.
if not exist "dist\FichaCSIRC.exe" pause
if not exist "dist\FichaCSIRC.exe" exit /b

set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"

if not defined ISCC echo No se encontro Inno Setup 6. Instalalo desde https://jrsoftware.org/isdl.php
if not defined ISCC pause
if not defined ISCC exit /b

"!ISCC!" instalador.iss
echo.
echo Instalador generado en: dist\FichaCSIRC-Instalador.exe
echo.
pause
