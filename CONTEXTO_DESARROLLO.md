# Contexto de desarrollo - FichaCSIRC

App de escritorio (Windows y macOS) para fichar horas en OpenProject (instancia
ProyectosTic de la UGR) vía su API REST v3. Desde la **3.0** la interfaz es HTML
en una ventana pywebview; la lógica sigue en Python. Ver `README.md` para la
definición completa y el historial de decisiones.

## Estructura
- **`registrar_web.py`** — LA APP (3.0): ventana pywebview + clase `Api` (lo único
  que ve el JS, como `window.pywebview.api`). Toda la lógica en Python; el JS
  solo pinta. Incluye asistente (`cfg_*`, `--configurar`, y se abre solo sin
  config), aviso (`--recordatorio`) y actualizaciones. `EXPERIMENTO` (False en
  producción) aísla la config y bloquea instalar/programar el aviso.
- **`web/`** — interfaz: `index.html`+`app.js` (ventana), `dialogos.js` (un único
  `dialogo()` con pie siempre visible), `configurar.html/js`, `aviso.html/js`,
  `comun.js` (el, llamar, preguntar), `app.css`. `demo.js` simula la Api solo con
  `?demo` (diseño sin red). **Nunca `innerHTML`** con datos: hay test.
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
- `registrar_gui.py`, `dialogos.py`, `fichaui.py`, `configurar_gui.py` son la
  interfaz **Tkinter anterior a la 3.0**: ya no se empaquetan; se conservan de
  referencia (sus tests siguen) hasta decidir retirarlos.
- Lanzadores `.bat` (detectan Python, evitan el alias de la Microsoft Store).
- `build_exe.bat` — empaqueta Windows con PyInstaller (`--onedir --noupx`, modo
  carpeta: el `.exe` + su `_internal`); CI en `.github/workflows`.
- `build_macos.sh` — empaqueta macOS como `.app` y `.dmg`; CI genera `arm64` y `x64`.
- `.github/workflows/experimento.yml` — en ramas `experimento/**` construye lo
  mismo que la release (instalador + dmg) como artefactos, sin publicar.
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

## Al cerrar una version (checklist, NO saltarse)
Se ha olvidado varias veces y la documentacion queda mintiendo. Antes de etiquetar:
1. `VERSION` en `rellenar_horas.py` **y** las 4 cadenas de `version_info.txt`.
2. **`NOVEDADES.md`**: una entrada de la version en lenguaje llano (Mejoras /
   Correcciones). Es lo que el usuario ve en Ayuda > Novedades; si falta, la
   version "no existe" para el.
3. **`README.md`**: si cambia algo que el usuario ve o una clave de config nueva,
   tocar "Que permite hacer" y/o la tabla de estructura.
4. **`INSTRUCCIONES.md`**: si cambia el uso diario (menus, botones, flujos).
5. **`config.example.json`**: claves nuevas que lea el codigo.
6. Entrada en "Hecho recientemente" de este fichero, con el **porque**, no solo el que.
7. `python -m unittest discover -s tests -t .` en verde.

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

- v2.8.0 (oct 2026): **asociación actividad ↔ tarea** y **desayuno**.
  (1) Hallazgo verificado contra la API: en esta instancia **las 16 tareas
  favoritas devuelven las MISMAS 8 actividades** (están definidas por proyecto,
  no por work package), así que `_actividades_de_tarea` no puede filtrar nada y
  nada impedía imputar «Asuntos propios» sobre «Mantenimientos» — que es lo que
  le pasó al usuario. La relación la pone ahora el usuario: `_asociar` escribe en
  los DOS sentidos (`actividades_tarea` tarea→actividad y `tareas_actividad`
  actividad→tarea) y `_tarea_de_actividad` (bind a `<<ComboboxSelected>>` de
  `cbo_act`) cambia la tarea al elegir una actividad asociada, avisando en la
  barra de estado. No adivina nunca (solo asociaciones creadas a mano) y mover la
  tarea después a mano se respeta: `set()` no dispara `<<ComboboxSelected>>`, así
  que no hay bucle ni se pisa la actividad elegida.
  (2) **Desayuno**: `desayuno()` y `horas_dia_permiso()`. La jornada que se ficha
  (6,5 h) y lo que vale un día completo de permiso (7 h) son cosas distintas; el
  cupo se mide con la oficial (70:00 h = 10 días × 7 h), así que topar en la
  jornada consumía media hora de menos por día. El tope de `anadir_permiso` pasa a
  `max(jornada_de(dia), horas_dia_permiso())` y el botón «Día completo» usa la
  oficial. El wizard pregunta la jornada oficial + «Descontar desayuno» y guarda
  `jornada_invierno` (fichada), `desayuno` y `horas_dia_permiso`; al recargar,
  `jinv` muestra la oficial (fichada + desayuno), así que es compatible con las
  configuraciones que ya existían. 139 tests.

