#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests del cliente INARI (Kanboard JSON-RPC). Red simulada: sin tocar la API."""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import inari  # noqa: E402


def _resp(status=200, body=None, json_error=False):
    r = mock.Mock(status_code=status)
    if json_error:
        r.json.side_effect = ValueError("no json")
    else:
        r.json.return_value = body if body is not None else {}
    return r


class TestSepararCredencial(unittest.TestCase):
    def test_con_dos_puntos(self):
        self.assertEqual(inari.separar_credencial("evargas:abc123"), ("evargas", "abc123"))
        # el token puede contener ':'
        self.assertEqual(inari.separar_credencial("u:a:b"), ("u", "a:b"))

    def test_sin_dos_puntos(self):
        self.assertEqual(inari.separar_credencial("evargas"), ("evargas", ""))
        self.assertEqual(inari.separar_credencial("  x  "), ("x", ""))
        self.assertEqual(inari.separar_credencial(None), ("", ""))


class TestRpc(unittest.TestCase):
    def test_payload_y_auth(self):
        r = _resp(body={"jsonrpc": "2.0", "id": 1, "result": {"id": 7}})
        with mock.patch.object(inari.requests, "post", return_value=r) as m:
            res = inari._rpc("http://x/jsonrpc.php", "user", "tok",
                             "getColumns", {"project_id": 5})
        self.assertEqual(res, {"id": 7})
        _, kw = m.call_args
        self.assertEqual(kw["auth"], ("user", "tok"))
        self.assertEqual(kw["json"]["method"], "getColumns")
        self.assertEqual(kw["json"]["params"], {"project_id": 5})
        self.assertEqual(kw["json"]["jsonrpc"], "2.0")

    def test_error_jsonrpc(self):
        r = _resp(body={"error": {"code": -32601, "message": "Method not found"}})
        with mock.patch.object(inari.requests, "post", return_value=r):
            with self.assertRaises(inari.InariError) as ctx:
                inari._rpc("u", "us", "tk", "loquesea")
        self.assertIn("Method not found", str(ctx.exception))

    def test_401(self):
        with mock.patch.object(inari.requests, "post", return_value=_resp(status=401)):
            with self.assertRaises(inari.InariError) as ctx:
                inari._rpc("u", "us", "tk", "getMe")
        self.assertIn("401", str(ctx.exception))

    def test_http_no_200(self):
        with mock.patch.object(inari.requests, "post", return_value=_resp(status=500)):
            with self.assertRaises(inari.InariError):
                inari._rpc("u", "us", "tk", "getMe")

    def test_conexion_fallida(self):
        with mock.patch.object(inari.requests, "post",
                               side_effect=inari.requests.ConnectionError("boom")):
            with self.assertRaises(inari.InariError) as ctx:
                inari._rpc("u", "us", "tk", "getMe")
        self.assertIn("conectar", str(ctx.exception).lower())

    def test_respuesta_no_json(self):
        with mock.patch.object(inari.requests, "post", return_value=_resp(json_error=True)):
            with self.assertRaises(inari.InariError):
                inari._rpc("u", "us", "tk", "getMe")

    def test_token_no_aparece_en_errores(self):
        # ninguna rama de error debe filtrar el token
        casos = [
            _resp(status=401),
            _resp(status=500),
            _resp(body={"error": {"message": "x"}}),
            _resp(json_error=True),
        ]
        for r in casos:
            with mock.patch.object(inari.requests, "post", return_value=r):
                try:
                    inari._rpc("u", "us", "SECRETO", "getMe")
                except inari.InariError as e:
                    self.assertNotIn("SECRETO", str(e))


class TestLecturas(unittest.TestCase):
    def test_probar_conexion(self):
        r = _resp(body={"result": {"id": 3, "name": "Enrique"}})
        with mock.patch.object(inari.requests, "post", return_value=r):
            self.assertEqual(inari.probar_conexion("u", "us", "tk")["name"], "Enrique")

    def test_probar_conexion_token_sin_usuario(self):
        # getMe puede devolver false si el token no identifica a nadie
        r = _resp(body={"result": False})
        with mock.patch.object(inari.requests, "post", return_value=r):
            with self.assertRaises(inari.InariError):
                inari.probar_conexion("u", "us", "tk")

    def test_proyectos_lista(self):
        r = _resp(body={"result": [{"id": "5", "name": "Sistemas de Gestión"},
                                    {"id": 9, "name": "Micro"}]})
        with mock.patch.object(inari.requests, "post", return_value=r):
            p = inari.proyectos("u", "us", "tk")
        self.assertEqual(p, [{"id": 5, "nombre": "Sistemas de Gestión"},
                             {"id": 9, "nombre": "Micro"}])

    def test_proyectos_dict(self):
        # algunas versiones devuelven {id: nombre}
        r = _resp(body={"result": {"5": "Sistemas de Gestión"}})
        with mock.patch.object(inari.requests, "post", return_value=r):
            self.assertEqual(inari.proyectos("u", "us", "tk"),
                             [{"id": 5, "nombre": "Sistemas de Gestión"}])

    def test_columnas_usa_title(self):
        r = _resp(body={"result": [{"id": 1, "title": "Backlog"},
                                   {"id": 2, "title": "Finalizada"}]})
        with mock.patch.object(inari.requests, "post", return_value=r) as m:
            cols = inari.columnas("u", "us", "tk", 5)
        self.assertEqual(cols[1], {"id": 2, "nombre": "Finalizada"})
        self.assertEqual(m.call_args.kwargs["json"]["method"], "getColumns")
        self.assertEqual(m.call_args.kwargs["json"]["params"], {"project_id": 5})

    def test_carriles_y_categorias(self):
        r = _resp(body={"result": [{"id": 1, "name": "Copias"}]})
        with mock.patch.object(inari.requests, "post", return_value=r) as m:
            self.assertEqual(inari.carriles("u", "us", "tk", 5)[0]["nombre"], "Copias")
            self.assertEqual(m.call_args.kwargs["json"]["method"], "getActiveSwimlanes")
        with mock.patch.object(inari.requests, "post", return_value=r) as m:
            self.assertEqual(inari.categorias("u", "us", "tk", 5)[0]["nombre"], "Copias")
            self.assertEqual(m.call_args.kwargs["json"]["method"], "getAllCategories")


