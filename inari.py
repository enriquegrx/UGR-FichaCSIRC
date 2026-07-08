#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
inari.py - Cliente JSON-RPC de INARI (Kanboard) para FichaCSIRC.

Aisla toda la comunicacion con INARI: autenticacion HTTP Basic (usuario:token),
protocolo JSON-RPC 2.0 y descubrimiento de proyecto / columna / carril /
categoria. NO depende del resto de la app (no importa rellenar_horas): recibe
las credenciales como argumentos, para poder probarlas antes de guardarlas y
para testear sin red.

Lectura: validar credenciales y descubrir proyecto/columna/carril/categoria.
Escritura: cada slot de teletrabajo es una TAREA independiente (createTask con
`time_spent` y `reference` de dia), no una subtarea. Ver el bloque de slots.

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


# ------------------- escritura / lectura de slots: tarea por slot -------------------
# Modelo verificado contra el codigo fuente de Kanboard v1.2.50:
#  - Cada slot es una TAREA independiente (no subtareas): un dia de teletrabajo
#    puede tener varios slots en distinta columna/carril/categoria.
#  - Las horas van en `time_spent` DIRECTO de la tarea. NO usar subtareas con
#    horas: SubtaskTimeTrackingModel sobreescribiria el time_spent de la tarea.
#  - `createTask`/`updateTask` se invocan con parametros NOMBRADOS: `time_spent`
#    es el posicional 21 de la firma PHP; un array posicional seria fragil.
#  - Los slots de un dia se agrupan por `reference` = "TT-AAAA-MM-DD" (marcador
#    de dia). Es determinista e independiente de la zona horaria, a diferencia
#    del titulo o de la fecha nativa (date_started/date_due).
#  - Inconsistencia de la API: updateTask usa la clave 'id'; removeTask y
#    moveTaskPosition usan 'task_id'.

def _horas(v):
    """time_spent de Kanboard llega como string ('0', '4.5'); a float robusto."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def crear_slot(url, usuario, token, project_id, titulo, horas, reference,
               column_id=None, swimlane_id=None, category_id=None,
               descripcion=None, date_started=None):
    """Crea una TAREA-slot con las horas en time_spent. Devuelve su id (int > 0).

    Parametros NOMBRADOS obligatorios (time_spent es posicional 21 en la firma
    PHP de createTask; nunca enviar array posicional)."""
    params = {"project_id": int(project_id), "title": titulo,
              "time_spent": float(horas), "reference": reference}
    if column_id:
        params["column_id"] = int(column_id)
    if swimlane_id:
        params["swimlane_id"] = int(swimlane_id)
    if category_id:
        params["category_id"] = int(category_id)
    if descripcion:
        params["description"] = descripcion
    if date_started:
        params["date_started"] = date_started
    res = _rpc(url, usuario, token, "createTask", params)
    if not res:  # createTask devuelve el id (int > 0) o false
        raise InariError("INARI no pudo crear el slot.")
    return int(res)


def slots_dia(url, usuario, token, project_id, reference):
    """Tareas-slot de un dia (misma `reference`): [{id, titulo, horas,
    column_id, swimlane_id, category_id}].

    Busca por 'ref:<reference> status:open' (igualdad exacta, sin comodines) y
    refuerza el filtro en cliente por si la version del servidor lo ignorase."""
    query = f"ref:{reference} status:open"
    res = _rpc(url, usuario, token, "searchTasks",
               {"project_id": int(project_id), "query": query})
    out = []
    for t in (res or []):
        if str(t.get("reference") or "") != str(reference):
            continue
        out.append({"id": int(t["id"]), "titulo": t.get("title", ""),
                    "horas": _horas(t.get("time_spent")),
                    "column_id": int(t.get("column_id") or 0),
                    "swimlane_id": int(t.get("swimlane_id") or 0),
                    "category_id": int(t.get("category_id") or 0)})
    return out


def editar_slot(url, usuario, token, task_id, titulo=None, horas=None,
                descripcion=None, category_id=None):
    """Actualiza titulo/horas/descripcion/categoria de un slot (updateTask).

    updateTask NO acepta column_id/swimlane_id: para mover de columna o carril
    usa `mover_slot` (moveTaskPosition)."""
    params = {"id": int(task_id)}
    if titulo is not None:
        params["title"] = titulo
    if horas is not None:
        params["time_spent"] = float(horas)
    if descripcion is not None:
        params["description"] = descripcion
    if category_id:
        params["category_id"] = int(category_id)
    if not _rpc(url, usuario, token, "updateTask", params):
        raise InariError("INARI no pudo actualizar el slot.")
    return True


def mover_slot(url, usuario, token, project_id, task_id, column_id,
               swimlane_id=None, position=1):
    """Mueve un slot de columna/carril (moveTaskPosition; updateTask no puede)."""
    params = {"project_id": int(project_id), "task_id": int(task_id),
              "column_id": int(column_id), "position": int(position)}
    if swimlane_id:
        params["swimlane_id"] = int(swimlane_id)
    if not _rpc(url, usuario, token, "moveTaskPosition", params):
        raise InariError("INARI no pudo mover el slot de columna/carril.")
    return True


def borrar_slot(url, usuario, token, task_id):
    if not _rpc(url, usuario, token, "removeTask", {"task_id": int(task_id)}):
        raise InariError("INARI no pudo borrar el slot.")
    return True
