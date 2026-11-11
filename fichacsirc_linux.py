#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Arranque de FichaCSIRC en Linux (.deb y AppImage).

En Linux la ventana la dibuja WebKitGTK, que NO va dentro del paquete: depende
de programas auxiliares en rutas fijas del sistema y empaquetado se rompe. Asi
que se usan el Python, PyGObject y WebKitGTK del propio sistema (vienen con
Ubuntu de escritorio; el .deb los declara como dependencias) y aqui solo van la
app y sus librerias de Python puras (carpeta vendor/).

Si falta WebKitGTK (p. ej. el AppImage en un sistema sin el), se dice que
instalar en vez de cerrarse sin mas.
"""

import os
import shutil
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "vendor"))
sys.path.insert(0, AQUI)

COMO_INSTALAR = ("Para abrir FichaCSIRC hace falta WebKitGTK. En Ubuntu o Debian:\n\n"
                 "    sudo apt install python3-gi gir1.2-webkit2-4.1\n\n"
                 "En Fedora:\n\n    sudo dnf install python3-gobject webkit2gtk4.1")


def falta_webkit():
    """Texto del problema si no se puede usar WebKitGTK, o None si todo bien."""
    try:
        import gi
    except ImportError:
        return "Falta PyGObject (python3-gi)."
    for v in ("4.1", "4.0"):
        try:
            gi.require_version("WebKit2", v)
            gi.require_version("Gtk", "3.0")
            from gi.repository import Gtk, WebKit2  # noqa: F401
            return None
        except (ValueError, ImportError):
            continue
    return "Falta WebKitGTK (gir1.2-webkit2-4.1)."


def avisar(motivo):
    texto = f"{motivo}\n\n{COMO_INSTALAR}"
    print(texto, file=sys.stderr)
    for cmd in (["zenity", "--error", "--title=FichaCSIRC", "--no-wrap", f"--text={texto}"],
                ["kdialog", "--title", "FichaCSIRC", "--error", texto],
                ["notify-send", "FichaCSIRC", texto]):
        if shutil.which(cmd[0]):
            subprocess.run(cmd, check=False)
            return


def main():
    motivo = falta_webkit()
    if motivo:
        avisar(motivo)
        sys.exit(1)
    import registrar_web
    registrar_web.main()


if __name__ == "__main__":
    main()
