#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Guardados de config.json a la vez (pywebview atiende cada llamada del JS en
su propio hilo). En la 3.2.0, marcar un festivo con "No volver a preguntarme"
guardaba dos cosas a la vez: los dos usaban el mismo config.json.tmp
(WinError 2 al moverlo) y una lectura-modificacion-escritura podia pisar a
la otra y perder un cambio."""

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import test_fichacsirc  # noqa: F401  (fija FICHACSIRC_CONFIG e importa core)
import rellenar_horas as core      # noqa: E402
import registrar_web as web        # noqa: E402


class TestGuardadosALaVez(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fichacsirc_hilos_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.ruta = os.path.join(self.dir, "config.json")
        with open(self.ruta, "w", encoding="utf-8") as f:
            json.dump({"api_key": "k", "base_url": "https://op.test"}, f)
        for p in (mock.patch.object(core, "CONFIG_PATH", self.ruta),
                  mock.patch.object(web.ccore, "CONFIG_PATH", self.ruta),
                  mock.patch.dict(core._cfg, {}, clear=False)):
            p.start()
            self.addCleanup(p.stop)

    def test_dos_hilos_guardando_a_la_vez_no_fallan_ni_pierden_nada(self):
        errores = []

        def motor(n):                       # como accion_dia: guardar_config_valor
            try:
                for i in range(40):
                    core.guardar_config_valor(f"motor_{n}_{i}", i)
            except Exception as e:          # noqa: BLE001
                errores.append(repr(e))

        def sin_motor():                    # como el PIN / avisos: _config_cambiar
            try:
                for i in range(40):
                    web._config_cambiar(**{f"api_{i}": i})
            except Exception as e:          # noqa: BLE001
                errores.append(repr(e))

        hilos = [threading.Thread(target=motor, args=(n,)) for n in range(2)] + \
                [threading.Thread(target=sin_motor)]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join()
        self.assertEqual(errores, [])
        with open(self.ruta, encoding="utf-8") as f:
            cfg = json.load(f)
        faltan = [k for k in ([f"motor_{n}_{i}" for n in range(2) for i in range(40)]
                              + [f"api_{i}" for i in range(40)]) if k not in cfg]
        self.assertEqual(faltan, [], f"se perdieron {len(faltan)} cambios")
        self.assertEqual(cfg["api_key"], "k")


if __name__ == "__main__":
    unittest.main()
