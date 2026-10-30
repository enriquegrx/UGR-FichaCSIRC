#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pruebas de humo de la interfaz web (web/humo.js) en un navegador real sin
ventana: Edge o Chrome con --headless y --dump-dom.

Se copia la carpeta web a un temporal, se añade humo.js a index.html y se abre
con ?demo&humo (datos de demostracion, sin red ni pywebview). humo.js hace lo
que haria una persona y deja OK / FALLO en <pre id="humo-resultado">; aqui se
lee ese DOM. Si no hay navegador en el equipo, el test se salta.

Por que: el JavaScript crecio mucho en la 3.x (fichas, editar dia, arrastrar,
cajas, PIN) y solo el motor tenia tests; un cambio en una zona rompia otra sin
que nadie lo viera hasta instalar."""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from html import unescape

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CANDIDATOS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
]


def navegador():
    for c in CANDIDATOS:
        if os.path.exists(c):
            return c
    for nombre in ("msedge", "google-chrome", "chromium", "chrome"):
        ruta = shutil.which(nombre)
        if ruta:
            return ruta
    return None


@unittest.skipIf(navegador() is None, "sin Edge/Chrome en el equipo")
class TestHumoWeb(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="fichacsirc_humo_")
        cls.web = os.path.join(cls.tmp, "web")
        shutil.copytree(os.path.join(RAIZ, "web"), cls.web)
        shutil.copy(os.path.join(RAIZ, "logo_ugr.png"), cls.tmp)   # la demo lo carga como ../logo_ugr.png
        with open(os.path.join(cls.web, "index.html"), encoding="utf-8") as f:
            html = f.read()
        assert "humo.js" not in html, "index.html no debe cargar humo.js (solo el test)"
        html = html.replace("</body>", '<script src="humo.js"></script>\n</body>')
        with open(os.path.join(cls.web, "humo.html"), "w", encoding="utf-8") as f:
            f.write(html)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _correr(self, consulta):
        url = "file:///" + os.path.join(self.web, "humo.html").replace("\\", "/") + "?" + consulta
        perfil = os.path.join(self.tmp, "perfil")
        cmd = [navegador(), "--headless=new", "--disable-gpu", "--no-sandbox",
               f"--user-data-dir={perfil}", "--window-size=1440,900",
               "--virtual-time-budget=30000", "--dump-dom", url]
        # Lanzado desde otra app Chromium (Electron, el propio Claude...), el
        # navegador hereda CHROME_CRASHPAD_PIPE_NAME, se cree un proceso hijo y
        # sale sin hacer nada: se limpia el entorno.
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith("CHROME_")}
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=180, env=env)
        if r.returncode == 0 and not r.stdout.strip():
            self.fail("El navegador salió sin pintar nada. Lanzado desde Git Bash/MSYS "
                      "pasa: corre los tests desde PowerShell, cmd o run_tests.bat.")
        m = re.search(r'<pre id="humo-resultado"[^>]*>(.*?)</pre>', r.stdout, re.S)
        self.assertIsNotNone(m, "humo.js no dejó resultado (¿no cargó la página?):\n"
                             + r.stdout[-800:] + "\n" + r.stderr[-800:])
        lineas = [ln for ln in unescape(m.group(1)).splitlines() if ln.strip()]
        fallos = [ln for ln in lineas if ln.startswith("FALLO")]
        self.assertEqual(fallos, [], "\n".join(lineas))
        self.assertIn("HUMO-FIN", lineas, "no llegó al final:\n" + "\n".join(lineas))
        return lineas

    def test_recorrido_principal(self):
        lineas = self._correr("demo&humo")
        self.assertGreaterEqual(sum(1 for ln in lineas if ln.startswith("OK")), 20)

    def test_pantalla_del_pin(self):
        lineas = self._correr("demo&humo&pin")
        self.assertTrue(any("PIN" in ln for ln in lineas if ln.startswith("OK")))


if __name__ == "__main__":
    unittest.main()
