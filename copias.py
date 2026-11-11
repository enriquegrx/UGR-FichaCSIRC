#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Copias de seguridad de config.json, restaurar y exportar/importar.

Por que: la escritura atomica protege de un corte a mitad, pero no de un
cambio que no se queria (un asistente mal rellenado, "He olvidado el PIN",
borrar plantillas o permisos sin querer). Las favoritas, permisos, plantillas
y festivos cuestan mucho de rehacer.

- Copia automatica en <carpeta de config>/copias/ cada vez que cambia algo que
  importa (no por lo que cambia a cada rato: tamaño de ventana, ultima
  comprobacion de version, zoom...). Se guardan las MAX_RECIENTES ultimas y,
  ademas, una por dia de los ultimos DIAS_DIARIAS.
- Restaurar una copia nunca toca lo de ESTE equipo ni las credenciales: API
  key, token de INARI, PIN (decision del usuario: "He olvidado el PIN" conserva
  las copias para recuperar favoritas y plantillas, pero el PIN no vuelve).
  Excepcion (3.2.2): si la config actual NO tiene conexion (URL o API key) y
  la copia si, vuelven la conexion y el PIN de la copia, juntos. Es el caso de
  una config que se rompio; tras "He olvidado el PIN" el asistente pide la API
  key, asi que la actual la tiene y el PIN viejo no vuelve.
- La copia completa (con conexion) mas reciente nunca se purga, aunque
  despues haya muchas copias de una config rota.
- Exportar (para cambiar de equipo) quita credenciales y PIN; importar hace lo
  mismo que restaurar.

