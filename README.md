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

- Plataforma: Windows y macOS.
- Interfaz (desde la 3.0): HTML/CSS/JavaScript en una ventana nativa con
  [pywebview](https://pywebview.flowrl.com/) (WebView2 en Windows, WKWebView en
  macOS). Toda la lógica sigue en Python.
- API: OpenProject REST v3.
- Distribución: instalador Windows combinado y paquetes macOS para Apple Silicon
  e Intel.
- Última versión publicada: <https://github.com/enriquegrx/UGR-FichaCSIRC/releases/latest>

La guía corta para instalar y empezar está en [INSTRUCCIONES.md](INSTRUCCIONES.md).

## ✨ Qué permite hacer

- 🗂️ Ver la semana laboral de un vistazo, con el progreso de cada día y el total
  semanal.
- ➕ Añadir apuntes de horas a uno o varios días a la vez.
- 🔎 Usar tareas favoritas, buscar tareas por proyecto o buscar en todos los
  proyectos accesibles.
- 💬 Recordar la actividad y el comentario habitual de cada tarea.
- ✏️ Editar apuntes con doble clic y borrar varios apuntes seleccionados con
  posibilidad de deshacer.
- ✎ **Editar un día entero** (botón derecho → *Editar día…*): horas y actividad
  de cada apunte, quitar y añadir tareas; se guarda todo junto y *Deshacer* lo
  revierte entero.
- ➕ Trabajar **desde las propias fichas**: «+» con las tareas habituales,
  «Completar con…», horas editables con doble clic, arrastrar para copiar o
  mover, Ctrl+C / Ctrl+V de días y un aviso con *Deshacer* tras cada cambio
  (Ctrl+Z deshace también altas, copias y ediciones).
- 🔒 **PIN de acceso** opcional al abrir la app (y el asistente). Es un bloqueo
  de pantalla: en `config.json` solo se guarda un hash PBKDF2 con sal (`pin`) y
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
- 📊 Consultar un resumen mensual con objetivo, horas registradas y días
  incompletos.
- 📤 Exportar horas a CSV.
- ⏰ Activar un aviso diario de fichaje en Windows y macOS.
- 🔔 Comprobar actualizaciones y, en Windows, descargar y lanzar el instalador.

## 🚀 Cómo se usa

La aplicación trabaja con el mismo modelo que OpenProject: cada apunte tiene una
fecha, una tarea, una duración, una actividad y un comentario. No registra horas
de entrada o salida.

El flujo habitual es:

1. Abrir `FichaCSIRC`: la primera vez (sin configuración) arranca solo el
   asistente. Luego está en *Herramientas → Configuración (asistente)* y, en
   Windows, en el acceso *FichaCSIRC - Configurar* (`FichaCSIRC.exe --configurar`).
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

### Windows

Descargar `FichaCSIRC-Instalador.exe` desde la última release:

<https://github.com/enriquegrx/UGR-FichaCSIRC/releases/latest>

El instalador es por usuario, no requiere permisos de administrador y crea los
accesos directos necesarios. Necesita *Microsoft Edge WebView2 Runtime* (viene
con Windows 11 y Windows 10 actualizado); si falta, el instalador avisa.
Al actualizar desde una versión 2.x instala encima, en la misma carpeta, y borra
antes los restos de la versión Tkinter (`FichaCSIRC-Configurar` y el `_internal`
viejo); la configuración no se toca. Si Windows muestra SmartScreen, hay que usar
`Más información` y después `Ejecutar de todas formas`; la aplicación no está
firmada con certificado comercial.

El instalador deja dos accesos: la aplicación de registro y el configurador.

### macOS

Descargar el `.dmg` correspondiente desde la última release:

- `FichaCSIRC-mac-arm64.dmg` para Apple Silicon.
- `FichaCSIRC-mac-x64.dmg` para Intel.

Al abrirlo aparece `FichaCSIRC.app` junto a un acceso a **Aplicaciones**: hay
que arrastrarla ahí (si ya estaba, elegir *Reemplazar*). Desde la 3.0 no hay
`FichaCSIRC-Configurar.app` (el asistente va dentro): quien venga de la 2.x
puede borrarla de Aplicaciones. Desde la 2.9.2 se distribuye como `.dmg` y no como `.zip`: con el
zip cada actualización se descomprimía en otra carpeta de Descargas y Launchpad
acababa mostrando un icono por copia. La app avisa si se abre fuera de
Aplicaciones y, al actualizarse, descarga el `.dmg` de la arquitectura del Mac
(mirando el hardware, no el proceso: una app Intel bajo Rosetta pasa a arm64).

