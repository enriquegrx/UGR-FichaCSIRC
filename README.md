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
- Interfaz: Python con Tkinter/ttk.
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
  van añadiendo, p. ej. por servicios extraordinarios); el total es su suma y las
  usadas se calculan solas. La caducidad avisa, pero no descuenta sola. Se
  introducen a mano: el portal de personal no las expone por API.
- 🏡 **Solo SisGes (opcional):** fichar los días de teletrabajo en **INARI (Kanboard)**
  en vez de en ProyectosTIC, con clasificación por franja (columna, carril,
  categoría) e indicador de conexión propio en el pie.
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

1. Abrir `FichaCSIRC-Configurar` la primera vez.
2. Introducir la URL de ProyectosTic y la API key personal.
3. Configurar jornada normal, jornada de verano, tareas favoritas y actividad
   por defecto.
4. Abrir `FichaCSIRC`.
5. Seleccionar el día o los días, elegir tarea, revisar horas y guardar.

La app evita duplicados básicos al aplicar un apunte a varios días, avisa si se
supera la jornada configurada y mantiene la interfaz activa mientras consulta la
API en segundo plano.

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

Guía de uso paso a paso en [INSTRUCCIONES.md](INSTRUCCIONES.md), sección 5.

## 💾 Instalación

### Windows

Descargar `FichaCSIRC-Instalador.exe` desde la última release:

<https://github.com/enriquegrx/UGR-FichaCSIRC/releases/latest>

El instalador es por usuario, no requiere permisos de administrador y crea los
accesos directos necesarios. Si Windows muestra SmartScreen, hay que usar
`Más información` y después `Ejecutar de todas formas`; la aplicación no está
firmada con certificado comercial.

El instalador deja dos accesos: la aplicación de registro y el configurador.

### macOS

Descargar el ZIP correspondiente desde la última release:

- `FichaCSIRC-mac-arm64.zip` para Apple Silicon.
- `FichaCSIRC-mac-x64.zip` para Intel.

El ZIP contiene:

- `FichaCSIRC.app`
- `FichaCSIRC-Configurar.app`

Las apps no están firmadas ni notarizadas por Apple. La primera apertura puede
requerir clic derecho sobre la app, `Abrir` y confirmar de nuevo. Si macOS marca
la descarga con cuarentena y no permite abrirla, se puede limpiar desde Terminal:

```bash
xattr -dr com.apple.quarantine FichaCSIRC.app FichaCSIRC-Configurar.app
```

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
| `registrar_gui.py` | Ventana principal de registro. |
| `configurar_gui.py` | Asistente gráfico de configuración inicial. |
| `dialogos.py` | Diálogos secundarios: búsqueda, edición, resumen mensual, exportación y plantillas. |
| `fichaui.py` | Utilidades visuales compartidas: estilos, tooltips, botones y ejecución en hilo. |
| `recordatorio.py` | Aviso diario de fichaje mediante Programador de tareas o LaunchAgent. |
| `instalador.iss` | Instalador Windows con Inno Setup. |
| `build_macos.sh` | Compilación local de apps macOS y ZIP. |
| `.github/workflows/` | Tests y publicación automática de releases. |
| `tests/` | Tests del motor y de flujos relevantes de la GUI. |

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
- `requests`.
- Tkinter disponible en el Python usado.

Instalar dependencias:

```bash
python -m pip install -r requirements.txt
```

Ejecutar el configurador:

```bash
python configurar_gui.py
```

Ejecutar la aplicación:

```bash
python registrar_gui.py
```

Ejecutar tests:

```bash
python -m unittest discover -s tests -t .
```

Los tests no usan la red real: simulan la API y escriben una configuración
temporal mediante `FICHACSIRC_CONFIG`.

## 📦 Construcción y releases

La publicación oficial se hace con GitHub Actions. El flujo genera el instalador
combinado de Windows, los paquetes macOS y los sube a GitHub Releases.

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
- `dist/FichaCSIRC-Configurar.app`
- `dist/FichaCSIRC-mac-arm64.zip` o `dist/FichaCSIRC-mac-x64.zip`

Para empaquetar en macOS hace falta un Python con Tk moderno; el script rechaza
Tk anterior a 8.6. En Homebrew:

```bash
brew install python@3.12 python-tk@3.12
```

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
- La interfaz está hecha en Tkinter: se ha cuidado el diseño, pero se mantiene
  dentro de los límites de una herramienta interna ligera.

## 📄 Licencia

Ver [LICENSE](LICENSE).

Proyecto interno. Los logotipos y marcas de la Universidad de Granada se usan
solo como identificación institucional.
