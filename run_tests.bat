@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Tests FichaCSIRC

set "PYEXE="
for /d %%D in ("%LocalAppData%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"
if not defined PYEXE for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"

if not defined PYEXE echo No hay Python instalado. Ejecuta primero "FichaCSIRC - Configurar.bat".
if not defined PYEXE pause
if not defined PYEXE exit /b

"!PYEXE!" -m unittest discover -s tests -t . -v
echo.
pause
