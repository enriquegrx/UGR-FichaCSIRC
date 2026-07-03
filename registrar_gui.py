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
import sys
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
import recordatorio
from fichaui import Tooltip, en_hilo, recurso, carpeta_app


class App:
    def __init__(self, root):
        self.root = root
        root.title(f"FichaCSIRC {core.VERSION} - Registro de horas")
        root.geometry("780x680")
        root.minsize(700, 620)
        geo = core.config_valor("ventana")
        if isinstance(geo, str) and "x" in geo:
            try:
                root.geometry(geo)
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
        self._card_bg = root.cget("bg")
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
            version, url = res
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
        header = ttk.Frame(self.root, padding=(10, 8))
        header.pack(fill="x")
        logo_path = self._recurso("logo_ugr.png")
        if os.path.exists(logo_path):
            try:
                self._logo_img = tk.PhotoImage(file=logo_path)
                ttk.Label(header, image=self._logo_img).pack(side="left", padx=(0, 12))
            except Exception:
                self._logo_img = None
        ttk.Label(header, text="FichaCSIRC",
                  font=("Segoe UI", 17, "bold")).pack(side="left")
        ttk.Label(header, text="Registro de horas - OpenProject",
                  foreground="#666").pack(side="left", padx=12)
        self.lbl_user = ttk.Label(header, text="", foreground="#444",
                                  font=("Segoe UI", 10))
        self.lbl_user.pack(side="right", padx=(0, 4))
        ttk.Separator(self.root, orient="horizontal").pack(fill="x", padx=8)

        # Barra superior: navegacion semanal
        top = ttk.Frame(self.root, padding=8)
        top.pack(fill="x")
        ttk.Button(top, text="< Semana", command=self._semana_ant).pack(side="left")
        self.lbl_semana = ttk.Label(top, text="", font=("Segoe UI", 10, "bold"))
        self.lbl_semana.pack(side="left", expand=True)
        ttk.Button(top, text="Semana >", command=self._semana_sig).pack(side="left")
        ttk.Button(top, text="Hoy", command=self._ir_hoy).pack(side="left", padx=(8, 0))
        b_exp = ttk.Button(top, text="Exportar CSV...", command=self._exportar)
        b_exp.pack(side="right", padx=(8, 0))
        Tooltip(b_exp, "Exporta tus apuntes a CSV por rango de fechas")
        b_mes = ttk.Button(top, text="Resumen mes", command=self._resumen_mes)
        b_mes.pack(side="right", padx=(8, 0))
        Tooltip(b_mes, "Horas del mes: registradas, objetivo y días incompletos")

        # Dias (tarjetas con estado)
        self.var_semana = tk.BooleanVar(value=False)
        diaf = ttk.LabelFrame(self.root, text="Días (clic para marcar uno o varios)", padding=8)
        diaf.pack(fill="x", padx=8)
        self.dias_frame = ttk.Frame(diaf)
        self.dias_frame.pack(fill="x")
        fila2 = ttk.Frame(diaf)
        fila2.pack(fill="x", pady=(6, 0))
        ttk.Checkbutton(fila2, text="Toda la semana", variable=self.var_semana,
                        command=self._toggle_semana).pack(side="left")
        b_pla = ttk.Button(fila2, text="Plantillas...", command=self._plantillas)
        b_pla.pack(side="left", padx=(12, 0))
        Tooltip(b_pla, "Guarda un día típico y aplícalo de un clic")
        b_sem = ttk.Button(fila2, text="Copiar semana anterior",
                           command=self._copiar_semana_anterior)
        b_sem.pack(side="right")
        Tooltip(b_sem, "Repite toda la semana pasada en esta, día a día")
        b_cop = ttk.Button(fila2, text="Copiar día anterior",
                           command=self._copiar_anterior)
        b_cop.pack(side="right", padx=(0, 8))
        Tooltip(b_cop, "Repite en los días marcados los apuntes del último día con horas\n"
                       "(botón derecho en un día: marcarlo como festivo/vacaciones)")

        # Lista de apuntes
        midf = ttk.LabelFrame(self.root, text="Apuntes de los días marcados", padding=8)
        midf.pack(fill="both", expand=True, padx=8, pady=6)
        cols = ("dia", "horas", "tarea", "actividad", "comentario")
        self.tree = ttk.Treeview(midf, columns=cols, show="headings", height=8)
        for c, txt, w in [("dia", "Día", 90), ("horas", "Horas", 55),
                          ("tarea", "Tarea", 240), ("actividad", "Actividad", 110),
                          ("comentario", "Comentario", 150)]:
            self.tree.heading(c, text=txt)
            self.tree.column(c, width=w, anchor="w")
        self.tree.pack(side="left", fill="both", expand=True)
        sb = ttk.Scrollbar(midf, orient="vertical", command=self.tree.yview)
        sb.pack(side="right", fill="y")
        self.tree.configure(yscrollcommand=sb.set)
        self.tree.bind("<Double-1>", self._editar)
        b_del = ttk.Button(self.root, text="Eliminar apunte seleccionado",
                           command=self._eliminar)
        b_del.pack(anchor="e", padx=8)
        Tooltip(b_del, "También con la tecla Supr. Doble clic en un apunte lo edita.")

        # Formulario anadir
        form = ttk.LabelFrame(self.root, text="Añadir apunte", padding=8)
        form.pack(fill="x", padx=8, pady=6)

        ttk.Label(form, text="Tarea:").grid(row=0, column=0, sticky="w")
        self.cbo_tarea = ttk.Combobox(form, width=46)
        self.cbo_tarea.grid(row=0, column=1, columnspan=2, sticky="we", padx=4, pady=2)
        self.cbo_tarea.bind("<KeyRelease>", self._filtrar_tareas)
        Tooltip(self.cbo_tarea, "Escribe para filtrar tus tareas favoritas")
        b_buscar = ttk.Button(form, text="Buscar...", command=self._buscar_tarea)
        b_buscar.grid(row=0, column=3, padx=4)
        Tooltip(b_buscar, "Busca tareas por proyecto (Ctrl/Mayús para elegir varias)")

        ttk.Label(form, text="Horas:").grid(row=1, column=0, sticky="w")
        self.ent_horas = ttk.Entry(form, width=8)
        self.ent_horas.grid(row=1, column=1, sticky="w", padx=4, pady=2)

        ttk.Label(form, text="Actividad:").grid(row=1, column=2, sticky="e")
        self.cbo_act = ttk.Combobox(form, state="readonly", width=22)
        self.cbo_act.grid(row=1, column=3, sticky="w", padx=4)

        ttk.Label(form, text="Comentario:").grid(row=2, column=0, sticky="w")
        self.ent_com = ttk.Entry(form, width=50)
        self.ent_com.grid(row=2, column=1, columnspan=2, sticky="we", padx=4, pady=2)

        self.btn_anadir = ttk.Button(form, text="Añadir a días marcados",
                                     command=self._anadir)
        self.btn_anadir.grid(row=2, column=3, padx=4)
        form.columnconfigure(1, weight=1)

        # Atajos: Enter anade, Supr elimina, F5 recarga, Ctrl+Z deshace el borrado
        self.ent_horas.bind("<Return>", lambda _e: self._anadir())
        self.ent_com.bind("<Return>", lambda _e: self._anadir())
        self.tree.bind("<Delete>", lambda _e: self._eliminar())
        self.root.bind("<F5>", lambda _e: self.refrescar())
        self.root.bind("<Control-z>", lambda _e: self._deshacer_borrado())

        # Barra de estado (+ boton Deshacer que aparece tras eliminar)
        barra = ttk.Frame(self.root)
        barra.pack(fill="x", side="bottom")
        self.btn_deshacer = ttk.Button(barra, text="Deshacer",
                                       command=self._deshacer_borrado)
        Tooltip(self.btn_deshacer, "Restaura el último apunte eliminado (Ctrl+Z)")
        # Pie: version, fecha de build y repositorio
        pie_txt = f"v{core.VERSION} · build {self._fecha_build()}"
        pie = ttk.Label(barra, text=pie_txt, foreground="#888", padding=(6, 4))
        pie.pack(side="right")
        if core.GITHUB_REPO:
            pie.configure(text=f"{pie_txt} · github.com/{core.GITHUB_REPO}",
                          foreground="#0067c0", cursor="hand2")
            pie.bind("<Button-1>", lambda _e: webbrowser.open(
                f"https://github.com/{core.GITHUB_REPO}"))
            Tooltip(pie, "Abrir el repositorio en GitHub")
        self.status = ttk.Label(barra, text="", relief="sunken", anchor="w", padding=4)
        self.status.pack(side="left", fill="x", expand=True)

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
        m_herr.add_command(label="Aviso diario de fichaje...",
                           command=self._config_recordatorio)
        barra.add_cascade(label="Herramientas", menu=m_herr)

        m_ayuda = tk.Menu(barra, tearoff=0)
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

    def _acerca_de(self):
        messagebox.showinfo(
            "Acerca de FichaCSIRC",
            f"FichaCSIRC v{core.VERSION}\n"
            f"Compilación: {self._fecha_build()}\n\n"
            "Registro de horas en OpenProject (ProyectosTic, UGR).\n"
            + (f"github.com/{core.GITHUB_REPO}" if core.GITHUB_REPO else ""))

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
        self._refresco_seq += 1
        seq = self._refresco_seq
        dias = self._dias_semana()

        def trabajo():
            cache, fallos = {}, 0
            for d in dias:
                try:
                    cache[d.isoformat()] = core.entradas_dia(d.isoformat())
                except Exception:
                    cache[d.isoformat()] = None
                    fallos += 1
            return cache, fallos, core.nombre_usuario()

        def al_terminar(res, err):
            if seq != self._refresco_seq:
                return  # llego tarde: ya se pidio otra semana
            cache, fallos, nombre = res if res else ({}, len(dias), "")
            self._pintar_semana(dias, cache, fallos, nombre)

        self._en_hilo(trabajo, al_terminar)

    def _pintar_semana(self, dias, cache, fallos, nombre):
        self._cache_dia = cache
        hoy = dt.date.today()
        for w in self.dias_frame.winfo_children():
            w.destroy()
        self.dia_vars = []
        for i, d in enumerate(dias):
            self.dias_frame.columnconfigure(i, weight=1, uniform="dias")
            apuntes = cache.get(d.isoformat())
            reg = sum(a["horas"] for a in apuntes) if apuntes else 0
            obj = core.objetivo_de(d)
            nolab = core.es_no_laborable(d.isoformat())
            es_hoy = (d == hoy)
            var = tk.BooleanVar(value=es_hoy)

            card = tk.Frame(self.dias_frame, highlightthickness=2, cursor="hand2")
            card.grid(row=0, column=i, padx=3, pady=2, sticky="nsew")
            fnt = ("Segoe UI", 9, "bold") if es_hoy else ("Segoe UI", 9)
            titulo = f"{core.DIAS_ES[i]} {d.strftime('%d/%m')}" + ("  · hoy" if es_hoy else "")
            lbl1 = tk.Label(card, text=titulo, font=fnt, anchor="w")
            lbl1.pack(fill="x", padx=8, pady=(5, 2))
            cv = tk.Canvas(card, height=8, highlightthickness=0)
            cv.pack(fill="x", padx=8)
            if nolab:
                frac, color = 1.0, "#8fa8bf"
                texto2 = core.motivo_no_laborable(d.isoformat()).capitalize()
                if reg:
                    texto2 = f"{core._fmt(reg)} · {texto2}"
            elif apuntes is None:
                frac, color, texto2 = 0.0, "#b00020", "sin conexión"
            elif reg > obj + 0.001:
                frac, color = 1.0, "#c62828"
                texto2 = f"{core._fmt(reg)} / {obj}h  (te pasas)"
            elif reg >= obj - 0.001 and reg > 0:
                frac, color = 1.0, "#2e9e4f"
                texto2 = f"{core._fmt(reg)} / {obj}h  ✔"
            elif reg > 0:
                frac, color = (reg / obj if obj else 0.0), "#e8a000"
                texto2 = f"{core._fmt(reg)} / {obj}h"
            else:
                frac, color = 0.0, "#9a9a9a"
                texto2 = f"0h / {obj}h"
            lbl2 = tk.Label(card, text=texto2, font=("Segoe UI", 9),
                            fg=color, anchor="w")
            lbl2.pack(fill="x", padx=8, pady=(2, 5))

            def dibujar(_e=None, cv=cv, frac=frac, color=color):
                cv.delete("all")
                ancho = max(cv.winfo_width(), 1)
                cv.create_rectangle(0, 0, ancho, 8, fill="#e3e3e3", width=0)
                if frac > 0:
                    cv.create_rectangle(0, 0, int(ancho * frac), 8,
                                        fill=color, width=0)
            cv.bind("<Configure>", dibujar)
            for wdg in (card, lbl1, cv, lbl2):
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
        else:
            self._aviso_con = False
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
            bg = "#e7f1fb" if sel else self._card_bg
            borde = "#0067c0" if sel else "#c9c9c9"
            card.configure(bg=bg, highlightbackground=borde, highlightcolor=borde)
            for ch in card.winfo_children():
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
        for d in self._dias_marcados():
            apuntes = self._cache_dia.get(d.isoformat())
            if apuntes is None:
                continue
            for a in apuntes:
                self.tree.insert("", "end",
                                 values=(f"{core.DIAS_ES[d.weekday()][:3]} {d.strftime('%d/%m')}",
                                         core._fmt(a["horas"]),
                                         a["wp_titulo"], a["actividad"], a["comentario"]),
                                 tags=(str(a["id"]), d.isoformat()))
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
                return
            apuntes = self._cache_dia.get(d.isoformat())
            reg = sum(a["horas"] for a in apuntes) if apuntes else 0
            obj = core.objetivo_de(d)
            falta = obj - reg
            extra = (f"faltan {core._fmt(falta)}" if falta > 0.001
                     else ("completo" if abs(falta) < 0.001 else f"te pasas {core._fmt(-falta)}"))
            self.status.config(text=f"{etiqueta}: {core._fmt(reg)}/{obj}h  ({extra})")
            self._sugerir_horas(falta)
        elif marcados:
            self.status.config(text=f"{len(marcados)} días marcados")
        else:
            self.status.config(text="Marca al menos un día")

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
        dialogos.abrir_editar(self)

    def _resumen_mes(self):
        dialogos.abrir_resumen_mes(self)

    def _plantillas(self):
        dialogos.abrir_plantillas(self)

    # ---------- acciones del dia/semana ----------
    def _menu_dia(self, evento, d):
        """Menu contextual de una tarjeta: marcar/quitar dia no laborable."""
        fecha = d.isoformat()
        menu = tk.Menu(self.root, tearoff=0)
        if core.es_no_laborable(fecha):
            menu.add_command(
                label=f"Quitar marca ({core.motivo_no_laborable(fecha)})",
                command=lambda: (core.quitar_no_laborable(fecha), self.refrescar()))
        else:
            sub = tk.Menu(menu, tearoff=0)
            for motivo in ("festivo", "vacaciones", "asuntos propios", "baja"):
                sub.add_command(
                    label=motivo.capitalize(),
                    command=lambda m=motivo: (core.marcar_no_laborable(fecha, m),
                                              self.refrescar()))
            menu.add_cascade(label="Marcar como no laborable", menu=sub)
        menu.tk_popup(evento.x_root, evento.y_root)

    def _deshacer_borrado(self):
        datos = self._ultimo_borrado
        if not datos:
            return
        self._ultimo_borrado = None
        self.btn_deshacer.pack_forget()
        self.status.config(text="Restaurando apunte...")

        def al_terminar(res, err):
            if err:
                self.refrescar()
                messagebox.showerror("Error", f"No se pudo restaurar el apunte:\n{err}")
                return
            self._msg_pendiente = "Apunte restaurado."
            self.refrescar()

        self._en_hilo(lambda: core.crear_entrada(
            datos["fecha"], datos["wp_id"], datos["horas"],
            datos["comentario"], datos["actividad"]), al_terminar)

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

        if len(dias) > 1:
            if not messagebox.askyesno(
                    "Confirmar",
                    f"¿Añadir {core._fmt(horas)} de '{txt}' [{actividad}] a {len(dias)} días?"):
                return

        # Aviso si con este apunte algun dia supera su jornada
        exceso = []
        for d in dias:
            existentes = self._cache_dia.get(d.isoformat()) or []
            if any(str(e.get("wp_id")) == str(wp_id) for e in existentes):
                continue  # se saltara por duplicado, no suma
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
                    core.crear_entrada(d.isoformat(), wp_id, horas, comentario, actividad)
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
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo("Eliminar", "Selecciona un apunte en la lista.")
            return
        tags = self.tree.item(sel[0], "tags")
        if not tags:
            return
        entry_id = tags[0]
        fecha = tags[1] if len(tags) > 1 else ""
        # guardar los datos por si el usuario quiere deshacer
        datos = None
        for a in (self._cache_dia.get(fecha) or []):
            if str(a["id"]) == str(entry_id):
                datos = {"fecha": fecha, "wp_id": a["wp_id"], "horas": a["horas"],
                         "comentario": a["comentario"], "actividad": a["actividad"]}
                break
        if not messagebox.askyesno("Eliminar", "¿Seguro que quieres eliminar este apunte?"):
            return
        self.status.config(text="Eliminando...")

        def al_terminar(res, err):
            if err:
                self.refrescar()
                messagebox.showerror("Error", f"No se pudo eliminar el apunte:\n{err}")
                return
            self._ultimo_borrado = datos
            if datos:
                self.btn_deshacer.pack(side="right", padx=4)
            self._msg_pendiente = "Apunte eliminado."
            self.refrescar()

        self._en_hilo(lambda: core.eliminar_entrada(entry_id), al_terminar)


def main():
    # Modo aviso: lo lanza la tarea programada de Windows (o --recordatorio a mano)
    if "--recordatorio" in sys.argv[1:]:
        recordatorio.main()
        return
    root = tk.Tk()
    try:
        ttk.Style().theme_use("vista")
    except Exception:
        pass
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
