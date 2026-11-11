#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Lo propio de Linux que se puede probar sin Linux: el aviso diario con
systemd (unidades, activar, desactivar) y el lanzador cuando falta WebKitGTK.
Que la app ARRANCA de verdad en Ubuntu lo prueba GitHub Actions (xvfb)."""

import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import test_fichacsirc  # noqa: F401  (fija FICHACSIRC_CONFIG e importa core)
import recordatorio                 # noqa: E402
import fichacsirc_linux             # noqa: E402


class TestRecordatorioLinux(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fichacsirc_linux_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.llamadas = []
        for p in (mock.patch.object(recordatorio.sys, "platform", "linux"),
                  mock.patch.object(recordatorio.shutil, "which", return_value="/usr/bin/systemctl"),
                  mock.patch.dict(os.environ, {"XDG_CONFIG_HOME": self.dir,
                                               "FICHACSIRC_LANZADOR": "/home/ana/Apps/FichaCSIRC.AppImage"}),
                  mock.patch.object(recordatorio.subprocess, "run",
                                    side_effect=lambda cmd, **k: self.llamadas.append(cmd)
                                    or mock.Mock(returncode=0, stdout="", stderr="")),
                  mock.patch.object(recordatorio, "_recordar_ejecutable")):
            p.start()
            self.addCleanup(p.stop)

    def test_activar_y_desactivar(self):
        self.assertTrue(recordatorio.recordatorios_soportados())
        self.assertFalse(recordatorio.recordatorio_activo())
        recordatorio.activar_recordatorio("14:30")
        d = os.path.join(self.dir, "systemd", "user")
        with open(os.path.join(d, "fichacsirc-recordatorio.timer"), encoding="utf-8") as f:
            self.assertIn("OnCalendar=Mon..Fri *-*-* 14:30:00", f.read())
        with open(os.path.join(d, "fichacsirc-recordatorio.service"), encoding="utf-8") as f:
            # el .AppImage de verdad, no la carpeta temporal donde se monta
            self.assertIn("ExecStart=/home/ana/Apps/FichaCSIRC.AppImage --recordatorio", f.read())
        self.assertIn(["systemctl", "--user", "enable", "--now", "fichacsirc-recordatorio.timer"], self.llamadas)
        self.assertTrue(recordatorio.recordatorio_activo())
        recordatorio.desactivar_recordatorio()
        self.assertFalse(recordatorio.recordatorio_activo())

    def test_rutas_con_espacios_entre_comillas(self):
        with mock.patch.dict(os.environ, {"FICHACSIRC_LANZADOR": "/home/ana/Mis apps/FichaCSIRC.AppImage"}):
            servicio, _t = recordatorio._unidades_linux("09:05")
        self.assertIn("ExecStart='/home/ana/Mis apps/FichaCSIRC.AppImage' --recordatorio", servicio)


class TestLanzadorLinux(unittest.TestCase):
    def test_sin_webkit_dice_que_instalar(self):
        with mock.patch.dict(sys.modules, {"gi": None}):
            self.assertIn("python3-gi", fichacsirc_linux.falta_webkit())
        with mock.patch.object(fichacsirc_linux.shutil, "which", return_value=None), \
             mock.patch("sys.stderr") as err:
            fichacsirc_linux.avisar("Falta WebKitGTK")
        self.assertIn("gir1.2-webkit2-4.1", "".join(str(c) for c in err.write.call_args_list))


class TestEmpaquetadoLinux(unittest.TestCase):
    def test_build_linux_lleva_todo_lo_que_importa_la_app(self):
        """Si se añade un modulo nuevo a la app y no al .deb, en Linux no
        arrancaria (aqui no se nota: en Windows y Mac lo junta PyInstaller)."""
        raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(raiz, "build_linux.sh"), encoding="utf-8") as f:
            script = f.read()
        for m in ("registrar_web.py", "rellenar_horas.py", "configurar.py", "destinos.py",
                  "inari.py", "recordatorio.py", "copias.py", "bandeja.py", "fichacsirc_linux.py",
                  "NOVEDADES.md", "TECNOLOGIA.md", "logo_ugr.png"):
            self.assertIn(m, script, m)


if __name__ == "__main__":
    unittest.main()
