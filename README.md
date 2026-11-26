# FichaCSIRC 🕐

FichaCSIRC es una aplicación de escritorio para registrar horas de trabajo en
OpenProject, en la instancia ProyectosTic de la Universidad de Granada. Está
pensada para el uso diario: abrir, elegir el día, seleccionar la tarea, indicar
horas y guardar. ✅

El objetivo no es sustituir OpenProject, sino evitar el trabajo repetitivo del
widget web de tiempo invertido cuando hay que imputar la jornada todos los días.

Para el servicio de **SisGes** incluye además, de forma **opcional**, una
integración con **INARI (Kanboard)** para fichar los días de teletrabajo. 🏡

## 📌 Estado del proyecto

- Versión actual: **4.0**, reescrita por dentro en Rust.
- Plataformas: Windows, macOS y Linux.
- Interfaz: HTML/CSS/JavaScript (carpeta `web/`) en una ventana nativa de
  [Tauri 2](https://tauri.app/), con el motor que ya trae el sistema: WebView2
  en Windows, WebKit en macOS y WebKitGTK en Linux. Es la misma ventana de la
  versión 3.
- Motor: Rust (carpeta `tauri/`). Hace los mismos cálculos que el de Python de
  la versión 3; se compararon día a día con apuntes reales.
- API: OpenProject REST v3.
- Distribución: instalador de Windows (unos 3 MB), `.dmg` para Apple Silicon e
  Intel, y `.deb` y AppImage para Linux.
- Última versión publicada: <https://github.com/enriquegrx/UGR-FichaCSIRC/releases/latest>

La guía corta para instalar y empezar está en [INSTRUCCIONES.md](INSTRUCCIONES.md);
lo que cambia en cada versión, en [NOVEDADES.md](NOVEDADES.md); y con qué está
hecha, en [TECNOLOGIA.md](TECNOLOGIA.md).

**Versión 3 (histórico).** De la 3.0 a la 3.2.2 la aplicación era Python con
pywebview, empaquetada con PyInstaller e Inno Setup. Su código sigue en el
repositorio (`registrar_web.py`, `rellenar_horas.py` y compañía) y se mantiene
a la par: usa la misma ventana y sus tests son los que prueban la interfaz. Ya
no se publica: quien tenga una 3.x recibe la 4.0 como una actualización más y
conserva su configuración. `NOVEDADES.md` guarda las cuatro últimas versiones
de la 3 (de la 3.1.4 a la 3.2.2).

## ✨ Qué permite hacer

- 🗂️ Ver la semana laboral de un vistazo, con el progreso de cada día y el total
  semanal.
- ➕ Añadir apuntes de horas a uno o varios días a la vez.
- 🔎 Usar tareas favoritas, buscar tareas por proyecto o buscar en todos los
  proyectos accesibles.
- 🛠️ **Crear, modificar y duplicar tareas** de ProyectosTIC, solo en los
  proyectos donde el usuario tiene el permiso (los que traen el enlace
  `createWorkPackage`; se mira al arrancar, `Api.nueva_tarea_proyectos`):
  crear con tipo, tarea madre (árbol de abiertas del proyecto), descripción,
  tiempo estimado y a quién se asigna (a uno mismo, a nadie o a otra persona
  del proyecto: `Api.tarea_asignables`, que lee
  `/api/v3/projects/{id}/available_assignees` y se queda con las personas)
  (`Api.nueva_tarea_crear`; los tipos y lo que falta los da el
  formulario de OpenProject, que no crea nada); **plantillas de tarea**
  (`plantillas_tarea`); modificar título, madre, estimado, asignación y descripción
  mandando solo lo que cambia (`Api.tarea_modificar`, con `lockVersion`); y
  duplicar una tarea con todas las que cuelgan de ella, en otro proyecto si se
  quiere (`Api.duplicar_plan` lee el árbol y `Api.duplicar_una` crea cada
  copia, de arriba abajo y sin avisos: la API no tiene una operación para
  esto). En Rust, `tauri/src/tarea.rs`. La cabecera lo dice en broma: «Nivel
  dios» o «Nivel loser».
- 💬 Recordar la actividad y el comentario habitual de cada tarea.
- ✏️ Editar apuntes con doble clic y borrar varios apuntes seleccionados con
  posibilidad de deshacer.
- ✎ **Editar un día entero** (botón derecho → *Editar día…*): horas y actividad
  de cada apunte, quitar y añadir tareas; se guarda todo junto y *Deshacer* lo
  revierte entero.
- 🌙 **Tema oscuro** (sistema / claro / oscuro) y tamaño de letra con Ctrl +/−
  (`tema`, `zoom`). 🪟 Cajas minimizables y menú Ver (`paneles`).
- 📣 Aviso al abrir si la semana anterior quedó con huecos (`aviso_semana_vista`);
  **fichar desde el aviso diario** sin abrir la app (`Api.aviso_fichar`). Y de
  **cierre de mes**: los últimos días del mes, los días pendientes del mes
  (`Api.mes_pendiente`, `aviso_mes_visto`).
- 🔴 **«Sin conexión» explicado**: si no se puede leer ProyectosTIC, una franja
  dice por qué (fuera de la UGR sin VPN, API key caducada, servidor caído, sin
  Internet o config sin conexión) y qué hacer (`diagnostico_conexion`). *Ayuda →
  Copiar diagnóstico* genera un texto para soporte sin API key ni PIN.
- 🖥 Marcas **«(local)»** (festivo, vacaciones, baja, permiso por horas, guardia,
  teletrabajo): avisan antes de marcar y ofrecen imputar en la tarea de
  ProyectosTIC de ese motivo, elegida en *Herramientas → Permisos*
  (`tareas_local`: `{motivo: {id, nombre} | {ninguna: true}}`) o deducida por el
  nombre. Las etiquetas del día salen rellenas si está imputado y con borde si
  solo es local.
- 🧰 **Icono junto al reloj** e inicio con Windows (solo Windows): dice cuántos
  días hay por completar y trae «Completar hoy con…» la tarea habitual, sin
  abrir la ventana. Con el icono, la X solo esconde la ventana; **Salir** la
  cierra del todo.
- 📅 Días propios de la UGR **propuestos** por año (`propuesta_dias_ugr`) y
  revisables al importar festivos, más altas a mano (`dias_ugr`).
- ➕ Trabajar **desde las propias fichas**: «+» con las tareas habituales,
  «Completar con…», horas editables con doble clic, arrastrar para copiar o
  mover, Ctrl+C / Ctrl+V de días y un aviso con *Deshacer* tras cada cambio
  (Ctrl+Z deshace también altas, copias y ediciones).
- 🔒 **PIN de acceso** opcional al abrir la app (y el asistente), y de nuevo
  tras N minutos sin usarla (`pin_auto_min`). Es un bloqueo de pantalla: en `config.json` solo se guarda un hash PBKDF2 con sal (`pin`) y
  los fallos (`pin_intentos`, con espera creciente). La API key sigue en claro
  para que el aviso diario funcione sin pedir nada; olvidar el PIN = borrar la
  configuración y volver al asistente.
- 🔄 Copiar el día anterior, copiar la semana anterior o aplicar plantillas de día
  típico.
- 🏖️ Marcar festivos, vacaciones u otros días no laborables (nunca bloquean el fichaje).
- 📅 Importar festivos por ámbito (nacional, Andalucía, Granada) calculados para cada
  año, más un preset de días propios de la UGR.
- 🛎️ Marcar guardias (con comentario "Servicio de Guardia" automático) y teletrabajo,
  con contador semanal; llevar la cuenta del cupo de vacaciones.
- 🕐 Registrar **permisos por horas** (asuntos particulares, conciliación,
  compensación por servicios mínimos): restan horas al objetivo de ese día. Cada
  tipo se nutre de **concesiones** (bolsas de horas con su fecha límite, que se
  van añadiendo, p. ej. por servicios extraordinarios). Es un **saldo continuo**:
  lo que no se usa se arrastra y, a partir del 1 de enero, la app ofrece añadir
  los permisos del año nuevo, que se suman a lo que quede (`permisos_desde`,
  `permisos_anio_revisado`). Las usadas se calculan solas: lo marcado en el día
  y, en los servicios donde el permiso se imputa como **actividad de una tarea**,
  lo imputado en ProyectosTic con esa actividad (clave `actividad` de cada tipo
  en `permisos_tipos`). La caducidad avisa, pero no descuenta sola. Las
  concesiones se introducen a mano: el portal de personal no las expone por API.
- ☕ Distinguir la **jornada oficial** de la que se ficha: si media hora es de
  desayuno, fichas 6,5 h al día pero **un día completo de permiso cuenta como 7 h**,
  que es como lo descuenta el portal (`desayuno` y `horas_dia_permiso`).
- 🔗 **Asociar una actividad con su tarea** (botón derecho sobre Actividad): al
  elegir esa actividad, la tarea cambia sola a la que le corresponde. Hace falta
  porque OpenProject devuelve las mismas actividades para todas las tareas y nada
  impide imputar «Asuntos propios» en una tarea que no toca.
- 🆕 Ver las **novedades de cada versión dentro de la app** (Ayuda → Novedades),
  sin pasar por GitHub; tras actualizar se abren solas una vez
  (`ultima_version_abierta`).
- 📊 **Estadísticas** dentro de la ventana (semanal, mensual o anual): tareas
  más realizadas, jornada cumplida y el año mes a mes, con el bloque «Cómo va»
  y un informe del periodo para imprimir o guardar como PDF.
- 🧩 **Por completar**: los días del año con horas pendientes, en fichas por
  mes. Se rellenan de una vez (completar con una tarea, repartir entre varias,
  aplicar una plantilla o copiar un día), con resumen previo y un solo
  *Deshacer*. Incluye «Te pasas»: los días con horas de más y los apuntes
  repetidos.
- 🗓️ **Plantillas de semana** (de lunes a viernes) además de las de día.
- 🔍 **Buscar en los apuntes** del año (Ctrl+F).
- 📤 Exportar horas a CSV.
- ⏰ **Aviso diario de fichaje** (Windows, con el Programador de tareas): una
  campana en la barra con la hora, propuesto a las 14:00. Desde la ventanita
  del aviso se ficha sin abrir la app.
- 🔔 Comprobar actualizaciones: en Windows descarga el instalador y lo abre; en
  macOS y Linux abre la página de la versión nueva.

## 🚀 Cómo se usa

La aplicación trabaja con el mismo modelo que OpenProject: cada apunte tiene una
fecha, una tarea, una duración, una actividad y un comentario. No registra horas
de entrada o salida.

El flujo habitual es:

1. Abrir `FichaCSIRC`: la primera vez (sin configuración) arranca solo el
   asistente. Luego está en *Herramientas → Configuración (asistente)* (o
   arrancando el programa con `--configurar`).
2. Introducir la URL de ProyectosTic y la API key personal.
3. Configurar jornada (oficial y desayuno), jornada de verano, tareas favoritas
   y actividad por defecto.
4. Seleccionar el día o los días, elegir tarea, revisar horas y guardar.

La ventana se abre maximizada. La app avisa si se supera la jornada configurada
o si una tarea ya tiene horas ese día (se puede imputar en dos tramos), y
mantiene la interfaz activa mientras consulta la API en segundo plano.

## 🏡 Integración con INARI (solo SisGes, opcional)

Pensada para el flujo del servicio de **SisGes**: los **días de teletrabajo** se
imputan en **INARI** (la instancia de Kanboard del servicio) en lugar de en
ProyectosTIC. Viene **desactivada por defecto**, así que no afecta a quien no la
use.

- Se activa y configura en **Herramientas → Integraciones** (URL, usuario y token
  personal de INARI; el token se enmascara y nunca se registra en logs).
- En un día marcado como teletrabajo, cada franja se registra como una **tarea
  independiente en INARI**, con su **columna, carril y categoría** (elegibles por
  franja) y un marcador de día para agruparlas.
- El pie de la ventana muestra **dos indicadores de conexión** diferenciados
  (`● ProyectosTIC` y `● INARI`).
- El **resumen del mes** cuenta esos días como teletrabajo y suma sus horas de
  INARI. Un día de teletrabajo va a un único sistema (INARI *o* ProyectosTIC),
  así que no se duplican horas.

Guía de uso paso a paso en [INSTRUCCIONES.md](INSTRUCCIONES.md), sección 6.

## 💾 Instalación

Todos los instaladores están en la última release:
<https://github.com/enriquegrx/UGR-FichaCSIRC/releases/latest>

### Windows

Descargar `FichaCSIRC-Instalador.exe` y abrirlo con doble clic.

- Ocupa unos 3 MB, es por usuario y no pide permisos de administrador. Instala
  en `%LOCALAPPDATA%\Programs\FichaCSIRC` y deja un acceso, **FichaCSIRC**,
  en el menú Inicio y en el escritorio. El asistente de configuración va
  dentro de la app.
- Necesita *Microsoft Edge WebView2 Runtime*, que viene con Windows 11 y con
  Windows 10 actualizado.
- **Sobre una versión 3**: el instalador la cierra, retira su programa y sus
  accesos y deja la 4 en su sitio. La configuración (`%APPDATA%\FichaCSIRC`),
  la API key, el PIN, el inicio con Windows y el aviso diario se conservan; el
  aviso se reapunta solo al programa nuevo, a la misma hora, la primera vez
  que se abre. Si la versión 3 sigue abierta y no se puede cerrar, el
  instalador lo dice y no instala nada.
- Si Windows muestra SmartScreen, hay que usar `Más información` y después
  `Ejecutar de todas formas`: la aplicación no está firmada con certificado
  comercial.

Para desinstalar: *Configuración de Windows → Aplicaciones → FichaCSIRC →
Desinstalar*. La configuración no se toca.

### macOS

Descargar el `.dmg` correspondiente:

- `FichaCSIRC-mac-arm64.dmg` para Apple Silicon.
- `FichaCSIRC-mac-x64.dmg` para Intel.

Al abrirlo aparece `FichaCSIRC.app` junto a un acceso a **Aplicaciones**: hay
que arrastrarla ahí (si ya estaba, elegir *Reemplazar*).

Las apps no están firmadas ni notarizadas por Apple. La primera vez macOS las
bloquea; se abren en *Ajustes del Sistema → Privacidad y seguridad → Abrir
igualmente*. Si macOS marca la descarga con cuarentena y no permite abrirla, se
puede limpiar desde Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/FichaCSIRC.app
```

En Mac el menú contextual se abre con clic secundario o con **Ctrl+clic**. En
la 4.0 el Mac no tiene todavía aviso diario de fichaje ni icono en la barra de
menús, y al salir una versión nueva la app abre su página para descargarla.

### Linux

- Ubuntu y Debian: el `.deb` de la release (`sudo apt install ./FichaCSIRC_*.deb`).
- Otras distribuciones: `FichaCSIRC-linux-x86_64.AppImage`, con permiso de
  ejecución.

Como en Mac: sin aviso diario ni icono junto al reloj, y las versiones nuevas
se descargan desde su página.

## 🗂️ Configuración y datos locales

La configuración se guarda en `config.json`. Contiene la URL, la API key, la
jornada, favoritos, no laborables, plantillas y preferencias de ventana. Es el
**mismo fichero, en el mismo sitio, que usaba la versión 3**: pasar a la 4 no
exige configurar nada.

Ubicación:

- Windows: `%APPDATA%\FichaCSIRC`
- macOS: `~/Library/Application Support/FichaCSIRC`
- Linux: `~/.config/FichaCSIRC`

Las compilaciones **de pruebas** (ver *Desarrollo local*) usan una carpeta
aparte, `FichaCSIRC-rust`, copiada de la real solo la primera vez: así no tocan
los datos de la aplicación instalada. Para tests o configuraciones alternativas
se puede usar la variable:

```bash
FICHACSIRC_CONFIG=/ruta/config.json
```

No se debe subir nunca `config.json` al repositorio: contiene una API key
personal. Existe [config.example.json](config.example.json) como plantilla.

Para pedir ayuda, *Ayuda → Copiar diagnóstico* genera un texto con el estado
de la aplicación, sin API key ni PIN.

**Protección de `config.json`** (desde la 3.2.2, tras perderse una entera en la
3.2.0): nunca se escribe encima de un fichero que no se ha podido leer, ninguna
escritura quita `base_url`/`api_key`, y al arrancar, si falta la conexión o el
fichero está roto, se recupera sola de la última copia de `copias/` que la
tenga (y se avisa). La copia buena más reciente nunca se purga.

## 🧱 Estructura del repositorio

La versión 4 vive en `tauri/` y comparte `web/` con la versión 3 (Python),
cuyo código se conserva: sus tests prueban la interfaz y sirven de referencia
para los cálculos. Todo lo que termina en `.py`, y los scripts de empaquetado
de la raíz, son de la versión 3.

| Ruta | Descripción |
|---|---|
| `tauri/` | **La app (4.0)**: Rust + Tauri 2. En `src/`: `main.rs` (arranque, ventana y argumentos), `api.rs` (los métodos que llama la interfaz), `openproject.rs` (cliente de la API), `reglas.rs` (jornada, festivos y permisos), `apuntes.rs`, `tarea.rs` (crear, modificar y duplicar tareas), `completar.rs`, `estadisticas.rs`, `resumen.rs`, `permisos.rs`, `herramientas.rs`, `inari.rs`, `copias.rs`, `config.rs`, `pin.rs`, `asistente.rs`, `ayuda.rs`, `sistema.rs` (aviso diario, icono junto al reloj y actualizaciones) y `modo.rs` (pruebas o producción). `nsis/hooks.nsh` hace que el instalador de Windows sustituya a la versión 3. |
| `rellenar_horas.py` | Versión 3 (Python). Motor: API, jornada, apuntes, exportación y modo consola. |
| `configurar.py` | Utilidades de configuración y comprobación de conexión. |
| `registrar_web.py` | Versión 3 (Python): ventana pywebview y la clase `Api` que usa la interfaz; asistente, aviso (`--recordatorio`) y actualizaciones. Los métodos de `Api` se llaman igual que los de `tauri/src/api.rs`. |
| `web/` | Interfaz, la misma para la 4 y la 3: `index.html` + `app.js` (ventana), `dialogos.js`, `configurar.html/js` (asistente), `aviso.html/js`, `comun.js`, `app.css`. `demo.js` solo con `?demo`. `puente-tauri.js` conecta la ventana con el motor de Rust. |
| `requirements-web.txt` | Dependencias de la app (requests, pywebview). |
| `registrar_gui.py`, `configurar_gui.py`, `dialogos.py`, `fichaui.py` | Interfaz Tkinter **anterior a la 3.0**. Ya no se empaqueta; se conserva de referencia y sus tests siguen pasando. |
| `inari.py` | Cliente JSON-RPC de INARI (Kanboard): credenciales, slots y descubrimiento de proyecto, columna, carril y categoría. |
| `destinos.py` | Puente entre ProyectosTIC (OpenProject) e INARI: registra y lee las horas de los días de teletrabajo. |
| `recordatorio.py` | Aviso diario de fichaje mediante Programador de tareas o LaunchAgent. |
| `instalador.iss` | Instalador Windows con Inno Setup. |
| `build_exe.bat` | Compilación local de la app de Windows en modo carpeta (`--onedir`). |
| `build_instalador.bat` | Genera el instalador con Inno Setup en local. |
| `build_macos.sh` | Compilación local de apps macOS y su `.dmg`. |
| `NOVEDADES.md` | Changelog para usuarios; se empaqueta y se ve en Ayuda → Novedades. |
| `build_linux.sh` + `fichacsirc_linux.py` | Linux: `.deb` y AppImage sin PyInstaller; usan Python, PyGObject y WebKitGTK del sistema (WebKitGTK no se puede empaquetar). GitHub Actions prueba que arranca en Ubuntu 22.04 y 24.04 con pantalla virtual. |
| `copias.py` | Copias de seguridad automáticas de `config.json`, restaurar y exportar/importar. |
| `bandeja.py` | Icono en la bandeja (pystray) e inicio con Windows; solo Windows. |
| `web/humo.js` + `tests/test_js_humo.py` | Pruebas de humo de la interfaz en Edge/Chrome sin ventana (se saltan sin navegador; desde Git Bash no arranca el navegador: usar PowerShell/cmd). |
| `TECNOLOGIA.md` | Stack y plan de migración a Rust/Tauri, para usuarios; se empaqueta y se ve en Ayuda → Tecnología utilizada. |
| `.github/workflows/` | `tests.yml` (tests de Python), `rust.yml` (en ramas `rust/**`: tests de Rust e instaladores de pruebas como artefactos, sin publicar) y `release.yml` (publica la 4.x al etiquetar). |
| `tests/` | Tests de Python: motor, clase `Api`, cliente INARI, copias, y las pruebas de humo de la ventana. `paridad_rust.py` compara los cálculos de Rust con los de Python sobre datos reales. Los tests de Rust van en cada módulo de `tauri/src/`. |

Otros documentos:

- [INSTRUCCIONES.md](INSTRUCCIONES.md): guía para usuarios.
- [CONTEXTO_DESARROLLO.md](CONTEXTO_DESARROLLO.md): notas de mantenimiento e
  historial técnico reciente.
- [revision_ux.md](revision_ux.md) y [revision_ui.md](revision_ui.md): prompts
  usados para revisar usabilidad y diseño visual.

## 🧑‍💻 Desarrollo local

Los usuarios que descargan una release no necesitan instalar nada más. Esta
sección es solo para desarrollo, pruebas o empaquetado local.

### La app (Rust y Tauri)

Requisitos: Rust estable, Node.js (para la CLI de Tauri, con `npx`) y, en
Linux, WebKitGTK 4.1 y sus cabeceras.

Tests y ejecución, desde `tauri/`:

```bash
cargo test
cargo run
```

Sin más, compila **de pruebas**: se llama «FichaCSIRC-Rust», usa su propia
configuración (`FichaCSIRC-rust`) y sus propios nombres para el aviso diario y
el inicio con Windows, de modo que convive con la aplicación instalada sin
tocarla. Con `--features produccion` es FichaCSIRC de verdad: misma
configuración y mismos nombres que la instalada.

Instalador local de Windows:

```bash
# de pruebas: se instala al lado de la de verdad
npx @tauri-apps/cli@2 build --bundles nsis --config tauri.pruebas.json
# de producción: sustituye a la instalada
npx @tauri-apps/cli@2 build --bundles nsis --features produccion
```

Las dos cosas van siempre juntas: `--config tauri.pruebas.json` sin la
feature, o la feature sin ese fichero.

### La ventana, sin red

Para revisar solo el diseño: `python -m http.server 8765 --directory web` y
abrir `http://localhost:8765/index.html?demo`. `web/demo.js` simula la
aplicación con datos de ejemplo.

### Tests de Python

Prueban la ventana (con Edge o Chrome sin ventana) y el motor de la versión 3:

```bash
python -m pip install -r requirements-web.txt
python -m unittest discover -s tests -t .
```

No usan la red real: simulan la API y escriben una configuración temporal
mediante `FICHACSIRC_CONFIG`. Toda función nueva de la interfaz tiene que
existir en `tauri/src/api.rs`, en la clase `Api` de `registrar_web.py` y en
`web/demo.js`; hay un test que lo comprueba para las dos últimas.

La versión 3 se sigue pudiendo ejecutar con `python registrar_web.py`.

## 📦 Construcción y releases

La publicación se hace con GitHub Actions (`.github/workflows/release.yml`) al
subir una etiqueta de versión. El flujo pasa los tests de Python y de Rust,
compila en Windows, macOS (Apple Silicon e Intel) y Linux en modo producción y
sube a la release:

- `FichaCSIRC-Instalador.exe` (Windows, NSIS). Es también lo que descarga el
  actualizador, tanto el de la 4.x como el de la 3.x.
- `FichaCSIRC-mac-arm64.dmg` y `FichaCSIRC-mac-x64.dmg`.
- El `.deb` y `FichaCSIRC-linux-x86_64.AppImage`.

Para publicar una versión:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Antes de etiquetar:

- La versión en `tauri/Cargo.toml` y `tauri/tauri.conf.json` (y `Cargo.lock`):
  la etiqueta tiene que coincidir con ella o el flujo no publica.
- La entrada de la versión en `NOVEDADES.md`, y `README.md` e
  `INSTRUCCIONES.md` al día.

Una etiqueta con guion (`v4.0.0-rc.1`) se publica como **pre-release**: las
aplicaciones instaladas no la ven, porque miran la última release estable, y
solo la instala quien tenga el enlace. Sirve para ensayar antes de que le
llegue a nadie.

Las ramas `rust/**` compilan en cada subida (`rust.yml`) y dejan los
instaladores **de pruebas** como artefactos del run, sin publicar nada.

Los scripts `build_exe.bat`, `build_instalador.bat`, `build_macos.sh` y
`build_linux.sh`, con `instalador.iss`, son los de la versión 3 (PyInstaller e
Inno Setup). Los detalles de mantenimiento están en
[CONTEXTO_DESARROLLO.md](CONTEXTO_DESARROLLO.md).

## 🔧 Decisiones técnicas relevantes

- La autenticación con OpenProject usa Basic Auth con usuario `apikey`.
- Las duraciones se envían en formato ISO 8601 (`PT7H`, `PT3H30M`, etc.).
- Las actividades disponibles se obtienen mediante
  `POST /api/v3/time_entries/form`, porque el endpoint alternativo no está
  disponible en esta instancia.
- Los listados paginan por `offset` para no perder proyectos o tareas.
- Los errores 403 al listar proyectos se tratan como falta de permisos, no como
  fallo de la aplicación.
- La interfaz solo pinta: todo cálculo y toda llamada a la API están en el
  motor. Las llamadas de red no bloquean la ventana y los datos de la semana se
  cachean.
- El aviso diario tiene autocierre para no dejar procesos bloqueando una futura
  actualización.
- La integración con INARI usa la API JSON-RPC 2.0 de Kanboard (Basic Auth
  `usuario:token`); cada franja de teletrabajo es una tarea con las horas en
  `time_spent` y un marcador de día en `reference`. Es opcional y solo para SisGes.
- La 4.x es un único ejecutable nativo, sin Python dentro: desaparecen los
  errores de carga de DLL y los archivos bloqueados al instalar o actualizar
  que daba el empaquetado con PyInstaller.
- El instalador de la 4.x **sustituye** a la versión 3 sin usar su
  desinstalador, que borraría la tarea programada del aviso diario y, con
  ella, su hora.
- Dos modos de compilación, pruebas y producción (`tauri/src/modo.rs`): el de
  pruebas no comparte ni configuración ni nombres con la aplicación instalada.
- Crear tareas usa `POST /api/v3/work_packages` y, antes, su formulario
  (`/work_packages/form`), que no crea nada y dice qué tipos admite el
  proyecto y qué falta. Duplicar un árbol no tiene operación en la API: se lee
  nivel a nivel con el filtro `parent` y se crea cada copia por separado.

## ⚠️ Limitaciones

- Solo se muestran tareas y proyectos a los que el usuario tiene acceso.
- Crear y duplicar tareas no se deshace desde la app. Al duplicar no se copian
  horas, asignación, fechas, adjuntos ni relaciones, y los campos propios
  obligatorios de un tipo no se rellenan: en ese caso la app lo avisa y no
  deja empezar.
- Windows y macOS pueden mostrar avisos de seguridad porque los binarios no
  están firmados con certificados comerciales. Las actualizaciones tampoco van
  firmadas todavía.
- En macOS y Linux, la 4.0 no tiene aviso diario de fichaje ni icono junto al
  reloj, y no instala sola las versiones nuevas: abre su página.
- La lista de festivos conocidos debe revisarse cada año.
- En Windows necesita *Microsoft Edge WebView2 Runtime* (viene con Windows 11 y
  Windows 10 actualizado).

## 📄 Licencia

Ver [LICENSE](LICENSE).

Proyecto interno. Los logotipos y marcas de la Universidad de Granada se usan
solo como identificación institucional.
