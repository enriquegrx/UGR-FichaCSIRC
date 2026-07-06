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
        esperado = "python3 configurar_gui.py" if sys.platform == "darwin" else "FichaCSIRC - Configurar.bat"
        self.assertIn(esperado, core._msg_configurar())

    def test_frozen(self):
        with mock.patch.object(sys, "frozen", True, create=True):
            esperado = "FichaCSIRC-Configurar.app" if sys.platform == "darwin" else "FichaCSIRC-Configurar.exe"
            self.assertIn(esperado, core._msg_configurar())


class TestApi(unittest.TestCase):
    def tearDown(self):
        core._ACT_CACHE = {}

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
        core._ACT_CACHE = {"1": {"Soporte": "/href/s",
                                 "Gestión y planificación": "/href/g"}}
        self.assertEqual(core._actividad_href(1, "soporte"), "/href/s")     # exacta
        self.assertEqual(core._actividad_href(1, "gestión"), "/href/g")    # parcial
        self.assertIsNone(core._actividad_href(1, "inexistente"))

    def test_actividades_cache_por_wp(self):
        """Cada work package cachea SUS actividades (no se comparten)."""
        def _form(url, headers=None, json=None, timeout=None):
            wp = json["_links"]["workPackage"]["href"].rsplit("/", 1)[-1]
            nombre = "soporte" if wp == "10" else "correctivo"
            r = mock.Mock(status_code=200)
            r.json.return_value = {"_embedded": {"schema": {"activity": {"_embedded": {
                "allowedValues": [{"name": nombre,
                                   "_links": {"self": {"href": f"/act/{wp}"}}}]}}}}}
            r.raise_for_status.return_value = None
            return r
        with mock.patch.object(core.requests, "post", side_effect=_form):
            self.assertEqual(core._actividades_disponibles(10), {"soporte": "/act/10"})
            self.assertEqual(core._actividades_disponibles(20), {"correctivo": "/act/20"})
        # segunda llamada: cacheado, no vuelve a la red
        with mock.patch.object(core.requests, "post") as m_post:
            self.assertEqual(core._actividades_disponibles(10), {"soporte": "/act/10"})
            m_post.assert_not_called()

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

    def tearDown_update(self):
        core.guardar_config_valor("ultimo_chequeo_update", "")
        core.guardar_config_valor("ultimo_chequeo_update_ts", "")

    def test_buscar_actualizacion(self):
        self.addCleanup(self.tearDown_update)
        resp = mock.Mock(status_code=200)
        resp.json.return_value = {"tag_name": "v99.9",
                                  "html_url": "https://github.com/x/y/releases",
                                  "assets": []}
        with mock.patch.object(core, "GITHUB_REPO", "x/y"), \
             mock.patch.object(core.requests, "get", return_value=resp):
            self.assertEqual(core.buscar_actualizacion(forzar=True),
                             ("99.9", "https://github.com/x/y/releases", ""))
        # misma version -> no hay actualizacion
        resp.json.return_value = {"tag_name": f"v{core.VERSION}"}
        with mock.patch.object(core, "GITHUB_REPO", "x/y"), \
             mock.patch.object(core.requests, "get", return_value=resp):
            self.assertIsNone(core.buscar_actualizacion(forzar=True))
        # sin repo configurado -> desactivada (y sin llamadas de red)
        with mock.patch.object(core, "GITHUB_REPO", ""), \
             mock.patch.object(core.requests, "get") as m_get:
            self.assertIsNone(core.buscar_actualizacion())
            m_get.assert_not_called()

    def test_buscar_actualizacion_instalador_windows(self):
        self.addCleanup(self.tearDown_update)
        resp = mock.Mock(status_code=200)
        resp.json.return_value = {
            "tag_name": "v99.9",
            "html_url": "https://github.com/x/y/releases",
            "assets": [
                {"name": "otro.zip", "browser_download_url": "https://x/otro.zip"},
                {"name": "FichaCSIRC-Instalador.exe",
                 "browser_download_url": "https://x/FichaCSIRC-Instalador.exe"},
            ],
        }
        with mock.patch.object(core, "GITHUB_REPO", "x/y"), \
             mock.patch.object(core.os, "name", "nt"), \
             mock.patch.object(core.requests, "get", return_value=resp):
            self.assertEqual(
                core.buscar_actualizacion(forzar=True),
                ("99.9", "https://github.com/x/y/releases",
                 "https://x/FichaCSIRC-Instalador.exe"))

    def test_buscar_actualizacion_cada_pocas_horas(self):
        self.addCleanup(self.tearDown_update)
        import datetime as _dt
        core.guardar_config_valor(
            "ultimo_chequeo_update_ts",
            _dt.datetime.now().isoformat(timespec="seconds"))
        with mock.patch.object(core, "GITHUB_REPO", "x/y"), \
             mock.patch.object(core.requests, "get") as m_get:
            self.assertIsNone(core.buscar_actualizacion())  # chequeo reciente
            m_get.assert_not_called()

    def test_descargar_archivo(self):
        resp = mock.Mock()
        resp.raise_for_status.return_value = None
        resp.iter_content.return_value = [b"abc", b"", b"def"]
        destino = os.path.join(_TMP, "descarga-test.bin")
        with mock.patch.object(core.requests, "get", return_value=resp) as m_get:
            self.assertEqual(core.descargar_archivo("https://x/file.exe", destino),
                             destino)
        m_get.assert_called_once_with("https://x/file.exe", stream=True, timeout=60)
        resp.close.assert_called_once()
        with open(destino, "rb") as f:
            self.assertEqual(f.read(), b"abcdef")

    def test_get_reintenta_error_de_red(self):
        ok = mock.Mock(status_code=200)
        ok.json.return_value = {"x": 1}
        ok.raise_for_status.return_value = None
        with mock.patch.object(core.requests, "get",
                               side_effect=[core.requests.ConnectionError("boom"), ok]), \
             mock.patch.object(core.time, "sleep"):
            self.assertEqual(core._get("/x"), {"x": 1})


