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
        # 3.0: el asistente va dentro de la app (y en Windows, su acceso del menu)
        with mock.patch.object(sys, "frozen", True, create=True):
            self.assertIn("Configuración (asistente)", core._msg_configurar())
            if sys.platform != "darwin":
                self.assertIn("FichaCSIRC - Configurar", core._msg_configurar())


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
    def test_entradas_dia_sin_usuario_no_consulta(self, m_get, _m_uid):
        # Sin usuario NO se pide el dia: sin el filtro la API devolveria los
        # apuntes de todos los compañeros visibles y se tomarian por propios.
        with self.assertRaises(RuntimeError):
            core.entradas_dia("2026-07-01")
        m_get.assert_not_called()

    def test_entradas_dia_si_falla_users_me_no_consulta(self):
        # Un corte puntual en /users/me debe propagarse, no degradar a una
        # consulta sin filtro de usuario.
        llamadas = []

        def falso_get(path, params=None):
            llamadas.append(path)
            if path == "/api/v3/users/me":
                raise core.requests.ConnectionError("corte")
            return {"_embedded": {"elements": []}}

        with mock.patch.object(core, "_ME", None), \
             mock.patch.object(core, "_get", side_effect=falso_get):
            with self.assertRaises(core.requests.ConnectionError):
                core.entradas_dia("2026-07-01")
            # y el nombre para la cabecera sigue sin romper nada
            self.assertEqual(core.nombre_usuario(), "")
        self.assertNotIn("/api/v3/time_entries", llamadas)

    def test_crear_entrada_no_cambia_de_actividad_si_falla_la_consulta(self):
        # Si no se pueden consultar las actividades, el apunte NO se crea: antes
        # se creaba sin actividad y OpenProject le ponia la de por defecto.
        with mock.patch.object(core, "_actividades_disponibles",
                               side_effect=core.requests.ConnectionError("corte")), \
             mock.patch.object(core.requests, "post") as m_post:
            with self.assertRaises(core.requests.ConnectionError):
                core.crear_entrada("2026-07-01", 5, 2, "", "Asuntos propios")
        m_post.assert_not_called()

    def test_horas_csv_con_coma_decimal(self):
        self.assertEqual(core.horas_csv(6.5), "6,5")
        self.assertEqual(core.horas_csv(7), "7")
        self.assertEqual(core.horas_csv(0.25), "0,25")

    def test_escribir_json_atomico(self):
        ruta = os.path.join(_TMP, "atomico.json")
        core.escribir_json_atomico(ruta, {"a": 1})
        core.escribir_json_atomico(ruta, {"a": 2, "ñ": "sí"})
        with open(ruta, encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"a": 2, "ñ": "sí"})
        self.assertFalse(os.path.exists(ruta + ".tmp"))
        # si el volcado falla, el fichero bueno sigue intacto
        with self.assertRaises(TypeError):
            core.escribir_json_atomico(ruta, {"x": object()})
        with open(ruta, encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"a": 2, "ñ": "sí"})
        self.assertFalse(os.path.exists(ruta + ".tmp"))  # sin restos

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


class TestInstalacionMac(unittest.TestCase):
    """Distribucion en macOS: .dmg por arquitectura y aviso si la app no esta
    en Aplicaciones (origen del bug de los 5 iconos en Launchpad)."""

    EXE = "/Contents/MacOS/FichaCSIRC"

    def test_fuera_de_aplicaciones(self):
        f = core.fuera_de_aplicaciones
        self.assertIsNone(f("/Applications/FichaCSIRC.app" + self.EXE))
        self.assertIsNone(f("/Applications/UGR/FichaCSIRC.app" + self.EXE))
        self.assertEqual(f("/Volumes/FichaCSIRC/FichaCSIRC.app" + self.EXE), "dmg")
        self.assertEqual(
            f("/private/var/folders/xy/T/AppTranslocation/ABC-123/d/FichaCSIRC.app"
              + self.EXE), "translocada")
        self.assertEqual(
            f("/Users/ana/Downloads/FichaCSIRC-mac-arm64 2/FichaCSIRC.app"
              + self.EXE), "otra")
        # sin bundle .app (p.ej. ejecutado como script): no aplica
        self.assertIsNone(f("/usr/local/bin/python3"))

    def test_fuera_de_aplicaciones_carpeta_del_usuario(self):
        with mock.patch.dict(os.environ, {"HOME": "/Users/ana"}):
            self.assertIsNone(core.fuera_de_aplicaciones(
                "/Users/ana/Applications/FichaCSIRC.app" + self.EXE))

    def test_fuera_de_aplicaciones_solo_mac_empaquetado(self):
        # sin ruta explicita, fuera de un .app de macOS nunca avisa
        with mock.patch.object(core.sys, "platform", "win32"):
            self.assertIsNone(core.fuera_de_aplicaciones())

    def test_arquitectura_mac(self):
        res = mock.Mock(stdout="1\n")
        with mock.patch.object(core.subprocess, "run", return_value=res), \
             mock.patch.object(core.platform, "machine", return_value="x86_64"):
            # Rosetta: el proceso dice x86_64 pero el hardware es Apple Silicon
            self.assertEqual(core.arquitectura_mac(), "arm64")
        res = mock.Mock(stdout="")
        with mock.patch.object(core.subprocess, "run", return_value=res), \
             mock.patch.object(core.platform, "machine", return_value="x86_64"):
            self.assertEqual(core.arquitectura_mac(), "x64")
        with mock.patch.object(core.subprocess, "run", side_effect=OSError), \
             mock.patch.object(core.platform, "machine", return_value="arm64"):
            self.assertEqual(core.arquitectura_mac(), "arm64")

    def test_asset_instalador_mac(self):
        data = {"assets": [
            {"name": "FichaCSIRC-Instalador.exe", "browser_download_url": "https://x/exe"},
            {"name": "FichaCSIRC-mac-arm64.dmg", "browser_download_url": "https://x/arm"},
            {"name": "FichaCSIRC-mac-x64.dmg", "browser_download_url": "https://x/intel"},
        ]}
        with mock.patch.object(core.os, "name", "posix"), \
             mock.patch.object(core.sys, "platform", "darwin"):
            with mock.patch.object(core, "arquitectura_mac", return_value="arm64"):
                self.assertEqual(core._asset_instalador(data), "https://x/arm")
            with mock.patch.object(core, "arquitectura_mac", return_value="x64"):
                self.assertEqual(core._asset_instalador(data), "https://x/intel")
            # release antigua con zip: no hay dmg -> se cae a abrir la pagina
            antigua = {"assets": [{"name": "FichaCSIRC-mac-arm64.zip",
                                   "browser_download_url": "https://x/zip"}]}
            with mock.patch.object(core, "arquitectura_mac", return_value="arm64"):
                self.assertEqual(core._asset_instalador(antigua), "")
        with mock.patch.object(core.os, "name", "posix"), \
             mock.patch.object(core.sys, "platform", "linux"):
            self.assertEqual(core._asset_instalador(data), "")


