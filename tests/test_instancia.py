#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Una sola FichaCSIRC abierta: la copia nueva avisa a la abierta (que se
muestra) y sale; si no contesta nadie, arranca normal."""

import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import instancia  # noqa: E402


class TestInstancia(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fichacsirc_instancia_")
        self.addCleanup(shutil.rmtree, self.dir, True)

    def test_la_abierta_se_entera_y_recibe_los_argumentos(self):
        llegado = threading.Event()
        recibidos = []

        def al_llegar(args):
            recibidos.append(args)
            llegado.set()
        srv = instancia.escuchar(self.dir, al_llegar)
        self.addCleanup(srv.close)
        self.assertTrue(instancia.avisar_a_la_abierta(self.dir, ["--por-completar"]))
        self.assertTrue(llegado.wait(3))
        self.assertEqual(recibidos, [["--por-completar"]])

    def test_sin_ninguna_abierta_arranca_normal(self):
        self.assertFalse(instancia.avisar_a_la_abierta(self.dir, []))       # sin fichero

    def test_la_anterior_se_cerro_de_golpe(self):
        srv = instancia.escuchar(self.dir, lambda a: None)
        srv.close()                                                         # queda el fichero, nadie escucha
        self.assertFalse(instancia.avisar_a_la_abierta(self.dir, [], espera=0.5))

    def test_otro_programa_en_ese_puerto_no_cuenta(self):
        """Un puerto que ya es de otro: no contesta "ok" y se arranca normal."""
        otro = socket.socket()
        otro.bind(("127.0.0.1", 0))
        otro.listen(1)
        self.addCleanup(otro.close)

        def responde_otra_cosa():
            c, _ = otro.accept()
            with c:
                c.recv(1024)
                c.sendall(b"HTTP/1.0 400\r\n")
        threading.Thread(target=responde_otra_cosa, daemon=True).start()
        with open(os.path.join(self.dir, instancia.NOMBRE), "w", encoding="utf-8") as f:
            json.dump({"puerto": otro.getsockname()[1], "token": "x", "pid": 0}, f)
        self.assertFalse(instancia.avisar_a_la_abierta(self.dir, [], espera=1))

    def test_clave_equivocada_no_muestra_nada(self):
        llamado = []
        srv = instancia.escuchar(self.dir, llamado.append)
        self.addCleanup(srv.close)
        ruta = os.path.join(self.dir, instancia.NOMBRE)
        with open(ruta, encoding="utf-8") as f:
            d = json.load(f)
        d["token"] = "otra"
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(d, f)
        self.assertFalse(instancia.avisar_a_la_abierta(self.dir, [], espera=1))
        self.assertEqual(llamado, [])


if __name__ == "__main__":
    unittest.main()
