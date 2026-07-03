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
import tkinter.font as tkfont
from tkinter import ttk


COLOR_APP_BG = "#f4f6f8"
COLOR_PANEL = "#ffffff"
COLOR_PANEL_ALT = "#eef2f6"
COLOR_BORDER = "#d7dce2"
COLOR_TEXT = "#1f2933"
COLOR_MUTED = "#64707d"
COLOR_PRIMARY = "#0b66c3"
COLOR_PRIMARY_DARK = "#084f96"
COLOR_SUCCESS = "#248a46"
COLOR_WARNING = "#b7791f"
COLOR_DANGER = "#b42318"
COLOR_SELECTED = "#e8f3ff"


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
        # Aqua solo es fiable si el build usa un Tk moderno. build_macos.sh ya
        # rechaza Tk < 8.6 para evitar la ventana en blanco vista con Tk 8.5.
        preferidos = ("aqua", "clam") if tk.TkVersion >= 8.6 else ("clam",)
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

    root.configure(bg=COLOR_APP_BG)
    root.option_add("*Font", "TkDefaultFont")
    root.option_add("*Background", COLOR_APP_BG)

    try:
        tkfont.nametofont("TkDefaultFont").configure(size=10)
        tkfont.nametofont("TkTextFont").configure(size=10)
        tkfont.nametofont("TkHeadingFont").configure(size=10, weight="bold")
    except tk.TclError:
        pass

    style.configure(".", font=("TkDefaultFont", 10))
    style.configure("TFrame", background=COLOR_APP_BG)
    style.configure("Header.TFrame", background=COLOR_PANEL)
    style.configure("Panel.TFrame", background=COLOR_PANEL, relief="flat")
    style.configure("Subtle.TFrame", background=COLOR_PANEL_ALT)
    style.configure("TLabel", background=COLOR_APP_BG, foreground=COLOR_TEXT)
    style.configure("Header.TLabel", background=COLOR_PANEL, foreground=COLOR_TEXT)
    style.configure("Title.TLabel", background=COLOR_PANEL, foreground=COLOR_TEXT,
                    font=("TkDefaultFont", 18, "bold"))
    style.configure("Subtitle.TLabel", background=COLOR_PANEL, foreground=COLOR_MUTED,
                    font=("TkDefaultFont", 11))
    style.configure("Section.TLabel", background=COLOR_PANEL, foreground=COLOR_TEXT,
                    font=("TkDefaultFont", 11, "bold"))
    style.configure("Muted.TLabel", background=COLOR_APP_BG, foreground=COLOR_MUTED)
    style.configure("Status.TLabel", background=COLOR_PANEL_ALT, foreground=COLOR_MUTED,
                    padding=(8, 5))
    style.configure("TButton", padding=(12, 7))
    style.configure("Primary.TButton", padding=(14, 8), foreground="white",
                    background=COLOR_PRIMARY)
    style.map("Primary.TButton",
              background=[("active", COLOR_PRIMARY_DARK), ("pressed", COLOR_PRIMARY_DARK)])
    style.configure("Danger.TButton", padding=(12, 7), foreground=COLOR_DANGER)
    style.configure("Treeview", rowheight=28, background=COLOR_PANEL,
                    fieldbackground=COLOR_PANEL, borderwidth=0)
    style.configure("Treeview.Heading", padding=(8, 6),
                    font=("TkDefaultFont", 10, "bold"))
    style.map("Treeview", background=[("selected", COLOR_SELECTED)],
              foreground=[("selected", COLOR_TEXT)])
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
