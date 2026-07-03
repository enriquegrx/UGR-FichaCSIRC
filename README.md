# FichaCSIRC

App de escritorio para registrar (fichar) horas de trabajo en **OpenProject** (instancia *ProyectosTic* de la Universidad de Granada) a través de su API REST v3, sin tener que pelearse con el widget web.

---

## 1. Qué es y para qué sirve

En la UGR el registro de horas en OpenProject es obligatorio. Hacerlo a mano desde la web (widget *"Mi tiempo invertido"*) es lento y repetitivo. **FichaCSIRC** automatiza y simplifica ese registro:

- Muestra la semana con los días laborables y cuánto llevas imputado en cada uno.
- Permite añadir apuntes (tarea + horas + actividad + comentario) con unos clics.
- Deja aplicar el mismo apunte a **varios días a la vez** (o a toda la semana).
- Calcula sola la jornada según la temporada (horario normal vs. verano).
- Exporta lo registrado a CSV por rango de fechas.

Público objetivo: personal **no técnico** que quiere fichar rápido.

## 2. Cómo funciona el registro de horas (concepto)

OpenProject **no** guarda franjas horarias (no existe "de 8:00 a 9:00"). Cada apunte de tiempo tiene solo: **fecha + horas + tarea + actividad + comentario**. Por tanto, la hora de entrada/salida es irrelevante: lo único que importa es que cada día laborable sumes el total de tu jornada, repartido entre una o varias tareas.

- Jornada normal: p. ej. **7 h/día**.
- Jornada de verano: p. ej. **5 h/día**, en el rango de fechas configurado (por defecto 16 jun – 15 sep).

La app avisa de cuántas horas te faltan para completar el día, pero te deja cerrar el día sin completarlo (por si pediste horas, asuntos propios, etc.).

## 3. Componentes

| Archivo | Qué es |
|---|---|
| `rellenar_horas.py` | **Motor**: toda la lógica de conexión y API (leer/crear/borrar/editar apuntes, proyectos, tareas, actividades, jornada, exportación). También funciona como app de consola. |
| `configurar.py` | Motor de configuración de consola + utilidades de API compartidas. |
| `registrar_gui.py` | **Ventana principal de registro** (Tkinter). Reutiliza `rellenar_horas.py`. |
| `dialogos.py` | Ventanas secundarias de la app (buscar tarea, exportar, editar, resumen, plantillas). |
| `fichaui.py` | Utilidades de interfaz compartidas (tooltips, ejecución en hilo, recursos). |
| `recordatorio.py` | Aviso de fichaje: comprobación puntual y alta/baja de la tarea programada de Windows. |
| `configurar_gui.py` | **Asistente gráfico** (wizard Siguiente/Atrás/Finalizar) de configuración. |
| `config.json` | Configuración del usuario (se genera; ver sección 6). |
| `logo_ugr.png`, `fichacsirc.ico` | Logo para la cabecera e icono de la ventana. |
| `FichaCSIRC - Configurar.bat` | Lanzador del asistente. Detecta/instala Python si falta. |
| `FichaCSIRC - Registrar.bat` | Lanzador de la app de registro (sin consola). |
| `build_exe.bat` | Genera los ejecutables `.exe` con PyInstaller (se ejecuta en Windows). |
| `tests/` + `run_tests.bat` | Tests del motor (sin red; `unittest` de la stdlib). |
| `revision_ux.md` | Prompt para una revisión de usabilidad (UX), aplicada en jul 2026. |

## 4. Requisitos

- **Windows**.
- **Python 3** (el lanzador lo instala con `winget` si no está).
- Librería `requests` (el lanzador la instala sola).
- Una **API key** de OpenProject (avatar → Mi cuenta → Tokens de acceso → API).
- Conexión a la red donde vive ProyectosTic (VPN si procede).

## 5. Uso

1. Doble clic en **`FichaCSIRC - Configurar.bat`** → asistente gráfico:
   Bienvenida → Conexión (URL + API key, con botón *Probar conexión*) → Jornada (horas normales/verano + fechas) → Tareas favoritas (elegir proyecto y marcar tareas) + actividad por defecto → Resumen → **Finalizar**.
2. Doble clic en **`FichaCSIRC - Registrar.bat`** → ventana de registro:
   - Navega por semanas; cada día es una **tarjeta con barra de progreso** (verde completo, ámbar parcial, rojo si te pasas). Clic para marcar uno o varios, o casilla *Toda la semana*. Botón derecho: marcar un día como **no laborable** (festivo, vacaciones…).
   - Añade apuntes: tarea (favoritas o *Buscar…*, con selección múltiple y opción de guardarlas como favoritas; el desplegable filtra al escribir) + horas (pre-rellenas con lo que falta) + actividad + comentario. Enter también añade.
   - **Doble clic en un apunte lo edita** (horas, actividad, comentario); Supr lo elimina, con **Deshacer** (Ctrl+Z) si te arrepientes.
   - *Copiar día anterior*, **Copiar semana anterior** (repite la semana pasada día a día) y **Plantillas** (guarda un día típico y aplícalo de un clic).
   - **Resumen mes**: horas registradas vs. objetivo y días incompletos.
   - **Aviso diario de fichaje** (menú *Herramientas*): opcional, te avisa los días laborables si te faltan horas (usa el Programador de tareas de Windows; solo aparece si hay algo pendiente).
   - Exporta a CSV por rango de fechas (botón *Exportar CSV…*).
   - Avisa si un apunte va a superar la jornada del día y evita duplicados.
   - Recuerda el tamaño de la ventana y la última actividad usada.

## 6. Configuración (`config.json`)

