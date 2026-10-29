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
                         ("5", "2,5h", "<b>hola</b>"))   # el JS lo pinta como texto


class TestDiaDePermisoImputado(Base):
    """Un dia cubierto por un permiso imputado como ACTIVIDAD (asi se hace en
    ATE) es un dia de permiso completo, no "7h · +0,5h"."""

    def _con_enlace(self):
        tipos = [{"id": "ap", "nombre": "AP", "actividad": "Asuntos propios",
                  "concesiones": [{"horas": 70, "fecha_limite": ""}]}]
        return mock.patch.object(core, "permisos_tipos", lambda: tipos)

    def test_dia_completo_de_asuntos_propios(self):
        ap = [apunte(1, 7, wp="99", act="Asuntos propios")]
        with self._con_enlace(), mock.patch.object(core, "horas_dia_permiso", return_value=7.0):
            e = web.estado_dia(L, ap)
        self.assertEqual(e["estado"], "permiso")
        self.assertEqual((e["falta"], e["exceso"]), (0.0, 0.0))
        self.assertIn("Permiso (día completo)", e["texto"])

    def test_un_rato_de_permiso_no_es_dia_completo(self):
        ap = [apunte(1, 2, wp="99", act="asuntos propios "),   # sin distinguir mayusculas
              apunte(2, 3, wp="10")]
        with self._con_enlace(), mock.patch.object(core, "horas_dia_permiso", return_value=7.0):
            self.assertEqual(web.estado_dia(L, ap)["estado"], "parcial")

    def test_sin_enlace_se_compara_como_siempre(self):
        ap = [apunte(1, 8, wp="99", act="Asuntos propios")]
        e = web.estado_dia(L, ap)                 # catalogo por defecto: sin actividad
        self.assertEqual((e["estado"], e["exceso"]), ("pasado", 1.0))
        self.assertIn("+1h", e["texto"])


class TestFranja(Base):
    def test_una_consulta_y_mes_anterior_solo_si_quedo_a_medias(self):
        hoy = dt.date(2026, 10, 2)                  # viernes
        apuntes = [dict(apunte(1, 7), fecha="2026-10-01"),
                   dict(apunte(2, 7), fecha="2026-10-02")]   # octubre al dia; septiembre vacio
        with mock.patch.object(core, "entradas_rango", return_value=apuntes) as m_rango, \
             mock.patch.object(web.dt, "date", wraps=dt.date) as m_date:
            m_date.today.return_value = hoy
            r = self.api.resumen_franja()
        m_rango.assert_called_once_with("2026-09-01", "2026-10-02")
        self.assertEqual([(m["titulo"], m["al_dia"]) for m in r["meses"]],
                         [("Octubre", True), ("Septiembre", False)])
        self.assertTrue(r["meses"][1]["texto"].startswith("faltan"))
        self.assertIn("vacaciones", r)
        nombres = [p["nombre"] for p in r["permisos"]]
        self.assertIn("Asuntos particulares", nombres)        # nombre corto

    def test_tareas_habituales(self):
        def ap(fecha, wp, horas, act):
            return dict(apunte(1, horas, wp=wp, act=act), fecha=fecha)
        apuntes = [ap("2026-10-01", "10", 6.5, "soporte"), ap("2026-10-02", "10", 6.5, "soporte"),
                   ap("2026-10-05", "10", 4, "soporte"), ap("2026-10-05", "20", 2.5, "formacion"),
                   ap("2026-10-06", "20", 2.5, "formacion"),
                   ap("2026-10-07", "10", 3, "formacion"),      # misma tarea, otra actividad
                   ap("2026-10-08", "30", 7, "Asuntos propios")]
        h = web.Api._habituales(apuntes, dt.date(2026, 9, 1))
        self.assertEqual(h["desde"], "desde el 1 de septiembre")
        self.assertEqual(h["total"], "32h")
        primera = h["filas"][0]
        self.assertEqual((primera["wp_id"], primera["actividad"], primera["horas"]),
                         (10, "soporte", 17.0))
        self.assertEqual(primera["tipico"], 6.5)          # lo que mas se repite
        self.assertEqual(primera["pct"], 53)
        claves = [(f["wp_id"], f["actividad"]) for f in h["filas"]]
        self.assertIn((10, "formacion"), claves)            # tarea+actividad por separado
        self.assertEqual(len(h["filas"]), 4)
        self.assertEqual(web.Api._habituales([], dt.date(2026, 9, 1))["filas"], [])

    def test_sin_red_sigue_mostrando_permisos(self):
        with mock.patch.object(core, "entradas_rango", side_effect=RuntimeError("red")):
            r = self.api.resumen_franja()
        self.assertEqual(r["meses"], [])
        self.assertTrue(r["permisos"])


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


