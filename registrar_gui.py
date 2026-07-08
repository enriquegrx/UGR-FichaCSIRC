#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
registrar_gui.py - Ventana principal (Tkinter) de FichaCSIRC.

Estructura del proyecto grafico:
  - registrar_gui.py : ventana principal (semana, formulario, alta/baja/copias).
  - dialogos.py      : ventanas secundarias (buscar, exportar, editar, resumen,
                       plantillas).
  - fichaui.py       : utilidades de UI (tooltips, ejecucion en hilo, recursos).
  - recordatorio.py  : aviso de fichaje (comprobacion suelta + tarea programada).
  - rellenar_horas.py: motor (API, jornada, config).

Ejecuta:  pythonw registrar_gui.py   (o doble clic en el lanzador)
          registrar_gui.py --recordatorio  -> solo lanza el aviso de fichaje
"""

import os
import re
import subprocess
import sys
import tempfile
import webbrowser
import datetime as dt
import tkinter as tk
from tkinter import ttk, messagebox, simpledialog

# --- Importar el motor (rellenar_horas.py) sin ejecutar su menu ---
try:
    import rellenar_horas as core
except SystemExit as e:
    # rellenar_horas hace sys.exit si falta config.json
    root = tk.Tk()
    root.withdraw()
    messagebox.showerror("Configuración necesaria", str(e))
    sys.exit(1)
except Exception as e:
    root = tk.Tk()
    root.withdraw()
    messagebox.showerror("Error", f"No se pudo cargar la configuracion:\n{e}")
    sys.exit(1)

import dialogos
import destinos
import recordatorio
from fichaui import (
    COLOR_APP_BG, COLOR_BORDER, COLOR_DANGER, COLOR_MUTED, COLOR_PANEL,
    COLOR_PRIMARY, COLOR_SELECTED, COLOR_SUCCESS, COLOR_WARNING,
    COLOR_VACACIONES, COLOR_GUARDIA_BG, COLOR_GUARDIA_FG, COLOR_TELE_BG,
    COLOR_TELE_FG, Tooltip,
    TooltipFilas, aplicar_estilo, boton_peligro, boton_primario, chip_modalidad,
    en_hilo, recurso, carpeta_app,
)


class App:
    def __init__(self, root):
        self.root = root
        root.title(f"FichaCSIRC {core.VERSION} - Registro de horas")
        root.geometry("980x720")
        root.minsize(900, 660)
        geo = core.config_valor("ventana")
        if isinstance(geo, str) and "x" in geo:
            try:
                root.geometry(self._geometria_visible(geo))
            except Exception:
                pass
        root.protocol("WM_DELETE_WINDOW", self._cerrar)
        self._carpeta = carpeta_app()
        self._logo_img = None
        ico = self._recurso("fichacsirc.ico")
        if os.path.exists(ico):
            try:
                root.iconbitmap(ico)
            except Exception:
                pass

        self.lunes = self._lunes_actual()
        self.dia_vars = []      # (BooleanVar, date, Frame-tarjeta)
        self.tareas = {}        # texto mostrado -> id
        self._cache_dia = {}    # fecha iso -> lista de apuntes (None si fallo la lectura)
        self._horas_auto = ""   # ultimo valor autosugerido en el campo Horas
        self._extras = []       # tareas elegidas con Buscar... en esta sesion
        self._refresco_seq = 0  # para descartar refrescos que llegan tarde
        self._msg_pendiente = ""  # mensaje a mostrar tras el proximo refresco
        self._ultimo_borrado = None  # datos del ultimo apunte eliminado (deshacer)
        self._card_bg = COLOR_PANEL
        self._construir()
        self._cargar_actividades()
        self._poblar_tareas()
        self.refrescar()
        self._comprobar_actualizacion()

    def _comprobar_actualizacion(self, forzar=False):
        """Avisa (una vez al dia, sin molestar) si hay una version nueva."""
        def al_terminar(res, err):
            if err or not res:
                if forzar and not err:
                    messagebox.showinfo(
                        "Actualizaciones",
                        f"Ya tienes la última versión (v{core.VERSION}).")
                return
            version, url = res[:2]
            installer_url = res[2] if len(res) > 2 else ""
            if os.name == "nt" and installer_url:
                if messagebox.askyesno(
                        "Actualización disponible",
                        f"Hay una versión nueva de FichaCSIRC ({version}).\n"
                        f"Tú tienes la {core.VERSION}.\n\n"
                        "¿Descargar e instalar ahora?\n"
                        "FichaCSIRC se cerrará al iniciar el instalador."):
                    self._descargar_e_instalar(version, installer_url, url)
                return
            if messagebox.askyesno(
                    "Actualización disponible",
                    f"Hay una versión nueva de FichaCSIRC ({version}).\n"
                    f"Tú tienes la {core.VERSION}.\n\n"
                    "¿Abrir la página de descarga?"):
                try:
                    webbrowser.open(url)
                except Exception:
                    pass

        en_hilo(self.root, lambda: core.buscar_actualizacion(forzar=forzar), al_terminar)

    def _descargar_e_instalar(self, version, installer_url, pagina_url):
        """Descarga el instalador Windows y lo lanza fuera de la app."""
        nombre = f"FichaCSIRC-Instalador-{version}.exe"
        destino = os.path.join(tempfile.gettempdir(), nombre)
        self.status.config(text=f"Descargando actualización {version}...")

        def trabajo():
            return core.descargar_archivo(installer_url, destino)

        def al_terminar(ruta, err):
            if err:
                if messagebox.askyesno(
                        "No se pudo descargar",
                        f"No se pudo descargar el instalador:\n{err}\n\n"
                        "¿Abrir la página de descarga?"):
                    try:
                        webbrowser.open(pagina_url)
                    except Exception:
                        pass
                self.status.config(text="No se pudo descargar la actualización.")
                return
            self.status.config(text="Instalador descargado. Iniciando actualización...")
            try:
                self._lanzar_instalador_tras_cerrar(ruta)
            except Exception as e:
                messagebox.showerror(
                    "No se pudo iniciar",
                    f"El instalador se descargó en:\n{ruta}\n\n"
                    f"Pero no se pudo iniciar:\n{e}")
                return
            self.root.after(150, self._cerrar)

        self._en_hilo(trabajo, al_terminar)

    def _lanzar_instalador_tras_cerrar(self, ruta):
        """Lanza el instalador directamente (sin cmd/start: sus comillas se
        mangleaban y start acababa buscando el archivo '\\\\'). No hace falta
        esperar aqui: el instalador espera y cierra los procesos de la app
        antes de copiar (InitializeSetup y PrepareToInstall)."""
        subprocess.Popen([ruta], close_fds=True)

    # ---------- utilidades ----------
    def _lunes_actual(self):
        h = dt.date.today()
        return h - dt.timedelta(days=h.weekday())

    def _dias_semana(self):
        return [self.lunes + dt.timedelta(days=i) for i in range(5)]

    def _recurso(self, nombre):
        return recurso(self._carpeta, nombre)

    def _fecha_build(self):
        """Fecha de compilacion (del .exe) o de ultima modificacion (del script)."""
        ruta = sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__)
        try:
            return dt.date.fromtimestamp(os.path.getmtime(ruta)).strftime("%d/%m/%Y")
        except Exception:
            return ""

    def _plataforma(self):
        if sys.platform == "darwin":
            return "macOS"
        if os.name == "nt":
            return "Windows"
        return sys.platform

    def _geometria_visible(self, geo):
        """Limita la geometria guardada para que no se esconda el pie."""
        m = re.match(r"^(\d+)x(\d+)([+-]\d+)?([+-]\d+)?$", geo)
        if not m:
            return geo
        w, h = int(m.group(1)), int(m.group(2))
        x = int(m.group(3) or 0)
        y = int(m.group(4) or 0)
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        max_w = max(900, int(sw * 0.95))
        max_h = max(660, int(sh * 0.88))
        w = max(900, min(w, max_w))
        h = max(660, min(h, max_h))
        x = max(0, min(x, max(0, sw - w)))
        y = max(0, min(y, max(0, sh - h - 48)))
        return f"{w}x{h}+{x}+{y}"

    def _cerrar(self):
        """Guarda tamano de ventana y ultima actividad antes de salir."""
        try:
            core.guardar_config_valor("ventana", self.root.geometry())
            if self.cbo_act.get():
                core.guardar_config_valor("ultima_actividad", self.cbo_act.get())
        except Exception:
            pass
        self.root.destroy()

    def _en_hilo(self, trabajo, al_terminar):
        en_hilo(self.root, trabajo, al_terminar)

    # ---------- construccion UI ----------
    def _construir(self):
        self._menu()

        # Cabecera: logo UGR (si existe) + nombre de la app
        header = ttk.Frame(self.root, padding=(16, 12), style="Header.TFrame")
        header.pack(fill="x")
        logo_path = self._recurso("logo_ugr.png")
        if os.path.exists(logo_path):
            try:
                self._logo_img = tk.PhotoImage(file=logo_path)
                ttk.Label(header, image=self._logo_img,
                          style="Header.TLabel").pack(side="left", padx=(0, 18))
            except Exception:
                self._logo_img = None
        ttk.Label(header, text="FichaCSIRC", style="Title.TLabel").pack(side="left")
        ttk.Label(header, text="Registro de horas - OpenProject",
                  style="Subtitle.TLabel").pack(side="left", padx=16)
        self.lbl_user = ttk.Label(header, text="", style="Header.TLabel",
                                  font=("TkDefaultFont", 10, "bold"))
        self.lbl_user.pack(side="right", padx=(0, 4))
        ttk.Separator(self.root, orient="horizontal").pack(fill="x")

        # Barra superior: navegacion agrupada a la izquierda (← Hoy →), titulo
        # de la semana protagonista en el centro y acciones a la derecha.
        top = ttk.Frame(self.root, padding=(14, 12), style="Panel.TFrame")
        top.pack(fill="x", padx=12, pady=(12, 8))
        nav = ttk.Frame(top, style="Panel.TFrame")
        nav.pack(side="left")
        b_ant = ttk.Button(nav, text="←", width=3, command=self._semana_ant)
        b_ant.pack(side="left")
        Tooltip(b_ant, "Semana anterior")
        b_hoy = ttk.Button(nav, text="Hoy", width=5, command=self._ir_hoy)
        b_hoy.pack(side="left", padx=3)
        Tooltip(b_hoy, "Volver a la semana actual")
        b_sig = ttk.Button(nav, text="→", width=3, command=self._semana_sig)
        b_sig.pack(side="left")
        Tooltip(b_sig, "Semana siguiente")
        b_exp = ttk.Button(top, text="Exportar CSV…", command=self._exportar)
        b_exp.pack(side="right", padx=(8, 0))
        Tooltip(b_exp, "Exporta tus apuntes a CSV por rango de fechas")
        b_mes = ttk.Button(top, text="Resumen", command=self._resumen_mes)
        b_mes.pack(side="right", padx=(8, 0))
        Tooltip(b_mes, "Horas del mes: registradas, objetivo y días incompletos")
        self.lbl_semana = ttk.Label(top, text="", style="WeekTitle.TLabel",
                                    anchor="center")
        self.lbl_semana.pack(side="left", expand=True, fill="x", padx=12)

        # Dias (tarjetas con estado)
        self.var_semana = tk.BooleanVar(value=False)
        diaf = ttk.Frame(self.root, padding=(14, 12), style="Panel.TFrame")
        diaf.pack(fill="x", padx=12, pady=(0, 8))
        ttk.Label(diaf, text="Días", style="Section.TLabel").pack(anchor="w")
        self.dias_frame = ttk.Frame(diaf, style="Panel.TFrame")
        self.dias_frame.pack(fill="x", pady=(8, 0))
        fila2 = ttk.Frame(diaf, style="Panel.TFrame")
        fila2.pack(fill="x", pady=(10, 0))
        ttk.Checkbutton(fila2, text="Toda la semana", variable=self.var_semana,
                        command=self._toggle_semana).pack(side="left")
        # Un solo desplegable agrupa las acciones de repetir (quita ruido de
        # botones de la pantalla principal).
        mb_cop = ttk.Menubutton(fila2, text="Copiar / Plantillas ▾")
        m_cop = tk.Menu(mb_cop, tearoff=0)
        m_cop.add_command(label="Copiar día anterior a los días marcados",
                          command=self._copiar_anterior)
        m_cop.add_command(label="Copiar semana anterior completa",
                          command=self._copiar_semana_anterior)
        m_cop.add_separator()
        m_cop.add_command(label="Plantillas...", command=self._plantillas)
        mb_cop["menu"] = m_cop
        mb_cop.pack(side="right")
        Tooltip(mb_cop, "Repetir apuntes: el último día con horas, la semana pasada\n"
                        "o una plantilla guardada.\n"
                        "(Botón derecho en un día: marcarlo festivo/vacaciones)")

        self._construir_leyenda(diaf)

        # Lista de apuntes
        midf = ttk.Frame(self.root, padding=(14, 12), style="Panel.TFrame")
        midf.pack(fill="both", expand=True, padx=12, pady=(0, 8))
        mid_head = ttk.Frame(midf, style="Panel.TFrame")
        mid_head.pack(fill="x", pady=(0, 8))
        ttk.Label(mid_head, text="Apuntes de los días marcados",
                  style="Section.TLabel").pack(side="left")
        b_del = boton_peligro(mid_head, "Eliminar seleccionados", self._eliminar)
        b_del.pack(side="right")
        Tooltip(b_del, "Elimina los apuntes seleccionados (Ctrl o Mayús: varios).\n"
                       "También con la tecla Supr. Doble clic en un apunte lo edita.")
        cols = ("dia", "horas", "tarea", "actividad", "comentario")
        self.tree = ttk.Treeview(midf, columns=cols, show="headings", height=6)
        for c, txt, w in [("dia", "Día", 95), ("horas", "Horas", 70),
                          ("tarea", "Tarea", 360), ("actividad", "Actividad", 190),
                          ("comentario", "Comentario", 260)]:
            self.tree.heading(c, text=txt)
            self.tree.column(c, width=w, anchor="w")
        self.tree.pack(side="left", fill="both", expand=True)
        sb = ttk.Scrollbar(midf, orient="vertical", command=self.tree.yview)
        sb.pack(side="right", fill="y")
        self.tree.configure(yscrollcommand=sb.set)
        self.tree.tag_configure("odd", background="#f8fafc")
        self.tree.tag_configure("even", background=COLOR_PANEL)
        self.tree.bind("<Double-1>", self._editar)
        TooltipFilas(self.tree, self._texto_fila)

        # Formulario anadir
        form = ttk.Frame(self.root, padding=(14, 10), style="Panel.TFrame")
        # La accion diaria principal debe quedar visible incluso en ventanas no maximizadas.
        form.pack(fill="x", padx=12, pady=(0, 8), before=midf)
        ttk.Label(form, text="Añadir apunte", style="Section.TLabel").grid(
            row=0, column=0, columnspan=3, sticky="w", pady=(0, 6))

        ttk.Label(form, text="Tarea:", background=COLOR_PANEL).grid(row=1, column=0, sticky="w")
        self.cbo_tarea = ttk.Combobox(form, width=46)
        self.cbo_tarea.grid(row=1, column=1, sticky="we", padx=(8, 8), pady=4)
        self.cbo_tarea.bind("<KeyRelease>", self._filtrar_tareas)
        Tooltip(self.cbo_tarea, "Escribe para filtrar tus tareas favoritas")
        b_buscar = ttk.Button(form, text="Buscar...", command=self._buscar_tarea)
        b_buscar.grid(row=1, column=2, pady=4, sticky="ew")
        Tooltip(b_buscar, "Busca tareas por proyecto (Ctrl/Mayús para elegir varias)")

        # Horas y actividad juntas, alineadas bajo la tarea (el campo Horas
        # quedaba huerfano y la actividad descolgada a la derecha).
        ttk.Label(form, text="Horas:", background=COLOR_PANEL).grid(row=2, column=0, sticky="w")
        fila_ha = ttk.Frame(form, style="Panel.TFrame")
        fila_ha.grid(row=2, column=1, columnspan=2, sticky="w", padx=(8, 0), pady=4)
        self.ent_horas = ttk.Entry(fila_ha, width=8)
        self.ent_horas.pack(side="left")
        ttk.Label(fila_ha, text="Actividad:",
                  background=COLOR_PANEL).pack(side="left", padx=(18, 6))
        self.cbo_act = ttk.Combobox(fila_ha, state="readonly", width=24)
        self.cbo_act.pack(side="left")

        ttk.Label(form, text="Comentario:", background=COLOR_PANEL).grid(row=3, column=0, sticky="w")
        self.ent_com = ttk.Entry(form, width=50)
        self.ent_com.grid(row=3, column=1, sticky="we", padx=(8, 8), pady=4)

        self.btn_anadir = boton_primario(form, "Añadir a días marcados", self._anadir)
        self.btn_anadir.grid(row=3, column=2, pady=4, sticky="ew")
        Tooltip(self.btn_anadir, "También con Enter desde Horas o Comentario")
        form.columnconfigure(1, weight=1)

        # Atajos: Enter anade, Supr elimina, F5 recarga, Ctrl+Z deshace el
        # borrado, Ctrl+flechas cambia de semana y Alt+1..5 marca dias
        # (ver Ayuda > Atajos de teclado).
        self.ent_horas.bind("<Return>", lambda _e: self._anadir())
        self.ent_com.bind("<Return>", lambda _e: self._anadir())
        self.tree.bind("<Delete>", lambda _e: self._eliminar())
        self.root.bind("<F5>", lambda _e: self.refrescar())
        self.root.bind("<Control-z>", lambda _e: self._deshacer_borrado())
        self.root.bind("<Control-Left>", lambda _e: self._semana_ant())
        self.root.bind("<Control-Right>", lambda _e: self._semana_sig())
        for n in range(1, 6):
            self.root.bind(f"<Alt-Key-{n}>",
                           lambda _e, i=n - 1: self._toggle_dia_idx(i))
        # El comentario habitual de cada tarea se recuerda y se sugiere
        self._com_auto = ""
        self.cbo_tarea.bind("<<ComboboxSelected>>", self._sugerir_comentario)

        # Barra de estado (+ boton Deshacer que aparece tras eliminar)
        barra = ttk.Frame(self.root, style="Subtle.TFrame")
        barra.pack(fill="x", side="bottom")
        self.btn_deshacer = ttk.Button(barra, text="Deshacer",
                                       command=self._deshacer_borrado)
        Tooltip(self.btn_deshacer, "Restaura el último apunte eliminado (Ctrl+Z)")
        # Pie: conexion, version, fecha de build y repositorio
        pie_txt = f"{self._plataforma()} · v{core.VERSION} · build {self._fecha_build()}"
        pie = ttk.Label(barra, text=pie_txt, style="Status.TLabel")
        pie.pack(side="right")
        if core.GITHUB_REPO:
            pie.configure(text=f"{pie_txt} · GitHub",
                          foreground="#0b66c3", cursor="hand2")
            pie.bind("<Button-1>", lambda _e: webbrowser.open(
                f"https://github.com/{core.GITHUB_REPO}"))
            Tooltip(pie, "Abrir el repositorio en GitHub")
        # Indicador de INARI (a la izquierda del de ProyectosTIC); solo se
        # muestra si la integración está activa.
        self.lbl_conn_inari = ttk.Label(barra, text="● INARI",
                                        style="Status.TLabel", foreground=COLOR_MUTED)
        Tooltip(self.lbl_conn_inari, "Estado de la última consulta a INARI")
        self.lbl_conn = ttk.Label(barra, text="● ProyectosTIC",
                                  style="Status.TLabel", foreground=COLOR_MUTED)
        self.lbl_conn.pack(side="right")
        Tooltip(self.lbl_conn, "Estado de la última consulta a ProyectosTic")
        self.status = ttk.Label(barra, text="", style="Status.TLabel", anchor="w")
        self.status.pack(side="left", fill="x", expand=True)

    def _texto_fila(self, iid):
        """Texto del tooltip de una fila de la tabla: comentario completo."""
        vals = self.tree.item(iid, "values")
        if len(vals) >= 5 and vals[4]:
            return f"{vals[2]}\n“{vals[4]}”"
        return ""

    _COLORES_CONN = {"ok": COLOR_SUCCESS, "warn": COLOR_WARNING,
                     "error": COLOR_DANGER, "checking": COLOR_MUTED}

    def _poner_conexion(self, estado, texto):
        self.lbl_conn.config(text=texto,
                             foreground=self._COLORES_CONN.get(estado, COLOR_MUTED))

    def _poner_conexion_inari(self, estado, texto=""):
        """Segundo indicador. estado 'off' lo oculta (integración desactivada)."""
        if estado == "off":
            self.lbl_conn_inari.pack_forget()
            return
        if self.lbl_conn_inari.winfo_manager() != "pack":
            self.lbl_conn_inari.pack(side="right", padx=(0, 10))
        self.lbl_conn_inari.config(
            text=texto or "● INARI",
            foreground=self._COLORES_CONN.get(estado, COLOR_MUTED))

    def _menu(self):
        barra = tk.Menu(self.root)
        m_arch = tk.Menu(barra, tearoff=0)
        m_arch.add_command(label="Exportar a CSV...", command=self._exportar)
        m_arch.add_command(label="Resumen del mes", command=self._resumen_mes)
        m_arch.add_separator()
        m_arch.add_command(label="Salir", command=self._cerrar)
        barra.add_cascade(label="Archivo", menu=m_arch)

        m_herr = tk.Menu(barra, tearoff=0)
        m_herr.add_command(label="Plantillas...", command=self._plantillas)
        m_herr.add_command(label="Importar festivos...",
                           command=lambda: dialogos.abrir_importar_festivos(self))
        m_herr.add_command(label="Vacaciones y teletrabajo...",
                           command=lambda: dialogos.abrir_ajustes_dias(self))
        m_herr.add_command(label="Integraciones (INARI)...",
                           command=lambda: dialogos.abrir_integraciones(self))
        if recordatorio.recordatorios_soportados():
            m_herr.add_command(label="Aviso diario de fichaje...",
                               command=self._config_recordatorio)
        barra.add_cascade(label="Herramientas", menu=m_herr)

        m_ayuda = tk.Menu(barra, tearoff=0)
        m_ayuda.add_command(label="Atajos de teclado", command=self._atajos)
        m_ayuda.add_command(label="Comprobar actualizaciones",
                            command=lambda: self._comprobar_actualizacion(forzar=True))
        if core.GITHUB_REPO:
            m_ayuda.add_command(
                label="Ver en GitHub",
                command=lambda: webbrowser.open(f"https://github.com/{core.GITHUB_REPO}"))
        m_ayuda.add_separator()
        m_ayuda.add_command(label="Acerca de FichaCSIRC", command=self._acerca_de)
        barra.add_cascade(label="Ayuda", menu=m_ayuda)
        self.root.config(menu=barra)

    def _construir_leyenda(self, parent):
        """Tira compacta que explica los colores (tipo de día) y chips (modalidad)."""
        fila = ttk.Frame(parent, style="Panel.TFrame")
        fila.pack(fill="x", pady=(10, 0))

        def swatch(color, texto):
            cont = ttk.Frame(fila, style="Panel.TFrame")
            cont.pack(side="left", padx=(0, 14))
            tk.Label(cont, bg=color, width=2, height=1).pack(side="left", padx=(0, 5))
            ttk.Label(cont, text=texto, style="PanelMuted.TLabel").pack(side="left")

        def chip(bg, fg, texto):
            cont = ttk.Frame(fila, style="Panel.TFrame")
            cont.pack(side="left", padx=(0, 14))
            chip_modalidad(cont, texto, bg, fg, pequeno=True).pack(side="left")

        swatch(COLOR_SUCCESS, "Completo")
        swatch(COLOR_WARNING, "Parcial")
        swatch(COLOR_MUTED, "Festivo / cierre")
        swatch(COLOR_VACACIONES, "Vacaciones")
        chip(COLOR_GUARDIA_BG, COLOR_GUARDIA_FG, "⚙ Guardia")
        chip(COLOR_TELE_BG, COLOR_TELE_FG, "⌂ Teletrabajo")

    def _acerca_de(self):
        messagebox.showinfo(
            "Acerca de FichaCSIRC",
            f"FichaCSIRC v{core.VERSION}\n"
            f"Compilación: {self._fecha_build()}\n\n"
            "Registro de horas en OpenProject (ProyectosTic, UGR).\n"
            + (f"github.com/{core.GITHUB_REPO}" if core.GITHUB_REPO else ""))

    def _atajos(self):
        messagebox.showinfo(
            "Atajos de teclado",
            "Enter\tAñadir el apunte (desde Horas o Comentario)\n"
            "Supr\tEliminar los apuntes seleccionados\n"
            "Ctrl+Z\tDeshacer el último borrado\n"
            "F5\tRecargar la semana\n"
            "Ctrl+←/→\tSemana anterior / siguiente\n"
            "Alt+1..5\tMarcar/desmarcar lunes..viernes\n\n"
            "Doble clic en un apunte: editarlo.\n"
            "Botón derecho en un día: festivo/vacaciones y guardia/teletrabajo.")

    def _config_recordatorio(self):
        """Activa/desactiva el aviso diario de fichaje (tarea programada)."""
        activo = recordatorio.recordatorio_activo()
        if activo:
            if messagebox.askyesno(
                    "Aviso diario",
                    "El aviso diario de fichaje está ACTIVO (lunes a viernes).\n\n"
                    "¿Quieres desactivarlo?"):
                try:
                    recordatorio.desactivar_recordatorio()
                    messagebox.showinfo("Aviso diario", "Aviso desactivado.")
                except Exception as e:
                    messagebox.showerror("Error", f"No se pudo desactivar:\n{e}")
            return
        hora = simpledialog.askstring(
            "Aviso diario de fichaje",
            "FichaCSIRC puede avisarte cada día laborable si te faltan horas\n"
            "por fichar (solo aparece si hay algo pendiente).\n\n"
            "¿A qué hora quieres el aviso? (HH:MM, 24h)",
            initialvalue="16:00", parent=self.root)
        if not hora:
            return
        hora = hora.strip()
        try:
            dt.datetime.strptime(hora, "%H:%M")
        except ValueError:
            messagebox.showwarning("Hora", "Escribe la hora como HH:MM (ej. 16:00).")
            return
        try:
            recordatorio.activar_recordatorio(hora)
            messagebox.showinfo(
                "Aviso diario",
                f"Listo. Te avisaré los días laborables a las {hora}\n"
                "si te faltan horas por fichar.")
        except Exception as e:
            messagebox.showerror("Error", f"No se pudo activar el aviso:\n{e}")

    # ---------- carga de datos auxiliares ----------
    def _cargar_actividades(self):
        self._poner_actividades(list(core.ACTIVIDADES))
        if not core.FAVORITOS:
            return

        def trabajo():
            return list(core._actividades_disponibles(core.FAVORITOS[0]["id"]).keys())

        def al_terminar(res, err):
            if not err and res:
                self._poner_actividades(res)

        self._en_hilo(trabajo, al_terminar)

    def _poner_actividades(self, nombres):
        self.cbo_act["values"] = nombres
        pref = core.config_valor("ultima_actividad") or core.ACTIVIDAD_DEFECTO
        idx = 0
        for i, n in enumerate(nombres):
            if pref and n.lower() == str(pref).lower():
                idx = i
        if nombres:
            self.cbo_act.current(idx)

    def _poblar_tareas(self):
        """Rellena el desplegable: tareas de la sesion (Buscar...) + favoritas."""
        self.tareas = {}
        vals = []
        for wp in self._extras + list(core.FAVORITOS):
            txt = f"{wp['id']} - {wp['nombre']}"
            if txt not in self.tareas:
                self.tareas[txt] = int(wp["id"])
                vals.append(txt)
        self.cbo_tarea["values"] = vals
        if vals:
            self.cbo_tarea.current(0)

    def _filtrar_tareas(self, e=None):
        """Filtra el desplegable de tareas segun lo que se escribe."""
        if e and e.keysym in ("Up", "Down", "Return", "Escape", "Tab"):
            return
        txt = self.cbo_tarea.get().strip().lower()
        todas = list(self.tareas)
        if txt:
            filtradas = [t for t in todas if txt in t.lower()]
            self.cbo_tarea["values"] = filtradas or todas
        else:
            self.cbo_tarea["values"] = todas

    def _resolver_tarea(self, txt):
        """wp_id para el texto del combo: exacto, o filtro con un unico candidato."""
        if txt in self.tareas:
            return self.tareas[txt]
        if txt:
            candidatos = [k for k in self.tareas if txt.lower() in k.lower()]
            if len(candidatos) == 1:
                self.cbo_tarea.set(candidatos[0])
                return self.tareas[candidatos[0]]
        return None

    # ---------- navegacion ----------
    def _semana_ant(self):
        self.lunes -= dt.timedelta(days=7)
        self.refrescar()

    def _semana_sig(self):
        self.lunes += dt.timedelta(days=7)
        self.refrescar()

    def _ir_hoy(self):
        self.lunes = self._lunes_actual()
        self.refrescar()

    # ---------- refresco ----------
    def refrescar(self):
        dom = self.lunes + dt.timedelta(days=6)
        self.lbl_semana.config(
            text=f"Semana {self.lunes.strftime('%d/%m/%Y')} - {dom.strftime('%d/%m/%Y')}")
        for w in self.dias_frame.winfo_children():
            w.destroy()
        self.dia_vars = []
        self._cache_dia = {}
        self.status.config(text="Cargando semana...")
        self._poner_conexion("checking", "● Comprobando conexión")
        self._refresco_seq += 1
        seq = self._refresco_seq
        dias = self._dias_semana()

        inari_cfg = destinos.configurado()

        def trabajo():
            cache, fallos = {}, 0
            for d in dias:
                iso = d.isoformat()
                try:
                    if inari_cfg and core.es_teletrabajo(iso):
                        # Dia de teletrabajo: las horas son las de INARI. Cada
                        # slot es una tarea; su id es su propio task_id.
                        ss = destinos.slots_dia(iso)
                        cache[iso] = [{"id": s["id"], "task_id": s["id"], "destino": "inari",
                                       "horas": s["horas"], "wp_titulo": s["titulo"],
                                       "actividad": "INARI · Teletrabajo",
                                       "comentario": "", "wp_id": None} for s in ss]
                    else:
                        cache[iso] = [dict(a, destino="op")
                                      for a in core.entradas_dia(iso)]
                except Exception:
                    cache[iso] = None
                    fallos += 1
            # Ping ligero a INARI para el segundo indicador (solo si está activo).
            inari_estado = "off"
            if inari_cfg:
                try:
                    destinos.probar_conexion()
                    inari_estado = "ok"
                except Exception:
                    inari_estado = "error"
            return cache, fallos, core.nombre_usuario(), inari_estado

        def al_terminar(res, err):
            if seq != self._refresco_seq:
                return  # llego tarde: ya se pidio otra semana
            cache, fallos, nombre, inari_estado = res if res else ({}, len(dias), "", "off")
            self._poner_conexion_inari(inari_estado)
            self._pintar_semana(dias, cache, fallos, nombre)

        self._en_hilo(trabajo, al_terminar)

    def repintar_local(self):
        """Repinta la semana desde la caché tras un cambio LOCAL (marcar
        festivo/vacaciones, guardia, teletrabajo, ajustes): los apuntes del
        servidor no han cambiado, así que no se relanzan los 5 GET."""
        if not self._cache_dia or all(v is None for v in self._cache_dia.values()):
            self.refrescar()  # sin cache util: refresco normal
            return
        marcados = {d.isoformat() for d in self._dias_marcados()}
        self._pintar_semana(self._dias_semana(), self._cache_dia, 0, "")
        if marcados:  # conservar la seleccion que hubiera
            for var, d, _card in self.dia_vars:
                var.set(d.isoformat() in marcados)
            self._pintar_sel()
            self._recargar_tree()

    def _pintar_semana(self, dias, cache, fallos, nombre):
        self._cache_dia = cache
        hoy = dt.date.today()
        # Total de la semana junto al titulo (evita sumar tarjetas de cabeza)
        reg_sem = sum(sum(a["horas"] for a in (cache.get(d.isoformat()) or []))
                      for d in dias)
        obj_sem = sum(core.objetivo_de(d) for d in dias)
        dom = dias[0] + dt.timedelta(days=6)
        cupo_tt = core.teletrabajo_por_semana()
        tt = f"    ·    ⌂ {core.teletrabajo_en_semana(dias[0])}/{cupo_tt}" if cupo_tt else ""
        self.lbl_semana.config(
            text=f"Semana {dias[0].strftime('%d/%m/%Y')} - {dom.strftime('%d/%m/%Y')}"
                 f"    ·    {core._fmt(reg_sem)} / {obj_sem}h{tt}")
        for w in self.dias_frame.winfo_children():
            w.destroy()
        self.dia_vars = []
        for i, d in enumerate(dias):
            iso = d.isoformat()
            self.dias_frame.columnconfigure(i, weight=1, uniform="dias")
            apuntes = cache.get(iso)
            reg = sum(a["horas"] for a in apuntes) if apuntes else 0
            obj = core.objetivo_de(d)
            nolab = core.es_no_laborable(iso)
            hay_guardia = core.es_guardia(iso)
            hay_tt = core.es_teletrabajo(iso)
            es_hoy = (d == hoy)
            var = tk.BooleanVar(value=es_hoy)

            card = tk.Frame(self.dias_frame, bg=COLOR_PANEL, highlightthickness=1,
                            highlightbackground=COLOR_BORDER, cursor="hand2")
            card.grid(row=0, column=i, padx=5, pady=2, sticky="nsew")
            clicables = [card]  # todos los hijos deben responder al raton
            if es_hoy:
                # Banda azul superior: "hoy" se distingue de un vistazo, no
                # solo por la negrita del titulo.
                banda = tk.Frame(card, bg=COLOR_PRIMARY, height=4)
                banda.pack(fill="x")
                banda._fijo = True  # _pintar_sel no debe repintarla
                clicables.append(banda)
            fnt = ("TkDefaultFont", 10, "bold") if es_hoy else ("TkDefaultFont", 10)
            titulo = f"{core.DIAS_ES[i]} {d.strftime('%d/%m')}" + ("  · hoy" if es_hoy else "")
            lbl1 = tk.Label(card, text=titulo, font=fnt, anchor="w",
                            bg=COLOR_PANEL, fg="#111827")
            lbl1.pack(fill="x", padx=12, pady=(10, 5))
            cv = tk.Canvas(card, height=8, highlightthickness=0, bg=COLOR_PANEL)
            cv.pack(fill="x", padx=12)
            if nolab:
                # Vacaciones en morado; festivo/cierre/otros en gris. Nunca rojo.
                color = COLOR_VACACIONES if core.es_vacaciones(iso) else COLOR_MUTED
                frac = 1.0
                texto2 = core.motivo_no_laborable(iso).capitalize()
                if reg:
                    texto2 = f"{core._fmt(reg)} · {texto2}"
            elif apuntes is None:
                frac, color, texto2 = 0.0, COLOR_DANGER, "sin conexión"
            elif reg > obj + 0.001:
                frac, color = 1.0, COLOR_DANGER
                texto2 = f"{core._fmt(reg)} / {obj}h  (te pasas)"
            elif reg >= obj - 0.001 and reg > 0:
                frac, color = 1.0, COLOR_SUCCESS
                texto2 = f"{core._fmt(reg)} / {obj}h  ✔"
            elif reg > 0:
                frac, color = (reg / obj if obj else 0.0), COLOR_WARNING
                texto2 = f"{core._fmt(reg)} / {obj}h"
            else:
                frac, color = 0.0, "#9a9a9a"
                texto2 = f"0h / {obj}h"
            lbl2 = tk.Label(card, text=texto2, font=("TkDefaultFont", 12, "bold"),
                            fg=color, bg=COLOR_PANEL, anchor="w")
            lbl2.pack(fill="x", padx=12, pady=(7, 6 if (hay_guardia or hay_tt) else 10))
            clicables += [lbl1, cv, lbl2]

            # Chips de modalidad (guardia / teletrabajo): mismo helper que la
            # leyenda, y clicables como el resto de la tarjeta.
            if hay_guardia:
                chip = chip_modalidad(card, "⚙ Guardia",
                                      COLOR_GUARDIA_BG, COLOR_GUARDIA_FG)
                chip.pack(anchor="w", padx=12, pady=(0, 6))
                clicables.append(chip)
            if hay_tt:
                chip = chip_modalidad(card, "⌂ Teletrabajo",
                                      COLOR_TELE_BG, COLOR_TELE_FG)
                chip.pack(anchor="w", padx=12, pady=(0, 6))
                clicables.append(chip)

            def dibujar(_e=None, cv=cv, frac=frac, color=color):
                cv.delete("all")
                ancho = max(cv.winfo_width(), 1)
                cv.create_rectangle(0, 0, ancho, 8, fill="#e5e7eb", width=0)
                if frac > 0:
                    cv.create_rectangle(0, 0, int(ancho * frac), 8,
                                        fill=color, width=0)
            cv.bind("<Configure>", dibujar)
            for wdg in clicables:
                wdg.bind("<Button-1>", lambda _e, v=var: self._click_dia(v))
                wdg.bind("<Button-3>", lambda e, d=d: self._menu_dia(e, d))
            self.dia_vars.append((var, d, card))
        self._pintar_sel()
        self._recargar_tree()
        if fallos >= 5:
            if not getattr(self, "_aviso_con", False):
                self._aviso_con = True
                messagebox.showwarning(
                    "Sin conexión",
                    "No hay conexión con ProyectosTic (o la API no responde).\n"
                    "Comprueba tu red/VPN y la configuración\n"
                    "(FichaCSIRC - Configurar).")
            self.status.config(text="Sin conexión con ProyectosTic.")
            self._poner_conexion("error", "● Sin conexión")
        else:
            self._aviso_con = False
            if fallos:
                self._poner_conexion("warn", "● Conexión parcial")
            else:
                self._poner_conexion("ok", "● Conectado")
            if nombre and not self.lbl_user.cget("text"):
                self.lbl_user.config(text=nombre)
        if self._msg_pendiente:
            resumen = self.status.cget("text")
            self.status.config(text=f"{self._msg_pendiente}   ·   {resumen}")
            self._msg_pendiente = ""

    def _dias_marcados(self):
        return [d for (var, d, _) in self.dia_vars if var.get()]

    def _pintar_sel(self):
        """Refleja en las tarjetas que dias estan marcados."""
        for var, _d, card in self.dia_vars:
            sel = var.get()
            bg = COLOR_SELECTED if sel else self._card_bg
            borde = "#0b66c3" if sel else COLOR_BORDER
            card.configure(bg=bg, highlightbackground=borde, highlightcolor=borde,
                           highlightthickness=(2 if sel else 1))
            for ch in card.winfo_children():
                if getattr(ch, "_fijo", False):
                    continue  # p. ej. la banda azul de "hoy"
                try:
                    ch.configure(bg=bg)
                except tk.TclError:
                    pass

    def _click_dia(self, var):
        var.set(not var.get())
        self._pintar_sel()
        self._recargar_tree()

    def _toggle_semana(self):
        val = self.var_semana.get()
        for var, _, _ in self.dia_vars:
            var.set(val)
        self._pintar_sel()
        self._recargar_tree()

    def _recargar_tree(self):
        for it in self.tree.get_children():
            self.tree.delete(it)
        idx = 0
        for d in self._dias_marcados():
            apuntes = self._cache_dia.get(d.isoformat())
            if apuntes is None:
                continue
            for a in apuntes:
                zebra = "odd" if idx % 2 else "even"
                self.tree.insert("", "end",
                                 values=(f"{core.DIAS_ES[d.weekday()][:3]} {d.strftime('%d/%m')}",
                                         core._fmt(a["horas"]),
                                         a["wp_titulo"], a["actividad"], a["comentario"]),
                                 tags=(str(a["id"]), d.isoformat(), zebra,
                                       a.get("destino", "op"), str(a.get("task_id") or "")))
                idx += 1
        self.var_semana.set(bool(self.dia_vars)
                            and all(v.get() for v, _, _ in self.dia_vars))
        self._actualizar_totales()

    def _actualizar_totales(self):
        marcados = self._dias_marcados()
        if len(marcados) == 1:
            d = marcados[0]
            etiqueta = f"{core.DIAS_ES[d.weekday()]} {d.strftime('%d/%m')}"
            if core.es_no_laborable(d.isoformat()):
                motivo = core.motivo_no_laborable(d.isoformat())
                self.status.config(text=f"{etiqueta}: no laborable ({motivo})")
                self._sugerir_horas(0)
                self._sugerir_comentario()   # p. ej. guardia en vacaciones
                return
            apuntes = self._cache_dia.get(d.isoformat())
            reg = sum(a["horas"] for a in apuntes) if apuntes else 0
            obj = core.objetivo_de(d)
            falta = obj - reg
            extra = (f"faltan {core._fmt(falta)}" if falta > 0.001
                     else ("completo" if abs(falta) < 0.001 else f"te pasas {core._fmt(-falta)}"))
            self.status.config(text=f"{etiqueta}: {core._fmt(reg)}/{obj}h  ({extra})")
            self._sugerir_horas(falta)
            self._sugerir_comentario()
        elif marcados:
            self.status.config(text=f"{len(marcados)} días marcados")
        else:
            self.status.config(text="Marca al menos un día")

    def _toggle_dia_idx(self, i):
        """Alt+1..5: marca/desmarca el dia i de la semana (teclado)."""
        if i < len(self.dia_vars):
            self._click_dia(self.dia_vars[i][0])

    def _sugerir_comentario(self, _e=None):
        """Pre-rellena el comentario, sin pisar lo escrito a mano. En un día de
        guardia gana 'Servicio de Guardia'; si no, el comentario habitual de la
        tarea elegida."""
        actual = self.ent_com.get().strip()
        if actual and actual != self._com_auto:
            return
        marcados = self._dias_marcados()
        if len(marcados) == 1 and core.es_guardia(marcados[0].isoformat()):
            sugerido = core.comentario_guardia()
        else:
            wp_id = self.tareas.get(self.cbo_tarea.get())
            if wp_id is None:
                return
            sugerido = (core.config_valor("comentarios_tarea") or {}).get(str(wp_id), "")
        self.ent_com.delete(0, "end")
        if sugerido:
            self.ent_com.insert(0, sugerido)
        self._com_auto = sugerido

    def _recordar_comentario(self, wp_id, comentario):
        """Guarda el comentario usado con la tarea para sugerirlo despues."""
        try:
            mapa = dict(core.config_valor("comentarios_tarea") or {})
            if mapa.get(str(wp_id)) == comentario:
                return
            mapa[str(wp_id)] = comentario
            core.guardar_config_valor("comentarios_tarea", mapa)
        except Exception:
            pass  # es solo una comodidad: nunca debe romper el registro

    def _sugerir_horas(self, falta):
        """Pre-rellena el campo Horas con lo que falta, sin pisar lo escrito a mano."""
        actual = self.ent_horas.get().strip()
        if actual and actual != self._horas_auto:
            return
        self.ent_horas.delete(0, "end")
        if falta > 0.001:
            sugerida = f"{round(falta, 2):g}"
            self.ent_horas.insert(0, sugerida)
            self._horas_auto = sugerida
        else:
            self._horas_auto = ""

    # ---------- dialogos (en dialogos.py) ----------
    def _buscar_tarea(self):
        dialogos.abrir_buscar_tarea(self)

    def _exportar(self):
        dialogos.abrir_exportar(self)

    def _editar(self, _e=None):
        sel = self.tree.selection()
        if sel:
            tags = self.tree.item(sel[0], "tags")
            if len(tags) > 3 and tags[3] == "inari":
                messagebox.showinfo(
                    "Editar slot de INARI",
                    "Para corregir un slot de INARI, bórralo (Supr) y vuelve a\n"
                    "registrarlo con las horas correctas.")
                return
        dialogos.abrir_editar(self)

    def _resumen_mes(self):
        dialogos.abrir_resumen_mes(self)

    def _plantillas(self):
        dialogos.abrir_plantillas(self)

    # ---------- acciones del dia/semana ----------
    def _menu_dia(self, evento, d):
        """Menu contextual de una tarjeta: tipo de dia y modalidad de trabajo.
        Todas estas marcas son locales (config): se repinta desde la cache,
        sin volver a pedir la semana a la API."""
        fecha = d.isoformat()
        menu = tk.Menu(self.root, tearoff=0)
        # --- Tipo de dia (no laborable) ---
        if core.es_no_laborable(fecha):
            menu.add_command(
                label=f"Quitar marca ({core.motivo_no_laborable(fecha)})",
                command=lambda: (core.quitar_no_laborable(fecha),
                                 self.repintar_local()))
        else:
            sub = tk.Menu(menu, tearoff=0)
            for motivo in ("festivo", core.MOTIVO_VACACIONES,
                           "asuntos propios", "baja"):
                sub.add_command(
                    label=motivo.capitalize(),
                    command=lambda m=motivo: (core.marcar_no_laborable(fecha, m),
                                              self.repintar_local()))
            menu.add_cascade(label="Marcar como no laborable", menu=sub)
        menu.add_separator()
        # --- Modalidad de trabajo (se trabaja igual) ---
        if core.es_guardia(fecha):
            menu.add_command(label="Quitar guardia",
                             command=lambda: (core.quitar_guardia(fecha),
                                              self.repintar_local()))
        else:
            menu.add_command(label="Marcar día de guardia",
                             command=lambda: (core.marcar_guardia(fecha),
                                              self.repintar_local()))
        if core.es_teletrabajo(fecha):
            menu.add_command(label="Quitar teletrabajo",
                             command=lambda: (core.quitar_teletrabajo(fecha),
                                              self.repintar_local()))
        else:
            menu.add_command(label="Marcar teletrabajo",
                             command=lambda: self._marcar_teletrabajo(d))
        # --- Registro en INARI (solo dia de teletrabajo, con integracion lista) ---
        if core.es_teletrabajo(fecha) and destinos.configurado():
            menu.add_separator()
            menu.add_command(label="Registrar slot en INARI...",
                             command=lambda: dialogos.abrir_slot_inari(self, d))
        menu.tk_popup(evento.x_root, evento.y_root)

    def _marcar_teletrabajo(self, d):
        lunes = d - dt.timedelta(days=d.weekday())
        cupo = core.teletrabajo_por_semana()
        if cupo and core.teletrabajo_en_semana(lunes) >= cupo:
            if not messagebox.askyesno(
                    "Teletrabajo",
                    f"Ya tienes {cupo} día(s) de teletrabajo esta semana.\n"
                    "¿Marcar otro igualmente?"):
                return
        core.marcar_teletrabajo(d.isoformat())
        self.repintar_local()

    def _deshacer_borrado(self):
        """Restaura el último borrado (uno o varios apuntes)."""
        datos = self._ultimo_borrado
        if not datos:
            return
        self._ultimo_borrado = None
        self.btn_deshacer.pack_forget()
        self.status.config(text="Restaurando...")

        def trabajo():
            restaurados, errores, ultimo = 0, 0, ""
            for a in datos:
                try:
                    core.crear_entrada(a["fecha"], a["wp_id"], a["horas"],
                                       a["comentario"], a["actividad"])
                    restaurados += 1
                except Exception as ex:
                    errores += 1
                    ultimo = str(ex)
            return restaurados, errores, ultimo

        def al_terminar(res, err):
            if err:
                self.refrescar()
                messagebox.showerror("Error", f"No se pudo restaurar:\n{err}")
                return
            restaurados, errores, ultimo = res
            if errores:
                messagebox.showwarning(
                    "Restaurado con errores",
                    f"Restaurados: {restaurados}. Con errores: {errores}.\n"
                    f"Último error: {ultimo}")
            self._msg_pendiente = ("Apunte restaurado." if restaurados == 1
                                   else f"{restaurados} apuntes restaurados.")
            self.refrescar()

        self._en_hilo(trabajo, al_terminar)

    def _copiar_semana_anterior(self):
        """Copia los apuntes de la semana pasada a la semana visible, dia a dia."""
        dias = self._dias_semana()
        origen = [d - dt.timedelta(days=7) for d in dias]
        self.status.config(text="Leyendo la semana anterior...")

        def leer():
            return {d.isoformat(): core.entradas_dia(d.isoformat()) for d in origen}

        def leido(res, err):
            if err:
                self._actualizar_totales()
                messagebox.showerror("Error", f"No pude leer la semana anterior:\n{err}")
                return
            total = sum(len(v) for v in res.values())
            if not total:
                self._actualizar_totales()
                messagebox.showinfo(
                    "Copiar semana",
                    f"La semana del {origen[0].strftime('%d/%m')} no tiene apuntes.")
                return
            lineas = []
            for i, d_org in enumerate(origen):
                apuntes = res[d_org.isoformat()]
                if apuntes:
                    horas = sum(a["horas"] for a in apuntes)
                    lineas.append(f"  {core.DIAS_ES[i]}: {len(apuntes)} apunte(s), "
                                  f"{core._fmt(horas)}")
            if not messagebox.askyesno(
                    "Copiar semana anterior",
                    f"¿Copiar los {total} apuntes de la semana del "
                    f"{origen[0].strftime('%d/%m')} a esta semana, día a día?\n\n"
                    + "\n".join(lineas)
                    + "\n\n(Se saltan tareas ya registradas y días no laborables.)"):
                self._actualizar_totales()
                return
            cache = dict(self._cache_dia)
            self.status.config(text="Copiando semana...")

            def copiar():
                creados = saltados = errores = 0
                ultimo = ""
                for i, d_dest in enumerate(dias):
                    apuntes = res[origen[i].isoformat()]
                    if core.es_no_laborable(d_dest.isoformat()):
                        saltados += len(apuntes)
                        continue
                    existentes = cache.get(d_dest.isoformat()) or []
                    for a in apuntes:
                        if any(str(e.get("wp_id")) == str(a["wp_id"])
                               for e in existentes):
                            saltados += 1
                            continue
                        try:
                            core.crear_entrada(d_dest.isoformat(), a["wp_id"],
                                               a["horas"], a["comentario"],
                                               a["actividad"])
                            creados += 1
                        except Exception as ex:
                            errores += 1
                            ultimo = str(ex)
                return creados, saltados, errores, ultimo

            def copiado(res2, err2):
                if err2:
                    self.refrescar()
                    messagebox.showerror("Error", f"No se pudo copiar:\n{err2}")
                    return
                creados, saltados, errores, ultimo = res2
                msg = f"Semana copiada: {creados} apuntes."
                if saltados:
                    msg += f" Saltados {saltados}."
                if errores:
                    messagebox.showwarning(
                        "Copiado con errores",
                        f"{msg}\nErrores: {errores}. Último: {ultimo}")
                self._msg_pendiente = msg
                self.refrescar()

            self._en_hilo(copiar, copiado)

        self._en_hilo(leer, leido)

    def _copiar_anterior(self):
        """Copia los apuntes del ultimo dia laborable con horas a los dias marcados."""
        dias = self._dias_marcados()
        if not dias:
            messagebox.showwarning("Falta día", "Marca al menos un día de destino.")
            return
        primero = min(dias)
        self.status.config(text="Buscando el último día con horas...")

        def buscar():
            d = primero - dt.timedelta(days=1)
            for _ in range(14):
                if d.weekday() < 5:
                    apuntes = core.entradas_dia(d.isoformat())
                    if apuntes:
                        return d, apuntes
                d -= dt.timedelta(days=1)
            return None

        def encontrado(res, err):
            if err:
                self.status.config(text="")
                messagebox.showerror("Error", f"No pude buscar días anteriores:\n{err}")
                return
            if not res:
                self.status.config(text="")
                messagebox.showinfo(
                    "Copiar día",
                    f"No hay apuntes en los 14 días anteriores al {primero.strftime('%d/%m')}.")
                return
            origen, apuntes = res
            lineas = "\n".join(f"  - {core._fmt(a['horas'])}  {a['wp_titulo'][:40]}"
                               for a in apuntes)
            if not messagebox.askyesno(
                    "Copiar día",
                    f"¿Copiar los {len(apuntes)} apuntes del "
                    f"{core.DIAS_ES[origen.weekday()]} {origen.strftime('%d/%m')}:\n\n"
                    f"{lineas}\n\na {len(dias)} día(s) marcado(s)?\n"
                    "(Se saltan las tareas que ya tengan apunte ese día.)"):
                self.status.config(text="")
                self._actualizar_totales()
                return
            cache = dict(self._cache_dia)
            self.status.config(text="Copiando...")

            def copiar():
                creados = saltados = errores = 0
                ultimo = ""
                for d in dias:
                    existentes = cache.get(d.isoformat()) or []
                    for a in apuntes:
                        if any(str(e.get("wp_id")) == str(a["wp_id"])
                               for e in existentes):
                            saltados += 1
                            continue
                        try:
                            core.crear_entrada(d.isoformat(), a["wp_id"], a["horas"],
                                               a["comentario"], a["actividad"])
                            creados += 1
                        except Exception as ex:
                            errores += 1
                            ultimo = str(ex)
                return creados, saltados, errores, ultimo

            def copiado(res2, err2):
                if err2:
                    self.refrescar()
                    messagebox.showerror("Error", f"No se pudo copiar:\n{err2}")
                    return
                creados, saltados, errores, ultimo = res2
                msg = f"Copiados {creados} apuntes."
                if saltados:
                    msg += f" Saltados {saltados} (ya existían)."
                if errores:
                    messagebox.showwarning(
                        "Copiado con errores",
                        f"{msg}\nErrores: {errores}. Último: {ultimo}")
                self._msg_pendiente = msg
                self.refrescar()

            self._en_hilo(copiar, copiado)

        self._en_hilo(buscar, encontrado)

    def _anadir(self):
        dias = self._dias_marcados()
        if not dias:
            messagebox.showwarning("Falta día", "Marca al menos un día.")
            return
        txt = self.cbo_tarea.get().strip()
        wp_id = self._resolver_tarea(txt)
        if wp_id is None:
            messagebox.showwarning(
                "Falta tarea",
                "Elige una tarea del desplegable (puedes escribir para filtrar).")
            return
        txt = self.cbo_tarea.get()
        try:
            horas = float(self.ent_horas.get().strip().replace(",", "."))
            if not 0 < horas <= 24:
                raise ValueError
        except ValueError:
            messagebox.showwarning(
                "Horas", "Escribe un número de horas válido entre 0 y 24 (ej. 3 o 3.5).")
            return
        actividad = self.cbo_act.get() or None
        comentario = self.ent_com.get().strip()
        # El comentario de guardia se resuelve POR DIA: si el texto del campo
        # es el autorrelleno de guardia, solo se envia a los dias de guardia
        # (a un dia normal no le corresponde); y un dia de guardia lo recibe
        # aunque el campo haya quedado vacio o con otro autorrelleno.
        auto_guardia = (comentario == core.comentario_guardia())

        def comentario_para(d):
            if core.es_guardia(d.isoformat()):
                return comentario or core.comentario_guardia()
            return "" if auto_guardia else comentario

        if len(dias) > 1:
            if not messagebox.askyesno(
                    "Confirmar",
                    f"¿Añadir {core._fmt(horas)} de '{txt}' [{actividad}] a {len(dias)} días?"):
                return

        # Aviso 1: dias no laborables (festivo/vacaciones/cierre) -> permitir,
        # pero con un mensaje claro (una guardia en festivo es un caso real).
        nolab = []
        for d in dias:
            existentes = self._cache_dia.get(d.isoformat()) or []
            if any(str(e.get("wp_id")) == str(wp_id) for e in existentes):
                continue
            if core.es_no_laborable(d.isoformat()):
                nolab.append(f"{core.DIAS_ES[d.weekday()]} {d.strftime('%d/%m')} "
                             f"({core.motivo_no_laborable(d.isoformat())})")
        if nolab:
            plural = "estos días son no laborables" if len(nolab) > 1 else "ese día es no laborable"
            if not messagebox.askyesno(
                    "Día no laborable",
                    f"Vas a imputar horas aunque {plural}:\n  "
                    + "\n  ".join(nolab) + "\n\n¿Continuar igualmente?"):
                return

        # Aviso 2: en dias laborables, si con este apunte se supera la jornada
        exceso = []
        for d in dias:
            existentes = self._cache_dia.get(d.isoformat()) or []
            if any(str(e.get("wp_id")) == str(wp_id) for e in existentes):
                continue  # se saltara por duplicado, no suma
            if core.es_no_laborable(d.isoformat()):
                continue  # ya avisado arriba; su objetivo es 0
            reg = sum(a["horas"] for a in existentes)
            if reg + horas > core.objetivo_de(d) + 0.001:
                exceso.append(f"{core.DIAS_ES[d.weekday()]} {d.strftime('%d/%m')} "
                              f"({core._fmt(reg + horas)} de {core.objetivo_de(d)}h)")
        if exceso:
            if not messagebox.askyesno(
                    "Jornada superada",
                    "Con este apunte te pasarás de la jornada en:\n  "
                    + "\n  ".join(exceso) + "\n\n¿Continuar igualmente?"):
                return

        cache = dict(self._cache_dia)
        self._ultimo_borrado = None
        self.btn_deshacer.pack_forget()
        self.status.config(text="Registrando...")
        self.btn_anadir.config(state="disabled")

        def trabajo():
            creados = saltados = errores = 0
            ultimo_error = ""
            for d in dias:
                existentes = cache.get(d.isoformat()) or []
                if any(str(e.get("wp_id")) == str(wp_id) for e in existentes):
                    saltados += 1
                    continue
                try:
                    core.crear_entrada(d.isoformat(), wp_id, horas,
                                       comentario_para(d), actividad)
                    creados += 1
                except Exception as ex:
                    errores += 1
                    ultimo_error = str(ex)
            return creados, saltados, errores, ultimo_error

        def al_terminar(res, err):
            self.btn_anadir.config(state="normal")
            if err:
                self.refrescar()
                messagebox.showerror("No se pudo registrar", f"Error inesperado:\n{err}")
                return
            creados, saltados, errores, ultimo_error = res
            self.ent_horas.delete(0, "end")
            self._horas_auto = ""
            self.ent_com.delete(0, "end")
            self._com_auto = ""
            # El comentario de guardia no es "habitual de la tarea": no debe
            # persistirse ni sugerirse luego en dias normales.
            if creados and comentario and comentario != core.comentario_guardia():
                self._recordar_comentario(wp_id, comentario)
            if errores and creados == 0:
                self.refrescar()
                messagebox.showerror(
                    "No se pudo registrar",
                    f"No se creó ningún apunte.\n\nDetalle: {ultimo_error}")
                return
            if errores:
                self.refrescar()
                messagebox.showwarning(
                    "Registrado con errores",
                    f"Añadidos: {creados}. Con errores: {errores}.\n"
                    f"Último error: {ultimo_error}")
                return
            if creados:
                msg = f"Apunte añadido ({creados})."
                if saltados:
                    msg += f" Saltados {saltados} (ya existían)."
            else:
                msg = "Esa tarea ya estaba registrada en los días marcados; no se añadió nada."
            self._msg_pendiente = msg
            self.refrescar()

        self._en_hilo(trabajo, al_terminar)

    def _eliminar(self):
        """Elimina TODOS los apuntes seleccionados (Ctrl/Mayús: varios)."""
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo("Eliminar", "Selecciona uno o más apuntes en la lista.")
            return
        # (entry_id, datos-para-deshacer) de cada apunte seleccionado
        apuntes = []
        for item in sel:
            tags = self.tree.item(item, "tags")
            if not tags:
                continue
            entry_id = tags[0]
            fecha = tags[1] if len(tags) > 1 else ""
            destino = tags[3] if len(tags) > 3 else "op"
            datos = None
            # Deshacer solo para ProyectosTIC (recrear un slot de INARI no es 1:1)
            if destino == "op":
                for a in (self._cache_dia.get(fecha) or []):
                    if str(a["id"]) == str(entry_id):
                        datos = {"fecha": fecha, "wp_id": a["wp_id"], "horas": a["horas"],
                                 "comentario": a["comentario"], "actividad": a["actividad"]}
                        break
            apuntes.append((entry_id, destino, datos))
        if not apuntes:
            return
        pregunta = ("¿Seguro que quieres eliminar este apunte?" if len(apuntes) == 1
                    else f"¿Seguro que quieres eliminar estos {len(apuntes)} apuntes?")
        if not messagebox.askyesno("Eliminar", pregunta):
            return
        self.status.config(text="Eliminando...")

        def trabajo():
            eliminados, errores, ultimo = [], 0, ""
            for entry_id, destino, datos in apuntes:
                try:
                    if destino == "inari":
                        destinos.borrar(entry_id)
                    else:
                        core.eliminar_entrada(entry_id)
                    if datos:
                        eliminados.append(datos)
                except Exception as ex:
                    errores += 1
                    ultimo = str(ex)
            return eliminados, errores, ultimo

        def al_terminar(res, err):
            if err:
                self.refrescar()
                messagebox.showerror("Error", f"No se pudo eliminar:\n{err}")
                return
            eliminados, errores, ultimo = res
            self._ultimo_borrado = eliminados or None
            if eliminados:
                self.btn_deshacer.pack(side="right", padx=4)
            if errores:
                messagebox.showwarning(
                    "Eliminado con errores",
                    f"Eliminados: {len(eliminados)}. Con errores: {errores}.\n"
                    f"Último error: {ultimo}")
            self._msg_pendiente = ("Apunte eliminado." if len(eliminados) == 1
                                   else f"{len(eliminados)} apuntes eliminados.")
            self.refrescar()

        self._en_hilo(trabajo, al_terminar)


def main():
    # Modo aviso: lo lanza la tarea programada de Windows (o --recordatorio a mano)
    if "--recordatorio" in sys.argv[1:]:
        recordatorio.main()
        return
    root = tk.Tk()
    aplicar_estilo(root)
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
