#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""El panel de estadisticas (semana, mes, año): horas, jornada cumplida,
media, horas de mas, tareas y actividades mas hechas, el año mes a mes y
los detalles (racha, teletrabajo, guardias, incompletos, permisos)."""

import datetime as dt
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import test_fichacsirc  # noqa: F401  (fija FICHACSIRC_CONFIG e importa core)
import rellenar_horas as core      # noqa: E402
import registrar_web as web        # noqa: E402

HOY = dt.date(2026, 11, 12)        # jueves


def ap(fecha, wp, nombre, horas, actividad="Actuaciones técnicas"):
    return {"id": 1, "fecha": fecha, "wp_id": wp, "wp_titulo": nombre, "horas": horas,
            "actividad": actividad, "comentario": ""}


APUNTES = [
    ap("2026-11-02", "10", "Mantenimientos", 7),
    ap("2026-11-03", "10", "Mantenimientos", 5), ap("2026-11-03", "20", "Proxmox", 3, "Formación"),
    ap("2026-11-04", "20", "Proxmox", 7, "Formación"),
    ap("2026-11-05", "10", "Mantenimientos", 4),                     # incompleto: faltan 3
    ap("2026-11-06", "30", "Permisos", 7, "Asuntos propios"),
    ap("2026-11-09", "10", "Mantenimientos", 7),
    ap("2026-11-10", "10", "Mantenimientos", 7),
    ap("2026-11-11", "10", "Mantenimientos", 7),
    ap("2026-11-20", "10", "Mantenimientos", 2),                      # futuro: cuenta en tareas
]


def rango(desde, hasta):
    return [a for a in APUNTES if desde <= a["fecha"] <= hasta]


class TestEstadisticas(unittest.TestCase):
    def setUp(self):
        for p in (mock.patch.object(core, "entradas_rango", side_effect=rango),
                  mock.patch.object(web, "objetivo_dia", lambda d, ap, acts=None: 7.0),
                  mock.patch.object(web, "actividades_de_permiso", return_value={"asuntos propios"}),
                  mock.patch.object(web.destinos, "configurado", return_value=False),
                  mock.patch.object(core, "es_no_laborable", lambda iso: False),
                  mock.patch.object(core, "es_teletrabajo", lambda iso: iso == "2026-11-10"),
                  mock.patch.object(core, "es_guardia", lambda iso: iso in ("2026-11-03", "2026-11-04")),
                  mock.patch.object(core, "horas_permiso", lambda iso: 2.0 if iso == "2026-11-12" else 0.0)):
            p.start()
            self.addCleanup(p.stop)
        self.api = web.Api()

    def test_mes(self):
        r = self.api.estadisticas("mes", "2026-11-12", hoy=HOY)
        self.assertEqual(r["titulo"], "Noviembre 2026")
        self.assertEqual(r["total"], "56h")                     # todo el mes, tambien el 20
        # hasta hoy: 9 laborables x 7 = 63 de objetivo; 54 fichadas
        self.assertEqual(r["cumplida"], round(100 * 54 / 63))
        self.assertEqual(r["media"], "6h")                       # 54 / 9
        self.assertEqual(r["exceso"], "1h")                      # el 3: 8 de 7
        d = r["detalles"]
        self.assertEqual((d["incompletos"], d["faltan"]), (2, "10h"))   # el 5 (3) y hoy (7)
        self.assertEqual(d["racha"], 0)                          # hoy aun sin fichar
        self.assertEqual((d["teletrabajo"], d["guardias"]), (1, 2))
        self.assertEqual(d["permisos"], "9h")                    # 2 marcadas + 7 imputadas
        self.assertEqual([t["nombre"] for t in r["tareas"]], ["Mantenimientos", "Proxmox", "Permisos"])
        self.assertEqual(r["tareas"][0]["horas_txt"], "39h")
        self.assertEqual(sum(t["pct"] for t in r["tareas"]), 100)
        self.assertEqual(r["actividades"][0]["nombre"], "Actuaciones técnicas")
        self.assertEqual(r["meses"], [])

    def test_racha_hasta_ayer(self):
        r = self.api.estadisticas("mes", "2026-11-12", hoy=dt.date(2026, 11, 11))
        self.assertEqual(r["detalles"]["racha"], 4)              # 6, 9, 10 y 11 completos

    def test_semana(self):
        r = self.api.estadisticas("semana", "2026-11-04", hoy=HOY)
        self.assertEqual(r["titulo"], "Semana del 02/11 al 06/11/2026")
        self.assertEqual(r["total"], "33h")
        self.assertEqual(r["cumplida"], round(100 * 33 / 35))

    def test_anio_mes_a_mes(self):
        r = self.api.estadisticas("anio", "2026-11-12", hoy=HOY)
        self.assertEqual(r["titulo"], "2026")
        self.assertEqual(len(r["meses"]), 12)
        self.assertEqual(r["meses"][10]["estado"], "parcial")   # noviembre
        self.assertEqual(r["meses"][11]["estado"], "futuro")
        self.assertEqual(r["meses"][0]["estado"], "parcial")    # enero sin fichar nada

    def test_sin_red(self):
        with mock.patch.object(core, "entradas_rango", side_effect=core.requests.ConnectionError("x")), \
             mock.patch.object(web, "_hay_internet", return_value=True):
            self.assertIn("error", self.api.estadisticas("mes", "2026-11-12", hoy=HOY))


if __name__ == "__main__":
    unittest.main()
