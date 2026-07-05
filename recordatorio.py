#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
recordatorio.py - Aviso de horas pendientes de fichar en FichaCSIRC.

Dos usos:
  1) Como comprobacion suelta (la lanza la tarea programada):
         pythonw recordatorio.py         (o  FichaCSIRC.exe --recordatorio)
     Mira la semana en curso y, SOLO si te faltan horas, muestra un aviso con
     opcion de abrir la aplicacion. Si no hay nada pendiente, no molesta.
  2) Como modulo: la app lo usa para activar/desactivar el aviso diario.
     En Windows se programa con el Programador de tareas (schtasks); en macOS
     con un LaunchAgent de usuario (launchd).

El aviso diario es opcional y por-usuario; no requiere permisos de administrador.
"""

import os
import sys
import subprocess
import datetime as dt

import rellenar_horas as core

TASK_NAME = "FichaCSIRC-Recordatorio"
LAUNCHD_LABEL = "es.ugr.fichacsirc.recordatorio"
# El aviso se autocierra pasado este tiempo: si nadie lo atiende, el proceso
# no puede quedarse vivo dias bloqueando FichaCSIRC.exe (impedia actualizar
# y desinstalar la aplicacion).
AVISO_TIMEOUT_MIN = 10


def recordatorios_soportados():
    """Windows (schtasks) y macOS (launchd)."""
    return os.name == "nt" or sys.platform == "darwin"


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


# ----------------------- programacion (schtasks / launchd) -----------------------

def _comando_recordatorio():
    """Comando que la tarea programada debe ejecutar segun sea .exe o script."""
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --recordatorio'
    py = sys.executable  # python.exe / pythonw.exe del interprete actual
    pyw = py.replace("python.exe", "pythonw.exe")
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recordatorio.py")
    return f'"{pyw}" "{script}"'


def _argv_recordatorio():
    """Argumentos (lista) del aviso, para el plist de launchd en macOS."""
    if getattr(sys, "frozen", False):
        return [sys.executable, "--recordatorio"]
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recordatorio.py")
    return [sys.executable, script]


def _plist_path():
    return os.path.expanduser(f"~/Library/LaunchAgents/{LAUNCHD_LABEL}.plist")


def _plist_contenido(hora):
    h, m = (int(x) for x in hora.split(":"))
    args = "\n".join(f"        <string>{a}</string>" for a in _argv_recordatorio())
    dias = "\n".join(
        "        <dict>\n"
        f"            <key>Weekday</key><integer>{wd}</integer>\n"
        f"            <key>Hour</key><integer>{h}</integer>\n"
        f"            <key>Minute</key><integer>{m}</integer>\n"
        "        </dict>" for wd in range(1, 6))  # 1=lunes ... 5=viernes
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
 "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>{LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
{args}
    </array>
    <key>StartCalendarInterval</key>
    <array>
{dias}
    </array>
</dict>
</plist>
"""


def recordatorio_activo():
    if sys.platform == "darwin":
        return os.path.exists(_plist_path())
    if os.name != "nt":
        return False
    try:
        r = subprocess.run(["schtasks", "/query", "/tn", TASK_NAME],
                           capture_output=True, text=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return r.returncode == 0
    except Exception:
        return False


def activar_recordatorio(hora="16:00"):
    """Programa el aviso (lun-vie a la hora indicada) en Windows o macOS."""
    if sys.platform == "darwin":
        ruta = _plist_path()
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
        with open(ruta, "w", encoding="utf-8") as f:
            f.write(_plist_contenido(hora))
        subprocess.run(["launchctl", "unload", ruta], capture_output=True)
        r = subprocess.run(["launchctl", "load", ruta],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout or "").strip()
                               or "launchctl fallo")
        core.LOG.info("Recordatorio diario (launchd) activado a las %s", hora)
        return
    if os.name != "nt":
        raise RuntimeError("El aviso diario automatico solo esta disponible "
                           "en Windows y macOS.")
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
    if sys.platform == "darwin":
        ruta = _plist_path()
        subprocess.run(["launchctl", "unload", ruta], capture_output=True)
        try:
            os.remove(ruta)
        except FileNotFoundError:
            pass
        core.LOG.info("Recordatorio diario (launchd) desactivado")
        return
    if os.name != "nt":
        raise RuntimeError("El aviso diario automatico solo esta disponible "
                           "en Windows y macOS.")
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
    from tkinter import ttk
    # Ventana propia (no un messagebox): sale en primer plano, aparece en la
    # barra de tareas y se autocierra sola. El messagebox anterior podia quedar
    # oculto tras otras ventanas y dejaba el proceso vivo indefinidamente.
    root = tk.Tk()
    root.title("FichaCSIRC - Recordatorio")
    root.resizable(False, False)
    try:
        ico = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "fichacsirc.ico")
        if os.path.exists(ico):
            root.iconbitmap(ico)
    except Exception:
        pass

    frm = ttk.Frame(root, padding=16)
    frm.pack(fill="both", expand=True)
    ttk.Label(frm, text=mensaje_pendientes(pendientes),
              justify="left").pack(anchor="w")
    ttk.Label(frm, text="¿Abrir FichaCSIRC para fichar ahora?",
              justify="left").pack(anchor="w", pady=(10, 0))

    resultado = {"abrir": False}

    def responder(abrir):
        resultado["abrir"] = abrir
        root.destroy()

    btns = ttk.Frame(frm)
    btns.pack(fill="x", pady=(14, 0))
    ttk.Button(btns, text="Abrir FichaCSIRC",
               command=lambda: responder(True)).pack(side="right")
    ttk.Button(btns, text="Ahora no",
               command=lambda: responder(False)).pack(side="right", padx=(0, 8))
    root.protocol("WM_DELETE_WINDOW", lambda: responder(False))
    root.bind("<Return>", lambda _e: responder(True))
    root.bind("<Escape>", lambda _e: responder(False))

    root.update_idletasks()
    try:
        root.eval("tk::PlaceWindow . center")
    except tk.TclError:
        pass
    root.attributes("-topmost", True)
    root.after(AVISO_TIMEOUT_MIN * 60 * 1000, root.destroy)  # autocierre
    root.mainloop()
    if resultado["abrir"]:
        _abrir_app()


if __name__ == "__main__":
    main()
