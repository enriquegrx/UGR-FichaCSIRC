#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Copias de seguridad de la configuracion (copias.py) y su uso desde la Api:
cuando se copia, cuanto se guarda, que nunca vuelve al restaurar (credenciales
y PIN) y que no sale al exportar."""

import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import test_fichacsirc  # noqa: F401  (fija FICHACSIRC_CONFIG e importa core)
import copias                      # noqa: E402
import registrar_web as web        # noqa: E402

BASE = {"base_url": "https://op.test", "api_key": "SECRETA", "inari_token": "TOK",
        "pin": {"hash": "h", "sal": "s"}, "favoritos": [{"id": 1, "nombre": "A"}],
        "plantillas": [{"nombre": "Día tipo", "apuntes": []}], "ventana": "1200x800"}


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fichacsirc_copias_")
        self.ruta = os.path.join(self.dir, "config.json")
        self.addCleanup(shutil.rmtree, self.dir, True)

    def nombres(self):
        return sorted(n for n in os.listdir(copias.carpeta(self.ruta)) if n.startswith("config-"))


class TestCuandoSeCopia(Base):
    def test_solo_si_cambia_algo_que_importa(self):
        t = dt.datetime(2026, 11, 11, 10, 0, 0)
        self.assertIsNotNone(copias.quizas_copiar(self.ruta, BASE, t))
        # tamaño de ventana, zoom, chequeos...: no merecen copia
        otra = {**BASE, "ventana": "800x600", "zoom": 1.25}
        self.assertIsNone(copias.quizas_copiar(self.ruta, otra, t + dt.timedelta(seconds=5)))
        # una favorita nueva, si
        mas = {**BASE, "favoritos": BASE["favoritos"] + [{"id": 2, "nombre": "B"}]}
        self.assertIsNotNone(copias.quizas_copiar(self.ruta, mas, t + dt.timedelta(seconds=10)))
        self.assertEqual(len(self.nombres()), 2)

    def test_se_guardan_10_ultimas_y_una_por_dia_de_la_semana(self):
        ahora = dt.datetime(2026, 11, 11, 18, 0, 0)
        # 3 por dia durante 9 dias (27 copias distintas)
        for dias in range(8, -1, -1):
            for h in (9, 12, 15):
                t = ahora - dt.timedelta(days=dias) - dt.timedelta(hours=18 - h)
                copias.quizas_copiar(self.ruta, {**BASE, "n": f"{dias}-{h}"}, t)
        quedan = self.nombres()
        recientes = sorted(quedan, reverse=True)[:10]
        self.assertTrue(set(recientes) <= set(quedan))
        dias_con_copia = {n[7:15] for n in quedan}
        # de los ultimos 7 dias hay copia de cada uno; de hace 8, no
        for d in range(7):
            self.assertIn((ahora - dt.timedelta(days=d)).strftime("%Y%m%d"), dias_con_copia)
        self.assertNotIn((ahora - dt.timedelta(days=8)).strftime("%Y%m%d"), dias_con_copia)
        self.assertLessEqual(len(quedan), 10 + 7)

    def test_dos_copias_en_el_mismo_segundo_no_se_pisan(self):
        t = dt.datetime(2026, 11, 11, 10, 0, 0)
        copias.quizas_copiar(self.ruta, BASE, t)
        copias.quizas_copiar(self.ruta, {**BASE, "favoritos": []}, t)
        self.assertEqual(len(self.nombres()), 2)

    def test_listar_y_leer(self):
        copias.quizas_copiar(self.ruta, BASE, dt.datetime(2026, 11, 11, 10, 0, 0))
        lista = copias.listar(self.ruta)
        self.assertEqual(lista[0]["resumen"], "1 favorita · 1 plantilla")
        self.assertEqual(copias.leer(self.ruta, lista[0]["id"])["api_key"], "SECRETA")
        with self.assertRaises(ValueError):
            copias.leer(self.ruta, "../config.json")        # nada de rutas


class TestRestaurarYExportar(Base):
    def test_restaurar_conserva_credenciales_pin_y_equipo(self):
        actual = {"base_url": "https://nueva", "api_key": "NUEVA", "bandeja": True,
                  "ventana": "1x1", "favoritos": []}
        r = copias.combinar(actual, BASE)
        self.assertEqual((r["api_key"], r["base_url"], r["bandeja"], r["ventana"]),
                         ("NUEVA", "https://nueva", True, "1x1"))
        self.assertNotIn("pin", r)                          # el PIN viejo no vuelve
        self.assertNotIn("inari_token", r)
        self.assertEqual(r["favoritos"], BASE["favoritos"])

    def test_exportar_quita_credenciales_y_pin(self):
        e = copias.para_exportar(BASE, "3.2.0")
        for k in ("api_key", "inari_token", "pin", "ventana"):
            self.assertNotIn(k, e)
        self.assertEqual(e["_exportado"]["app"], "FichaCSIRC")
        self.assertTrue(copias.es_exportacion(e))
        self.assertFalse(copias.es_exportacion({"cualquier": "cosa"}))
        self.assertFalse(copias.es_exportacion([1, 2]))


class TestApi(Base):
    """De punta a punta: la Api con una config de verdad en un temporal."""

    def setUp(self):
        super().setUp()
        with open(self.ruta, "w", encoding="utf-8") as f:
            json.dump(BASE, f)
        for p in (mock.patch.object(web.ccore, "CONFIG_PATH", self.ruta),
                  mock.patch.object(web, "_cargar_motor", return_value=True)):
            p.start()
            self.addCleanup(p.stop)
        self.api = web.Api()
        self.api._desbloqueada = True        # la config tiene PIN: ya se ha escrito

    def test_restaurar_desde_la_api(self):
        copias.quizas_copiar(self.ruta, BASE, dt.datetime(2026, 11, 1, 9, 0, 0))
        vieja = copias.listar(self.ruta)[0]["id"]
        # despues: otra API key, otro PIN y sin favoritas
        ahora = {**BASE, "api_key": "OTRA", "pin": {"hash": "x", "sal": "y"}, "favoritos": []}
        web.ccore.escribir_config(ahora)
        r = self.api.restaurar_copia(vieja)
        self.assertEqual(r, {"ok": True})
        with open(self.ruta, encoding="utf-8") as f:
            cfg = json.load(f)
        self.assertEqual(cfg["favoritos"], BASE["favoritos"])
        self.assertEqual(cfg["api_key"], "OTRA")
        self.assertEqual(cfg["pin"], {"hash": "x", "sal": "y"})
        # el estado de antes de restaurar tambien quedo copiado (se puede volver)
        self.assertTrue(any(c["resumen"].startswith("1 plantilla") for c in copias.listar(self.ruta)))
        self.assertIn("error", self.api.restaurar_copia("config-19990101-000000.json"))

    def test_el_asistente_tambien_deja_copia(self):
        antes = len(copias.listar(self.ruta))
        web.ccore.escribir_config({**BASE, "favoritos": [{"id": 9, "nombre": "Z"}]})
        self.assertEqual(len(copias.listar(self.ruta)), antes + 1)


if __name__ == "__main__":
    unittest.main()
