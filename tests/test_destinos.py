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
    def test_titulo_dia(self):
        self.assertEqual(destinos.titulo_dia("2026-07-06"), "Teletrabajo 2026-07-06")

    def test_titulo_slot(self):
        self.assertEqual(destinos.titulo_slot("09:00", "10:30", "Copias"),
                         "09:00-10:30 - Copias")
        self.assertEqual(destinos.titulo_slot("09:00", "10:30", ""), "09:00-10:30")


class TestLectura(unittest.TestCase):
    def test_slots_y_horas_dia(self):
        with mock.patch.object(core, "config_valor", _cfg()), \
             mock.patch.object(destinos.inari, "buscar_tarea", return_value=7), \
             mock.patch.object(destinos.inari, "slots",
                               return_value=[{"id": 1, "titulo": "a", "horas": 1.5},
                                             {"id": 2, "titulo": "b", "horas": 3.0}]):
            tid, ss = destinos.slots_dia("2026-07-06")
            self.assertEqual(tid, 7)
            self.assertEqual(len(ss), 2)
            self.assertEqual(destinos.horas_dia("2026-07-06"), 4.5)

    def test_dia_sin_tarea(self):
        with mock.patch.object(core, "config_valor", _cfg()), \
             mock.patch.object(destinos.inari, "buscar_tarea", return_value=None), \
             mock.patch.object(destinos.inari, "slots") as m_slots:
            self.assertEqual(destinos.slots_dia("2026-07-06"), (None, []))
            self.assertEqual(destinos.horas_dia("2026-07-06"), 0)
            m_slots.assert_not_called()


class TestEscritura(unittest.TestCase):
    def test_registrar_crea_tarea_y_slot(self):
        with mock.patch.object(core, "config_valor", _cfg()), \
             mock.patch.object(destinos.inari, "tarea_del_dia", return_value=7) as m_t, \
             mock.patch.object(destinos.inari, "crear_slot", return_value=99) as m_s:
            sid = destinos.registrar("2026-07-06", "09:00", "10:30", "Copias")
        self.assertEqual(sid, 99)
        # tarea del dia: args = (url, usuario, token, project_id, titulo)
        self.assertEqual(m_t.call_args.args[3], 5)                      # project_id
        self.assertEqual(m_t.call_args.args[4], "Teletrabajo 2026-07-06")
        self.assertEqual(m_t.call_args.kwargs,
                         {"column_id": 2, "swimlane_id": 3, "category_id": 4})
        # slot con titulo de franja y horas calculadas
        self.assertEqual(m_s.call_args.args[4], "09:00-10:30 - Copias")
        self.assertEqual(m_s.call_args.args[5], 1.5)

    def test_registrar_franja_invalida_no_toca_red(self):
        with mock.patch.object(core, "config_valor", _cfg()), \
             mock.patch.object(destinos.inari, "tarea_del_dia") as m_t:
            with self.assertRaises(ValueError):
                destinos.registrar("2026-07-06", "10:00", "09:00", "x")  # fin<inicio
            m_t.assert_not_called()

    def test_editar_y_borrar(self):
        with mock.patch.object(core, "config_valor", _cfg()), \
             mock.patch.object(destinos.inari, "actualizar_slot", return_value=True) as m_u, \
             mock.patch.object(destinos.inari, "borrar_slot", return_value=True) as m_b:
            self.assertTrue(destinos.editar(99, 7, "09:00", "11:00", "Copias"))
            self.assertEqual(m_u.call_args.kwargs["horas"], 2.0)
            self.assertTrue(destinos.borrar(99))
            self.assertEqual(m_b.call_args.args[3], 99)


if __name__ == "__main__":
    unittest.main(verbosity=2)
