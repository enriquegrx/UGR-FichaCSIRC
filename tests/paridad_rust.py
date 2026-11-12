#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Paridad Python <-> Rust de lo que pinta cada tarjeta de dia (estado_dia),
con TUS datos reales. No es un test automatico (necesita red y tu config):

    python tests/paridad_rust.py [carpeta_temporal]

1. Lee tus apuntes del mes actual y el anterior con el motor de Python.
2. Calcula estado_dia en Python.
3. Hace que Rust calcule lo mismo (cargo test paridad -- --ignored).
4. Compara campo a campo y dice las diferencias.

Los datos (tu config y tus apuntes) se quedan en la carpeta temporal: nunca
en el repositorio."""

import datetime as dt
import json
import os
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

import rellenar_horas as core      # noqa: E402
import registrar_web as web        # noqa: E402


def main():
    carpeta = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="paridad_")
    os.makedirs(carpeta, exist_ok=True)
    hoy = dt.date.today()
    desde = (hoy.replace(day=1) - dt.timedelta(days=1)).replace(day=1)
    apuntes = core.entradas_rango(desde.isoformat(), hoy.isoformat())
    por_dia = {}
    for a in apuntes:
        por_dia.setdefault(a["fecha"], []).append(a)
    dias, d = [], desde
    while d <= hoy:
        if d.weekday() < 5:
            dias.append(d)
        d += dt.timedelta(days=1)
    acts = web.actividades_de_permiso()
    with open(core.CONFIG_PATH, encoding="utf-8-sig") as f:
        cfg = json.load(f)
    entrada = {"config": cfg, "hoy": hoy.isoformat(),
               "dias": [{"iso": x.isoformat(), "apuntes": por_dia.get(x.isoformat(), [])} for x in dias]}
    # un dia "sin conexion" para probar ese camino tambien
    entrada["dias"].append({"iso": hoy.isoformat(), "apuntes": None})
    ruta = os.path.join(carpeta, "entrada.json")
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(entrada, f, ensure_ascii=False, default=str)
    python = [web.estado_dia(dt.date.fromisoformat(x["iso"]), x["apuntes"], hoy, acts) for x in entrada["dias"]]

    env = dict(os.environ, FICHACSIRC_PARIDAD=ruta)
    env["PATH"] = os.path.join(os.path.expanduser("~"), ".cargo", "bin") + os.pathsep + env.get("PATH", "")
    import shutil
    cargo = shutil.which("cargo", path=env["PATH"]) or "cargo"
    subprocess.run([cargo, "test", "--quiet", "paridad", "--", "--ignored"],
                   cwd=os.path.join(RAIZ, "tauri"), env=env, check=True, capture_output=True)
    with open(ruta + ".rust.json", encoding="utf-8") as f:
        rust = json.load(f)

    difs = 0
    for p, r in zip(python, rust):
        for k in sorted(set(p) | set(r)):
            vp, vr = p.get(k), r.get(k)
            if k == "apuntes":
                vp = [{**a, "horas": round(a["horas"], 4)} for a in vp]
                vr = [{**a, "horas": round(a["horas"], 4)} for a in vr]
            if isinstance(vp, (int, float)) and isinstance(vr, (int, float)):
                igual = abs(vp - vr) < 1e-6
            else:
                igual = vp == vr
            if not igual:
                difs += 1
                print(f"{p['iso']} {k}: python={vp!r} rust={vr!r}")
    print(f"{len(python)} días comparados, {difs} diferencias.")
    return 1 if difs else 0


if __name__ == "__main__":
    sys.exit(main())
