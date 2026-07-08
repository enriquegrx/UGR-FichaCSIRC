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
- `build_exe.bat` — empaqueta Windows con PyInstaller (`--onedir --noupx`, modo
  carpeta: el `.exe` + su `_internal`); CI en `.github/workflows`.
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

- v2.4.2 (jul 2026): icono con fondo blanco redondeado (`fichacsirc.ico`/`.png`):
  antes era transparente y no se veía en escritorios con fondo oscuro.

## Tests
- `python -m unittest discover -s tests -t .` (o `run_tests.bat`). Cubren el motor
  (duraciones ISO, jornada/verano, parsing/paginación de la API, payloads, pendientes)
  con la red mockeada, más un smoke test de la GUI (`test_gui_smoke.py`, se salta sin
  display). Ejecutarlos tras tocar el motor o la GUI.

## Pendiente / ideas
- Rellenar la config `dias_ugr` con el calendario laboral PTGAS oficial cada año
  (San Pascual, Feria del Corpus, cierres de Navidad/Semana Santa).
- Posible versión Tauri/Rust si se quiere un ejecutable más ligero/pulido.
- v2.5.0 (jul 2026): **Integración con INARI (Kanboard) para los días de
  teletrabajo en SisGes**, opt-in (`inari_activo`, por defecto false). Diseño en
  `MEJORAS_PENDIENTES.md`. Piezas: `inari.py` (cliente JSON-RPC puro, credenciales
  por argumento, lectura+escritura de tareas/slots), `destinos.py` (puente
  config-aware ProyectosTIC/INARI), validación pura de franjas en
  `rellenar_horas` (`parsear_hora`/`duracion_horas`/`validar_franjas`).
  UI: `dialogos.abrir_integraciones` (Herramientas), `dialogos.abrir_slot_inari`
  (registrar slot desde el botón derecho de un día de teletrabajo), dos
  indicadores de conexión en el pie (`● ProyectosTIC / ● INARI`). Un día de
  teletrabajo lee/cuenta las horas de INARI (tarjeta, tabla con `destino`,
  resumen con dos cubos); el borrado enruta a INARI; editar un slot = borrarlo y
  volver a registrarlo. Tests: `test_inari.py`, `test_destinos.py`, `TestFranjas`,
  `TestGuiInari` (104 en total). **Nota**: las formas de escritura de Kanboard
  (createTask/createSubtask) se basan en la doc estándar; validar en uso real.
- v2.6.0 (jul 2026): **INARI cambia a modelo "tarea por slot"**. El problema del
  modelo anterior (tarea diaria + subtareas) era que columna/carril/categoría
  eran globales de config, pero pueden variar por día e incluso por slot. Ahora
  **cada slot es una tarea independiente** de Kanboard con su columna/carril/
  categoría y un marcador de día en `reference` = `TT-AAAA-MM-DD`; las horas van
  en `time_spent` **de la tarea** (nunca en subtareas: `SubtaskTimeTrackingModel`
  sobreescribiría el `time_spent` de la tarea). El modelo de escritura se
  **verificó contra el código fuente de Kanboard v1.2.50** (workflow de 4
  agentes): `createTask` con params NOMBRADOS (`time_spent` es el posicional 21),
  lectura por `searchTasks` `ref:<marcador> status:open`, edición con `updateTask`
  (clave `id`), mover columna/carril con `moveTaskPosition` (clave `task_id`),
  borrado con `removeTask`. En `inari.py`: `crear_slot`/`slots_dia`/`editar_slot`/
  `mover_slot`/`borrar_slot` (se retiran `buscar_tarea`/`crear_tarea`/
  `tarea_del_dia`/`slots`/`actualizar_slot` y las subtareas). `destinos.py`:
  `ref_dia`, `slots_dia` devuelve lista (ya no `(tid, ss)`), `registrar`/`editar`
  aceptan clasificación por slot. La config de Herramientas > Integraciones deja
  columna/carril/categoría como **valor por defecto**; el diálogo de registrar
  slot añade esos tres desplegables, prerrellenados con el último usado
  (`inari_last_*`) o el de config. Tests adaptados (105 en total).
