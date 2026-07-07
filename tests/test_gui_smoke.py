#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Smoke test de la GUI de registro: ventana oculta, red simulada, en_hilo
sincrono (sin hilos ni mainloop: deterministas y sin cierres cruzados de Tk).

Se salta automaticamente si no hay entorno grafico disponible.
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import test_fichacsirc  # noqa: F401  (fija FICHACSIRC_CONFIG e importa core)
import rellenar_horas as core      # noqa: E402


def _en_hilo_sync(root, trabajo, al_terminar):
    """Sustituto sincrono de fichaui.en_hilo (sin hilos)."""
    try:
        res, err = trabajo(), None
    except Exception as e:
        res, err = None, e
    al_terminar(res, err)


def _entradas_fake(fecha):
    if fecha.endswith("01"):
        return [{"id": 1, "wp_id": "1", "horas": 3.0, "wp_titulo": "Tarea demo",
                 "comentario": "", "actividad": "soporte"}]
    return []


class TestGuiSmoke(unittest.TestCase):
    def test_arranque_tarjetas_y_seleccion(self):
        import tkinter as tk
        try:
            root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        root.withdraw()
        self.addCleanup(root.destroy)

        parches = [
            mock.patch.object(core, "entradas_dia", _entradas_fake),
            mock.patch.object(core, "nombre_usuario", lambda: "Persona De Prueba"),
            mock.patch.object(core, "_actividades_disponibles",
                              lambda wp: {"soporte": "/x"}),
            mock.patch.object(core, "FAVORITOS", [{"id": 1, "nombre": "Tarea demo"}]),
            mock.patch.object(core, "GITHUB_REPO", ""),  # sin red en el test
            mock.patch.object(core, "NO_LABORABLES", {}),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)

        import registrar_gui
        p = mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync)
        p.start()
        self.addCleanup(p.stop)

        app = registrar_gui.App(root)   # sincrono: pinta la semana al construir
        self.addCleanup(setattr, app, "_logo_img", None)  # soltar la imagen

        self.assertEqual(len(app.dia_vars), 5)
        self.assertEqual(app.lbl_user.cget("text"), "Persona De Prueba")

        # clic marca/desmarca
        var0 = app.dia_vars[0][0]
        antes = var0.get()
        app._click_dia(var0)
        self.assertNotEqual(var0.get(), antes)

        # toda la semana
        app.var_semana.set(True)
        app._toggle_semana()
        self.assertEqual(len(app._dias_marcados()), 5)

        # un solo dia marcado -> horas sugeridas y tarjeta resaltada
        app.var_semana.set(False)
        app._toggle_semana()
        app._click_dia(app.dia_vars[1][0])
        self.assertNotEqual(app.ent_horas.get(), "")
        self.assertEqual(app.dia_vars[1][2].cget("bg"), "#e8f3ff")


if __name__ == "__main__":
    unittest.main(verbosity=2)
