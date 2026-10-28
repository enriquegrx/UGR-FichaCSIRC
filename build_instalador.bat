@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Construir instalador FichaCSIRC

REM Necesita la app ya construida (ejecuta antes build_exe.bat) e Inno Setup 6.
REM Desde 2.6.4 la app es una CARPETA: dist\FichaCSIRC\FichaCSIRC.exe (+ _internal).
if not exist "dist\FichaCSIRC\FichaCSIRC.exe" echo Falta dist\FichaCSIRC\FichaCSIRC.exe. Ejecuta primero build_exe.bat.
if not exist "dist\FichaCSIRC\FichaCSIRC.exe" pause
if not exist "dist\FichaCSIRC\FichaCSIRC.exe" exit /b

set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"

if not defined ISCC echo No se encontro Inno Setup 6. Instalalo desde https://jrsoftware.org/isdl.php
if not defined ISCC pause
if not defined ISCC exit /b

REM La version sale del codigo (VERSION = "x.y.z" en rellenar_horas.py), como en
REM la release: sin pasarla, el instalador se quedaba con la de por defecto.
set "VER="
for /f "tokens=2 delims==" %%V in ('findstr /b /c:"VERSION = " rellenar_horas.py') do set "VER=%%V"
set "VER=!VER: =!"
set "VER=!VER:"=!"

"!ISCC!" /DMyAppVersion=!VER! instalador.iss
echo.
echo Instalador !VER! generado en: dist\FichaCSIRC-Instalador.exe
echo.
pause
