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
  - Solo la ventana principal: los dialogos (plantillas, permisos, resumen...)
    aun no estan.

Ejecuta:  python registrar_web.py      (necesita: pip install pywebview)
"""

import os
import sys
import shutil
import base64
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

    # ---- arranque ----
    def inicio(self):
        logo = ""
        try:
            with open(_recurso("logo_ugr.png"), "rb") as f:
                logo = "data:image/png;base64," + base64.b64encode(f.read()).decode()
        except OSError:
            pass
        hoy = dt.date.today()
        return {
            "version": core.VERSION,
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
        return [{"id": int(w["id"]), "nombre": w["nombre"],
                 "texto": f"{w['id']} - {w['nombre']}"} for w in core.FAVORITOS]

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
    webview.create_window(
        f"FichaCSIRC {core.VERSION} · prototipo web",
        _recurso("web", "index.html"),
        js_api=api, width=1180, height=820, min_size=(900, 660), maximized=True,
        background_color="#e9edf2")
    webview.start()


if __name__ == "__main__":
    main()
