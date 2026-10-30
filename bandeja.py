#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Icono en la bandeja del sistema e inicio con Windows (solo Windows).

Con la bandeja activa, cerrar la ventana la esconde junto al reloj en vez de
salir; desde el icono se vuelve a abrir, se va a "hoy" o se sale del todo.
"Iniciar con Windows" apunta la app en la clave Run del usuario con
--minimizado, para que arranque escondida en la bandeja.

Solo Windows: pystray en macOS exige el hilo principal, que ya es de pywebview
(la ventana), y en Mac el Dock hace de bandeja. Ahi el dialogo lo dice y no
ofrece nada.

El icono se dibuja con Pillow (el logo de la app: reloj con check), sin
ficheros aparte.
"""

import os
import sys
import threading

import rellenar_horas as core

NOMBRE_RUN = "FichaCSIRC"
CLAVE_RUN = r"Software\Microsoft\Windows\CurrentVersion\Run"


def soportada():
    return os.name == "nt"


def activa():
    return soportada() and bool(core.config_valor("bandeja", False))


def icono_imagen(tam=64):
    """El logo de la app como imagen Pillow: cuadrado azul redondeado, esfera
    blanca y check verde (lo mismo que el SVG de la cabecera)."""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (tam, tam), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    e = tam / 64
    d.rounded_rectangle([0, 0, tam - 1, tam - 1], radius=14 * e, fill="#0b66c3")
    d.ellipse([12 * e, 12 * e, 52 * e, 52 * e], fill="#ffffff")
    d.line([(23 * e, 33 * e), (30 * e, 40 * e), (43 * e, 25 * e)], fill="#248a46",
           width=max(1, int(5 * e)), joint="curve")
    return img


class Bandeja:
    """Icono de la bandeja ligado a la ventana de pywebview."""

    def __init__(self, ventana, al_fichar_hoy=None):
        self.ventana = ventana
        self.al_fichar_hoy = al_fichar_hoy
        self._icono = None
        self._saliendo = False

    def arrancar(self):
        import pystray
        menu = pystray.Menu(
            pystray.MenuItem("Abrir FichaCSIRC", self.mostrar, default=True),
            pystray.MenuItem("Fichar hoy", self.fichar_hoy),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Salir", self.salir))
        self._icono = pystray.Icon("FichaCSIRC", icono_imagen(), "FichaCSIRC", menu)
        # En Windows el icono vive en su propio hilo con su bucle de mensajes;
        # el principal es de pywebview.
        threading.Thread(target=self._icono.run, daemon=True, name="bandeja").start()
        # Cerrar la ventana la esconde (salvo que se salga desde el icono).
        self.ventana.events.closing += self._al_cerrar

    def parar(self):
        """Quitar el icono y volver a cerrar de verdad (desactivada en caliente)."""
        try:
            self.ventana.events.closing -= self._al_cerrar
        except Exception:
            pass
        if self._icono:
            self._icono.stop()
            self._icono = None

    def _al_cerrar(self):
        if self._saliendo:
            return True
        self.esconder()
        return False                       # pywebview: False = no cerrar

    def esconder(self, *_a):
        try:
            self.ventana.hide()
        except Exception:
            pass

    def mostrar(self, *_a):
        try:
            self.ventana.show()
            self.ventana.restore()
        except Exception:
            pass

    def fichar_hoy(self, *_a):
        self.mostrar()
        if self.al_fichar_hoy:
            try:
                self.al_fichar_hoy()
            except Exception:
                pass

    def salir(self, *_a):
        self._saliendo = True
        try:
            if self._icono:
                self._icono.stop()
        finally:
            threading.Timer(0.1, self.ventana.destroy).start()


# ----------------------- iniciar con Windows -----------------------

def _comando_inicio():
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --minimizado'
    pyw = sys.executable.replace("python.exe", "pythonw.exe")
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "registrar_web.py")
    return f'"{pyw}" "{script}" --minimizado'


def inicio_activo():
    if not soportada():
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, CLAVE_RUN) as k:
            valor, _tipo = winreg.QueryValueEx(k, NOMBRE_RUN)
        return bool(valor)
    except OSError:
        return False


def activar_inicio(activar):
    """Apunta (o quita) la app en HKCU\\...\\Run. Siempre con el ejecutable
    actual: si la app se mueve o se actualiza, la entrada se refresca al volver
    a guardar el dialogo."""
    if not soportada():
        return
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, CLAVE_RUN) as k:
        if activar:
            winreg.SetValueEx(k, NOMBRE_RUN, 0, winreg.REG_SZ, _comando_inicio())
        else:
            try:
                winreg.DeleteValue(k, NOMBRE_RUN)
            except FileNotFoundError:
                pass
    core.LOG.info("Iniciar con Windows: %s", "activado" if activar else "desactivado")
