# Mejoras pendientes

Este documento recoge mejoras candidatas que conviene diseñar antes de
implementarlas. No debe incluir credenciales, tokens ni datos personales de
configuracion local.

## Integracion con INARI (destino de los dias de teletrabajo en SisGes)

> Estado: diseño consolidado (decisiones de julio 2026). **Fase 1 implementada**
> (cliente `inari.py` de solo lectura + config en Herramientas > Integraciones),
> pendiente de validar en `inarifor.ugr.es`. **Fase 2 pendiente** (escritura de
> slots). Este documento manda sobre el mockup `mockup_inari_slot.svg`, que
> ilustra un alcance mas amplio (destino general, estado "Pendiente/Sincronizado")
> del que finalmente se acordo.

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
proyecto, la columna, el carril/swimlane y la categoria por defecto.

Campos candidatos en `config.json`:

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
- `searchTasks`: localizar tareas existentes.
- `createTask` / `updateTask`: crear/actualizar la tarea diaria.
- `createSubtask` / `updateSubtask` / `getAllSubtasks`: gestionar los slots.
- `removeSubtask`: borrar un slot.

No guardar IDs de proyecto, columna, swimlane o categoria en codigo: descubrirlos
por API y persistirlos en `config.json`, igual que la configuracion de
OpenProject.

**Modelo de tiempo confirmado** (docs.kanboard.org, jul 2026): `createSubtask` y
`updateSubtask` exponen `time_spent` (horas acumuladas) pero NO parametros de
inicio/fin de franja. Kanboard guarda `start`/`end` solo por cambios de estado en
tiempo real (todo -> en progreso -> hecho), no sirve para registrar franjas
pasadas. Por tanto la franja "09:00-10:30" va en el **titulo** de la subtarea y
las horas en `time_spent`. (Revisar en inarifor el namespace
`subtask_time_tracking` por si aportara algo mas fiel, sin contar con ello.)

### Modelo del registro y de los apuntes

- Una **tarea diaria** por dia de teletrabajo (p. ej. `Teletrabajo 2026-07-06`).
- Una **subtarea por slot**: titulo `09:00-10:30 - <descripcion>`, horas en
  `time_spent`.
- En la tabla de la app, cada apunte lleva su **destino** (ProyectosTIC / INARI) y
  su **id externo** (id de `time_entry` de OpenProject o id de subtarea de
  Kanboard), para enrutar editar/borrar al sistema correcto (`updateSubtask` /
  `removeSubtask` en INARI).

### Formulario de slot INARI

- En el dia a dia muestra solo **Inicio / Fin / Descripcion** (con la duracion
  calculada). Proyecto / Columna / Carril / Categoria quedan plegados como
  "avanzado", rellenados con los valores por defecto de config.
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