Sin dependencias del motor: lo usan tanto rellenar_horas (escritura normal)
como configurar (el asistente, que funciona sin motor).
"""

import datetime as dt
import hashlib
import json
import os
import re
import threading

MAX_RECIENTES = 10
DIAS_DIARIAS = 7
NOMBRE = re.compile(r"^config-(\d{8})-(\d{6})(?:-\d+)?\.json$")

# Cambian a cada rato y no merecen copia (ni se restauran: son de la sesion).
VOLATILES = {
    "ventana", "ultimo_chequeo_update_ts", "pin_intentos", "aviso_semana_vista",
    "ultima_version_abierta", "vista_inicio", "zoom", "paneles", "tema",
    "pin_sugerencia_hasta", "aviso_aplicaciones", "ultima_actividad",
    "permisos_anio_revisado", "recordatorio_ejecutable",
}
# Credenciales y PIN: ni se exportan ni vuelven al restaurar.
SECRETOS = ("api_key", "inari_token")
PIN = ("pin", "pin_intentos", "pin_auto_min", "pin_sugerencia_hasta")
# De este equipo (no viajan a otro): bandeja e inicio con Windows.
DE_ESTE_EQUIPO = ("bandeja",)
# Sin esto la app no puede conectar con ProyectosTIC.
CONEXION = ("base_url", "api_key")


def completa(cfg):
    """La config tiene con que conectarse (URL y API key)."""
    return isinstance(cfg, dict) and all(cfg.get(k) for k in CONEXION)


def carpeta(ruta_config):
    return os.path.join(os.path.dirname(os.path.abspath(ruta_config)), "copias")


def _huella(cfg):
    importa = {k: v for k, v in (cfg or {}).items() if k not in VOLATILES}
    return hashlib.sha1(json.dumps(importa, sort_keys=True, ensure_ascii=False)
                        .encode("utf-8")).hexdigest()


def _indice(dirc):
    try:
        with open(os.path.join(dirc, "indice.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _escribir(ruta, datos):
    tmp = f"{ruta}.{os.getpid()}-{threading.get_ident()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)
    os.replace(tmp, ruta)


def quizas_copiar(ruta_config, cfg, ahora=None):
    """Guarda una copia si lo que importa cambio desde la ultima. Devuelve el
    nombre de la copia o None. Nunca debe impedir guardar: el que llama
    traga los errores."""
    if not cfg:
        return None
    dirc = carpeta(ruta_config)
    os.makedirs(dirc, exist_ok=True)
    huella = _huella(cfg)
    indice = _indice(dirc)
    if indice.get("ultima_huella") == huella:
        return None
    ahora = ahora or dt.datetime.now()
    nombre = f"config-{ahora:%Y%m%d-%H%M%S}.json"
    n = 1
    while os.path.exists(os.path.join(dirc, nombre)):     # dos en el mismo segundo
        nombre = f"config-{ahora:%Y%m%d-%H%M%S}-{n}.json"
        n += 1
    _escribir(os.path.join(dirc, nombre), cfg)
    _escribir(os.path.join(dirc, "indice.json"),
              {**indice, "ultima_huella": huella, "ultima": nombre})
    purgar(ruta_config, ahora)
    return nombre


def _fecha(nombre):
    m = NOMBRE.match(nombre)
    return dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S") if m else None


def purgar(ruta_config, ahora=None):
    """Deja las MAX_RECIENTES ultimas y la mas reciente de cada uno de los
    ultimos DIAS_DIARIAS dias."""
    ahora = ahora or dt.datetime.now()
    dirc = carpeta(ruta_config)
    try:
        nombres = sorted((n for n in os.listdir(dirc) if NOMBRE.match(n)), reverse=True)
    except OSError:
        return
    quedan = set(nombres[:MAX_RECIENTES])
    # la completa mas reciente se queda siempre: si la config se rompe y se
    # sigue usando, las copias de la rota no deben llevarse la ultima buena
    for n in nombres:
        try:
            if completa(leer(ruta_config, n)):
                quedan.add(n)
                break
        except (OSError, ValueError):
            continue
    dias = set()
    for n in nombres:
        f = _fecha(n)
        if (ahora - f).days < DIAS_DIARIAS and f.date() not in dias:
            dias.add(f.date())
            quedan.add(n)
    for n in nombres:
        if n not in quedan:
            try:
                os.remove(os.path.join(dirc, n))
            except OSError:
                pass


def resumen(cfg):
    partes = [
        (len(cfg.get("favoritos") or []), "favorita", "favoritas"),
        (len(cfg.get("plantillas") or []), "plantilla", "plantillas"),
        (len(cfg.get("permisos_tipos") or []), "tipo de permiso", "tipos de permiso"),
        (len(cfg.get("no_laborables") or {}), "día marcado", "días marcados"),
    ]
    return " · ".join(f"{n} {uno if n == 1 else varios}" for n, uno, varios in partes if n) or "sin datos"


def listar(ruta_config):
    """Las copias, de la mas nueva a la mas vieja: {id, fecha, resumen}."""
    dirc = carpeta(ruta_config)
    try:
        nombres = sorted((n for n in os.listdir(dirc) if NOMBRE.match(n)), reverse=True)
    except OSError:
        return []
    out = []
    for n in nombres:
        try:
            out.append({"id": n, "fecha": _fecha(n), "resumen": resumen(leer(ruta_config, n))})
        except (OSError, ValueError):
            continue
    return out


def leer(ruta_config, nombre):
    if not NOMBRE.match(nombre or ""):          # nada de rutas: solo nombres de copia
        raise ValueError("Copia no válida.")
    with open(os.path.join(carpeta(ruta_config), nombre), encoding="utf-8") as f:
        datos = json.load(f)
    if not isinstance(datos, dict):
        raise ValueError("Copia no válida.")
    return datos


def marcar_de_cero(ruta_config, ahora=None):
    """"He olvidado el PIN": las copias de antes ya no sirven para recuperar
    sola la config al arrancar (traerian el PIN olvidado). Siguen en la lista
    para restaurar a mano favoritas y plantillas."""
    dirc = carpeta(ruta_config)
    os.makedirs(dirc, exist_ok=True)
    ahora = ahora or dt.datetime.now()
    _escribir(os.path.join(dirc, "indice.json"),
              {**_indice(dirc), "de_cero_desde": ahora.strftime("%Y%m%d%H%M%S")})


def ultima_completa(ruta_config):
    """(nombre, datos) de la copia mas reciente con conexion, posterior a un
    "He olvidado el PIN"; o None."""
    dirc = carpeta(ruta_config)
    desde = _indice(dirc).get("de_cero_desde") or ""
    try:
        nombres = sorted((n for n in os.listdir(dirc) if NOMBRE.match(n)), reverse=True)
    except OSError:
        return None
    for n in nombres:
        if desde and _fecha(n).strftime("%Y%m%d%H%M%S") <= desde:
            break
        try:
            datos = leer(ruta_config, n)
        except (OSError, ValueError):
            continue
        if completa(datos):
            return n, datos
    return None


def combinar(actual, nueva):
    """La configuracion restaurada/importada, conservando de la actual lo que
    no debe viajar: credenciales, PIN, cosas de este equipo y de la sesion.
    Si la actual se quedo sin conexion y la copia la tiene, la conexion vuelve
    (con el PIN de la copia: lo que se protegia sigue protegido)."""
    actual = actual or {}
    conservar = set(SECRETOS) | set(PIN) | set(DE_ESTE_EQUIPO) | VOLATILES | {"base_url"}
    if not completa(actual) and completa(nueva):
        conservar -= set(SECRETOS) | {"pin", "pin_auto_min", "base_url"}
    out = {k: v for k, v in nueva.items() if k not in conservar and not k.startswith("_")}
    for k in conservar:
        if k in actual:
            out[k] = actual[k]
    if not out.get("base_url"):
        out.pop("base_url", None)
    return out


def para_exportar(cfg, version=""):
    quitar = set(SECRETOS) | set(PIN) | set(DE_ESTE_EQUIPO) | VOLATILES
    out = {k: v for k, v in (cfg or {}).items() if k not in quitar}
    out["_exportado"] = {"app": "FichaCSIRC", "version": version,
                         "fecha": dt.datetime.now().isoformat(timespec="seconds")}
    return out


def es_exportacion(datos):
    """Un JSON que se puede importar: una exportacion de FichaCSIRC o, al
    menos, algo con pinta de config (no cualquier fichero)."""
    if not isinstance(datos, dict):
        return False
    if (datos.get("_exportado") or {}).get("app") == "FichaCSIRC":
        return True
    return any(k in datos for k in ("favoritos", "jornada_invierno", "plantillas", "permisos_tipos"))