- v2.8.1 (oct 2026): **la comprobación de actualizaciones ya no miente**.
  `buscar_actualizacion` devolvía `None` tanto si no había versión nueva como si
  no había podido preguntar, y la GUI (`if err or not res` con
  `forzar and not err`) acababa diciendo «ya tienes la última versión» con una
  release más nueva publicada; si además había excepción, no mostraba **nada**.
  Paso en real: se agoto el limite de la API de GitHub (60/h **por IP, compartida
  por toda la salida de la UGR**) y el usuario no entendia por que no le bajaba la
  2.8.0. Ahora hay `ComprobacionFallida`: con `forzar=True` se lanza con el motivo
  (sin red / límite, con la hora de reintento sacada de `X-RateLimit-Reset`), y la
  comprobación automática sigue callando para no molestar. Tests:
  `TestComprobarActualizacion` (4). 143 tests.

- v2.9.0 (oct 2026): **acciones sobre los apuntes desde el día**. El usuario no
  conseguía crear una plantilla: el diálogo exige marcar *exactamente un día*, la
  lista vacía no explicaba nada y acabó pulsando «Aplicar» (que responde «elige
  una plantilla de la lista»). No era un bug del código —se reprodujo y guardaba
  bien— sino de la interfaz. Ahora el menú del día tiene un submenú **Apuntes del
  día** con *Guardar este día como plantilla* (`dialogos.guardar_dia_como_plantilla`,
  extraída de `abrir_plantillas` para no duplicar) y *Eliminar apuntes de este día*
  (`dialogos.abrir_eliminar_dia`: casillas por apunte + «Todos»). Ambas
  deshabilitadas si el día no tiene apuntes. Para el borrado se extrajo
  `App._borrar_lote` y `App._datos_para_deshacer` de `_eliminar`, de modo que el
  enrutado a INARI y el Deshacer son los mismos vengan de la tabla o del menú.
  `abrir_plantillas` con la lista vacía explica cómo crear la primera y desactiva
  Aplicar/Eliminar. Tests: `TestAccionesDelDia` (4). 147 tests.

- v2.9.1 (oct 2026): **arreglado el job de macOS Intel**, que llevaba ~6 releases
  colgado y dejaba sin publicar `FichaCSIRC-mac-x64.zip`. **No era el runner**:
  el diagnostico por la API (steps del job) mostro que se quedaba en el paso
  **«Ejecutar tests»** 19+ minutos, cuando el build entero tarda 1 min en arm64.
  Causa: los tests de GUI abren ventanas Tk y en ese runner **se bloquean** en vez
  de saltarse — el guard `except tk.TclError: skipTest` cubre que Tk *falle*, no
  que se *quede esperando*. Ademas eran **redundantes**: ya corren en el workflow
  de Tests en cada push y en el job de Windows de cada release. Se retira el paso
  de tests de `build-macos` (esos jobs solo empaquetan) y se anade
  `timeout-minutes` a los dos jobs (25 Windows / 20 macOS) para que un cuelgue
  futuro muera solo en vez de dejar el run abierto 6 horas.
