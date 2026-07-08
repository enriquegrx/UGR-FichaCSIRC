#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests del puente destinos.py (ProyectosTIC / INARI). inari mockeado."""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import test_fichacsirc  # noqa: F401  (fija FICHACSIRC_CONFIG e importa core)
import rellenar_horas as core      # noqa: E402
import destinos                    # noqa: E402


def _cfg(**extra):
    base = {"inari_activo": True, "inari_url": "http://x/jsonrpc.php",
            "inari_usuario": "u", "inari_token": "t", "inari_project_id": 5,
            "inari_column_id": 2, "inari_swimlane_id": 3, "inari_category_id": 4}
    base.update(extra)
    return lambda clave, defecto=None: base.get(clave, defecto)


class TestConfigurado(unittest.TestCase):
    def test_configurado(self):
        with mock.patch.object(core, "config_valor", _cfg()):
            self.assertTrue(destinos.configurado())
        with mock.patch.object(core, "config_valor", _cfg(inari_activo=False)):
            self.assertFalse(destinos.configurado())
        with mock.patch.object(core, "config_valor", _cfg(inari_project_id=None)):
            self.assertFalse(destinos.configurado())
        with mock.patch.object(core, "config_valor", _cfg(inari_token="")):
            self.assertFalse(destinos.configurado())


class TestTitulos(unittest.TestCase):
    def test_ref_dia(self):
        self.assertEqual(destinos.ref_dia("2026-07-06"), "TT-2026-07-06")

    def test_titulo_slot(self):
        self.assertEqual(destinos.titulo_slot("09:00", "10:30", "Copias"),
                         "09:00-10:30 - Copias")
        self.assertEqual(destinos.titulo_slot("09:00", "10:30", ""), "09:00-10:30")


class TestLectura(unittest.TestCase):
    def test_slots_y_horas_dia(self):
        slots = [{"id": 1, "titulo": "a", "horas": 1.5, "column_id": 2,
                  "swimlane_id": 3, "category_id": 4},
                 {"id": 2, "titulo": "b", "horas": 3.0, "column_id": 2,
                  "swimlane_id": 3, "category_id": 4}]
        with mock.patch.object(core, "config_valor", _cfg()), \
             mock.patch.object(destinos.inari, "slots_dia", return_value=slots) as m:
            ss = destinos.slots_dia("2026-07-06")
            self.assertEqual(len(ss), 2)
            self.assertEqual(destinos.horas_dia("2026-07-06"), 4.5)
        # agrupa por reference "TT-AAAA-MM-DD"
        self.assertEqual(m.call_args.args[4], "TT-2026-07-06")

    def test_dia_sin_slots(self):
        with mock.patch.object(core, "config_valor", _cfg()), \
             mock.patch.object(destinos.inari, "slots_dia", return_value=[]):
            self.assertEqual(destinos.slots_dia("2026-07-06"), [])
            self.assertEqual(destinos.horas_dia("2026-07-06"), 0)


class TestEscritura(unittest.TestCase):
    def test_registrar_crea_slot_tarea(self):
        with mock.patch.object(core, "config_valor", _cfg()), \
             mock.patch.object(destinos.inari, "crear_slot", return_value=99) as m_s:
            sid = destinos.registrar("2026-07-06", "09:00", "10:30", "Copias")
        self.assertEqual(sid, 99)
        # crear_slot: args = (url, usuario, token, project_id, titulo, horas, reference)
        a, kw = m_s.call_args.args, m_s.call_args.kwargs
        self.assertEqual(a[3], 5)                       # project_id
        self.assertEqual(a[4], "09:00-10:30 - Copias")  # titulo de franja
        self.assertEqual(a[5], 1.5)                     # horas
        self.assertEqual(a[6], "TT-2026-07-06")         # reference de dia
        # clasificacion por defecto de config cuando no se pasa por slot
        self.assertEqual((kw["column_id"], kw["swimlane_id"], kw["category_id"]), (2, 3, 4))

    def test_registrar_clasificacion_por_slot_manda(self):
        with mock.patch.object(core, "config_valor", _cfg()), \
             mock.patch.object(destinos.inari, "crear_slot", return_value=1) as m_s:
            destinos.registrar("2026-07-06", "09:00", "10:00", "x",
                               column_id=8, swimlane_id=9, category_id=10)
        kw = m_s.call_args.kwargs
        self.assertEqual((kw["column_id"], kw["swimlane_id"], kw["category_id"]), (8, 9, 10))

    def test_registrar_franja_invalida_no_toca_red(self):
        with mock.patch.object(core, "config_valor", _cfg()), \
             mock.patch.object(destinos.inari, "crear_slot") as m_s:
            with self.assertRaises(ValueError):
                destinos.registrar("2026-07-06", "10:00", "09:00", "x")  # fin<inicio
            m_s.assert_not_called()

    def test_editar_borrar_mover(self):
        with mock.patch.object(core, "config_valor", _cfg()), \
             mock.patch.object(destinos.inari, "editar_slot", return_value=True) as m_u, \
             mock.patch.object(destinos.inari, "borrar_slot", return_value=True) as m_b, \
             mock.patch.object(destinos.inari, "mover_slot", return_value=True) as m_m:
            self.assertTrue(destinos.editar(99, "09:00", "11:00", "Copias"))
            self.assertEqual(m_u.call_args.kwargs["horas"], 2.0)
            self.assertEqual(m_u.call_args.args[3], 99)   # task_id
            self.assertTrue(destinos.borrar(99))
            self.assertEqual(m_b.call_args.args[3], 99)
            self.assertTrue(destinos.mover(99, 8, swimlane_id=9))
            self.assertEqual(m_m.call_args.args[4], 99)   # task_id (tras project_id)


if __name__ == "__main__":
    unittest.main(verbosity=2)
