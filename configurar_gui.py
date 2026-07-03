#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
configurar_gui.py - Asistente grafico (wizard) de configuracion de FichaCSIRC.

Pasos Siguiente/Atras/Finalizar. Al terminar guarda config.json y (re)genera
los lanzadores. Reutiliza configurar.py como motor (API y constantes).
Ejecuta:  pythonw configurar_gui.py   (o "FichaCSIRC - Configurar.bat")
"""

import os
import sys
import json
import tkinter as tk
from tkinter import ttk, messagebox

import configurar as ccore  # _api_get, ACTIVIDADES, WP_CONOCIDOS, CONFIG_PATH, cargar_previa

if getattr(sys, "frozen", False):
    APP_DIR = os.path.dirname(sys.executable)
else:
    APP_DIR = os.path.dirname(os.path.abspath(__file__))


def _recurso(nombre):
    """Ruta de un recurso (logo, icono), compatible con PyInstaller onefile."""
    base = getattr(sys, "_MEIPASS", "") or APP_DIR
    return os.path.join(base, nombre)


def _fecha_a_lista(txt, defecto):
    try:
        p = txt.replace("-", "/").split("/")
        d, m = int(p[0]), int(p[1])
        if 1 <= m <= 12 and 1 <= d <= 31:
            return [m, d]
    except Exception:
        pass
    return defecto


def _lista_a_fecha(lst):
    try:
        return f"{lst[1]:02d}/{lst[0]:02d}"
    except Exception:
        return "16/06"


def escribir_lanzadores():
    if getattr(sys, "frozen", False) or os.name != "nt":
        return
    py = sys.executable
    pyw = py[:-10] + "pythonw.exe" if py.lower().endswith("python.exe") else py
    app = ["@echo off", 'cd /d "%~dp0"',
           f'start "" "{pyw}" "registrar_gui.py"']
    with open(os.path.join(APP_DIR, "FichaCSIRC - Registrar.bat"), "w",
              encoding="utf-8", newline="\r\n") as f:
        f.write("\n".join(app) + "\n")
    reg = ["@echo off", 'cd /d "%~dp0"', "title FichaCSIRC - Registrar (consola)", "",
           'if not exist "config.json" echo Falta config.json. Ejecuta el configurador.',
           'if not exist "config.json" pause', 'if not exist "config.json" exit /b', "",
           f'"{py}" "rellenar_horas.py"', "echo.", "pause"]
    with open(os.path.join(APP_DIR, "FichaCSIRC - Registrar (consola).bat"), "w",
              encoding="utf-8", newline="\r\n") as f:
        f.write("\n".join(reg) + "\n")


class Wizard:
    def __init__(self, root):
        self.root = root
        root.title("FichaCSIRC - Configuración")
        root.geometry("640x580")
        root.minsize(600, 540)
        ico = _recurso("fichacsirc.ico")
        if os.path.exists(ico):
            try:
                root.iconbitmap(ico)
            except Exception:
                pass

        previa = ccore.cargar_previa() or {}
        self.favoritos = list(previa.get("favoritos", []))
        self.v = {
            "url": tk.StringVar(value=previa.get("base_url", "https://proyectostic.ugr.es")),
            "key": tk.StringVar(value=previa.get("api_key", "")),
            "jinv": tk.IntVar(value=int(previa.get("jornada_invierno", 7))),
            "tver": tk.BooleanVar(value=bool(previa.get("tiene_verano", True))),
            "jver": tk.IntVar(value=int(previa.get("jornada_verano", 5))),
            "vini": tk.StringVar(value=_lista_a_fecha(previa.get("verano_inicio", [6, 16]))),
            "vfin": tk.StringVar(value=_lista_a_fecha(previa.get("verano_fin", [9, 15]))),
            "act": tk.StringVar(value=previa.get("actividad_defecto")
                                or previa.get("actividad") or "soporte"),
        }
        self._logo = None
        self._proyectos = []
        self._tareas = []
        self._conexion_ok = None  # (url, key) de la ultima conexion probada con exito
        self._shell()
        self.pasos = [self.p_bienvenida, self.p_conexion, self.p_jornada,
                      self.p_tareas, self.p_resumen]
        self.idx = 0
        self.mostrar()

    # ---------- estructura ----------
    def _shell(self):
        head = ttk.Frame(self.root, padding=(12, 10))
        head.pack(fill="x")
        logo_path = _recurso("logo_ugr.png")
        if os.path.exists(logo_path):
            try:
                self._logo = tk.PhotoImage(file=logo_path)
                ttk.Label(head, image=self._logo).pack(side="left", padx=(0, 12))
            except Exception:
                self._logo = None
        ttk.Label(head, text="FichaCSIRC", font=("Segoe UI", 16, "bold")).pack(side="left")
        ttk.Label(head, text="Asistente de configuración",
                  foreground="#666").pack(side="left", padx=10)
        ttk.Separator(self.root, orient="horizontal").pack(fill="x", padx=10)

        self.content = ttk.Frame(self.root, padding=16)
        self.content.pack(fill="both", expand=True)

        foot = ttk.Frame(self.root, padding=10)
        foot.pack(fill="x", side="bottom")
        self.lbl_paso = ttk.Label(foot, text="")
        self.lbl_paso.pack(side="left")
        self.btn_fin = ttk.Button(foot, text="Finalizar", command=self.finalizar)
        self.btn_next = ttk.Button(foot, text="Siguiente >", command=self.siguiente)
        self.btn_back = ttk.Button(foot, text="< Atrás", command=self.atras)
        ttk.Button(foot, text="Cancelar", command=self.cancelar).pack(side="right", padx=4)
        self.btn_fin.pack(side="right", padx=4)
        self.btn_next.pack(side="right", padx=4)
        self.btn_back.pack(side="right", padx=4)

    def _limpiar(self):
        for w in self.content.winfo_children():
            w.destroy()

    def mostrar(self):
        self._limpiar()
        self.pasos[self.idx]()
        self.lbl_paso.config(text=f"Paso {self.idx + 1} de {len(self.pasos)}")
        self.btn_back.config(state=("disabled" if self.idx == 0 else "normal"))
        ultimo = (self.idx == len(self.pasos) - 1)
        self.btn_next.config(state=("disabled" if ultimo else "normal"))
        self.btn_fin.config(state=("normal" if ultimo else "disabled"))

    def siguiente(self):
        if not self._validar(self.idx):
            return
        if self.idx < len(self.pasos) - 1:
            self.idx += 1
            self.mostrar()

    def atras(self):
        if self.idx > 0:
            self.idx -= 1
            self.mostrar()

    def cancelar(self):
        if messagebox.askyesno("Cancelar",
                               "¿Cerrar el asistente sin guardar la configuración?"):
            self.root.destroy()

    def _validar(self, i):
        if i == 1:  # conexion
            url = self.v["url"].get().strip().rstrip("/")
            key = self.v["key"].get().strip()
            if not url or not key:
                messagebox.showwarning("Faltan datos", "Escribe la URL y la API key.")
                return False
            if self._conexion_ok != (url, key):
                self.lbl_test.config(text="Comprobando conexión...", foreground="#666")
                self.root.update_idletasks()
                try:
                    ccore._api_get(url, key, "/api/v3/users/me")
                    self._conexion_ok = (url, key)
                    self.lbl_test.config(text="Conexión correcta.", foreground="green")
                except Exception as e:
                    self.lbl_test.config(text=f"No se pudo conectar: {e}", foreground="red")
                    return messagebox.askyesno(
                        "Sin conexión",
                        f"No se pudo conectar con esos datos:\n{e}\n\n"
                        "¿Continuar de todas formas?")
        if i == 2 and self.v["tver"].get():  # jornada: fechas del verano
            for nombre, txt in (("inicio", self.v["vini"].get()),
                                ("fin", self.v["vfin"].get())):
                if _fecha_a_lista(txt, None) is None:
                    messagebox.showwarning(
                        "Fecha no válida",
                        f"La fecha de {nombre} del verano no es válida.\n"
                        "Escríbela como DD/MM (ej. 16/06).")
                    return False
        return True

    # ---------- paginas ----------
    def p_bienvenida(self):
        ttk.Label(self.content, text="Bienvenido al asistente de FichaCSIRC",
                  font=("Segoe UI", 14, "bold")).pack(anchor="w", pady=(0, 10))
        txt = ("Este asistente te guiará para configurar el registro de horas en\n"
               "OpenProject (ProyectosTic). Podrás:\n\n"
               "  - Indicar la dirección y tu clave de acceso (API key).\n"
               "  - Definir tu jornada (horas normales y de verano).\n"
               "  - Elegir tus tareas favoritas y la actividad por defecto.\n\n"
               "Pulsa 'Siguiente >' para empezar.")
        ttk.Label(self.content, text=txt, justify="left").pack(anchor="w")

    def p_conexion(self):
        ttk.Label(self.content, text="Conexión con ProyectosTic",
                  font=("Segoe UI", 13, "bold")).pack(anchor="w", pady=(0, 12))
        f = ttk.Frame(self.content)
        f.pack(fill="x")
        ttk.Label(f, text="URL de OpenProject:").grid(row=0, column=0, sticky="w", pady=4)
        ttk.Entry(f, textvariable=self.v["url"], width=46).grid(row=0, column=1, sticky="we", padx=6)
        ttk.Label(f, text="API key:").grid(row=1, column=0, sticky="w", pady=4)
        ttk.Entry(f, textvariable=self.v["key"], width=46, show="*").grid(row=1, column=1, sticky="we", padx=6)
        f.columnconfigure(1, weight=1)
        ttk.Label(self.content,
                  text="La API key se saca en: avatar (arriba dcha) > Mi cuenta > Tokens de acceso > API",
                  foreground="#666").pack(anchor="w", pady=(8, 4))
        self.lbl_test = ttk.Label(self.content, text="")
        self.lbl_test.pack(anchor="w")
        ttk.Button(self.content, text="Probar conexión", command=self._probar).pack(anchor="w", pady=6)

    def _probar(self):
        self.lbl_test.config(text="Probando...", foreground="#666")
        self.root.update_idletasks()
        try:
            me = ccore._api_get(self.v["url"].get().strip().rstrip("/"),
                                self.v["key"].get().strip(), "/api/v3/users/me")
            nombre = me.get("name", "usuario")
            self._conexion_ok = (self.v["url"].get().strip().rstrip("/"),
                                 self.v["key"].get().strip())
            self.lbl_test.config(text=f"Conexión correcta. Hola, {nombre}.", foreground="green")
        except Exception as e:
            self.lbl_test.config(text=f"No se pudo conectar: {e}", foreground="red")

    def p_jornada(self):
        ttk.Label(self.content, text="Tu jornada (lunes a viernes)",
                  font=("Segoe UI", 13, "bold")).pack(anchor="w", pady=(0, 12))
        f = ttk.Frame(self.content)
        f.pack(fill="x")
        ttk.Label(f, text="Horas por día (normal):").grid(row=0, column=0, sticky="w", pady=4)
        ttk.Spinbox(f, from_=1, to=24, textvariable=self.v["jinv"], width=6).grid(row=0, column=1, sticky="w", padx=6)
        ttk.Checkbutton(f, text="Tengo horario de verano distinto",
                        variable=self.v["tver"], command=self._toggle_verano).grid(
            row=1, column=0, columnspan=2, sticky="w", pady=(10, 4))
        ttk.Label(f, text="Horas por día (verano):").grid(row=2, column=0, sticky="w", pady=4)
        sp = ttk.Spinbox(f, from_=1, to=24, textvariable=self.v["jver"], width=6)
        sp.grid(row=2, column=1, sticky="w", padx=6)
        ttk.Label(f, text="Inicio verano (DD/MM):").grid(row=3, column=0, sticky="w", pady=4)
        e1 = ttk.Entry(f, textvariable=self.v["vini"], width=10)
        e1.grid(row=3, column=1, sticky="w", padx=6)
        ttk.Label(f, text="Fin verano (DD/MM):").grid(row=4, column=0, sticky="w", pady=4)
        e2 = ttk.Entry(f, textvariable=self.v["vfin"], width=10)
        e2.grid(row=4, column=1, sticky="w", padx=6)
        self._verano_inputs = (sp, e1, e2)
        self._toggle_verano()

    def _toggle_verano(self):
        estado = "normal" if self.v["tver"].get() else "disabled"
        for w in getattr(self, "_verano_inputs", ()):
            w.configure(state=estado)

    def p_tareas(self):
        ttk.Label(self.content, text="Tareas favoritas y actividad",
                  font=("Segoe UI", 13, "bold")).pack(anchor="w", pady=(0, 8))
        top = ttk.Frame(self.content)
        top.pack(fill="x")
        ttk.Label(top, text="Proyecto:").pack(side="left")
        self.cbo_proy = ttk.Combobox(top, state="readonly", width=44)
        self.cbo_proy.pack(side="left", padx=6)
        self.cbo_proy.bind("<<ComboboxSelected>>", self._cargar_tareas)
        ttk.Button(top, text="Cargar proyectos", command=self._cargar_proyectos).pack(side="left")

        med = ttk.Frame(self.content)
        med.pack(fill="both", expand=True, pady=6)
        izq = ttk.LabelFrame(med, text="Tareas del proyecto (Ctrl o Mayús: varias)")
        izq.pack(side="left", fill="both", expand=True, padx=(0, 4))
        self.lst_tareas = tk.Listbox(izq, selectmode="extended", height=9,
                                     exportselection=False)
        self.lst_tareas.pack(fill="both", expand=True, padx=4, pady=4)
        ttk.Button(izq, text="Añadir marcadas a favoritas >>",
                   command=self._anadir_fav).pack(pady=4)
        der = ttk.LabelFrame(med, text="Favoritas")
        der.pack(side="left", fill="both", expand=True, padx=(4, 0))
        self.lst_fav = tk.Listbox(der, height=9, exportselection=False)
        self.lst_fav.pack(fill="both", expand=True, padx=4, pady=4)
        ttk.Button(der, text="Quitar seleccionada", command=self._quitar_fav).pack(pady=4)

        act = ttk.Frame(self.content)
        act.pack(fill="x", pady=(6, 0))
        ttk.Label(act, text="Actividad por defecto:").pack(side="left")
        self.cbo_act = ttk.Combobox(act, state="readonly", width=24,
                                    values=list(ccore.ACTIVIDADES), textvariable=self.v["act"])
        self.cbo_act.pack(side="left", padx=6)

        self._pintar_fav()
        if self._proyectos:
            self.cbo_proy["values"] = [f"{p['id']} - {p['nombre']}" for p in self._proyectos]
        else:
            self._cargar_proyectos(auto=True)

    def _cargar_proyectos(self, auto=False):
        try:
            elems = ccore._api_get_todos(
                self.v["url"].get().strip().rstrip("/"), self.v["key"].get().strip(),
                "/api/v3/projects")
            self._proyectos = [{"id": int(p["id"]), "nombre": p.get("name", "?")}
                               for p in elems]
        except Exception as e:
            if not auto:
                messagebox.showerror("Sin conexión", f"No pude cargar proyectos:\n{e}")
            return
        self.cbo_proy["values"] = [f"{p['id']} - {p['nombre']}" for p in self._proyectos]
        if self._proyectos:
            self.cbo_proy.current(0)
            self._cargar_tareas()

    def _cargar_tareas(self, *_):
        idx = self.cbo_proy.current()
        if idx < 0:
            return
        try:
            elems = ccore._api_get_todos(
                self.v["url"].get().strip().rstrip("/"), self.v["key"].get().strip(),
                f"/api/v3/projects/{self._proyectos[idx]['id']}/work_packages")
            self._tareas = [{"id": int(w["id"]), "nombre": w.get("subject", "?")} for w in elems]
        except Exception as e:
            if "403" in str(e):
                messagebox.showinfo(
                    "Sin permiso",
                    "No tienes permiso para ver las tareas de este proyecto.\n"
                    "Elige otro proyecto (por ejemplo el de tus tareas habituales).")
            else:
                messagebox.showerror("Error", f"No pude cargar las tareas:\n{e}")
            return
        self.lst_tareas.delete(0, "end")
        for t in self._tareas:
            self.lst_tareas.insert("end", f"{t['id']} - {t['nombre']}")

    def _anadir_fav(self):
        ids = {str(f["id"]) for f in self.favoritos}
        for i in self.lst_tareas.curselection():
            t = self._tareas[i]
            if str(t["id"]) not in ids:
                self.favoritos.append({"id": t["id"], "nombre": t["nombre"]})
                ids.add(str(t["id"]))
        self._pintar_fav()

    def _quitar_fav(self):
        sel = self.lst_fav.curselection()
        if sel:
            self.favoritos.pop(sel[0])
            self._pintar_fav()

    def _pintar_fav(self):
        self.lst_fav.delete(0, "end")
        for f in self.favoritos:
            self.lst_fav.insert("end", f"{f['id']} - {f['nombre']}")

    def p_resumen(self):
        ttk.Label(self.content, text="Resumen",
                  font=("Segoe UI", 13, "bold")).pack(anchor="w", pady=(0, 10))
        ver = ("Sí" if self.v["tver"].get() else "No")
        lineas = [
            f"OpenProject:  {self.v['url'].get().strip()}",
            f"API key:      {'*' * 6}{self.v['key'].get()[-4:] if self.v['key'].get() else ''}",
            f"Jornada normal: {self.v['jinv'].get()} h/día",
            f"Horario verano: {ver}",
        ]
        if self.v["tver"].get():
            lineas.append(f"   Verano: {self.v['jver'].get()} h/día, "
                          f"del {self.v['vini'].get()} al {self.v['vfin'].get()}")
        lineas.append(f"Actividad por defecto: {self.v['act'].get()}")
        lineas.append(f"Tareas favoritas: {len(self.favoritos)}")
        for f in self.favoritos:
            lineas.append(f"   - {f['id']}  {f['nombre'][:44]}")
        ttk.Label(self.content, text="\n".join(lineas), justify="left").pack(anchor="w")
        ttk.Label(self.content, text="\nPulsa 'Finalizar' para guardar.",
                  foreground="#666").pack(anchor="w")

    # ---------- guardar ----------
    def finalizar(self):
        cfg = {
            "base_url": self.v["url"].get().strip().rstrip("/"),
            "api_key": self.v["key"].get().strip(),
            "jornada_invierno": int(self.v["jinv"].get()),
            "tiene_verano": bool(self.v["tver"].get()),
            "jornada_verano": int(self.v["jver"].get()),
            "verano_inicio": _fecha_a_lista(self.v["vini"].get(), [6, 16]),
            "verano_fin": _fecha_a_lista(self.v["vfin"].get(), [9, 15]),
            "actividad_defecto": self.v["act"].get(),
            "favoritos": self.favoritos,
        }
        try:
            with open(ccore.CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            escribir_lanzadores()
        except Exception as e:
            messagebox.showerror("Error", f"No se pudo guardar:\n{e}")
            return
        lanzador = ("FichaCSIRC.exe" if getattr(sys, "frozen", False)
                    else '"FichaCSIRC - Registrar.bat"')
        messagebox.showinfo(
            "Configuración guardada",
            f"Listo. Ya puedes registrar horas con {lanzador}.")
        self.root.destroy()


def main():
    root = tk.Tk()
    try:
        ttk.Style().theme_use("vista")
    except Exception:
        pass
    Wizard(root)
    root.mainloop()


if __name__ == "__main__":
    main()
