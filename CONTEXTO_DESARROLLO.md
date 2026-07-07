# Contexto de desarrollo - FichaCSIRC

App de escritorio (Windows, Python/Tkinter) para fichar horas en OpenProject
(instancia ProyectosTic de la UGR) vía su API REST v3. Ver `README.md` para la
definición completa y el historial de decisiones.

## Estructura
- `rellenar_horas.py` — motor (API + lógica) y app de consola.
- `configurar.py` — utilidades de API compartidas + configurador de consola.
- `registrar_gui.py` — ventana principal de registro (importa `rellenar_horas`).
- `dialogos.py` — ventanas secundarias (buscar, exportar, editar, resumen, plantillas);
  cada función recibe la `App` y opera sobre ella.
- `fichaui.py` — utilidades de UI sin lógica de negocio (`Tooltip`, `en_hilo`, recursos).
- `recordatorio.py` — aviso de fichaje: comprobación suelta + alta/baja de la tarea
  programada de Windows (`schtasks`). La app lo lanza con `--recordatorio`.
- `configurar_gui.py` — asistente gráfico (wizard); importa `configurar`.
- Lanzadores `.bat` (detectan Python, evitan el alias de la Microsoft Store).
- `build_exe.bat` — empaqueta Windows con PyInstaller (`--onefile`); CI en `.github/workflows`.
- `build_macos.sh` — empaqueta macOS como `.app` y ZIP; CI genera artefactos `arm64` y `x64`.
- `instalador.iss` + `build_instalador.bat` — instalador único (Inno Setup); la CI
  lo genera y publica junto a los `.exe` en cada Release.

## Reglas / cuidado
- **Nunca** subir `config.json` (contiene la API key). Usar `config.example.json`.
- API OpenProject v3: auth Basic con usuario `apikey`; horas en ISO 8601 (`PT7H`).
- Las actividades se resuelven vía `POST /api/v3/time_entries/form`
  (el endpoint `available_time_entry_activities` da 404 en esta instancia).
- 403 al listar tareas de un proyecto = sin permiso (normal), tratar con aviso amable.
- La config vive junto al script. En apps empaquetadas se guarda en `%APPDATA%\FichaCSIRC`
  en Windows y `~/Library/Application Support/FichaCSIRC` en macOS; la variable de entorno
  `FICHACSIRC_CONFIG` puede apuntar a otra ruta (la usan los tests).
- El recordatorio diario automatico usa `schtasks` en Windows y un LaunchAgent
  de usuario (`launchd`) en macOS.

## Hecho recientemente
- Revisión UX aplicada (jul 2026): quick wins + llamadas a la API en hilos en la
  GUI (`_en_hilo` en `registrar_gui.py`), caché de apuntes por semana, exportación
  CSV en la GUI, "Copiar día anterior", selección múltiple, validaciones del wizard.
- v2.0 (jul 2026): editar apuntes (PATCH), deshacer borrado, resumen mensual,
  días no laborables y plantillas (persisten en config.json), paginación por offset
  (`_get_todos`), reintento de GETs, log en `fichacsirc.log`, build `--onefile`.
- v2.1 (jul 2026): GitHub + release automática por etiqueta, aviso de actualización
  (una vez/día), pie con versión/build/repo. Modularización de la GUI (`dialogos.py`,
  `fichaui.py`). Recordatorio de fichaje (`recordatorio.py`, tarea programada).
  Bug corregido: caché de actividades ahora POR wp_id (antes global). Lectura de
  config tolerante a BOM (`utf-8-sig`).
- v2.1.6 (jul 2026): arreglada la actualización que dejaba la versión antigua.
  Causa: el aviso `--recordatorio` podía quedarse días en segundo plano (messagebox
  invisible) bloqueando `FichaCSIRC.exe`. Ahora el aviso es una ventana topmost con
  autocierre (10 min); el instalador cierra procesos con reintentos en
  `InitializeSetup` Y `PrepareToInstall`, el desinstalador también los cierra y borra
  la tarea programada, y la carpeta es siempre `{localappdata}\Programs` (evita la
  doble instalación si se ejecuta como admin). La cadena del actualizador ya no hace
  `taskkill` (con `/T` podía matarse a sí misma); de cerrar procesos se encarga el
  instalador.
- v2.1.7 (jul 2026): eliminar con multiselección borra TODOS los apuntes
  seleccionados (antes solo `sel[0]`) y Deshacer restaura el lote completo.
- v2.2.0 (jul 2026): el actualizador lanza el instalador con `Popen([ruta])`
  directo — la cadena `cmd /c ... start` mangleaba las comillas (`\"` no es
  escape para cmd) y `start` buscaba el archivo «\\». OJO: en Windows los temas
  ttk ignoran el fondo de los botones; los botones con color usan `tk.Button`
  vía `fichaui.boton_primario/boton_peligro` (en macOS devuelven ttk nativo).
  Revisión UI: fondo gris con paneles-tarjeta, navegación `← Hoy →` agrupada,
  título de semana grande, banda azul en la tarjeta de "hoy" (widgets con
  `_fijo=True` no se repintan en `_pintar_sel`), formulario realineado.
