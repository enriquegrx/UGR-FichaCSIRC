#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3.2.2: por que no se puede leer ProyectosTic (y que hacer), el texto de
"Copiar diagnostico" (sin secretos), el aviso de cierre de mes y las
etiquetas de guardia/teletrabajo/permiso imputados en ProyectosTic."""

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

requests = core.requests


def http_error(codigo):
    r = requests.Response()
    r.status_code = codigo
    return requests.HTTPError(f"{codigo} Error", response=r)


class TestDiagnosticoConexion(unittest.TestCase):
    def setUp(self):
        for p in (mock.patch.object(core, "BASE_URL", "https://op.test"),
                  mock.patch.object(core, "API_KEY", "k" * 40)):
            p.start()
            self.addCleanup(p.stop)

    def tipo(self, e, internet=True):
        with mock.patch.object(web, "_hay_internet", return_value=internet):
            return web.diagnostico_conexion(e)["tipo"]

    def test_cada_motivo(self):
        self.assertEqual(self.tipo(RuntimeError("Acceso denegado (401): la API key...")), "clave")
        self.assertEqual(self.tipo(http_error(401)), "clave")
        self.assertEqual(self.tipo(http_error(403)), "permiso")
        self.assertEqual(self.tipo(http_error(503)), "servidor")
        self.assertEqual(self.tipo(requests.ConnectTimeout("x")), "vpn")        # la UGR si, PT no
        self.assertEqual(self.tipo(requests.ConnectionError("x"), internet=False), "internet")
        self.assertEqual(self.tipo(ValueError("raro")), "otro")

    def test_config_sin_conexion(self):
        with mock.patch.object(core, "API_KEY", ""):
            self.assertEqual(self.tipo(requests.ConnectionError("x")), "config")

    def test_la_semana_lo_dice_y_lo_apunta_una_vez(self):
        api = web.Api()
        api._desbloqueada = True
        with mock.patch.object(core, "entradas_dia", side_effect=http_error(401)), \
             mock.patch.object(web.destinos, "configurado", return_value=False), \
             mock.patch.object(core.LOG, "warning") as m_log:
            s = api.semana("2026-11-09")
            api.semana("2026-11-09")
        self.assertEqual(s["conexion"], "error")
        self.assertEqual(s["conexion_detalle"]["tipo"], "clave")
        self.assertEqual(m_log.call_count, 1)                    # no llena el log en cada recarga
        # repintar (sin red) sigue diciendo que no se pudo leer
        self.assertEqual(api.repintar("2026-11-09")["conexion"], "error")


class TestCopiarDiagnostico(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fichacsirc_diag_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.ruta = os.path.join(self.dir, "config.json")
        self.key = "SECRETA-" + "x" * 32
        with open(self.ruta, "w", encoding="utf-8") as f:
            json.dump({"base_url": "https://op.test", "api_key": self.key, "inari_token": "TOKENINARI",
                       "pin": {"hash": "HASHDELPIN", "sal": "SALDELPIN"}, "favoritos": [{"id": 1}]}, f)
        with open(os.path.join(self.dir, "fichacsirc.log"), "w", encoding="utf-8") as f:
            f.write(f"linea con la clave {self.key} por error\n")
        p = mock.patch.object(web.ccore, "CONFIG_PATH", self.ruta)
        p.start()
        self.addCleanup(p.stop)

    def test_sin_secretos_y_con_lo_que_importa(self):
        api = web.Api()
        api._desbloqueada = True
        resp = mock.Mock(status_code=401, ok=False)
        with mock.patch.object(web, "_hay_internet", return_value=True), \
             mock.patch("requests.get", return_value=resp):
            t = api.diagnostico()["texto"]
        for secreto in (self.key, "TOKENINARI", "HASHDELPIN", "SALDELPIN"):
            self.assertNotIn(secreto, t)
        self.assertIn("API key: sí, 40 caracteres", t)
        self.assertIn("RECHAZADA", t)
        self.assertIn("PIN: sí", t)
        self.assertIn("***", t)                                  # la del log, tachada

    def test_bloqueada_no(self):
        api = web.Api()
        api._desbloqueada = False
        with self.assertRaises(PermissionError):
            api.diagnostico()


class TestCierreDeMes(unittest.TestCase):
    def setUp(self):
        self.guardado = {}
        for p in (mock.patch.object(core, "config_valor", lambda k, d=None: self.guardado.get(k, d)),
                  mock.patch.object(core, "guardar_config_valor", lambda k, v: self.guardado.__setitem__(k, v)),
                  mock.patch.object(core, "es_no_laborable", lambda iso: False),
                  mock.patch.object(web.destinos, "configurado", return_value=False),
                  mock.patch.object(web, "actividades_de_permiso", return_value=set()),
                  mock.patch.object(web, "objetivo_dia", lambda d, ap, acts=None: 7.0)):
            p.start()
            self.addCleanup(p.stop)
        self.api = web.Api()

    def apuntes(self, dias_completos):
        return [{"fecha": iso, "horas": 7.0} for iso in dias_completos]

    def test_fuera_de_los_ultimos_dias_no_avisa(self):
        with mock.patch.object(core, "entradas_rango", side_effect=AssertionError("no debía consultar")):
            self.assertIsNone(self.api.mes_pendiente(dt.date(2026, 11, 12)))

    def test_ultimos_dias_del_mes_lista_los_huecos_hasta_ayer(self):
        completos = [f"2026-11-{n:02d}" for n in range(2, 25) if n != 18]
        with mock.patch.object(core, "entradas_rango", return_value=self.apuntes(completos)) as m:
            r = self.api.mes_pendiente(dt.date(2026, 11, 25))      # miercoles: penultima semana
        m.assert_called_once_with("2026-11-01", "2026-11-24")
        self.assertEqual([x["iso"] for x in r["dias"]], ["2026-11-18"])
        self.assertIn("Noviembre cierra", r["texto"])
        # la X lo calla hasta manana
        self.api.aviso_mes_visto()
        self.assertEqual(self.guardado["aviso_mes_visto"], dt.date.today().isoformat())
        self.guardado["aviso_mes_visto"] = "2026-11-25"
        self.assertIsNone(self.api.mes_pendiente(dt.date(2026, 11, 25)))

    def test_primeros_dias_del_siguiente_avisa_del_que_cerro(self):
        with mock.patch.object(core, "entradas_rango", return_value=[]) as m:
            r = self.api.mes_pendiente(dt.date(2026, 12, 1))
        m.assert_called_once_with("2026-11-01", "2026-11-30")
        self.assertIn("se ha cerrado", r["texto"])
        self.assertEqual(len(r["dias"]), 21)                     # laborables de noviembre de 2026

    def test_todo_completo_o_sin_red_no_avisa(self):
        with mock.patch.object(core, "entradas_rango", side_effect=RuntimeError("sin red")):
            self.assertIsNone(self.api.mes_pendiente(dt.date(2026, 11, 27)))
        todos = [f"2026-11-{n:02d}" for n in range(1, 27)]
        with mock.patch.object(core, "entradas_rango", return_value=self.apuntes(todos)):
            self.assertIsNone(self.api.mes_pendiente(dt.date(2026, 11, 27)))


class TestEtiquetasImputadas(unittest.TestCase):
    def estado(self, apuntes, tareas_local=None, guardia_com="Servicio de Guardia"):
        cfg = {"tareas_local": tareas_local or {}}
        with mock.patch.object(core, "config_valor", lambda k, d=None: cfg.get(k, d)), \
             mock.patch.object(core, "comentario_guardia", return_value=guardia_com):
            return web.estado_dia(dt.date(2026, 11, 10), apuntes, dt.date(2026, 11, 12), set())

    def ap(self, wp, horas=7.0, comentario="", actividad="soporte"):
        return {"id": 1, "horas": horas, "wp_id": wp, "wp_titulo": "T", "actividad": actividad,
                "comentario": comentario}

    def test_por_tarea_elegida_y_por_comentario_de_guardia(self):
        t = self.estado([self.ap(77)], {"teletrabajo": {"id": 77}})
        self.assertTrue(t["teletrabajo_pt"])
        self.assertFalse(t["guardia_pt"])
        t = self.estado([self.ap(5, comentario="Servicio de Guardia")])
        self.assertTrue(t["guardia_pt"])
        t = self.estado([self.ap(88, horas=3)], {"permiso": {"id": 88}})
        self.assertEqual(t["permiso_pt"], core.fmt_horas_hhmm(3))
        t = self.estado([self.ap(5)])
        self.assertEqual((t["guardia_pt"], t["teletrabajo_pt"], t["permiso_pt"]), (False, False, ""))


if __name__ == "__main__":
    unittest.main()
