#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
registrar_web.py - FichaCSIRC (desde 3.0): ventana con interfaz HTML (pywebview).

Sustituye a registrar_gui.py + configurar_gui.py (Tkinter), que siguen en el
repo pero ya no se empaquetan. La pantalla es HTML/CSS/JS (carpeta web/) y toda
la logica sigue en Python: el motor (rellenar_horas, destinos) se usa tal cual
y la clase Api es lo unico que ve el JavaScript (window.pywebview.api).

Hace TODO lo de la app Tkinter, incluido el asistente de configuracion (que se
abre solo si no hay config), el aviso diario (--recordatorio) y las
actualizaciones. Mientras EXPERIMENTO sea True:
  - Usa su PROPIA configuracion (FichaCSIRC-experimento), copiada de la real la
    primera vez: lo que se toque en local no afecta a la app de produccion. Los
    apuntes SI van a ProyectosTic (es la misma cuenta).
  - Comprueba si hay version nueva pero NO la instala (instalaria la de
    produccion encima).
  - No programa ni repara el aviso diario: es la MISMA tarea programada que usa
    la app de verdad y la secuestraria.
Pasar a produccion = EXPERIMENTO = False (y empaquetarla en lugar de la Tkinter).

Ejecuta:  python registrar_web.py      (necesita: pip install pywebview)
          python registrar_web.py --recordatorio   (solo el aviso de fichaje)
          python registrar_web.py --configurar     (abre el asistente)
"""

import os
import csv
import sys
import importlib
import threading
import shutil
import base64
import hashlib
import hmac
import secrets
import calendar
import collections
import subprocess
import webbrowser
import datetime as dt


# Interruptor del experimento (ver docstring). False = comportarse como la app
# de produccion: config real, instalar actualizaciones, programar el aviso.
# Para volver a probar algo arriesgado sin tocar la config real: True.
EXPERIMENTO = False


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


if __name__ == "__main__" and EXPERIMENTO:
    preparar_config_experimento()

import configurar as ccore      # noqa: E402  (asistente: no necesita config.json)

core = destinos = None
ERROR_ARRANQUE = ""


def _cargar_motor():
    """Importa el motor o, si ya estaba, lo RECARGA (tras guardar el asistente:
    BASE_URL, API_KEY, jornada, favoritas... se leen al importarse). Devuelve
    True si hay motor; si no hay config.json deja el motivo en ERROR_ARRANQUE.
    La recarga muta el mismo objeto modulo, asi que quien ya lo tenia importado
    (destinos, recordatorio) ve los valores nuevos."""
    global core, destinos, ERROR_ARRANQUE
    try:
        if core is None:
            import rellenar_horas as _core
            import destinos as _destinos
            core, destinos = _core, _destinos
        else:
            importlib.reload(core)
            importlib.reload(destinos)
    except SystemExit as e:            # sin config.json: el motor hace sys.exit
        core = destinos = None
        ERROR_ARRANQUE = str(e)
        return False
    ERROR_ARRANQUE = ""
    return True


_cargar_motor()


def _recurso(*partes):
    base = getattr(sys, "_MEIPASS", "") or os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, *partes)


# ---------------- estado de un dia (lo que pinta cada tarjeta) ----------------

def _horas(h):
    """6.5 -> '6,5h': como se escribe en España. Toda cifra de horas que pinta la
    interfaz pasa por aqui (core._fmt da punto, y mezclar '6.5h' en una fila con
    '6,5 h' en su cabecera quedaba incoherente)."""
    return core._fmt(h).replace(".", ",")


def actividades_de_permiso():
    """Nombres (en minusculas) de las actividades enlazadas a algun permiso."""
    return {core.actividad_de_permiso(t["id"]).lower()
            for t in core.permisos_tipos()} - {""}


def estado_dia(d, apuntes, hoy=None, acts_permiso=None):
    """Lo que necesita la tarjeta de un dia. Misma logica que
    registrar_gui._pintar_semana, pero devuelta como datos: el HTML no decide
    nada, solo pinta segun 'estado'.

    Un dia cubierto por un permiso IMPUTADO como actividad (p. ej. 7 h de
    "Asuntos propios") es un dia de permiso completo, no "7h · +0,5h": el
    permiso vale la jornada oficial y el objetivo es la fichada."""
    hoy = hoy or dt.date.today()
    iso = d.isoformat()
    obj = core.objetivo_de(d)
    nolab = core.es_no_laborable(iso)
    reg = round(sum(a["horas"] for a in apuntes), 2) if apuntes else 0.0
    h_permiso = 0 if nolab else core.horas_permiso(iso)
    if acts_permiso is None:
        acts_permiso = actividades_de_permiso()
    h_permiso_pt = sum(a["horas"] for a in (apuntes or [])
                       if str(a.get("actividad") or "").strip().lower() in acts_permiso)
    dia_permiso_pt = bool(h_permiso_pt) and h_permiso_pt >= core.horas_dia_permiso() - 0.01
    if nolab:
        estado = "vacaciones" if core.es_vacaciones(iso) else "nolab"
        frac = 1.0
        texto = core.motivo_no_laborable(iso).capitalize()
        if reg:
            texto = f"{_horas(reg)} · {texto}"
    elif apuntes is None:
        estado, frac, texto = "error", 0.0, "sin conexión"
    elif (h_permiso and obj == 0) or dia_permiso_pt:
        estado, frac, texto = "permiso", 1.0, "Permiso (día completo)"
        if reg:
            texto = f"{_horas(reg)} · {texto}"
    elif reg > obj + 0.001:
        # Pasarse no es un error: azul y "+0,5h", no rojo y "te pasas".
        estado, frac = "pasado", 1.0
        texto = f"{_horas(reg)} / {_horas(obj)} · +{_horas(reg - obj)}"
    elif reg >= obj - 0.001 and reg > 0:
        estado, frac = "completo", 1.0
        texto = f"{_horas(reg)} / {_horas(obj)}  ✔"
    elif reg > 0:
        estado, frac = "parcial", (reg / obj if obj else 0.0)
        texto = f"{_horas(reg)} / {_horas(obj)}"
    else:
        estado, frac, texto = "vacio", 0.0, f"0h / {_horas(obj)}"
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
        "falta": round(obj - reg, 2) if not (nolab or dia_permiso_pt) else 0.0,
        "exceso": round(reg - obj, 2) if (not (nolab or dia_permiso_pt) and reg > obj) else 0.0,
        "no_laborable": nolab,
        "motivo": core.motivo_no_laborable(iso) if nolab else "",
        "guardia": core.es_guardia(iso),
        "teletrabajo": core.es_teletrabajo(iso),
        "permiso": core.fmt_horas_hhmm(h_permiso) if h_permiso else "",
        "permiso_detalle": [
            f"{(core.tipo_permiso(p.get('tipo')) or {}).get('nombre', p.get('tipo'))}: "
            f"{core.fmt_horas_hhmm(p.get('horas') or 0)}" for p in core.permisos_dia(iso)],
        "apuntes": [
            {"id": str(a["id"]), "horas": a["horas"], "horas_txt": _horas(a["horas"]),
             "wp_id": str(a.get("wp_id") or ""), "tarea": a["wp_titulo"],
             "actividad": a["actividad"], "comentario": a["comentario"],
             "destino": a.get("destino", "op")}
            for a in (apuntes or [])],
    }


# ---------------- utilidades del asistente (las mismas reglas que configurar_gui) ----------------

def _num_jornada(txt):
    """'6,5' o '7' -> numero valido de jornada (0-24]; None si no vale."""
    v = ccore.parsear_numero(txt)
    return v if v is not None and 0 < v <= 24 else None


def _fmt_num(v):
    """7 -> '7', 6.5 -> '6,5' (como se escribe en España)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "7"
    return (str(int(f)) if f == int(f) else f"{f:g}").replace(".", ",")