class TestRepararRecordatorio(unittest.TestCase):
    """El aviso diario guarda la ruta del ejecutable: si la instalacion se mueve
    (onefile -> onedir en 2.6.4, o una copia de Descargas en Mac) se repara."""

    NUEVO = r"C:\Users\ana\AppData\Local\Programs\FichaCSIRC\FichaCSIRC\FichaCSIRC.exe"
    VIEJO = r"C:\Users\ana\AppData\Local\Programs\FichaCSIRC\FichaCSIRC.exe"

    def _xml(self, ejecutable):
        xml = ('<?xml version="1.0" encoding="UTF-16"?><Task><Triggers><CalendarTrigger>'
               '<StartBoundary>2025-03-01T16:30:00</StartBoundary></CalendarTrigger>'
               f'</Triggers><Actions><Exec><Command>"{ejecutable}"</Command>'
               '<Arguments>--recordatorio</Arguments></Exec></Actions></Task>')
        return xml.encode("utf-16")          # con BOM, como schtasks

    def _reparar(self, salida, plataforma="win32", ejecutable=None, cfg=None):
        import recordatorio
        res = mock.Mock(returncode=0, stdout=salida)
        cfg = {} if cfg is None else cfg
        with mock.patch.object(core, "config_valor", lambda c, d=None: cfg.get(c, d)), \
             mock.patch.object(core, "guardar_config_valor",
                               lambda k, v: cfg.update({k: v})), \
             mock.patch.object(recordatorio.sys, "frozen", True, create=True), \
             mock.patch.object(recordatorio.sys, "executable", ejecutable or self.NUEVO), \
             mock.patch.object(recordatorio.sys, "platform", plataforma), \
             mock.patch.object(recordatorio.os, "name", "nt"), \
             mock.patch.object(recordatorio.subprocess, "run", return_value=res), \
             mock.patch.object(recordatorio, "activar_recordatorio") as m_act:
            hecho = recordatorio.reparar_recordatorio()
        return hecho, m_act

    def test_windows_ruta_vieja_se_reprograma_a_la_misma_hora(self):
        hecho, m_act = self._reparar(self._xml(self.VIEJO))
        self.assertTrue(hecho)
        m_act.assert_called_once_with("16:30")

    def test_windows_ruta_buena_no_toca_nada(self):
        cfg = {}
        hecho, m_act = self._reparar(self._xml(self.NUEVO), cfg=cfg)
        self.assertFalse(hecho)
        m_act.assert_not_called()
        self.assertEqual(cfg["recordatorio_ejecutable"], self.NUEVO)  # anotada

    def test_ruta_anotada_ni_siquiera_consulta_schtasks(self):
        # Con la ruta ya anotada no se depende de como codifique schtasks las
        # tildes (p. ej. C:\Users\Pérez): sin esto se reprogramaria siempre.
        import recordatorio
        cfg = {"recordatorio_ejecutable": self.NUEVO}
        with mock.patch.object(core, "config_valor", lambda c, d=None: cfg.get(c, d)), \
             mock.patch.object(recordatorio.sys, "frozen", True, create=True), \
             mock.patch.object(recordatorio.sys, "executable", self.NUEVO), \
             mock.patch.object(recordatorio.subprocess, "run") as m_run:
            self.assertFalse(recordatorio.reparar_recordatorio())
        m_run.assert_not_called()

    def test_salida_real_de_schtasks_sin_utf16(self):
        # Asi sale de verdad al redirigirse (comprobado en Windows 11).
        import recordatorio
        xml = self._xml(self.VIEJO).decode("utf-16").encode("utf-8")
        self.assertIn("<Command>", recordatorio._decodificar(xml))
        hecho, m_act = self._reparar(xml)
        self.assertTrue(hecho)
        m_act.assert_called_once_with("16:30")

    def test_windows_sin_tarea_no_toca_nada(self):
        import recordatorio
        with mock.patch.object(recordatorio.sys, "frozen", True, create=True), \
             mock.patch.object(recordatorio.os, "name", "nt"), \
             mock.patch.object(recordatorio.sys, "platform", "win32"), \
             mock.patch.object(recordatorio.subprocess, "run",
                               return_value=mock.Mock(returncode=1, stdout=b"")), \
             mock.patch.object(recordatorio, "activar_recordatorio") as m_act:
            self.assertFalse(recordatorio.reparar_recordatorio())
        m_act.assert_not_called()

    def test_mac_copia_borrada_se_reprograma(self):
        import plistlib
        import recordatorio
        ruta = os.path.join(_TMP, "aviso.plist")
        with open(ruta, "wb") as f:
            plistlib.dump({"ProgramArguments": [
                "/Users/ana/Downloads/FichaCSIRC-mac-arm64 2/FichaCSIRC.app/Contents/MacOS/FichaCSIRC",
                "--recordatorio"],
                "StartCalendarInterval": [{"Weekday": 1, "Hour": 9, "Minute": 5}]}, f)
        actual = "/Applications/FichaCSIRC.app/Contents/MacOS/FichaCSIRC"
        for motivo, esperado in ((None, True), ("translocada", False)):
            with mock.patch.object(recordatorio, "_plist_path", return_value=ruta), \
                 mock.patch.object(core, "fuera_de_aplicaciones", return_value=motivo):
                hecho, m_act = self._reparar(b"", plataforma="darwin", ejecutable=actual)
            self.assertEqual(hecho, esperado)
            if esperado:
                m_act.assert_called_once_with("09:05")
            else:
                m_act.assert_not_called()   # no fijar una ruta temporal


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