- v2.9.2 (oct 2026): **la cola de releases ya no se puede atascar**, y arreglado
  *Novedades* en Mac.
  - `concurrency: {group: release, cancel-in-progress: false}` en `release.yml`.
    El arreglo de 2.9.1 solo valia para runs *nuevos*, y esos no arrancaban: los
    4 jobs de Intel colgados (sin `timeout-minutes`, porque el workflow que corre
    es el del commit de la etiqueta) ocupaban los pocos runners de macOS que da
    la cuenta, asi que 2.9.0 y 2.9.1 se quedaron en **queued 2-3 horas sin
    empezar** y sus apps de macOS no se publicaron. Con el grupo de concurrencia
    las releases van **en fila de una en una**, nunca se pelean por los runners y
    un cuelgue solo retrasa, no bloquea. `cancel-in-progress: false` a proposito:
    cancelar la anterior dejaria una release sin sus artefactos.
  - `build_macos.sh` no pasaba `--add-data NOVEDADES.md`, que si pasa el job de
    Windows: en Mac *Ayuda -> Novedades* salia con el texto de fallback. Al
    tocar las opciones de empaquetado hay que mirar **los dos** sitios, porque
    Windows empaqueta desde el workflow y macOS desde el script.
  - **Mac en `.dmg`** (`hdiutil`, con reintento: falla a veces en los runners con
    "Resource busy"). El usuario reporto **5 iconos de FichaCSIRC en Launchpad**:
    con el zip cada actualizacion se descomprimia en otra carpeta de Descargas y
    Launchpad indexa toda `.app` del disco. Ademas: la app se actualiza sola en
    Mac (`MAC_INSTALLER_ASSET`, abre el dmg y se cierra porque el Finder no deja
    reemplazar una app abierta; bajado por la app no lleva cuarentena), elige la
    arquitectura por **hardware** (`sysctl hw.optional.arm64`: con Rosetta
    `platform.machine()` miente) y avisa si corre fuera de Aplicaciones
    (`fuera_de_aplicaciones`: dmg / *App Translocation* / otra ruta). No se mueve
    sola: translocada no conoce la ruta de su original.
  - **Revision completa** (con Opus 5.5). Corregido:
    - `entradas_dia` sin filtro de usuario si fallaba `/users/me`: devolvia los
      apuntes de todo el equipo visible (sumados a tu jornada y borrables). Un
      test fijaba ese comportamiento; ahora exige lo contrario. `_me(estricto)`.
    - Menus contextuales muertos en Mac: Tk 8.6/Aqua entrega el boton derecho
      como **Button-2**. `fichaui.bind_menu_contextual` (Button-3 + en darwin
      Button-2 y Control-Button-1). Usarlo SIEMPRE para menus nuevos.
    - `configurar.guardar` (consola) volcaba solo sus claves y borraba el resto
      de la config; el wizard grafico ya fusionaba. Ahora ambos fusionan.
    - `config.json` se escribe de forma atomica (`escribir_json_atomico`:
      temporal + fsync + `os.replace`); antes un corte lo dejaba truncado.
    - `_actividad_href` se tragaba el error de red y el apunte se creaba con la
      actividad por defecto. Ahora el error se propaga y no se crea nada.
    - Copiar dia/semana y plantillas escribian a ciegas en un dia que no se pudo
      leer (cache `None` tratada como vacia -> duplicados). Ahora se saltan.
    - Aviso diario: la tarea guarda la ruta del ejecutable y el paso a onedir
      (2.6.4) la dejo apuntando a un .exe borrado. `reparar_recordatorio` al
      arrancar: si `recordatorio_ejecutable` (config) no es el actual, lee la
      HORA de schtasks/launchd y reprograma. La ruta de schtasks no es fiable
      (sale en la codificacion de la consola, comprobado), por eso se anota en
      config en vez de compararla.
    - CSV con coma decimal (`horas_csv`), abrir CSV en Mac (`abrir_con_sistema`),
      "7.0h" en tarjetas (usar `_fmt` tambien para el objetivo), contador de
      borrados de INARI.
  - **Permisos: saldo continuo** (decision del usuario). Antes cupo = todas las
    concesiones pero usadas = solo el año natural: en enero "volvian" las horas
    gastadas. Ahora usadas = todo desde `permisos_desde` y lo de cada año se
    SUMA a lo que quede. Al empezar el año (`permisos_anio_revisado` < año) la
    app ofrece, opcional, añadir los permisos nuevos con la ultima concesion de
    cada tipo como propuesta. `inicializar_permisos_anuales` da por revisado el
    año en curso en el primer arranque, para no preguntar en octubre.
  - **Permiso imputado como actividad**: segun el servicio, los asuntos propios
    se marcan en local o se imputan como actividad de una tarea (ATE). Clave
    `actividad` por tipo en `permisos_tipos`; `actualizar_usadas_proyectostic`
    suma esas horas con UNA consulta por rango (`entradas_rango`, filtro `<>d`)
    y se cachea en `_USADAS_PT` para no bloquear la interfaz.