def _fecha_a_lista(txt, defecto):
    """'16/06' -> [6, 16] (mes, dia); el defecto si no es una fecha DD/MM."""
    try:
        p = str(txt).replace("-", "/").split("/")
        d, m = int(p[0]), int(p[1])
        if 1 <= m <= 12 and 1 <= d <= 31:
            return [m, d]
    except (ValueError, IndexError):
        pass
    return defecto


def _lista_a_fecha(lst):
    try:
        return f"{int(lst[1]):02d}/{int(lst[0]):02d}"
    except (TypeError, ValueError, IndexError):
        return "16/06"


def _motivo_conexion(e):
    """Error de requests -> frase para el usuario (sin volcar trazas)."""
    txt = str(e)
    if "401" in txt:
        return "La API key no es válida o ha caducado (401). Genera otra en ProyectosTic."
    if "403" in txt:
        return "Sin permiso (403)."
    if any(p in txt for p in ("Max retries", "Failed to resolve", "NameResolution",
                              "ConnectTimeout", "ConnectionError", "timed out")):
        return "No se pudo conectar. Revisa la URL y tu red (o la VPN)."
    return f"No se pudo conectar: {txt[:160]}"


# ---------------- API expuesta al JavaScript ----------------

# ---------------------------------------------------------------- PIN de acceso
# Bloqueo de pantalla, NO cifrado: la API key sigue en config.json (asi el aviso
# diario puede mirar las horas sin pedir nada). Del PIN solo se guarda un hash
# lento con sal; los fallos se apuntan en config.json para que cerrar y volver
# a abrir la app no se salte la espera.
PIN_ITERACIONES = 200_000
PIN_FALLOS_LIBRES = 3          # a partir del 4.o fallo, espera creciente
PIN_ESPERA_MAX = 300


def _pin_hash(pin, sal_hex, iteraciones=PIN_ITERACIONES):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(sal_hex),
                               iteraciones).hex()


def _pin_formato(pin):
    """El PIN limpio si son 4-8 cifras; si no, None."""
    pin = str(pin or "").strip()
    return pin if pin.isdigit() and 4 <= len(pin) <= 8 else None


def _pin_nuevo(pin):
    sal = secrets.token_hex(16)
    return {"hash": _pin_hash(pin, sal), "sal": sal, "iter": PIN_ITERACIONES}


def _pin_guardado():
    p = (ccore.cargar_previa() or {}).get("pin")
    return p if isinstance(p, dict) and p.get("hash") and p.get("sal") else None


def _pin_correcto(pin, guardado):
    calc = _pin_hash(str(pin or "").strip(), guardado["sal"],
                     int(guardado.get("iter", PIN_ITERACIONES)))
    return hmac.compare_digest(calc, guardado["hash"])


def _config_cambiar(**valores):
    """Cambia claves de config.json SIN el motor (sirve tambien en el asistente
    y con la app aun bloqueada). None = quitar la clave."""
    cfg = ccore.cargar_previa() or {}
    for k, v in valores.items():
        if v is None:
            cfg.pop(k, None)
        else:
            cfg[k] = v
    ccore.escribir_config(cfg)


