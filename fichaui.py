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


COLOR_APP_BG = "#e9edf2"   # gris con cuerpo: los paneles blancos se leen como tarjetas
COLOR_PANEL = "#ffffff"
COLOR_PANEL_ALT = "#dfe5ec"
COLOR_BORDER = "#d7dce2"
COLOR_TEXT = "#1f2933"
COLOR_MUTED = "#64707d"
COLOR_PRIMARY = "#0b66c3"
COLOR_PRIMARY_DARK = "#084f96"
COLOR_SUCCESS = "#248a46"
COLOR_WARNING = "#b7791f"
COLOR_DANGER = "#b42318"
COLOR_SELECTED = "#e8f3ff"
# Tipo de dia (barra) y modalidades (chips)
COLOR_VACACIONES = "#7a5db5"       # morado: dia de vacaciones
COLOR_GUARDIA_BG = "#e6f1fb"       # chip guardia (fondo azul claro)
COLOR_GUARDIA_FG = "#0c447c"       # chip guardia (texto azul oscuro)
COLOR_TELE_BG = "#eceff3"          # chip teletrabajo (fondo gris)
COLOR_TELE_FG = "#44484f"          # chip teletrabajo (texto gris)


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
    style.configure("Section.TLabel", background=COLOR_PANEL, foreground=COLOR_MUTED,
                    font=("TkDefaultFont", 10, "bold"))
    style.configure("WeekTitle.TLabel", background=COLOR_PANEL, foreground=COLOR_TEXT,
                    font=("TkDefaultFont", 13, "bold"))
    style.configure("Muted.TLabel", background=COLOR_APP_BG, foreground=COLOR_MUTED)
    # Variante de texto atenuado para superficies BLANCAS (Panel.TFrame):
    # Muted.TLabel lleva el fondo gris de la app y sobre un panel se ve
    # como una caja gris. Usar esta dentro de paneles.
    style.configure("PanelMuted.TLabel", background=COLOR_PANEL, foreground=COLOR_MUTED)
    style.configure("Status.TLabel", background=COLOR_PANEL_ALT, foreground=COLOR_MUTED,
                    padding=(8, 5))
    style.configure("TButton", padding=(12, 7))
    style.configure("Treeview", rowheight=28, background=COLOR_PANEL,
                    fieldbackground=COLOR_PANEL, borderwidth=0)
    style.configure("Treeview.Heading", padding=(8, 6),
                    font=("TkDefaultFont", 10, "bold"))
    style.map("Treeview", background=[("selected", COLOR_SELECTED)],
              foreground=[("selected", COLOR_TEXT)])
    return style


def chip_modalidad(parent, texto, bg, fg, pequeno=False):
    """Chip de modalidad (guardia/teletrabajo): mismo aspecto en las tarjetas
    de dia y en la leyenda. _fijo=True para que _pintar_sel no lo repinte."""
    chip = tk.Label(parent, text=texto, bg=bg, fg=fg,
                    font=("TkDefaultFont", 8 if pequeno else 9),
                    padx=5 if pequeno else 6, pady=0 if pequeno else 1)
    chip._fijo = True
    return chip


def boton_primario(parent, texto, comando):
    """Boton de la accion principal (azul relleno, texto blanco).

    En Windows los temas ttk (vista/xpnative) IGNORAN el color de fondo de los
    botones: con Primary.TButton el texto blanco quedaba sobre fondo blanco,
    invisible. Por eso aqui se usa un tk.Button clasico, que si acepta colores.
    En macOS el boton nativo aqua se ve bien y no admite fondo: se deja ttk."""
    if sys.platform == "darwin":
        return ttk.Button(parent, text=texto, command=comando)
    return tk.Button(parent, text=texto, command=comando,
                     bg=COLOR_PRIMARY, fg="white",
                     activebackground=COLOR_PRIMARY_DARK, activeforeground="white",
                     disabledforeground="#bdd7ef",
                     relief="flat", bd=0, cursor="hand2",
                     font=("TkDefaultFont", 10, "bold"), padx=16, pady=8)


def boton_peligro(parent, texto, comando):
    """Boton de accion destructiva (rojo sobre fondo rojizo suave)."""
    if sys.platform == "darwin":
        return ttk.Button(parent, text=texto, command=comando)
    return tk.Button(parent, text=texto, command=comando,
                     bg="#fbeceb", fg=COLOR_DANGER,
                     activebackground="#f6d9d6", activeforeground=COLOR_DANGER,
                     relief="flat", bd=0, cursor="hand2", padx=12, pady=7)


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


class TooltipFilas:
    """Tooltip dinamico para un Treeview: al pasar el raton por una fila
    muestra el texto que devuelva texto_de(iid) (p. ej. el comentario
    completo, que en la celda sale cortado). Si devuelve "", no molesta."""

    def __init__(self, tree, texto_de):
        self.tree, self.texto_de = tree, texto_de
        self.tip, self.fila = None, None
        tree.bind("<Motion>", self._mover)
        tree.bind("<Leave>", self._ocultar)

    def _mover(self, e):
        fila = self.tree.identify_row(e.y)
        if fila == self.fila:
            return
        self._ocultar()
        self.fila = fila
        if not fila:
            return
        texto = self.texto_de(fila)
        if not texto:
            return
        self.tip = tk.Toplevel(self.tree)
        self.tip.wm_overrideredirect(True)
        self.tip.wm_geometry(f"+{e.x_root + 14}+{e.y_root + 12}")
        tk.Label(self.tip, text=texto, bg="#ffffe0", relief="solid",
                 borderwidth=1, font=("Segoe UI", 9), justify="left",
                 wraplength=420).pack(ipadx=5, ipady=2)

    def _ocultar(self, _e=None):
        if self.tip:
            self.tip.destroy()
            self.tip = None
        self.fila = None
