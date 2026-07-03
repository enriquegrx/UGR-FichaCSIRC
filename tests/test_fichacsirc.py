#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests del motor de FichaCSIRC. Sin red: todo lo externo va mockeado.

Ejecutar desde la carpeta del proyecto:
    python -m unittest discover -s tests -t . -v
(o doble clic en run_tests.bat)
"""

import datetime as dt
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

# Config de prueba ANTES de importar el motor (la carga al importarse).
# Asi los tests no dependen del config.json real ni de sus valores.
_TMP = tempfile.mkdtemp(prefix="fichacsirc_test_")
_CFG = os.path.join(_TMP, "config.json")
with open(_CFG, "w", encoding="utf-8") as f:
    json.dump({
        "base_url": "https://op.test",
        "api_key": "clave-de-prueba",
        "jornada_invierno": 7,
        "tiene_verano": True,
        "jornada_verano": 5,
        "verano_inicio": [6, 16],
        "verano_fin": [9, 15],
        "actividad_defecto": "soporte",
        "favoritos": [],
    }, f)
os.environ["FICHACSIRC_CONFIG"] = _CFG

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import rellenar_horas as core        # noqa: E402
import configurar_gui as wiz         # noqa: E402


class TestDuraciones(unittest.TestCase):
    def test_parse_horas(self):
        self.assertEqual(core._parse_horas("PT7H"), 7.0)
        self.assertEqual(core._parse_horas("PT3H30M"), 3.5)
        self.assertEqual(core._parse_horas("PT45M"), 0.75)
        self.assertEqual(core._parse_horas("PT0H"), 0.0)
        self.assertEqual(core._parse_horas(""), 0.0)
        self.assertEqual(core._parse_horas(None), 0.0)

    def test_iso_dur(self):
        self.assertEqual(core._iso_dur(7), "PT7H")
        self.assertEqual(core._iso_dur(3.5), "PT3H30M")
        self.assertEqual(core._iso_dur(0.75), "PT45M")
        self.assertEqual(core._iso_dur(0), "PT0H")

    def test_ida_y_vuelta(self):
        for horas in (0.25, 0.5, 1, 2.75, 3.5, 7):
            self.assertEqual(core._parse_horas(core._iso_dur(horas)), horas)

    def test_fmt(self):
        self.assertEqual(core._fmt(7), "7h")
        self.assertEqual(core._fmt(3.5), "3.5h")
        self.assertEqual(core._fmt(0), "0h")
        self.assertEqual(core._fmt(0.75), "0.75h")


class TestJornada(unittest.TestCase):
    def test_es_verano_dentro(self):
        self.assertTrue(core.es_verano(dt.date(2026, 6, 16)))   # primer dia
        self.assertTrue(core.es_verano(dt.date(2026, 7, 15)))
        self.assertTrue(core.es_verano(dt.date(2026, 9, 15)))   # ultimo dia

    def test_es_verano_fuera(self):
        self.assertFalse(core.es_verano(dt.date(2026, 6, 15)))
        self.assertFalse(core.es_verano(dt.date(2026, 9, 16)))
        self.assertFalse(core.es_verano(dt.date(2026, 1, 10)))

    def test_jornada_de(self):
        self.assertEqual(core.jornada_de(dt.date(2026, 7, 1)), 5)   # verano
        self.assertEqual(core.jornada_de(dt.date(2026, 2, 1)), 7)   # normal

    def test_sin_horario_de_verano(self):
        with mock.patch.object(core, "TIENE_VERANO", False):
            self.assertFalse(core.es_verano(dt.date(2026, 7, 1)))
            self.assertEqual(core.jornada_de(dt.date(2026, 7, 1)), 7)


class TestMsgConfigurar(unittest.TestCase):
    def test_script(self):
        self.assertIn("FichaCSIRC - Configurar.bat", core._msg_configurar())

    def test_frozen(self):
        with mock.patch.object(sys, "frozen", True, create=True):
            self.assertIn("FichaCSIRC-Configurar.exe", core._msg_configurar())


class TestApi(unittest.TestCase):
    def tearDown(self):
        core._ACT_CACHE = None

    def test_get_401_no_mata_el_proceso(self):
        resp = mock.Mock(status_code=401)
        with mock.patch.object(core.requests, "get", return_value=resp):
            with self.assertRaises(RuntimeError) as ctx:
                core._get("/api/v3/users/me")
        self.assertIn("401", str(ctx.exception))

    @mock.patch.object(core, "_user_id", return_value="42")
    @mock.patch.object(core, "_get")
    def test_entradas_dia(self, m_get, _m_uid):
        m_get.return_value = {"_embedded": {"elements": [{
            "id": 9,
            "hours": "PT3H30M",
            "comment": {"raw": "hola"},
            "_links": {
                "workPackage": {"href": "/api/v3/work_packages/123",
                                "title": "Tarea X"},
                "activity": {"title": "soporte"},
            },
        }]}}
        out = core.entradas_dia("2026-07-01")
        self.assertEqual(out, [{
            "id": 9, "wp_id": "123", "horas": 3.5, "wp_titulo": "Tarea X",
            "comentario": "hola", "actividad": "soporte",
        }])
        filtros = json.loads(m_get.call_args.kwargs["params"]["filters"])
        self.assertIn({"spent_on": {"operator": "=d", "values": ["2026-07-01"]}}, filtros)
        self.assertIn({"user": {"operator": "=", "values": ["42"]}}, filtros)

    @mock.patch.object(core, "_user_id", return_value="")
    @mock.patch.object(core, "_get")
    def test_entradas_dia_sin_usuario_no_filtra(self, m_get, _m_uid):
        m_get.return_value = {"_embedded": {"elements": []}}
        core.entradas_dia("2026-07-01")
        filtros = json.loads(m_get.call_args.kwargs["params"]["filters"])
        self.assertEqual(len(filtros), 1)  # solo la fecha

    def test_actividad_href(self):
        core._ACT_CACHE = {"Soporte": "/href/s",
                           "Gestión y planificación": "/href/g"}
        self.assertEqual(core._actividad_href(1, "soporte"), "/href/s")     # exacta
        self.assertEqual(core._actividad_href(1, "gestión"), "/href/g")    # parcial
        self.assertIsNone(core._actividad_href(1, "inexistente"))

    def test_crear_entrada_payload(self):
        resp = mock.Mock(status_code=201)
        with mock.patch.object(core, "_actividad_href",
                               return_value="/api/v3/time_entries/activities/2"), \
             mock.patch.object(core.requests, "post", return_value=resp) as m_post:
            core.crear_entrada("2026-07-01", 123, 2.5, "coment", "soporte")
        payload = m_post.call_args.kwargs["json"]
        self.assertEqual(payload["hours"], "PT2H30M")
        self.assertEqual(payload["spentOn"], "2026-07-01")
        self.assertEqual(payload["comment"], {"raw": "coment"})
        self.assertEqual(payload["_links"]["workPackage"],
                         {"href": "/api/v3/work_packages/123"})
        self.assertEqual(payload["_links"]["activity"],
                         {"href": "/api/v3/time_entries/activities/2"})

    def test_crear_entrada_sin_actividad_resuelta(self):
        resp = mock.Mock(status_code=201)
        with mock.patch.object(core, "_actividad_href", return_value=None), \
             mock.patch.object(core.requests, "post", return_value=resp) as m_post:
            core.crear_entrada("2026-07-01", 123, 1, "", "loquesea")
        payload = m_post.call_args.kwargs["json"]
        self.assertNotIn("activity", payload["_links"])  # el servidor pone la suya

    def test_crear_entrada_error(self):
        resp = mock.Mock(status_code=422, text="datos malos")
        with mock.patch.object(core, "_actividad_href", return_value=None), \
             mock.patch.object(core.requests, "post", return_value=resp):
            with self.assertRaises(RuntimeError) as ctx:
                core.crear_entrada("2026-07-01", 123, 1, "", None)
        self.assertIn("422", str(ctx.exception))

    def test_eliminar_entrada(self):
        with mock.patch.object(core.requests, "delete",
                               return_value=mock.Mock(status_code=204)):
            core.eliminar_entrada(9)  # no debe lanzar
        with mock.patch.object(core.requests, "delete",
                               return_value=mock.Mock(status_code=500, text="boom")):
            with self.assertRaises(RuntimeError):
                core.eliminar_entrada(9)

    def test_actualizar_entrada(self):
        resp = mock.Mock(status_code=200)
        with mock.patch.object(core, "_actividad_href", return_value="/a/2"), \
             mock.patch.object(core.requests, "patch", return_value=resp) as m_patch:
            core.actualizar_entrada(9, 4.5, "nuevo", "soporte", 123)
        self.assertIn("/api/v3/time_entries/9", m_patch.call_args.args[0])
        payload = m_patch.call_args.kwargs["json"]
        self.assertEqual(payload["hours"], "PT4H30M")
        self.assertEqual(payload["comment"], {"raw": "nuevo"})
        self.assertEqual(payload["_links"]["activity"], {"href": "/a/2"})

    def test_actualizar_entrada_error(self):
        resp = mock.Mock(status_code=409, text="conflicto")
        with mock.patch.object(core.requests, "patch", return_value=resp):
            with self.assertRaises(RuntimeError) as ctx:
                core.actualizar_entrada(9, 1, "")
        self.assertIn("409", str(ctx.exception))

    @mock.patch.object(core, "_get")
    def test_get_todos_sigue_la_paginacion(self, m_get):
        m_get.side_effect = [
            {"total": 3, "_embedded": {"elements": [{"id": 1}, {"id": 2}]}},
            {"total": 3, "_embedded": {"elements": [{"id": 3}]}},
        ]
        out = core._get_todos("/api/v3/projects")
        self.assertEqual([e["id"] for e in out], [1, 2, 3])
        self.assertEqual(m_get.call_count, 2)
        self.assertEqual(m_get.call_args_list[1].kwargs["params"]["offset"], 2)

    def test_buscar_actualizacion(self):
        resp = mock.Mock(status_code=200)
        resp.json.return_value = {"tag_name": "v99.9",
                                  "html_url": "https://github.com/x/y/releases"}
        with mock.patch.object(core, "GITHUB_REPO", "x/y"), \
             mock.patch.object(core.requests, "get", return_value=resp):
            self.assertEqual(core.buscar_actualizacion(),
                             ("99.9", "https://github.com/x/y/releases"))
        # misma version -> no hay actualizacion
        resp.json.return_value = {"tag_name": f"v{core.VERSION}"}
        with mock.patch.object(core, "GITHUB_REPO", "x/y"), \
             mock.patch.object(core.requests, "get", return_value=resp):
            self.assertIsNone(core.buscar_actualizacion())
        # sin repo configurado -> desactivada (y sin llamadas de red)
        with mock.patch.object(core.requests, "get") as m_get:
            self.assertIsNone(core.buscar_actualizacion())
            m_get.assert_not_called()

    def test_get_reintenta_error_de_red(self):
        ok = mock.Mock(status_code=200)
        ok.json.return_value = {"x": 1}
        ok.raise_for_status.return_value = None
        with mock.patch.object(core.requests, "get",
                               side_effect=[core.requests.ConnectionError("boom"), ok]), \
             mock.patch.object(core.time, "sleep"):
            self.assertEqual(core._get("/x"), {"x": 1})


class TestNoLaborables(unittest.TestCase):
    def test_ciclo_completo(self):
        f = "2026-07-06"
        core.marcar_no_laborable(f, "festivo")
        try:
            self.assertTrue(core.es_no_laborable(f))
            self.assertEqual(core.motivo_no_laborable(f), "festivo")
            self.assertEqual(core.objetivo_de(dt.date(2026, 7, 6)), 0)
            with open(core.CONFIG_PATH, encoding="utf-8") as fh:
                self.assertIn(f, json.load(fh).get("no_laborables", {}))
        finally:
            core.quitar_no_laborable(f)
        self.assertFalse(core.es_no_laborable(f))
        self.assertEqual(core.objetivo_de(dt.date(2026, 7, 6)), 5)  # verano


class TestConfigPersistente(unittest.TestCase):
    def test_anadir_favorito_no_duplica(self):
        antes = len(core.FAVORITOS)
        try:
            core.anadir_favorito({"id": 999, "nombre": "X"})
            core.anadir_favorito({"id": 999, "nombre": "X"})
            self.assertEqual(len(core.FAVORITOS), antes + 1)
        finally:
            core.FAVORITOS[:] = [f for f in core.FAVORITOS if f["id"] != 999]
            core.guardar_config_valor("favoritos", core.FAVORITOS)

    def test_plantillas(self):
        core.guardar_plantilla("dia tipico", [{"id": 1, "horas": 2}])
        try:
            self.assertTrue(any(p["nombre"] == "dia tipico" for p in core.PLANTILLAS))
            # guardar con el mismo nombre reemplaza, no duplica
            core.guardar_plantilla("dia tipico", [{"id": 2, "horas": 3}])
            iguales = [p for p in core.PLANTILLAS if p["nombre"] == "dia tipico"]
            self.assertEqual(len(iguales), 1)
            self.assertEqual(iguales[0]["apuntes"][0]["id"], 2)
        finally:
            core.eliminar_plantilla("dia tipico")
        self.assertFalse(any(p["nombre"] == "dia tipico" for p in core.PLANTILLAS))

    def test_guardar_config_valor_preserva_el_resto(self):
        core.guardar_config_valor("clave_de_prueba", 42)
        try:
            with open(core.CONFIG_PATH, encoding="utf-8") as fh:
                cfg = json.load(fh)
            self.assertEqual(cfg["clave_de_prueba"], 42)
            self.assertEqual(cfg["api_key"], "clave-de-prueba")  # intacta
            self.assertEqual(core.config_valor("clave_de_prueba"), 42)
        finally:
            with open(core.CONFIG_PATH, encoding="utf-8") as fh:
                cfg = json.load(fh)
            cfg.pop("clave_de_prueba", None)
            with open(core.CONFIG_PATH, "w", encoding="utf-8") as fh:
                json.dump(cfg, fh)


class TestWizardFechas(unittest.TestCase):
    def test_fecha_a_lista_valida(self):
        self.assertEqual(wiz._fecha_a_lista("16/06", None), [6, 16])
        self.assertEqual(wiz._fecha_a_lista("16-06", None), [6, 16])
        self.assertEqual(wiz._fecha_a_lista("7/1", None), [1, 7])

    def test_fecha_a_lista_invalida_devuelve_defecto(self):
        self.assertEqual(wiz._fecha_a_lista("31/13", [6, 16]), [6, 16])
        self.assertEqual(wiz._fecha_a_lista("patata", [6, 16]), [6, 16])
        self.assertIsNone(wiz._fecha_a_lista("31/13", None))  # asi valida el wizard

    def test_lista_a_fecha(self):
        self.assertEqual(wiz._lista_a_fecha([6, 16]), "16/06")
        self.assertEqual(wiz._lista_a_fecha([9, 15]), "15/09")
        self.assertEqual(wiz._lista_a_fecha(None), "16/06")  # tolerante


if __name__ == "__main__":
    unittest.main(verbosity=2)
