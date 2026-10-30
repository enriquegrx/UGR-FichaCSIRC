#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bandeja del sistema e inicio con Windows (bandeja.py) sin tocar la bandeja
ni el registro de verdad."""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import test_fichacsirc  # noqa: F401  (fija FICHACSIRC_CONFIG e importa core)
import rellenar_horas as core      # noqa: E402
import bandeja                     # noqa: E402
import registrar_web as web        # noqa: E402


class TestBandeja(unittest.TestCase):
    def test_icono_es_el_logo(self):
        img = bandeja.icono_imagen(32)
        self.assertEqual((img.size, img.mode), ((32, 32), "RGBA"))
        self.assertEqual(img.getpixel((0, 0))[3], 0)            # esquina transparente (redondeada)
        self.assertEqual(img.getpixel((16, 4))[:3], (11, 102, 195))   # azul de la app

    def test_cerrar_esconde_salvo_al_salir(self):
        ventana = mock.Mock()
        b = bandeja.Bandeja(ventana)
        self.assertFalse(b._al_cerrar())          # False = pywebview no cierra
        ventana.hide.assert_called_once()
        b._saliendo = True
        self.assertTrue(b._al_cerrar())

    def test_fichar_hoy_muestra_y_avisa(self):
        ventana, hoy = mock.Mock(), mock.Mock()
        bandeja.Bandeja(ventana, al_fichar_hoy=hoy).fichar_hoy()
        ventana.show.assert_called_once()
        hoy.assert_called_once()

    @unittest.skipUnless(os.name == "nt", "solo Windows")
    def test_inicio_con_windows_en_el_registro(self):
        valores = {}
        class Clave:
            def __enter__(self): return self
            def __exit__(self, *a): return False
        winreg = mock.MagicMock()
        winreg.CreateKey.return_value = Clave()
        winreg.OpenKey.return_value = Clave()
        winreg.SetValueEx.side_effect = lambda k, n, r, t, v: valores.__setitem__(n, v)
        winreg.DeleteValue.side_effect = lambda k, n: valores.pop(n)
        winreg.QueryValueEx.side_effect = lambda k, n: (valores[n], 1) if n in valores else (_ for _ in ()).throw(OSError())
        with mock.patch.dict(sys.modules, {"winreg": winreg}):
            self.assertFalse(bandeja.inicio_activo())
            bandeja.activar_inicio(True)
            self.assertIn("--minimizado", valores["FichaCSIRC"])
            self.assertTrue(bandeja.inicio_activo())
            bandeja.activar_inicio(False)
            self.assertFalse(bandeja.inicio_activo())

    def test_api_guardar_exige_bandeja_para_el_inicio(self):
        api = web.Api()
        guardado = {}
        with mock.patch.object(bandeja, "soportada", return_value=True), \
             mock.patch.object(bandeja, "activar_inicio") as m_ini, \
             mock.patch.object(bandeja, "inicio_activo", return_value=True), \
             mock.patch.object(core, "guardar_config_valor", lambda k, v: guardado.__setitem__(k, v)), \
             mock.patch.object(core, "config_valor", lambda k, d=None: guardado.get(k, d)):
            r = api.bandeja_guardar(False, True)      # inicio sin bandeja -> bandeja tambien
        self.assertTrue(guardado["bandeja"])
        m_ini.assert_called_once_with(True)
        self.assertTrue(r["activa"])
        with mock.patch.object(bandeja, "soportada", return_value=False):
            self.assertIn("error", api.bandeja_guardar(True, False))


if __name__ == "__main__":
    unittest.main()
