@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Construir FichaCSIRC

set "PYEXE="
for /d %%D in ("%LocalAppData%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"
if not defined PYEXE for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"

if not defined PYEXE echo No hay Python 3 instalado (hace falta para compilar).
if not defined PYEXE pause
if not defined PYEXE exit /b

echo Instalando PyInstaller, requests y pywebview (puede tardar la primera vez)...
"!PYEXE!" -m pip install --quiet --upgrade pip
"!PYEXE!" -m pip install --quiet -r requirements-web.txt pyinstaller==6.21.0

echo.
echo Construyendo FichaCSIRC (interfaz web, con el asistente dentro)...
"!PYEXE!" -m PyInstaller --noconfirm --clean --onedir --windowed --noupx --name "FichaCSIRC" --icon "fichacsirc.ico" --version-file "version_info.txt" --add-data "web;web" --add-data "logo_ugr.png;." --add-data "fichacsirc.ico;." --add-data "NOVEDADES.md;." --add-data "TECNOLOGIA.md;." --hidden-import pystray._win32 registrar_web.py

echo.
echo ============================================================
echo   Listo. La app es una CARPETA (el .exe + su _internal):
echo     dist\FichaCSIRC\FichaCSIRC.exe
echo   OJO: el .exe necesita su carpeta _internal al lado (no lo muevas solo).
echo   La configuracion se guarda en:  %%APPDATA%%\FichaCSIRC
echo   La primera vez abre solo el asistente; despues: FichaCSIRC.exe --configurar
echo   Para el instalador: build_instalador.bat
echo ============================================================
echo.
pause
