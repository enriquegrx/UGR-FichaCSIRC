#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3.2.2: que config.json no se pueda perder entero, y que si se pierde se
recupere solo.

Lo que paso (nov 2026, 3.2.0): dos guardados a la vez dejaron el fichero roto
un instante, la lectura fallo, guardar_config_valores partio de {} y escribio
encima: config.json se quedo solo con los dias marcados (sin URL, API key,
favoritas, plantillas, PIN...). La app siguio con todo en memoria y al
reabrirla, todos los dias "sin conexion"."""

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
import rellenar_horas as core      # noqa: E402
import registrar_web as web        # noqa: E402
import configurar as ccore         # noqa: E402
import copias                      # noqa: E402

BUENA = {
    "base_url": "https://op.test", "api_key": "CLAVE", "inari_token": "TOK",
    "pin": {"hash": "h", "sal": "s", "iter": 1}, "pin_auto_min": 15,
    "favoritos": [{"id": 1, "nombre": "A"}], "plantillas": [{"nombre": "P"}],
    "no_laborables": {"2026-11-10": "festivo", "2026-11-12": "festivo"},
    "ultima_version_abierta": "3.2.0",
}


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fichacsirc_prot_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.ruta = os.path.join(self.dir, "config.json")
        for p in (mock.patch.object(core, "CONFIG_PATH", self.ruta),
                  mock.patch.object(ccore, "CONFIG_PATH", self.ruta),
                  mock.patch.dict(core._cfg, {}, clear=False)):
            p.start()
            self.addCleanup(p.stop)

    def poner(self, datos, texto=None):
        with open(self.ruta, "w", encoding="utf-8") as f:
            f.write(texto if texto is not None else json.dumps(datos))

    def leer(self):
        with open(self.ruta, encoding="utf-8") as f:
            return json.load(f)


class TestNoEscribirEncima(Base):
    def test_sin_fichero_se_parte_de_vacio(self):
        self.assertEqual(ccore.leer_para_cambiar(), {})

    def test_fichero_roto_no_se_lee_como_vacio(self):
        self.poner(None, texto='{"base_url": "https://op.te')      # cortado a mitad
        with self.assertRaises(ccore.ConfigIlegible) as e:
            ccore.leer_para_cambiar(espera=0)
        self.assertTrue(e.exception.danado)
        # el asistente (config completa) si puede sustituirlo
        self.assertEqual(ccore.leer_para_cambiar(danado_vale_vacio=True, espera=0), {})

    def test_guardar_un_valor_con_el_fichero_roto_no_lo_pisa(self):
        """El fallo de la 3.2.0: antes se escribia {"no_laborables": ...} encima."""
        roto = '{"base_url": "https://op.test", "api_key": "CLA'
        self.poner(None, texto=roto)
        with mock.patch.object(ccore.time, "sleep"):
            with self.assertRaises(ccore.ConfigIlegible):
                core.guardar_config_valor("no_laborables", {"2026-11-11": "festivo"})
        with open(self.ruta, encoding="utf-8") as f:
            self.assertEqual(f.read(), roto)                      # intacto

    def test_bloqueo_pasajero_se_reintenta(self):
        self.poner(BUENA)
        abrir = open
        fallos = {"n": 2}

        def abrir_a_veces(ruta, *a, **k):
            if ruta == self.ruta and fallos["n"]:
                fallos["n"] -= 1
                raise PermissionError(13, "en uso por otro proceso")
            return abrir(ruta, *a, **k)

        with mock.patch("builtins.open", abrir_a_veces), mock.patch.object(ccore.time, "sleep"):
            self.assertEqual(ccore.leer_para_cambiar()["api_key"], "CLAVE")

    def test_ninguna_escritura_quita_la_conexion(self):
        self.poner(BUENA)
        ccore.escribir_config({"no_laborables": {}})              # sin URL ni API key
        cfg = self.leer()
        self.assertEqual((cfg["base_url"], cfg["api_key"]), ("https://op.test", "CLAVE"))

    def test_guardar_valores_conserva_lo_demas(self):
        self.poner(BUENA)
        core.guardar_config_valor("no_laborables", {})
        cfg = self.leer()
        self.assertEqual(cfg["favoritos"], BUENA["favoritos"])
        self.assertEqual(cfg["no_laborables"], {})


class TestRecuperarAlArrancar(Base):
    def copia(self, datos, cuando):
        return copias.quizas_copiar(self.ruta, datos, cuando)

    def test_el_caso_real(self):
        """Config buena en copia; el fichero se queda solo con los dias marcados
        (sin el 12/11, que se desmarco despues): se recupera todo y se respeta
        lo de despues."""
        self.copia(BUENA, dt.datetime(2026, 11, 11, 12, 59, 43))
        rota = {"no_laborables": {"2026-11-10": "festivo"}, "ultima_version_abierta": "3.2.1"}
        self.copia(rota, dt.datetime(2026, 11, 11, 13, 0, 1))
        self.poner(rota)
        nombre = ccore.recuperar_si_hace_falta()
        self.assertEqual(nombre, "config-20261111-125943.json")
        cfg = self.leer()
        self.assertEqual((cfg["base_url"], cfg["api_key"], cfg["inari_token"]),
                         ("https://op.test", "CLAVE", "TOK"))
        self.assertEqual(cfg["pin"], BUENA["pin"])               # tan protegida como estaba
        self.assertEqual(cfg["favoritos"], BUENA["favoritos"])
        self.assertEqual(cfg["no_laborables"], {"2026-11-10": "festivo"})   # lo de despues manda
        self.assertEqual(cfg["ultima_version_abierta"], "3.2.1")
        # el fichero tal como estaba queda al lado
        self.assertTrue(any(n.startswith("config.json.incompleto-") for n in os.listdir(self.dir)))
        self.assertIsNone(ccore.recuperar_si_hace_falta())        # ya esta bien: nada

    def test_fichero_roto_tambien(self):
        self.copia(BUENA, dt.datetime(2026, 11, 11, 9, 0, 0))
        self.poner(None, texto="{roto")
        with mock.patch.object(ccore.time, "sleep"):
            self.assertIsNotNone(ccore.recuperar_si_hace_falta())
        self.assertEqual(self.leer()["api_key"], "CLAVE")
        self.assertTrue(any(n.startswith("config.json.danado-") for n in os.listdir(self.dir)))

    def test_config_buena_o_sin_fichero_no_se_toca(self):
        self.copia(BUENA, dt.datetime(2026, 11, 11, 9, 0, 0))
        self.assertIsNone(ccore.recuperar_si_hace_falta())        # sin fichero: asistente
        self.poner({**BUENA, "api_key": "NUEVA"})
        self.assertIsNone(ccore.recuperar_si_hace_falta())
        self.assertEqual(self.leer()["api_key"], "NUEVA")

    def test_sin_copia_buena_no_hace_nada(self):
        self.poner({"no_laborables": {}})
        self.assertIsNone(ccore.recuperar_si_hace_falta())
        self.assertEqual(self.leer(), {"no_laborables": {}})

    def test_tras_olvidar_el_pin_no_vuelven_solas_las_copias_de_antes(self):
        self.copia(BUENA, dt.datetime(2026, 11, 11, 9, 0, 0))
        copias.marcar_de_cero(self.ruta, dt.datetime(2026, 11, 11, 10, 0, 0))
        self.poner({"tema": "oscuro"})               # asistente a medias tras olvidar el PIN
        self.assertIsNone(ccore.recuperar_si_hace_falta())
        # una copia hecha despues si vale
        self.copia({**BUENA, "pin": None, "api_key": "OTRA"}, dt.datetime(2026, 11, 11, 11, 0, 0))
        self.copia({"tema": "oscuro"}, dt.datetime(2026, 11, 11, 11, 5, 0))
        self.assertEqual(ccore.recuperar_si_hace_falta(), "config-20261111-110000.json")
        self.assertEqual(self.leer()["api_key"], "OTRA")

    def test_la_api_avisa_una_vez(self):
        with mock.patch.object(web, "RECUPERADA", "11/11/2026 a las 12:59"):
            api = web.Api.__new__(web.Api)
            self.assertEqual(api._recuperada(), "11/11/2026 a las 12:59")
            self.assertEqual(api._recuperada(), "")


class TestCopias(Base):
    def test_la_ultima_completa_no_se_purga(self):
        copias.quizas_copiar(self.ruta, BUENA, dt.datetime(2026, 11, 11, 9, 0, 0))
        for i in range(15):            # 15 cambios mas con la config rota, el mismo dia
            copias.quizas_copiar(self.ruta, {"no_laborables": {str(i): "x"}},
                                 dt.datetime(2026, 11, 11, 10, i, 0))
        ids = [c["id"] for c in copias.listar(self.ruta)]
        self.assertIn("config-20261111-090000.json", ids)
        self.assertEqual(copias.ultima_completa(self.ruta)[0], "config-20261111-090000.json")

    def test_el_indice_conserva_la_marca_de_cero(self):
        copias.marcar_de_cero(self.ruta, dt.datetime(2026, 11, 11, 10, 0, 0))
        copias.quizas_copiar(self.ruta, BUENA, dt.datetime(2026, 11, 11, 11, 0, 0))
        with open(os.path.join(copias.carpeta(self.ruta), "indice.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["de_cero_desde"], "20261111100000")

    def test_restaurar_sobre_config_sin_conexion_la_devuelve_con_su_pin(self):
        r = copias.combinar({"no_laborables": {}}, BUENA)
        self.assertEqual((r["base_url"], r["api_key"], r["inari_token"], r["pin"]),
                         ("https://op.test", "CLAVE", "TOK", BUENA["pin"]))

    def test_restaurar_con_conexion_sigue_sin_traer_pin_ni_claves(self):
        r = copias.combinar({"base_url": "https://op.test", "api_key": "NUEVA"}, BUENA)
        self.assertEqual(r["api_key"], "NUEVA")
        self.assertNotIn("pin", r)
        self.assertNotIn("inari_token", r)


if __name__ == "__main__":
    unittest.main()