class TestComprobarActualizacion(unittest.TestCase):
    """No es lo mismo «no hay versión nueva» que «no he podido mirar».

    Pasó de verdad: se agotó el límite de la API de GitHub y la app decía «ya
    tienes la última versión» mientras existía una más nueva publicada."""

    def _respuesta(self, status, headers=None, body=None):
        r = mock.Mock(status_code=status, headers=headers or {})
        r.json.return_value = body if body is not None else {}
        return r

    def test_limite_de_github_al_forzar_avisa_y_no_miente(self):
        reset = int(dt.datetime(2026, 10, 27, 8, 0).timestamp())
        r = self._respuesta(403, {"X-RateLimit-Remaining": "0",
                                  "X-RateLimit-Reset": str(reset)})
        with mock.patch.object(core, "GITHUB_REPO", "u/r"), \
             mock.patch.object(core.requests, "get", return_value=r):
            with self.assertRaises(core.ComprobacionFallida) as ctx:
                core.buscar_actualizacion(forzar=True)
        msg = str(ctx.exception)
        self.assertIn("límite", msg.lower())
        self.assertIn("08:00", msg)          # dice cuándo se podrá reintentar
        self.assertIn("misma dirección", msg)  # explica que la IP es compartida

    def test_limite_en_la_comprobacion_automatica_no_molesta(self):
        """Sin forzar, sigue callando: no se interrumpe al usuario cada rato."""
        r = self._respuesta(403, {"X-RateLimit-Remaining": "0"})
        with mock.patch.object(core, "GITHUB_REPO", "u/r"), \
             mock.patch.object(core, "_chequeo_update_reciente", lambda: False), \
             mock.patch.object(core.requests, "get", return_value=r):
            self.assertIsNone(core.buscar_actualizacion())

    def test_sin_red_al_forzar_lo_dice(self):
        with mock.patch.object(core, "GITHUB_REPO", "u/r"), \
             mock.patch.object(core.requests, "get",
                               side_effect=OSError("boom")):
            with self.assertRaises(core.ComprobacionFallida) as ctx:
                core.buscar_actualizacion(forzar=True)
        self.assertIn("conectar", str(ctx.exception).lower())

    def test_si_todo_va_bien_sigue_detectando_la_version_nueva(self):
        r = self._respuesta(200, {}, {"tag_name": "v99.0.0",
                                      "html_url": "http://x", "assets": []})
        with mock.patch.object(core, "GITHUB_REPO", "u/r"), \
             mock.patch.object(core, "guardar_config_valor", lambda *a: None):
            with mock.patch.object(core.requests, "get", return_value=r):
                res = core.buscar_actualizacion(forzar=True)
        self.assertEqual(res[0], "99.0.0")


