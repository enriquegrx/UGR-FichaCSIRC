# Contexto de desarrollo - FichaCSIRC

App de escritorio (Windows, Python/Tkinter) para fichar horas en OpenProject
(instancia ProyectosTic de la UGR) vía su API REST v3. Ver `README.md` para la
definición completa y el historial de decisiones.

## Estructura
- `rellenar_horas.py` — motor (API + lógica) y app de consola.
- `configurar.py` — utilidades de API compartidas + configurador de consola.
- `registrar_gui.py` — ventana principal de registro (importa `rellenar_horas`).
- `dialogos.py` — ventanas secundarias (buscar, exportar, editar, resumen, plantillas,
  permisos, integraciones); cada función recibe la `App` y opera sobre ella.
- `fichaui.py` — utilidades de UI sin lógica de negocio (`Tooltip`, `en_hilo`, recursos).
- `inari.py` — cliente JSON-RPC puro de INARI (Kanboard): credenciales por argumento,
  no importa el resto de la app; slots (tarea por franja) y descubrimiento del tablero.
- `destinos.py` — puente config-aware entre ProyectosTIC (OpenProject) e INARI; lo usan
  la ventana, el resumen del mes y el aviso de fichaje.
- `recordatorio.py` — aviso de fichaje: comprobación suelta + alta/baja de la tarea
  programada de Windows (`schtasks`). La app lo lanza con `--recordatorio`.
- `configurar_gui.py` — asistente gráfico (wizard); importa `configurar`.
- Lanzadores `.bat` (detectan Python, evitan el alias de la Microsoft Store).
- `build_exe.bat` — empaqueta Windows con PyInstaller (`--onedir --noupx`, modo
  carpeta: el `.exe` + su `_internal`); CI en `.github/workflows`.
- `build_macos.sh` — empaqueta macOS como `.app` y ZIP; CI genera artefactos `arm64` y `x64`.
- `instalador.iss` + `build_instalador.bat` — instalador único (Inno Setup); la CI lo
  genera y lo publica como **único artefacto Windows** de cada Release. Ya NO se
  publican `.exe` sueltos: con `--onedir` el ejecutable necesita su `_internal` al
  lado. Es también lo que descarga el autoactualizador.

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
- v2.7.0 (jul 2026): **permisos por horas**. El portal de
  personal mide casi todos los permisos en HORAS (asuntos particulares 70:00,
  compensación por servicios mínimos 56:00, conciliación 30:00), no en días; la
  app solo sabía marcar el día entero. Ahora un permiso **resta horas al objetivo
  del día**: `objetivo_de` = `max(0, jornada - horas_permiso(fecha))` (un día no
  laborable sigue mandando y da 0). Motor: `PERMISOS` (config `permisos`:
  fecha → `[{tipo, horas}]`), `PERMISOS_TIPOS_DEFECTO` sobrescribible por config
  `permisos_tipos`, `parsear_horas` (admite `3:30`,
  `3,5` y totales > 24 h como `70:00`), `fmt_horas_hhmm`, `anadir_permiso` (valida
  que el total del día no pase de la jornada), `quitar_permiso`, `permiso_usadas`,
  `permiso_disponible`, `resumen_permisos`.
  **Las horas de un tipo NO son un cupo fijo**: se conceden en bolsas
  (`concesiones`: `[{horas, fecha_limite}]`), porque los servicios extraordinarios
  van sumando horas y cada bolsa caduca por su cuenta (el portal las muestra como
  subfilas). `cupo_total` = suma de concesiones; `anadir_concesion` /
  `quitar_concesion` / `_guardar_tipos` (migra el modelo viejo de `cupo` único, que
  `concesiones()` sigue leyendo). `concesiones_caducadas` y
  `concesiones_por_caducar` (`DIAS_AVISO_CADUCIDAD`) **solo avisan: la caducidad
  nunca descuenta horas sola** (decisión de producto). UI: menú contextual del día
  «Añadir permiso por horas…» / «Quitar permiso», chip ámbar `🕐 Permiso H:MM` en
  la tarjeta (con tooltip por tipo) y en la leyenda, y diálogo
  `dialogos.abrir_permisos` (Herramientas > Permisos): una caja por tipo con sus
  concesiones, «＋ Añadir concesión» (`_pedir_concesion`) y «Quitar»; guardan al
  momento. No hay API que exponga estos saldos: se teclean.
  **Cambio de comportamiento**: «asuntos propios» desaparece del submenú de días
  no laborables (ahora es un permiso por horas, para que descuente del cupo de
  70:00); en su lugar el submenú ofrece «apertura de curso». Los días ya marcados
  como «asuntos propios» en `no_laborables` siguen funcionando. Las **vacaciones
  siguen en días** (`cupo_vacaciones`). Tests: `TestPermisos` (17) + test del
  diálogo de permisos (123 en total).
