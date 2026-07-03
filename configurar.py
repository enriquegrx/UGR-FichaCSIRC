#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
configurar.py - Configuracion del registro de horas en OpenProject.

Guarda solo lo estable: conexion, jornada (7h normal / 5h verano + fechas),
actividad por defecto y una lista de tareas favoritas para tenerlas a mano.
El reparto de horas por tarea se hace al REGISTRAR, no aqui.

Genera tambien el lanzador '2-Registrar-horas.bat' con la ruta de tu Python.
"""

import os
import json
import sys
import base64

try:
    import requests
except ImportError:
    requests = None

def _config_path():
    ruta = os.environ.get("FICHACSIRC_CONFIG")
    if ruta:
        return ruta
    if getattr(sys, "frozen", False):
        base = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "FichaCSIRC")
        os.makedirs(base, exist_ok=True)
        return os.path.join(base, "config.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


CONFIG_PATH = _config_path()

WP_CONOCIDOS = [
    ("11765", "[2026_ASG] Mantenimientos"),
    ("12063", "[ASG] Cabinas almacenamiento SisGes"),
    ("12064", "[ASG] Sistema de copias de seguridad (Backup) SisGes"),
    ("12065", "[ASG] Proxmox + dockers en SisGes"),
]

ACTIVIDADES = [
    "actuacion tecnica", "correctivo", "formacion",
    "gestion/planificacion", "soporte",
]

MESES = {1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio",
         7: "julio", 8: "agosto", 9: "septiembre", 10: "octubre", 11: "noviembre", 12: "diciembre"}


def preguntar_texto(pregunta, defecto=None, obligatorio=True):
    sufijo = f" [{defecto}]" if defecto not in (None, "") else ""
    while True:
        resp = input(f"{pregunta}{sufijo}: ").strip()
        if not resp and defecto is not None:
            return defecto
        if resp:
            return resp
        if not obligatorio:
            return ""
        print("  Este dato es obligatorio.")


def preguntar_entero(pregunta, defecto=None, minimo=None, maximo=None):
    while True:
        resp = preguntar_texto(pregunta, str(defecto) if defecto is not None else None)
        try:
            valor = int(resp)
        except ValueError:
            print("  Escribe un numero entero.")
            continue
        if minimo is not None and valor < minimo:
            print(f"  Debe ser {minimo} o mas.")
            continue
        if maximo is not None and valor > maximo:
            print(f"  Debe ser {maximo} o menos.")
            continue
        return valor


def preguntar_si_no(pregunta, defecto=True):
    sufijo = " [S/n]" if defecto else " [s/N]"
    while True:
        resp = input(f"{pregunta}{sufijo}: ").strip().lower()
        if not resp:
            return defecto
        if resp in ("s", "si", "y", "yes"):
            return True
        if resp in ("n", "no"):
            return False
        print("  Responde 's' o 'n'.")


def preguntar_opcion(pregunta, opciones, defecto_idx=0):
    print(pregunta)
    for i, (val, desc) in enumerate(opciones, start=1):
        print(f"   {i}) {val:<22} {desc}")
    print("   0) Otro (escribir a mano)")
    while True:
        resp = input(f"  Elige [{defecto_idx + 1}]: ").strip()
        if not resp:
            return opciones[defecto_idx][0]
        try:
            n = int(resp)
        except ValueError:
            print("  Escribe el numero de la opcion.")
            continue
        if n == 0:
            return preguntar_texto("  Escribe el valor")
        if 1 <= n <= len(opciones):
            return opciones[n - 1][0]
        print("  Opcion fuera de rango.")


def preguntar_fecha_dm(pregunta, defecto):
    dm_def = f"{defecto[1]:02d}/{defecto[0]:02d}"
    while True:
        resp = preguntar_texto(pregunta, dm_def)
        try:
            partes = resp.replace("-", "/").split("/")
            dia, mes = int(partes[0]), int(partes[1])
            if 1 <= mes <= 12 and 1 <= dia <= 31:
                return (mes, dia)
        except (ValueError, IndexError):
            pass
        print("  Escribe la fecha como DD/MM (ej. 16/06).")


def _api_get(base_url, api_key, path, params=None):
    token = base64.b64encode(f"apikey:{api_key}".encode()).decode()
    headers = {"Authorization": f"Basic {token}"}
    r = requests.get(f"{base_url}{path}", headers=headers, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def _api_get_todos(base_url, api_key, path, params=None):
    """Todos los elementos de un listado, siguiendo la paginacion por offset."""
    params = dict(params or {})
    params.setdefault("pageSize", 200)
    out = []
    offset = 1
    while True:
        params["offset"] = offset
        data = _api_get(base_url, api_key, path, params)
        elems = data.get("_embedded", {}).get("elements", [])
        out.extend(elems)
        total = data.get("total", len(out))
        if not elems or len(out) >= total:
            return out
        offset += 1


def _multiseleccion(titulo, tabla):
    print(f"\n  {titulo}")
    print("  " + "-" * 56)
    for i, (idv, texto) in enumerate(tabla, start=1):
        print(f"   {i:>2}) {idv:>7}  {texto}")
    print("    t) TODOS")
    print("    0) Escribir IDs a mano")
    while True:
        resp = input("  Elige (numeros con comas, ej. 1,3,4  o  't'): ").strip().lower()
        if resp in ("t", "todos"):
            return [{"id": int(i), "nombre": t} for i, t in tabla]
        if resp == "0":
            crudo = input("  IDs separados por comas: ").strip()
            out = []
            for x in crudo.replace(" ", "").split(","):
                if x.isdigit():
                    out.append({"id": int(x), "nombre": "(ID a mano)"})
            if out:
                return out
            print("  No has escrito ningun ID valido.")
            continue
        try:
            idxs = [int(x) for x in resp.replace(" ", "").split(",") if x]
            if idxs and all(1 <= n <= len(tabla) for n in idxs):
                return [{"id": int(tabla[n - 1][0]), "nombre": tabla[n - 1][1]} for n in idxs]
        except ValueError:
            pass
        print("  Seleccion no valida.")


def seleccionar_favoritos_en_vivo(base_url, api_key):
    if requests is None:
        return None
    try:
        proyectos = _api_get_todos(base_url, api_key, "/api/v3/projects")
    except Exception as e:
        print(f"  No pude conectar con OpenProject ({e}).")
        return None
    if not proyectos:
        print("  No apareces asignado a ningun proyecto.")
        return None
    tabla_p = [(str(p["id"]), p["name"]) for p in proyectos]
    print("\n  Tus proyectos:")
    print("  " + "-" * 56)
    for i, (idv, texto) in enumerate(tabla_p, start=1):
        print(f"   {i:>2}) {idv:>7}  {texto}")
    while True:
        resp = input("  Elige un proyecto (numero): ").strip()
        try:
            n = int(resp)
            if 1 <= n <= len(tabla_p):
                pid = tabla_p[n - 1][0]
                break
        except ValueError:
            pass
        print("  Numero no valido.")
    try:
        tareas = _api_get_todos(base_url, api_key,
                                f"/api/v3/projects/{pid}/work_packages")
    except Exception as e:
        print(f"  No pude leer las tareas ({e}).")
        return None
    if not tareas:
        print("  Ese proyecto no tiene tareas visibles.")
        return None
    tabla_w = [(str(w["id"]), w["subject"]) for w in tareas]
    return _multiseleccion("Tareas favoritas (para tenerlas a mano al registrar):", tabla_w)


def cargar_previa():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, encoding="utf-8-sig") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def recoger_datos(previa):
    print("\n" + "=" * 60)
    print("  ASISTENTE DE CONFIGURACION - Registro de horas OpenProject")
    print("=" * 60)
    if previa:
        print("  (Pulsa Enter para mantener el valor anterior en cada pregunta.)")
    print()

    cfg = {}
    print("-- Conexion --------------------------------------------")
    cfg["base_url"] = preguntar_texto(
        "URL de tu OpenProject (sin barra final)",
        previa.get("base_url") or "https://openproject.tuempresa.com").rstrip("/")
    print("  API key: avatar (arriba dcha) > Mi cuenta > Tokens de acceso > API")
    cfg["api_key"] = preguntar_texto("Tu API key", previa.get("api_key"))

    print("\n-- Jornada (siempre de lunes a viernes) ----------------")
    cfg["jornada_invierno"] = preguntar_entero(
        "Horas por dia en jornada normal (ej. 7)",
        previa.get("jornada_invierno", 7), minimo=1, maximo=24)
    tiene_verano = preguntar_si_no(
        "Tienes horario de verano distinto (menos horas)?",
        defecto=bool(previa.get("tiene_verano", True)))
    cfg["tiene_verano"] = tiene_verano
    if tiene_verano:
        cfg["jornada_verano"] = preguntar_entero(
            "Horas por dia en verano (ej. 5)",
            previa.get("jornada_verano", 5), minimo=1, maximo=24)
        ini_def = tuple(previa.get("verano_inicio", [6, 16]))
        fin_def = tuple(previa.get("verano_fin", [9, 15]))
        cfg["verano_inicio"] = list(preguntar_fecha_dm("Inicio del verano (DD/MM)", ini_def))
        cfg["verano_fin"] = list(preguntar_fecha_dm("Fin del verano (DD/MM)", fin_def))
    else:
        cfg["jornada_verano"] = cfg["jornada_invierno"]
        cfg["verano_inicio"] = [6, 16]
        cfg["verano_fin"] = [9, 15]

    print("\n-- Actividad por defecto -------------------------------")
    prev_act = previa.get("actividad_defecto") or previa.get("actividad")
    cfg["actividad_defecto"] = preguntar_opcion(
        "Actividad que usaras normalmente (podras cambiarla al registrar):",
        [(a, "") for a in ACTIVIDADES],
        defecto_idx=ACTIVIDADES.index(prev_act) if prev_act in ACTIVIDADES else 4)

    print("\n-- Tareas favoritas ------------------------------------")
    print("  Lista de tareas para elegir rapido al registrar (opcional).")
    favoritos = None
    if requests is not None and preguntar_si_no(
            "Buscar tus proyectos y tareas en OpenProject?", defecto=True):
        favoritos = seleccionar_favoritos_en_vivo(cfg["base_url"], cfg["api_key"])
    if not favoritos:
        if preguntar_si_no("Usar la lista de tareas conocidas como favoritas?", defecto=True):
            favoritos = _multiseleccion("Tareas conocidas:", WP_CONOCIDOS)
        else:
            favoritos = previa.get("favoritos", [])
    cfg["favoritos"] = favoritos or []

    return cfg


def _fecha_str(dm):
    return f"{dm[1]} de {MESES[dm[0]]}"


def mostrar_resumen(cfg):
    api = cfg["api_key"] or ""
    api_masked = ("*" * max(0, len(api) - 4) + api[-4:]) if api else "(vacia)"
    print("\n" + "=" * 60)
    print("  RESUMEN DE LA CONFIGURACION")
    print("=" * 60)
    print(f"  OpenProject .......... {cfg['base_url']}")
    print(f"  API key .............. {api_masked}")
    print(f"  Actividad defecto .... {cfg['actividad_defecto']}")
    print(f"  Jornada normal ....... {cfg['jornada_invierno']} h/dia")
    if cfg["tiene_verano"]:
        print(f"  Jornada verano ....... {cfg['jornada_verano']} h/dia "
              f"(del {_fecha_str(cfg['verano_inicio'])} al {_fecha_str(cfg['verano_fin'])})")
    else:
        print(f"  Jornada verano ....... (sin horario de verano)")
    print(f"  Tareas favoritas ..... {len(cfg['favoritos'])}")
    for wp in cfg["favoritos"]:
        print(f"      - {wp['id']}  {wp['nombre'][:44]}")
    print("=" * 60)


def escribir_lanzador():
    carpeta = os.path.dirname(os.path.abspath(__file__))
    ruta_bat = os.path.join(carpeta, "2-Registrar-horas.bat")
    py = sys.executable
    lineas = [
        "@echo off",
        'cd /d "%~dp0"',
        "title Registrar horas OpenProject",
        "",
        'if not exist "config.json" echo Falta config.json. Ejecuta 1-Configurar.bat',
        'if not exist "config.json" pause',
        'if not exist "config.json" exit /b',
        "",
        f'"{py}" "rellenar_horas.py"',
        "echo.",
        "pause",
    ]
    try:
        with open(ruta_bat, "w", encoding="utf-8", newline="\r\n") as f:
            f.write("\n".join(lineas) + "\n")
        return ruta_bat
    except Exception as e:
        print(f"  (No se pudo crear el lanzador: {e})")
        return None


def guardar(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print(f"\nGuardado en: {CONFIG_PATH}")
    if escribir_lanzador():
        print("Lanzador creado: 2-Registrar-horas.bat (con tu ruta de Python).")
    print("   Registra horas con doble clic en 2-Registrar-horas.bat\n")


def main():
    previa = cargar_previa()
    while True:
        cfg = recoger_datos(previa)
        mostrar_resumen(cfg)
        print()
        if preguntar_si_no("Guardar esta configuracion?", defecto=True):
            guardar(cfg)
            return
        if not preguntar_si_no("Quieres volver a introducir los datos?", defecto=True):
            print("No se ha guardado nada.\n")
            return
        previa = cfg


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelado.\n")
        sys.exit(1)
