#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests del prototipo web (registrar_web.Api): lo que el HTML recibe y lo que
pasa al pulsar. Sin pywebview ni red: el motor va mockeado."""

import datetime as dt
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import test_fichacsirc  # noqa: F401  (fija FICHACSIRC_CONFIG e importa core)
import rellenar_horas as core      # noqa: E402
import registrar_web as web        # noqa: E402

LUNES = dt.date(2026, 10, 26)          # invierno: jornada 7 h en la config de test
L, M, X = (LUNES + dt.timedelta(days=i) for i in range(3))


def apunte(id_, horas, wp="10", act="soporte", com=""):
    return {"id": id_, "wp_id": wp, "horas": horas, "wp_titulo": f"Tarea {wp}",
            "comentario": com, "actividad": act}


class Base(unittest.TestCase):
    def setUp(self):
        for p in (mock.patch.object(core, "NO_LABORABLES", {}),
                  mock.patch.object(core, "PERMISOS", {}),
                  mock.patch.object(core, "GUARDIAS", set()),
                  mock.patch.object(core, "TELETRABAJO", set()),
                  mock.patch.object(web.destinos, "configurado", lambda: False)):
            p.start()
            self.addCleanup(p.stop)
        self.api = web.Api()


class TestEstadoDia(Base):
    def test_estados(self):
        e = web.estado_dia
        self.assertEqual(e(L, [apunte(1, 7)])["estado"], "completo")
        self.assertEqual(e(L, [apunte(1, 3)])["estado"], "parcial")
        self.assertEqual(e(L, [])["estado"], "vacio")
        self.assertEqual(e(L, [apunte(1, 8)])["estado"], "pasado")
        self.assertEqual(e(L, None)["estado"], "error")
        self.assertEqual(e(L, [])["texto"], "0h / 7h")          # sin "7.0h"
        p = e(L, [apunte(1, 3)])
        self.assertEqual((p["reg"], p["falta"], p["frac"]), (3, 4, round(3 / 7, 3)))

    def test_no_laborable_vacaciones_y_permiso(self):
        core.NO_LABORABLES[L.isoformat()] = "festivo"
        core.NO_LABORABLES[M.isoformat()] = core.MOTIVO_VACACIONES
        core.PERMISOS[X.isoformat()] = [{"tipo": "asuntos_particulares", "horas": 7.0}]
        self.assertEqual(web.estado_dia(L, [])["estado"], "nolab")
        self.assertEqual(web.estado_dia(M, [])["estado"], "vacaciones")
        x = web.estado_dia(X, [])
        self.assertEqual((x["estado"], x["permiso"]), ("permiso", "7:00"))

    def test_apuntes_serializables(self):
        a = web.estado_dia(L, [apunte(5, 2.5, com="<b>hola</b>")])["apuntes"][0]
        self.assertEqual((a["id"], a["horas_txt"], a["comentario"]),
                         ("5", "2.5h", "<b>hola</b>"))   # el JS lo pinta como texto


class TestSemana(Base):
    def test_semana_y_conexion(self):
        datos = {L.isoformat(): [apunte(1, 7)], M.isoformat(): [apunte(2, 2)]}
        with mock.patch.object(core, "entradas_dia", lambda iso: datos.get(iso, [])):
            s = self.api.semana(L.isoformat())
        self.assertEqual(len(s["dias"]), 5)
        self.assertEqual(s["conexion"], "ok")
        self.assertEqual(s["total"], "9h / 35h")
        self.assertTrue(s["titulo"].startswith("Semana 26/10/2026"))

        def falla_martes(iso):
            if iso == M.isoformat():
                raise RuntimeError("red")
            return []
        with mock.patch.object(core, "entradas_dia", falla_martes):
            s = self.api.semana(L.isoformat())
        self.assertEqual(s["conexion"], "warn")
        self.assertEqual(s["dias"][1]["estado"], "error")
        with mock.patch.object(core, "entradas_dia", side_effect=RuntimeError("red")):
            self.assertEqual(self.api.semana(L.isoformat())["conexion"], "error")


class TestAnadir(Base):
    def _semana(self, datos):
        with mock.patch.object(core, "entradas_dia", lambda iso: datos.get(iso, [])):
            self.api.semana(L.isoformat())

    def test_comprobar_valida_horas_y_dias(self):
        self.assertIn("error", self.api.comprobar([L.isoformat()], 10, "abc"))
        self.assertIn("error", self.api.comprobar([L.isoformat()], 10, "0"))
        self.assertIn("error", self.api.comprobar([], 10, "2"))
        self.assertEqual(self.api.comprobar([L.isoformat()], 10, "2,5"), {"avisos": []})

    def test_comprobar_avisos(self):
        self._semana({L.isoformat(): [apunte(1, 6, wp="10")]})
        self.api._cache[M.isoformat()] = None                    # no se pudo leer
        core.NO_LABORABLES[X.isoformat()] = "festivo"
        claves = [a["clave"] for a in self.api.comprobar(
            [L.isoformat(), M.isoformat(), X.isoformat()], 10, "2")["avisos"]]
        self.assertEqual(claves, ["sin_leer", "nolab", "repetir", "exceso"])

    def test_anadir_respeta_no_repetir_y_guardia(self):
        self._semana({L.isoformat(): [apunte(1, 2, wp="10")]})
        core.GUARDIAS.add(M.isoformat())
        creados = []
        with mock.patch.object(core, "crear_entrada",
                               lambda *a: creados.append(a)), \
             mock.patch.object(core, "guardar_config_valores"):
            r = self.api.anadir([L.isoformat(), M.isoformat(), X.isoformat()], "10", "1,5",
                                core.comentario_guardia(), "soporte", False)
        self.assertEqual((r["creados"], r["saltados"]), (2, 1))   # lunes saltado
        por_dia = {c[0]: c[3] for c in creados}
        self.assertEqual(por_dia[M.isoformat()], core.comentario_guardia())
        self.assertEqual(por_dia[X.isoformat()], "")   # el autorrelleno de guardia no
        self.assertEqual(creados[0][2], 1.5)

    def test_error_al_crear_se_cuenta(self):
        with mock.patch.object(core, "crear_entrada", side_effect=RuntimeError("403")):
            r = self.api.anadir([L.isoformat()], "10", "1", "", "soporte")
        self.assertEqual((r["creados"], r["errores"], r["ultimo"]), (0, 1, "403"))


class TestBorrarYMarcas(Base):
    def test_eliminar_y_deshacer(self):
        with mock.patch.object(core, "entradas_dia",
                               lambda iso: [apunte(7, 2, com="c")] if iso == L.isoformat() else []):
            self.api.semana(L.isoformat())
        with mock.patch.object(core, "eliminar_entrada") as m_del:
            r = self.api.eliminar([{"id": "7", "fecha": L.isoformat(), "destino": "op"}])
        m_del.assert_called_once_with("7")
        self.assertEqual((r["eliminados"], r["puede_deshacer"]), (1, True))
        creados = []
        with mock.patch.object(core, "crear_entrada", lambda *a: creados.append(a)):
            self.assertEqual(self.api.deshacer()["restaurados"], 1)
        self.assertEqual(creados, [(L.isoformat(), "10", 2, "c", "soporte")])
        self.assertEqual(self.api.deshacer()["restaurados"], 0)   # solo una vez

    def test_borrar_slot_inari_no_va_a_proyectostic(self):
        with mock.patch.object(web.destinos, "borrar") as m_inari, \
             mock.patch.object(core, "eliminar_entrada") as m_op:
            r = self.api.eliminar([{"id": "100", "fecha": L.isoformat(), "destino": "inari"}])
        m_inari.assert_called_once_with("100")
        m_op.assert_not_called()
        self.assertEqual((r["eliminados"], r["puede_deshacer"]), (1, False))

    def test_accion_dia(self):
        iso = L.isoformat()
        with mock.patch.object(core, "guardar_config_valor"):
            self.api.accion_dia(iso, "no_laborable", "vacaciones")
            self.assertTrue(core.es_vacaciones(iso))
            self.api.accion_dia(iso, "quitar_no_laborable")
            self.api.accion_dia(iso, "guardia")
            self.api.accion_dia(iso, "teletrabajo")
            self.assertTrue(core.es_guardia(iso) and core.es_teletrabajo(iso))
            self.assertFalse(core.es_no_laborable(iso))
            self.assertIn("error", self.api.accion_dia(iso, "borrar_todo"))


class TestConfigExperimento(unittest.TestCase):
    def test_copia_la_real_una_vez_y_no_la_pisa(self):
        tmp = tempfile.mkdtemp(prefix="fichacsirc_web_")
        real = os.path.join(tmp, "FichaCSIRC")
        os.makedirs(real)
        with open(os.path.join(real, "config.json"), "w", encoding="utf-8") as f:
            f.write('{"api_key": "real"}')
        carpetas = lambda nombre: os.path.join(tmp, nombre)
        entorno = {k: v for k, v in os.environ.items() if k != "FICHACSIRC_CONFIG"}
        with mock.patch.dict(os.environ, entorno, clear=True), \
             mock.patch.object(web, "_carpeta_config", carpetas):
            ruta = web.preparar_config_experimento()
            self.assertEqual(ruta, os.path.join(tmp, "FichaCSIRC-experimento", "config.json"))
            self.assertEqual(os.environ["FICHACSIRC_CONFIG"], ruta)
            with open(ruta, encoding="utf-8") as f:
                self.assertIn("real", f.read())
            # lo tocado en el experimento no se pisa al volver a arrancar
            with open(ruta, "w", encoding="utf-8") as f:
                f.write('{"api_key": "experimento"}')
            del os.environ["FICHACSIRC_CONFIG"]
            web.preparar_config_experimento()
            with open(ruta, encoding="utf-8") as f:
                self.assertIn("experimento", f.read())
        # y la real sigue intacta
        with open(os.path.join(real, "config.json"), encoding="utf-8") as f:
            self.assertIn("real", f.read())


class TestFicherosWeb(unittest.TestCase):
    RAIZ = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")

    def test_existen_y_estan_enlazados(self):
        with open(os.path.join(self.RAIZ, "index.html"), encoding="utf-8") as f:
            html = f.read()
        for fichero in ("app.css", "app.js", "demo.js"):
            self.assertIn(fichero, html)
            self.assertTrue(os.path.exists(os.path.join(self.RAIZ, fichero)), fichero)
        self.assertNotIn("http", html.replace("http-equiv", ""))   # sin CDN: va sin red

    def test_el_js_no_usa_innerhtml(self):
        # Todo el texto de los datos se pinta con textContent: un comentario con
        # "<" no debe poder inyectar HTML en la ventana.
        for fichero in ("app.js", "demo.js"):
            with open(os.path.join(self.RAIZ, fichero), encoding="utf-8") as f:
                codigo = "\n".join(l for l in f.read().splitlines()
                                   if not l.strip().startswith(("*", "/*", "//")))
            self.assertNotIn("innerHTML", codigo, fichero)
            self.assertNotIn("insertAdjacentHTML", codigo, fichero)

    def test_la_api_expone_lo_que_usa_el_js(self):
        import re
        with open(os.path.join(self.RAIZ, "app.js"), encoding="utf-8") as f:
            usados = set(re.findall(r'llamar\("(\w+)"', f.read()))
        self.assertTrue(usados)
        for metodo in usados:
            self.assertTrue(callable(getattr(web.Api, metodo, None)), metodo)
            self.assertFalse(metodo.startswith("_"), metodo)


if __name__ == "__main__":
    unittest.main()
