#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Una sola FichaCSIRC abierta a la vez.

Con el icono en la bandeja, cerrar la ventana solo la esconde. Si despues se
pulsaba el acceso del escritorio, arrancaba OTRA copia del programa, que no
llegaba a ensenar su ventana: parecia que el acceso no hacia nada (solo se
podia abrir desde el icono junto al reloj).

Ahora la copia que esta abierta escucha en 127.0.0.1 (un puerto cualquiera)
y lo apunta, con una clave aleatoria, en instancia.json junto a su config. Una
copia nueva lo lee y le pide que se muestre (pasandole sus argumentos, p. ej.
--por-completar); si contesta, la nueva se cierra. Si no contesta nadie (la
anterior se cerro de golpe, o el puerto es ya de otro programa: la clave no
coincide), la nueva arranca normal y pasa a ser la que escucha.
"""

import hmac
import json
import os
import secrets
import socket
import threading

NOMBRE = "instancia.json"


def _ruta(carpeta):
    return os.path.join(carpeta, NOMBRE)


def avisar_a_la_abierta(carpeta, args, espera=1.5):
    """True si ya habia una FichaCSIRC abierta y ha recibido el aviso (esta
    copia debe salir). False si no hay ninguna que conteste."""
    try:
        with open(_ruta(carpeta), encoding="utf-8") as f:
            d = json.load(f)
        _permitir_primer_plano(int(d.get("pid") or 0))
        with socket.create_connection(("127.0.0.1", int(d["puerto"])), timeout=espera) as s:
            s.settimeout(espera)
            s.sendall((json.dumps({"token": d["token"], "args": [str(a) for a in args]}) + "\n").encode("utf-8"))
            return s.recv(16).startswith(b"ok")
    except (OSError, ValueError, KeyError, TypeError):
        return False


def escuchar(carpeta, al_llegar):
    """La copia abierta: escucha y, a cada aviso valido, llama a
    al_llegar(args) en su propio hilo. Devuelve el socket (cerrarlo = dejar
    de escuchar)."""
    token = secrets.token_hex(16)
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.bind(("127.0.0.1", 0))
    srv.listen(4)
    datos = {"puerto": srv.getsockname()[1], "token": token, "pid": os.getpid()}
    os.makedirs(carpeta, exist_ok=True)
    tmp = _ruta(carpeta) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(datos, f)
    os.replace(tmp, _ruta(carpeta))

    def bucle():
        while True:
            try:
                c, _dir = srv.accept()
            except OSError:
                return                          # cerrado
            args = None
            with c:
                try:
                    c.settimeout(2)
                    leido = b""
                    while not leido.endswith(b"\n") and len(leido) < 65536:
                        trozo = c.recv(4096)
                        if not trozo:
                            break
                        leido += trozo
                    m = json.loads(leido.decode("utf-8") or "{}")
                    if hmac.compare_digest(str(m.get("token", "")), token):
                        args = [str(a) for a in (m.get("args") or [])]
                        c.sendall(b"ok")
                except (OSError, ValueError, AttributeError):
                    args = None
            if args is not None:
                try:
                    al_llegar(args)
                except Exception:
                    pass                        # mostrar la ventana nunca debe tumbar nada
    threading.Thread(target=bucle, daemon=True, name="instancia").start()
    return srv


def _permitir_primer_plano(pid):
    """Windows solo deja pasar a primer plano a quien tiene el foco: esta copia
    (la que se acaba de pulsar) se lo cede a la abierta para que su ventana
    salga delante y no solo parpadeando en la barra de tareas."""
    if os.name != "nt" or pid <= 0:
        return
    try:
        import ctypes
        ctypes.windll.user32.AllowSetForegroundWindow(pid)
    except Exception:
        pass
