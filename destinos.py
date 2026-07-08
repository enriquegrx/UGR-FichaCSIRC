#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
destinos.py - Puente entre los dos destinos de registro: ProyectosTIC
(OpenProject, en rellenar_horas) e INARI (Kanboard, en inari).

Aqui vive la orquestacion que SI conoce la configuracion (a diferencia de
inari.py, que es un cliente puro con credenciales por argumento): lee las
claves inari_* de config y llama al cliente. Lo usan la ventana, el resumen del
mes y el aviso de fichaje, para que un dia de teletrabajo cuente sus horas de
INARI en vez de las de ProyectosTIC.

Modelo (solo SisGes): en un dia de teletrabajo se registra en INARI *o* en
ProyectosTIC, nunca en los dos. Cada slot es una TAREA independiente de INARI,
con su columna/carril/categoria propias y un marcador de dia en `reference`
("TT-AAAA-MM-DD") para agruparlos. La columna/carril/categoria por defecto de
config son solo semillas; el diccionario de valores real se elige por slot.
"""

import rellenar_horas as core
import inari


def inari_activo():
    return bool(core.config_valor("inari_activo", False))


def _creds():
    return (core.config_valor("inari_url", inari.URL_POR_DEFECTO),
            core.config_valor("inari_usuario", ""),
            core.config_valor("inari_token", ""))


def _proyecto():
    return core.config_valor("inari_project_id")


def _defaults():
    return {
        "column_id": core.config_valor("inari_column_id"),
        "swimlane_id": core.config_valor("inari_swimlane_id"),
        "category_id": core.config_valor("inari_category_id"),
    }


def configurado():
    """True si INARI esta activo y con lo minimo para operar."""
    url, usuario, token = _creds()
    return bool(inari_activo() and url and usuario and token and _proyecto())


def ref_dia(fecha_iso):
    """Marcador de dia (Kanboard `reference`) para agrupar los slots de un dia.
    Igualdad exacta; determinista e independiente de zona horaria."""
    return f"TT-{fecha_iso}"


def titulo_slot(inicio, fin, descripcion):
    base = f"{inicio}-{fin}"
    return f"{base} - {descripcion}".strip() if descripcion else base


def _o(valor, defecto):
    """valor si no es None; si no, el defecto de config."""
    return defecto if valor is None else valor


def slots_dia(fecha_iso):
    """Lista de slots del dia en INARI: [{id, titulo, horas, column_id,
    swimlane_id, category_id}] (cada slot es una tarea; `id` es su task_id)."""
    url, usuario, token = _creds()
    return inari.slots_dia(url, usuario, token, _proyecto(), ref_dia(fecha_iso))


def horas_dia(fecha_iso):
    """Horas registradas en INARI ese dia (suma de time_spent de los slots)."""
    return sum(s["horas"] for s in slots_dia(fecha_iso))


def registrar(fecha_iso, inicio, fin, descripcion,
              column_id=None, swimlane_id=None, category_id=None):
    """Crea un slot (una tarea) en INARI para ese dia. Devuelve su id (task_id).
    Valida la franja antes de tocar la red. La columna/carril/categoria pueden
    darse por slot; si faltan, se toman los valores por defecto de config."""
    horas = core.duracion_horas(inicio, fin)
    if horas is None:
        raise ValueError("Franja horaria no valida (revisa inicio y fin).")
    d = _defaults()
    url, usuario, token = _creds()
    return inari.crear_slot(
        url, usuario, token, _proyecto(),
        titulo_slot(inicio, fin, descripcion), horas, ref_dia(fecha_iso),
        column_id=_o(column_id, d["column_id"]),
        swimlane_id=_o(swimlane_id, d["swimlane_id"]),
        category_id=_o(category_id, d["category_id"]),
        descripcion=(descripcion or None),
        date_started=f"{fecha_iso} 00:00")


def editar(task_id, inicio, fin, descripcion, category_id=None):
    """Actualiza un slot (updateTask). No mueve columna/carril (usar mover)."""
    horas = core.duracion_horas(inicio, fin)
    if horas is None:
        raise ValueError("Franja horaria no valida (revisa inicio y fin).")
    url, usuario, token = _creds()
    return inari.editar_slot(url, usuario, token, task_id,
                             titulo=titulo_slot(inicio, fin, descripcion),
                             horas=horas, descripcion=(descripcion or None),
                             category_id=category_id)


def mover(task_id, column_id, swimlane_id=None):
    """Mueve un slot de columna/carril (moveTaskPosition)."""
    url, usuario, token = _creds()
    return inari.mover_slot(url, usuario, token, _proyecto(), task_id,
                            column_id, swimlane_id=swimlane_id)


def borrar(task_id):
    url, usuario, token = _creds()
    return inari.borrar_slot(url, usuario, token, task_id)


def probar_conexion():
    """Comprueba INARI con las credenciales de config (para el indicador del pie)."""
    url, usuario, token = _creds()
    return inari.probar_conexion(url, usuario, token)
