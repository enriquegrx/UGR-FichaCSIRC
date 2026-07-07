# Mejoras pendientes

Este documento recoge mejoras candidatas que conviene diseñar antes de
implementarlas. No debe incluir credenciales, tokens ni datos personales de
configuracion local.

## Integracion con INARI como destino de registro

### Contexto

INARI se usa en algunos servicios como sistema de gestion de tareas. En
Sistemas de Gestion, los dias de teletrabajo deben registrarse en INARI, no en
ProyectosTIC/OpenProject. En otros servicios, como Microinformatica, INARI puede
usarse tambien en dias presenciales, de forma indistinta con ProyectosTIC.

Por tanto, INARI no debe modelarse como una consecuencia fija del teletrabajo,
sino como un segundo destino de registro configurable por el usuario. El
teletrabajo solo puede servir como sugerencia de destino cuando asi se active
en preferencias.

### Descubrimiento API

INARI esta desplegado sobre Kanboard y expone la API JSON-RPC estandar:

- Produccion: `https://inari.ugr.es/kanboard/jsonrpc.php`
- Version observada: Kanboard `1.2.50`
- Autenticacion: HTTP Basic con `usuario:token_personal`
- El entorno de formacion usa otra autenticacion/token; un token de produccion
  no sirve en `inarifor.ugr.es`.

Metodos Kanboard relevantes:

- `getMe`: validar credenciales y obtener el usuario actual.
- `getMyProjects`: listar proyectos visibles para el usuario.
- `getColumns`: obtener columnas del tablero.
- `getActiveSwimlanes`: obtener carriles/swimlanes.
- `getAllCategories`: obtener categorias.
- `searchTasks`: localizar tareas existentes.
- `createTask`: crear una tarea.
- `updateTask`: actualizar una tarea.
- `createSubtask`: crear una subtarea.
- `updateSubtask`: asignar usuario, estado y `time_spent`.
- `getAllSubtasks`: consultar subtareas de una tarea.

No guardar IDs de proyecto, columna, swimlane o categoria en codigo. Deben
descubrirse por API y persistirse en `config.json`, igual que la configuracion
de OpenProject.

### Propuesta funcional

La app mantendria el flujo actual de ProyectosTIC como camino rapido, y anadiria
INARI como destino alternativo por apunte.

Flujo propuesto:

1. El usuario selecciona uno o varios dias, igual que ahora.
2. En el formulario inferior aparece un selector de destino:
   `ProyectosTIC | INARI`, solo si INARI esta activado.
3. Si el destino es ProyectosTIC, se muestra el formulario actual: tarea, horas,
   actividad y comentario.
4. Si el destino es INARI, se muestra un formulario de slot: hora inicio, hora
   fin, descripcion/tarea, proyecto, columna, carril y categoria.
5. La tabla de apuntes muestra el origen/destino de cada registro para evitar
   confusiones.
6. La app valida los slots INARI antes de sincronizar: horas positivas,
   franjas sin solape y, si procede, total de jornada esperada.

El teletrabajo queda como una marca de modalidad del dia. Si la preferencia
`inari_sugerir_en_teletrabajo` esta activa, al seleccionar un dia marcado como
teletrabajo la app preselecciona INARI, pero el usuario puede cambiarlo si el
selector esta visible.

Modelo recomendado en INARI:

- Crear una tarea diaria, por ejemplo: `Registro 2026-07-06` o
  `Teletrabajo 2026-07-06` cuando aplique.
- Crear una subtarea por slot de tiempo:
  `09:00-10:30 - Revision de copias`
- Guardar las horas del slot en `time_spent`.
- Incluir la franja horaria en el titulo o descripcion de la subtarea, porque
  Kanboard registra horas dedicadas pero no expone en la API estandar un
  historico inicio-fin para slots pasados.

### Configuracion nueva

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
  "inari_category_id": null,
  "inari_por_defecto": false,
  "inari_sugerir_en_teletrabajo": true,
  "mostrar_selector_destino": true,
  "recordar_ultimo_destino": true,
  "ultimo_destino": "proyectostic"
}
```

El configurador inicial deberia incluir un paso opcional "INARI":

- Activar/desactivar la integracion.
- Introducir URL, usuario y token en campos separados.
- Permitir pegado rapido `usuario@ugr.es:token`, separandolo automaticamente.
- Probar conexion con INARI.
- Elegir proyecto visible.
- Elegir columna destino inicial.
- Elegir swimlane/carril por defecto.
- Elegir categoria por defecto.
- Elegir preferencias con checks:
  - Usar INARI como destino por defecto.
  - En dias de teletrabajo, sugerir INARI.
  - Mostrar selector de destino al anadir apuntes.
  - Recordar ultimo destino usado.

Las mismas opciones deberian estar disponibles posteriormente en
`Herramientas > Preferencias` o `Herramientas > Integraciones`.

### Encaje con la app actual

Piezas probables:

- Nuevo modulo `inari.py` para aislar JSON-RPC, autenticacion y errores.
- Extender `configurar_gui.py` con un paso opcional "INARI".
- Extender `rellenar_horas.py` con funciones puras de validacion de franjas.
- Extender `registrar_gui.py` con selector de destino y formulario INARI.
- Tests unitarios del cliente INARI con red mockeada.
- Tests de validacion de franjas: solapes, horas negativas, huecos y total de
  jornada.

### Preguntas pendientes

- Confirmar si INARI exige una tarea por dia o permite/espera tareas sueltas.
- Confirmar si la franja horaria debe ser visible como texto o si existe algun
  plugin/campo especifico no cubierto por la API estandar de Kanboard.
- Decidir si se permite mezclar ProyectosTIC e INARI dentro del mismo dia o si
  la app debe avisar cuando detecte ambos destinos.
- Decidir como se corrige un registro ya enviado a INARI: editar subtarea,
  borrar y recrear, o marcar una nueva version.
- Confirmar si conviene probar primero en `inarifor.ugr.es` con un token propio
  de formacion.

### Seguridad

- No versionar tokens ni configuraciones reales.
- No registrar tokens en logs ni mostrarlos en mensajes de error.
- Enmascarar credenciales en la pantalla de configuracion.
- Documentar que los tokens temporales deben revocarse tras las pruebas.