- v3.0.0 (oct 2026, rama `experimento/pywebview`): **interfaz HTML con pywebview**
  en lugar de Tkinter, con el asistente dentro de la misma app.
  - Por qué: los problemas recurrentes eran de Tk (pie que desaparecía, botones
    de Windows que ignoran el color, Button-2/Button-3 en Mac, avisos al
    empaquetar Tcl/Tk) y el aspecto. Se descartó Rust/Tauri (reescribir el motor
    y sus tests) y Qt (+50-80 MB por instalación, y no reaprovechable en Tauri).
    La interfaz HTML sí se reaprovecharía si algún día se pasa a Tauri.
  - El motor (`rellenar_horas`, `destinos`, `inari`) no cambia. `Api` devuelve
    datos ya calculados (estado de cada día, avisos antes de añadir) y el JS solo
    los pinta.
  - Mejoras que vienen con el cambio: resumen del mes y CSV con UNA consulta por
    rango (`entradas_rango`); API key y token de INARI nunca llegan al JS (campo
    vacío = se conserva el guardado); el JS no puede abrir URLs ni ficheros
    arbitrarios (`abrir_github`, `abrir_exportacion`, `abrir_pagina_actualizacion`
    solo abren lo suyo).
  - Empaquetado: UNA app. Windows: `instalador.iss` copia solo `dist\FichaCSIRC`,
    el acceso "FichaCSIRC - Configurar" pasa a `FichaCSIRC.exe --configurar`, y al
    actualizar `[InstallDelete]` borra `FichaCSIRC-Configurar` y el `_internal`
    viejo (no mezclar DLL de Tcl/Tk con lo nuevo). La ruta del exe es la misma,
    así que la tarea del aviso diario sigue valiendo. Comprueba WebView2 en el
    registro y avisa si falta. macOS: una sola `FichaCSIRC.app` en el dmg.
  - Actualización de los clientes 2.x: su actualizador descarga
    `FichaCSIRC-Instalador.exe` de la release `latest` (mismo nombre) e instala
    encima. Plan: publicar primero como **pre-release** (el actualizador solo
    mira `latest`, que ignora las pre-releases), probar con voluntarios y luego
    marcarla como latest.
  - De paso: `build_instalador.bat` buscaba `dist\FichaCSIRC.exe` (ruta de
    `--onefile`, rota desde 2.6.4) y no pasaba la versión a Inno Setup.

## Tests
- `python -m unittest discover -s tests -t .` (o `run_tests.bat`). **179 tests** con la
  red mockeada, repartidos así:
  - `test_fichacsirc.py` (109) — motor: duraciones ISO, jornada/verano, parsing y
    paginación de la API, payloads, pendientes, festivos, franjas, permisos
    (saldo, actividad, año nuevo), instalacion en Mac y aviso diario.
  - `test_inari.py` (23) — cliente JSON-RPC de INARI (lectura y escritura).
  - `test_destinos.py` (9) — puente ProyectosTIC/INARI.
  - `test_gui_acciones.py` (37) — acciones reales de la GUI (con `en_hilo` síncrono).
  - `test_gui_smoke.py` (1) — arranque de la ventana Tk; se salta sin display.
  - `test_web_api.py` (41) — la `Api` web, el asistente, el modo experimento y
    los ficheros de `web/` (enlazados, sin `innerHTML`, y que todo lo que llama el
    JS exista en la `Api` y en la demo).
- Ejecutarlos tras tocar el motor o la GUI.

## Pendiente / ideas
- **INARI** (revisarlo junto con la validacion contra el servidor real):
  - El aviso diario (`dias_pendientes_semana`) solo mira ProyectosTic: en dias
    de teletrabajo ya registrados en INARI avisa de horas pendientes. El
    docstring de `destinos.py` dice que el aviso usa INARI, y no es cierto.
  - Añadir/copiar/plantilla en un dia de teletrabajo con INARI crea el apunte en
    ProyectosTic, pero ese dia se pinta solo con INARI: el apunte no se ve y es
    facil duplicarlo.
  - `slots_dia` busca `status:open`: un slot cerrado en Kanboard deja de contar.
  - Guardar como plantilla un dia de INARI guarda apuntes con `wp_id` None.
- Exportar CSV y el resumen del mes hacen una consulta POR DIA (un año = 365):
  pasarlos a `entradas_rango`.
- CI: correr en macOS los tests del motor (no los de GUI, que se colgaban).
- Credenciales (API key, token INARI) en el llavero del sistema, no en el JSON.
- Rellenar la config `dias_ugr` con el calendario laboral PTGAS oficial cada año
  (San Pascual, Feria del Corpus, cierres de Navidad/Semana Santa).
- Posible versión Tauri/Rust si se quiere un ejecutable más ligero/pulido.