class TestMes(Base):
    def test_cuadricula_de_semanas_completas(self):
        sem = web.Api._semanas_de
        # octubre 2026 empieza en jueves: la 1a semana trae lun 28/9..mie 30/9
        self.assertEqual([l.isoformat() for l in sem(2026, 10)],
                         ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"])
        # noviembre empieza en domingo: la semana del 26/10 no tiene L-V de noviembre
        self.assertEqual(sem(2026, 11)[0].isoformat(), "2026-11-02")
        self.assertEqual(sem(2026, 11)[-1].isoformat(), "2026-11-30")
        self.assertEqual(len(sem(2026, 2)), 4)
        self.assertEqual(sem(2027, 1)[0].isoformat(), "2026-12-28")   # 1 de enero, viernes

    def test_mes_con_una_consulta_y_cache_para_todo_el_grid(self):
        apuntes = [dict(apunte(1, 7), fecha="2026-10-01"),
                   dict(apunte(2, 3), fecha="2026-10-02"),
                   dict(apunte(3, 5), fecha="2026-09-30")]       # de relleno: no suma
        with mock.patch.object(core, "entradas_rango", return_value=apuntes) as m_rango, \
             mock.patch.object(core, "entradas_dia") as m_dia, \
             mock.patch.object(web.dt, "date", wraps=dt.date) as m_date:
            m_date.today.return_value = dt.date(2026, 10, 2)
            r = self.api.mes(2026, 10)
        m_rango.assert_called_once_with("2026-09-28", "2026-10-30")
        m_dia.assert_not_called()
        self.assertEqual(r["titulo"], "Octubre 2026")
        self.assertEqual(len(r["semanas"]), 5)
        self.assertTrue(all(len(f) == 5 for f in r["semanas"]))
        primera = r["semanas"][0]
        self.assertEqual([(d["dia"], d["del_mes"]) for d in primera],
                         [(28, False), (29, False), (30, False), (1, True), (2, True)])
        self.assertEqual(primera[2]["reg"], 5)          # el de relleno SI se pinta...
        self.assertTrue(r["total"].startswith("10h /"))  # ...pero no suma al mes
        self.assertFalse(r["al_dia"])                    # 1/10 ok, 2/10 a medias
        self.assertEqual(r["estado"], "Te faltan 4h")
        self.assertEqual(r["conexion"], "ok")
        # la cache cubre todo el grid: anadir/avisos funcionan en cualquier celda
        self.assertEqual(len(self.api._cache.get("2026-09-30")), 1)
        self.assertEqual(self.api._cache.get("2026-10-30"), [])
        self.assertTrue(r["semanas"][4][4]["futuro"])

    def test_mes_sin_conexion(self):
        with mock.patch.object(core, "entradas_rango", side_effect=RuntimeError("red")):
            r = self.api.mes(2026, 10)
        self.assertEqual(r["conexion"], "error")
        self.assertEqual(r["semanas"][1][0]["estado"], "error")
        self.assertIsNone(self.api._cache["2026-10-05"])   # anadir avisara "no se pudo leer"

    def test_repintar_mes_no_usa_la_red(self):
        with mock.patch.object(core, "entradas_rango", return_value=[]):
            self.api.mes(2026, 10)
        core.NO_LABORABLES["2026-10-12"] = "festivo"
        with mock.patch.object(core, "entradas_rango") as m_rango:
            r = self.api.repintar_mes(2026, 10)
        m_rango.assert_not_called()
        self.assertEqual(r["semanas"][2][0]["estado"], "nolab")

    def test_vista_se_recuerda(self):
        guardado = {}
        with mock.patch.object(core, "config_valor", lambda c, d=None: guardado.get(c, d)), \
             mock.patch.object(core, "guardar_config_valor",
                               lambda k, v: guardado.update({k: v})):
            self.assertEqual(self.api.vista(), "semana")              # por defecto
            self.assertEqual(self.api.guardar_vista("mes"), {"ok": True})
            self.assertEqual(self.api.vista(), "mes")
            self.assertIn("error", self.api.guardar_vista("año"))
            guardado["vista_inicio"] = "rara"
            self.assertEqual(self.api.vista(), "semana")


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

    def _dia_cargado(self):
        with mock.patch.object(core, "entradas_dia",
                               lambda iso: [apunte(7, 2, com="c"), apunte(8, 3, wp="20")]
                               if iso == L.isoformat() else []):
            self.api.semana(L.isoformat())

    def test_guardar_dia_y_deshacer(self):
        """Editar dia: cambia horas, borra y anade de una vez; Deshacer lo
        devuelve todo a como estaba (en orden inverso)."""
        self._dia_cargado()
        llamadas = []
        with mock.patch.object(core, "actualizar_entrada",
                               lambda *a: llamadas.append(("editar",) + a)), \
             mock.patch.object(core, "eliminar_entrada",
                               lambda i: llamadas.append(("borrar", i))), \
             mock.patch.object(core, "crear_entrada",
                               lambda *a: llamadas.append(("crear",) + a) or 99), \
             mock.patch.object(core, "guardar_config_valores"):
            r = self.api.guardar_dia(L.isoformat(), {
                "editar": [{"id": "7", "horas": "2,5", "actividad": "soporte"},
                           {"id": "8", "horas": "3", "actividad": "soporte"}],   # sin cambios
                "borrar": [{"id": "8", "destino": "op"}],
                "anadir": [{"wp_id": "30", "horas": "1,5", "actividad": "dev",
                            "comentario": ""}]})
            self.assertEqual((r["hechos"], r["errores"], r["puede_deshacer"]), (3, 0, True))
            self.assertEqual(llamadas, [
                ("editar", 7, 2.5, "c", "soporte", "10"),
                ("borrar", "8"),
                ("crear", L.isoformat(), 30, 1.5, "", "dev")])
            llamadas.clear()
            self.assertEqual(self.api.deshacer()["restaurados"], 3)
        self.assertEqual(llamadas, [
            ("borrar", 99),
            ("crear", L.isoformat(), "20", 3, "", "soporte"),
            ("editar", 7, 2, "c", "soporte", "10")])

    def test_guardar_dia_valida_antes_de_tocar_nada(self):
        self._dia_cargado()
        with mock.patch.object(core, "actualizar_entrada") as m_ed, \
             mock.patch.object(core, "crear_entrada") as m_cr:
            r = self.api.guardar_dia(L.isoformat(), {
                "editar": [{"id": "7", "horas": "4"}],
                "anadir": [{"wp_id": "30", "horas": "tres"}]})
        self.assertIn("error", r)
        m_ed.assert_not_called()
        m_cr.assert_not_called()

    def test_novedades_solo_la_primera_vez_tras_actualizar(self):
        guardado = {}
        with mock.patch.object(core, "config_valor", lambda k: guardado.get(k)), \
             mock.patch.object(core, "guardar_config_valor",
                               lambda k, v: guardado.__setitem__(k, v)):
            guardado["ultima_version_abierta"] = "3.0.0"
            with mock.patch.object(core, "VERSION", "3.1.0"):
                self.assertEqual(self.api._novedades_tras_actualizar(), {"desde": "3.0.0"})
                self.assertIsNone(self.api._novedades_tras_actualizar())   # una sola vez
            guardado.clear()                                  # se viene de la 3.0 (sin apuntar)
            self.assertEqual(self.api._novedades_tras_actualizar(), {"desde": ""})

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
        self.assertEqual((r["n"], r["total"]), (2, "7,5h"))
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


class TestAsistente(unittest.TestCase):
    """Asistente de configuracion web (Api.cfg_*): mismas reglas que configurar_gui."""

    def setUp(self):
        self.api = web.Api()
        self.dir = tempfile.mkdtemp(prefix="fichacsirc_cfg_")
        self.ruta = os.path.join(self.dir, "config.json")
        with open(self.ruta, "w", encoding="utf-8") as f:
            f.write('{"base_url": "https://op.test", "api_key": "guardada", '
                    '"jornada_invierno": 6.5, "desayuno": 0.5, "favoritos": [], '
                    '"no_laborables": {"2026-12-08": "festivo"}}')
        p = mock.patch.object(web.ccore, "CONFIG_PATH", self.ruta)
        p.start()
        self.addCleanup(p.stop)

    def _datos(self, **cambios):
        d = {"url": "https://op.test/", "key": "", "jornada": "7", "desayuno_si": True,
             "desayuno": "0,5", "verano_si": True, "verano": "5", "verano_inicio": "16/06",
             "verano_fin": "15/09", "actividad": "soporte",
             "favoritos": [{"id": 5, "nombre": "Tarea 5"}]}
        d.update(cambios)
        return d

    def test_cargar_no_manda_la_api_key(self):
        c = self.api.cfg_cargar()
        self.assertNotIn("guardada", str(c))
        self.assertTrue(c["hay_key"])
        self.assertEqual((c["jornada"], c["desayuno"]), ("7", "0,5"))   # oficial = 6,5 + 0,5

    def test_validar_jornada(self):
        v = self.api.cfg_validar_jornada
        self.assertIn("fichas 6,5 h", v(self._datos())["texto"])
        self.assertIn("error", v(self._datos(jornada="0")))
        self.assertIn("error", v(self._datos(desayuno="7")))
        self.assertIn("error", v(self._datos(verano_inicio="32/13")))
        self.assertNotIn("error", v(self._datos(verano_si=False, verano_inicio="x")))

    def test_guardar_fusiona_conserva_la_key_y_recarga(self):
        with mock.patch.object(web, "_cargar_motor", return_value=True) as m_motor:
            self.assertEqual(self.api.cfg_guardar(self._datos()), {"ok": True})
        m_motor.assert_called_once()
        import json
        with open(self.ruta, encoding="utf-8") as f:
            cfg = json.load(f)
        self.assertEqual(cfg["api_key"], "guardada")                    # campo vacio
        self.assertEqual(cfg["base_url"], "https://op.test")            # sin barra final
        self.assertEqual((cfg["jornada_invierno"], cfg["desayuno"], cfg["horas_dia_permiso"]),
                         (6.5, 0.5, 7))
        self.assertEqual(cfg["verano_inicio"], [6, 16])
        self.assertEqual(cfg["no_laborables"], {"2026-12-08": "festivo"})   # no se pierde
        self.assertEqual(cfg["favoritos"], [{"id": 5, "nombre": "Tarea 5"}])

    def test_guardar_con_jornada_mala_no_escribe(self):
        with open(self.ruta, encoding="utf-8") as f:
            antes = f.read()
        self.assertIn("error", self.api.cfg_guardar(self._datos(jornada="99")))
        with open(self.ruta, encoding="utf-8") as f:
            self.assertEqual(f.read(), antes)

    def test_probar_usa_la_key_guardada_si_no_se_escribe(self):
        with mock.patch.object(web.ccore, "_api_get", return_value={"name": "Ana"}) as m_get:
            self.assertEqual(self.api.cfg_probar("https://op.test/", ""), {"nombre": "Ana"})
        m_get.assert_called_once_with("https://op.test", "guardada", "/api/v3/users/me")

    def test_motivos_de_conexion(self):
        self.assertIn("401", web._motivo_conexion(RuntimeError("401 Client Error")))
        self.assertIn("red", web._motivo_conexion(RuntimeError("Max retries exceeded")))


class TestExperimento(unittest.TestCase):
    """Con EXPERIMENTO = True no se toca nada de la app de produccion."""

    def setUp(self):
        self.api = web.Api()

    def test_no_instala_actualizaciones(self):
        self.api._actualizacion = ("9.9", "https://github.com/x/y/releases", "https://x/inst.exe")
        with mock.patch.object(web, "EXPERIMENTO", True), \
             mock.patch.object(core, "descargar_archivo") as m_bajar:
            self.assertIn("error", self.api.instalar_actualizacion())
        m_bajar.assert_not_called()

    def test_comprobar_si_dice_que_hay_version_pero_no_deja_instalar(self):
        with mock.patch.object(web, "EXPERIMENTO", True), \
             mock.patch.object(core, "buscar_actualizacion",
                               return_value=("9.9", "https://github.com/x/y", "https://x/i.exe")):
            r = self.api.comprobar_actualizacion(True)
        self.assertEqual((r["version"], r["puede_instalar"]), ("9.9", False))
        with mock.patch.object(core, "buscar_actualizacion",
                               side_effect=core.ComprobacionFallida("límite de GitHub")):
            self.assertEqual(self.api.comprobar_actualizacion(True), {"error": "límite de GitHub"})
        with mock.patch.object(core, "buscar_actualizacion", return_value=None):
            self.assertTrue(self.api.comprobar_actualizacion(False)["al_dia"])

    def test_no_programa_el_aviso_ni_avisa_de_aplicaciones(self):
        import recordatorio
        with mock.patch.object(web, "EXPERIMENTO", True), \
             mock.patch.object(recordatorio, "activar_recordatorio") as m_act, \
             mock.patch.object(recordatorio, "desactivar_recordatorio") as m_des, \
             mock.patch.object(core, "fuera_de_aplicaciones", return_value="otra"):
            self.assertIn("error", self.api.recordatorio_activar("16:00"))
            self.assertIn("error", self.api.recordatorio_desactivar())
            self.assertEqual(self.api.aviso_aplicaciones(), "")
        m_act.assert_not_called()
        m_des.assert_not_called()

    def test_en_produccion_si(self):
        import recordatorio
        with mock.patch.object(web, "EXPERIMENTO", False), \
             mock.patch.object(recordatorio, "activar_recordatorio") as m_act:
            self.assertIn("error", self.api.recordatorio_activar("25:99"))
            self.assertEqual(self.api.recordatorio_activar("16:30"), {"ok": True})
        m_act.assert_called_once_with("16:30")

    def test_pagina_de_actualizacion_solo_github(self):
        with mock.patch.object(web.webbrowser, "open") as m_open:
            self.api._actualizacion = ("9.9", "https://malo.example/x", "")
            self.api.abrir_pagina_actualizacion()
            m_open.assert_not_called()
            self.api._actualizacion = ("9.9", "https://github.com/x/y/releases/tag/v9.9", "")
            self.api.abrir_pagina_actualizacion()
        m_open.assert_called_once()


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

    def test_cada_pagina_carga_comun_antes_que_su_js(self):
        for pagina, propio in (("index.html", "app.js"), ("configurar.html", "configurar.js"),
                               ("aviso.html", "aviso.js")):
            with open(os.path.join(self.RAIZ, pagina), encoding="utf-8") as f:
                html = f.read()
            self.assertLess(html.index("comun.js"), html.index(propio), pagina)
            self.assertNotIn("http", html.replace("http-equiv", ""), pagina)  # sin CDN

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
        for fichero in ("comun.js", "app.js", "dialogos.js", "configurar.js", "aviso.js", "demo.js"):
            with open(os.path.join(self.RAIZ, fichero), encoding="utf-8") as f:
                codigo = "\n".join(l for l in f.read().splitlines()
                                   if not l.strip().startswith(("*", "/*", "//")))
            self.assertNotIn("innerHTML", codigo, fichero)
            self.assertNotIn("insertAdjacentHTML", codigo, fichero)

    def test_la_api_expone_lo_que_usa_el_js(self):
        # Un nombre mal escrito en el JS solo fallaria al pulsar ese boton.
        import re
        usados = set()
        for fichero in ("comun.js", "app.js", "dialogos.js", "configurar.js", "aviso.js"):
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
        for fichero in ("comun.js", "app.js", "dialogos.js", "configurar.js", "aviso.js"):
            with open(os.path.join(self.RAIZ, fichero), encoding="utf-8") as f:
                codigo = f.read()
            for metodo in set(re.findall(r'llamar\("(\w+)"', codigo)) | set(
                    re.findall(r'api\(\)\.(\w+)\(', codigo)):
                self.assertRegex(demo, rf"\b{metodo}:", f"{metodo} falta en demo.js")


if __name__ == "__main__":
    unittest.main()
