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
        base = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "FichaCSIRC")
        os.makedirs(base, exist_ok=True)
        return os.path.join(base, "config.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


CONFIG_PATH = _config_path()

VERSION = "2.0"
# Repo de GitHub "usuario/repositorio" para avisar de versiones nuevas.
# Vacio = comprobacion desactivada.
GITHUB_REPO = ""


def buscar_actualizacion():
    """Devuelve (version, url) si hay una release mas nueva en GitHub, o None."""
    if not GITHUB_REPO:
        return None
    try:
        r = requests.get(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
            timeout=10)
        if r.status_code != 200:
            return None
        data = r.json()
    except Exception:
        return None

    def _v(s):
        try:
            return tuple(int(x) for x in str(s).lstrip("v").split("."))
        except ValueError:
            return ()

    tag = str(data.get("tag_name", ""))
    if _v(tag) and _v(tag) > _v(VERSION):
        return tag.lstrip("v"), data.get("html_url", "")
    return None


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
        return "Ejecuta primero FichaCSIRC-Configurar.exe"
    return 'Ejecuta primero "FichaCSIRC - Configurar.bat"'


def _cargar_config():
    if not os.path.exists(CONFIG_PATH):
        sys.exit("No encuentro 'config.json'. " + _msg_configurar())
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
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


def config_valor(clave, defecto=None):
    return _cfg.get(clave, defecto)


def guardar_config_valor(clave, valor):
    """Actualiza una clave de config.json sin tocar el resto."""
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}
    cfg[clave] = valor
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    _cfg[clave] = valor

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


_ACT_CACHE = None


def _actividades_disponibles(wp_id):
    """Devuelve {nombre: href} de las actividades permitidas, via el formulario
    de time_entries (compatible con todas las versiones de OpenProject)."""
    global _ACT_CACHE
    if _ACT_CACHE is not None:
        return _ACT_CACHE
    body = {"_links": {"workPackage": {"href": f"/api/v3/work_packages/{wp_id}"}}}
    r = requests.post(f"{BASE_URL}/api/v3/time_entries/form",
                      headers=_auth(), json=body, timeout=30)
    r.raise_for_status()
    data = r.json()
    vals = (data.get("_embedded", {}).get("schema", {})
                .get("activity", {}).get("_embedded", {}).get("allowedValues", []))
    _ACT_CACHE = {}
    for v in vals:
        nombre = v.get("name") or v.get("_links", {}).get("self", {}).get("title", "")
        href = v.get("_links", {}).get("self", {}).get("href", "")
        if nombre and href:
            _ACT_CACHE[nombre] = href
    return _ACT_CACHE


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


def buscar_wp(texto):
    filtros = [{"subject": {"operator": "~", "values": [texto]}}]
    try:
        data = _get("/api/v3/work_packages",
                    params={"filters": json.dumps(filtros), "pageSize": 20})
    except Exception as e:
        print(f"  Error al buscar: {e}")
        return []
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
        res = buscar_wp(r)
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


def objetivo_de(dia):
    """Jornada objetivo del dia, contando los dias marcados como no laborables."""
    if es_no_laborable(dia.isoformat()):
        return 0
    return jornada_de(dia)


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
