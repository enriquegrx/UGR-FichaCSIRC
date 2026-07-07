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
ProyectosTIC, nunca en los dos. Una tarea diaria por dia ("Teletrabajo
AAAA-MM-DD") y una subtarea por slot ("HH:MM-HH:MM - descripcion").
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


def titulo_dia(fecha_iso):
    return f"Teletrabajo {fecha_iso}"


def titulo_slot(inicio, fin, descripcion):
    base = f"{inicio}-{fin}"
    return f"{base} - {descripcion}".strip() if descripcion else base


def slots_dia(fecha_iso):
    """(task_id | None, [ {id, titulo, horas} ]) del dia en INARI."""
    url, usuario, token = _creds()
    tid = inari.buscar_tarea(url, usuario, token, _proyecto(), titulo_dia(fecha_iso))
    if tid is None:
        return None, []
    return tid, inari.slots(url, usuario, token, tid)


def horas_dia(fecha_iso):
    """Horas registradas en INARI ese dia (suma de time_spent de los slots)."""
    _tid, ss = slots_dia(fecha_iso)
    return sum(s["horas"] for s in ss)


def registrar(fecha_iso, inicio, fin, descripcion):
    """Crea (o reutiliza) la tarea del dia y añade un slot. Devuelve el id del
    slot. Valida la franja antes de tocar la red."""
    horas = core.duracion_horas(inicio, fin)
    if horas is None:
        raise ValueError("Franja horaria no valida (revisa inicio y fin).")
    url, usuario, token = _creds()
    tid = inari.tarea_del_dia(url, usuario, token, _proyecto(),
                              titulo_dia(fecha_iso), **_defaults())
    return inari.crear_slot(url, usuario, token, tid,
                            titulo_slot(inicio, fin, descripcion), horas)


def editar(subtask_id, task_id, inicio, fin, descripcion):
    horas = core.duracion_horas(inicio, fin)
    if horas is None:
        raise ValueError("Franja horaria no valida (revisa inicio y fin).")
    url, usuario, token = _creds()
    return inari.actualizar_slot(url, usuario, token, subtask_id, task_id,
                                 titulo=titulo_slot(inicio, fin, descripcion),
                                 horas=horas)


def borrar(subtask_id):
    url, usuario, token = _creds()
    return inari.borrar_slot(url, usuario, token, subtask_id)


def probar_conexion():
    """Comprueba INARI con las credenciales de config (para el indicador del pie)."""
    url, usuario, token = _creds()
    return inari.probar_conexion(url, usuario, token)