class Api:
    """Todo lo que el HTML puede pedir. pywebview llama a cada metodo en su
    propio hilo y el JS recibe una promesa: la interfaz nunca se congela.

    Los metodos devuelven siempre datos serializables a JSON. Los atributos con
    '_' delante no se exponen al JavaScript."""

    def __init__(self):
        self._cache = {}          # iso -> apuntes (None si fallo la lectura)
        self._deshacer = None     # pasos para deshacer lo ultimo (borrar / editar dia)
        self._extras = []         # tareas elegidas con Buscar en esta sesion
        self._copia = None        # copia preparada (dia/semana anterior)
        self._ventana = None      # ventana pywebview (dialogo de guardar)
        self._desbloqueada = _pin_guardado() is None
        self._de_cero = False     # se borro la config por olvidar el PIN

    def _exigir_desbloqueo(self):
        if not self._desbloqueada:
            raise PermissionError("FichaCSIRC está bloqueada: escribe tu PIN.")

    # ---- PIN de acceso ----
    def pin_estado(self):
        return {"activo": _pin_guardado() is not None, "desbloqueada": self._desbloqueada}

    def pin_comprobar(self, pin):
        guardado = _pin_guardado()
        if guardado is None:
            self._desbloqueada = True
            return {"ok": True}
        intentos = (ccore.cargar_previa() or {}).get("pin_intentos") or {}
        ahora = dt.datetime.now()
        try:
            hasta = dt.datetime.fromisoformat(intentos.get("hasta", ""))
        except ValueError:
            hasta = None
        if hasta and hasta > ahora:
            s = int((hasta - ahora).total_seconds()) + 1
            return {"error": f"Demasiados intentos. Espera {s} s.", "espera": s}
        if _pin_correcto(pin, guardado):
            self._desbloqueada = True
            if intentos:
                _config_cambiar(pin_intentos=None)
            return {"ok": True}
        fallos = int(intentos.get("fallos", 0)) + 1
        espera = 0
        if fallos > PIN_FALLOS_LIBRES:
            espera = min(5 * 2 ** (fallos - PIN_FALLOS_LIBRES - 1), PIN_ESPERA_MAX)
        nuevo = {"fallos": fallos}
        if espera:
            nuevo["hasta"] = (ahora + dt.timedelta(seconds=espera)).isoformat(timespec="seconds")
        _config_cambiar(pin_intentos=nuevo)
        if espera:
            return {"error": f"PIN incorrecto. Espera {espera} s antes de volver a probar.",
                    "espera": espera}
        return {"error": "PIN incorrecto."}

    def pin_fijar(self, nuevo, repetido, actual=""):
        """Activa o cambia el PIN. Si ya habia uno, hay que escribir el actual
        (la app puede estar abierta en un equipo desatendido)."""
        self._exigir_desbloqueo()
        guardado = _pin_guardado()
        if guardado is not None and not _pin_correcto(actual, guardado):
            return {"error": "El PIN actual no es correcto."}
        pin = _pin_formato(nuevo)
        if pin is None:
            return {"error": "El PIN debe tener entre 4 y 8 cifras."}
        if pin != str(repetido or "").strip():
            return {"error": "Los dos PIN no coinciden."}
        _config_cambiar(pin=_pin_nuevo(pin), pin_intentos=None)
        return {"ok": True}

    def pin_quitar(self, actual):
        self._exigir_desbloqueo()
        guardado = _pin_guardado()
        if guardado is not None and not _pin_correcto(actual, guardado):
            return {"error": "El PIN actual no es correcto."}
        _config_cambiar(pin=None, pin_intentos=None)
        return {"ok": True}

    def pin_olvidado(self):
        """Sin el PIN no hay forma de entrar: se borra la configuracion entera
        (API key, favoritas, plantillas, permisos, festivos...) y se empieza de
        cero con el asistente. Las horas de OpenProject no se tocan. Reinstalar
        no serviria: config.json vive en la carpeta del usuario, no en la del
        programa, y el desinstalador no la borra."""
        if _pin_guardado() is None:
            return {"ok": True}
        try:
            import recordatorio
            if recordatorio.recordatorios_soportados() and recordatorio.recordatorio_activo():
                recordatorio.desactivar_recordatorio()
        except Exception:
            pass      # el aviso, sin config, ya no puede consultar nada
        try:
            os.remove(ccore.CONFIG_PATH)
        except FileNotFoundError:
            pass
        except OSError as e:
            return {"error": f"No se pudo borrar la configuración: {e}"}
        self._cache.clear()
        self._desbloqueada = True
        self._de_cero = True
        return {"ok": True}

    # ---- arranque ----
    def inicio(self):
        self._exigir_desbloqueo()
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
            "experimento": EXPERIMENTO,
            "github": core.GITHUB_REPO,
            "inari_listo": destinos.configurado(),
            "asociaciones": self.asociaciones(),
            "toca_permisos_anio": core.toca_anadir_permisos_del_anio(),
            "novedades_tras_actualizar": self._novedades_tras_actualizar(),
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
            # Ultima vista elegida (semana/mes): se abre como se dejo.
            "vista": self.vista(),
        }

    def _novedades_tras_actualizar(self):
        """La primera vez que se abre una version distinta de la ultima abierta
        (= se acaba de actualizar) devuelve {'desde': version anterior} para
        ensenar solas las Novedades; si no, None. Queda apuntada al momento:
        sale una sola vez. Una instalacion nueva no la ve, porque el asistente
        ya deja apuntada la version; sin nada apuntado (se viene de la 3.0.x o
        anterior) 'desde' va vacio y se ensena la ultima version."""
        anterior = core.config_valor("ultima_version_abierta") or ""
        if anterior == core.VERSION:
            return None
        try:
            core.guardar_config_valor("ultima_version_abierta", core.VERSION)
        except Exception:
            return None     # si no se puede apuntar, saldria en cada arranque
        return {"desde": anterior}

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
        acts = actividades_de_permiso()
        tarjetas = [estado_dia(d, self._cache.get(d.isoformat()), acts_permiso=acts)
                    for d in dias]
        reg = sum(t["reg"] for t in tarjetas)
        obj = sum(core.objetivo_de(d) for d in dias)
        dom = dias[0] + dt.timedelta(days=6)
        cupo_tt = core.teletrabajo_por_semana()
        return {
            "titulo": f"Semana {dias[0].strftime('%d/%m/%Y')} - {dom.strftime('%d/%m/%Y')}",
            "total": f"{_horas(reg)} / {_horas(obj)}",
            "teletrabajo": (f"{core.teletrabajo_en_semana(dias[0])}/{cupo_tt}"
                            if cupo_tt else ""),
            "conexion": "error" if fallos >= len(dias) else ("warn" if fallos else "ok"),
            "dias": tarjetas,
        }

    # ---- mes ----
    MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
             "septiembre", "octubre", "noviembre", "diciembre"]

    @staticmethod
    def _semanas_de(anio, mes):
        """Lunes de cada semana (L-V) que toca el mes: la cuadricula completa,
        con los dias del mes anterior/siguiente que la rellenan."""
        primero = dt.date(anio, mes, 1)
        ultimo = dt.date(anio, mes, calendar.monthrange(anio, mes)[1])
        lunes = primero - dt.timedelta(days=primero.weekday())
        out = []
        while lunes <= ultimo:
            if lunes + dt.timedelta(days=4) >= primero:   # semana con algun L-V del mes
                out.append(lunes)
            lunes += dt.timedelta(days=7)
        return out

    def mes(self, anio, mes):
        """Vista mensual: semanas completas de L-V con el estado de cada dia, en
        UNA consulta por rango (no una por dia). Rellena la misma cache que la
        semana, asi que anadir, borrar, plantillas y avisos funcionan igual
        sobre cualquier dia de la cuadricula, tambien los de los meses vecinos."""
        anio, mes = int(anio), int(mes)
        semanas = self._semanas_de(anio, mes)
        dias = [l + dt.timedelta(days=i) for l in semanas for i in range(5)]
        inari_cfg = destinos.configurado()
        fallos = 0
        try:
            por_dia = {}
            for a in core.entradas_rango(dias[0].isoformat(), dias[-1].isoformat()):
                por_dia.setdefault(a["fecha"], []).append(a)
            for d in dias:
                self._cache[d.isoformat()] = [dict(a, destino="op")
                                              for a in por_dia.get(d.isoformat(), [])]
        except Exception:
            for d in dias:
                self._cache[d.isoformat()] = None
            fallos = len(dias)
        if inari_cfg and not fallos:
            # Teletrabajo con INARI: esas horas son las de INARI (cubos disjuntos).
            for d in dias:
                iso = d.isoformat()
                if not core.es_teletrabajo(iso):
                    continue
                try:
                    self._cache[iso] = [
                        {"id": s["id"], "horas": s["horas"], "wp_titulo": s["titulo"],
                         "actividad": "INARI · Teletrabajo", "comentario": "",
                         "wp_id": None, "destino": "inari"}
                        for s in destinos.slots_dia(iso)]
                except Exception:
                    self._cache[iso] = None
                    fallos += 1
        return self._pintar_mes(anio, mes, semanas, fallos)

    def repintar_mes(self, anio, mes):
        """Sin red: tras una marca local (festivo, guardia, permiso...)."""
        anio, mes = int(anio), int(mes)
        return self._pintar_mes(anio, mes, self._semanas_de(anio, mes), 0)

    def _pintar_mes(self, anio, mes, semanas, fallos):
        hoy = dt.date.today()
        acts = actividades_de_permiso()
        filas, reg, obj, obj_hoy = [], 0.0, 0.0, 0.0
        for lunes in semanas:
            fila = []
            for i in range(5):
                d = lunes + dt.timedelta(days=i)
                t = estado_dia(d, self._cache.get(d.isoformat()), hoy, acts)
                t.update(dia=d.day, del_mes=(d.month == mes), futuro=(d > hoy))
                fila.append(t)
                if d.month == mes:          # los totales, solo los del mes
                    reg += t["reg"]
                    o = core.objetivo_de(d)
                    obj += o
                    if d <= hoy:
                        obj_hoy += o
            filas.append(fila)
        al_dia = reg >= obj_hoy - 0.001
        total_dias = len(semanas) * 5
        return {
            "titulo": f"{self.MESES[mes - 1].capitalize()} {anio}",
            "anio": anio, "mes": mes,
            "total": f"{_horas(reg)} / {_horas(obj)}",
            "al_dia": al_dia,
            "estado": "Al día ✔" if al_dia else f"Te faltan {_horas(obj_hoy - reg)}",
            "frac": round(max(0.0, min(reg / obj if obj else 0.0, 1.0)), 3),
            "conexion": "error" if fallos >= total_dias else ("warn" if fallos else "ok"),
            "semanas": filas,
        }

    NOMBRES_CORTOS = {"asuntos_particulares": "Asuntos particulares",
                      "servicios_minimos": "Servicios mínimos",
                      "conciliacion": "Conciliación"}

    def _estado_mes(self, anio, mes, por_dia, hasta):
        """(registrado, objetivo hasta 'hasta') de un mes con los apuntes ya
        leidos. Teletrabajo con INARI: cuentan sus horas (cubos disjuntos)."""
        inari_cfg = destinos.configurado()
        reg = obj = 0.0
        for n in range(1, calendar.monthrange(anio, mes)[1] + 1):
            d = dt.date(anio, mes, n)
            if d.weekday() >= 5 or d > hasta:
                continue
            iso = d.isoformat()
            obj += core.objetivo_de(d)
            if inari_cfg and core.es_teletrabajo(iso):
                try:
                    reg += destinos.horas_dia(iso)
                except Exception:
                    pass
            else:
                reg += sum(a["horas"] for a in por_dia.get(iso, []))
        return reg, obj

    MAX_HABITUALES = 5

    @classmethod
    def _habituales(cls, apuntes, desde):
        """Tareas mas usadas en el periodo (por tarea Y actividad): sus horas,
        su parte del total y sus horas HABITUALES por dia (las que mas se
        repiten), que son las que propone el boton "+"."""
        total = sum(a["horas"] for a in apuntes)
        horas, por_dia, nombres = collections.Counter(), {}, {}
        for a in apuntes:
            if not a.get("wp_id"):
                continue
            k = (str(a["wp_id"]), a.get("actividad") or "")
            horas[k] += a["horas"]
            nombres[k] = a["wp_titulo"]
            dia = por_dia.setdefault(k, collections.Counter())
            dia[a["fecha"]] += a["horas"]
        filas = []
        for (wp, act), h in horas.most_common(cls.MAX_HABITUALES):
            # la cantidad diaria que mas se repite (a igualdad, la mayor)
            frec = collections.Counter(round(v, 2) for v in por_dia[(wp, act)].values())
            tipico = max(frec.items(), key=lambda kv: (kv[1], kv[0]))[0]
            filas.append({"wp_id": int(wp), "tarea": nombres[(wp, act)], "actividad": act,
                          "horas": round(h, 2), "horas_txt": _horas(h),
                          "pct": round(100 * h / total) if total else 0,
                          "tipico": tipico, "tipico_txt": _horas(tipico)})
        return {"desde": f"desde el {desde.day} de {cls.MESES[desde.month - 1]}",
                "total": _horas(total), "filas": filas}

    def resumen_franja(self):
        """La franja de resumen (como va el mes, si el anterior quedo a medias,
        el saldo de cada permiso y las vacaciones) y las tareas habituales.
        UNA consulta por rango desde el dia 1 del mes anterior para todo."""
        hoy = dt.date.today()
        ant = (hoy.replace(day=1) - dt.timedelta(days=1))
        out = {"permisos": [], "meses": [], "habituales": None}
        try:
            por_dia = {}
            apuntes = core.entradas_rango(ant.replace(day=1).isoformat(), hoy.isoformat())
            for a in apuntes:
                por_dia.setdefault(a["fecha"], []).append(a)
            out["habituales"] = self._habituales(apuntes, ant.replace(day=1))
            for anio, mes, hasta, siempre in ((hoy.year, hoy.month, hoy, True),
                                              (ant.year, ant.month, ant, False)):
                reg, obj = self._estado_mes(anio, mes, por_dia, hasta)
                al_dia = reg >= obj - 0.001
                if siempre or not al_dia:      # el anterior, solo si quedo a medias
                    out["meses"].append({
                        "titulo": self.MESES[mes - 1].capitalize(), "anio": anio, "mes": mes,
                        "al_dia": al_dia,
                        "texto": "al día ✔" if al_dia else f"faltan {_horas(obj - reg)}"})
        except Exception:
            out["meses"] = []                  # sin red: el resto sigue valiendo
        for t in core.permisos_tipos():
            if not core.concesiones(t["id"]):
                continue
            disp = core.permiso_disponible(t["id"])
            out["permisos"].append({
                "nombre": self.NOMBRES_CORTOS.get(t["id"], t.get("nombre", t["id"])[:26]),
                "disponible": core.fmt_horas_hhmm(disp), "negativo": disp < 0})
        cupo = core.cupo_vacaciones()
        if cupo:
            usadas = core.vacaciones_usadas(hoy.year)
            out["vacaciones"] = {"quedan": cupo - usadas, "cupo": cupo}
        return out

    def vista(self):
        v = core.config_valor("vista_inicio", "semana")
        return v if v in ("semana", "mes") else "semana"

    def guardar_vista(self, vista):
        if vista not in ("semana", "mes"):
            return {"error": "Vista desconocida."}
        try:
            core.guardar_config_valor("vista_inicio", vista)
        except Exception:
            pass      # comodidad: nunca debe romper nada
        return {"ok": True}

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
                repetidos.append(f"{nombre(i)} (ya tiene {_horas(ya)})")
        if repetidos:
            avisos.append({"clave": "repetir", "titulo": "Esa tarea ya tiene horas ese día",
                           "texto": "Ya hay horas de esta tarea en: " + ", ".join(repetidos)
                                    + f". ¿Añadir {_horas(horas)} más? "
                                      "(Si dices que no, esos días se dejan como están.)"})
        exceso = []
        for i in dias_iso:
            if core.es_no_laborable(i):
                continue
            reg = sum(a["horas"] for a in (self._cache.get(i) or []))
            obj = core.objetivo_de(dt.date.fromisoformat(i))
            if reg + horas > obj + 0.001:
                exceso.append(f"{nombre(i)} ({_horas(reg + horas)} de {_horas(obj)})")
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
    def _borrar_uno(self, fecha, entry_id, destino):
        """Borra un apunte y devuelve el paso para deshacerlo (None si es un
        slot de INARI: esos no se pueden recrear tal cual)."""
        if destino == "inari":
            destinos.borrar(entry_id)
            return None
        datos = next((a for a in (self._cache.get(fecha) or [])
                      if str(a["id"]) == str(entry_id)), None)
        core.eliminar_entrada(entry_id)
        if not datos:
            return None
        return {"tipo": "crear", "fecha": fecha, "wp_id": datos["wp_id"],
                "horas": datos["horas"], "comentario": datos["comentario"],
                "actividad": datos["actividad"]}

    def eliminar(self, items):
        """items: [{id, fecha, destino}]. Borra y guarda lo necesario para deshacer."""
        n_ok, errores, ultimo, deshacer = 0, 0, "", []
        for it in items:
            try:
                paso = self._borrar_uno(it["fecha"], it["id"], it.get("destino"))
                if paso:
                    deshacer.append(paso)
                n_ok += 1
            except Exception as e:
                errores += 1
                ultimo = str(e)
        self._deshacer = deshacer or None
        return {"eliminados": n_ok, "errores": errores, "ultimo": ultimo,
                "puede_deshacer": bool(deshacer)}

    def deshacer(self):
        """Lo contrario de lo ultimo, del final al principio: recrea lo borrado,
        devuelve las horas editadas a como estaban y borra lo que se anadio."""
        pasos, self._deshacer = self._deshacer, None
        restaurados, errores, ultimo = 0, 0, ""
        for p in reversed(pasos or []):
            try:
                if p["tipo"] == "crear":
                    core.crear_entrada(p["fecha"], p["wp_id"], p["horas"],
                                       p["comentario"], p["actividad"])
                elif p["tipo"] == "editar":
                    core.actualizar_entrada(p["id"], p["horas"], p["comentario"],
                                            p["actividad"] or None, p["wp_id"])
                else:
                    core.eliminar_entrada(p["id"])
                restaurados += 1
            except Exception as e:
                errores += 1
                ultimo = str(e)
        return {"restaurados": restaurados, "errores": errores, "ultimo": ultimo}

    # ---- editar un dia entero (boton derecho -> Editar dia) ----
    def guardar_dia(self, fecha, cambios):
        """Aplica de una vez lo cambiado en "Editar día":
        cambios = {editar: [{id, horas, actividad}], borrar: [{id, destino}],
                   anadir: [{wp_id, horas, actividad, comentario}]}.
        Se valida TODO antes de tocar nada (una hora mal escrita no deja el dia
        a medias) y de cada paso que sale bien se guarda su contrario, para que
        "Deshacer" devuelva el dia a como estaba."""
        def num(v):
            h = float(str(v).replace(",", "."))
            if not 0 < h <= 24:
                raise ValueError
            return h

        actuales = {str(a["id"]): a for a in (self._cache.get(fecha) or [])}
        editar, anadir = [], []
        try:
            for e in cambios.get("editar") or []:
                a = actuales.get(str(e["id"]))
                if a is None:
                    return {"error": "Algún apunte ya no está en la semana cargada (pulsa F5)."}
                h = num(e["horas"])
                act = e.get("actividad") or a["actividad"]
                if abs(h - a["horas"]) < 0.001 and act == a["actividad"]:
                    continue
                if a.get("destino") == "inari":
                    return {"error": "Para corregir un slot de INARI, bórralo y vuelve a registrarlo."}
                editar.append((a, h, act))
            for n in cambios.get("anadir") or []:
                anadir.append((n, num(n["horas"]), int(n["wp_id"])))
        except (ValueError, TypeError, KeyError):
            return {"error": "Las horas deben ser un número entre 0 y 24 (por ejemplo 3,5)."}

        hechos, errores, ultimo, deshacer = 0, 0, "", []
        for a, h, act in editar:
            try:
                core.actualizar_entrada(a["id"], h, a["comentario"], act or None, a["wp_id"])
                deshacer.append({"tipo": "editar", "id": a["id"], "horas": a["horas"],
                                 "comentario": a["comentario"], "actividad": a["actividad"],
                                 "wp_id": a["wp_id"]})
                hechos += 1
            except Exception as e:
                errores += 1
                ultimo = str(e)
        for b in cambios.get("borrar") or []:
            try:
                paso = self._borrar_uno(fecha, b["id"], b.get("destino"))
                if paso:
                    deshacer.append(paso)
                hechos += 1
            except Exception as e:
                errores += 1
                ultimo = str(e)
        for n, h, wp_id in anadir:
            com = (n.get("comentario") or "").strip()
            if not com and core.es_guardia(fecha):
                com = core.comentario_guardia()
            try:
                nuevo = core.crear_entrada(fecha, wp_id, h, com, n.get("actividad") or None)
                if nuevo:
                    deshacer.append({"tipo": "borrar", "id": nuevo})
                self._recordar(wp_id, com, n.get("actividad"))
                hechos += 1
            except Exception as e:
                errores += 1
                ultimo = str(e)
        self._deshacer = deshacer or None
        return {"hechos": hechos, "errores": errores, "ultimo": ultimo,
                "puede_deshacer": bool(deshacer)}

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
                            "lineas": [f"{_horas(a['horas'])}  {a['wp_titulo']}"
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
                           f"{_horas(sum(a['horas'] for a in leidos[o.isoformat()]))}"
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
                 "total": _horas(sum(a.get("horas", 0) for a in p.get("apuntes", [])))}
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
                                        "horas": f"{_horas(reg)} / {_horas(obj)}"})
        al_dia = total >= obj_hoy - 0.001
        meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
                 "septiembre", "octubre", "noviembre", "diciembre"]
        return {"titulo": f"{meses[mes - 1].capitalize()} {anio}",
                "registrado": _horas(total), "objetivo_hoy": _horas(obj_hoy),
                "objetivo_mes": _horas(obj_mes), "al_dia": al_dia,
                "estado": "Al día ✔" if al_dia else
                          f"Te faltan {_horas(obj_hoy - total)} para estar al día",
                "frac": round(max(0.0, min(total / obj_mes if obj_mes else 0.0, 1.0)), 3),
                "teletrabajo": (f"Incluye teletrabajo en INARI: {_horas(tt_horas)} "
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
        return {"ruta": ruta, "n": len(apuntes), "total": _horas(total)}

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
        return _horas(h) if h else ""

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


    # =============================================================== asistente

    def cfg_cargar(self):
        """Lo que el asistente necesita para rellenar sus pasos. La API key NO se
        manda: solo si hay una guardada (campo vacio = conservarla)."""
        self._exigir_desbloqueo()
        previa = ccore.cargar_previa() or {}
        des = previa.get("desayuno") or 0
        logo = ""
        try:
            with open(_recurso("logo_ugr.png"), "rb") as f:
                logo = "data:image/png;base64," + base64.b64encode(f.read()).decode()
        except OSError:
            pass
        return {
            "primera_vez": core is None or self._de_cero,
            "hay_pin": "pin" in previa,
            "aviso": ERROR_ARRANQUE if ERROR_ARRANQUE and "No encuentro" not in ERROR_ARRANQUE else "",
            "experimento": EXPERIMENTO,
            "logo": logo,
            "url": previa.get("base_url", "https://proyectostic.ugr.es"),
            "hay_key": bool(previa.get("api_key")),
            "jornada": _fmt_num(float(previa.get("jornada_invierno", 7)) + float(des)),
            "desayuno_si": bool(des),
            "desayuno": _fmt_num(des or 0.5),
            "verano_si": bool(previa.get("tiene_verano", True)),
            "verano": _fmt_num(previa.get("jornada_verano", 5)),
            "verano_inicio": _lista_a_fecha(previa.get("verano_inicio", [6, 16])),
            "verano_fin": _lista_a_fecha(previa.get("verano_fin", [9, 15])),
            "actividad": previa.get("actividad_defecto") or previa.get("actividad") or "soporte",
            "actividades": list(ccore.ACTIVIDADES),
            "favoritos": [{"id": int(f["id"]), "nombre": f["nombre"]}
                          for f in previa.get("favoritos", [])],
        }

    def _cfg_key(self, key):
        key = (key or "").strip()
        return key or (ccore.cargar_previa() or {}).get("api_key", "")

    def cfg_probar(self, url, key):
        url, key = (url or "").strip().rstrip("/"), self._cfg_key(key)
        if not url or not key:
            return {"error": "Escribe la URL y la API key."}
        try:
            me = ccore._api_get(url, key, "/api/v3/users/me")
        except Exception as e:
            return {"error": _motivo_conexion(e)}
        return {"nombre": me.get("name", "usuario")}

    def cfg_proyectos(self, url, key):
        try:
            elems = ccore._api_get_todos((url or "").strip().rstrip("/"), self._cfg_key(key),
                                         "/api/v3/projects")
        except Exception as e:
            return {"error": _motivo_conexion(e)}
        return {"proyectos": [{"id": int(p["id"]), "nombre": p.get("name", "?")} for p in elems]}

    def cfg_tareas(self, url, key, pid):
        try:
            elems = ccore._api_get_todos((url or "").strip().rstrip("/"), self._cfg_key(key),
                                         f"/api/v3/projects/{int(pid)}/work_packages")
        except Exception as e:
            if "403" in str(e):
                return {"error": "No tienes permiso para ver las tareas de este proyecto. "
                                 "Elige otro (por ejemplo el de tus tareas habituales)."}
            return {"error": _motivo_conexion(e)}
        return {"tareas": [{"id": int(w["id"]), "nombre": w.get("subject", "?")} for w in elems]}

    def cfg_validar_jornada(self, d):
        """Mismas reglas que el asistente Tkinter. Devuelve {'error'} o el texto
        en vivo de cuanto se ficha."""
        oficial = _num_jornada(d.get("jornada"))
        if oficial is None:
            return {"error": "Las horas por día (normal) deben ser un número entre 0 y 24 "
                             "(puedes usar medias horas, p. ej. 6,5)."}
        if d.get("verano_si"):
            if _num_jornada(d.get("verano")) is None:
                return {"error": "Las horas por día (verano) deben ser un número entre 0 y 24."}
            for nombre in ("verano_inicio", "verano_fin"):
                if _fecha_a_lista(d.get(nombre, ""), None) is None:
                    return {"error": f"La fecha de {'inicio' if 'inicio' in nombre else 'fin'} "
                                     "del verano no es válida. Escríbela como DD/MM (ej. 16/06)."}
        des = (_num_jornada(d.get("desayuno")) or 0) if d.get("desayuno_si") else 0
        fichas = round(oficial - des, 2)
        if des and fichas <= 0:
            return {"error": "El desayuno no puede ser igual o mayor que la jornada."}
        if des:
            texto = (f"Jornada {_fmt_num(oficial)} h − {_fmt_num(des)} h de desayuno = fichas "
                     f"{_fmt_num(fichas)} h al día (un día de permiso cuenta como "
                     f"{_fmt_num(oficial)} h)")
        else:
            texto = f"Fichas {_fmt_num(oficial)} h al día."
        return {"texto": texto}

    def cfg_guardar(self, d):
        """Guarda las claves del asistente SOBRE la config existente (nunca borra
        festivos, permisos, plantillas...) y recarga el motor con ellas."""
        self._exigir_desbloqueo()
        pin = None
        if d.get("pin_si") and not _pin_guardado():
            pin = _pin_formato(d.get("pin"))
            if pin is None or pin != str(d.get("pin2") or "").strip():
                return {"error": "Revisa el PIN: de 4 a 8 cifras y el mismo las dos veces."}
        url = (d.get("url") or "").strip().rstrip("/")
        key = self._cfg_key(d.get("key"))
        if not url or not key:
            return {"error": "Faltan la URL o la API key."}
        val = self.cfg_validar_jornada(d)
        if "error" in val:
            return val
        oficial = _num_jornada(d["jornada"])
        des = (_num_jornada(d.get("desayuno")) or 0) if d.get("desayuno_si") else 0
        cfg = ccore.cargar_previa() or {}
        cfg.update({
            "base_url": url,
            "api_key": key,
            "jornada_invierno": round(oficial - des, 2),
            "desayuno": des,
            # lo que vale un dia completo de permiso: la jornada OFICIAL
            "horas_dia_permiso": oficial,
            "tiene_verano": bool(d.get("verano_si")),
            "jornada_verano": _num_jornada(d.get("verano")) or cfg.get("jornada_verano", 5),
            "verano_inicio": _fecha_a_lista(d.get("verano_inicio", ""), [6, 16]),
            "verano_fin": _fecha_a_lista(d.get("verano_fin", ""), [9, 15]),
            "actividad_defecto": d.get("actividad") or "soporte",
            "favoritos": [{"id": int(f["id"]), "nombre": f["nombre"]}
                          for f in d.get("favoritos", [])],
        })
        if pin:
            cfg["pin"] = _pin_nuevo(pin)
        # recien configurada: sus novedades no son "nuevas" para nadie (la primera
        # vez aun no hay motor: se apunta despues de cargarlo)
        sin_motor = core is None
        if not sin_motor and not cfg.get("ultima_version_abierta"):
            cfg["ultima_version_abierta"] = core.VERSION
        ccore.escribir_config(cfg)
        self._de_cero = False
        if not _cargar_motor():
            return {"error": f"Se guardó, pero no se pudo cargar: {ERROR_ARRANQUE}"}
        if sin_motor and not core.config_valor("ultima_version_abierta"):
            core.guardar_config_valor("ultima_version_abierta", core.VERSION)
        self._cache.clear()
        return {"ok": True}

    def cerrar(self):
        if self._ventana is not None:
            threading.Timer(0.1, self._ventana.destroy).start()
        return {"ok": True}

    # =============================================================== actualizaciones

    def comprobar_actualizacion(self, forzar=False):
        """{'version', 'puede_instalar'} si hay nueva, {'al_dia'} o {'error'}.
        Sin forzar, como mucho cada pocas horas y sin molestar si falla."""
        try:
            res = core.buscar_actualizacion(forzar=bool(forzar))
        except core.ComprobacionFallida as e:
            return {"error": str(e)}
        if not res:
            return {"al_dia": True, "version": core.VERSION}
        version, pagina, instalador = res[0], res[1], (res[2] if len(res) > 2 else "")
        self._actualizacion = (version, pagina, instalador)
        return {"version": version, "actual": core.VERSION,
                "puede_instalar": bool(instalador) and not EXPERIMENTO,
                "experimento": EXPERIMENTO, "mac": sys.platform == "darwin"}

    def instalar_actualizacion(self):
        if EXPERIMENTO:
            return {"error": "El prototipo no instala actualizaciones: instalaría la versión "
                             "de producción encima. Actualiza desde tu FichaCSIRC normal."}
        version, pagina, url = getattr(self, "_actualizacion", (None, "", ""))
        if not url:
            return {"error": "No hay ninguna actualización preparada."}
        import tempfile
        if sys.platform == "darwin":
            nombre = f"FichaCSIRC-{version}-mac-{core.arquitectura_mac()}.dmg"
        else:
            nombre = f"FichaCSIRC-Instalador-{version}.exe"
        try:
            ruta = core.descargar_archivo(url, os.path.join(tempfile.gettempdir(), nombre))
        except Exception as e:
            return {"error": f"No se pudo descargar el instalador: {e}", "pagina": True}
        # Mac: se abre el dmg y la app se cierra (el Finder no deja reemplazar
        # una app abierta). Windows: el instalador cierra la app el mismo.
        subprocess.Popen(["open", ruta] if sys.platform == "darwin" else [ruta], close_fds=True)
        threading.Timer(1.5, self.cerrar).start()
        return {"ok": True, "mac": sys.platform == "darwin"}

    def abrir_pagina_actualizacion(self):
        _v, pagina, _u = getattr(self, "_actualizacion", (None, "", ""))
        if pagina.startswith("https://github.com/"):
            webbrowser.open(pagina)
        return {"ok": True}

    # =============================================================== aviso diario

    def recordatorio_estado(self):
        import recordatorio
        return {"soportado": recordatorio.recordatorios_soportados(),
                "activo": recordatorio.recordatorio_activo(), "experimento": EXPERIMENTO}

    def recordatorio_activar(self, hora):
        if EXPERIMENTO:
            return {"error": "En el prototipo no se programa el aviso (secuestraría el de tu app normal)."}
        import recordatorio
        hora = (hora or "").strip()
        try:
            dt.datetime.strptime(hora, "%H:%M")
        except ValueError:
            return {"error": "Escribe la hora como HH:MM (ej. 16:00)."}
        recordatorio.activar_recordatorio(hora)
        return {"ok": True}

    def recordatorio_desactivar(self):
        if EXPERIMENTO:
            return {"error": "En el prototipo no se toca el aviso de tu app normal."}
        import recordatorio
        recordatorio.desactivar_recordatorio()
        return {"ok": True}

    def aviso_datos(self):
        """Para la ventanita del aviso (aviso.html)."""
        return {"texto": getattr(self, "_aviso", ""), "minutos": 10}

    def aviso_responder(self, abrir):
        if abrir:
            if getattr(sys, "frozen", False):
                subprocess.Popen([sys.executable])
            else:
                subprocess.Popen([sys.executable, os.path.abspath(__file__)])
        return self.cerrar()

    # =============================================================== Mac: Aplicaciones

    def aviso_aplicaciones(self):
        """En Mac (y solo en produccion), por que la app no esta en Aplicaciones
        (o '' si esta bien). Una vez por ruta, como la app Tkinter."""
        if EXPERIMENTO:
            return ""
        motivo = core.fuera_de_aplicaciones()
        if not motivo or core.config_valor("aviso_aplicaciones") == sys.executable:
            return ""
        try:
            core.guardar_config_valor("aviso_aplicaciones", sys.executable)
        except Exception:
            pass
        return motivo

    def abrir_aplicaciones(self):
        if sys.platform == "darwin":
            subprocess.Popen(["open", "/Applications"])
        return {"ok": True}


def _titulo(extra=""):
    v = core.VERSION if core else ""
    return f"FichaCSIRC {v}{' · prototipo web' if EXPERIMENTO else ''}{extra}".strip()


def _main_recordatorio(webview):
    """--recordatorio: lo lanza la tarea programada. Si no falta nada (o no hay
    red), sale en silencio; si falta, una ventanita propia (encima de todo, que
    se cierra sola a los 10 minutos para no dejar el proceso vivo)."""
    if core is None:
        return
    import recordatorio
    pendientes = core.dias_pendientes_semana()
    if not pendientes:
        return
    api = Api()
    api._aviso = recordatorio.mensaje_pendientes(pendientes)
    api._ventana = webview.create_window(
        "FichaCSIRC - Recordatorio", _recurso("web", "aviso.html"), js_api=api,
        width=520, height=340, resizable=False, on_top=True, background_color="#ffffff")
    webview.start()


def main():
    import webview
    if "--recordatorio" in sys.argv[1:]:
        _main_recordatorio(webview)
        return
    if core is not None and not EXPERIMENTO:
        import recordatorio
        # Aviso diario que apunte a un .exe/.app que ya no existe: se repara solo.
        threading.Thread(target=recordatorio.reparar_recordatorio, daemon=True).start()
    api = Api()
    # Sin config.json (primera vez): el propio asistente, no un mensaje de error.
    # --configurar: el acceso "FichaCSIRC - Configurar" del menu Inicio.
    asistente = core is None or "--configurar" in sys.argv[1:]
    pagina = "configurar.html" if asistente else "index.html"
    api._ventana = webview.create_window(
        _titulo() if not asistente else "FichaCSIRC · configuración",
        _recurso("web", pagina), js_api=api, width=1180, height=820,
        min_size=(900, 660), maximized=core is not None, background_color="#e9edf2")
    webview.start()


if __name__ == "__main__":
    main()
