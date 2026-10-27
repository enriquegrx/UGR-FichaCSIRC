#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests de acciones de la GUI: multiseleccion al eliminar, deshacer en lote
y total semanal. Red simulada y en_hilo sincrono (sin hilos: deterministas).

Se saltan automaticamente si no hay entorno grafico disponible.
"""

import datetime as dt
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import test_fichacsirc  # noqa: F401  (fija FICHACSIRC_CONFIG e importa core)
import rellenar_horas as core      # noqa: E402


def _en_hilo_sync(root, trabajo, al_terminar):
    """Sustituto sincrono de fichaui.en_hilo para tests deterministas."""
    try:
        res, err = trabajo(), None
    except Exception as e:
        res, err = None, e
    al_terminar(res, err)


class TestGuiAcciones(unittest.TestCase):
    def setUp(self):
        import tkinter as tk
        try:
            self.root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        self.root.withdraw()
        self.addCleanup(self.root.destroy)

        h = dt.date.today()
        self.lunes = (h - dt.timedelta(days=h.weekday())).isoformat()

        def entradas_fake(fecha, _lunes=self.lunes):
            if fecha == _lunes:
                return [
                    {"id": 1, "wp_id": "10", "horas": 2.0, "wp_titulo": "Tarea A",
                     "comentario": "", "actividad": "soporte"},
                    {"id": 2, "wp_id": "20", "horas": 3.0, "wp_titulo": "Tarea B",
                     "comentario": "coment", "actividad": "soporte"},
                ]
            return []

        parches = [
            mock.patch.object(core, "entradas_dia", entradas_fake),
            mock.patch.object(core, "nombre_usuario", lambda: "Persona De Prueba"),
            mock.patch.object(core, "_actividades_disponibles",
                              lambda wp: {"soporte": "/x"}),
            mock.patch.object(core, "FAVORITOS", [{"id": 10, "nombre": "Tarea A"}]),
            mock.patch.object(core, "GITHUB_REPO", ""),  # sin red en el test
            mock.patch.object(core, "NO_LABORABLES", {}),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)

        import registrar_gui
        self.gui = registrar_gui
        p = mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync)
        p.start()
        self.addCleanup(p.stop)

        self.app = registrar_gui.App(self.root)
        self.root.update()

    def _marcar_lunes(self):
        self.app.dia_vars[0][0].set(True)
        self.app._recargar_tree()

    def test_eliminar_borra_toda_la_seleccion(self):
        self._marcar_lunes()
        items = self.app.tree.get_children()
        self.assertEqual(len(items), 2)
        self.app.tree.selection_set(items)
        borrados = []
        with mock.patch.object(core, "eliminar_entrada",
                               lambda eid: borrados.append(str(eid))), \
             mock.patch.object(self.gui.messagebox, "askyesno",
                               lambda *a, **k: True):
            self.app._eliminar()
        self.assertEqual(sorted(borrados), ["1", "2"])
        # ambos quedan guardados para poder deshacer
        self.assertEqual(len(self.app._ultimo_borrado), 2)

    def test_deshacer_restaura_el_lote(self):
        self.app._ultimo_borrado = [
            {"fecha": self.lunes, "wp_id": "10", "horas": 2.0,
             "comentario": "", "actividad": "soporte"},
            {"fecha": self.lunes, "wp_id": "20", "horas": 3.0,
             "comentario": "c", "actividad": "soporte"},
        ]
        creados = []
        with mock.patch.object(core, "crear_entrada",
                               lambda *a: creados.append(a)):
            self.app._deshacer_borrado()
        self.assertEqual(len(creados), 2)
        self.assertIsNone(self.app._ultimo_borrado)

    def test_total_semana_en_titulo(self):
        # 2h + 3h del lunes simulado deben aparecer sumadas en el titulo
        self.assertIn("5h /", self.app.lbl_semana.cget("text"))

    def test_objetivo_sin_decimales_de_mas(self):
        # "0h / 7h", no "0h / 7.0h" (objetivo_de devuelve float)
        textos = []

        def recoger(w):
            try:
                textos.append(str(w.cget("text")))
            except Exception:
                pass
            for h in w.winfo_children():
                recoger(h)
        recoger(self.app.dias_frame)
        textos.append(self.app.lbl_semana.cget("text"))
        self.assertFalse([t for t in textos if ".0h" in t], textos)

    def test_menu_contextual_tambien_en_mac(self):
        import tkinter as tk
        import fichaui
        w = tk.Label(self.root)
        with mock.patch.object(fichaui.sys, "platform", "darwin"):
            fichaui.bind_menu_contextual(w, lambda e: None)
        self.assertTrue({"<Button-3>", "<Button-2>", "<Control-Button-1>"}
                        <= set(w.bind()))
        w2 = tk.Label(self.root)
        with mock.patch.object(fichaui.sys, "platform", "win32"):
            fichaui.bind_menu_contextual(w2, lambda e: None)
        self.assertEqual(set(w2.bind()), {"<Button-3>"})  # Button-2 = rueda

    def test_anadir_pregunta_si_el_dia_no_se_pudo_leer(self):
        self.app._cache_dia[self.lunes] = None     # fallo al leer el lunes
        for var, _d, _c in self.app.dia_vars:      # solo el lunes (hoy viene
            var.set(False)                         # marcado por defecto)
        self._marcar_lunes()
        self.app.ent_horas.delete(0, "end")
        self.app.ent_horas.insert(0, "1")
        preguntas = []

        def responder(titulo, *_a, **_k):
            preguntas.append(titulo)
            return False                           # "No": no anadir
        with mock.patch.object(self.gui.messagebox, "askyesno", responder), \
             mock.patch.object(core, "crear_entrada") as m_crear:
            self.app._anadir()
        self.assertIn("No se pudieron leer algunos días", preguntas)
        m_crear.assert_not_called()

    def test_copiar_semana_salta_el_dia_que_no_se_pudo_leer(self):
        self.app._cache_dia = {d.isoformat(): [] for d in self.app._dias_semana()}
        self.app._cache_dia[self.lunes] = None
        origen = [{"id": 5, "wp_id": "10", "horas": 1.0, "wp_titulo": "Tarea A",
                   "comentario": "", "actividad": "soporte"}]
        creados = []
        with mock.patch.object(core, "entradas_dia", lambda f: list(origen)), \
             mock.patch.object(self.gui.messagebox, "askyesno", lambda *a, **k: True), \
             mock.patch.object(self.gui.messagebox, "showwarning") as m_aviso, \
             mock.patch.object(core, "crear_entrada",
                               lambda fecha, *a: creados.append(fecha)):
            self.app._copiar_semana_anterior()
        self.assertNotIn(self.lunes, creados)       # no se copia a ciegas
        self.assertEqual(len(creados), 4)           # el resto de la semana si
        m_aviso.assert_called_once()                # y se avisa del salto

    def test_comentario_guardia_por_dia(self):
        # Lunes = dia de guardia; martes normal. El autorrelleno de guardia
        # solo debe viajar al dia de guardia, el resto va sin comentario, y
        # NUNCA se persiste como comentario habitual de la tarea.
        lunes_d = dt.date.fromisoformat(self.lunes)
        martes = (lunes_d + dt.timedelta(days=1)).isoformat()
        core.GUARDIAS.add(self.lunes)
        self.addCleanup(core.GUARDIAS.discard, self.lunes)
        # tarea nueva (no duplicada en el lunes simulado)
        self.app._extras.insert(0, {"id": 30, "nombre": "Tarea C"})
        self.app._poblar_tareas()
        self.app.cbo_tarea.set("30 - Tarea C")
        self.app.dia_vars[0][0].set(True)
        self.app.dia_vars[1][0].set(True)
        self.app._recargar_tree()
        self.app.ent_horas.delete(0, "end")
        self.app.ent_horas.insert(0, "1")
        self.app.ent_com.delete(0, "end")
        self.app.ent_com.insert(0, core.comentario_guardia())
        self.app._com_auto = core.comentario_guardia()
        creadas = []
        with mock.patch.object(core, "crear_entrada",
                               lambda f, wp, h, com, act: creadas.append((f, com))), \
             mock.patch.object(self.gui.messagebox, "askyesno",
                               lambda *a, **k: True), \
             mock.patch.object(core, "guardar_config_valor") as m_gcv:
            self.app._anadir()
        com_por_fecha = dict(creadas)
        self.assertEqual(com_por_fecha[self.lunes], core.comentario_guardia())
        self.assertEqual(com_por_fecha[martes], "")
        self.assertFalse(any(c.args and c.args[0] == "comentarios_tarea"
                             for c in m_gcv.call_args_list))

    def test_resumen_mes(self):
        import dialogos
        # Mes pasado fijo (marzo 2026, 22 laborables x 7h) y sin apuntes:
        # el resultado no depende del dia en que corran los tests.
        self.app.lunes = dt.date(2026, 3, 2)
        entradas = mock.patch.object(core, "entradas_dia", lambda f: [])
        sync = mock.patch.object(dialogos, "en_hilo", _en_hilo_sync)
        with entradas, sync:
            top = dialogos.abrir_resumen_mes(self.app)
        try:
            w = top._resumen
            self.assertEqual(w["titulo"].cget("text"), "Marzo 2026")
            self.assertEqual(w["reg"].cget("text"), "0h")
            self.assertEqual(w["mes"].cget("text"), "154h")
            self.assertIn("Te faltan 154h", w["estado"].cget("text"))
        finally:
            top.destroy()

    def test_dialogo_permisos_calcula_usadas_y_disponibles(self):
        import dialogos
        anio = dt.date.today().year
        with mock.patch.object(core, "PERMISOS",
                               {f"{anio}-01-05": [{"tipo": "conciliacion", "horas": 4.0}]}), \
             mock.patch.object(core, "permisos_desde",
                               return_value=dt.date(anio, 1, 1)):
            top = dialogos.abrir_permisos(self.app)
        try:
            filas = {f["id"]: f for f in top._filas}
            self.assertEqual(filas["conciliacion"]["usadas"], 4.0)
            self.assertEqual(filas["conciliacion"]["disponibles"], 26.0)   # 30 - 4
            self.assertEqual(filas["asuntos_particulares"]["disponibles"], 70.0)
        finally:
            top.destroy()


    def test_permisos_del_año_nuevo_se_suman(self):
        import dialogos
        tipos = [{"id": "ap", "nombre": "AP",
                  "concesiones": [{"horas": 70, "fecha_limite": "2026-01-15"}]},
                 {"id": "sm", "nombre": "SM",
                  "concesiones": [{"horas": 28, "fecha_limite": ""}]}]
        guardado = {"permisos_tipos": tipos}
        with mock.patch.object(core, "config_valor",
                               lambda c, d=None: guardado.get(c, d)), \
             mock.patch.object(core, "guardar_config_valor",
                               lambda k, v: guardado.update({k: v})), \
             mock.patch.object(core, "PERMISOS", {}):
            top = dialogos.abrir_permisos_nuevo_anio(self.app)
            filas = {prop["id"]: (e_h, e_f) for prop, e_h, e_f in top._filas}
            self.assertEqual(filas["ap"][0].get(), "70:00")         # propuesta
            self.assertEqual(filas["ap"][1].get(), "2027-01-15")
            filas["sm"][0].delete(0, "end")                          # SM: no
            top._anadir()
            self.assertFalse(top.winfo_exists())
            self.assertEqual(core.cupo_total("ap"), 140.0)           # se SUMA
            self.assertEqual(core.cupo_total("sm"), 28.0)            # intacto
            self.assertEqual(guardado["permisos_anio_revisado"], dt.date.today().year)

    def test_permisos_del_año_nuevo_no_este_año(self):
        import dialogos
        guardado = {}
        with mock.patch.object(core, "guardar_config_valor",
                               lambda k, v: guardado.update({k: v})):
            top = dialogos.abrir_permisos_nuevo_anio(self.app)
            top._no_este_anio()
        self.assertEqual(guardado, {"permisos_anio_revisado": dt.date.today().year})

    def test_al_arrancar_el_año_se_ofrecen_los_permisos(self):
        import dialogos
        with mock.patch.object(core, "toca_anadir_permisos_del_anio", lambda: True), \
             mock.patch.object(dialogos, "abrir_permisos_nuevo_anio") as m_dlg:
            self.app._permisos_nuevo_anio()
        m_dlg.assert_called_once_with(self.app)
        with mock.patch.object(core, "toca_anadir_permisos_del_anio", lambda: False), \
             mock.patch.object(dialogos, "abrir_permisos_nuevo_anio") as m_dlg:
            self.app._permisos_nuevo_anio()
        m_dlg.assert_not_called()

    def test_dialogo_permisos_lee_lo_imputado_como_actividad(self):
        import dialogos
        anio = dt.date.today().year
        tipos = [{"id": "ap", "nombre": "AP", "actividad": "Asuntos propios",
                  "concesiones": [{"horas": 70, "fecha_limite": ""}]}]
        valores = {"permisos_tipos": tipos, "permisos_desde": f"{anio}-01-01"}
        with mock.patch.object(core, "config_valor",
                               lambda c, d=None: valores.get(c, d)), \
             mock.patch.object(core, "PERMISOS", {}), \
             mock.patch.dict(core._USADAS_PT, {}, clear=True), \
             mock.patch.object(dialogos, "en_hilo", _en_hilo_sync), \
             mock.patch.object(core, "entradas_rango", return_value=[
                 {"horas": 3.0, "actividad": "Asuntos propios"}]):
            top = dialogos.abrir_permisos(self.app)
            try:
                fila = top._filas[0]
                self.assertEqual((fila["usadas_pt"], fila["disponibles"]), (3.0, 67.0))
            finally:
                top.destroy()

    def test_enlazar_permiso_con_actividad_desde_el_dialogo(self):
        import dialogos
        from tkinter import ttk
        guardado = {"permisos_tipos": [{"id": "ap", "nombre": "AP", "concesiones": [
            {"horas": 70, "fecha_limite": ""}]}]}
        with mock.patch.object(core, "config_valor",
                               lambda c, d=None: guardado.get(c, d)),              mock.patch.object(core, "guardar_config_valor",
                               lambda k, v: guardado.update({k: v})),              mock.patch.object(core, "PERMISOS", {}),              mock.patch.object(dialogos, "en_hilo", _en_hilo_sync),              mock.patch.object(core, "entradas_rango", return_value=[]):
            top = dialogos.abrir_permisos(self.app)
            try:
                def combos(w):
                    out = [w] if isinstance(w, ttk.Combobox) else []
                    for h in w.winfo_children():
                        out += combos(h)
                    return out
                cbo = combos(top)[0]
                self.assertEqual(cbo.get(), dialogos.SIN_ACTIVIDAD)
                cbo.set("Asuntos propios")
                cbo.event_generate("<<ComboboxSelected>>")
                self.root.update()
                self.assertEqual(core.actividad_de_permiso("ap"), "Asuntos propios")
                # y volver a "solo en el dia" lo desenlaza
                cbo = combos(top)[0]
                cbo.set(dialogos.SIN_ACTIVIDAD)
                cbo.event_generate("<<ComboboxSelected>>")
                self.root.update()
                self.assertEqual(core.actividad_de_permiso("ap"), "")
            finally:
                top.destroy()

class TestGuiInari(unittest.TestCase):
    """Un dia de teletrabajo con INARI activo lee/borra en INARI, no en OpenProject."""

    def setUp(self):
        import tkinter as tk
        try:
            self.root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        self.root.withdraw()
        self.addCleanup(self.root.destroy)
        h = dt.date.today()
        self.lunes = (h - dt.timedelta(days=h.weekday())).isoformat()

        import registrar_gui, destinos
        self.gui = registrar_gui
        parches = [
            mock.patch.object(core, "entradas_dia", lambda f: []),
            mock.patch.object(core, "nombre_usuario", lambda: "T"),
            mock.patch.object(core, "_actividades_disponibles", lambda wp: {"soporte": "/x"}),
            mock.patch.object(core, "FAVORITOS", []),
            mock.patch.object(core, "GITHUB_REPO", ""),
            mock.patch.object(core, "NO_LABORABLES", {}),
            mock.patch.object(core, "TELETRABAJO", {self.lunes}),
            mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync),
            mock.patch.object(destinos, "configurado", lambda: True),
            mock.patch.object(destinos, "probar_conexion", lambda: {"username": "E"}),
            mock.patch.object(destinos, "slots_dia",
                              lambda iso: [{"id": 100, "titulo": "09:00-10:30 - x",
                                            "horas": 1.5, "column_id": 2,
                                            "swimlane_id": 3, "category_id": 4}]),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)
        self.destinos = destinos
        self.app = registrar_gui.App(self.root)

    def test_dia_teletrabajo_lee_inari(self):
        c = self.app._cache_dia.get(self.lunes)
        self.assertTrue(c and c[0]["destino"] == "inari" and c[0]["horas"] == 1.5)

    def test_borrar_enruta_a_inari(self):
        self.app.dia_vars[0][0].set(True)
        self.app._recargar_tree()
        it = self.app.tree.get_children()[0]
        self.assertEqual(self.app.tree.item(it, "tags")[3], "inari")
        self.app.tree.selection_set(it)
        with mock.patch.object(self.destinos, "borrar", return_value=True) as m_b, \
             mock.patch.object(core, "eliminar_entrada") as m_op, \
             mock.patch.object(self.gui.messagebox, "askyesno", lambda *a, **k: True):
            self.app._eliminar()
        m_b.assert_called_once_with("100")
        m_op.assert_not_called()


    def test_borrar_slot_inari_cuenta_en_el_mensaje(self):
        # Un slot de INARI no se puede deshacer, pero SI se ha borrado: el
        # mensaje decia "0 apuntes eliminados".
        self.app.dia_vars[0][0].set(True)
        self.app._recargar_tree()
        self.app.tree.selection_set(self.app.tree.get_children()[0])
        with mock.patch.object(self.destinos, "borrar", return_value=True), \
             mock.patch.object(self.gui.messagebox, "askyesno", lambda *a, **k: True):
            self.app._eliminar()
        self.assertIn("Apunte eliminado.", self.app.status.cget("text"))

class TestWizardConfig(unittest.TestCase):
    def test_finalizar_preserva_claves_ajenas(self):
        # Re-ejecutar el asistente NO debe borrar lo que el wizard no gestiona
        # (festivos/vacaciones marcados, guardias, plantillas...).
        import json
        import tkinter as tk
        try:
            root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        root.withdraw()
        core.guardar_config_valor("guardias", ["2026-07-06"])
        core.guardar_config_valor("no_laborables", {"2026-12-25": "festivo"})
        import configurar_gui
        try:
            with mock.patch.object(configurar_gui.messagebox, "showinfo",
                                   lambda *a, **k: None), \
                 mock.patch.object(configurar_gui, "escribir_lanzadores",
                                   lambda: None):
                w = configurar_gui.Wizard(root)
                w.finalizar()  # destruye root al terminar
            with open(core.CONFIG_PATH, encoding="utf-8") as fh:
                cfg = json.load(fh)
            self.assertEqual(cfg.get("guardias"), ["2026-07-06"])
            self.assertEqual(cfg.get("no_laborables"), {"2026-12-25": "festivo"})
            self.assertEqual(cfg.get("api_key"), "clave-de-prueba")
        finally:
            try:
                root.destroy()
            except tk.TclError:
                pass
            core.guardar_config_valor("guardias", [])
            core.guardar_config_valor("no_laborables", {})


class TestActividadesPorTarea(unittest.TestCase):
    """Las actividades dependen de la TAREA: al cambiarla hay que recargarlas,
    y se recuerda la que sueles usar con cada una."""

    def setUp(self):
        import tkinter as tk
        import registrar_gui
        try:
            self.root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        self.root.withdraw()
        self.addCleanup(self.root.destroy)
        self.gui = registrar_gui
        # Cada tarea ofrece actividades DISTINTAS: es justo lo que se comprueba.
        self.por_tarea = {
            111: {"Soporte-Incidencias": "/a/1", "Formación": "/a/2"},
            222: {"Asuntos propios": "/a/3", "Baja": "/a/4"},
        }
        parches = [
            mock.patch.object(core, "entradas_dia", lambda f: []),
            mock.patch.object(core, "nombre_usuario", lambda: "T"),
            mock.patch.object(core, "_actividades_disponibles",
                              lambda wp: self.por_tarea[int(wp)]),
            mock.patch.object(core, "FAVORITOS",
                              [{"id": 111, "nombre": "Mantenimientos"},
                               {"id": 222, "nombre": "Permisos"}]),
            mock.patch.object(core, "NO_LABORABLES", {}),
            mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)
        self.app = registrar_gui.App(self.root)
        self.addCleanup(setattr, self.app, "_logo_img", None)

    def test_al_cambiar_de_tarea_se_recargan_sus_actividades(self):
        # Arranca con las de la primera favorita
        self.assertEqual(list(self.app.cbo_act["values"]),
                         ["Soporte-Incidencias", "Formación"])
        # Al elegir la tarea de permisos, deben salir LAS SUYAS. Se dispara el
        # evento real del desplegable (no se llama al método a mano): así el
        # test falla también si se olvida enganchar el binding.
        self.app.cbo_tarea.set("222 - Permisos")
        self.app.cbo_tarea.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.assertEqual(list(self.app.cbo_act["values"]),
                         ["Asuntos propios", "Baja"])
        # Y al volver, las de la otra
        self.app.cbo_tarea.set("111 - Mantenimientos")
        self.app.cbo_tarea.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.assertEqual(list(self.app.cbo_act["values"]),
                         ["Soporte-Incidencias", "Formación"])

    def test_asociar_surte_efecto_sin_haber_imputado(self):
        """Asociar a mano escribe en la MISMA clave que el aprendizaje, así que
        vale al instante, sin tener que imputar antes."""
        guardado = {}
        with mock.patch.object(core, "guardar_config_valores", guardado.update), \
             mock.patch.object(core, "config_valor",
                               lambda c, d=None: guardado.get(c, d)):
            self.app._asociar(222, "Asuntos propios")
            self.assertEqual(guardado["actividades_tarea"], {"222": "Asuntos propios"})
            # Se preselecciona ya, sin haber creado ningun apunte
            self.app._poner_actividades(["Asuntos propios", "Baja"], 222)
            self.assertEqual(self.app.cbo_act.get(), "Asuntos propios")
            # Y se puede quitar
            self.app._desasociar("Asuntos propios")
            self.assertEqual(guardado["actividades_tarea"], {})

    def test_recuerda_la_actividad_de_cada_tarea(self):
        guardado = {}
        with mock.patch.object(core, "guardar_config_valor",
                               lambda k, v: guardado.update({k: v})), \
             mock.patch.object(core, "config_valor",
                               lambda c, d=None: guardado.get(c, d)):
            self.app._recordar_actividad(222, "Baja")
            self.assertEqual(guardado["actividades_tarea"], {"222": "Baja"})
            # Al poner las actividades de esa tarea, se preselecciona la suya
            self.app._poner_actividades(["Asuntos propios", "Baja"], 222)
            self.assertEqual(self.app.cbo_act.get(), "Baja")
            # Otra tarea sin memoria: no hereda la ajena
            self.app._poner_actividades(["Soporte-Incidencias", "Formación"], 111)
            self.assertNotEqual(self.app.cbo_act.get(), "Baja")


def _botones(widget, acumulado=None):
    """Todos los botones del árbol de una ventana."""
    import tkinter as tk
    from tkinter import ttk
    acumulado = acumulado if acumulado is not None else []
    for hijo in widget.winfo_children():
        if isinstance(hijo, (ttk.Button, tk.Button)):
            acumulado.append(hijo)
        _botones(hijo, acumulado)
    return acumulado


def _barras_en_riesgo(widget, ruta="root"):
    """Devuelve las barras inferiores que podrían quedar fuera de la ventana.

    En Tk el widget empaquetado ANTES reclama su espacio primero. Si un
    contenido expansible (expand=True con fill both/y) se empaqueta antes que
    una barra con side='bottom' del MISMO padre, al encoger la ventana el
    contenido se come su hueco y la barra desaparece: hay que maximizar para
    verla. La barra fija debe ir siempre antes. Comprueba el árbol completo."""
    fallos = []
    hijos = widget.pack_slaves()
    visto_expansible = None
    for hijo in hijos:
        try:
            info = hijo.pack_info()
        except Exception:
            continue
        if info.get("side") == "bottom" and visto_expansible is not None:
            fallos.append(f"{ruta}: {hijo.winfo_class()} con side='bottom' va "
                          f"después de {visto_expansible} expansible")
        elif (str(info.get("expand")) in ("1", "True")
              and info.get("fill") in ("both", "y")):
            visto_expansible = hijo.winfo_class()
    for n, hijo in enumerate(widget.winfo_children()):
        fallos += _barras_en_riesgo(hijo, f"{ruta}/{hijo.winfo_class()}[{n}]")
    return fallos


class TestAccionesDelDia(unittest.TestCase):
    """Guardar como plantilla y eliminar apuntes desde el día, sin tener que
    marcar nada ni buscar en la tabla."""

    def setUp(self):
        import tkinter as tk
        import registrar_gui
        import dialogos
        try:
            self.root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        self.root.withdraw()
        self.addCleanup(self.root.destroy)
        self.dialogos = dialogos
        h = dt.date.today()
        self.lunes_d = h - dt.timedelta(days=h.weekday())
        self.lunes = self.lunes_d.isoformat()
        self.apuntes = [
            {"id": 1, "wp_id": 111, "horas": 6.0, "wp_titulo": "Mantenimientos",
             "actividad": "Actuaciones técnicas", "comentario": ""},
            {"id": 2, "wp_id": 111, "horas": 1.0, "wp_titulo": "Mantenimientos",
             "actividad": "Asuntos propios", "comentario": "permiso"},
        ]
        parches = [
            mock.patch.object(core, "entradas_dia",
                              lambda f: self.apuntes if f == self.lunes else []),
            mock.patch.object(core, "nombre_usuario", lambda: "T"),
            mock.patch.object(core, "_actividades_disponibles",
                              lambda wp: {"soporte": "/x"}),
            mock.patch.object(core, "FAVORITOS", [{"id": 111, "nombre": "M"}]),
            mock.patch.object(core, "NO_LABORABLES", {}),
            mock.patch.object(core, "PLANTILLAS", []),
            mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync),
            mock.patch.object(dialogos, "en_hilo", _en_hilo_sync),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)
        self.app = registrar_gui.App(self.root)
        self.addCleanup(setattr, self.app, "_logo_img", None)

    def test_guardar_el_dia_como_plantilla(self):
        with mock.patch.object(self.dialogos.simpledialog, "askstring",
                               lambda *a, **k: "Mi día tipo"), \
             mock.patch.object(core, "guardar_config_valor", lambda *a: None):
            nombre = self.dialogos.guardar_dia_como_plantilla(self.app, self.lunes_d)
        self.assertEqual(nombre, "Mi día tipo")
        self.assertEqual(len(core.PLANTILLAS), 1)
        self.assertEqual(len(core.PLANTILLAS[0]["apuntes"]), 2)

    def test_dia_sin_apuntes_avisa_y_no_guarda(self):
        otro = self.lunes_d + dt.timedelta(days=1)
        vistos = []
        with mock.patch.object(self.dialogos.messagebox, "showinfo",
                               lambda t, m, **k: vistos.append(m)):
            self.assertIsNone(
                self.dialogos.guardar_dia_como_plantilla(self.app, otro))
        self.assertTrue(vistos and "no tiene" in vistos[0])
        self.assertEqual(core.PLANTILLAS, [])

    def test_eliminar_solo_lo_marcado(self):
        top = self.dialogos.abrir_eliminar_dia(self.app, self.lunes_d)
        self.assertEqual(len(top._marcas), 2)
        top._marcas[1][0].set(True)          # solo el permiso de 1h
        borrados = []
        with mock.patch.object(core, "eliminar_entrada", borrados.append), \
             mock.patch.object(self.app.__class__, "refrescar", lambda s: None), \
             mock.patch.object(_mb(), "askyesno", lambda *a, **k: True):
            [b for b in _botones(top) if "Eliminar" in b.cget("text")][0].invoke()
        self.assertEqual(borrados, ["2"])     # NO se borra el de 6h

    def test_eliminar_todos_de_una(self):
        top = self.dialogos.abrir_eliminar_dia(self.app, self.lunes_d)
        for v, _a in top._marcas:
            v.set(True)
        borrados = []
        with mock.patch.object(core, "eliminar_entrada", borrados.append), \
             mock.patch.object(self.app.__class__, "refrescar", lambda s: None), \
             mock.patch.object(_mb(), "askyesno", lambda *a, **k: True):
            [b for b in _botones(top) if "Eliminar" in b.cget("text")][0].invoke()
        self.assertEqual(sorted(borrados), ["1", "2"])


def _mb():
    import registrar_gui
    return registrar_gui.messagebox


class TestAsociacionActividadTarea(unittest.TestCase):
    """El caso real: elegir «Asuntos propios» debe llevar el apunte a la tarea
    de Permisos, no quedarse en Mantenimientos. OpenProject no sabe de esa
    relación (devuelve las mismas actividades para todas las tareas), así que
    la pone el usuario una vez."""

    MANTEN, PERMISOS = 11754, 12154

    def setUp(self):
        import tkinter as tk
        import registrar_gui
        try:
            self.root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        self.root.withdraw()
        self.addCleanup(self.root.destroy)
        self.cfg = {}
        parches = [
            mock.patch.object(core, "entradas_dia", lambda f: []),
            mock.patch.object(core, "nombre_usuario", lambda: "T"),
            mock.patch.object(core, "_actividades_disponibles",
                              lambda wp: {"Actuaciones técnicas": "/a/1",
                                          "Asuntos propios": "/a/2"}),
            mock.patch.object(core, "FAVORITOS",
                              [{"id": self.MANTEN, "nombre": "Mantenimientos"},
                               {"id": self.PERMISOS, "nombre": "Permisos"}]),
            mock.patch.object(core, "NO_LABORABLES", {}),
            mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync),
            mock.patch.object(core, "config_valor",
                              lambda c, d=None: self.cfg.get(c, d)),
            mock.patch.object(core, "guardar_config_valores", self.cfg.update),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)
        self.app = registrar_gui.App(self.root)
        self.addCleanup(setattr, self.app, "_logo_img", None)

    def test_elegir_la_actividad_lleva_a_su_tarea(self):
        self.app._asociar(self.PERMISOS, "Asuntos propios")
        # Situacion del miercoles 14: se parte de Mantenimientos
        self.app.cbo_tarea.set(f"{self.MANTEN} - Mantenimientos")
        self.app.cbo_act.set("Asuntos propios")
        self.app.cbo_act.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.assertEqual(self.app.tareas.get(self.app.cbo_tarea.get()),
                         self.PERMISOS, "la tarea no saltó a Permisos")
        self.assertIn("Tarea cambiada", self.app.status.cget("text"))

    def test_sin_asociacion_no_toca_nada(self):
        """La app nunca adivina: sin asociación creada, la tarea se queda."""
        self.app.cbo_tarea.set(f"{self.MANTEN} - Mantenimientos")
        self.app.cbo_act.set("Asuntos propios")
        self.app.cbo_act.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.assertEqual(self.app.tareas.get(self.app.cbo_tarea.get()), self.MANTEN)

    def test_cambiar_la_tarea_a_mano_se_respeta(self):
        """La regla salta al tocar la ACTIVIDAD, no en bucle: si luego mueves la
        tarea a mano, se queda donde la dejes."""
        self.app._asociar(self.PERMISOS, "Asuntos propios")
        self.app.cbo_act.set("Asuntos propios")
        self.app.cbo_act.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.app.cbo_tarea.set(f"{self.MANTEN} - Mantenimientos")
        self.app.cbo_tarea.event_generate("<<ComboboxSelected>>")
        self.root.update()
        self.assertEqual(self.app.tareas.get(self.app.cbo_tarea.get()), self.MANTEN)

    def test_la_asociacion_vale_en_los_dos_sentidos(self):
        self.app._asociar(self.PERMISOS, "Asuntos propios")
        self.assertEqual(self.cfg["tareas_actividad"], {"Asuntos propios": self.PERMISOS})
        self.assertEqual(self.cfg["actividades_tarea"], {str(self.PERMISOS): "Asuntos propios"})
        # al elegir la TAREA, se preselecciona su actividad
        self.app._poner_actividades(["Actuaciones técnicas", "Asuntos propios"],
                                    self.PERMISOS)
        self.assertEqual(self.app.cbo_act.get(), "Asuntos propios")
        # y se puede deshacer
        self.app._desasociar("Asuntos propios")
        self.assertEqual(self.cfg["tareas_actividad"], {})


class TestSegundoApunteMismaTarea(unittest.TestCase):
    """Se puede imputar DOS veces la misma tarea el mismo día (p. ej. 6 h de
    trabajo y 1 h de asuntos propios). Antes se saltaba en silencio."""

    def setUp(self):
        import tkinter as tk
        import registrar_gui
        try:
            self.root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        self.root.withdraw()
        self.addCleanup(self.root.destroy)
        self.gui = registrar_gui
        h = dt.date.today()
        self.lunes = (h - dt.timedelta(days=h.weekday())).isoformat()
        # Ese dia YA tiene 6 h imputadas en la tarea 111
        self.ya = [{"id": 1, "wp_id": 111, "horas": 6.0, "wp_titulo": "T",
                    "actividad": "soporte", "comentario": ""}]
        parches = [
            mock.patch.object(core, "entradas_dia",
                              lambda f: self.ya if f == self.lunes else []),
            mock.patch.object(core, "nombre_usuario", lambda: "T"),
            mock.patch.object(core, "_actividades_disponibles",
                              lambda wp: {"soporte": "/x"}),
            mock.patch.object(core, "FAVORITOS", [{"id": 111, "nombre": "Tarea"}]),
            mock.patch.object(core, "NO_LABORABLES", {}),
            mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)
        self.app = registrar_gui.App(self.root)
        self.addCleanup(setattr, self.app, "_logo_img", None)

    def _preparar(self):
        # "Hoy" viene marcado de serie: hay que desmarcar todo y dejar SOLO el
        # lunes, o se crearia un apunte por cada dia marcado.
        for var, _d, _card in self.app.dia_vars:
            var.set(False)
        self.app.dia_vars[0][0].set(True)      # solo el lunes
        self.app.cbo_tarea.set("111 - Tarea")
        self.app.ent_horas.delete(0, "end")
        self.app.ent_horas.insert(0, "1")

    def test_si_confirmas_se_graba_el_segundo_apunte(self):
        self._preparar()
        with mock.patch.object(self.gui.messagebox, "askyesno",
                               lambda *a, **k: True) as _, \
             mock.patch.object(core, "crear_entrada") as m_crear:
            self.app._anadir()
        m_crear.assert_called_once()           # ANTES: no se llamaba nunca
        self.assertEqual(m_crear.call_args.args[0], self.lunes)
        self.assertEqual(m_crear.call_args.args[2], 1.0)

    def test_si_dices_que_no_se_respeta_y_no_duplica(self):
        self._preparar()
        with mock.patch.object(self.gui.messagebox, "askyesno",
                               lambda *a, **k: False), \
             mock.patch.object(core, "crear_entrada") as m_crear:
            self.app._anadir()
        m_crear.assert_not_called()            # se deja el dia como estaba

    def test_avisa_mencionando_las_horas_que_ya_hay(self):
        self._preparar()
        vistos = []
        def espia(titulo, mensaje, *a, **k):
            vistos.append(f"{titulo}|{mensaje}")
            return True
        with mock.patch.object(self.gui.messagebox, "askyesno", espia), \
             mock.patch.object(core, "crear_entrada"):
            self.app._anadir()
        aviso = next((v for v in vistos if "ya tiene horas" in v.lower()), "")
        self.assertTrue(aviso, f"no se avisó del duplicado: {vistos}")
        self.assertIn("6h", aviso)             # dice cuantas horas hay ya


class TestNovedades(unittest.TestCase):
    """El changelog para usuarios: se lee del fichero empaquetado, sin internet."""

    def test_muestra_las_novedades_sin_markdown(self):
        import tkinter as tk
        import registrar_gui
        import dialogos
        try:
            root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        root.withdraw()
        self.addCleanup(root.destroy)
        parches = [
            mock.patch.object(core, "entradas_dia", lambda f: []),
            mock.patch.object(core, "nombre_usuario", lambda: "T"),
            mock.patch.object(core, "_actividades_disponibles",
                              lambda wp: {"soporte": "/x"}),
            mock.patch.object(core, "FAVORITOS", []),
            mock.patch.object(core, "NO_LABORABLES", {}),
            mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)
        app = registrar_gui.App(root)
        self.addCleanup(setattr, app, "_logo_img", None)
        top = dialogos.abrir_novedades(app)
        try:
            texto = top._texto.get("1.0", "end")
            self.assertNotIn("No se encontró", texto)   # el fichero se empaqueta
            self.assertIn("Versión", texto)              # hay cabeceras de version
            self.assertNotIn("**", texto)                # el markdown se limpia
            self.assertNotIn("##", texto)
            # Las lineas partidas del fichero se vuelven a juntar: una viñeta,
            # una linea logica (no trozos sueltos sin sangrar).
            sueltas = [l for l in texto.splitlines()
                       if l.strip() and not l.startswith(("Versión", "•"))
                       and l.strip()[0].islower()]
            self.assertEqual(sueltas, [], f"líneas partidas sin unir: {sueltas[:3]}")
        finally:
            top.destroy()


class TestPieSiempreVisible(unittest.TestCase):
    """Regresión: el pie (conexión/versión en la ventana, botones en el wizard)
    debe quedar visible sin maximizar, a cualquier tamaño."""

    def test_ventana_principal(self):
        import tkinter as tk
        import registrar_gui
        try:
            root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        root.withdraw()
        self.addCleanup(root.destroy)
        parches = [
            mock.patch.object(core, "entradas_dia", lambda f: []),
            mock.patch.object(core, "nombre_usuario", lambda: "T"),
            mock.patch.object(core, "_actividades_disponibles",
                              lambda wp: {"soporte": "/x"}),
            mock.patch.object(core, "FAVORITOS", []),
            mock.patch.object(core, "NO_LABORABLES", {}),
            mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)
        app = registrar_gui.App(root)
        self.addCleanup(setattr, app, "_logo_img", None)
        self.assertEqual(_barras_en_riesgo(root), [])

    def _app(self):
        """Ventana principal lista para abrir diálogos sobre ella."""
        import tkinter as tk
        import registrar_gui
        try:
            root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        root.withdraw()
        self.addCleanup(root.destroy)
        parches = [
            mock.patch.object(core, "entradas_dia", lambda f: []),
            mock.patch.object(core, "nombre_usuario", lambda: "T"),
            mock.patch.object(core, "_actividades_disponibles",
                              lambda wp: {"soporte": "/x"}),
            mock.patch.object(core, "FAVORITOS", []),
            mock.patch.object(core, "NO_LABORABLES", {}),
            mock.patch.object(registrar_gui, "en_hilo", _en_hilo_sync),
        ]
        for p in parches:
            p.start()
            self.addCleanup(p.stop)
        app = registrar_gui.App(root)
        self.addCleanup(setattr, app, "_logo_img", None)
        return root, app

    def test_dialogos(self):
        """Cada diálogo, por separado: ninguna barra de botones debe poder
        quedar fuera. Así una ventana nueva con el patrón malo salta aquí."""
        import tkinter as tk
        import dialogos
        root, app = self._app()
        dia = dt.date(2026, 7, 6)
        casos = [
            ("resumen del mes", lambda: dialogos.abrir_resumen_mes(app)),
            ("plantillas", lambda: dialogos.abrir_plantillas(app)),
            ("buscar tarea", lambda: dialogos.abrir_buscar_tarea(app)),
            ("exportar CSV", lambda: dialogos.abrir_exportar(app)),
            ("importar festivos", lambda: dialogos.abrir_importar_festivos(app)),
            ("vacaciones y teletrabajo", lambda: dialogos.abrir_ajustes_dias(app)),
            ("integraciones (INARI)", lambda: dialogos.abrir_integraciones(app)),
            ("permisos (horas)", lambda: dialogos.abrir_permisos(app)),
            ("novedades", lambda: dialogos.abrir_novedades(app)),
            ("permiso por horas de un dia",
             lambda: dialogos.abrir_permiso_dia(app, dia)),
        ]
        # `en_hilo` sincrono hace que las cargas terminen DURANTE la construccion
        # del dialogo; si fallan, algunos se autodestruyen y el test se rompe por
        # un motivo que no existe en la app real (alli van en un hilo). Por eso se
        # devuelven datos validos en vez de dejar que reviente la red.
        silencio = [
            mock.patch.object(dialogos, "en_hilo", _en_hilo_sync),
            mock.patch.object(core, "proyectos",
                              lambda: [{"id": 1, "nombre": "Proyecto de prueba"}]),
            mock.patch.object(core, "tareas_proyecto", lambda pid: []),
            mock.patch.object(core, "buscar_wp", lambda t: []),
            mock.patch.object(dialogos.messagebox, "showinfo", lambda *a, **k: None),
            mock.patch.object(dialogos.messagebox, "showwarning", lambda *a, **k: None),
            mock.patch.object(dialogos.messagebox, "showerror", lambda *a, **k: None),
        ]
        for p in silencio:
            p.start()
            self.addCleanup(p.stop)

        revisados = []
        for nombre, abrir in casos:
            previos = {w for w in root.winfo_children()
                       if isinstance(w, tk.Toplevel)}
            abrir()
            nuevos = [w for w in root.winfo_children()
                      if isinstance(w, tk.Toplevel) and w not in previos]
            self.assertTrue(nuevos, f"«{nombre}» no abrió ninguna ventana")
            for top in nuevos:
                top.update_idletasks()
                self.assertEqual(_barras_en_riesgo(top, nombre), [],
                                 f"«{nombre}»: una barra inferior puede quedar fuera")
                # Y al encogerlo: ningún botón debe salirse de la ventana. Los
                # diálogos abren ajustados a su contenido, así que esto solo pasa
                # si el usuario arrastra el borde; no_encoger() lo impide.
                for ancho, alto in ((320, 220), (480, 320)):
                    top.geometry(f"{ancho}x{alto}+20+20")
                    top.update_idletasks()
                    top.update()
                    limite = top.winfo_rooty() + top.winfo_height()
                    fuera = [b.cget("text") for b in _botones(top)
                             if b.winfo_ismapped()
                             and b.winfo_rooty() + b.winfo_height() > limite + 1]
                    self.assertEqual(fuera, [],
                                     f"«{nombre}» a {ancho}x{alto}: botones fuera")
                top.destroy()
            revisados.append(nombre)
        self.assertEqual(len(revisados), len(casos))

    def test_wizard_configurador(self):
        import tkinter as tk
        import configurar_gui
        try:
            root = tk.Tk()
        except tk.TclError:
            self.skipTest("sin entorno grafico")
        root.withdraw()
        self.addCleanup(root.destroy)
        with mock.patch.object(configurar_gui.ccore, "cargar_previa", lambda: {}):
            wz = configurar_gui.Wizard(root)
        self.addCleanup(setattr, wz, "_logo", None)
        wz.idx = len(wz.pasos) - 1          # el resumen, el paso más alto
        wz.mostrar()
        self.assertEqual(_barras_en_riesgo(root), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
