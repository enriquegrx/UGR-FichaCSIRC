@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title FichaCSIRC - Configurar

set "PYEXE="
for /d %%D in ("%LocalAppData%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"
if not defined PYEXE for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"
if not defined PYEXE for /d %%D in ("%LocalAppData%\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"

if not defined PYEXE echo No se ha encontrado Python. Se instalara con winget (acepta permisos)...
if not defined PYEXE winget install -e --id Python.Python.3.12 --scope user --accept-source-agreements --accept-package-agreements
if not defined PYEXE echo.
if not defined PYEXE echo Cuando termine, CIERRA esta ventana y vuelve a ejecutar este archivo.
if not defined PYEXE pause
if not defined PYEXE exit /b

echo Preparando FichaCSIRC...
"!PYEXE!" -m pip install --quiet requests
set "PYWEXE=!PYEXE:python.exe=pythonw.exe!"
start "" "!PYWEXE!" "configurar_gui.py"
exit /b