class TestPermisos(unittest.TestCase):
    """Permisos por horas: restan horas al objetivo del dia y consumen cupo."""

    # 2026-07-06 es lunes de verano -> jornada 5h en la config de test.
    LUNES = "2026-07-06"
    D_LUNES = dt.date(2026, 7, 6)

    def test_parsear_horas(self):
        self.assertEqual(core.parsear_horas("3:30"), 3.5)
        self.assertEqual(core.parsear_horas("70:00"), 70.0)  # cupos pasan de 24h
        self.assertEqual(core.parsear_horas("3,5"), 3.5)
        self.assertEqual(core.parsear_horas("3.5"), 3.5)
        for malo in ("", "abc", "3:99", None, "-1", "-1:30", "nan", "inf"):
            self.assertIsNone(core.parsear_horas(malo), f"deberia ser None: {malo!r}")

    def test_fmt_horas_hhmm(self):
        self.assertEqual(core.fmt_horas_hhmm(3.5), "3:30")
        self.assertEqual(core.fmt_horas_hhmm(70), "70:00")
        self.assertEqual(core.fmt_horas_hhmm(0), "0:00")

    def test_objetivo_resta_las_horas_de_permiso(self):
        with mock.patch.object(core, "NO_LABORABLES", {}), \
             mock.patch.object(core, "PERMISOS",
                               {self.LUNES: [{"tipo": "conciliacion", "horas": 2.0}]}):
            self.assertEqual(core.horas_permiso(self.LUNES), 2.0)
            self.assertEqual(core.objetivo_de(self.D_LUNES), 3.0)  # 5h - 2h

    def test_dia_no_laborable_manda_sobre_el_permiso(self):
        with mock.patch.object(core, "NO_LABORABLES", {self.LUNES: "festivo"}), \
             mock.patch.object(core, "PERMISOS",
                               {self.LUNES: [{"tipo": "conciliacion", "horas": 2.0}]}):
            self.assertEqual(core.objetivo_de(self.D_LUNES), 0)

    def test_objetivo_nunca_negativo(self):
        with mock.patch.object(core, "NO_LABORABLES", {}), \
             mock.patch.object(core, "PERMISOS",
                               {self.LUNES: [{"tipo": "conciliacion", "horas": 99.0}]}):
            self.assertEqual(core.objetivo_de(self.D_LUNES), 0)

    def test_horas_permiso_ignora_basura(self):
        with mock.patch.object(core, "PERMISOS",
                               {self.LUNES: [{"tipo": "x", "horas": "malo"},
                                             {"tipo": "y", "horas": 1.5}]}):
            self.assertEqual(core.horas_permiso(self.LUNES), 1.5)

    def test_anadir_permiso_valida(self):
        with mock.patch.object(core, "PERMISOS", {}), \
             mock.patch.object(core, "guardar_config_valor", lambda *a: None):
            core.anadir_permiso(self.LUNES, "conciliacion", "2:00")
            self.assertEqual(core.horas_permiso(self.LUNES), 2.0)
            # El tope es lo que vale un DIA COMPLETO de permiso (7h), no la
            # jornada que se ficha: 2h + 6h = 8h se pasa.
            with self.assertRaises(ValueError):
                core.anadir_permiso(self.LUNES, "conciliacion", "6:00")
            with self.assertRaises(ValueError):  # tipo inexistente
                core.anadir_permiso(self.LUNES, "no_existe", "1:00")
            with self.assertRaises(ValueError):  # horas no positivas
                core.anadir_permiso(self.LUNES, "conciliacion", "0")
            with self.assertRaises(ValueError):  # fecha invalida
                core.anadir_permiso("no-es-fecha", "conciliacion", "1:00")

    def test_dia_completo_de_permiso_son_7h_aunque_se_fichen_menos(self):
        """Un dia entero de permiso vale la jornada OFICIAL. El 06/07 es verano
        (se fichan 5h), pero el permiso de dia completo son 7h: si se topara en
        la jornada fichada, el cupo se consumiria de menos frente al portal."""
        with mock.patch.object(core, "PERMISOS", {}), \
             mock.patch.object(core, "guardar_config_valor", lambda *a: None):
            self.assertEqual(core.jornada_de(self.D_LUNES), 5)      # se fichan 5h
            self.assertEqual(core.horas_dia_permiso(), 7.0)         # el permiso, 7h
            core.anadir_permiso(self.LUNES, "asuntos_particulares", "7:00")
            self.assertEqual(core.horas_permiso(self.LUNES), 7.0)

    def test_desayuno_separa_lo_fichado_de_lo_oficial(self):
        """Con jornada fichada 6,5h y 0,5h de desayuno, un dia de permiso son 7h."""
        def cfg(c, d=None):
            return {"desayuno": 0.5}.get(c, d)
        with mock.patch.object(core, "config_valor", cfg), \
             mock.patch.object(core, "JORNADA_INV", 6.5):
            self.assertEqual(core.desayuno(), 0.5)
            self.assertEqual(core.horas_dia_permiso(), 7.0)

    def test_anadir_permiso_dia_entero_deja_objetivo_a_cero(self):
        with mock.patch.object(core, "NO_LABORABLES", {}), \
             mock.patch.object(core, "PERMISOS", {}), \
             mock.patch.object(core, "guardar_config_valor", lambda *a: None):
            core.anadir_permiso(self.LUNES, "asuntos_particulares", "5:00")
            self.assertEqual(core.objetivo_de(self.D_LUNES), 0)

    def test_quitar_permiso(self):
        with mock.patch.object(core, "PERMISOS",
                               {self.LUNES: [{"tipo": "conciliacion", "horas": 2.0}]}), \
             mock.patch.object(core, "guardar_config_valor", lambda *a: None):
            self.assertTrue(core.quitar_permiso(self.LUNES, 0))
            self.assertEqual(core.permisos_dia(self.LUNES), [])
            self.assertFalse(core.quitar_permiso(self.LUNES, 0))  # ya no hay

    def test_saldo_continuo_no_se_reinicia_en_enero(self):
        # Lo usado se cuenta desde que se lleva el saldo, NO por año natural: en
        # enero no "vuelven" las horas gastadas el año anterior.
        permisos = {
            "2025-05-05": [{"tipo": "asuntos_particulares", "horas": 10.0}],  # antes
            "2026-03-02": [{"tipo": "asuntos_particulares", "horas": 3.0}],
            "2026-04-01": [{"tipo": "asuntos_particulares", "horas": 2.0},
                           {"tipo": "conciliacion", "horas": 1.0}],
            "2027-01-12": [{"tipo": "asuntos_particulares", "horas": 4.0}],  # año sig.
        }
        with mock.patch.object(core, "PERMISOS", permisos), \
             mock.patch.object(core, "permisos_desde",
                               return_value=dt.date(2026, 1, 1)):
            self.assertEqual(core.permiso_usadas("asuntos_particulares"), 9.0)
            self.assertEqual(core.permiso_usadas("asuntos_particulares", 2026), 5.0)
            self.assertEqual(core.permiso_usadas("conciliacion"), 1.0)
            self.assertEqual(core.permiso_disponible("asuntos_particulares"), 61.0)
            self.assertEqual(core.permiso_disponible("no_existe"), 0.0)

    def test_resumen_permisos(self):
        with mock.patch.object(core, "PERMISOS",
                               {"2026-01-05": [{"tipo": "conciliacion", "horas": 4.0}]}), \
             mock.patch.object(core, "permisos_desde",
                               return_value=dt.date(2026, 1, 1)):
            filas = {f["id"]: f for f in core.resumen_permisos()}
        self.assertEqual(filas["conciliacion"]["usadas"], 4.0)
        self.assertEqual(filas["conciliacion"]["disponibles"], 26.0)   # 30 - 4
        self.assertEqual(filas["asuntos_particulares"]["disponibles"], 70.0)
        self.assertEqual(filas["asuntos_particulares"]["usadas"], 0.0)

    def _con(self, tipos):
        """Parchea el catalogo de tipos de permiso (saldo desde 2026-01-01)."""
        valores = {"permisos_tipos": tipos, "permisos_desde": "2026-01-01"}
        return mock.patch.object(
            core, "config_valor", lambda c, d=None: valores.get(c, d))

    def test_compat_modelo_viejo_de_cupo_unico(self):
        """Una config antigua con 'cupo' se lee como una unica concesion."""
        viejo = [{"id": "mio", "nombre": "El mío", "cupo": "10:30",
                  "fecha_limite": "2027-01-07"}]
        with self._con(viejo), mock.patch.object(core, "PERMISOS", {}):
            self.assertEqual(core.cupo_total("mio"), 10.5)     # "10:30" -> 10.5
            cs = core.concesiones("mio")
            self.assertEqual(cs, [{"horas": 10.5, "fecha_limite": "2027-01-07"}])
            self.assertEqual(core.resumen_permisos()[0]["cupo"], 10.5)

    def test_cupo_total_suma_las_concesiones(self):
        tipos = [{"id": "sm", "nombre": "Servicios mínimos", "concesiones": [
            {"horas": 28, "fecha_limite": "2027-01-07"},
            {"horas": 28, "fecha_limite": "2027-04-06"}]}]
        with self._con(tipos), mock.patch.object(
                core, "PERMISOS", {"2026-02-02": [{"tipo": "sm", "horas": 38.0}]}):
            self.assertEqual(core.cupo_total("sm"), 56.0)
            self.assertEqual(core.permiso_usadas("sm", 2026), 38.0)
            self.assertEqual(core.permiso_disponible("sm"), 18.0)  # como el portal

    def test_anadir_concesion_suma_horas(self):
        tipos = [{"id": "sm", "nombre": "SM", "concesiones": [{"horas": 28}]}]
        guardado = {}
        with self._con(tipos), \
             mock.patch.object(core, "guardar_config_valor",
                               lambda k, v: guardado.update({k: v})):
            core.anadir_concesion("sm", "28:00", "2027-04-06")
        cs = guardado["permisos_tipos"][0]["concesiones"]
        self.assertEqual([c["horas"] for c in cs], [28.0, 28.0])
        self.assertEqual(cs[1]["fecha_limite"], "2027-04-06")
        self.assertNotIn("cupo", guardado["permisos_tipos"][0])  # migrado

    def test_anadir_concesion_valida(self):
        with mock.patch.object(core, "guardar_config_valor", lambda *a: None):
            with self.assertRaises(ValueError):   # horas no positivas
                core.anadir_concesion("conciliacion", "0")
            with self.assertRaises(ValueError):   # fecha mal formada
                core.anadir_concesion("conciliacion", "5:00", "07/01/2027")
            with self.assertRaises(ValueError):   # tipo inexistente
                core.anadir_concesion("no_existe", "5:00")

    def test_quitar_concesion(self):
        tipos = [{"id": "sm", "nombre": "SM",
                  "concesiones": [{"horas": 28}, {"horas": 10}]}]
        guardado = {}
        with self._con(tipos), \
             mock.patch.object(core, "guardar_config_valor",
                               lambda k, v: guardado.update({k: v})):
            self.assertTrue(core.quitar_concesion("sm", 0))
            self.assertFalse(core.quitar_concesion("sm", 9))  # fuera de rango
        self.assertEqual([c["horas"] for c in guardado["permisos_tipos"][0]["concesiones"]],
                         [10.0])

    def test_caducidad_avisa_pero_no_descuenta(self):
        hoy = dt.date(2026, 7, 10)
        tipos = [{"id": "sm", "nombre": "SM", "concesiones": [
            {"horas": 10, "fecha_limite": "2026-01-01"},   # ya caducada
            {"horas": 20, "fecha_limite": "2026-07-20"},   # caduca en 10 dias
            {"horas": 30, "fecha_limite": "2027-12-31"},   # lejana
            {"horas": 5,  "fecha_limite": ""}]}]           # sin caducidad
        with self._con(tipos), mock.patch.object(core, "PERMISOS", {}):
            self.assertEqual([c["horas"] for c in core.concesiones_caducadas("sm", hoy)],
                             [10.0])
            self.assertEqual([c["horas"] for c in
                              core.concesiones_por_caducar("sm", hoy=hoy)], [20.0])
            # la caducada SIGUE sumando: solo avisamos
            self.assertEqual(core.cupo_total("sm"), 65.0)
            self.assertEqual(core.permiso_disponible("sm"), 65.0)


