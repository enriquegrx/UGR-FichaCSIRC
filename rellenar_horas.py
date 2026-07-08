#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rellenar_horas.py - Registro interactivo de horas en OpenProject (API REST v3).

Eliges un dia y vas anadiendo apuntes: tarea + horas + comentario + actividad.
Muestra en todo momento cuantas horas llevas y cuantas faltan para tu jornada,
pero puedes cerrar el dia sin completarlo. Puedes borrar apuntes.

   python rellenar_horas.py
"""

import os
import re
import sys
import json
import csv
import time
import logging
import logging.handlers
import datetime as dt
import base64

try:
    import requests
except ImportError:
    sys.exit("Falta 'requests'. Instala con:  pip install requests")

def _config_path():
    ruta = os.environ.get("FICHACSIRC_CONFIG")  # para tests o configs alternativas
    if ruta:
        return ruta
    if getattr(sys, "frozen", False):
        if sys.platform == "darwin":
            base = os.path.join(os.path.expanduser("~/Library/Application Support"), "FichaCSIRC")
        elif os.name == "nt":
            base = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "FichaCSIRC")
        else:
            base = os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")),
                                "FichaCSIRC")
        os.makedirs(base, exist_ok=True)
        return os.path.join(base, "config.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


CONFIG_PATH = _config_path()

VERSION = "2.6.4"
# Repo de GitHub "usuario/repositorio" para avisar de versiones nuevas.
# Vacio = comprobacion desactivada.
GITHUB_REPO = "enriquegrx/UGR-FichaCSIRC"
UPDATE_CHECK_INTERVAL_HOURS = 4
WINDOWS_INSTALLER_ASSET = "FichaCSIRC-Instalador.exe"


def buscar_actualizacion(forzar=False):
    """Devuelve (version, pagina, instalador) si hay release nueva, o None.

    Comprueba como mucho cada pocas horas (para no gastar el limite de la API de
    GitHub, sobre todo si varios usuarios salen por la misma IP). Con
    forzar=True salta esa restriccion (util para un boton "comprobar ahora")."""
    if not GITHUB_REPO:
        return None
    if not forzar and _chequeo_update_reciente():
        return None
    try:
        r = requests.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
            timeout=10)
        if r.status_code != 200:
            return None
        data = r.json()
    except Exception:
        return None  # sin conexion: no marcamos el dia, se reintenta luego
    try:
        guardar_config_valor("ultimo_chequeo_update_ts",
                             dt.datetime.now().isoformat(timespec="seconds"))
    except Exception:
        pass

    tag = str(data.get("tag_name", ""))
    if _version_tuple(tag) and _version_tuple(tag) > _version_tuple(VERSION):
        return tag.lstrip("v"), data.get("html_url", ""), _asset_instalador(data)
    return None


def _version_tuple(s):
    try:
        return tuple(int(x) for x in str(s).lstrip("v").split("."))
    except ValueError:
        return ()


def _chequeo_update_reciente():
    ultimo = config_valor("ultimo_chequeo_update_ts")
    if not ultimo:
        return False
    try:
        anterior = dt.datetime.fromisoformat(ultimo)
    except ValueError:
        return False
    intervalo = dt.timedelta(hours=UPDATE_CHECK_INTERVAL_HOURS)
    return dt.datetime.now() - anterior < intervalo


def _asset_instalador(data):
    """URL del instalador Windows en la release, si aplica."""
    if os.name != "nt":
        return ""
    for asset in data.get("assets", []):
        if asset.get("name") == WINDOWS_INSTALLER_ASSET:
            return asset.get("browser_download_url", "")
    return ""


def descargar_archivo(url, destino):
    """Descarga un archivo a destino de forma atomica."""
    if not url:
        raise ValueError("No hay URL de descarga")
    tmp = destino + ".tmp"
    try:
        r = requests.get(url, stream=True, timeout=60)
        try:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=128 * 1024):
                    if chunk:
                        f.write(chunk)
            os.replace(tmp, destino)
            return destino
        finally:
            close = getattr(r, "close", None)
            if close:
                close()
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _configurar_log():
    """Log a fichero junto a la config (para diagnosticar problemas a distancia)."""
    log = logging.getLogger("fichacsirc")
    if log.handlers:
        return log
    log.setLevel(logging.INFO)
    try:
        ruta = os.path.join(os.path.dirname(CONFIG_PATH) or ".", "fichacsirc.log")
        h = logging.handlers.RotatingFileHandler(
            ruta, maxBytes=200_000, backupCount=1, encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        log.addHandler(h)
    except Exception:
        log.addHandler(logging.NullHandler())
    return log


LOG = _configurar_log()


def _msg_configurar():
    if getattr(sys, "frozen", False):
        if sys.platform == "darwin":
            return "Ejecuta primero FichaCSIRC-Configurar.app"
        return "Ejecuta primero FichaCSIRC-Configurar.exe"
    if os.name != "nt":
        return 'Ejecuta primero "python3 configurar_gui.py"'
    return 'Ejecuta primero "FichaCSIRC - Configurar.bat"'


def _cargar_config():
    if not os.path.exists(CONFIG_PATH):
        sys.exit("No encuentro 'config.json'. " + _msg_configurar())
    try:
        with open(CONFIG_PATH, encoding="utf-8-sig") as f:  # tolera BOM (Bloc de notas)
            return json.load(f)
    except Exception as e:
        sys.exit(f"No se pudo leer config.json: {e}")


_cfg = _cargar_config()
BASE_URL = str(_cfg.get("base_url", "")).rstrip("/")
API_KEY = _cfg.get("api_key", "")
ACTIVIDAD_DEFECTO = _cfg.get("actividad_defecto") or _cfg.get("actividad") or None
JORNADA_INV = _cfg.get("jornada_invierno", 7)
JORNADA_VER = _cfg.get("jornada_verano", JORNADA_INV)
TIENE_VERANO = _cfg.get("tiene_verano", True)
VERANO_INICIO = tuple(_cfg.get("verano_inicio", [6, 16]))
VERANO_FIN = tuple(_cfg.get("verano_fin", [9, 15]))
FAVORITOS = _cfg.get("favoritos", [])
NO_LABORABLES = dict(_cfg.get("no_laborables", {}))  # "AAAA-MM-DD" -> motivo
PLANTILLAS = list(_cfg.get("plantillas", []))
# Modalidades de trabajo (NO son dias no laborables: se trabaja igual). Cada
# una es un conjunto de fechas "AAAA-MM-DD".
GUARDIAS = set(_cfg.get("guardias", []))
TELETRABAJO = set(_cfg.get("teletrabajo", []))


def config_valor(clave, defecto=None):
    return _cfg.get(clave, defecto)


def guardar_config_valores(valores):
    """Actualiza varias claves de config.json en una sola lectura/escritura."""
    try:
        with open(CONFIG_PATH, encoding="utf-8-sig") as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}
    cfg.update(valores)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    _cfg.update(valores)


def guardar_config_valor(clave, valor):
    """Actualiza una clave de config.json sin tocar el resto."""
    guardar_config_valores({clave: valor})

ACTIVIDADES = ["actuacion tecnica", "correctivo", "formacion",
               "gestion/planificacion", "soporte"]
DIAS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]


# ----------------------- API -----------------------

def _auth():
    token = base64.b64encode(f"apikey:{API_KEY}".encode()).decode()
    return {"Authorization": f"Basic {token}", "Content-Type": "application/json"}


def _get(path, params=None):
    r = None
    for intento in (1, 2):  # un reintento ante errores transitorios de red
        try:
            r = requests.get(f"{BASE_URL}{path}", headers=_auth(),
                             params=params, timeout=30)
            break
        except (requests.ConnectionError, requests.Timeout) as e:
            if intento == 2:
                LOG.warning("GET %s fallo tras reintentar: %s", path, e)
                raise
            time.sleep(0.8)
    if r.status_code == 401:
        raise RuntimeError("Acceso denegado (401): la API key no es válida o ha caducado. "
                           + _msg_configurar())
    r.raise_for_status()
    return r.json()


def _get_todos(path, params=None):
    """Todos los elementos de un listado, siguiendo la paginacion por offset
    (con pageSize fijo los resultados a partir del 200 se perdian en silencio)."""
    params = dict(params or {})
    params.setdefault("pageSize", 200)
    out = []
    offset = 1
    while True:
        params["offset"] = offset
        data = _get(path, params=params)
        elems = data.get("_embedded", {}).get("elements", [])
        out.extend(elems)
        total = data.get("total", len(out))
        if not elems or len(out) >= total:
            return out
        offset += 1


_ME = None


def _me():
    """Datos del usuario autenticado (cacheados tras la primera respuesta valida)."""
    global _ME
    if not _ME:
        try:
            _ME = _get("/api/v3/users/me")
        except Exception:
            return {}
    return _ME


def _user_id():
    return str(_me().get("id", ""))


def nombre_usuario():
    return _me().get("name", "")


def _parse_horas(iso):
    if not iso:
        return 0.0
    h = re.search(r"(\d+(?:\.\d+)?)H", iso)
    m = re.search(r"(\d+(?:\.\d+)?)M", iso)
    return (float(h.group(1)) if h else 0.0) + (float(m.group(1)) if m else 0.0) / 60.0


def _iso_dur(horas):
    total = int(round(horas * 60))
    h, m = divmod(total, 60)
    s = "PT"
    if h:
        s += f"{h}H"
    if m:
        s += f"{m}M"
    return s if s != "PT" else "PT0H"


def _fmt(horas):
    return (f"{horas:.2f}".rstrip("0").rstrip(".")) + "h"


def entradas_dia(fecha_iso):
    uid = _user_id()
    filtros = [{"spent_on": {"operator": "=d", "values": [fecha_iso]}}]
    if uid:
        filtros.append({"user": {"operator": "=", "values": [uid]}})
    data = _get("/api/v3/time_entries",
                params={"filters": json.dumps(filtros), "pageSize": 100})
    out = []
    for e in data.get("_embedded", {}).get("elements", []):
        links = e.get("_links", {})
        wp = links.get("workPackage", {})
        _href = wp.get("href", "") or ""
        _wpid = _href.rstrip("/").split("/")[-1] if _href else ""
        out.append({
            "id": e["id"],
            "wp_id": _wpid,
            "horas": _parse_horas(e.get("hours")),
            "wp_titulo": wp.get("title", "?"),
            "comentario": (e.get("comment") or {}).get("raw", ""),
            "actividad": links.get("activity", {}).get("title", ""),
        })
    return out


# Caché de actividades POR work package: las actividades permitidas se
# configuran por proyecto, asi que no se pueden compartir entre tareas.
_ACT_CACHE = {}


def _actividades_disponibles(wp_id):
    """Devuelve {nombre: href} de las actividades permitidas para ESE work
    package, via el formulario de time_entries (compatible con todas las
    versiones de OpenProject). Se cachea por wp_id."""
    key = str(wp_id)
    if key in _ACT_CACHE:
        return _ACT_CACHE[key]
    body = {"_links": {"workPackage": {"href": f"/api/v3/work_packages/{wp_id}"}}}
    r = requests.post(f"{BASE_URL}/api/v3/time_entries/form",
                      headers=_auth(), json=body, timeout=30)
    r.raise_for_status()
    data = r.json()
    vals = (data.get("_embedded", {}).get("schema", {})
                .get("activity", {}).get("_embedded", {}).get("allowedValues", []))
    acts = {}
    for v in vals:
        nombre = v.get("name") or v.get("_links", {}).get("self", {}).get("title", "")
        href = v.get("_links", {}).get("self", {}).get("href", "")
        if nombre and href:
            acts[nombre] = href
    _ACT_CACHE[key] = acts
    return acts


def _actividad_href(wp_id, nombre):
    try:
        acts = _actividades_disponibles(wp_id)
    except Exception:
        return None
    for name, href in acts.items():
        if name.lower() == str(nombre).lower():
            return href
    for name, href in acts.items():
        if str(nombre).lower() in name.lower():
            return href
    return None


def crear_entrada(fecha_iso, wp_id, horas, comentario, actividad):
    payload = {
        "hours": _iso_dur(horas),
        "spentOn": fecha_iso,
        "comment": {"raw": comentario or ""},
        "_links": {"workPackage": {"href": f"/api/v3/work_packages/{wp_id}"}},
    }
    if actividad:
        href = _actividad_href(wp_id, actividad)
        if href:
            payload["_links"]["activity"] = {"href": href}
    r = requests.post(f"{BASE_URL}/api/v3/time_entries",
                      headers=_auth(), json=payload, timeout=30)
    if r.status_code not in (200, 201):
        LOG.error("Crear apunte fallo %s: %s", r.status_code, r.text[:200])
        raise RuntimeError(f"Error {r.status_code}: {r.text[:200]}")
    LOG.info("Apunte creado: %s %sh wp=%s", fecha_iso, horas, wp_id)


def actualizar_entrada(entry_id, horas, comentario, actividad=None, wp_id=None):
    """Edita horas/comentario (y actividad si se puede resolver) de un apunte."""
    payload = {
        "hours": _iso_dur(horas),
        "comment": {"raw": comentario or ""},
    }
    if actividad and wp_id:
        href = _actividad_href(wp_id, actividad)
        if href:
            payload["_links"] = {"activity": {"href": href}}
    r = requests.patch(f"{BASE_URL}/api/v3/time_entries/{entry_id}",
                       headers=_auth(), json=payload, timeout=30)
    if r.status_code not in (200, 201):
        LOG.error("Actualizar apunte %s fallo %s: %s",
                  entry_id, r.status_code, r.text[:200])
        raise RuntimeError(f"Error {r.status_code}: {r.text[:200]}")
    LOG.info("Apunte %s actualizado: %sh", entry_id, horas)


def eliminar_entrada(entry_id):
    r = requests.delete(f"{BASE_URL}/api/v3/time_entries/{entry_id}",
                        headers=_auth(), timeout=30)
    if r.status_code not in (200, 204):
        LOG.error("Eliminar apunte %s fallo %s: %s",
                  entry_id, r.status_code, r.text[:200])
        raise RuntimeError(f"Error {r.status_code}: {r.text[:200]}")
    LOG.info("Apunte %s eliminado", entry_id)


def info_wp(wp_id):
    try:
        w = _get(f"/api/v3/work_packages/{wp_id}")
        return {"id": int(w["id"]), "nombre": w.get("subject", "?")}
    except Exception:
        return None


def proyectos():
    return [{"id": int(p["id"]), "nombre": p.get("name", "?")}
            for p in _get_todos("/api/v3/projects")]


def tareas_proyecto(pid):
    return [{"id": int(w["id"]), "nombre": w.get("subject", "?")}
            for w in _get_todos(f"/api/v3/projects/{pid}/work_packages")]


def buscar_wp(texto, limite=50):
    """Busca tareas por texto en TODOS los proyectos visibles. Lanza excepcion
    si falla la red (el que llama decide como avisar)."""
    filtros = [{"subject": {"operator": "~", "values": [texto]}}]
    data = _get("/api/v3/work_packages",
                params={"filters": json.dumps(filtros), "pageSize": limite})
    return [{"id": int(w["id"]), "nombre": w.get("subject", "?")}
            for w in data.get("_embedded", {}).get("elements", [])]


# ----------------------- entradas de usuario -----------------------

def preguntar_horas(pregunta):
    while True:
        r = input(pregunta).strip().replace(",", ".")
        try:
            v = float(r)
            if v > 0:
                return v
        except ValueError:
            pass
        print("  Escribe un numero de horas (ej. 3  o  3.5).")


def elegir_actividad(wp_id=None):
    nombres = []
    if wp_id:
        try:
            nombres = list(_actividades_disponibles(wp_id).keys())
        except Exception:
            nombres = []
    if not nombres:
        nombres = ACTIVIDADES
    def_idx = None
    for i, a in enumerate(nombres):
        if ACTIVIDAD_DEFECTO and a.lower() == str(ACTIVIDAD_DEFECTO).lower():
            def_idx = i
    print("  Actividad:")
    for i, a in enumerate(nombres, 1):
        marca = "  (por defecto)" if def_idx is not None and (i - 1) == def_idx else ""
        print(f"    {i}) {a}{marca}")
    etiqueta = nombres[def_idx] if def_idx is not None else (ACTIVIDAD_DEFECTO or "Enter")
    r = input(f"  Elige [{etiqueta}]: ").strip()
    if not r:
        return nombres[def_idx] if def_idx is not None else ACTIVIDAD_DEFECTO
    if r.isdigit() and 1 <= int(r) <= len(nombres):
        return nombres[int(r) - 1]
    return r


def elegir_tarea():
    print("\n  Elegir tarea:")
    if FAVORITOS:
        print("  Favoritas:")
        for i, wp in enumerate(FAVORITOS, 1):
            print(f"    {i}) {wp['id']}  {wp['nombre'][:44]}")
    print("  Escribe: numero de favorita  |  un ID (ej. 12065)  |  texto para buscar")
    while True:
        r = input("  > ").strip()
        if not r:
            return None
        if r.isdigit() and 1 <= int(r) <= len(FAVORITOS):
            wp = FAVORITOS[int(r) - 1]
            return {"id": int(wp["id"]), "nombre": wp["nombre"]}
        if r.isdigit():
            wp = info_wp(r)
            if wp:
                return wp
            print("  No existe ese ID o no tienes acceso.")
            continue
        try:
            res = buscar_wp(r)
        except Exception as e:
            print(f"  Error al buscar: {e}")
            continue
        if not res:
            print("  Sin resultados. Prueba otro texto o un ID.")
            continue
        print("  Resultados:")
        for i, wp in enumerate(res, 1):
            print(f"    {i}) {wp['id']}  {wp['nombre'][:50]}")
        sel = input("  Elige numero (Enter para cancelar): ").strip()
        if sel.isdigit() and 1 <= int(sel) <= len(res):
            return res[int(sel) - 1]
        print("  Cancelado, prueba otra vez.")


# ----------------------- fechas -----------------------

def _hoy():
    return dt.date.today()


def _lunes():
    h = _hoy()
    return h - dt.timedelta(days=h.weekday())


def es_verano(dia):
    if not TIENE_VERANO:
        return False
    return VERANO_INICIO <= (dia.month, dia.day) <= VERANO_FIN


def jornada_de(dia):
    return JORNADA_VER if es_verano(dia) else JORNADA_INV


def es_no_laborable(fecha_iso):
    return fecha_iso in NO_LABORABLES


def motivo_no_laborable(fecha_iso):
    return NO_LABORABLES.get(fecha_iso, "")


def marcar_no_laborable(fecha_iso, motivo="festivo"):
    NO_LABORABLES[fecha_iso] = motivo
    guardar_config_valor("no_laborables", NO_LABORABLES)


def quitar_no_laborable(fecha_iso):
    NO_LABORABLES.pop(fecha_iso, None)
    guardar_config_valor("no_laborables", NO_LABORABLES)


# ----------------------- festivos -----------------------

AMBITOS = ("nacional", "andalucia", "local")


def _pascua(anio):
    """Domingo de Pascua del anio (algoritmo de Gauss/Butcher)."""
    a = anio % 19
    b, c = divmod(anio, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    ll = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ll) // 451
    mes = (h + ll - 7 * m + 114) // 31
    dia = ((h + ll - 7 * m + 114) % 31) + 1
    return dt.date(anio, mes, dia)


def festivos_del_anio(anio, ambitos=AMBITOS):
    """Festivos {fecha_iso: (nombre, ambito)} CALCULADOS para el anio.

    - nacional: fijos + Jueves/Viernes Santo (derivados de la Pascua).
    - andalucia: Dia de Andalucia (28-feb).
    - local: Granada = Toma de Granada (2-ene) + Corpus (Pascua+60), mas los
      festivos locales extra de config (`festivos_locales_extra`, lista de
      'MM-DD' para quien este en otro municipio).
    """
    pascua = _pascua(anio)
    festivos = {}

    def _add(fecha, nombre, ambito):
        # Los festivos que caen en DOMINGO se trasladan al lunes (practica
        # habitual del BOE/Junta; el dialogo de importar pide revisarlos
        # porque la decision final es anual). Los de sabado no se trasladan.
        if fecha.weekday() == 6:
            fecha += dt.timedelta(days=1)
            nombre += " (traslado)"
        festivos[fecha.isoformat()] = (nombre, ambito)

    if "nacional" in ambitos:
        for mes, dia, nombre in [
            (1, 1, "Año Nuevo"), (1, 6, "Reyes"), (5, 1, "Día del Trabajo"),
            (8, 15, "Asunción"), (10, 12, "Fiesta Nacional"),
            (11, 1, "Todos los Santos"), (12, 6, "La Constitución"),
            (12, 8, "La Inmaculada"), (12, 25, "Navidad"),
        ]:
            _add(dt.date(anio, mes, dia), nombre, "nacional")
        _add(pascua - dt.timedelta(days=3), "Jueves Santo", "nacional")
        _add(pascua - dt.timedelta(days=2), "Viernes Santo", "nacional")

    if "andalucia" in ambitos:
        _add(dt.date(anio, 2, 28), "Día de Andalucía", "andalucia")

    if "local" in ambitos:
        _add(dt.date(anio, 1, 2), "Toma de Granada", "local")
        _add(pascua + dt.timedelta(days=60), "Corpus Christi", "local")
        for md in config_valor("festivos_locales_extra", []) or []:
            try:
                mes, dia = (int(x) for x in str(md).split("-"))
                _add(dt.date(anio, mes, dia), "Festivo local", "local")
            except (ValueError, TypeError):
                pass

    return festivos


def dias_ugr():
    """Dias propios de la UGR (cierres de Navidad/Semana Santa, San Pascual
    Bailon patron del PTGAS, Feria del Corpus): {"AAAA-MM-DD": "nombre"} en la
    clave de config `dias_ugr`. Se fijan cada año en el calendario laboral del
    PTGAS y se trasladan, asi que no se calculan ni se hardcodean."""
    return dict(config_valor("dias_ugr", {}) or {})


def festivos_pendientes(ambitos=AMBITOS, incluir_ugr=True):
    """Festivos de los ambitos pedidos que caen en dia laborable y aun no
    estan marcados. Devuelve {fecha_iso: nombre}. A partir de noviembre se
    incluye tambien el año siguiente (deja enero preparado sin ofrecer 18
    meses de golpe el resto del año)."""
    hoy = _hoy()
    anios = (hoy.year, hoy.year + 1) if hoy.month >= 11 else (hoy.year,)
    catalogo = {}
    for anio in anios:
        for fecha, (nombre, _amb) in festivos_del_anio(anio, ambitos).items():
            catalogo[fecha] = nombre
    if incluir_ugr:
        catalogo.update(dias_ugr())
    out = {}
    for fecha, nombre in catalogo.items():
        if fecha in NO_LABORABLES:
            continue
        if dt.date.fromisoformat(fecha).weekday() >= 5:
            continue
        out[fecha] = nombre
    return out


def importar_festivos(ambitos=AMBITOS, incluir_ugr=True):
    """Marca como no laborables (motivo = nombre del festivo) los pendientes."""
    pendientes = festivos_pendientes(ambitos, incluir_ugr)
    NO_LABORABLES.update(pendientes)
    if pendientes:
        guardar_config_valor("no_laborables", NO_LABORABLES)
    return len(pendientes)


def objetivo_de(dia):
    """Jornada objetivo del dia, contando los dias marcados como no laborables.
    Guardia y teletrabajo NO cambian el objetivo (se trabaja igual)."""
    if es_no_laborable(dia.isoformat()):
        return 0
    return jornada_de(dia)


# ----------------------- vacaciones (cupo anual) -----------------------

# Motivo canonico: lo escriben el menu contextual de la GUI y lo lee el cupo.
# Usar siempre esta constante para que ambos no se desincronicen.
MOTIVO_VACACIONES = "vacaciones"


def es_vacaciones(fecha_iso):
    """Un dia no laborable cuyo motivo son vacaciones (cuenta al cupo)."""
    return motivo_no_laborable(fecha_iso).strip().lower() == MOTIVO_VACACIONES


def cupo_vacaciones():
    return config_valor("cupo_vacaciones", 22)


def vacaciones_usadas(anio):
    """Dias laborables marcados como vacaciones en ese año."""
    n = 0
    for fecha in NO_LABORABLES:
        if not es_vacaciones(fecha):
            continue
        try:
            d = dt.date.fromisoformat(fecha)
        except ValueError:
            continue
        if d.year == anio and d.weekday() < 5:
            n += 1
    return n


# ----------------------- guardias (modalidad) -----------------------

def es_guardia(fecha_iso):
    return fecha_iso in GUARDIAS


def marcar_guardia(fecha_iso):
    GUARDIAS.add(fecha_iso)
    guardar_config_valor("guardias", sorted(GUARDIAS))


def quitar_guardia(fecha_iso):
    GUARDIAS.discard(fecha_iso)
    guardar_config_valor("guardias", sorted(GUARDIAS))


def comentario_guardia():
    return config_valor("comentario_guardia", "Servicio de Guardia")


# ----------------------- teletrabajo (modalidad, cupo semanal) -----------------------

def es_teletrabajo(fecha_iso):
    return fecha_iso in TELETRABAJO


def marcar_teletrabajo(fecha_iso):
    TELETRABAJO.add(fecha_iso)
    guardar_config_valor("teletrabajo", sorted(TELETRABAJO))


def quitar_teletrabajo(fecha_iso):
    TELETRABAJO.discard(fecha_iso)
    guardar_config_valor("teletrabajo", sorted(TELETRABAJO))


def teletrabajo_por_semana():
    try:
        return int(config_valor("teletrabajo_por_semana", 1))
    except (ValueError, TypeError):
        return 1


def teletrabajo_en_semana(lunes):
    """Cuenta los dias de teletrabajo marcados en la semana de ese lunes (L-V)."""
    dias = {(lunes + dt.timedelta(days=i)).isoformat() for i in range(5)}
    return len(TELETRABAJO & dias)


# ----------------------- franjas horarias (slots de INARI) -----------------------
# Funciones puras (sin red): validan los slots de tiempo que se registran en
# INARI. OpenProject no usa franjas; esto es solo para el destino INARI.

def parsear_hora(txt):
    """'9:30' o '09:30' -> minutos desde medianoche (int); None si no vale."""
    try:
        h, m = (int(x) for x in str(txt).strip().split(":"))
    except (ValueError, AttributeError):
        return None
    if 0 <= h < 24 and 0 <= m < 60:
        return h * 60 + m
    return None


def duracion_horas(inicio, fin):
    """Horas (float, 2 decimales) entre dos 'HH:MM' con fin > inicio; None si no."""
    a, b = parsear_hora(inicio), parsear_hora(fin)
    if a is None or b is None or b <= a:
        return None
    return round((b - a) / 60, 2)


def validar_franjas(franjas):
    """franjas: lista de (inicio, fin) en 'HH:MM'. Devuelve una lista de mensajes
    de error (vacia si todo correcto): formato, fin>inicio y ausencia de solapes."""
    problemas = []
    intervalos = []
    for i, (ini, fin) in enumerate(franjas, 1):
        a, b = parsear_hora(ini), parsear_hora(fin)
        if a is None or b is None:
            problemas.append(f"Franja {i}: hora no valida ({ini}-{fin}).")
        elif b <= a:
            problemas.append(f"Franja {i}: el fin ({fin}) no es posterior al inicio ({ini}).")
        else:
            intervalos.append((a, b, i))
    for (a1, b1, i1), (a2, b2, i2) in zip(sorted(intervalos), sorted(intervalos)[1:]):
        if a2 < b1:
            problemas.append(f"Las franjas {i1} y {i2} se solapan.")
    return problemas


def dias_pendientes_semana(referencia=None, incluir_futuros=False):
    """Dias laborables de la semana de 'referencia' que aun no llegan a su
    jornada. Devuelve lista de (dia, registrado, objetivo), o None si no hay
    conexion (para no molestar con un aviso cuando la culpa es la red)."""
    hoy = referencia or _hoy()
    lunes = hoy - dt.timedelta(days=hoy.weekday())
    pendientes = []
    for i in range(5):
        d = lunes + dt.timedelta(days=i)
        if not incluir_futuros and d > hoy:
            continue
        obj = objetivo_de(d)
        if not obj:
            continue
        try:
            reg = sum(a["horas"] for a in entradas_dia(d.isoformat()))
        except Exception:
            return None
        if reg < obj - 0.001:
            pendientes.append((d, reg, obj))
    return pendientes


def anadir_favorito(wp):
    """Anade una tarea a favoritas y lo persiste en config.json."""
    if any(str(f["id"]) == str(wp["id"]) for f in FAVORITOS):
        return
    FAVORITOS.append({"id": int(wp["id"]), "nombre": wp["nombre"]})
    guardar_config_valor("favoritos", FAVORITOS)


def guardar_plantilla(nombre, apuntes):
    PLANTILLAS[:] = [p for p in PLANTILLAS if p.get("nombre") != nombre]
    PLANTILLAS.append({"nombre": nombre, "apuntes": apuntes})
    guardar_config_valor("plantillas", PLANTILLAS)


def eliminar_plantilla(nombre):
    PLANTILLAS[:] = [p for p in PLANTILLAS if p.get("nombre") != nombre]
    guardar_config_valor("plantillas", PLANTILLAS)


# ----------------------- pantallas -----------------------

def gestionar_dia(dia):
    fecha = dia.isoformat()
    while True:
        try:
            apuntes = entradas_dia(fecha)
        except Exception as e:
            print(f"\n  No pude leer los apuntes del dia: {e}")
            input("  Enter para volver...")
            return
        registrado = sum(a["horas"] for a in apuntes)
        objetivo = jornada_de(dia)
        faltan = objetivo - registrado
        print("\n" + "=" * 58)
        print(f"  {DIAS_ES[dia.weekday()]} {dia.strftime('%d/%m/%Y')}"
              f"  ({'verano' if es_verano(dia) else 'normal'}: jornada {objetivo}h)")
        print("=" * 58)
        if apuntes:
            print("  Apuntes de este dia:")
            for i, a in enumerate(apuntes, 1):
                com = f'  "{a["comentario"]}"' if a["comentario"] else ""
                act = f" [{a['actividad']}]" if a["actividad"] else ""
                print(f"    {i}) {_fmt(a['horas']):>6}  {a['wp_titulo'][:36]}{act}{com}")
        else:
            print("  (Sin apuntes todavia)")
        print("  " + "-" * 54)
        print(f"  Registrado: {_fmt(registrado)}   |   ", end="")
        if faltan > 0.001:
            print(f"Faltan {_fmt(faltan)} para la jornada")
        elif faltan < -0.001:
            print(f"Te has pasado {_fmt(-faltan)}")
        else:
            print("Jornada completa")
        print("  " + "-" * 54)
        print("  a) Anadir apunte    e) Eliminar apunte    f) Terminar este dia")
        op = input("  > ").strip().lower()
        if op in ("f", "", "q"):
            return
        if op == "e":
            if not apuntes:
                continue
            sel = input("  Numero del apunte a eliminar: ").strip()
            if sel.isdigit() and 1 <= int(sel) <= len(apuntes):
                try:
                    eliminar_entrada(apuntes[int(sel) - 1]["id"])
                    print("  Eliminado.")
                except Exception as e:
                    print(f"  No se pudo eliminar: {e}")
            continue
        if op == "a":
            tarea = elegir_tarea()
            if not tarea:
                continue
            sug = f" (faltan {_fmt(faltan)})" if faltan > 0.001 else ""
            horas = preguntar_horas(f"  Horas para '{tarea['nombre'][:30]}'{sug}: ")
            comentario = input("  Comentario (opcional, Enter para nada): ").strip()
            actividad = elegir_actividad(tarea["id"])
            print(f"\n  Vas a registrar: {_fmt(horas)} en '{tarea['nombre'][:30]}' "
                  f"[{actividad}] el {dia.strftime('%d/%m')}")
            if input("  Confirmar? (s/n): ").strip().lower() in ("s", "si", "y"):
                try:
                    crear_entrada(fecha, tarea["id"], horas, comentario, actividad)
                    print("  Registrado correctamente.")
                except Exception as e:
                    print(f"  ERROR al registrar: {e}")
            else:
                print("  Cancelado.")
            continue
        print("  Opcion no valida.")



def preguntar_fecha(pregunta, defecto):
    while True:
        r = input(f"{pregunta} [{defecto}]: ").strip()
        if not r:
            r = defecto
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
            try:
                return dt.datetime.strptime(r, fmt).date()
            except ValueError:
                continue
        print("  Formato no valido. Usa AAAA-MM-DD o DD/MM/AAAA.")


def listar_exportar():
    hoy = _hoy()
    ini_mes = hoy.replace(day=1)
    desde = preguntar_fecha("  Desde", ini_mes.isoformat())
    hasta = preguntar_fecha("  Hasta", hoy.isoformat())
    if hasta < desde:
        desde, hasta = hasta, desde
    print(f"\n  Consultando del {desde.strftime('%d/%m/%Y')} al {hasta.strftime('%d/%m/%Y')}...")
    filas = []
    d = desde
    while d <= hasta:
        try:
            for a in entradas_dia(d.isoformat()):
                filas.append([d.isoformat(), _fmt(a["horas"]).rstrip("h"),
                              a["wp_titulo"], a["actividad"], a["comentario"]])
        except Exception as e:
            print(f"  (Error el {d}: {e})")
        d += dt.timedelta(days=1)
    if not filas:
        print("  No hay apuntes en ese rango.\n")
        input("  Enter para volver...")
        return
    print("\n  " + "-" * 70)
    print(f"  {'Fecha':<12}{'Horas':>6}  {'Tarea':<32} {'Actividad'}")
    print("  " + "-" * 70)
    total = 0.0
    for f in filas:
        total += float(f[1].replace(",", "."))
        print(f"  {f[0]:<12}{f[1]:>6}  {f[2][:32]:<32} {f[3]}")
    print("  " + "-" * 70)
    print(f"  {len(filas)} apuntes   TOTAL: {total:g}h\n")
    nombre = f"horas_{desde.isoformat()}_a_{hasta.isoformat()}.csv"
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), nombre)
    try:
        with open(ruta, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh, delimiter=";")
            w.writerow(["Fecha", "Horas", "Tarea", "Actividad", "Comentario"])
            w.writerows(filas)
            w.writerow([])
            w.writerow(["", total, "TOTAL"])
        print(f"  Exportado a: {ruta}")
        print("  (Se abre con Excel; separador punto y coma.)\n")
    except Exception as e:
        print(f"  No se pudo escribir el CSV: {e}\n")
    input("  Enter para volver...")


def gestionar_varios_dias(dias):
    obj = jornada_de(dias[0])
    etiquetas = ", ".join(d.strftime("%a %d/%m") for d in dias)
    print("\n" + "=" * 58)
    print(f"  Aplicar los MISMOS apuntes a {len(dias)} dias:")
    print(f"  {etiquetas}   (jornada {obj}h/dia)")
    print("=" * 58)
    apuntes = []
    while True:
        total = sum(a["horas"] for a in apuntes)
        faltan = obj - total
        if apuntes:
            print("\n  Apuntes que se aplicaran a cada dia:")
            for i, a in enumerate(apuntes, 1):
                com = f'  "{a["comentario"]}"' if a["comentario"] else ""
                print(f"    {i}) {_fmt(a['horas']):>6}  {a['nombre'][:32]} [{a['actividad']}]{com}")
            print(f"  Total por dia: {_fmt(total)}  ", end="")
            if faltan > 0.001:
                print(f"(faltan {_fmt(faltan)})")
            elif faltan < -0.001:
                print(f"(te pasas {_fmt(-faltan)})")
            else:
                print("(jornada completa)")
        else:
            print("\n  (Aun no has anadido apuntes)")
        print("  " + "-" * 54)
        print("  a) Anadir apunte   q) Quitar apunte   g) GUARDAR en todos   c) Cancelar")
        op = input("  > ").strip().lower()
        if op in ("c", ""):
            print("  Cancelado.")
            return
        if op == "q" and apuntes:
            sel = input("  Numero a quitar: ").strip()
            if sel.isdigit() and 1 <= int(sel) <= len(apuntes):
                apuntes.pop(int(sel) - 1)
            continue
        if op == "a":
            tarea = elegir_tarea()
            if not tarea:
                continue
            sug = f" (faltan {_fmt(faltan)})" if faltan > 0.001 else ""
            horas = preguntar_horas(f"  Horas/dia para '{tarea['nombre'][:26]}'{sug}: ")
            comentario = input("  Comentario (opcional, Enter para nada): ").strip()
            actividad = elegir_actividad(tarea["id"])
            apuntes.append({"id": tarea["id"], "nombre": tarea["nombre"],
                            "horas": horas, "comentario": comentario, "actividad": actividad})
            continue
        if op == "g":
            if not apuntes:
                print("  No hay apuntes que guardar.")
                continue
            print(f"\n  Se crearan {len(apuntes)} apunte(s) en cada uno de los {len(dias)} dias.")
            if input("  Confirmar? (s/n): ").strip().lower() not in ("s", "si", "y"):
                print("  Cancelado.")
                continue
            creados = saltados = 0
            for d in dias:
                fecha = d.isoformat()
                try:
                    existentes = entradas_dia(fecha)
                except Exception:
                    existentes = []
                for a in apuntes:
                    if any(str(e.get("wp_id")) == str(a["id"]) for e in existentes):
                        print(f"    [=] {d.strftime('%a %d/%m')} {a['nombre'][:18]}: ya tenia, salto.")
                        saltados += 1
                        continue
                    try:
                        crear_entrada(fecha, a["id"], a["horas"], a["comentario"], a["actividad"])
                        print(f"    [OK] {d.strftime('%a %d/%m')} {a['nombre'][:18]}: {_fmt(a['horas'])}")
                        creados += 1
                    except Exception as e:
                        print(f"    [ERROR] {d.strftime('%a %d/%m')} {a['nombre'][:18]}: {e}")
            print(f"\n  Hecho: {creados} creados, {saltados} saltados.\n")
            input("  Enter para volver...")
            return
        print("  Opcion no valida.")


def menu_semana():
    lunes = _lunes()
    while True:
        domingo = lunes + dt.timedelta(days=6)
        print("\n" + "#" * 58)
        print(f"  Semana del {lunes.strftime('%d/%m/%Y')} al {domingo.strftime('%d/%m/%Y')}")
        print("#" * 58)
        dias = []
        for i in range(5):
            d = lunes + dt.timedelta(days=i)
            dias.append(d)
            try:
                reg = sum(a["horas"] for a in entradas_dia(d.isoformat()))
                obj = jornada_de(d)
                if reg >= obj - 0.001 and reg > 0:
                    estado = f"[OK] {_fmt(reg)}/{obj}h"
                elif reg > 0:
                    estado = f"[..] {_fmt(reg)}/{obj}h"
                else:
                    estado = f"[  ] 0/{obj}h"
            except Exception:
                estado = "[?]"
            hoy = "  <- hoy" if d == _hoy() else ""
            print(f"  {i+1}) {DIAS_ES[i]:<10} {d.strftime('%d/%m')}   {estado}{hoy}")
        print("-" * 58)
        print("  1-5) un dia (o varios: 1,3,5)   t) toda la semana   x) exportar")
        print("  < semana ant.   > semana sig.   q) salir")
        op = input("  > ").strip().lower()
        if op in ("q", "salir", ""):
            print("Hasta luego.\n")
            return
        if op == "<":
            lunes -= dt.timedelta(days=7)
            continue
        if op == ">":
            lunes += dt.timedelta(days=7)
            continue
        if op == "x":
            listar_exportar()
            continue
        if op in ("t", "todos"):
            seleccion = list(dias)
        else:
            try:
                idx = [int(x) for x in op.replace(" ", ",").split(",") if x]
                if not idx or any(i < 1 or i > 5 for i in idx):
                    raise ValueError
                seleccion = [dias[i - 1] for i in sorted(set(idx))]
            except ValueError:
                print("  Opcion no valida.")
                continue
        if len(seleccion) == 1:
            gestionar_dia(seleccion[0])
        else:
            gestionar_varios_dias(seleccion)


def _check():
    if not BASE_URL or "tuempresa" in BASE_URL or not API_KEY:
        sys.exit("Configuración incompleta. " + _msg_configurar())


if __name__ == "__main__":
    _check()
    try:
        menu_semana()
    except KeyboardInterrupt:
        print("\nSaliendo.\n")
