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


class TestDialogos(Base):
    def _semana(self, datos):
        with mock.patch.object(core, "entradas_dia", lambda iso: datos.get(iso, [])):
            self.api.semana(L.isoformat())

    def test_editar(self):
        self._semana({L.isoformat(): [apunte(7, 2, wp="10")]})
        with mock.patch.object(core, "actualizar_entrada") as m_upd:
            self.assertEqual(self.api.editar(L.isoformat(), "7", "3,5", " c ", "soporte"), {"ok": True})
        m_upd.assert_called_once_with("7", 3.5, "c", "soporte", "10")
        self.assertIn("error", self.api.editar(L.isoformat(), "7", "25", "", ""))
        self.assertIn("error", self.api.editar(L.isoformat(), "99", "1", "", ""))

    def test_asociar_en_los_dos_sentidos(self):
        guardado = {}
        with mock.patch.object(core, "config_valor", lambda c, d=None: guardado.get(c, d)), \
             mock.patch.object(core, "guardar_config_valores", guardado.update):
            self.assertEqual(self.api.asociar(13001, "Asuntos propios"), {"Asuntos propios": 13001})
            self.assertEqual(guardado["actividades_tarea"], {"13001": "Asuntos propios"})
            self.assertEqual(self.api.desasociar("Asuntos propios"), {})
            self.assertEqual(guardado["actividades_tarea"], {})

    def test_copia_de_dia_salta_lo_que_no_se_pudo_leer_y_lo_repetido(self):
        self._semana({L.isoformat(): [apunte(1, 2, wp="10")]})
        self.api._cache[M.isoformat()] = None
        origen = [apunte(5, 2, wp="10"), apunte(6, 3, wp="20")]
        anterior = (L - dt.timedelta(days=3)).isoformat()   # viernes de la semana pasada
        with mock.patch.object(core, "entradas_dia",
                               lambda iso: origen if iso == anterior else []):
            prev = self.api.preparar_copia_dia([L.isoformat(), M.isoformat(), X.isoformat()])
        self.assertEqual((prev["n"], prev["dias"]), (2, 3))
        self.assertTrue(prev["origen"].startswith("Viernes"))
        creados = []
        with mock.patch.object(core, "crear_entrada", lambda iso, *a: creados.append((iso, a[0]))):
            r = self.api.ejecutar_copia()
        # lunes: solo la 20 (la 10 ya estaba); martes: saltado; miercoles: las dos
        self.assertEqual(sorted(creados), [(L.isoformat(), "20"), (X.isoformat(), "10"),
                                           (X.isoformat(), "20")])
        self.assertEqual((r["saltados"], r["errores"]), (1, 2))
        self.assertIn("error", self.api.ejecutar_copia())   # solo una vez

    def test_plantillas(self):
        self._semana({L.isoformat(): [apunte(1, 5, wp="10"), apunte(2, 2, wp="20")]})
        with mock.patch.object(core, "PLANTILLAS", []), \
             mock.patch.object(core, "guardar_config_valor"):
            self.assertEqual(self.api.guardar_plantilla_dia(L.isoformat(), "Tipo"), {"ok": True, "n": 2})
            self.assertEqual(self.api.plantillas(), [{"nombre": "Tipo", "n": 2, "total": "7h"}])
            self.assertIn("error", self.api.guardar_plantilla_dia(M.isoformat(), "Vacio"))
            creados = []
            with mock.patch.object(core, "crear_entrada", lambda iso, *a: creados.append(iso)):
                r = self.api.aplicar_plantilla("Tipo", [M.isoformat()])
            self.assertEqual((r["creados"], creados), (2, [M.isoformat()] * 2))
            self.assertEqual(self.api.eliminar_plantilla("Tipo"), [])

    def test_resumen_mes_con_una_sola_consulta(self):
        apuntes = [dict(apunte(1, 7), fecha="2026-10-01"), dict(apunte(2, 3), fecha="2026-10-02")]
        with mock.patch.object(core, "entradas_rango", return_value=apuntes) as m_rango, \
             mock.patch.object(core, "entradas_dia") as m_dia, \
             mock.patch.object(web.dt, "date", wraps=dt.date) as m_date:
            m_date.today.return_value = dt.date(2026, 10, 2)
            r = self.api.resumen_mes(2026, 10)
        m_rango.assert_called_once_with("2026-10-01", "2026-10-31")
        m_dia.assert_not_called()
        self.assertEqual((r["registrado"], r["objetivo_hoy"]), ("10h", "14h"))
        self.assertFalse(r["al_dia"])
        self.assertEqual([x["iso"] for x in r["incompletos"]], ["2026-10-02"])
        self.assertEqual(r["titulo"], "Octubre 2026")

    def test_exportar_csv_con_coma_decimal(self):
        ruta = os.path.join(tempfile.mkdtemp(prefix="fichacsirc_csv_"), "h.csv")
        apuntes = [dict(apunte(1, 6.5, com="x"), fecha="2026-10-02"),
                   dict(apunte(2, 1, act="formacion"), fecha="2026-10-01")]
        with mock.patch.object(core, "entradas_rango", return_value=apuntes), \
             mock.patch.object(self.api, "_pedir_ruta", return_value=ruta):
            r = self.api.exportar_csv("2026-10-31", "2026-10-01")   # al reves: se ordena
        self.assertEqual((r["n"], r["total"]), (2, "7.5h"))
        with open(ruta, encoding="utf-8-sig") as f:
            lineas = f.read().splitlines()
        self.assertEqual(lineas[1].split(";")[:2], ["2026-10-01", "1"])
        self.assertEqual(lineas[2].split(";")[:2], ["2026-10-02", "6,5"])
        self.assertEqual(lineas[-1], ";7,5;TOTAL")
        with mock.patch.object(core, "entradas_rango", return_value=apuntes), \
             mock.patch.object(self.api, "_pedir_ruta", return_value=None):
            self.assertEqual(self.api.exportar_csv("2026-10-01", "2026-10-31"), {"cancelado": True})

    def test_abrir_exportacion_solo_la_ultima(self):
        self.assertIn("error", self.api.abrir_exportacion())     # nada exportado aun

    def test_ajustes_dias_validan(self):
        with mock.patch.object(core, "guardar_config_valores") as m_g:
            self.assertIn("error", self.api.guardar_ajustes_dias("99", "1"))
            self.assertIn("error", self.api.guardar_ajustes_dias("x", "1"))
            m_g.assert_not_called()
            self.assertEqual(self.api.guardar_ajustes_dias("23", "2"), {"ok": True})
        m_g.assert_called_once_with({"cupo_vacaciones": 23, "teletrabajo_por_semana": 2})

    def test_permiso_dia_pide_confirmar_sin_saldo(self):
        with mock.patch.object(core, "permiso_disponible", return_value=1.0), \
             mock.patch.object(core, "anadir_permiso") as m_add:
            r = self.api.anadir_permiso(L.isoformat(), "asuntos_particulares", "3:00")
            self.assertIn("confirmar", r)
            m_add.assert_not_called()
            r = self.api.anadir_permiso(L.isoformat(), "asuntos_particulares", "3:00", True)
        self.assertEqual(r, {"ok": True, "horas": "3:00"})
        m_add.assert_called_once_with(L.isoformat(), "asuntos_particulares", 3.0)
        self.assertIn("error", self.api.anadir_permiso(L.isoformat(), "x", "abc"))

    def test_permisos_del_anio_todo_o_nada(self):
        with mock.patch.object(core, "anadir_concesion") as m_add, \
             mock.patch.object(core, "marcar_permisos_anio_revisado") as m_rev:
            r = self.api.anadir_permisos_anio([
                {"id": "ap", "nombre": "AP", "horas": "70:00", "fecha_limite": "2028-01-15"},
                {"id": "sm", "nombre": "SM", "horas": "28", "fecha_limite": "15/01/2028"}])
            self.assertIn("error", r)
            m_add.assert_not_called()                  # la mala fecha no deja guardar nada
            m_rev.assert_not_called()
            r = self.api.anadir_permisos_anio([
                {"id": "ap", "nombre": "AP", "horas": "70:00", "fecha_limite": "2028-01-15"},
                {"id": "sm", "nombre": "SM", "horas": "", "fecha_limite": ""}])
        self.assertEqual(r, {"n": 1})
        m_add.assert_called_once_with("ap", 70.0, "2028-01-15")
        m_rev.assert_called_once()

    def test_inari_el_token_no_vuelve_al_js(self):
        guardado = {"inari_token": "secreto", "inari_usuario": "ana"}
        with mock.patch.object(core, "config_valor", lambda c, d=None: guardado.get(c, d)):
            c = self.api.inari_config()
            self.assertNotIn("secreto", str(c))
            self.assertTrue(c["hay_token"])
            # campo de token vacio -> se usa el guardado
            self.assertEqual(self.api._inari_creds("u", "ana", "")[2], "secreto")
            # "usuario:token" pegado en Usuario se separa
            self.assertEqual(self.api._inari_creds("u", "pepe:otro", ""), ("u", "pepe", "otro"))

    def test_novedades_junta_lineas(self):
        bloques = self.api.novedades()
        # la primera version listada es la que se esta ejecutando (si no, se
        # ha olvidado la entrada de NOVEDADES.md al subir la version)
        primera = next(b for b in bloques if b["estilo"] == "version")
        self.assertEqual(primera["texto"], f"Versión {core.VERSION}")
        self.assertTrue(any(b["estilo"] == "punto" for b in bloques))
        self.assertTrue(all("**" not in b["texto"] for b in bloques))

    def test_abrir_github_solo_el_repo(self):
        with mock.patch.object(web.webbrowser, "open") as m_open:
            self.api.abrir_github("releases")
            self.api.abrir_github("../../otra-cosa")
        m_open.assert_called_once_with(f"https://github.com/{core.GITHUB_REPO}/releases")


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
        for fichero in ("app.js", "dialogos.js", "demo.js"):
            with open(os.path.join(self.RAIZ, fichero), encoding="utf-8") as f:
                codigo = "\n".join(l for l in f.read().splitlines()
                                   if not l.strip().startswith(("*", "/*", "//")))
            self.assertNotIn("innerHTML", codigo, fichero)
            self.assertNotIn("insertAdjacentHTML", codigo, fichero)

    def test_la_api_expone_lo_que_usa_el_js(self):
        # Un nombre mal escrito en el JS solo fallaria al pulsar ese boton.
        import re
        usados = set()
        for fichero in ("app.js", "dialogos.js"):
            with open(os.path.join(self.RAIZ, fichero), encoding="utf-8") as f:
                codigo = f.read()
            usados |= set(re.findall(r'llamar\("(\w+)"', codigo))
            usados |= set(re.findall(r'api\(\)\.(\w+)\(', codigo))
        self.assertGreater(len(usados), 30)
        for metodo in usados:
            self.assertTrue(callable(getattr(web.Api, metodo, None)), metodo)
            self.assertFalse(metodo.startswith("_"), metodo)

    def test_la_demo_imita_toda_la_api_que_usa_el_js(self):
        import re
        with open(os.path.join(self.RAIZ, "demo.js"), encoding="utf-8") as f:
            demo = f.read()
        for fichero in ("app.js", "dialogos.js"):
            with open(os.path.join(self.RAIZ, fichero), encoding="utf-8") as f:
                codigo = f.read()
            for metodo in set(re.findall(r'llamar\("(\w+)"', codigo)) | set(
                    re.findall(r'api\(\)\.(\w+)\(', codigo)):
                self.assertRegex(demo, rf"\b{metodo}:", f"{metodo} falta en demo.js")


if __name__ == "__main__":
    unittest.main()