class TestPermisosPorActividad(unittest.TestCase):
    """Servicios donde el permiso se imputa como ACTIVIDAD de una tarea en
    ProyectosTic (no se marca en local): esas horas tambien gastan el saldo."""

    TIPOS = [{"id": "ap", "nombre": "Asuntos propios", "actividad": "Asuntos propios",
              "concesiones": [{"horas": 70, "fecha_limite": ""}]},
             {"id": "conc", "nombre": "Conciliación",
              "concesiones": [{"horas": 30, "fecha_limite": ""}]}]

    def setUp(self):
        valores = {"permisos_tipos": self.TIPOS, "permisos_desde": "2026-01-01"}
        for parche in (
                mock.patch.object(core, "config_valor",
                                  lambda c, d=None: valores.get(c, d)),
                mock.patch.object(core, "PERMISOS",
                                  {"2026-02-02": [{"tipo": "ap", "horas": 2.0}]}),
                mock.patch.dict(core._USADAS_PT, {}, clear=True)):
            parche.start()
            self.addCleanup(parche.stop)

    def test_suma_lo_imputado_con_la_actividad(self):
        apuntes = [{"horas": 1.0, "actividad": "Asuntos propios"},
                   {"horas": 3.5, "actividad": "asuntos propios "},  # sin distinguir
                   {"horas": 7.0, "actividad": "Soporte"}]          # no cuenta
        with mock.patch.object(core, "entradas_rango",
                               return_value=apuntes) as m_rango:
            self.assertEqual(core.actualizar_usadas_proyectostic(), {"ap": 4.5})
        desde, hasta = m_rango.call_args.args
        self.assertEqual(desde, "2026-01-01")
        self.assertTrue(hasta.endswith("-12-31"))
        self.assertEqual(core.permiso_usadas_total("ap"), 6.5)     # 2 local + 4,5
        self.assertEqual(core.permiso_disponible("ap"), 63.5)
        fila = {f["id"]: f for f in core.resumen_permisos()}["ap"]
        self.assertEqual((fila["usadas_local"], fila["usadas_pt"]), (2.0, 4.5))
        # un tipo sin actividad no consulta ni suma nada de ProyectosTic
        self.assertEqual(core.permiso_usadas_proyectostic("conc"), 0.0)

    def test_sin_actividades_enlazadas_no_hay_red(self):
        sin = [dict(t, actividad="") for t in self.TIPOS]
        with mock.patch.object(core, "permisos_tipos", lambda: sin), \
             mock.patch.object(core, "entradas_rango") as m_rango:
            self.assertEqual(core.actualizar_usadas_proyectostic(), {})
        m_rango.assert_not_called()

    def test_entradas_rango_filtra_por_usuario_y_fechas(self):
        elem = {"id": 1, "hours": "PT1H", "spentOn": "2026-03-04",
                "_links": {"activity": {"title": "Asuntos propios"}}}
        with mock.patch.object(core, "_user_id", return_value="42"), \
             mock.patch.object(core, "_get_todos", return_value=[elem]) as m_todos:
            out = core.entradas_rango("2026-01-01", "2027-12-31")
        filtros = json.loads(m_todos.call_args.args[1]["filters"])
        self.assertIn({"spent_on": {"operator": "<>d",
                                    "values": ["2026-01-01", "2027-12-31"]}}, filtros)
        self.assertIn({"user": {"operator": "=", "values": ["42"]}}, filtros)
        self.assertEqual((out[0]["fecha"], out[0]["horas"]), ("2026-03-04", 1.0))
        with mock.patch.object(core, "_user_id", return_value=""), \
             mock.patch.object(core, "_get_todos") as m_todos:
            with self.assertRaises(RuntimeError):
                core.entradas_rango("2026-01-01", "2026-12-31")
        m_todos.assert_not_called()

    def test_fijar_actividad_conserva_las_concesiones(self):
        guardado = {}
        with mock.patch.object(core, "guardar_config_valor",
                               lambda k, v: guardado.update({k: v})):
            core.fijar_actividad_permiso("conc", "Conciliación familiar")
        tipos = {t["id"]: t for t in guardado["permisos_tipos"]}
        self.assertEqual(tipos["conc"]["actividad"], "Conciliación familiar")
        self.assertEqual(tipos["conc"]["concesiones"], [{"horas": 30.0, "fecha_limite": ""}])
        self.assertEqual(tipos["ap"]["actividad"], "Asuntos propios")   # intacto
        with mock.patch.object(core, "guardar_config_valor",
                               lambda k, v: guardado.update({k: v})):
            core.fijar_actividad_permiso("ap", "")                       # quitar
        self.assertNotIn("actividad", {t["id"]: t for t in guardado["permisos_tipos"]}["ap"])


