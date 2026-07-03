@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Construir FichaCSIRC.exe

set "PYEXE="
for /d %%D in ("%LocalAppData%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"
if not defined PYEXE for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"

if not defined PYEXE echo No hay Python instalado. Ejecuta primero "FichaCSIRC - Configurar.bat".
if not defined PYEXE pause
if not defined PYEXE exit /b

echo Instalando PyInstaller y requests (puede tardar la primera vez)...
"!PYEXE!" -m pip install --quiet --upgrade pip pyinstaller requests

echo.
echo Construyendo la app de registro (FichaCSIRC)...
"!PYEXE!" -m PyInstaller --noconfirm --clean --onefile --windowed --name "FichaCSIRC" --icon "fichacsirc.ico" --version-file "version_info.txt" --add-data "logo_ugr.png;." --add-data "fichacsirc.ico;." registrar_gui.py

echo.
echo Construyendo el configurador (FichaCSIRC-Configurar)...
"!PYEXE!" -m PyInstaller --noconfirm --clean --onefile --windowed --name "FichaCSIRC-Configurar" --icon "fichacsirc.ico" --version-file "version_info.txt" --add-data "logo_ugr.png;." --add-data "fichacsirc.ico;." configurar_gui.py

echo.
echo ============================================================
echo   Listo. Tienes las apps (un solo .exe cada una) en:
echo     dist\FichaCSIRC.exe             (registrar)
echo     dist\FichaCSIRC-Configurar.exe  (configurar)
echo   La configuracion se guarda en:  %%APPDATA%%\FichaCSIRC
echo   Ejecuta primero el configurador y luego la app.
echo ============================================================
echo.
pause
