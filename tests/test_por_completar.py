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

    def test_repartir_a_cuartos(self):
        self.assertEqual(web.repartir(7, [70, 30]), [5.0, 2.0])
        self.assertEqual(web.repartir(3, [1, 1, 1]), [1.0, 1.0, 1.0])
        self.assertEqual(web.repartir(0.5, [70, 30]), [0.25, 0.25])
        self.assertEqual(web.repartir(0.25, [50, 50]), [0.25, 0.0])        # nunca mas de lo que falta
        self.assertAlmostEqual(sum(web.repartir(6.5, [60, 25, 15])), 6.5)

    def test_completar_repartido(self):
        r = self.api.completar_dias(["2026-11-04", "2026-11-03"], "", "", "",
                                    [{"wp_id": "20", "actividad": "Soporte", "peso": 70},
                                     {"wp_id": "30", "actividad": "Formación", "peso": 30}])
        self.assertEqual((r["creados"], r["apuntes"], r["horas"]), (2, 4, "10h"))
        self.assertEqual([(c[0], c[1], c[2]) for c in self.creados],
                         [("2026-11-03", 20, 2.0), ("2026-11-03", 30, 1.0),
                          ("2026-11-04", 20, 5.0), ("2026-11-04", 30, 2.0)])
        self.assertEqual(self.api.deshacer_estado()["siguiente"], "completar 2 días (10h) entre 2 tareas")
        self.assertIn("error", self.api.completar_dias(["2026-11-03"], "", reparto=[{"wp_id": "x", "peso": 1}]))

    def test_excesos(self):
        self.apuntes += [ap("2026-11-10", "10", 2),                        # el 10: 9h de 7
                         ap("2026-10-12", "10", 3)]                        # festivo con horas
        r = self.api.por_completar(2026, hoy=HOY)
        self.assertEqual([x["iso"] for x in r["excesos"]], ["2026-10-12", "2026-11-10"])
        x = r["excesos"][1]
        self.assertEqual((x["sobra_txt"], x["texto"], x["duplicado"]), ("2h", "9h de 7h", True))
        self.assertTrue(r["excesos"][0]["nolab"])
        self.assertEqual((r["n_excesos"], r["sobra"]), (2, "5h"))
        self.assertEqual(r["modelo"], "2026-11-11")                   # un dia de mas no es modelo

    def test_buscar_apuntes(self):
        self.apuntes[1]["comentario"] = "Renovación del certificado SSL"
        r = self.api.buscar_apuntes("certificado renovacion", 2026, hoy=HOY)
        self.assertEqual((r["n"], r["resultados"][0]["iso"], r["total"]), (1, "2026-11-03", "4h"))
        r = self.api.buscar_apuntes("t10", 2026, hoy=HOY)               # por tarea; recientes primero
        self.assertEqual(r["resultados"][0]["iso"], "2026-11-11")
        self.assertEqual(self.api.buscar_apuntes("05/11", 2026, hoy=HOY)["n"], 1)   # por fecha
        self.assertEqual(self.api.buscar_apuntes(" ", 2026, hoy=HOY)["n"], 0)

    def test_probar_el_aviso_no_ficha(self):
        with mock.patch.object(web.subprocess, "Popen") as popen:
            self.assertEqual(self.api.recordatorio_probar(), {"ok": True})
        self.assertEqual(popen.call_args[0][0][-2:], ["--recordatorio", "--prueba-aviso"])
        with mock.patch.object(web.subprocess, "Popen", side_effect=OSError("no")):
            self.assertIn("error", self.api.recordatorio_probar())
        # sin nada pendiente, la prueba enseña hoy como si no se hubiera fichado
        with mock.patch.object(core, "objetivo_de", lambda d: 6.5):
            self.assertEqual(web.aviso_de_ejemplo(HOY), [(HOY, 0.0, 6.5)])
        with mock.patch.object(core, "objetivo_de", lambda d: 0.0):       # fin de semana o festivo
            self.assertEqual(web.aviso_de_ejemplo(HOY), [(HOY, 0.0, 7.0)])
        # y desde la prueba no se ficha, aunque se pulse
        self.api._prueba = True
        self.assertIn("prueba", self.api.aviso_fichar("2026-11-12", "10", "2", "")["error"])
        self.assertEqual(self.creados, [])

    def test_comentarios_de_cada_tarea(self):
        def con(fecha, wp, com):
            return dict(ap(fecha, wp, 1), comentario=com)
        self.apuntes[:] = [con("2026-11-02", "10", "Revisión de copias"), con("2026-11-05", "10", "Parches"),
                           con("2026-11-09", "10", "revision  de copias"),      # el mismo, mas reciente
                           con("2026-11-10", "10", ""), con("2026-11-11", "10", "Servicio de Guardia"),
                           con("2026-11-03", "20", "Curso"),
                           con("2025-10-01", "10", "De hace más de un año")]
        r = self.api.comentarios_tareas(hoy=HOY)
        self.assertEqual(r, {"por_tarea": {"10": ["revision de copias", "Parches"], "20": ["Curso"]}})
        self.assertEqual(web.comentarios_por_tarea(self.apuntes, "", 1)["10"], ["Servicio de Guardia"])
        with mock.patch.object(core, "entradas_rango", side_effect=OSError("sin red")):
            self.assertEqual(self.api.comentarios_tareas(hoy=HOY), {"por_tarea": {}})   # sin conexion, sin sugerencias

    def test_te_pasas_dice_que_apunte_sobra(self):
        self.apuntes += [dict(ap("2026-11-10", "10", 2), id=77)]            # el 10: 7 + 2 de la misma tarea
        x = self.api.por_completar(2026, hoy=HOY)["excesos"][0]
        self.assertEqual([(a["id"], a["repetido"], a["justo"]) for a in x["apuntes"]],
                         [("1", True, False), ("77", True, True)])           # quitando el de 2h queda justo
        # y el dia queda en la cache: quitarlo desde la lista se puede deshacer
        self.assertEqual(len(self.api._cache["2026-11-10"]), 2)

    def test_plantilla_de_semana(self):
        guardadas = []
        with mock.patch.object(core, "PLANTILLAS", guardadas), \
             mock.patch.object(core, "guardar_config_valor", lambda k, v: None):
            r = self.api.guardar_plantilla_semana("2026-11-04", "Semana tipo")   # miercoles: su lunes es el 2
            self.assertEqual((r["n"], r["total"]), (4, "24,5h"))
            p = guardadas[0]
            self.assertTrue(p["semana"])
            self.assertEqual([len(d) for d in p["dias"]], [1, 1, 0, 1, 1])
            lista = self.api.plantillas()
            self.assertEqual((lista[0]["semana"], lista[0]["n"], lista[0]["total"]), (True, 4, "24,5h"))
            # a la semana siguiente (9-13): el 9, 10 y 11 ya tienen esa tarea; se crean jueves y viernes
            r = self.api.aplicar_plantilla_semana("Semana tipo", "2026-11-09")
            self.assertEqual((r["creados"], r["saltados"]), (2, 2))
            self.assertEqual([(c[0], c[2]) for c in self.creados], [("2026-11-12", 7), ("2026-11-13", 6.5)])
            # una de semana no se aplica a dias sueltos, ni una que no existe
            self.assertIn("error", self.api.aplicar_plantilla("Semana tipo", ["2026-11-12"]))
            self.assertIn("error", self.api.aplicar_plantilla_semana("Otra", "2026-11-09"))
            self.assertIn("error", self.api.guardar_plantilla_semana("2026-11-04", " "))

    def test_informe_a_un_fichero_temporal(self):
        with mock.patch.object(web.os, "startfile", create=True) as abrir, \
             mock.patch.object(web.subprocess, "Popen") as popen:
            r = self.api.abrir_informe("<!doctype html><title>x</title>", "noviembre 2026/../x")
        self.assertTrue(r["ok"])
        self.addCleanup(os.remove, r["ruta"])
        self.assertTrue(abrir.called or popen.called)
        self.assertEqual(os.path.basename(r["ruta"]), "FichaCSIRC-noviembre-2026-x.html")   # sin rutas raras
        self.assertIn("error", self.api.abrir_informe("", "x"))
        self.assertIn("error", self.api.abrir_informe("x" * (web.Api.MAX_INFORME + 1), "x"))

    def test_los_informes_viejos_se_borran_al_arrancar(self):
        import tempfile
        import time
        with tempfile.TemporaryDirectory() as carpeta:
            def crear(nombre, dias):
                ruta = os.path.join(carpeta, nombre)
                with open(ruta, "w", encoding="utf-8") as fh:
                    fh.write("x")
                antes = time.time() - dias * 86400
                os.utime(ruta, (antes, antes))
                return ruta
            viejo = crear("FichaCSIRC-informe-mes-2026-10-01.html", 8)
            reciente = crear("FichaCSIRC-informe-mes-2026-11-01.html", 2)
            ajeno = crear("otro-informe.html", 30)                       # no es de la app
            csv = crear("FichaCSIRC-informe-viejo.csv", 30)              # ni un informe
            self.assertEqual(web.limpiar_informes(carpeta), 1)
            self.assertFalse(os.path.exists(viejo))
            for ruta in (reciente, ajeno, csv):
                self.assertTrue(os.path.exists(ruta), ruta)
            self.assertEqual(web.limpiar_informes(os.path.join(carpeta, "no-existe")), 0)

    def test_completar_hoy_desde_la_bandeja(self):
        self.api._bandeja = mock.MagicMock()
        self.api._ventana = mock.MagicMock()
        self.api.bandeja_habituales([{"wp_id": "20", "tarea": "Mantenimientos", "actividad": "Soporte"},
                                     {"wp_id": "x"}, {"wp_id": 30, "tarea": "Proxmox"}])
        self.assertEqual([h["wp_id"] for h in self.api._hab_bandeja], [20, 30])     # la mal formada, fuera
        self.api._bandeja.poner_habituales.assert_called_once()

        class Hoy(dt.date):
            @classmethod
            def today(cls):
                return cls(2026, 11, 4)                                    # miercoles vacio, de guardia
        with mock.patch.object(web.dt, "date", Hoy):
            texto = self.api._completar_hoy_bandeja(0)
        self.assertEqual(texto, "Hoy: 7h en «Mantenimientos». Para quitarlo, Deshacer en FichaCSIRC.")
        self.assertEqual(self.creados[0][:3], ("2026-11-04", 20, 7.0))
        self.api._bandeja.notificar.assert_called_once_with(texto)
        self.assertIn("alFicharFuera(", self.api._ventana.evaluate_js.call_args[0][0])
        # con PIN y bloqueada: abre la ventana y no ficha nada
        self.api._desbloqueada = False
        self.assertEqual(self.api._completar_hoy_bandeja(1), "")
        self.api._bandeja.mostrar.assert_called_once()
        self.assertEqual(len(self.creados), 1)

    def test_textos_del_aviso(self):
        self.assertEqual(web.texto_fichar_hoy({"creados": 0, "saltados": 1}, "T"), "Hoy no falta nada por fichar.")
        self.assertIn("No se pudo", web.texto_fichar_hoy({"error": "sin conexión"}, "T"))
        self.assertIn("No se pudo", web.texto_fichar_hoy({"creados": 0, "errores": 1, "ultimo": "x"}, "T"))


class TestBandejaPendientes(unittest.TestCase):
    def test_texto(self):
        import bandeja
        b = bandeja.Bandeja(ventana=None)
        self.assertEqual(b.texto_pendientes(), "Por completar ✔")
        b.poner_pendientes(5)
        self.assertEqual(b.texto_pendientes(), "Por completar (5)")

    def test_menu_con_las_habituales(self):
        import bandeja
        hechos = []
        b = bandeja.Bandeja(ventana=None, al_completar_hoy=hechos.append)
        self.assertEqual(b.texto_habitual({"tarea": "Mantenimientos", "actividad": "Soporte"}),
                         "Completar hoy con «Mantenimientos» · Soporte")
        self.assertLessEqual(len(b.texto_habitual({"tarea": "x" * 80, "actividad": ""})), 60)
        b.poner_habituales([{"wp_id": 1, "tarea": "A", "actividad": ""}])
        try:
            import pystray  # noqa: F401
        except Exception:
            self.skipTest("sin pystray")
        textos = [str(i.text) for i in b._items()]
        self.assertIn("Completar hoy con «A»", textos)
        self.assertEqual(textos[0], "Abrir FichaCSIRC")


if __name__ == "__main__":
    unittest.main()