class TestPermisosAnioNuevo(unittest.TestCase):
    def _cfg(self, valores):
        guardado = dict(valores)
        return guardado, (
            mock.patch.object(core, "config_valor",
                              lambda c, d=None: guardado.get(c, d)),
            mock.patch.object(core, "guardar_config_valores", guardado.update),
            mock.patch.object(core, "guardar_config_valor",
                              lambda k, v: guardado.update({k: v})))

    def test_primer_arranque_no_pregunta_a_mitad_de_año(self):
        guardado, parches = self._cfg({})
        with parches[0], parches[1], parches[2]:
            core.inicializar_permisos_anuales(hoy=dt.date(2026, 10, 27))
            self.assertEqual(guardado["permisos_desde"], "2026-01-01")
            self.assertEqual(guardado["permisos_anio_revisado"], 2026)
            self.assertFalse(core.toca_anadir_permisos_del_anio(dt.date(2026, 12, 31)))
            self.assertTrue(core.toca_anadir_permisos_del_anio(dt.date(2027, 1, 1)))
            # y no pisa lo que ya hubiera
            core.inicializar_permisos_anuales(hoy=dt.date(2027, 1, 1))
            self.assertEqual(guardado["permisos_desde"], "2026-01-01")
            core.marcar_permisos_anio_revisado(2027)
            self.assertFalse(core.toca_anadir_permisos_del_anio(dt.date(2027, 1, 1)))

    def test_propuesta_repite_la_ultima_concesion_un_año_despues(self):
        tipos = [{"id": "ap", "nombre": "AP", "concesiones": [
                    {"horas": 35, "fecha_limite": "2026-06-30"},
                    {"horas": 70, "fecha_limite": "2027-01-15"}]},
                 {"id": "x", "nombre": "X", "concesiones": [
                    {"horas": 5, "fecha_limite": "2028-02-29"}]},
                 {"id": "vacio", "nombre": "V", "concesiones": []}]
        _g, parches = self._cfg({"permisos_tipos": tipos})
        with parches[0]:
            prop = {p["id"]: p for p in core.propuesta_permisos_del_anio()}
        self.assertEqual((prop["ap"]["horas"], prop["ap"]["fecha_limite"]),
                         (70.0, "2028-01-15"))
        self.assertEqual(prop["x"]["fecha_limite"], "2029-02-28")    # bisiesto
        self.assertEqual((prop["vacio"]["horas"], prop["vacio"]["fecha_limite"]),
                         (0.0, ""))


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

    def test_traslados_de_domingo_a_lunes(self):
        # 2026: Todos los Santos (dom 01/11) y La Constitución (dom 06/12)
        # se trasladan al lunes, como hacía la tabla fija que se sustituyó.
        f = core.festivos_del_anio(2026)
        self.assertEqual(f["2026-11-02"][0], "Todos los Santos (traslado)")
        self.assertEqual(f["2026-12-07"][0], "La Constitución (traslado)")
        self.assertNotIn("2026-11-01", f)   # la fecha canónica no se duplica
        self.assertNotIn("2026-12-06", f)
        # 2027: Día de Andalucía cae en domingo 28/02 -> lunes 01/03
        f27 = core.festivos_del_anio(2027)
        self.assertEqual(f27["2027-03-01"][0], "Día de Andalucía (traslado)")

    def test_festivos_pendientes_salta_finde_y_marcados(self):
        # _hoy fijado: sin él, el test dependería del reloj real y fallaría
        # a partir de enero de 2027 (el catálogo cubre el año en curso).
        with mock.patch.object(core, "_hoy", lambda: dt.date(2026, 7, 6)), \
             mock.patch.object(core, "NO_LABORABLES", {"2026-12-25": "Navidad"}):
            pend = core.festivos_pendientes(ambitos=("nacional",), incluir_ugr=False)
        self.assertNotIn("2026-12-25", pend)          # ya marcado
        self.assertNotIn("2026-02-28", pend)          # sabado (y ambito fuera)
        self.assertIn("2026-01-06", pend)             # Reyes, laborable, sin marcar
        self.assertNotIn("2027-01-06", pend)          # en julio no se ofrece 2027

    def test_festivos_pendientes_incluye_el_anio_siguiente_en_noviembre(self):
        with mock.patch.object(core, "_hoy", lambda: dt.date(2026, 11, 15)), \
             mock.patch.object(core, "NO_LABORABLES", {}):
            pend = core.festivos_pendientes(ambitos=("nacional",), incluir_ugr=False)
        self.assertIn("2027-01-06", pend)             # enero preparado

    def test_importar_festivos_idempotente(self):
        with mock.patch.object(core, "_hoy", lambda: dt.date(2026, 7, 6)), \
             mock.patch.object(core, "NO_LABORABLES", {}), \
             mock.patch.object(core, "guardar_config_valor") as m_g:
            n = core.importar_festivos(ambitos=("nacional",), incluir_ugr=False)
            self.assertGreater(n, 0)
            self.assertTrue(core.es_no_laborable("2026-12-25"))
            self.assertFalse(core.es_no_laborable("2026-02-28"))  # sabado
            # idempotente: la segunda vez no hay nada que importar
            self.assertEqual(core.importar_festivos(("nacional",), False), 0)
            m_g.assert_called_once()

    def test_no_pisa_marcas_del_usuario(self):
        with mock.patch.object(core, "_hoy", lambda: dt.date(2026, 7, 6)), \
             mock.patch.object(core, "NO_LABORABLES",
                               {"2026-12-25": "vacaciones"}), \
             mock.patch.object(core, "guardar_config_valor"):
            core.importar_festivos(("nacional",), False)
            self.assertEqual(core.motivo_no_laborable("2026-12-25"), "vacaciones")

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


