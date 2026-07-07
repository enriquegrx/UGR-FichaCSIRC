#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests de acciones de la GUI: multiseleccion al eliminar, deshacer en lote
y total semanal. Red simulada y en_hilo sincrono (sin hilos: deterministas).

Se saltan automaticamente si no hay entorno grafico disponible.
"""

import datetime as dt
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import test_fichacsirc  # noqa: F401  (fija FICHACSIRC_CONFIG e importa core)
import rellenar_horas as core      # noqa: E402


def _en_hilo_sync(root, trabajo, al_terminar):
    """Sustituto sincrono de fichaui.en_hilo para tests deterministas."""
    try:
        res, err = trabajo(), None
    except Exception as e:
        res, err = None, e
    al_terminar(res, err)


class TestGuiAcciones(unittest.TestCase):
    def setUp(self):
        import tkinter as tk
        try:
            self.root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        self.root.withdraw()
        self.addCleanup(self.root.destroy)

        h = dt.date.today()
        self.lunes = (h - dt.timedelta(days=h.weekday())).isoformat()

        def entradas_fake(fecha, _lunes=self.lunes):
            if fecha == _lunes:
                return [
                    {"id": 1, "wp_id": "10", "horas": 2.0, "wp_titulo": "Tarea A",
                     "comentario": "", "actividad": "soporte"},
                    {"id": 2, "wp_id": "20", "horas": 3.0, "wp_titulo": "Tarea B",
                     "comentario": "coment", "actividad": "soporte"},
                ]
            return []

        parches = [
            mock.patch.object(core, "entradas_dia", entradas_fake),
            mock.patch.object(core, "nombre_usuario", lambda: "Persona De Prueba"),
            mock.patch.object(core, "_actividades_disponibles",
                              lambda wp: {"soporte": "/x"}),
            mock.patch.object(core, "FAVORITOS", [{"id": 10, "nombre": "Tarea A"}]),
            mock.patch.object(core, "GITHUB_REPO", ""),  # sin red en el test
            mock.patch.object(core, "NO_LABORABLES", {}),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)

        import registrar_gui
        self.gui = registrar_gui
        p = mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync)
        p.start()
        self.addCleanup(p.stop)

        self.app = registrar_gui.App(self.root)
        self.root.update()

    def _marcar_lunes(self):
        self.app.dia_vars[0][0].set(True)
        self.app._recargar_tree()

    def test_eliminar_borra_toda_la_seleccion(self):
        self._marcar_lunes()
        items = self.app.tree.get_children()
        self.assertEqual(len(items), 2)
        self.app.tree.selection_set(items)
        borrados = []
        with mock.patch.object(core, "eliminar_entrada",
                               lambda eid: borrados.append(str(eid))), \
             mock.patch.object(self.gui.messagebox, "askyesno",
                               lambda *a, **k: True):
            self.app._eliminar()
        self.assertEqual(sorted(borrados), ["1", "2"])
        # ambos quedan guardados para poder deshacer
        self.assertEqual(len(self.app._ultimo_borrado), 2)

    def test_deshacer_restaura_el_lote(self):
        self.app._ultimo_borrado = [
            {"fecha": self.lunes, "wp_id": "10", "horas": 2.0,
             "comentario": "", "actividad": "soporte"},
            {"fecha": self.lunes, "wp_id": "20", "horas": 3.0,
             "comentario": "c", "actividad": "soporte"},
        ]
        creados = []
        with mock.patch.object(core, "crear_entrada",
                               lambda *a: creados.append(a)):
            self.app._deshacer_borrado()
        self.assertEqual(len(creados), 2)
        self.assertIsNone(self.app._ultimo_borrado)

    def test_total_semana_en_titulo(self):
        # 2h + 3h del lunes simulado deben aparecer sumadas en el titulo
        self.assertIn("5h /", self.app.lbl_semana.cget("text"))

    def test_comentario_guardia_por_dia(self):
        # Lunes = dia de guardia; martes normal. El autorrelleno de guardia
        # solo debe viajar al dia de guardia, el resto va sin comentario, y
        # NUNCA se persiste como comentario habitual de la tarea.
        lunes_d = dt.date.fromisoformat(self.lunes)
        martes = (lunes_d + dt.timedelta(days=1)).isoformat()
        core.GUARDIAS.add(self.lunes)
        self.addCleanup(core.GUARDIAS.discard, self.lunes)
        # tarea nueva (no duplicada en el lunes simulado)
        self.app._extras.insert(0, {"id": 30, "nombre": "Tarea C"})
        self.app._poblar_tareas()
        self.app.cbo_tarea.set("30 - Tarea C")
        self.app.dia_vars[0][0].set(True)
        self.app.dia_vars[1][0].set(True)
        self.app._recargar_tree()
        self.app.ent_horas.delete(0, "end")
        self.app.ent_horas.insert(0, "1")
        self.app.ent_com.delete(0, "end")
        self.app.ent_com.insert(0, core.comentario_guardia())
        self.app._com_auto = core.comentario_guardia()
        creadas = []
        with mock.patch.object(core, "crear_entrada",
                               lambda f, wp, h, com, act: creadas.append((f, com))), \
             mock.patch.object(self.gui.messagebox, "askyesno",
                               lambda *a, **k: True), \
             mock.patch.object(core, "guardar_config_valor") as m_gcv:
            self.app._anadir()
        com_por_fecha = dict(creadas)
        self.assertEqual(com_por_fecha[self.lunes], core.comentario_guardia())
        self.assertEqual(com_por_fecha[martes], "")
        self.assertFalse(any(c.args and c.args[0] == "comentarios_tarea"
                             for c in m_gcv.call_args_list))

    def test_resumen_mes(self):
        import dialogos
        # Mes pasado fijo (marzo 2026, 22 laborables x 7h) y sin apuntes:
        # el resultado no depende del dia en que corran los tests.
        self.app.lunes = dt.date(2026, 3, 2)
        entradas = mock.patch.object(core, "entradas_dia", lambda f: [])
        sync = mock.patch.object(dialogos, "en_hilo", _en_hilo_sync)
        with entradas, sync:
            top = dialogos.abrir_resumen_mes(self.app)
        try:
            w = top._resumen
            self.assertEqual(w["titulo"].cget("text"), "Marzo 2026")
            self.assertEqual(w["reg"].cget("text"), "0h")
            self.assertEqual(w["mes"].cget("text"), "154h")
            self.assertIn("Te faltan 154h", w["estado"].cget("text"))
        finally:
            top.destroy()


class TestGuiInari(unittest.TestCase):
    """Un dia de teletrabajo con INARI activo lee/borra en INARI, no en OpenProject."""

    def setUp(self):
        import tkinter as tk
        try:
            self.root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        self.root.withdraw()
        self.addCleanup(self.root.destroy)
        h = dt.date.today()
        self.lunes = (h - dt.timedelta(days=h.weekday())).isoformat()

        import registrar_gui, destinos
        self.gui = registrar_gui
        parches = [
            mock.patch.object(core, "entradas_dia", lambda f: []),
            mock.patch.object(core, "nombre_usuario", lambda: "T"),
            mock.patch.object(core, "_actividades_disponibles", lambda wp: {"soporte": "/x"}),
            mock.patch.object(core, "FAVORITOS", []),
            mock.patch.object(core, "GITHUB_REPO", ""),
            mock.patch.object(core, "NO_LABORABLES", {}),
            mock.patch.object(core, "TELETRABAJO", {self.lunes}),
            mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync),
            mock.patch.object(destinos, "configurado", lambda: True),
            mock.patch.object(destinos, "probar_conexion", lambda: {"username": "E"}),
            mock.patch.object(destinos, "slots_dia",
                              lambda iso: (77, [{"id": 100, "titulo": "09:00-10:30 - x",
                                                 "horas": 1.5}])),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)
        self.destinos = destinos
        self.app = registrar_gui.App(self.root)

    def test_dia_teletrabajo_lee_inari(self):
        c = self.app._cache_dia.get(self.lunes)
        self.assertTrue(c and c[0]["destino"] == "inari" and c[0]["horas"] == 1.5)

    def test_borrar_enruta_a_inari(self):
        self.app.dia_vars[0][0].set(True)
        self.app._recargar_tree()
        it = self.app.tree.get_children()[0]
        self.assertEqual(self.app.tree.item(it, "tags")[3], "inari")
        self.app.tree.selection_set(it)
        with mock.patch.object(self.destinos, "borrar", return_value=True) as m_b, \
             mock.patch.object(core, "eliminar_entrada") as m_op, \
             mock.patch.object(self.gui.messagebox, "askyesno", lambda *a, **k: True):
            self.app._eliminar()
        m_b.assert_called_once_with("100")
        m_op.assert_not_called()


class TestWizardConfig(unittest.TestCase):
    def test_finalizar_preserva_claves_ajenas(self):
        # Re-ejecutar el asistente NO debe borrar lo que el wizard no gestiona
        # (festivos/vacaciones marcados, guardias, plantillas...).
        import json
        import tkinter as tk
        try:
            root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        root.withdraw()
        core.guardar_config_valor("guardias", ["2026-07-06"])
        core.guardar_config_valor("no_laborables", {"2026-12-25": "festivo"})
        import configurar_gui
        try:
            with mock.patch.object(configurar_gui.messagebox, "showinfo",
                                   lambda *a, **k: None), \
                 mock.patch.object(configurar_gui, "escribir_lanzadores",
                                   lambda: None):
                w = configurar_gui.Wizard(root)
                w.finalizar()  # destruye root al terminar
            with open(core.CONFIG_PATH, encoding="utf-8") as fh:
                cfg = json.load(fh)
            self.assertEqual(cfg.get("guardias"), ["2026-07-06"])
            self.assertEqual(cfg.get("no_laborables"), {"2026-12-25": "festivo"})
            self.assertEqual(cfg.get("api_key"), "clave-de-prueba")
        finally:
            try:
                root.destroy()
            except tk.TclError:
                pass
            core.guardar_config_valor("guardias", [])
            core.guardar_config_valor("no_laborables", {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
