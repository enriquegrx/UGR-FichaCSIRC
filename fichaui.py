#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fichaui.py - Utilidades de interfaz compartidas por la GUI de FichaCSIRC.

No depende del motor ni de la logica de negocio: solo Tkinter. Aqui viven las
piezas transversales (tooltips, ejecucion en hilo, rutas de recursos) para que
`registrar_gui.py` y `dialogos.py` no las dupliquen.
"""

import os
import sys
import threading
import tkinter as tk
from tkinter import ttk


def recurso(carpeta, nombre):
    """Ruta de un recurso (logo, icono), compatible con PyInstaller onefile."""
    base = getattr(sys, "_MEIPASS", "") or carpeta
    return os.path.join(base, nombre)


def carpeta_app():
    """Carpeta de la aplicacion (del .exe si esta empaquetada, o del script)."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def aplicar_estilo(root):
    """Tema base estable para Tk/ttk en las plataformas soportadas."""
    style = ttk.Style(root)
    if sys.platform == "darwin":
        # El tema aqua puede dejar widgets ttk sin pintar en algunos builds
        # empaquetados con PyInstaller/Tk. Clam es menos nativo, pero estable.
        preferidos = ("clam", "aqua")
    elif os.name == "nt":
        preferidos = ("vista", "xpnative", "clam")
    else:
        preferidos = ("clam", "default")
    disponibles = set(style.theme_names())
    for tema in preferidos:
        if tema in disponibles:
            try:
                style.theme_use(tema)
                break
            except tk.TclError:
                pass
    root.option_add("*Font", "TkDefaultFont")
    return style


def en_hilo(root, trabajo, al_terminar):
    """Ejecuta trabajo() en un hilo (sin tocar la UI) y llama a
    al_terminar(resultado, error) de vuelta en el hilo de la interfaz."""
    def _run():
        try:
            res, err = trabajo(), None
        except Exception as e:
            res, err = None, e
        try:
            root.after(0, al_terminar, res, err)
        except Exception:
            pass  # la ventana se cerro mientras trabajaba
    threading.Thread(target=_run, daemon=True).start()


class Tooltip:
    """Globo de ayuda simple al pasar el raton por un widget."""

    def __init__(self, widget, texto):
        self.widget, self.texto, self.tip = widget, texto, None
        widget.bind("<Enter>", self._mostrar)
        widget.bind("<Leave>", self._ocultar)

    def _mostrar(self, _e):
        if self.tip:
            return
        x = self.widget.winfo_rootx() + 10
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 4
        self.tip = tk.Toplevel(self.widget)
        self.tip.wm_overrideredirect(True)
        self.tip.wm_geometry(f"+{x}+{y}")
        tk.Label(self.tip, text=self.texto, bg="#ffffe0", relief="solid",
                 borderwidth=1, font=("Segoe UI", 9),
                 justify="left").pack(ipadx=5, ipady=2)

    def _ocultar(self, _e):
        if self.tip:
            self.tip.destroy()
            self.tip = None