class TestBuscarWp(unittest.TestCase):
    @mock.patch.object(core, "_get")
    def test_devuelve_resultados(self, m_get):
        m_get.return_value = {"_embedded": {"elements": [
            {"id": 5, "subject": "Proxmox + dockers"}]}}
        self.assertEqual(core.buscar_wp("prox"),
                         [{"id": 5, "nombre": "Proxmox + dockers"}])

    @mock.patch.object(core, "_get", side_effect=RuntimeError("sin red"))
    def test_propaga_errores(self, _m):
        with self.assertRaises(RuntimeError):
            core.buscar_wp("prox")  # la GUI decide como avisar


class TestFestivos(unittest.TestCase):
    def test_importar_festivos(self):
        festivos = {
            "2026-01-01": "Año Nuevo",   # jueves: se importa
            "2026-02-28": "Andalucía",   # sabado: se salta
            "2026-12-25": "Navidad",     # viernes: se importa
        }
        with mock.patch.object(core, "NO_LABORABLES", {}), \
             mock.patch.object(core, "FESTIVOS_CONOCIDOS", festivos), \
             mock.patch.object(core, "guardar_config_valor") as m_g:
            self.assertEqual(core.festivos_pendientes(),
                             {"2026-01-01": "Año Nuevo",
                              "2026-12-25": "Navidad"})
            self.assertEqual(core.importar_festivos(), 2)
            self.assertTrue(core.es_no_laborable("2026-01-01"))
            self.assertFalse(core.es_no_laborable("2026-02-28"))
            # idempotente: la segunda vez no hay nada que importar
            self.assertEqual(core.importar_festivos(), 0)
            m_g.assert_called_once()

    def test_no_pisa_marcas_del_usuario(self):
        with mock.patch.object(core, "NO_LABORABLES",
                               {"2026-01-01": "vacaciones"}), \
             mock.patch.object(core, "FESTIVOS_CONOCIDOS",
                               {"2026-01-01": "Año Nuevo"}), \
             mock.patch.object(core, "guardar_config_valor"):
            self.assertEqual(core.importar_festivos(), 0)
            self.assertEqual(core.motivo_no_laborable("2026-01-01"), "vacaciones")


class TestRecordatorioMac(unittest.TestCase):
    def test_plist(self):
        import recordatorio
        plist = recordatorio._plist_contenido("16:30")
        self.assertIn(recordatorio.LAUNCHD_LABEL, plist)
        self.assertIn("<key>Hour</key><integer>16</integer>", plist)
        self.assertIn("<key>Minute</key><integer>30</integer>", plist)
        # lunes a viernes (Weekday 1..5)
        self.assertEqual(plist.count("<key>Weekday</key>"), 5)
        self.assertIn("<integer>1</integer>", plist)
        self.assertIn("<integer>5</integer>", plist)


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


class TestPendientes(unittest.TestCase):
    def test_dias_pendientes_semana(self):
        # miercoles 8/07/2026: lun 6 completo, mar 7 a medias, mie 8 vacio
        ref = dt.date(2026, 7, 8)
        def entradas(fecha):
            reg = {"2026-07-06": [{"horas": 5.0}], "2026-07-07": [{"horas": 2.0}]}
            return reg.get(fecha, [])
        with mock.patch.object(core, "entradas_dia", entradas), \
             mock.patch.object(core, "NO_LABORABLES", {}):
            pend = core.dias_pendientes_semana(referencia=ref)
        # verano: objetivo 5h. Lunes completo (5/5), martes falta (2/5); mie/jue/vie futuros
        self.assertEqual([(d.isoformat(), reg) for d, reg, _o in pend],
                         [("2026-07-07", 2.0), ("2026-07-08", 0)])

    def test_dias_pendientes_sin_conexion(self):
        def boom(_f):
            raise RuntimeError("sin red")
        with mock.patch.object(core, "entradas_dia", boom):
            self.assertIsNone(core.dias_pendientes_semana(referencia=dt.date(2026, 7, 8)))

    def test_dias_pendientes_salta_no_laborables(self):
        ref = dt.date(2026, 7, 8)
        with mock.patch.object(core, "entradas_dia", lambda _f: []), \
             mock.patch.object(core, "NO_LABORABLES",
                               {"2026-07-06": "festivo", "2026-07-07": "festivo"}):
            pend = core.dias_pendientes_semana(referencia=ref)
        self.assertEqual([d.isoformat() for d, _r, _o in pend], ["2026-07-08"])

    def test_mensaje_recordatorio(self):
        import recordatorio
        pend = [(dt.date(2026, 7, 7), 2.0, 5), (dt.date(2026, 7, 8), 0, 5)]
        msg = recordatorio.mensaje_pendientes(pend)
        self.assertIn("Martes 07/07", msg)
        self.assertIn("Miércoles 08/07", msg)
        self.assertEqual(recordatorio.mensaje_pendientes([]), "")