class TestEscritura(unittest.TestCase):
    def test_buscar_tarea_titulo_exacto(self):
        r = _resp(body={"result": [{"id": 1, "title": "Otra"},
                                   {"id": 7, "title": "Teletrabajo 2026-07-06"}]})
        with mock.patch.object(inari.requests, "post", return_value=r):
            self.assertEqual(
                inari.buscar_tarea("u", "us", "tk", 5, "Teletrabajo 2026-07-06"), 7)
        # sin coincidencia exacta -> None
        r = _resp(body={"result": [{"id": 1, "title": "Teletrabajo 2026-07-06 (algo)"}]})
        with mock.patch.object(inari.requests, "post", return_value=r):
            self.assertIsNone(
                inari.buscar_tarea("u", "us", "tk", 5, "Teletrabajo 2026-07-06"))

    def test_crear_tarea_payload(self):
        r = _resp(body={"result": 42})
        with mock.patch.object(inari.requests, "post", return_value=r) as m:
            tid = inari.crear_tarea("u", "us", "tk", 5, "Teletrabajo 2026-07-06",
                                    column_id=2, swimlane_id=3, category_id=4)
        self.assertEqual(tid, 42)
        p = m.call_args.kwargs["json"]
        self.assertEqual(p["method"], "createTask")
        self.assertEqual(p["params"], {"project_id": 5, "title": "Teletrabajo 2026-07-06",
                                       "column_id": 2, "swimlane_id": 3, "category_id": 4})

    def test_crear_tarea_error_si_false(self):
        with mock.patch.object(inari.requests, "post", return_value=_resp(body={"result": False})):
            with self.assertRaises(inari.InariError):
                inari.crear_tarea("u", "us", "tk", 5, "X")

    def test_tarea_del_dia_reutiliza(self):
        # existe -> no crea
        r = _resp(body={"result": [{"id": 9, "title": "Teletrabajo 2026-07-06"}]})
        with mock.patch.object(inari.requests, "post", return_value=r):
            self.assertEqual(inari.tarea_del_dia("u", "us", "tk", 5,
                                                 "Teletrabajo 2026-07-06"), 9)

    def test_tarea_del_dia_crea_si_no_existe(self):
        respuestas = [_resp(body={"result": []}),        # searchTasks: nada
                      _resp(body={"result": 11})]        # createTask: id
        with mock.patch.object(inari.requests, "post", side_effect=respuestas):
            self.assertEqual(inari.tarea_del_dia("u", "us", "tk", 5,
                                                 "Teletrabajo 2026-07-06"), 11)

    def test_crear_slot_time_spent(self):
        r = _resp(body={"result": 100})
        with mock.patch.object(inari.requests, "post", return_value=r) as m:
            sid = inari.crear_slot("u", "us", "tk", 7, "09:00-10:30 - Copias", 1.5)
        self.assertEqual(sid, 100)
        p = m.call_args.kwargs["json"]
        self.assertEqual(p["method"], "createSubtask")
        self.assertEqual(p["params"]["task_id"], 7)
        self.assertEqual(p["params"]["time_spent"], 1.5)
        self.assertEqual(p["params"]["title"], "09:00-10:30 - Copias")

    def test_slots_normaliza(self):
        r = _resp(body={"result": [{"id": "1", "title": "a", "time_spent": "1.5"},
                                   {"id": 2, "title": "b", "time_spent": None}]})
        with mock.patch.object(inari.requests, "post", return_value=r):
            self.assertEqual(inari.slots("u", "us", "tk", 7),
                             [{"id": 1, "titulo": "a", "horas": 1.5},
                              {"id": 2, "titulo": "b", "horas": 0.0}])

    def test_actualizar_y_borrar(self):
        with mock.patch.object(inari.requests, "post", return_value=_resp(body={"result": True})) as m:
            self.assertTrue(inari.actualizar_slot("u", "us", "tk", 100, 7, horas=2.0))
            self.assertEqual(m.call_args.kwargs["json"]["method"], "updateSubtask")
            self.assertTrue(inari.borrar_slot("u", "us", "tk", 100))
            self.assertEqual(m.call_args.kwargs["json"]["method"], "removeSubtask")
        with mock.patch.object(inari.requests, "post", return_value=_resp(body={"result": False})):
            with self.assertRaises(inari.InariError):
                inari.borrar_slot("u", "us", "tk", 100)


if __name__ == "__main__":
    unittest.main(verbosity=2)