class TestFranjas(unittest.TestCase):
    def test_parsear_hora(self):
        self.assertEqual(core.parsear_hora("09:30"), 570)
        self.assertEqual(core.parsear_hora("9:5"), 545)
        self.assertIsNone(core.parsear_hora("25:00"))
        self.assertIsNone(core.parsear_hora("09:70"))
        self.assertIsNone(core.parsear_hora("nueve"))
        self.assertIsNone(core.parsear_hora(""))

    def test_duracion_horas(self):
        self.assertEqual(core.duracion_horas("09:00", "10:30"), 1.5)
        self.assertEqual(core.duracion_horas("08:00", "13:00"), 5.0)
        self.assertIsNone(core.duracion_horas("10:00", "09:00"))  # fin <= inicio
        self.assertIsNone(core.duracion_horas("10:00", "10:00"))
        self.assertIsNone(core.duracion_horas("x", "10:00"))

    def test_validar_franjas_ok(self):
        self.assertEqual(core.validar_franjas([("09:00", "10:30"),
                                               ("11:00", "13:00")]), [])

    def test_validar_franjas_solape(self):
        probs = core.validar_franjas([("09:00", "11:00"), ("10:30", "12:00")])
        self.assertEqual(len(probs), 1)
        self.assertIn("solapan", probs[0])

    def test_validar_franjas_formato_y_orden(self):
        probs = core.validar_franjas([("09:00", "08:00"), ("aa", "10:00")])
        self.assertEqual(len(probs), 2)

    def test_validar_franjas_adyacentes_no_solapan(self):
        # fin de una == inicio de la siguiente: valido
        self.assertEqual(core.validar_franjas([("09:00", "10:00"),
                                               ("10:00", "11:00")]), [])