- v2.6.1 (jul 2026): **la actualización vuelve a abrir la app**. El instalador
  no relanzaba `FichaCSIRC.exe` al terminar una actualización (la app se cierra
  para poder actualizarse y quedaba sin abrir). Nueva entrada en `[Run]` de
  `instalador.iss` sin `postinstall` (se ejecuta al final de la copia, no es una
  casilla) con `Check: EsActualizacion` y `runasoriginaluser` (no la abre
  elevada si el instalador se lanzó como admin); en instalación nueva no se
  relanza (aún hay que configurar). **Indicador del pie**: el de ProyectosTIC
  mostraba el estado como texto ("Conectado"/"Sin conexión"); ahora muestra
  siempre el nombre `● ProyectosTIC` y refleja el estado solo con el color, igual
  que el de `● INARI` (`_poner_conexion`). **Cabecera**: el subtítulo pasa de
  "Registro de horas - OpenProject" a "- ProyectosTIC", y añade " e INARI" cuando
  la integración está activa (`destinos.inari_activo()`).
- v2.6.2 (jul 2026): **arreglado el relanzado tras actualizar** que introdujo la
  2.6.1. La entrada `[Run]` usaba `nowait runasoriginaluser` (sin `postinstall`):
  `runasoriginaluser` re-spawnea el proceso y rompe el traspaso del temporal
  `_MEI` del `.exe` onefile de PyInstaller → "Failed to load Python DLL
  ...\_MEIxxxx\python312.dll. LoadLibrary: no se encuentra el módulo". El .exe en
  sí estaba bien (abría por icono); solo fallaba el auto-lanzado del instalador.
  Ahora es una casilla `postinstall skipifsilent` MARCADA por defecto ("Abrir
  FichaCSIRC al terminar"), lanzada en el contexto normal del usuario, con
  `Check: EsActualizacion` (solo en actualizaciones). Regla: **nunca**
  `runasoriginaluser` con exes onefile de PyInstaller.
- v2.6.3 (jul 2026): **retirado el auto-lanzado de la app tras actualizar**. La
  casilla de 2.6.2 (sin `runasoriginaluser`) seguía dando "Failed to load Python
  DLL ...\_MEIxxxx\python312.dll" al abrir el `.exe` onefile **recién instalado y
  sin firmar justo al terminar el instalador**: la DLL extraída al temporal `_MEI`
  no carga (típicamente el antivirus la bloquea en esa secuencia). El `.exe`
  funciona bien abierto por su icono; el problema era solo ese contexto de
  lanzamiento. Se elimina la entrada `[Run]` de relanzado; tras actualizar, el
  usuario abre la app desde el acceso directo. Vía robusta pendiente si se
  quisiera reabrir sola: empaquetar en `--onedir` (evita la extracción a `%TEMP%`
  y toda esta familia de errores). Diagnóstico apoyado en un workflow de
  investigación (UPX/antivirus/onedir/dependencias).
- v2.6.4 (jul 2026): **build en modo carpeta (`--onedir`)** para las dos apps, que
  **elimina de raíz** el error "Failed to load Python DLL ...\_MEIxxxx\python312.dll".
  Con onedir el `.exe` carga su `python312.dll` (y `VCRUNTIME140*.dll`) desde su
  carpeta `_internal` contigua, **sin extraer nada a `%TEMP%\_MEI`**, que era el
  paso que el antivirus bloqueaba al lanzar el `.exe` recién instalado. Verificado
  **en local** (misma máquina/AV): ambos `.exe` arrancan y abren su ventana.
  `release.yml`: `--onefile`→`--onedir --noupx` en los dos builds, `pyinstaller`
  fijado a `==6.21.0` (reproducible), y se publica solo el instalador (ya no hay
  `.exe` sueltos: el exe necesita su `_internal` al lado). `instalador.iss`:
  `[Files]` copia recursiva de `dist\FichaCSIRC\*` y `dist\FichaCSIRC-Configurar\*`
  a `{app}\<App>\`, `[Icons]`/`UninstallDisplayIcon`/`[Run]` apuntan al exe dentro
  de su carpeta con `WorkingDir`, e `[InstallDelete]` borra los `.exe` sueltos de
  instalaciones onefile viejas. Como onedir ya es seguro, **se recupera el
  "abrir FichaCSIRC al terminar"** tras actualizar (casilla marcada). `build_exe.bat`
  actualizado a onedir. Regla: para apps distribuidas por instalador, **preferir
  `--onedir`** (sin extracción a temporal, sin esta clase de fallos, arranque más
  rápido); onefile solo para binario portable suelto.
