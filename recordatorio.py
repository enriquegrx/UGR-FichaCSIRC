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
import re
import sys
import html
import plistlib
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
                      f"{core._fmt(reg)} de {core._fmt(obj)}")
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


def _recordar_ejecutable(ruta=None):
    """Anota en config a que ejecutable apunta el aviso (ver reparar)."""
    try:
        core.guardar_config_valor("recordatorio_ejecutable",
                                  sys.executable if ruta is None else ruta)
    except Exception:
        pass


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
        _recordar_ejecutable()
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
    _recordar_ejecutable()


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


# ----------------------- reparacion -----------------------

def _decodificar(datos):
    """Salida de schtasks /xml. Redirigida sale en la codificacion de la
    consola (comprobado), pero se acepta tambien UTF-16. De aqui solo se usa
    con fiabilidad la HORA (ASCII); la ruta puede llegar con las tildes mal."""
    if datos.startswith((b"\xff\xfe", b"\xfe\xff")):
        return datos.decode("utf-16", errors="replace")
    if b"\x00" in datos[:200]:
        return datos.decode("utf-16-le", errors="replace")
    return datos.decode("utf-8", errors="replace")


def _programado_windows():
    """(hora 'HH:MM', ejecutable) de la tarea programada, o None si no hay."""
    r = subprocess.run(["schtasks", "/query", "/tn", TASK_NAME, "/xml"],
                       capture_output=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        return None
    xml = _decodificar(r.stdout or b"")
    cmd = re.search(r"<Command>(.*?)</Command>", xml, re.S)
    hora = re.search(r"<StartBoundary>[^<]*?T(\d{2}):(\d{2})", xml)
    if not (cmd and hora):
        return None
    return (f"{hora.group(1)}:{hora.group(2)}",
            html.unescape(cmd.group(1)).strip().strip('"'))


def _programado_mac():
    """(hora 'HH:MM', ejecutable) del LaunchAgent, o None si no hay."""
    ruta = _plist_path()
    if not os.path.exists(ruta):
        return None
    with open(ruta, "rb") as f:
        d = plistlib.load(f)
    args = d.get("ProgramArguments") or []
    ivs = d.get("StartCalendarInterval") or []
    if isinstance(ivs, dict):
        ivs = [ivs]
    if not args or not ivs:
        return None
    return (f"{int(ivs[0].get('Hour', 16)):02d}:{int(ivs[0].get('Minute', 0)):02d}",
            args[0])


def reparar_recordatorio():
    """Si el aviso diario apunta a un ejecutable que ya no es este, lo
    reprograma a la misma hora. Devuelve True si lo ha reparado.

    La tarea guarda la RUTA del ejecutable al activarse. Al pasar de --onefile a
    --onedir (2.6.4) el .exe se movio a {app}\\FichaCSIRC\\ y el instalador borra
    el viejo: a quien lo tuviera activo el aviso dejo de saltar sin dar error.
    En Mac pasa igual si se activo desde una copia en Descargas que luego se
    borra. Se llama al arrancar la app."""
    if not getattr(sys, "frozen", False):
        return False
    # Camino rapido: la ruta que se programo la ultima vez se guarda en config
    # (sin depender de como codifique schtasks las tildes de la ruta).
    if core.config_valor("recordatorio_ejecutable") == sys.executable:
        return False
    try:
        if sys.platform == "darwin":
            # Desde una copia temporal (dmg, Descargas sin mover) no se fija
            # la ruta: seria peor que la que hay.
            if core.fuera_de_aplicaciones():
                return False
            prog = _programado_mac()
        elif os.name == "nt":
            prog = _programado_windows()
        else:
            return False
    except Exception:
        return False
    if not prog:
        return False
    hora, ejecutable = prog

    def _norm(ruta):
        return os.path.normcase(os.path.abspath(ruta))

    if _norm(ejecutable) == _norm(sys.executable):
        _recordar_ejecutable()            # ya estaba bien: solo anotarlo
        return False
    try:
        activar_recordatorio(hora)
    except Exception as e:
        core.LOG.warning("No se pudo reprogramar el aviso diario: %s", e)
        return False
    core.LOG.info("Aviso diario reprogramado a las %s (apuntaba a %s)", hora, ejecutable)
    return True


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
