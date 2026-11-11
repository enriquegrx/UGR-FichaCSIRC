# -*- coding: utf-8 -*-
"""Las pruebas de la interfaz Tkinter (la de la 2.x) crean ventanas de verdad:
en el equipo de quien desarrolla aparecen y desaparecen decenas en unos
segundos y no se puede trabajar mientras. Desde la 3.0 la app no usa esa
interfaz, asi que en local se saltan y solo corren en GitHub Actions (CI=true).
Para correrlas aqui a proposito: FICHACSIRC_TESTS_TK=1."""

import os
import unittest


def saltar_si_es_local():
    if not (os.environ.get("CI") or os.environ.get("FICHACSIRC_TESTS_TK")):
        raise unittest.SkipTest("pruebas Tkinter: solo en CI (o FICHACSIRC_TESTS_TK=1); "
                                "en local abren ventanas que parpadean")
