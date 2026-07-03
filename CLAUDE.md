# Contexto para Claude Code — FichaCSIRC

App de escritorio (Windows, Python/Tkinter) para fichar horas en OpenProject
(instancia ProyectosTic de la UGR) vía su API REST v3. Ver `README.md` para la
definición completa y el historial de decisiones.

## Estructura
- `rellenar_horas.py` — motor (API + lógica) y app de consola.
- `configurar.py` — utilidades de API compartidas + configurador de consola.
- `registrar_gui.py` — app gráfica de registro (importa `rellenar_horas`).
- `configurar_gui.py` — asistente gráfico (wizard); importa `configurar`.
- Lanzadores `.bat` (detectan Python, evitan el alias de la Microsoft Store).
- `build_exe.bat` — empaqueta con PyInstaller.

## Reglas / cuidado
- **Nunca** subir `config.json` (contiene la API key). Usar `config.example.json`.
- API OpenProject v3: auth Basic con usuario `apikey`; horas en ISO 8601 (`PT7H`).
- Las actividades se resuelven vía `POST /api/v3/time_entries/form`
  (el endpoint `available_time_entry_activities` da 404 en esta instancia).
- 403 al listar tareas de un proyecto = sin permiso (normal), tratar con aviso amable.
- La config vive junto al script, o en `%APPDATA%\FichaCSIRC` cuando es `.exe` (frozen);
  la variable de entorno `FICHACSIRC_CONFIG` puede apuntar a otra ruta (la usan los tests).

## Hecho recientemente
- Revisión UX aplicada (jul 2026): quick wins + llamadas a la API en hilos en la
  GUI (`_en_hilo` en `registrar_gui.py`), caché de apuntes por semana, exportación
  CSV en la GUI, "Copiar día anterior", selección múltiple, validaciones del wizard.
- v2.0 (jul 2026): editar apuntes (PATCH), deshacer borrado, resumen mensual,
  días no laborables y plantillas (persisten en config.json), paginación por offset
  (`_get_todos`), reintento de GETs, log en `fichacsirc.log`, build `--onefile`.

## Tests
- `python -m unittest discover -s tests -t .` (o `run_tests.bat`). Cubren el motor
  (duraciones ISO, jornada/verano, parsing de la API, payloads) con la red mockeada.
  Ejecutarlos tras tocar `rellenar_horas.py` o `configurar_gui.py`.
- La GUI no tiene tests; verificarla a mano.

## Pendiente / ideas
- Posible versión Tauri/Rust si se quiere un ejecutable más ligero/pulido.