- v2.7.1 (jul 2026): **el pie del configurador queda siempre visible**. En el
  wizard (`configurar_gui._shell`) el pie (Atrás/Siguiente/Finalizar) se
  empaquetaba DESPUÉS del contenido (`expand=True`), así que un paso alto (el
  resumen con muchas favoritas) empujaba los botones fuera de la ventana y había
  que maximizar para ver Finalizar o Atrás. Ahora el pie se empaqueta antes y con
  `side="bottom"` (queda reservado abajo, con un separador), y el contenido ocupa
  el hueco restante. El resumen (`p_resumen`) además limita la lista de favoritas
  a 10 (+ «y N más»). Verificado a 640×580 con 25 favoritas.
- v2.7.2 (oct 2026): **el pie de la ventana principal queda siempre visible** y la
  app **arranca maximizada**. Mismo fallo que el wizard: en `registrar_gui._construir`
  la `barra` de estado (indicadores `● ProyectosTIC` / `● INARI`, versión, GitHub) se
  empaquetaba DESPUÉS de `midf` (`expand=True`), así que sin maximizar el contenido
  se comía su hueco y el pie desaparecía. Ahora la `barra` se crea y empaqueta antes
  de `midf`; sus hijos se rellenan después. Nuevo `App._maximizar()` (`state("zoomed")`
  en Windows, `-zoomed` en X11, tamaño de pantalla en macOS, con fallbacks) — la
  geometría guardada sigue valiendo como tamaño restaurado.
  **Auditoría del patrón en todo el proyecto** (analizador AST que compara solo
  widgets del mismo padre y distingue expansión vertical): 0 casos restantes en
  `registrar_gui`, `configurar_gui` y `dialogos`; diálogos verificados en ejecución
  encogiéndolos. **Regresión cubierta**: `TestPieSiempreVisible` + el helper
  `_barras_en_riesgo`, que recorre el árbol de widgets y falla si una barra
  `side="bottom"` va tras un expansible del mismo padre (validado contra un layout
  roto a propósito). 125 tests.
- v2.7.3 (oct 2026): la regresión del pie **cubre también los diálogos**
  (`TestPieSiempreVisible.test_dialogos`): abre los 9 diálogos, les pasa
  `_barras_en_riesgo` y además **los encoge** (320×220 y 480×320) comprobando que
  ningún botón se sale. Eso destapó dos casos reales y más suaves (abren ajustados,
  así que solo fallaban si el usuario arrastraba el borde): «Vacaciones y
  teletrabajo» e «Integraciones (INARI)» dejaban fuera Guardar/Cancelar. Arreglados
  con `fichaui.no_encoger(ventana)`, que fija `minsize` al tamaño que pide el
  contenido. Ambas comprobaciones validadas contra el código roto a propósito.
  Nota para el test: con `en_hilo` síncrono las cargas terminan **durante** la
  construcción del diálogo y alguno se autodestruye al fallar (`abrir_buscar_tarea`),
  cosa que no pasa en la app real; por eso el test mockea `core.proyectos`,
  `tareas_proyecto` y `buscar_wp`. 126 tests.
