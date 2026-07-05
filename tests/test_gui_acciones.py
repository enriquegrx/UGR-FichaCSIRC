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


if __name__ == "__main__":
    unittest.main(verbosity=2)
