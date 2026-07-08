# Mejoras pendientes

Este documento recoge mejoras candidatas que conviene diseñar antes de
implementarlas. No debe incluir credenciales, tokens ni datos personales de
configuracion local.

## Integracion con INARI (destino de los dias de teletrabajo en SisGes)

> Estado: **implementado y publicado** (opt-in, `inari_activo` false por
> defecto). v2.5.0 introdujo la integración; **v2.6.0 cambió el modelo a
> "tarea por slot"**: cada slot es una tarea independiente de Kanboard con su
> columna/carril/categoría y un marcador de día en `reference` ("TT-AAAA-MM-DD"),
> y la clasificación se elige al registrar el slot (los valores de config son
> solo el valor inicial). El modelo de escritura se verificó contra el código
> fuente de Kanboard v1.2.50 (createTask con `time_spent` y `reference`, params
> nombrados; searchTasks por `ref:`; updateTask/moveTaskPosition/removeTask).
> Pendiente: validar la escritura en uso real de SisGes / `inarifor`. Este
> documento manda sobre el mockup `mockup_inari_slot.svg`, que ilustra un alcance
> más amplio (destino general, estado "Pendiente/Sincronizado") del acordado.

### Alcance acordado

- La integracion es **solo para SisGes** (Sistemas de Gestion), no un segundo
  destino general para todos los servicios.
- INARI es el destino de los **dias marcados como teletrabajo**. En dias normales
  la app sigue registrando en ProyectosTIC como hasta ahora; INARI no aparece.
- Fuera de alcance ahora (posible extension futura): otros servicios, como
  Microinformatica, podrian querer INARI tambien en dias presenciales.

### Modelo de dias y destinos

- **Dia normal**: ProyectosTIC. Sin cambios respecto a hoy.
- **Dia de teletrabajo** (con INARI activo): la app ofrece elegir destino
  **INARI o ProyectosTIC, uno solo, nunca los dos**. Sugerencia por defecto:
  INARI.
- Como cada dia de teletrabajo va a un unico sistema, ningun dia tiene horas en
  ambos: **no hay duplicacion de horas por construccion**.
- Guardarrail: si un dia de teletrabajo ya tiene horas en un sistema y se intenta
  añadir en el otro, la app **avisa** (no bloquea, coherente con el resto).
- Nota de estado actual: marcar teletrabajo hoy es solo una etiqueta local
  (`TELETRABAJO` en config); no escribe horas en ningun sitio. Las horas de un
  dia de teletrabajo seran los slots que se creen en INARI.

### Jornada y computo de horas

- Un dia de teletrabajo mantiene su **jornada normal segun temporada** (p. ej. 5h
  verano / 7h invierno), que se cubre con las horas de INARI.
- El computo de jornada **nunca suma** ProyectosTIC + INARI. Cuenta el destino
  que tiene las horas ese dia (INARI en teletrabajo, ProyectosTIC en el resto).
- Afecta a: barra y "faltan Xh" de la semana, aviso diario de fichaje y resumen
  del mes. En dias de teletrabajo, esos calculos leen las horas de INARI
  (`time_spent` de las subtareas del dia).

### Resumen del mes

Dos cubos disjuntos que suman (ningun dia esta en los dos):

```
Registrado en ProyectosTIC ....... A h   (dias no teletrabajo)
Teletrabajo en INARI ............. B h   (n dias teletrabajados)
-------------------------------------------------
Total ............................ A+B h
Objetivo del mes ................. objetivo
```

Los dias de teletrabajo se evaluan contra sus horas de INARI: no aparecen como
incompletos si INARI los cubre.

### Configuracion (Herramientas > Integraciones, NO en el wizard)

La configuracion de INARI va en un dialogo nuevo de `Herramientas >
Integraciones`, fuera del configurador de primera vez (INARI lo usa una minoria;
el arranque inicial debe seguir corto). El token se enmascara igual que la
`api_key` de OpenProject y no se escribe en logs.

El dialogo permite: activar/desactivar, URL, usuario y token (con pegado rapido
`usuario:token` que se separa solo), **Probar conexion**, y elegir por API el
proyecto y los valores **por defecto** de columna, carril/swimlane y categoria.
Desde v2.6.0 esos tres son solo la semilla: la clasificacion real se elige al
registrar cada slot (ver "Formulario de slot INARI").

Campos en `config.json`:

```json
{
  "inari_activo": false,
  "inari_url": "https://inari.ugr.es/kanboard/jsonrpc.php",
  "inari_usuario": "",
  "inari_token": "",
  "inari_project_id": null,
  "inari_column_id": null,
  "inari_swimlane_id": null,
  "inari_category_id": null
}
```

`inari_column_id`/`swimlane_id`/`category_id` son los valores por defecto. La
app recuerda ademas el ultimo usado por slot en `inari_last_column_id`,
`inari_last_swimlane_id` e `inari_last_category_id` (opt-in, se crean solos).

Se descartan del borrador anterior `inari_por_defecto`, `inari_sugerir_en_teletrabajo`,
`mostrar_selector_destino`, `recordar_ultimo_destino` y `ultimo_destino`: con el
modelo por-dia (INARI = destino de teletrabajo) y el selector visible solo en
dias de teletrabajo, dejan de tener sentido.

### Indicadores de conexion (pie de la ventana)

- La app ya tiene un indicador `● ...` de color (verde/ambar/rojo) para
  ProyectosTIC (`_poner_conexion` / `lbl_conn` en `registrar_gui.py`).
- Se añade un **gemelo para INARI**, con estado independiente, visible **solo si
  `inari_activo`**. Diferenciados por nombre: `● ProyectosTIC` / `● INARI`.
- INARI se comprueba con un `getMe` ligero en cada refresco (una llamada barata,
  en el hilo de fondo que ya existe), para que el punto este siempre vivo.