Las apps no están firmadas ni notarizadas por Apple. La primera vez macOS las
bloquea; se abren en *Ajustes del Sistema → Privacidad y seguridad → Abrir
igualmente* (desde macOS 15 ya no vale el clic derecho → *Abrir*). Si macOS
marca la descarga con cuarentena y no permite abrirla, se puede limpiar desde
Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/FichaCSIRC.app
```

Para localizar copias antiguas (las que generaban iconos repetidos):

```bash
find ~ /Applications -maxdepth 4 -name "FichaCSIRC*.app" -prune 2>/dev/null
```

En Mac el menú contextual se abre con clic secundario o con **Ctrl+clic**.

## 🗂️ Configuración y datos locales

La configuración se guarda en `config.json`. Contiene la URL, la API key, la
jornada, favoritos, no laborables, plantillas y preferencias de ventana.

Ubicación de la configuración empaquetada:

- Windows: `%APPDATA%\FichaCSIRC`
- macOS: `~/Library/Application Support/FichaCSIRC`

En ejecución desde scripts, la configuración vive junto al código. Para pruebas
o configuraciones alternativas se puede usar la variable:

```bash
FICHACSIRC_CONFIG=/ruta/config.json
```

No se debe subir nunca `config.json` al repositorio: contiene una API key
personal. Existe [config.example.json](config.example.json) como plantilla.

La aplicación escribe un log de diagnóstico en `fichacsirc.log`, junto a la
configuración.

## 🧱 Estructura del repositorio

| Ruta | Descripción |
|---|---|
| `rellenar_horas.py` | Motor principal: API, jornada, apuntes, exportación y modo consola. |
| `configurar.py` | Utilidades de configuración y comprobación de conexión. |
| `registrar_web.py` | **La app (3.0)**: ventana pywebview y la clase `Api` que usa la interfaz; asistente, aviso (`--recordatorio`) y actualizaciones. |
| `web/` | Interfaz: `index.html` + `app.js` (ventana), `dialogos.js`, `configurar.html/js` (asistente), `aviso.html/js`, `comun.js`, `app.css`. `demo.js` solo con `?demo`. |
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
| `.github/workflows/` | Tests y publicación automática de releases. |
| `tests/` | Tests del motor, del cliente INARI, del puente de destinos y de flujos de la GUI. |

Otros documentos:

- [INSTRUCCIONES.md](INSTRUCCIONES.md): guía para usuarios.
- [CONTEXTO_DESARROLLO.md](CONTEXTO_DESARROLLO.md): notas de mantenimiento e
  historial técnico reciente.
- [revision_ux.md](revision_ux.md) y [revision_ui.md](revision_ui.md): prompts
  usados para revisar usabilidad y diseño visual.

## 🧑‍💻 Desarrollo local

Los usuarios que descargan una release no necesitan instalar Python. Esta sección
es solo para desarrollo, pruebas o empaquetado local.

Requisitos recomendados:

- Python 3.12.
- `requests` y `pywebview` (en Windows usa WebView2; en macOS, pyobjc).

Instalar dependencias:

```bash
python -m pip install -r requirements-web.txt
```

Ejecutar la aplicación (sin configuración abre el asistente):

```bash
python registrar_web.py
```

El asistente, a propósito:

```bash
python registrar_web.py --configurar
```

Para probar algo arriesgado sin tocar la configuración real, poner
`EXPERIMENTO = True` en `registrar_web.py` (configuración aparte, sin instalar
actualizaciones ni tocar el aviso diario). Para revisar solo el diseño, sin red:
`python -m http.server 8765 --directory web` y abrir
`http://localhost:8765/index.html?demo`.

Ejecutar tests:

```bash
python -m unittest discover -s tests -t .
```

Los tests no usan la red real: simulan la API y escriben una configuración
temporal mediante `FICHACSIRC_CONFIG`.

## 📦 Construcción y releases

La publicación oficial se hace con GitHub Actions. El flujo genera el instalador
combinado de Windows, los paquetes macOS y los sube a GitHub Releases.

Los ejecutables de Windows se empaquetan con PyInstaller en **modo carpeta**
(`--onedir --noupx`, versión fijada): cada app es un `.exe` junto a su carpeta
`_internal`. Por eso **el único artefacto Windows de cada Release es
`FichaCSIRC-Instalador.exe`** (ya no hay `.exe` sueltos portables: el ejecutable
necesita su carpeta al lado). Es también lo que descarga el autoactualizador.

Para publicar una versión:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Antes de etiquetar hay que actualizar:

- `VERSION` en `rellenar_horas.py`
- `version_info.txt` para los metadatos del ejecutable Windows

El instalador Windows cierra procesos de FichaCSIRC antes de reemplazar archivos,
borra la tarea programada al desinstalar y usa instalación por usuario.

### Build local de macOS

En macOS:

```bash
./build_macos.sh
```

Artefactos generados:

- `dist/FichaCSIRC.app`
- `dist/FichaCSIRC-mac-arm64.dmg` o `dist/FichaCSIRC-mac-x64.dmg`

El script crea su propio entorno virtual e instala ahí `requirements-web.txt`.

Los detalles de mantenimiento y scripts auxiliares están en
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
- La GUI ejecuta llamadas de red en hilos de fondo y cachea datos de la semana.
- El aviso diario tiene autocierre para no dejar procesos bloqueando una futura
  actualización.
- La integración con INARI usa la API JSON-RPC 2.0 de Kanboard (Basic Auth
  `usuario:token`); cada franja de teletrabajo es una tarea con las horas en
  `time_spent` y un marcador de día en `reference`. Es opcional y solo para SisGes.
- Los ejecutables de Windows se empaquetan en modo carpeta (PyInstaller
  `--onedir`): el `.exe` carga sus DLL desde su carpeta contigua, sin extraer nada
  a `%TEMP%`, lo que evita errores de carga al lanzarlo recién instalado.

## ⚠️ Limitaciones

- Solo se muestran tareas y proyectos a los que el usuario tiene acceso.
- Windows y macOS pueden mostrar avisos de seguridad porque los binarios no
  están firmados con certificados comerciales.
- La lista de festivos conocidos debe revisarse cada año.
- En Windows necesita *Microsoft Edge WebView2 Runtime* (viene con Windows 11 y
  Windows 10 actualizado).

## 📄 Licencia

Ver [LICENSE](LICENSE).

Proyecto interno. Los logotipos y marcas de la Universidad de Granada se usan
solo como identificación institucional.