- v2.3.0 (jul 2026): total semanal en el título; búsqueda global de tareas
  ("Buscar en todo", `buscar_wp` ahora lanza excepción y el caller avisa);
  Importar festivos (`FESTIVOS_CONOCIDOS`, revisar cada año los traslados);
  comentario habitual por tarea (`comentarios_tarea` en config); aviso diario
  también en macOS (LaunchAgent, `recordatorio._plist_contenido`); menú
  "Copiar / Plantillas ▾" agrupa las copias; tooltip con el comentario completo
  en la tabla (`fichaui.TooltipFilas`); atajos Ctrl+←/→ y Alt+1..5 (Ayuda >
  Atajos); tests de acciones de GUI (`test_gui_acciones.py`, en_hilo síncrono).
- v2.3.1 (jul 2026): Resumen del mes rediseñado (`dialogos.abrir_resumen_mes`):
  navegación ← → entre meses, barra de progreso, cifras grandes, estado en
  color y días incompletos en tabla con doble clic para ir a su semana.
  Devuelve el Toplevel y expone `top._resumen` para los tests.
- v2.3.2 (jul 2026): el instalador ya no ofrece abrir `INSTRUCCIONES.md` como
  `.txt` (`isreadme` fuera); en su lugar, casilla postinstall opcional que abre
  las instrucciones renderizadas en GitHub (`shellexec`).
- v2.3.3 (jul 2026): la jornada admite medias horas (4.5) en el wizard y en el
  configurador de consola (`_num_jornada`/`_fmt_jornada`, `preguntar_numero`); el
  motor ya soportaba floats. El instalador no ofrece "Configurar ahora" cuando es
  una actualización (función `EsActualizacion` mira si existe el `config.json`).
- v2.4.0 (jul 2026): módulo de días especiales. Festivos **calculados por año**
  (`_pascua` Gauss; `festivos_del_anio` con ámbitos nacional/andalucia/local:
  incluye 28-feb, Toma de Granada 2-ene y Corpus=Pascua+60). Diálogo "Importar
  festivos" con casillas por ámbito (`dialogos.abrir_importar_festivos`). Días
  propios UGR en config `dias_ugr` (Navidad/Semana Santa/San Pascual/Feria,
  **a rellenar con el calendario laboral PTGAS**, se trasladan y no se calculan).
  Vacaciones: color morado (`es_vacaciones`), cupo libre `cupo_vacaciones` y
  contador `vacaciones_usadas`. Modalidades independientes que NO cambian objetivo:
  guardia (`GUARDIAS`, comentario "Servicio de Guardia" autorrelleno) y teletrabajo
  (`TELETRABAJO`, cupo semanal `teletrabajo_por_semana`, aviso suave). Chips en la
  tarjeta, leyenda bajo la semana, contador teletrabajo en el título. Diálogo
  "Vacaciones y teletrabajo" (`dialogos.abrir_ajustes_dias`). Fichar en día no
  laborable avisa claro (no "0h") y nunca bloquea. El wizard admite medias horas.
- v2.4.1 (jul 2026): correcciones de la revisión multi-agente de v2.4.0.
  **Festivos en domingo se trasladan al lunes** en `festivos_del_anio` (la tabla
  fija que se sustituyó ya los llevaba: sin esto se perdían 02/11 y 07/12 de 2026
  y el 01/03/2027 de Andalucía); el diálogo avisa de que el traslado real lo
  decide la Junta. **`finalizar()` del wizard fusiona con `cargar_previa()`**
  (antes volcaba un dict fijo y borraba no_laborables/guardias/plantillas/etc. al
  re-ejecutarlo). **Comentario de guardia por-día** en `_anadir` (`comentario_para`):
  en multi-día ya no se cuela en días normales ni se persiste como comentario
  habitual. Chips y banda de "hoy" clicables (bindings). `repintar_local()`:
  marcar festivo/guardia/teletrabajo repinta desde caché sin relanzar los 5 GET.
  `parsear_numero` compartido (consola+wizard) rechaza NaN/inf; validación de
  rangos y OverflowError en "Vacaciones y teletrabajo" (`guardar_config_valores`
  en lote). Estilo `PanelMuted.TLabel` y `chip_modalidad` en fichaui (superficies
  correctas en leyenda y diálogos nuevos). `MOTIVO_VACACIONES` como constante.
  Tests: eliminada la clase `TestFestivos` duplicada que sombreaba 2 tests,
  `_hoy` mockeado (no dependen del reloj), `festivos_pendientes` solo ofrece el
  año siguiente a partir de noviembre; tests nuevos de traslados, wizard y
  comentario de guardia (65 en total).

## Tests
- `python -m unittest discover -s tests -t .` (o `run_tests.bat`). Cubren el motor
  (duraciones ISO, jornada/verano, parsing/paginación de la API, payloads, pendientes)
  con la red mockeada, más un smoke test de la GUI (`test_gui_smoke.py`, se salta sin
  display). Ejecutarlos tras tocar el motor o la GUI.

## Pendiente / ideas
- Rellenar la config `dias_ugr` con el calendario laboral PTGAS oficial cada año
  (San Pascual, Feria del Corpus, cierres de Navidad/Semana Santa).
- Posible versión Tauri/Rust si se quiere un ejecutable más ligero/pulido.
- Integración con INARI como destino de registro por API Kanboard.
  Ver `MEJORAS_PENDIENTES.md`.