class TestFestivos(unittest.TestCase):
    def test_pascua(self):
        self.assertEqual(core._pascua(2026), dt.date(2026, 4, 5))
        self.assertEqual(core._pascua(2027), dt.date(2027, 3, 28))

    def test_festivos_del_anio_2026(self):
        f = core.festivos_del_anio(2026)
        self.assertEqual(f["2026-04-02"][0], "Jueves Santo")
        self.assertEqual(f["2026-04-03"][0], "Viernes Santo")
        self.assertEqual(f["2026-06-04"][0], "Corpus Christi")     # Pascua + 60
        self.assertEqual(f["2026-02-28"][0], "Día de Andalucía")
        self.assertEqual(f["2026-01-02"][0], "Toma de Granada")
        self.assertEqual(f["2026-12-25"][0], "Navidad")
        self.assertEqual(f["2026-06-04"][1], "local")

    def test_ambitos(self):
        solo_nac = core.festivos_del_anio(2026, ambitos=("nacional",))
        self.assertIn("2026-12-25", solo_nac)
        self.assertNotIn("2026-02-28", solo_nac)   # Andalucia fuera
        self.assertNotIn("2026-01-02", solo_nac)   # local fuera

    def test_festivos_locales_extra(self):
        core.guardar_config_valor("festivos_locales_extra", ["09-08"])
        try:
            f = core.festivos_del_anio(2026)
            self.assertIn("2026-09-08", f)
        finally:
            core.guardar_config_valor("festivos_locales_extra", [])

    def test_festivos_pendientes_salta_finde_y_marcados(self):
        with mock.patch.object(core, "NO_LABORABLES", {"2026-12-25": "Navidad"}):
            pend = core.festivos_pendientes(ambitos=("nacional",), incluir_ugr=False)
        self.assertNotIn("2026-12-25", pend)          # ya marcado
        self.assertNotIn("2026-02-28", pend)          # sabado (y ambito fuera)
        self.assertIn("2026-01-06", pend)             # Reyes, laborable, sin marcar

    def test_dias_ugr_desde_config(self):
        core.guardar_config_valor("dias_ugr", {"2026-05-18": "San Pascual"})
        try:
            self.assertIn("2026-05-18", core.dias_ugr())
        finally:
            core.guardar_config_valor("dias_ugr", {})


class TestModalidades(unittest.TestCase):
    def tearDown(self):
        core.GUARDIAS.clear()
        core.TELETRABAJO.clear()
        core.guardar_config_valor("guardias", [])
        core.guardar_config_valor("teletrabajo", [])

    def test_guardia(self):
        core.marcar_guardia("2026-10-12")
        self.assertTrue(core.es_guardia("2026-10-12"))
        core.quitar_guardia("2026-10-12")
        self.assertFalse(core.es_guardia("2026-10-12"))

    def test_comentario_guardia_por_defecto(self):
        self.assertEqual(core.comentario_guardia(), "Servicio de Guardia")

    def test_teletrabajo_cupo_semanal(self):
        lunes = dt.date(2026, 7, 6)  # lunes
        self.assertEqual(core.teletrabajo_en_semana(lunes), 0)
        core.marcar_teletrabajo("2026-07-07")   # martes
        core.marcar_teletrabajo("2026-07-11")   # sabado: fuera de L-V
        self.assertEqual(core.teletrabajo_en_semana(lunes), 1)
        self.assertEqual(core.teletrabajo_por_semana(), 1)


class TestVacacionesCupo(unittest.TestCase):
    def test_vacaciones_usadas(self):
        nl = {"2026-07-06": "vacaciones",   # lunes
              "2026-07-07": "Vacaciones",   # martes (mayus)
              "2026-07-11": "vacaciones",   # sabado: no cuenta
              "2026-07-08": "festivo",      # otro motivo: no cuenta
              "2025-07-07": "vacaciones"}   # otro año: no cuenta
        with mock.patch.object(core, "NO_LABORABLES", nl):
            self.assertEqual(core.vacaciones_usadas(2026), 2)
            self.assertTrue(core.es_vacaciones("2026-07-06"))
            self.assertFalse(core.es_vacaciones("2026-07-08"))


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
