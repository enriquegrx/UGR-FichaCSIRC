#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
inari.py - Cliente JSON-RPC de INARI (Kanboard) para FichaCSIRC.

Aisla toda la comunicacion con INARI: autenticacion HTTP Basic (usuario:token),
protocolo JSON-RPC 2.0 y descubrimiento de proyecto / columna / carril /
categoria. NO depende del resto de la app (no importa rellenar_horas): recibe
las credenciales como argumentos, para poder probarlas antes de guardarlas y
para testear sin red.

Fase 1: SOLO LECTURA (validar credenciales y descubrir opciones del tablero).
La escritura de slots (createTask/createSubtask) es de la Fase 2.

El token nunca se incluye en los mensajes de error ni en logs.
"""

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None

URL_POR_DEFECTO = "https://inari.ugr.es/kanboard/jsonrpc.php"


class InariError(RuntimeError):
    """Error de comunicacion o de la API de INARI, con mensaje apto para el usuario."""


def separar_credencial(texto):
    """'usuario:token' -> ('usuario', 'token'). Sin ':', ('texto', '').

    Permite pegar la credencial de una vez en el campo de usuario."""
    texto = (texto or "").strip()
    if ":" in texto:
        u, t = texto.split(":", 1)
        return u.strip(), t.strip()
    return texto, ""


def _rpc(url, usuario, token, method, params=None, timeout=20):
    """Una llamada JSON-RPC 2.0 a Kanboard. Devuelve el 'result' o lanza
    InariError. El token nunca aparece en el mensaje de error."""
    if requests is None:  # pragma: no cover
        raise InariError("Falta la libreria 'requests'.")
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    try:
        r = requests.post(url, auth=(usuario, token), json=payload, timeout=timeout)
    except requests.RequestException:
        raise InariError("No se pudo conectar con INARI. Comprueba la URL y tu red/VPN.")
    if r.status_code == 401:
        raise InariError("Usuario o token de INARI incorrectos (401).")
    if r.status_code != 200:
        raise InariError(f"INARI respondio con un error HTTP {r.status_code}.")
    try:
        data = r.json()
    except ValueError:
        raise InariError("Respuesta de INARI no valida. ¿La URL apunta a jsonrpc.php?")
    if isinstance(data, dict) and data.get("error"):
        msg = (data["error"] or {}).get("message", "error desconocido")
        raise InariError(f"INARI rechazo la peticion: {msg}")
    return data.get("result") if isinstance(data, dict) else None


def probar_conexion(url, usuario, token):
    """Valida credenciales. Devuelve el dict del usuario (getMe) o lanza InariError."""
    me = _rpc(url, usuario, token, "getMe")
    if not me:
        raise InariError("Conexion establecida, pero el token no identifica a un usuario.")
    return me


def _lista(res, id_key="id", nombre_keys=("name",)):
    """Normaliza una respuesta de Kanboard a [{'id': int, 'nombre': str}]."""
    if isinstance(res, dict):
        # algunas versiones devuelven {id: nombre}
        return [{"id": int(k), "nombre": v} for k, v in res.items()]
    out = []
    for item in (res or []):
        nombre = ""
        for k in nombre_keys:
            if item.get(k):
                nombre = item[k]
                break
        out.append({"id": int(item[id_key]), "nombre": nombre})
    return out


def proyectos(url, usuario, token):
    return _lista(_rpc(url, usuario, token, "getMyProjects"))


def columnas(url, usuario, token, project_id):
    res = _rpc(url, usuario, token, "getColumns", {"project_id": int(project_id)})
    return _lista(res, nombre_keys=("title", "name"))


def carriles(url, usuario, token, project_id):
    res = _rpc(url, usuario, token, "getActiveSwimlanes", {"project_id": int(project_id)})
    return _lista(res, nombre_keys=("name",))


def categorias(url, usuario, token, project_id):
    res = _rpc(url, usuario, token, "getAllCategories", {"project_id": int(project_id)})
    return _lista(res, nombre_keys=("name",))