Se crea con el asistente. Como script/`.bat` se guarda junto a los archivos; como `.exe` se guarda en `%APPDATA%\FichaCSIRC`. Contiene:

- `base_url`, `api_key`
- `jornada_invierno`, `jornada_verano`, `tiene_verano`, `verano_inicio`, `verano_fin`
- `actividad_defecto`
- `favoritos` (lista de tareas para tenerlas a mano al registrar)
- `no_laborables` (días marcados como festivo/vacaciones), `plantillas` (días típicos guardados)
- `ventana` y `ultima_actividad` (recordadas por la GUI)

La variable de entorno `FICHACSIRC_CONFIG` permite usar otra ruta de config (la usan los tests). La app escribe un log de diagnóstico en `fichacsirc.log` junto a la config.

## 7. Detalles técnicos relevantes

- **API OpenProject v3**, autenticación *Basic* con usuario `apikey` y la API key como contraseña.
- Apuntes vía `POST /api/v3/time_entries`; duración en formato ISO 8601 (`PT7H`, `PT3H30M`…).
- Las **actividades** se obtienen del formulario `POST /api/v3/time_entries/form` (compatible con todas las versiones; el endpoint `available_time_entry_activities` daba 404 en esta instancia).
- Se filtran los apuntes por usuario (`/api/v3/users/me`) y por fecha (`spent_on`).
- No se registran horas duplicadas: al aplicar a varios días se salta la tarea que ya tenga apunte ese día.
- Los `.bat` detectan el `python.exe` real evitando el **alias de la Microsoft Store** (que aparenta ser Python pero no lo es).
- La GUI hace todas las llamadas a la API en **hilos de fondo** (la ventana nunca se congela); los apuntes de la semana se **cachean** por refresco para no repetir peticiones.
- Los listados siguen la **paginación por offset** (antes, más de 200 proyectos/tareas se cortaban en silencio), y los GET reintentan una vez ante errores transitorios de red.
- Editar un apunte usa `PATCH /api/v3/time_entries/{id}`.
- Las **actividades permitidas se cachean por work package** (se configuran por proyecto; no se comparten entre tareas de proyectos distintos).
- La comprobación de actualizaciones se hace **una vez al día** (respeta el límite de la API de GitHub). El `config.json` se lee tolerando BOM (por si se edita con el Bloc de notas).

## 8. Empaquetado y distribución

**Automático (recomendado):** el repositorio tiene GitHub Actions configurado. Al subir una etiqueta de versión (`git tag v2.1 && git push origin v2.1`) se ejecutan los tests, se construyen los `.exe` y se publican en [Releases](https://github.com/enriquegrx/UGR-FichaCSIRC/releases). Los compañeros descargan siempre la última desde `.../releases/latest` (ver `INSTRUCCIONES.md`), y la app avisa al arrancar si hay versión nueva. Recuerda actualizar `VERSION` en `rellenar_horas.py` (y `version_info.txt`) antes de etiquetar.

**Manual:** ejecuta `build_exe.bat` **en Windows**. Genera un único `.exe` por app (con metadatos de versión):

- `dist\FichaCSIRC.exe` (app de registro)
- `dist\FichaCSIRC-Configurar.exe` (asistente)

La configuración del `.exe` se guarda en `%APPDATA%\FichaCSIRC`. Nota: un `.exe` sin firmar puede mostrar el aviso de SmartScreen ("Más información → Ejecutar de todas formas"); es normal.

## 9. Historial de decisiones (qué se ha hecho y por qué)

1. Empezó como un script de consola que rellenaba horas fijas.
2. Se separó la **configuración** (datos estables) del **registro** (lo del día a día).
3. Se pasó el reparto de horas al momento de registrar (más flexible que fijarlo en la config).
4. Se cambió a un modelo por **apuntes** (tarea + horas + actividad + comentario), como el widget web.
5. Se añadió selección de **varios días / toda la semana** y **exportación a CSV**.
6. Se creó la **GUI** (Tkinter) reutilizando el motor, con logo e icono de la UGR.
7. Se convirtió el **configurador en asistente gráfico** (wizard).
8. Se resolvieron incidencias reales: alias de Python de la Store, endpoint de actividades (404), permisos por proyecto (403), y saltos de línea de los `.bat` en Windows.
9. Limpieza final: lanzadores con nombre, sin consola (`pythonw`) y build a `.exe`.
10. **Revisión UX aplicada** (jul 2026, ver `revision_ux.md`): textos y lanzadores corregidos, estados de día con color, "Toda la semana", horas pre-rellenas, aviso de jornada superada, éxito sin popups, exportación CSV en la GUI, "Copiar día anterior", selección múltiple de tareas, nombre del usuario en cabecera, atajos de teclado, validaciones del asistente, y llamadas a la API en hilos con caché (la ventana ya no se congela).
11. **Versión 2.0** (jul 2026): editar apuntes (doble clic), deshacer borrado (Ctrl+Z), resumen mensual, días no laborables (botón derecho), plantillas de día típico, favoritas persistentes desde la búsqueda, combo con filtrado al escribir, tooltips, paginación completa de la API, reintentos de red, log de diagnóstico, ventana/actividad recordadas y build a un solo `.exe` con versión.

## 10. Limitaciones conocidas

- Solo se ven/imputan tareas de los proyectos donde tienes permiso (otros devuelven **403**, es normal).
- Interfaz sobria (Tkinter); si se desea, queda la idea de una versión más "app" en Tauri/Rust.
- Los tests (`tests/`, doble clic en `run_tests.bat` o `python -m unittest discover -s tests -t .`) cubren el motor con la red simulada; la GUI no tiene tests automatizados.

---

*Proyecto interno. Logo y marca de la Universidad de Granada usados a título identificativo.*