### API de INARI (Kanboard JSON-RPC)

- Produccion: `https://inari.ugr.es/kanboard/jsonrpc.php`
- Version observada: Kanboard `1.2.50`
- Autenticacion: HTTP Basic con `usuario:token_personal`.
- El entorno de formacion (`inarifor.ugr.es`) usa otra autenticacion/token; un
  token de produccion no sirve alli.

Metodos Kanboard relevantes:

- `getMe`: validar credenciales y obtener el usuario actual (tambien vale para el
  indicador de conexion).
- `getMyProjects`: listar proyectos visibles.
- `getColumns`, `getActiveSwimlanes`, `getAllCategories`: descubrir opciones del
  tablero.
- `createTask`: crear un slot (tarea) con `time_spent`, `reference` y
  column/swimlane/category. **Params nombrados** (`time_spent` es posicional 21).
  Devuelve el id entero (o `false`).
- `searchTasks`: leer los slots de un dia por `ref:TT-AAAA-MM-DD status:open`.
- `updateTask` (clave `id`): editar titulo/descripcion/categoria/`time_spent`.
- `moveTaskPosition` (clave `task_id`): mover de columna/carril (updateTask no
  puede).
- `removeTask` (clave `task_id`): borrar un slot.

No guardar IDs de proyecto, columna, swimlane o categoria en codigo: descubrirlos
por API y persistirlos en `config.json`, igual que la configuracion de
OpenProject.

**Modelo de tiempo confirmado** (codigo fuente Kanboard v1.2.50): la tabla
`tasks` tiene columnas propias `time_spent`/`time_estimated`; `createTask` y
`updateTask` las escriben directamente. Las horas del slot van en `time_spent`
de **la tarea**, NO en subtareas: una subtarea con `time_spent` dispararia
`SubtaskTimeTrackingModel`, que sobreescribe el `time_spent` de la tarea con la
suma de sus subtareas (doble fuente de verdad). La franja "09:00-10:30" va en el
**titulo** de la tarea; el dia se marca en `reference` = "TT-AAAA-MM-DD"
(agrupacion determinista, independiente de zona horaria).

### Modelo del registro y de los apuntes

- **Cada slot es una TAREA independiente** de Kanboard (no hay tarea diaria ni
  subtareas). Titulo `09:00-10:30 - <descripcion>`, horas en `time_spent`,
  columna/carril/categoria propias, y `reference` = "TT-AAAA-MM-DD" como
  marcador de dia para agrupar los slots.
- Un dia de teletrabajo puede tener varios slots en **distinta** columna/carril/
  categoria (era justo el motivo del cambio de modelo).
- En la tabla de la app, cada apunte lleva su **destino** (ProyectosTIC / INARI) y
  su **id externo** (id de `time_entry` de OpenProject o `task_id` de Kanboard),
  para enrutar editar/borrar al sistema correcto (`removeTask` en INARI).

### Formulario de slot INARI

- Muestra **Inicio / Fin / Descripcion** (con la duracion calculada) y, ademas,
  **Columna / Carril / Categoria** por slot, prerrellenados con el ultimo valor
  usado (o el de por defecto de config). Cargar las opciones del tablero es una
  llamada en segundo plano al abrir; si falla, se usan los valores por defecto.
- Validacion de slots como **funciones puras** (testeables como `_pascua`):
  horas positivas, `duracion = fin - inicio`, sin solapes, y opcionalmente aviso
  si el total del dia no llega a la jornada.

### Fases

1. **Fase 1 - solo lectura**: modulo `inari.py` (getMe, getMyProjects, getColumns,
   getActiveSwimlanes, getAllCategories), dialogo de config en Herramientas,
   "Probar conexion", descubrimiento y persistencia de IDs. No escribe nada.
   Tests con red mockeada del cliente y de la validacion de franjas.
2. **Fase 2 - escritura inmediata**: selector de destino en dias de teletrabajo,
   formulario de slot, `createTask`/`createSubtask` + `time_spent`, tabla con
   columna Destino y enrutado de editar/borrar, los dos indicadores de conexion,
   resumen con los dos cubos y guardarrail de exclusividad.

Se descarta la cola diferida y el estado "Pendiente/Sincronizado" del mockup: con
escritura inmediata y el modelo exclusivo por dia no hace falta.

### Decisiones tomadas

- Solo SisGes; INARI = destino de los dias de teletrabajo.
- En teletrabajo: INARI o ProyectosTIC, exclusivo por dia (nunca ambos).
- Jornada de un dia de teletrabajo = jornada normal por temporada.
- El computo nunca suma ambos destinos; el resumen usa dos cubos disjuntos.
- Configuracion en Herramientas > Integraciones, no en el wizard.
- Escritura inmediata (sin cola diferida).
- Dos indicadores de conexion diferenciados; el de INARI solo si esta activo.

### Preguntas pendientes

- Confirmar la practica real de SisGes: la convencion tarea-diaria +
  subtarea-por-slot la impone la app; Kanboard no la exige. Validar que encaja.
- Revisar en inarifor el namespace `subtask_time_tracking` por si permitiera
  registrar franjas de forma mas fiel que meterlas en el titulo.
- Confirmar el flujo de correccion de un slot ya enviado (updateSubtask /
  removeSubtask / recrear). Encaja con el editar/borrar actual de la app.
- Hacer el descubrimiento de IDs y los tests primero en `inarifor` con un token
  de formacion desechable.

### Seguridad

- No versionar tokens ni configuraciones reales.
- No registrar tokens en logs ni mostrarlos en mensajes de error.
- Enmascarar credenciales en la pantalla de configuracion.
- Documentar que los tokens temporales deben revocarse tras las pruebas.
