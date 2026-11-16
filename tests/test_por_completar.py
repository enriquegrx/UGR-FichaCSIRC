#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Por completar: los dias del año sin imputar del todo (hasta ayer) y
completarlos en bloque con una tarea (a cada dia, lo que le falta), en una
sola accion de Deshacer."""

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


def ap(fecha, wp, horas, actividad="Actuaciones técnicas"):
    return {"id": 1, "fecha": fecha, "wp_id": wp, "wp_titulo": f"T{wp}", "horas": horas,
            "actividad": actividad, "comentario": ""}


class TestPorCompletar(unittest.TestCase):
    def setUp(self):
        self.apuntes = [ap("2026-11-02", "10", 7), ap("2026-11-03", "10", 4),   # el 3: faltan 3
                        ap("2026-11-05", "10", 7), ap("2026-11-06", "10", 6.5),  # el 4 vacio; el 6: 0,5
                        ap("2026-11-09", "10", 7), ap("2026-11-10", "10", 7), ap("2026-11-11", "10", 7)]
        self.creados = []
        rango = lambda desde, hasta: [a for a in self.apuntes if desde <= a["fecha"] <= hasta]

        def crear(iso, wp, horas, com, act):
            self.creados.append((iso, wp, horas, com, act))
            return f"n{len(self.creados)}"
        festivos = {"2026-10-12"}
        for p in (mock.patch.object(core, "entradas_rango", side_effect=rango),
                  mock.patch.object(core, "crear_entrada", side_effect=crear),
                  mock.patch.object(core, "guardar_config_valores", lambda c: None),
                  mock.patch.object(web, "objetivo_dia",
                                    lambda d, ap, acts=None: 0.0 if d.isoformat() in festivos else 7.0),
                  mock.patch.object(web, "actividades_de_permiso", return_value=set()),
                  mock.patch.object(web.destinos, "configurado", return_value=False),
                  mock.patch.object(core, "es_no_laborable", lambda iso: iso in festivos),
                  mock.patch.object(core, "es_teletrabajo", lambda iso: False),
                  mock.patch.object(core, "es_guardia", lambda iso: iso == "2026-11-04"),
                  mock.patch.object(core, "comentario_guardia", lambda: "Servicio de Guardia")):
            p.start()
            self.addCleanup(p.stop)
        self.api = web.Api()

    def test_lista_hasta_ayer(self):
        r = self.api.por_completar(2026, hoy=HOY)
        nov = [x for x in r["dias"] if x["mes"] == 11]
        # hoy (12) no cuenta: aun se esta fichando
        self.assertEqual([x["iso"] for x in nov], ["2026-11-03", "2026-11-04", "2026-11-06"])
        self.assertEqual(nov[0]["falta_txt"], "3h")
        self.assertTrue(nov[1]["vacio"] and nov[1]["guardia"])
        self.assertEqual(nov[2]["texto"], "6,5h de 7h")
        self.assertEqual(r["modelo"], "2026-11-11")             # el ultimo completo
        self.assertNotIn("2026-10-12", [x["iso"] for x in r["dias"]])   # festivo
        self.assertEqual((r["anterior"], r["siguiente"]), (True, False))
        # una ficha por mes
        m = r["meses"]
        self.assertEqual(len(m), 12)
        self.assertEqual((m[10]["estado"], m[10]["n"], m[10]["falta"]), ("pendiente", 3, "10,5h"))
        self.assertEqual(m[11]["estado"], "futuro")
        self.assertEqual(m[10]["nombre"], "Noviembre")
        # noviembre hasta ayer: 8 laborables x 7 = 56; cubiertas 45,5
        self.assertEqual(m[10]["frac"], round(45.5 / 56, 3))
        # deja los dias en la cache (copiar y plantillas saben lo que ya tienen)
        self.assertEqual(len(self.api._cache["2026-11-03"]), 1)

    def test_anio_futuro_y_lejano(self):
        self.assertEqual(self.api.por_completar(2030, hoy=HOY)["anio"], 2026)
        r = self.api.por_completar(2001, hoy=HOY)
        self.assertEqual(r["anio"], 2026 - web.Api.ANIOS_ATRAS_PENDIENTES)
        self.assertFalse(r["anterior"])

    def test_completar_lo_que_falta(self):
        r = self.api.completar_dias(["2026-11-06", "2026-11-03", "2026-11-04", "2026-11-02"],
                                    "20", "Soporte", "")
        self.assertEqual((r["creados"], r["saltados"], r["errores"]), (3, 1, 0))   # el 2 ya estaba
        self.assertEqual(r["horas"], "10,5h")
        self.assertEqual([(c[0], c[2]) for c in self.creados],
                         [("2026-11-03", 3.0), ("2026-11-04", 7.0), ("2026-11-06", 0.5)])
        self.assertEqual(self.creados[1][3], "Servicio de Guardia")               # dia de guardia
        # una sola accion de Deshacer para todo el bloque
        self.assertEqual(r["quedan"], 1)
        self.assertEqual(self.api.deshacer_estado()["siguiente"], "completar 3 días (10,5h)")

    def test_completar_salta_festivo_y_avisa_errores(self):
        def falla(iso, *a):
            raise RuntimeError("mes cerrado")
        with mock.patch.object(core, "crear_entrada", side_effect=falla):
            r = self.api.completar_dias(["2026-10-12", "2026-11-03"], "20")
        self.assertEqual((r["creados"], r["saltados"], r["errores"]), (0, 1, 1))
        self.assertEqual(r["fallidos"], ["martes 03/11"])
        self.assertFalse(r["puede_deshacer"])

    def test_sin_tarea(self):
        self.assertIn("error", self.api.completar_dias(["2026-11-03"], ""))
        self.assertIn("error", self.api.completar_dias([], "20"))


if __name__ == "__main__":
    unittest.main()
