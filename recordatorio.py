#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
recordatorio.py - Aviso de horas pendientes de fichar en FichaCSIRC.

Dos usos:
  1) Como comprobacion suelta (lo lanza la tarea programada de Windows):
         pythonw recordatorio.py         (o  FichaCSIRC.exe --recordatorio)
     Mira la semana en curso y, SOLO si te faltan horas, muestra un aviso con
     opcion de abrir la aplicacion. Si no hay nada pendiente, no molesta.
  2) Como modulo: la app lo usa para activar/desactivar el aviso diario, que se
     programa con el Programador de tareas de Windows (schtasks).

El aviso diario es opcional y por-usuario; no requiere permisos de administrador.
"""

import os
import sys
import subprocess
import datetime as dt

import rellenar_horas as core

TASK_NAME = "FichaCSIRC-Recordatorio"


# ----------------------- mensaje -----------------------

def mensaje_pendientes(pendientes):
    """Texto amable a partir de la lista (dia, registrado, objetivo)."""
    if not pendientes:
        return ""
    total = sum(obj - reg for _d, reg, obj in pendientes)
    lineas = [f"Te faltan horas por fichar esta semana ({core._fmt(total)} en total):", ""]
    for d, reg, obj in pendientes:
        lineas.append(f"  {core.DIAS_ES[d.weekday()]} {d.strftime('%d/%m')}: "
                      f"{core._fmt(reg)} de {obj}h")
    return "\n".join(lineas)


# ----------------------- programacion (schtasks) -----------------------

def _comando_recordatorio():
    """Comando que la tarea programada debe ejecutar segun sea .exe o script."""
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --recordatorio'
    py = sys.executable  # python.exe / pythonw.exe del interprete actual
    pyw = py.replace("python.exe", "pythonw.exe")
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recordatorio.py")
    return f'"{pyw}" "{script}"'


def recordatorio_activo():
    try:
        r = subprocess.run(["schtasks", "/query", "/tn", TASK_NAME],
                           capture_output=True, text=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return r.returncode == 0
    except Exception:
        return False


def activar_recordatorio(hora="16:00"):
    """Crea/actualiza la tarea programada (lun-vie a la hora indicada)."""
    cmd = ["schtasks", "/create", "/tn", TASK_NAME,
           "/tr", _comando_recordatorio(),
           "/sc", "weekly", "/d", "MON,TUE,WED,THU,FRI",
           "/st", hora, "/f"]
    r = subprocess.run(cmd, capture_output=True, text=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "").strip() or "schtasks fallo")
    core.LOG.info("Recordatorio diario activado a las %s", hora)


def desactivar_recordatorio():
    r = subprocess.run(["schtasks", "/delete", "/tn", TASK_NAME, "/f"],
                       capture_output=True, text=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0 and "no existe" not in (r.stderr or r.stdout or "").lower():
        raise RuntimeError((r.stderr or r.stdout or "").strip() or "schtasks fallo")
    core.LOG.info("Recordatorio diario desactivado")


# ----------------------- ejecucion suelta -----------------------

def _abrir_app():
    """Lanza la aplicacion de registro (segun sea .exe o script)."""
    try:
        if getattr(sys, "frozen", False):
            subprocess.Popen([sys.executable])
        else:
            carpeta = os.path.dirname(os.path.abspath(__file__))
            py = sys.executable.replace("python.exe", "pythonw.exe")
            subprocess.Popen([py, os.path.join(carpeta, "registrar_gui.py")])
    except Exception:
        pass


def main():
    pendientes = core.dias_pendientes_semana()
    if not pendientes:
        return  # nada que fichar (o sin conexion): salir en silencio
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk()
    root.withdraw()
    try:
        ico = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "fichacsirc.ico")
        if os.path.exists(ico):
            root.iconbitmap(ico)
    except Exception:
        pass
    if messagebox.askyesno("FichaCSIRC - Recordatorio",
                           mensaje_pendientes(pendientes)
                           + "\n\n¿Abrir FichaCSIRC para fichar ahora?"):
        _abrir_app()
    root.destroy()


if __name__ == "__main__":
    main()
