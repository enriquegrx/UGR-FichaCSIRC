#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
registrar_web.py - PROTOTIPO de la ventana principal con interfaz HTML (pywebview).

Rama experimental: convive con registrar_gui.py (Tkinter), que sigue siendo la
app de verdad. Aqui la pantalla es HTML/CSS/JS (carpeta web/) y toda la logica
sigue en Python: el motor (rellenar_horas, destinos) se usa tal cual y la clase
Api es lo unico que ve el JavaScript (window.pywebview.api).

Diferencias a proposito con la app de verdad:
  - Usa su PROPIA configuracion (FichaCSIRC-experimento), copiada de la real la
    primera vez: lo que se toque en local no afecta a la app de produccion. Los
    apuntes SI van a ProyectosTic (es la misma cuenta).
  - No comprueba actualizaciones (no debe ofrecer instalar la de produccion).
  - El aviso diario de fichaje no se configura desde aqui: es la MISMA tarea
    programada que usa la app de verdad y la secuestraria.

Ejecuta:  python registrar_web.py      (necesita: pip install pywebview)
"""

import os
import csv
import sys
import shutil
import base64
import calendar
import subprocess
import webbrowser
import datetime as dt


# ---------------- configuracion aislada (ANTES de importar el motor) ----------------

def _carpeta_config(nombre):
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~/Library/Application Support"), nombre)
    if os.name == "nt":
        return os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), nombre)
    return os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")),
                        nombre)


def preparar_config_experimento():
    """Apunta el motor a una config propia del experimento. La primera vez copia
    la real (la de la app instalada o, si no, la de la carpeta del codigo)."""
    if os.environ.get("FICHACSIRC_CONFIG"):
        return os.environ["FICHACSIRC_CONFIG"]
    destino = os.path.join(_carpeta_config("FichaCSIRC-experimento"), "config.json")
    if not os.path.exists(destino):
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        for origen in (os.path.join(_carpeta_config("FichaCSIRC"), "config.json"),
                       os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "config.json")):
            if os.path.exists(origen):
                shutil.copyfile(origen, destino)
                break
    os.environ["FICHACSIRC_CONFIG"] = destino
    return destino


if __name__ == "__main__":
    preparar_config_experimento()

try:
    import rellenar_horas as core   # noqa: E402  (lee FICHACSIRC_CONFIG al importarse)
    import destinos                 # noqa: E402
except SystemExit as _e:            # sin config.json: el motor hace sys.exit
    core = destinos = None
    ERROR_ARRANQUE = str(_e)
else:
    ERROR_ARRANQUE = ""


def _recurso(*partes):
    base = getattr(sys, "_MEIPASS", "") or os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, *partes)


# ---------------- estado de un dia (lo que pinta cada tarjeta) ----------------

def estado_dia(d, apuntes, hoy=None):
    """Lo que necesita la tarjeta de un dia. Misma logica que
    registrar_gui._pintar_semana, pero devuelta como datos: el HTML no decide
    nada, solo pinta segun 'estado'."""
    hoy = hoy or dt.date.today()
    iso = d.isoformat()
    obj = core.objetivo_de(d)
    nolab = core.es_no_laborable(iso)
    reg = round(sum(a["horas"] for a in apuntes), 2) if apuntes else 0.0
    h_permiso = 0 if nolab else core.horas_permiso(iso)
    if nolab:
        estado = "vacaciones" if core.es_vacaciones(iso) else "nolab"
        frac = 1.0
        texto = core.motivo_no_laborable(iso).capitalize()
        if reg:
            texto = f"{core._fmt(reg)} · {texto}"
    elif apuntes is None:
        estado, frac, texto = "error", 0.0, "sin conexión"
    elif h_permiso and obj == 0:
        estado, frac, texto = "permiso", 1.0, "Permiso (día completo)"
        if reg:
            texto = f"{core._fmt(reg)} · {texto}"
    elif reg > obj + 0.001:
        estado, frac = "pasado", 1.0
        texto = f"{core._fmt(reg)} / {core._fmt(obj)}  (te pasas)"
    elif reg >= obj - 0.001 and reg > 0:
        estado, frac = "completo", 1.0
        texto = f"{core._fmt(reg)} / {core._fmt(obj)}  ✔"
    elif reg > 0:
        estado, frac = "parcial", (reg / obj if obj else 0.0)
        texto = f"{core._fmt(reg)} / {core._fmt(obj)}"
    else:
        estado, frac, texto = "vacio", 0.0, f"0h / {core._fmt(obj)}"
    return {
        "iso": iso,
        "nombre": core.DIAS_ES[d.weekday()],
        "fecha": d.strftime("%d/%m"),
        "es_hoy": d == hoy,
        "estado": estado,
        "frac": round(max(0.0, min(frac, 1.0)), 3),
        "texto": texto,
        "reg": reg,
        "obj": obj,
        "falta": round(obj - reg, 2) if not nolab else 0.0,
        "no_laborable": nolab,
        "motivo": core.motivo_no_laborable(iso) if nolab else "",
        "guardia": core.es_guardia(iso),
        "teletrabajo": core.es_teletrabajo(iso),
        "permiso": core.fmt_horas_hhmm(h_permiso) if h_permiso else "",
        "permiso_detalle": [
            f"{(core.tipo_permiso(p.get('tipo')) or {}).get('nombre', p.get('tipo'))}: "
            f"{core.fmt_horas_hhmm(p.get('horas') or 0)}" for p in core.permisos_dia(iso)],
        "apuntes": [
            {"id": str(a["id"]), "horas": a["horas"], "horas_txt": core._fmt(a["horas"]),
             "wp_id": str(a.get("wp_id") or ""), "tarea": a["wp_titulo"],
             "actividad": a["actividad"], "comentario": a["comentario"],
             "destino": a.get("destino", "op")}
            for a in (apuntes or [])],
    }


# ---------------- API expuesta al JavaScript ----------------

class Api:
    """Todo lo que el HTML puede pedir. pywebview llama a cada metodo en su
    propio hilo y el JS recibe una promesa: la interfaz nunca se congela.

    Los metodos devuelven siempre datos serializables a JSON. Los atributos con
    '_' delante no se exponen al JavaScript."""

    def __init__(self):
        self._cache = {}          # iso -> apuntes (None si fallo la lectura)
        self._ultimo_borrado = None
        self._extras = []         # tareas elegidas con Buscar en esta sesion
        self._copia = None        # copia preparada (dia/semana anterior)
        self._ventana = None      # ventana pywebview (dialogo de guardar)

    # ---- arranque ----
    def inicio(self):
        logo = ""
        try:
            with open(_recurso("logo_ugr.png"), "rb") as f:
                logo = "data:image/png;base64," + base64.b64encode(f.read()).decode()
        except OSError:
            pass
        hoy = dt.date.today()
        try:
            core.inicializar_permisos_anuales()
        except Exception:
            pass
        return {
            "version": core.VERSION,
            "github": core.GITHUB_REPO,
            "inari_listo": destinos.configurado(),
            "asociaciones": self.asociaciones(),
            "toca_permisos_anio": core.toca_anadir_permisos_del_anio(),
            "plataforma": "macOS" if sys.platform == "darwin" else
                          ("Windows" if os.name == "nt" else sys.platform),
            "lunes": (hoy - dt.timedelta(days=hoy.weekday())).isoformat(),
            "inari": destinos.inari_activo(),
            "logo": logo,
            "tareas": self.tareas(),
            "actividades": list(core.ACTIVIDADES),
            "actividad_preferida": core.config_valor("ultima_actividad")
                                   or core.ACTIVIDAD_DEFECTO or "",
            "comentario_guardia": core.comentario_guardia(),
        }

    def usuario(self):
        return core.nombre_usuario()

    def tareas(self):
        """Tareas del desplegable: las buscadas en la sesion y las favoritas."""
        vistas, out = set(), []
        for w in self._extras + list(core.FAVORITOS):
            if int(w["id"]) in vistas:
                continue
            vistas.add(int(w["id"]))
            out.append({"id": int(w["id"]), "nombre": w["nombre"],
                        "texto": f"{w['id']} - {w['nombre']}"})
        return out

    # ---- semana ----
    def semana(self, lunes_iso):
        lunes = dt.date.fromisoformat(lunes_iso)
        dias = [lunes + dt.timedelta(days=i) for i in range(5)]
        inari_cfg = destinos.configurado()
        fallos = 0
        for d in dias:
            iso = d.isoformat()
            try:
                if inari_cfg and core.es_teletrabajo(iso):
                    self._cache[iso] = [
                        {"id": s["id"], "horas": s["horas"], "wp_titulo": s["titulo"],
                         "actividad": "INARI · Teletrabajo", "comentario": "",
                         "wp_id": None, "destino": "inari"}
                        for s in destinos.slots_dia(iso)]
                else:
                    self._cache[iso] = [dict(a, destino="op")
                                        for a in core.entradas_dia(iso)]
            except Exception:
                self._cache[iso] = None
                fallos += 1
        return self._pintar(dias, fallos)

    def repintar(self, lunes_iso):
        """Sin red: tras marcar festivo/guardia/teletrabajo (cambios locales)."""
        lunes = dt.date.fromisoformat(lunes_iso)
        return self._pintar([lunes + dt.timedelta(days=i) for i in range(5)], 0)

    def _pintar(self, dias, fallos):
        tarjetas = [estado_dia(d, self._cache.get(d.isoformat())) for d in dias]
        reg = sum(t["reg"] for t in tarjetas)
        obj = sum(core.objetivo_de(d) for d in dias)
        dom = dias[0] + dt.timedelta(days=6)
        cupo_tt = core.teletrabajo_por_semana()
        return {
            "titulo": f"Semana {dias[0].strftime('%d/%m/%Y')} - {dom.strftime('%d/%m/%Y')}",
            "total": f"{core._fmt(reg)} / {core._fmt(obj)}",
            "teletrabajo": (f"{core.teletrabajo_en_semana(dias[0])}/{cupo_tt}"
                            if cupo_tt else ""),
            "conexion": "error" if fallos >= len(dias) else ("warn" if fallos else "ok"),
            "dias": tarjetas,
        }

    # ---- formulario ----
    def actividades(self, wp_id):
        """Actividades de ESA tarea y la que conviene preseleccionar."""
        try:
            nombres = list(core._actividades_disponibles(wp_id).keys())
        except Exception:
            nombres = list(core.ACTIVIDADES)
        pref = ((core.config_valor("actividades_tarea") or {}).get(str(wp_id))
                or core.config_valor("ultima_actividad") or core.ACTIVIDAD_DEFECTO or "")
        return {"nombres": nombres, "preferida": pref,
                "comentario": (core.config_valor("comentarios_tarea") or {}).get(str(wp_id), "")}

    def comprobar(self, dias_iso, wp_id, horas):
        """Avisos ANTES de añadir (los mismos que la app de verdad). Devuelve
        {'error': str} si no se puede, o {'avisos': [{clave, titulo, texto}]}
        para que el JS los vaya confirmando uno a uno."""
        try:
            horas = float(str(horas).replace(",", "."))
        except ValueError:
            return {"error": "Escribe un número de horas válido (ej. 3 o 3,5)."}
        if not 0 < horas <= 24:
            return {"error": "Las horas deben estar entre 0 y 24."}
        if not dias_iso:
            return {"error": "Marca al menos un día."}
        avisos = []
        nombre = lambda iso: (f"{core.DIAS_ES[dt.date.fromisoformat(iso).weekday()]} "
                              f"{dt.date.fromisoformat(iso).strftime('%d/%m')}")
        sin_leer = [nombre(i) for i in dias_iso if self._cache.get(i, []) is None]
        if sin_leer:
            avisos.append({"clave": "sin_leer", "titulo": "No se pudieron leer algunos días",
                           "texto": "No se pudieron leer los apuntes de: " + ", ".join(sin_leer)
                                    + ". Puede que ya tengan horas de esta tarea. "
                                      "¿Añadir igualmente?"})
        nolab = [f"{nombre(i)} ({core.motivo_no_laborable(i)})" for i in dias_iso
                 if core.es_no_laborable(i)]
        if nolab:
            avisos.append({"clave": "nolab", "titulo": "Día no laborable",
                           "texto": "Vas a imputar horas en días no laborables: "
                                    + ", ".join(nolab) + ". ¿Continuar?"})
        repetidos = []
        for i in dias_iso:
            ya = sum(e["horas"] for e in (self._cache.get(i) or [])
                     if str(e.get("wp_id")) == str(wp_id))
            if ya:
                repetidos.append(f"{nombre(i)} (ya tiene {core._fmt(ya)})")
        if repetidos:
            avisos.append({"clave": "repetir", "titulo": "Esa tarea ya tiene horas ese día",
                           "texto": "Ya hay horas de esta tarea en: " + ", ".join(repetidos)
                                    + f". ¿Añadir {core._fmt(horas)} más? "
                                      "(Si dices que no, esos días se dejan como están.)"})
        exceso = []
        for i in dias_iso:
            if core.es_no_laborable(i):
                continue
            reg = sum(a["horas"] for a in (self._cache.get(i) or []))
            obj = core.objetivo_de(dt.date.fromisoformat(i))
            if reg + horas > obj + 0.001:
                exceso.append(f"{nombre(i)} ({core._fmt(reg + horas)} de {core._fmt(obj)})")
        if exceso:
            avisos.append({"clave": "exceso", "titulo": "Jornada superada",
                           "texto": "Con este apunte te pasarás de la jornada en: "
                                    + ", ".join(exceso) + ". ¿Continuar?"})
        return {"avisos": avisos}

    def anadir(self, dias_iso, wp_id, horas, comentario, actividad, permitir_repetir=True):
        horas = float(str(horas).replace(",", "."))
        comentario = (comentario or "").strip()
        guardia_auto = comentario == core.comentario_guardia()
        creados = saltados = errores = 0
        ultimo = ""
        for iso in dias_iso:
            existentes = self._cache.get(iso) or []
            if (not permitir_repetir
                    and any(str(e.get("wp_id")) == str(wp_id) for e in existentes)):
                saltados += 1
                continue
            if core.es_guardia(iso):
                com = comentario or core.comentario_guardia()
            else:
                com = "" if guardia_auto else comentario
            try:
                core.crear_entrada(iso, int(wp_id), horas, com, actividad or None)
                creados += 1
            except Exception as e:
                errores += 1
                ultimo = str(e)
        if creados:
            self._recordar(wp_id, comentario, actividad)
        return {"creados": creados, "saltados": saltados, "errores": errores,
                "ultimo": ultimo}

    def _recordar(self, wp_id, comentario, actividad):
        try:
            cambios = {}
            if comentario and comentario != core.comentario_guardia():
                m = dict(core.config_valor("comentarios_tarea") or {})
                m[str(wp_id)] = comentario
                cambios["comentarios_tarea"] = m
            if actividad:
                m = dict(core.config_valor("actividades_tarea") or {})
                m[str(wp_id)] = actividad
                cambios["actividades_tarea"] = m
                cambios["ultima_actividad"] = actividad
            if cambios:
                core.guardar_config_valores(cambios)
        except Exception:
            pass   # comodidad: nunca debe romper el registro

    # ---- borrar / deshacer ----
    def eliminar(self, items):
        """items: [{id, fecha, destino}]. Borra y guarda lo necesario para deshacer."""
        n_ok, errores, ultimo, deshacer = 0, 0, "", []
        for it in items:
            try:
                if it.get("destino") == "inari":
                    destinos.borrar(it["id"])
                else:
                    datos = next((a for a in (self._cache.get(it["fecha"]) or [])
                                  if str(a["id"]) == str(it["id"])), None)
                    core.eliminar_entrada(it["id"])
                    if datos:
                        deshacer.append({"fecha": it["fecha"], "wp_id": datos["wp_id"],
                                         "horas": datos["horas"],
                                         "comentario": datos["comentario"],
                                         "actividad": datos["actividad"]})
                n_ok += 1
            except Exception as e:
                errores += 1
                ultimo = str(e)
        self._ultimo_borrado = deshacer or None
        return {"eliminados": n_ok, "errores": errores, "ultimo": ultimo,
                "puede_deshacer": bool(deshacer)}

    def deshacer(self):
        datos, self._ultimo_borrado = self._ultimo_borrado, None
        restaurados, errores, ultimo = 0, 0, ""
        for a in datos or []:
            try:
                core.crear_entrada(a["fecha"], a["wp_id"], a["horas"],
                                   a["comentario"], a["actividad"])
                restaurados += 1
            except Exception as e:
                errores += 1
                ultimo = str(e)
        return {"restaurados": restaurados, "errores": errores, "ultimo": ultimo}

    # ---- menu del dia (marcas locales) ----
    def accion_dia(self, iso, accion, motivo=""):
        acciones = {
            "no_laborable": lambda: core.marcar_no_laborable(iso, motivo or "festivo"),
            "quitar_no_laborable": lambda: core.quitar_no_laborable(iso),
            "guardia": lambda: core.marcar_guardia(iso),
            "quitar_guardia": lambda: core.quitar_guardia(iso),
            "teletrabajo": lambda: core.marcar_teletrabajo(iso),
            "quitar_teletrabajo": lambda: core.quitar_teletrabajo(iso),
            "quitar_permiso": lambda: core.quitar_permiso(iso, int(motivo)),
        }
        if accion not in acciones:
            return {"error": f"Acción desconocida: {accion}"}
        acciones[accion]()
        return {"ok": True}

    def teletrabajo_lleno(self, iso):
        """True si marcar ese dia supera el cupo semanal de teletrabajo."""
        d = dt.date.fromisoformat(iso)
        cupo = core.teletrabajo_por_semana()
        return bool(cupo) and core.teletrabajo_en_semana(d - dt.timedelta(days=d.weekday())) >= cupo


    # =============================================================== dialogos

    # ---- editar un apunte ----
    def editar(self, fecha, entry_id, horas, comentario, actividad):
        try:
            horas = float(str(horas).replace(",", "."))
        except ValueError:
            return {"error": "Escribe un número de horas válido."}
        if not 0 < horas <= 24:
            return {"error": "Las horas deben estar entre 0 y 24."}
        apunte = next((a for a in (self._cache.get(fecha) or [])
                       if str(a["id"]) == str(entry_id)), None)
        if apunte is None:
            return {"error": "Ese apunte ya no está en la semana cargada (pulsa F5)."}
        if apunte.get("destino") == "inari":
            return {"error": "Para corregir un slot de INARI, bórralo y vuelve a registrarlo."}
        core.actualizar_entrada(entry_id, horas, (comentario or "").strip(),
                                actividad or None, apunte["wp_id"])
        return {"ok": True}

    # ---- asociar actividad <-> tarea (en los dos sentidos) ----
    def asociaciones(self):
        """{actividad: wp_id} creadas a mano: elegir la actividad lleva a su tarea."""
        return {k: int(v) for k, v in (core.config_valor("tareas_actividad") or {}).items()}

    def asociar(self, wp_id, actividad):
        por_tarea = dict(core.config_valor("actividades_tarea") or {})
        por_act = dict(core.config_valor("tareas_actividad") or {})
        por_tarea[str(wp_id)] = actividad
        por_act[actividad] = int(wp_id)
        core.guardar_config_valores({"actividades_tarea": por_tarea,
                                     "tareas_actividad": por_act})
        return self.asociaciones()

    def desasociar(self, actividad):
        por_act = dict(core.config_valor("tareas_actividad") or {})
        wp_id = por_act.pop(actividad, None)
        por_tarea = dict(core.config_valor("actividades_tarea") or {})
        if wp_id is not None:
            por_tarea.pop(str(wp_id), None)
        core.guardar_config_valores({"actividades_tarea": por_tarea,
                                     "tareas_actividad": por_act})
        return self.asociaciones()

    # ---- buscar tareas ----
    def proyectos(self):
        return core.proyectos()

    def tareas_de_proyecto(self, pid):
        try:
            return {"tareas": core.tareas_proyecto(int(pid))}
        except Exception as e:
            if "403" in str(e):
                return {"error": "No tienes permiso para ver las tareas de este proyecto."}
            raise

    def buscar_tareas(self, texto):
        texto = (texto or "").strip()
        if len(texto) < 3:
            return {"error": "Escribe al menos 3 letras."}
        return {"tareas": core.buscar_wp(texto)}

    def elegir_tareas(self, tareas, a_favoritas):
        """Añade las tareas al desplegable (y a favoritas si se pide)."""
        for t in reversed(tareas):
            t = {"id": int(t["id"]), "nombre": t["nombre"]}
            if a_favoritas:
                core.anadir_favorito(t)
            elif all(int(e["id"]) != t["id"] for e in self._extras):
                self._extras.insert(0, t)
        return self.tareas()

    # ---- copiar dia / semana anterior ----
    def _copiar(self, pares, saltar_no_laborables):
        """pares: [(iso_destino, apuntes_origen)]. Nunca a ciegas: un dia que no
        se pudo leer se salta (podria duplicar), igual que la app de verdad."""
        creados = saltados = errores = 0
        ultimo = ""
        for iso, apuntes in pares:
            if saltar_no_laborables and core.es_no_laborable(iso):
                saltados += len(apuntes)
                continue
            existentes = self._cache.get(iso)
            if existentes is None:
                errores += len(apuntes)
                ultimo = (f"no se pudieron leer los apuntes del "
                          f"{dt.date.fromisoformat(iso).strftime('%d/%m')}; se ha saltado")
                continue
            for a in apuntes:
                if any(str(e.get("wp_id")) == str(a["wp_id"]) for e in existentes):
                    saltados += 1
                    continue
                try:
                    core.crear_entrada(iso, a["wp_id"], a["horas"], a["comentario"],
                                       a["actividad"])
                    creados += 1
                except Exception as e:
                    errores += 1
                    ultimo = str(e)
        return {"creados": creados, "saltados": saltados, "errores": errores,
                "ultimo": ultimo}

    def preparar_copia_dia(self, dias_iso):
        """Busca el ultimo dia laborable con horas (14 dias atras) antes del
        primero marcado. Devuelve el resumen para confirmar, o {'vacio': ...}."""
        if not dias_iso:
            return {"error": "Marca al menos un día de destino."}
        primero = dt.date.fromisoformat(min(dias_iso))
        d = primero - dt.timedelta(days=1)
        for _ in range(14):
            if d.weekday() < 5:
                apuntes = core.entradas_dia(d.isoformat())
                if apuntes:
                    self._copia = ("dia", [(i, apuntes) for i in sorted(dias_iso)])
                    return {"origen": f"{core.DIAS_ES[d.weekday()]} {d.strftime('%d/%m')}",
                            "lineas": [f"{core._fmt(a['horas'])}  {a['wp_titulo']}"
                                       for a in apuntes],
                            "n": len(apuntes), "dias": len(dias_iso)}
            d -= dt.timedelta(days=1)
        return {"vacio": f"No hay apuntes en los 14 días anteriores al "
                         f"{primero.strftime('%d/%m')}."}

    def preparar_copia_semana(self, lunes_iso):
        lunes = dt.date.fromisoformat(lunes_iso)
        destino = [lunes + dt.timedelta(days=i) for i in range(5)]
        origen = [d - dt.timedelta(days=7) for d in destino]
        leidos = {d.isoformat(): core.entradas_dia(d.isoformat()) for d in origen}
        total = sum(len(v) for v in leidos.values())
        if not total:
            return {"vacio": f"La semana del {origen[0].strftime('%d/%m')} no tiene apuntes."}
        self._copia = ("semana", [(destino[i].isoformat(), leidos[o.isoformat()])
                                  for i, o in enumerate(origen)])
        return {"origen": origen[0].strftime("%d/%m"), "n": total,
                "lineas": [f"{core.DIAS_ES[i]}: {len(leidos[o.isoformat()])} apunte(s), "
                           f"{core._fmt(sum(a['horas'] for a in leidos[o.isoformat()]))}"
                           for i, o in enumerate(origen) if leidos[o.isoformat()]]}

    def ejecutar_copia(self):
        if not self._copia:
            return {"error": "No hay ninguna copia preparada."}
        tipo, pares = self._copia
        self._copia = None
        return self._copiar(pares, saltar_no_laborables=(tipo == "semana"))

    # ---- plantillas ----
    def plantillas(self):
        return [{"nombre": p["nombre"], "n": len(p.get("apuntes", [])),
                 "total": core._fmt(sum(a.get("horas", 0) for a in p.get("apuntes", [])))}
                for p in core.PLANTILLAS]

    def guardar_plantilla_dia(self, iso, nombre):
        nombre = (nombre or "").strip()
        apuntes = [a for a in (self._cache.get(iso) or []) if a.get("destino", "op") == "op"]
        if not nombre:
            return {"error": "Ponle un nombre a la plantilla."}
        if not apuntes:
            return {"error": "Ese día no tiene apuntes de ProyectosTic que guardar."}
        core.guardar_plantilla(nombre, [
            {"id": a["wp_id"], "nombre": a["wp_titulo"], "horas": a["horas"],
             "comentario": a["comentario"], "actividad": a["actividad"]} for a in apuntes])
        return {"ok": True, "n": len(apuntes)}

    def aplicar_plantilla(self, nombre, dias_iso):
        p = next((x for x in core.PLANTILLAS if x.get("nombre") == nombre), None)
        if p is None:
            return {"error": "Esa plantilla ya no existe."}
        if not dias_iso:
            return {"error": "Marca al menos un día de destino."}
        apuntes = [{"wp_id": a["id"], "horas": a["horas"],
                    "comentario": a.get("comentario", ""), "actividad": a.get("actividad")}
                   for a in p.get("apuntes", [])]
        return self._copiar([(i, apuntes) for i in sorted(dias_iso)], False)

    def eliminar_plantilla(self, nombre):
        core.eliminar_plantilla(nombre)
        return self.plantillas()

    # ---- resumen del mes (una consulta por rango, no una por dia) ----
    def resumen_mes(self, anio, mes):
        anio, mes = int(anio), int(mes)
        ultimo = calendar.monthrange(anio, mes)[1]
        dias = [dt.date(anio, mes, n) for n in range(1, ultimo + 1)]
        hoy = dt.date.today()
        inari_cfg = destinos.configurado()
        por_dia = {}
        for a in core.entradas_rango(dias[0].isoformat(), dias[-1].isoformat()):
            por_dia.setdefault(a["fecha"], []).append(a)
        total = obj_hoy = obj_mes = tt_horas = 0.0
        tt_dias = 0
        incompletos = []
        for d in dias:
            if d.weekday() >= 5:
                continue
            iso = d.isoformat()
            obj = core.objetivo_de(d)
            obj_mes += obj
            # En un dia de teletrabajo cuentan las horas de INARI, no las de
            # ProyectosTic: cubos disjuntos, sin doble conteo.
            if inari_cfg and core.es_teletrabajo(iso):
                reg = destinos.horas_dia(iso)
                if reg:
                    tt_horas += reg
                    tt_dias += 1
            else:
                reg = sum(a["horas"] for a in por_dia.get(iso, []))
            total += reg
            if d <= hoy:
                obj_hoy += obj
                if obj and reg < obj - 0.001:
                    incompletos.append({"iso": iso,
                                        "dia": f"{core.DIAS_ES[d.weekday()]} {d.strftime('%d/%m')}",
                                        "horas": f"{core._fmt(reg)} / {core._fmt(obj)}"})
        al_dia = total >= obj_hoy - 0.001
        meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
                 "septiembre", "octubre", "noviembre", "diciembre"]
        return {"titulo": f"{meses[mes - 1].capitalize()} {anio}",
                "registrado": core._fmt(total), "objetivo_hoy": core._fmt(obj_hoy),
                "objetivo_mes": core._fmt(obj_mes), "al_dia": al_dia,
                "estado": "Al día ✔" if al_dia else
                          f"Te faltan {core._fmt(obj_hoy - total)} para estar al día",
                "frac": round(max(0.0, min(total / obj_mes if obj_mes else 0.0, 1.0)), 3),
                "teletrabajo": (f"Incluye teletrabajo en INARI: {core._fmt(tt_horas)} "
                                f"en {tt_dias} día(s)") if tt_dias else "",
                "incompletos": incompletos}

    # ---- exportar CSV ----
    def exportar_csv(self, desde, hasta):
        try:
            d1, d2 = dt.date.fromisoformat(desde), dt.date.fromisoformat(hasta)
        except (TypeError, ValueError):
            return {"error": "Elige las dos fechas."}
        if d2 < d1:
            d1, d2 = d2, d1
        apuntes = sorted(core.entradas_rango(d1.isoformat(), d2.isoformat()),
                         key=lambda a: a["fecha"])
        if not apuntes:
            return {"error": "No hay apuntes en ese rango."}
        ruta = self._pedir_ruta(f"horas_{d1.isoformat()}_a_{d2.isoformat()}.csv")
        if not ruta:
            return {"cancelado": True}
        total = sum(a["horas"] for a in apuntes)
        with open(ruta, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh, delimiter=";")
            w.writerow(["Fecha", "Horas", "Tarea", "Actividad", "Comentario"])
            for a in apuntes:
                w.writerow([a["fecha"], core.horas_csv(a["horas"]), a["wp_titulo"],
                            a["actividad"], a["comentario"]])
            w.writerow([])
            w.writerow(["", core.horas_csv(total), "TOTAL"])
        self._ultima_exportacion = ruta
        return {"ruta": ruta, "n": len(apuntes), "total": core._fmt(total)}

    def _pedir_ruta(self, nombre):
        import webview
        res = self._ventana.create_file_dialog(
            webview.FileDialog.SAVE, save_filename=nombre,
            file_types=("CSV (Excel) (*.csv)",))
        if isinstance(res, (list, tuple)):
            res = res[0] if res else None
        return res or None

    def abrir_exportacion(self):
        """Abre el ultimo CSV exportado con su programa (Excel). Solo ese: el JS
        no puede pedir abrir rutas arbitrarias."""
        ruta = getattr(self, "_ultima_exportacion", None)
        if not ruta or not os.path.exists(ruta):
            return {"error": "No hay ninguna exportación que abrir."}
        if os.name == "nt":
            os.startfile(ruta)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", ruta])
        else:
            subprocess.Popen(["xdg-open", ruta])
        return {"ok": True}

    # ---- festivos ----
    def festivos(self, nacional, andalucia, local, ugr):
        amb = tuple(a for a, si in (("nacional", nacional), ("andalucia", andalucia),
                                    ("local", local)) if si)
        pend = core.festivos_pendientes(amb, incluir_ugr=bool(ugr))
        return [{"fecha": dt.date.fromisoformat(f).strftime("%d/%m/%Y"), "nombre": m}
                for f, m in sorted(pend.items())]

    def importar_festivos(self, nacional, andalucia, local, ugr):
        amb = tuple(a for a, si in (("nacional", nacional), ("andalucia", andalucia),
                                    ("local", local)) if si)
        return {"n": core.importar_festivos(amb, incluir_ugr=bool(ugr))}

    # ---- vacaciones y teletrabajo ----
    def ajustes_dias(self):
        anio = dt.date.today().year
        return {"anio": anio, "cupo": core.cupo_vacaciones(),
                "usadas": core.vacaciones_usadas(anio), "tt": core.teletrabajo_por_semana()}

    def guardar_ajustes_dias(self, cupo, tt):
        try:
            cupo = int(float(str(cupo).replace(",", ".")))
            tt = int(float(str(tt).replace(",", ".")))
        except (ValueError, OverflowError):
            return {"error": "Escribe números válidos."}
        if not (0 <= cupo <= 60 and 0 <= tt <= 5):
            return {"error": "El cupo de vacaciones va de 0 a 60 días y el teletrabajo "
                             "de 0 a 5 días por semana."}
        core.guardar_config_valores({"cupo_vacaciones": cupo, "teletrabajo_por_semana": tt})
        return {"ok": True}

    # ---- permisos ----
    def permisos(self):
        conocidas = set(core.ACTIVIDADES)
        conocidas |= set((core.config_valor("tareas_actividad") or {}).keys())
        conocidas |= {core.actividad_de_permiso(t["id"]) for t in core.permisos_tipos()}
        filas = []
        for f in core.resumen_permisos():
            filas.append({
                "id": f["id"], "nombre": f["nombre"], "actividad": f["actividad"],
                "concedidas": core.fmt_horas_hhmm(f["cupo"]),
                "usadas": core.fmt_horas_hhmm(f["usadas"]),
                "usadas_local": core.fmt_horas_hhmm(f["usadas_local"]),
                "usadas_pt": core.fmt_horas_hhmm(f["usadas_pt"]),
                "disponibles": core.fmt_horas_hhmm(f["disponibles"]),
                "negativo": f["disponibles"] < 0,
                "concesiones": [
                    {"horas": core.fmt_horas_hhmm(c["horas"]), "fecha_limite": c["fecha_limite"],
                     "estado": ("caducada" if c in f["caducadas"] else
                                "por_caducar" if c in f["por_caducar"] else "")}
                    for c in f["concesiones"]]})
        return {"desde": core.permisos_desde().strftime("%d/%m/%Y"),
                "anio": dt.date.today().year, "filas": filas,
                "hay_actividades": any(f["actividad"] for f in filas),
                "actividades": sorted({a for a in conocidas if a}, key=str.lower)}

    def actualizar_usadas_pt(self):
        core.actualizar_usadas_proyectostic()
        return self.permisos()

    def anadir_concesion(self, tipo_id, horas, fecha):
        try:
            core.anadir_concesion(tipo_id, horas, fecha)
        except ValueError as e:
            return {"error": str(e)}
        return self.permisos()

    def quitar_concesion(self, tipo_id, indice):
        core.quitar_concesion(tipo_id, int(indice))
        return self.permisos()

    def fijar_actividad_permiso(self, tipo_id, actividad):
        core.fijar_actividad_permiso(tipo_id, actividad)
        return self.permisos()

    def info_permiso_dia(self, iso):
        d = dt.date.fromisoformat(iso)
        jornada = core.jornada_de(d)
        dia_entero = core.horas_dia_permiso()
        ya = core.horas_permiso(iso)
        libre = round(max(jornada, dia_entero) - ya, 2)
        tipos = []
        for t in core.permisos_tipos():
            cad = core.concesiones_caducadas(t["id"])
            prox = core.concesiones_por_caducar(t["id"])
            tipos.append({"id": t["id"], "nombre": t.get("nombre", t["id"]),
                          "disponible": core.fmt_horas_hhmm(core.permiso_disponible(t["id"])),
                          "actividad": core.actividad_de_permiso(t["id"]),
                          "caducadas": len(cad),
                          "caduca": min(c["fecha_limite"] for c in prox) if prox else ""})
        return {"dia": f"{core.DIAS_ES[d.weekday()]} {d.strftime('%d/%m/%Y')}",
                "tipos": tipos, "libre": core.fmt_horas_hhmm(libre), "lleno": libre <= 0,
                "ya": core.fmt_horas_hhmm(ya), "jornada": core.fmt_horas_hhmm(jornada),
                "dia_entero": core.fmt_horas_hhmm(dia_entero),
                "dia_completo": core.fmt_horas_hhmm(round(dia_entero - ya, 2)),
                "distintas": abs(dia_entero - jornada) > 0.01}

    def anadir_permiso(self, iso, tipo_id, horas, confirmado=False):
        h = core.parsear_horas(horas)
        if not h or h <= 0:
            return {"error": "Escribe las horas como 3:00 o 3,5."}
        disp = core.permiso_disponible(tipo_id)
        if h > disp and not confirmado:
            t = core.tipo_permiso(tipo_id) or {}
            return {"confirmar": f"Te quedan {core.fmt_horas_hhmm(disp)} de "
                                 f"«{t.get('nombre', tipo_id)}» y vas a usar "
                                 f"{core.fmt_horas_hhmm(h)}. ¿Continuar?"}
        try:
            core.anadir_permiso(iso, tipo_id, h)
        except ValueError as e:
            return {"error": str(e)}
        return {"ok": True, "horas": core.fmt_horas_hhmm(h)}

    def propuesta_permisos_anio(self):
        return {"anio": dt.date.today().year, "filas": [
            dict(p, horas=core.fmt_horas_hhmm(p["horas"]) if p["horas"] else "",
                 quedan=core.fmt_horas_hhmm(core.permiso_disponible(p["id"])))
            for p in core.propuesta_permisos_del_anio()]}

    def anadir_permisos_anio(self, filas):
        """filas: [{id, nombre, horas, fecha_limite}]. Se valida TODO antes de
        guardar nada: o se añade todo o nada."""
        pendientes = []
        for f in filas:
            txt = str(f.get("horas") or "").strip()
            if not txt:
                continue
            h = core.parsear_horas(txt)
            if not h or h <= 0:
                return {"error": f"{f['nombre']}: escribe las horas como 70:00 o 70, "
                                 "o déjalo en blanco."}
            fecha = str(f.get("fecha_limite") or "").strip()
            if fecha:
                try:
                    dt.date.fromisoformat(fecha)
                except ValueError:
                    return {"error": f"{f['nombre']}: la fecha límite debe ser AAAA-MM-DD "
                                     "(o vacía si no caduca)."}
            pendientes.append((f["id"], h, fecha))
        for tid, h, fecha in pendientes:
            core.anadir_concesion(tid, h, fecha)
        core.marcar_permisos_anio_revisado(dt.date.today().year)
        return {"n": len(pendientes)}

    def permisos_anio_no(self):
        core.marcar_permisos_anio_revisado(dt.date.today().year)
        return {"ok": True}

    # ---- INARI ----
    def inari_config(self):
        import inari
        return {"activo": bool(core.config_valor("inari_activo", False)),
                "url": core.config_valor("inari_url", inari.URL_POR_DEFECTO),
                "usuario": core.config_valor("inari_usuario", ""),
                "hay_token": bool(core.config_valor("inari_token")),
                "proyecto": core.config_valor("inari_project_id"),
                "columna": core.config_valor("inari_column_id"),
                "carril": core.config_valor("inari_swimlane_id"),
                "categoria": core.config_valor("inari_category_id")}

    def _inari_creds(self, url, usuario, token):
        import inari
        usuario, token = (usuario or "").strip(), (token or "").strip()
        if not token:
            u2, t2 = inari.separar_credencial(usuario)
            usuario, token = (u2, t2) if t2 else (usuario, core.config_valor("inari_token", ""))
        return (url or "").strip() or inari.URL_POR_DEFECTO, usuario, token

    def inari_probar(self, url, usuario, token):
        """El token NO viaja de vuelta al JS: si el campo va vacio se usa el guardado."""
        import inari
        url, usuario, token = self._inari_creds(url, usuario, token)
        if not (usuario and token):
            return {"error": "Escribe usuario y token."}
        me = inari.probar_conexion(url, usuario, token)
        return {"nombre": me.get("name") or me.get("username") or usuario,
                "usuario": usuario, "proyectos": inari.proyectos(url, usuario, token)}

    def inari_tablero(self, url, usuario, token, pid):
        import inari
        url, usuario, token = self._inari_creds(url, usuario, token)
        return {"columnas": inari.columnas(url, usuario, token, pid),
                "carriles": inari.carriles(url, usuario, token, pid),
                "categorias": inari.categorias(url, usuario, token, pid)}

    def inari_guardar(self, activo, url, usuario, token, proyecto, columna, carril, categoria):
        url, usuario, token = self._inari_creds(url, usuario, token)
        core.guardar_config_valores({
            "inari_activo": bool(activo), "inari_url": url, "inari_usuario": usuario,
            "inari_token": token, "inari_project_id": proyecto, "inari_column_id": columna,
            "inari_swimlane_id": carril, "inari_category_id": categoria})
        return {"ok": True}

    def inari_opciones_slot(self):
        url, usuario, token = destinos._creds()
        pid = destinos._proyecto()
        tablero = self.inari_tablero(url, usuario, "", pid) if pid else {}

        def pref(clave):
            return (core.config_valor(f"inari_last_{clave}")
                    or core.config_valor(f"inari_{clave}"))
        return dict(tablero, pref={"columna": pref("column_id"), "carril": pref("swimlane_id"),
                                   "categoria": pref("category_id")})

    def duracion(self, inicio, fin):
        h = core.duracion_horas(inicio, fin)
        return core._fmt(h) if h else ""

    def inari_registrar(self, iso, inicio, fin, descripcion, columna, carril, categoria):
        if core.duracion_horas(inicio, fin) is None:
            return {"error": "Escribe inicio y fin como HH:MM, con el fin posterior al inicio."}
        core.guardar_config_valores({k: v for k, v in (
            ("inari_last_column_id", columna), ("inari_last_swimlane_id", carril),
            ("inari_last_category_id", categoria)) if v is not None})
        destinos.registrar(iso, inicio, fin, descripcion, columna, carril, categoria)
        return {"ok": True}

    # ---- ayuda ----
    def novedades(self):
        """NOVEDADES.md como bloques {estilo, texto} (mismo criterio que la app
        Tkinter: las lineas cortadas a 80 columnas se vuelven a juntar)."""
        try:
            with open(_recurso("NOVEDADES.md"), encoding="utf-8") as f:
                lineas = f.read().splitlines()
        except OSError:
            return [{"estilo": "normal", "texto": "No se encontró el fichero de novedades."}]
        sin = lambda t: t.replace("**", "").replace("*", "").replace("`", "")
        out, actual = [], {"estilo": "normal", "texto": ""}

        def volcar():
            if actual["texto"].strip():
                out.append({"estilo": actual["estilo"], "texto": actual["texto"].strip()})
            actual.update(estilo="normal", texto="")
        for ln in lineas:
            limpio = ln.strip()
            if limpio in ("---", "# Novedades de FichaCSIRC"):
                continue
            if limpio.startswith("## "):
                volcar()
                out.append({"estilo": "version", "texto": "Versión " + limpio[3:]})
            elif limpio.startswith("**") and limpio.endswith("**"):
                volcar()
                out.append({"estilo": "apartado", "texto": sin(limpio)})
            elif limpio.startswith("- "):
                volcar()
                actual.update(estilo="punto", texto=sin(limpio[2:]))
            elif limpio:
                actual["texto"] = (actual["texto"] + " " + sin(limpio)).strip()
            else:
                volcar()
        volcar()
        return out

    def abrir_github(self, seccion=""):
        """Solo el repositorio de la app (el JS no puede abrir URLs arbitrarias)."""
        if core.GITHUB_REPO and seccion in ("", "releases"):
            webbrowser.open(f"https://github.com/{core.GITHUB_REPO}"
                            + (f"/{seccion}" if seccion else ""))
        return {"ok": True}


def main():
    import webview
    if ERROR_ARRANQUE:
        # Mismo mensaje que la app de verdad, pero en la propia ventana web.
        import html
        webview.create_window(
            "FichaCSIRC · configuración necesaria",
            html=("<body style='font:15px Segoe UI,sans-serif;padding:32px;"
                  "background:#e9edf2;color:#1f2933'><h2>Configuración necesaria</h2>"
                  f"<p>{html.escape(ERROR_ARRANQUE)}</p></body>"),
            width=560, height=260)
        webview.start()
        return
    api = Api()
    api._ventana = webview.create_window(
        f"FichaCSIRC {core.VERSION} · prototipo web",
        _recurso("web", "index.html"),
        js_api=api, width=1180, height=820, min_size=(900, 660), maximized=True,
        background_color="#e9edf2")
    webview.start()


if __name__ == "__main__":
    main()