- v2.7.4 (oct 2026): **las actividades dependen de la tarea elegida**.
  `_cargar_actividades` solo se llamaba UNA vez al arrancar y además con
  `FAVORITOS[0]`, así que el desplegable mostraba siempre las actividades de la
  primera favorita, cambiases de tarea o no. En OpenProject las actividades se
  definen POR work package, así que podías elegir una que esa tarea no admite
  (p. ej. «Asuntos propios» sobre «Mantenimientos»). Ahora `_actividades_de_tarea()`
  recarga la lista al cambiar de tarea (`<<ComboboxSelected>>` con `add="+"`, en
  segundo plano; `core._actividades_disponibles` ya cachea por wp_id). Además se
  **recuerda la actividad usada con cada tarea** (`actividades_tarea` en config,
  espejo de `comentarios_tarea`): `_recordar_actividad` al crear el apunte y
  preselección en `_poner_actividades(nombres, wp_id)`, con caída a
  `ultima_actividad`. Tests: `TestActividadesPorTarea` (2), que dispara el evento
  real del desplegable para que falle también si se pierde el binding (validado
  retirándolo a propósito). 128 tests.
  Contexto del hallazgo (consultado contra la API real de ProyectosTIC): en ATE
  los permisos se imputan sobre `#12154 [PERMISOS] Permisos (Asuntos propios y
  bajas)`, hija de `[ATE] Otros` (`#11763`), distinguiendo el tipo por la
  ACTIVIDAD («Asuntos propios» / «Baja»); el estado «Bloquead@» de la tarea no
  impide imputar (validado con `POST /time_entries/form`, sin crear nada). Las
  **vacaciones no tienen tarea ni actividad**: no se imputan, y la app ya las
  trata como día no laborable, que es lo correcto.
- v2.7.5 (oct 2026): **fijar la actividad de una tarea** y **visor de novedades**.
  (1) El aprendizaje de `actividades_tarea` solo surtía efecto tras imputar una
  vez; ahora con **botón derecho sobre el desplegable de Actividad** se fija al
  instante (`_menu_actividad` / `_fijar_actividad`). No es un mecanismo nuevo:
  escribe en la MISMA clave que lee `_poner_actividades`, así que la fontanería
  ya estaba probada. Nota: en esta instancia **todas las tareas ofrecen las mismas
  8 actividades** (están definidas por proyecto, no por tarea), así que la recarga
  de v2.7.4 no cambia la lista visiblemente; lo útil es la preselección.
  (2) Nuevo `NOVEDADES.md` (changelog en lenguaje llano, para usuarios) que se
  empaqueta con `--add-data` y se muestra en **Ayuda → Novedades**
  (`dialogos.abrir_novedades`), para no mandar a nadie a los mensajes de commit de
  GitHub. El visor **vuelve a unir las líneas partidas a 80 columnas** del fichero;
  si no, cada trozo se pintaba como párrafo suelto y perdía la sangría de su
  viñeta. Tests: `TestNovedades` + el diálogo entra en la batería de
  `test_dialogos`. 130 tests.

- v2.7.6 (oct 2026): **arreglado el salto silencioso del segundo apunte**. En
  `_anadir`, si el día ya tenía un apunte de ESA tarea, el nuevo se descartaba
  (`saltados += 1; continue`) **sin avisar**: imputar 6 h de trabajo y luego 1 h
  de asuntos propios en la misma tarea no grababa nada. La regla existía para
  evitar duplicar al aplicar a varios días, pero impedía un caso legítimo (imputar
  en dos tramos). Ahora se pregunta (`permitir_repetir`): «Sí» lo añade, «No»
  mantiene el comportamiento anterior. Efecto colateral corregido: el aviso de
  jornada superada ignoraba esos días por considerarlos saltados; ahora los cuenta
  si se van a añadir. Tests: `TestSegundoApunteMismaTarea` (3) — ojo, «hoy» viene
  marcado de serie, así que el test desmarca todo antes de elegir un día.
  Además: datos del desarrollador en **Ayuda → Acerca de**, y `NOVEDADES.md`
  completado con una entrada por versión de la 2.7.0 a la 2.7.6. 133 tests.

## Tests
- `python -m unittest discover -s tests -t .` (o `run_tests.bat`). **123 tests** con la
  red mockeada, repartidos así:
  - `test_fichacsirc.py` (81) — motor: duraciones ISO, jornada/verano, parsing y
    paginación de la API, payloads, pendientes, festivos, franjas y permisos.
  - `test_inari.py` (23) — cliente JSON-RPC de INARI (lectura y escritura).
  - `test_destinos.py` (9) — puente ProyectosTIC/INARI.
  - `test_gui_acciones.py` (9) — acciones reales de la GUI (con `en_hilo` síncrono).
  - `test_gui_smoke.py` (1) — arranque de la ventana; se salta sin display.
- Ejecutarlos tras tocar el motor o la GUI.

## Pendiente / ideas
- Rellenar la config `dias_ugr` con el calendario laboral PTGAS oficial cada año
  (San Pascual, Feria del Corpus, cierres de Navidad/Semana Santa).
- Posible versión Tauri/Rust si se quiere un ejecutable más ligero/pulido.