class TestParseoNumeros(unittest.TestCase):
    def test_parsear_numero(self):
        import configurar
        self.assertEqual(configurar.parsear_numero("4,5"), 4.5)
        self.assertEqual(configurar.parsear_numero("4.5"), 4.5)
        self.assertEqual(configurar.parsear_numero("7"), 7)
        self.assertIsNone(configurar.parsear_numero("abc"))
        # NaN esquivaba los checks de rango y reventaba en int(); inf igual
        self.assertIsNone(configurar.parsear_numero("nan"))
        self.assertIsNone(configurar.parsear_numero("inf"))
        self.assertIsNone(configurar.parsear_numero("-inf"))
        self.assertIsNone(configurar.parsear_numero(None))

    def test_num_jornada_delega_y_limita(self):
        import configurar_gui as wiz2
        self.assertEqual(wiz2._num_jornada("4,5"), 4.5)
        self.assertIsNone(wiz2._num_jornada("0"))
        self.assertIsNone(wiz2._num_jornada("25"))
        self.assertIsNone(wiz2._num_jornada("nan"))


class TestConfigPersistente(unittest.TestCase):
    def test_guardar_config_valores_en_lote(self):
        core.guardar_config_valores({"clave_a": 1, "clave_b": 2})
        try:
            with open(core.CONFIG_PATH, encoding="utf-8") as fh:
                cfg = json.load(fh)
            self.assertEqual((cfg["clave_a"], cfg["clave_b"]), (1, 2))
            self.assertEqual(cfg["api_key"], "clave-de-prueba")  # intacta
        finally:
            with open(core.CONFIG_PATH, encoding="utf-8") as fh:
                cfg = json.load(fh)
            cfg.pop("clave_a", None)
            cfg.pop("clave_b", None)
            with open(core.CONFIG_PATH, "w", encoding="utf-8") as fh:
                json.dump(cfg, fh)

    def test_configurador_consola_no_borra_el_resto(self):
        # El asistente de consola solo pregunta conexion/jornada/favoritas;
        # guardar NO puede tirar los festivos, permisos, plantillas...
        import configurar
        ruta = os.path.join(_TMP, "config_consola.json")
        with open(ruta, "w", encoding="utf-8") as fh:
            json.dump({"api_key": "vieja", "no_laborables": {"2026-12-08": "festivo"},
                       "plantillas": [{"nombre": "p", "apuntes": []}]}, fh)
        with mock.patch.object(configurar, "CONFIG_PATH", ruta),              mock.patch.object(configurar, "escribir_lanzador", return_value=None),              mock.patch("builtins.print"):
            configurar.guardar({"api_key": "nueva", "favoritos": []})
        with open(ruta, encoding="utf-8") as fh:
            cfg = json.load(fh)
        self.assertEqual(cfg["api_key"], "nueva")
        self.assertEqual(cfg["no_laborables"], {"2026-12-08": "festivo"})
        self.assertEqual(cfg["plantillas"], [{"nombre": "p", "apuntes": []}])

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
