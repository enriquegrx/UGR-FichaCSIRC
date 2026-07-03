#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dialogos.py - Ventanas secundarias (Toplevel) de FichaCSIRC.

Cada funcion recibe `app` (la ventana principal, registrar_gui.App) y opera
sobre ella: lee su cache de dias, lanza trabajo en hilo, refresca al terminar.
Separarlas de la ventana principal mantiene registrar_gui.py enfocado en el
flujo del dia a dia.
"""

import os
import csv
import calendar
import datetime as dt
import tkinter as tk
from tkinter import ttk, messagebox, filedialog, simpledialog

import rellenar_horas as core
from fichaui import en_hilo


def abrir_editar(app):
    """Doble clic en un apunte: editar horas, actividad y comentario."""
    sel = app.tree.selection()
    if not sel:
        return
    tags = app.tree.item(sel[0], "tags")
    if len(tags) < 2:
        return
    entry_id, fecha = tags[0], tags[1]
    apunte = None
    for a in (app._cache_dia.get(fecha) or []):
        if str(a["id"]) == str(entry_id):
            apunte = a
            break
    if not apunte:
        return
    top = tk.Toplevel(app.root)
    top.title("Editar apunte")
    top.transient(app.root)
    top.grab_set()
    frm = ttk.Frame(top, padding=12)
    frm.pack(fill="both", expand=True)
    ttk.Label(frm, text=apunte["wp_titulo"],
              font=("Segoe UI", 10, "bold")).grid(row=0, column=0,
                                                  columnspan=2, sticky="w")
    ttk.Label(frm, text=f"Fecha: {fecha}").grid(row=1, column=0, columnspan=2,
                                                sticky="w", pady=(0, 8))
    ttk.Label(frm, text="Horas:").grid(row=2, column=0, sticky="w", pady=3)
    e_h = ttk.Entry(frm, width=8)
    e_h.insert(0, f"{apunte['horas']:g}")
    e_h.grid(row=2, column=1, sticky="w", padx=6)
    ttk.Label(frm, text="Actividad:").grid(row=3, column=0, sticky="w", pady=3)
    c_a = ttk.Combobox(frm, state="readonly", width=24,
                       values=list(app.cbo_act["values"]))
    if apunte["actividad"]:
        c_a.set(apunte["actividad"])
    c_a.grid(row=3, column=1, sticky="w", padx=6)
    ttk.Label(frm, text="Comentario:").grid(row=4, column=0, sticky="w", pady=3)
    e_c = ttk.Entry(frm, width=42)
    e_c.insert(0, apunte["comentario"])
    e_c.grid(row=4, column=1, sticky="we", padx=6)
    frm.columnconfigure(1, weight=1)

    def guardar():
        try:
            horas = float(e_h.get().strip().replace(",", "."))
            if not 0 < horas <= 24:
                raise ValueError
        except ValueError:
            messagebox.showwarning("Horas", "Escribe un número de horas válido.",
                                   parent=top)
            return
        actividad = c_a.get() or None
        comentario = e_c.get().strip()
        top.destroy()
        app.status.config(text="Guardando cambios...")

        def al_terminar(res, err):
            if err:
                app.refrescar()
                messagebox.showerror("Error", f"No se pudo actualizar:\n{err}")
                return
            app._msg_pendiente = "Apunte actualizado."
            app.refrescar()

        en_hilo(app.root, lambda: core.actualizar_entrada(
            entry_id, horas, comentario, actividad, apunte["wp_id"]), al_terminar)

    e_h.bind("<Return>", lambda _e: guardar())
    e_c.bind("<Return>", lambda _e: guardar())
    btns = ttk.Frame(frm)
    btns.grid(row=5, column=0, columnspan=2, sticky="e", pady=(10, 0))
    ttk.Button(btns, text="Guardar", command=guardar).pack(side="right", padx=4)
    ttk.Button(btns, text="Cancelar", command=top.destroy).pack(side="right")


def abrir_resumen_mes(app):
    ref = app.lunes + dt.timedelta(days=3)  # jueves: mes dominante de la semana
    anio, mes = ref.year, ref.month
    top = tk.Toplevel(app.root)
    top.title(f"Resumen de {ref.strftime('%m/%Y')}")
    top.transient(app.root)
    top.grab_set()
    frm = ttk.Frame(top, padding=14)
    frm.pack(fill="both", expand=True)
    lbl = ttk.Label(frm, text="Consultando el mes...", justify="left",
                    font=("Consolas", 10))
    lbl.pack(anchor="w")
    ttk.Button(frm, text="Cerrar",
               command=top.destroy).pack(anchor="e", pady=(12, 0))

    ultimo = calendar.monthrange(anio, mes)[1]
    dias = [dt.date(anio, mes, n) for n in range(1, ultimo + 1)]
    hoy = dt.date.today()

    def trabajo():
        total = obj_hasta_hoy = obj_mes = 0.0
        incompletos = []
        for d in dias:
            if d.weekday() >= 5:
                continue
            obj = core.objetivo_de(d)
            obj_mes += obj
            reg = sum(a["horas"] for a in core.entradas_dia(d.isoformat()))
            total += reg
            if d <= hoy:
                obj_hasta_hoy += obj
                if obj and reg < obj - 0.001:
                    incompletos.append((d, reg, obj))
        return total, obj_hasta_hoy, obj_mes, incompletos

    def al_terminar(res, err):
        if not top.winfo_exists():
            return
        if err:
            lbl.config(text=f"No se pudo consultar el mes:\n{err}")
            return
        total, obj_hoy, obj_mes, incompletos = res
        if total < obj_hoy - 0.001:
            estado = f"   (te faltan {core._fmt(obj_hoy - total)})"
        else:
            estado = "   (al día ✔)"
        lineas = [
            f"Registrado en el mes: {core._fmt(total)}",
            f"Objetivo hasta hoy:   {core._fmt(obj_hoy)}{estado}",
            f"Objetivo del mes:     {core._fmt(obj_mes)}",
        ]
        if incompletos:
            lineas += ["", "Días incompletos:"]
            for d, reg, obj in incompletos:
                lineas.append(f"  {core.DIAS_ES[d.weekday()]} {d.strftime('%d/%m')}:"
                              f" {core._fmt(reg)} / {obj}h")
        lbl.config(text="\n".join(lineas))

    en_hilo(app.root, trabajo, al_terminar)


def abrir_plantillas(app):
    top = tk.Toplevel(app.root)
    top.title("Plantillas de apuntes")
    top.transient(app.root)
    top.grab_set()
    frm = ttk.Frame(top, padding=10)
    frm.pack(fill="both", expand=True)
    ttk.Label(frm, text="Una plantilla guarda los apuntes de un día típico\n"
                        "para aplicarlos de golpe a los días marcados.",
              foreground="#666").pack(anchor="w")
    lb = tk.Listbox(frm, height=8, exportselection=False)
    lb.pack(fill="both", expand=True, pady=6)

    def repintar():
        lb.delete(0, "end")
        for p in core.PLANTILLAS:
            n = len(p.get("apuntes", []))
            tot = sum(a.get("horas", 0) for a in p.get("apuntes", []))
            lb.insert("end", f"{p['nombre']}  ({n} apuntes, {core._fmt(tot)})")
    repintar()

    def guardar_actual():
        marcados = app._dias_marcados()
        if len(marcados) != 1:
            messagebox.showwarning(
                "Plantilla", "Marca exactamente un día (el que quieres guardar).",
                parent=top)
            return
        d = marcados[0]
        apuntes = app._cache_dia.get(d.isoformat()) or []
        if not apuntes:
            messagebox.showinfo("Plantilla", "Ese día no tiene apuntes.", parent=top)
            return
        nombre = simpledialog.askstring("Plantilla", "Nombre de la plantilla:",
                                        parent=top)
        if not nombre or not nombre.strip():
            return
        core.guardar_plantilla(nombre.strip(), [
            {"id": a["wp_id"], "nombre": a["wp_titulo"], "horas": a["horas"],
             "comentario": a["comentario"], "actividad": a["actividad"]}
            for a in apuntes])
        repintar()

    def aplicar():
        sel = lb.curselection()
        if not sel:
            messagebox.showinfo("Plantilla", "Elige una plantilla de la lista.",
                                parent=top)
            return
        plantilla = core.PLANTILLAS[sel[0]]
        dias = app._dias_marcados()
        if not dias:
            messagebox.showwarning("Plantilla", "Marca al menos un día de destino.",
                                   parent=top)
            return
        if not messagebox.askyesno(
                "Plantilla",
                f"¿Aplicar '{plantilla['nombre']}' "
                f"({len(plantilla['apuntes'])} apuntes) a {len(dias)} día(s)?\n"
                "(Se saltan las tareas que ya tengan apunte ese día.)",
                parent=top):
            return
        top.destroy()
        cache = dict(app._cache_dia)
        app.status.config(text="Aplicando plantilla...")

        def trabajo():
            creados = saltados = errores = 0
            ultimo = ""
            for d in dias:
                existentes = cache.get(d.isoformat()) or []
                for a in plantilla["apuntes"]:
                    if any(str(e.get("wp_id")) == str(a["id"])
                           for e in existentes):
                        saltados += 1
                        continue
                    try:
                        core.crear_entrada(d.isoformat(), a["id"], a["horas"],
                                           a.get("comentario", ""),
                                           a.get("actividad"))
                        creados += 1
                    except Exception as ex:
                        errores += 1
                        ultimo = str(ex)
            return creados, saltados, errores, ultimo

        def al_terminar(res, err):
            if err:
                app.refrescar()
                messagebox.showerror("Error", f"No se pudo aplicar:\n{err}")
                return
            creados, saltados, errores, ultimo = res
            msg = f"Plantilla aplicada: {creados} apuntes."
            if saltados:
                msg += f" Saltados {saltados} (ya existían)."
            if errores:
                messagebox.showwarning(
                    "Con errores", f"{msg}\nErrores: {errores}. Último: {ultimo}")
            app._msg_pendiente = msg
            app.refrescar()

        en_hilo(app.root, trabajo, al_terminar)

    def borrar():
        sel = lb.curselection()
        if not sel:
            return
        nombre = core.PLANTILLAS[sel[0]]["nombre"]
        if messagebox.askyesno("Plantilla", f"¿Eliminar la plantilla '{nombre}'?",
                               parent=top):
            core.eliminar_plantilla(nombre)
            repintar()

    btns = ttk.Frame(frm)
    btns.pack(fill="x")
    ttk.Button(btns, text="Aplicar a días marcados",
               command=aplicar).pack(side="left")
    ttk.Button(btns, text="Guardar día marcado como plantilla",
               command=guardar_actual).pack(side="left", padx=6)
    ttk.Button(btns, text="Eliminar", command=borrar).pack(side="left")
    ttk.Button(btns, text="Cerrar", command=top.destroy).pack(side="right")


def abrir_buscar_tarea(app):
    top = tk.Toplevel(app.root)
    top.title("Buscar tarea")
    top.geometry("580x480")
    top.transient(app.root)
    top.grab_set()
    frm = ttk.Frame(top, padding=10)
    frm.pack(fill="both", expand=True)

    ttk.Label(frm, text="Proyecto:").grid(row=0, column=0, sticky="w")
    cbo = ttk.Combobox(frm, state="readonly", width=52)
    cbo.grid(row=0, column=1, sticky="we", padx=4, pady=3)
    ttk.Label(frm, text="Filtro:").grid(row=1, column=0, sticky="w")
    ent = ttk.Entry(frm)
    ent.grid(row=1, column=1, sticky="we", padx=4, pady=3)
    lb = tk.Listbox(frm, height=16, selectmode="extended", exportselection=False)
    lb.grid(row=2, column=0, columnspan=2, sticky="nsew", pady=6)
    sb = ttk.Scrollbar(frm, orient="vertical", command=lb.yview)
    sb.grid(row=2, column=2, sticky="ns")
    lb.configure(yscrollcommand=sb.set)
    estado = ttk.Label(frm, text="Cargando proyectos...")
    estado.grid(row=3, column=0, columnspan=2, sticky="w")
    var_fav = tk.BooleanVar(value=False)
    ttk.Checkbutton(frm, text="Añadir también a favoritas (se guarda en la configuración)",
                    variable=var_fav).grid(row=4, column=0, columnspan=2,
                                           sticky="w", pady=(4, 0))
    frm.rowconfigure(2, weight=1)
    frm.columnconfigure(1, weight=1)

    estado_data = {"tareas": [], "filtradas": []}
    proyectos = []
    carga_seq = [0]

    def proyectos_cargados(res, err):
        if not top.winfo_exists():
            return
        if err:
            top.destroy()
            messagebox.showerror("Sin conexión",
                                 f"No pude cargar los proyectos de ProyectosTic:\n{err}")
            return
        if not res:
            top.destroy()
            messagebox.showinfo("Buscar", "No apareces asignado a ningún proyecto.")
            return
        proyectos[:] = res
        cbo["values"] = [f"{p['id']} - {p['nombre']}" for p in proyectos]
        estado.config(text=f"{len(proyectos)} proyectos. Elige uno para ver sus tareas.")

    en_hilo(app.root, core.proyectos, proyectos_cargados)

    def pintar(*_):
        f = ent.get().strip().lower()
        lb.delete(0, "end")
        estado_data["filtradas"] = [
            t for t in estado_data["tareas"]
            if f in t["nombre"].lower() or f in str(t["id"])]
        for t in estado_data["filtradas"]:
            lb.insert("end", f"{t['id']} - {t['nombre']}")

    def cargar(*_):
        idx = cbo.current()
        if idx < 0:
            return
        estado.config(text="Cargando tareas...")
        pid = proyectos[idx]["id"]
        carga_seq[0] += 1
        seq = carga_seq[0]

        def tareas_cargadas(res, err):
            if not top.winfo_exists() or seq != carga_seq[0]:
                return  # dialogo cerrado o ya se pidio otro proyecto
            if err:
                estado.config(text="")
                if "403" in str(err):
                    messagebox.showinfo(
                        "Sin permiso",
                        "No tienes permiso para ver las tareas de este proyecto.\n"
                        "Elige otro proyecto.", parent=top)
                else:
                    messagebox.showerror(
                        "Error", f"No pude cargar las tareas:\n{err}", parent=top)
                return
            estado_data["tareas"] = res
            pintar()
            estado.config(text=f"{len(res)} tareas. "
                               "Filtra y elige (Ctrl o Mayús: varias).")

        en_hilo(app.root, lambda: core.tareas_proyecto(pid), tareas_cargadas)

    def elegir(*_):
        sels = lb.curselection()
        if not sels:
            return
        nuevas = [estado_data["filtradas"][i] for i in sels]
        for t in reversed(nuevas):
            if var_fav.get():
                core.anadir_favorito(t)
            elif all(str(t["id"]) != str(e["id"]) for e in app._extras):
                app._extras.insert(0, t)
        app._poblar_tareas()
        t0 = nuevas[0]
        app.cbo_tarea.set(f"{t0['id']} - {t0['nombre']}")
        if var_fav.get():
            app.status.config(
                text=f"{len(nuevas)} tarea(s) guardada(s) como favoritas.")
        elif len(nuevas) > 1:
            app.status.config(
                text=f"{len(nuevas)} tareas añadidas al desplegable de tareas.")
        top.destroy()

    cbo.bind("<<ComboboxSelected>>", cargar)
    ent.bind("<KeyRelease>", pintar)
    lb.bind("<Double-1>", elegir)
    lb.bind("<Return>", elegir)
    btns = ttk.Frame(frm)
    btns.grid(row=5, column=0, columnspan=2, sticky="e", pady=(6, 0))
    ttk.Button(btns, text="Elegir", command=elegir).pack(side="right", padx=4)
    ttk.Button(btns, text="Cancelar", command=top.destroy).pack(side="right")


def abrir_exportar(app):
    hoy = dt.date.today()
    top = tk.Toplevel(app.root)
    top.title("Exportar a CSV")
    top.transient(app.root)
    top.grab_set()
    frm = ttk.Frame(top, padding=12)
    frm.pack(fill="both", expand=True)
    ttk.Label(frm, text="Desde (DD/MM/AAAA):").grid(row=0, column=0, sticky="w", pady=3)
    e_desde = ttk.Entry(frm, width=14)
    e_desde.insert(0, hoy.replace(day=1).strftime("%d/%m/%Y"))
    e_desde.grid(row=0, column=1, sticky="w", padx=6)
    ttk.Label(frm, text="Hasta (DD/MM/AAAA):").grid(row=1, column=0, sticky="w", pady=3)
    e_hasta = ttk.Entry(frm, width=14)
    e_hasta.insert(0, hoy.strftime("%d/%m/%Y"))
    e_hasta.grid(row=1, column=1, sticky="w", padx=6)
    lbl = ttk.Label(frm, text="")
    lbl.grid(row=2, column=0, columnspan=2, sticky="w", pady=(6, 0))

    vivo = {"v": True}

    def cerrar():
        vivo["v"] = False
        top.destroy()

    top.protocol("WM_DELETE_WINDOW", cerrar)

    def parsear(txt):
        for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
            try:
                return dt.datetime.strptime(txt.strip(), fmt).date()
            except ValueError:
                continue
        return None

    def progreso(texto):
        def _set():
            if top.winfo_exists():
                lbl.config(text=texto)
        try:
            app.root.after(0, _set)
        except Exception:
            pass

    def exportar():
        desde, hasta = parsear(e_desde.get()), parsear(e_hasta.get())
        if not desde or not hasta:
            messagebox.showwarning("Fechas",
                                   "Escribe las fechas como DD/MM/AAAA.", parent=top)
            return
        if hasta < desde:
            desde, hasta = hasta, desde
        ruta = filedialog.asksaveasfilename(
            parent=top, defaultextension=".csv",
            filetypes=[("CSV (Excel)", "*.csv")],
            initialfile=f"horas_{desde.isoformat()}_a_{hasta.isoformat()}.csv")
        if not ruta:
            return
        btn_exp.config(state="disabled")

        def trabajo():
            filas, total = [], 0.0
            d = desde
            while d <= hasta:
                if not vivo["v"]:
                    return None  # dialogo cerrado: cancelar
                progreso(f"Consultando {d.strftime('%d/%m/%Y')}...")
                try:
                    for a in core.entradas_dia(d.isoformat()):
                        filas.append([d.isoformat(),
                                      core._fmt(a["horas"]).rstrip("h"),
                                      a["wp_titulo"], a["actividad"], a["comentario"]])
                        total += a["horas"]
                except Exception as e:
                    raise RuntimeError(
                        f"No pude leer el {d.strftime('%d/%m/%Y')}:\n{e}")
                d += dt.timedelta(days=1)
            return filas, total

        def al_terminar(res, err):
            if not vivo["v"] or not top.winfo_exists():
                return
            btn_exp.config(state="normal")
            if err:
                lbl.config(text="")
                messagebox.showerror("Error", str(err), parent=top)
                return
            filas, total = res
            if not filas:
                lbl.config(text="")
                messagebox.showinfo("Exportar", "No hay apuntes en ese rango.", parent=top)
                return
            try:
                with open(ruta, "w", encoding="utf-8-sig", newline="") as fh:
                    w = csv.writer(fh, delimiter=";")
                    w.writerow(["Fecha", "Horas", "Tarea", "Actividad", "Comentario"])
                    w.writerows(filas)
                    w.writerow([])
                    w.writerow(["", f"{total:g}", "TOTAL"])
            except Exception as e:
                messagebox.showerror("Error",
                                     f"No se pudo escribir el CSV:\n{e}", parent=top)
                return
            cerrar()
            app.status.config(text=f"Exportados {len(filas)} apuntes ({total:g}h) a {ruta}")
            if messagebox.askyesno(
                    "Exportado",
                    f"{len(filas)} apuntes ({total:g}h) exportados a:\n{ruta}\n\n"
                    "¿Abrir el archivo ahora?"):
                try:
                    os.startfile(ruta)
                except Exception:
                    pass

        en_hilo(app.root, trabajo, al_terminar)

    btns2 = ttk.Frame(frm)
    btns2.grid(row=3, column=0, columnspan=2, sticky="e", pady=(10, 0))
    btn_exp = ttk.Button(btns2, text="Exportar", command=exportar)
    btn_exp.pack(side="right", padx=4)
    ttk.Button(btns2, text="Cancelar", command=cerrar).pack(side="right")
